"""Verified, additive handoff of both project stores into one Supabase database.

An existing destination row must exactly match a source row. Conflicts abort
the whole data transaction; no application data is overwritten. Login sessions
are archived in the backups and invalidated at cutover.
"""
import argparse
import base64
import hashlib
import json
import re
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from auth_store import AuthStore
from backend.data_handoff import FACE_TABLES, fingerprint, read_table, verify_export
from backend.database import connect_postgres, initialize_database
from backend.migrate_supabase import TABLES
from face_store import FaceStore
from postgres_store import PostgresFaceStore


def require_identical_subset(existing, incoming, table):
    source_rows = {fingerprint([row]) for row in incoming}
    if any(fingerprint([row]) not in source_rows for row in existing):
        raise ValueError("Destination has different data; migration stopped: " + table)


def normalize_face_samples(samples):
    normalized, verified_hashes = [], 0
    for source in samples:
        sample = dict(source)
        FaceStore._vector(json.loads(sample["vector_json"]))
        if "vector_hash" in sample:
            stored = sample.pop("vector_hash")
            if not isinstance(stored, dict) or set(stored) != {"$binary"}:
                raise ValueError("Invalid SQL Server face hash encoding")
            digest = base64.b64decode(stored["$binary"], validate=True)
            if digest != hashlib.sha256(sample["vector_json"].encode("utf-8")).digest():
                raise ValueError("SQL Server face vector checksum mismatch")
            verified_hashes += 1
        # PostgreSQL uses UNIQUE(person_id, feature_version, vector_json).
        # The SQL Server binary index key is derivable and remains in the backup.
        normalized.append(sample)
    return normalized, verified_hashes


def migrate(folder, url, *, app_schema="public", face_schema="visionface"):
    from psycopg import sql
    for schema in (app_schema, face_schema):
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", schema):
            raise ValueError("Invalid PostgreSQL schema")
    if app_schema == face_schema:
        raise ValueError("Application and face tables require different schemas")
    manifest = verify_export(folder)
    faces = json.loads((folder / "visionface.json").read_text(encoding="utf-8"))
    app = json.loads((folder / "auramaxx.json").read_text(encoding="utf-8"))
    faces["face_samples"], verified_hashes = normalize_face_samples(faces["face_samples"])
    if not any(row["role"] == "admin" and row["is_active"] for row in faces["accounts"]):
        raise ValueError("An active owner account is required")

    manifest_hash = hashlib.sha256((folder / "manifest.json").read_bytes()).hexdigest()
    handoff_id = folder.name + "-postgres"
    with closing(connect_postgres(url, schema=app_schema)) as connection:
        if connection.execute("SELECT to_regclass('data_handoffs')").fetchone()[0]:
            previous = connection.execute("SELECT manifest_hash FROM data_handoffs WHERE id = ?", (handoff_id,)).fetchone()
            if previous:
                if previous[0] != manifest_hash:
                    raise ValueError("Existing handoff uses another backup")
                return {"already_imported": True, "backup": str(folder)}

    store = PostgresFaceStore(url, schema=face_schema)
    try:
        store.initialize()
        AuthStore(store).initialize()
    finally:
        store.close()
    initialize_database(lambda: connect_postgres(url, schema=app_schema))

    with closing(connect_postgres(url, schema=app_schema)) as connection:
        raw = connection._connection
        previous = connection.execute("SELECT manifest_hash FROM data_handoffs WHERE id = ?", (handoff_id,)).fetchone()
        if previous:
            if previous[0] != manifest_hash:
                raise ValueError("Existing handoff uses another backup")
            return {"already_imported": True, "backup": str(folder)}
        connection.commit()
        try:
            raw.execute("SET LOCAL lock_timeout = '10s'")
            raw.execute("SET LOCAL statement_timeout = '40s'")
            app_tables = ("schema_version", *TABLES, "data_handoffs")
            targets = [(face_schema, table, faces.get(table, [])) for table in FACE_TABLES]
            targets += [(app_schema, table, app.get(table, [])) for table in app_tables]
            qualified = lambda schema, table: sql.SQL("{}.{}").format(sql.Identifier(schema), sql.Identifier(table))
            raw.execute(sql.SQL("LOCK TABLE {} IN SHARE ROW EXCLUSIVE MODE").format(sql.SQL(", ").join(qualified(schema, table) for schema, table, _ in targets)))
            invalidated = {}
            before = {}
            for schema, table, rows in targets:
                existing = read_table(connection, qualified(schema, table).as_string(raw))
                before[f"{schema}.{table}"] = existing
                if table in {"sessions", "auth_sessions"}:
                    invalidated[f"{schema}.{table}"] = len(existing)
                elif table not in {"metadata", "schema_version"}:
                    require_identical_subset(existing, rows, f"{schema}.{table}")

            before_content = json.dumps(before, ensure_ascii=False, indent=2).encode("utf-8")
            (folder / "supabase-cutover-before.json").write_bytes(before_content)
            (folder / "supabase-cutover-before-manifest.json").write_text(json.dumps({
                "sha256": hashlib.sha256(before_content).hexdigest(),
                "tables": {table: {"rows": len(rows), "sha256": fingerprint(rows)} for table, rows in before.items()}
            }, indent=2), encoding="utf-8")

            counts = {"visionface": {}, "auramaxx": {}}
            # Metadata is restored last because the face cache triggers increment revision.
            ordered = [entry for entry in targets if entry[1] != "metadata"]
            ordered += [entry for entry in targets if entry[1] == "metadata"]
            for schema, table, rows in ordered:
                identifier = qualified(schema, table)
                if table in {"sessions", "auth_sessions"}:
                    raw.execute(sql.SQL("DELETE FROM {}").format(identifier))
                    expected = []
                else:
                    expected = rows
                    if table == "metadata" and not any(row["key"] == "schema_version" for row in rows):
                        expected = [*rows, {"key": "schema_version", "value": "1"}]
                    if rows:
                        columns = list(rows[0])
                        conflict = sql.SQL("ON CONFLICT DO NOTHING")
                        if table == "metadata":
                            conflict = sql.SQL('ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value')
                        elif table == "schema_version":
                            conflict = sql.SQL('ON CONFLICT (version) DO UPDATE SET applied_at = EXCLUDED.applied_at')
                        statement = sql.SQL("INSERT INTO {} ({}) VALUES ({}) {}").format(
                            identifier, sql.SQL(", ").join(map(sql.Identifier, columns)),
                            sql.SQL(", ").join(sql.Placeholder() for _ in columns), conflict)
                        with raw.cursor() as cursor:
                            cursor.executemany(statement, [tuple(row[column] for column in columns) for row in rows])
                copied = read_table(connection, identifier.as_string(raw))
                if fingerprint(copied) != fingerprint(expected):
                    raise ValueError("PostgreSQL verification failed: " + schema + "." + table)
                counts["visionface" if schema == face_schema else "auramaxx"][table] = len(copied)

            # Check the account links before enabling the migrated database.
            unmatched = raw.execute(sql.SQL("SELECT COUNT(*) FROM {} l LEFT JOIN {} a ON a.id = l.account_id WHERE a.id IS NULL").format(qualified(app_schema, "legacy_account_links"), qualified(face_schema, "accounts"))).fetchone()[0]
            if unmatched:
                raise ValueError("Some application accounts have no VisionFace account")
            report = {"verified": True, "backup": str(folder), "schemas": {"application": app_schema, "visionface": face_schema},
                      "copied": counts, "derived_face_hashes_verified": verified_hashes,
                      "old_sessions_invalidated": invalidated, "source_deleted": False}
            connection.execute("INSERT INTO data_handoffs (id, manifest_hash, imported_at, details) VALUES (?, ?, ?, ?)",
                               (handoff_id, manifest_hash, datetime.now(timezone.utc).isoformat(), json.dumps(report, ensure_ascii=False)))
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
    (folder / "postgres-handoff.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main():
    from dotenv import dotenv_values
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup", required=True, type=Path)
    parser.add_argument("--connection-env-file", type=Path, default=Path(".env"))
    args = parser.parse_args()
    values = dotenv_values(args.connection_env_file)
    url = values.get("DATABASE_URL") or values.get("SUPABASE_DATABASE_URL")
    if not url:
        raise SystemExit("A PostgreSQL connection is required in the environment file")
    try:
        result = migrate(args.backup.resolve(), url)
    except Exception as error:
        # Driver exceptions may contain credentials or account data.
        if type(error) is ValueError:
            raise SystemExit(str(error)) from None
        raise SystemExit("PostgreSQL handoff failed (" + type(error).__name__ + "); configuration was not changed") from None
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
