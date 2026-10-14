"""Export and verify all project data before changing database backends."""

import argparse
import base64
import hashlib
import json
from contextlib import closing
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from backend.database import connect_database
from backend.identity import legacy_auth
from backend.migrate_supabase import TABLES as APP_TABLES
from backend.settings import PROJECT_ROOT


FACE_TABLES = ("metadata", "accounts", "people", "face_samples", "account_people", "auth_sessions", "audit_logs")


def json_value(value):
    if isinstance(value, bytes):
        return {"$binary": base64.b64encode(value).decode("ascii")}
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(type(value).__name__)


def read_table(connection, table):
    cursor = connection.execute(f"SELECT * FROM {table}")
    columns = [column[0] for column in cursor.description]
    rows = []
    for row in cursor.fetchall():
        rows.append({name: row[name] if isinstance(row, dict) else row[index] for index, name in enumerate(columns)})
    return rows


def fingerprint(rows):
    canonical = sorted(json.dumps(row, ensure_ascii=False, sort_keys=True, default=json_value) for row in rows)
    return hashlib.sha256("\n".join(canonical).encode("utf-8")).hexdigest()


def export_current():
    folder = PROJECT_ROOT / "backups" / ("owner-handoff-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    folder.mkdir(parents=True)
    auth = legacy_auth()
    with closing(connect_database()) as connection:
        if getattr(connection, "backend", None) == "sqlserver" and auth.faces.backend == "sqlserver":
            # Both schemas now share one database and one consistent transaction.
            connection.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            faces = {table: read_table(connection, "dbo." + table) for table in FACE_TABLES}
        elif getattr(connection, "backend", None) == "postgres" and auth.faces.backend == "postgres":
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            faces = {table: read_table(connection, f'"{auth.faces.schema}"."{table}"') for table in FACE_TABLES}
        else:
            with auth.faces._connect() as face_connection:
                if auth.faces.backend == "sqlserver":
                    face_connection.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
                else:
                    face_connection.execute("BEGIN")
                faces = {table: read_table(face_connection, table) for table in FACE_TABLES}
        if getattr(connection, "backend", None) == "postgres" and auth.faces.backend != "postgres":
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        elif getattr(connection, "backend", None) == "sqlserver":
            connection.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
        elif getattr(connection, "backend", None) != "postgres":
            connection.execute("BEGIN")
        export_tables = ("schema_version", *APP_TABLES)
        if getattr(connection, "backend", None) == "sqlserver":
            export_tables = (*export_tables, "data_handoffs")
        elif getattr(connection, "backend", None) == "postgres":
            if connection.execute("SELECT to_regclass('data_handoffs')").fetchone()[0]:
                export_tables = (*export_tables, "data_handoffs")
        app = {table: read_table(connection, table) for table in export_tables}
    manifest = {"created_at": datetime.now(timezone.utc).isoformat(), "version": 1, "sources": {}}
    for name, records in (("visionface", faces), ("auramaxx", app)):
        content = json.dumps(records, ensure_ascii=False, indent=2, default=json_value).encode("utf-8")
        path = folder / (name + ".json")
        path.write_bytes(content)
        manifest["sources"][name] = {
            "file": path.name, "sha256": hashlib.sha256(content).hexdigest(),
            "tables": {table: {"rows": len(rows), "sha256": fingerprint(rows)} for table, rows in records.items()},
        }
    (folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    verify_export(folder)
    return folder, manifest


def verify_export(folder):
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    for source in manifest["sources"].values():
        content = (folder / source["file"]).read_bytes()
        if hashlib.sha256(content).hexdigest() != source["sha256"]:
            raise ValueError("Backup checksum mismatch")
        tables = json.loads(content)
        for table, expected in source["tables"].items():
            if len(tables[table]) != expected["rows"] or fingerprint(tables[table]) != expected["sha256"]:
                raise ValueError("Backup table verification failed: " + table)
    return manifest


def migrate_to_owner_sqlserver(folder):
    """Import only into an empty app schema; never delete or overwrite sources."""
    from backend.sqlserver_database import connect_sqlserver, initialize_sqlserver
    manifest = verify_export(folder)
    records = json.loads((folder / "auramaxx.json").read_text(encoding="utf-8"))
    manifest_hash = hashlib.sha256((folder / "manifest.json").read_bytes()).hexdigest()
    with closing(connect_sqlserver()) as target:
        initialize_sqlserver(target)
        previous = target.execute("SELECT manifest_hash FROM data_handoffs WHERE id = ?", (folder.name,)).fetchone()
        if previous:
            if previous["manifest_hash"] != manifest_hash:
                raise ValueError("Existing handoff uses another backup")
            return {"already_imported": True, "backup": str(folder)}
        target.execute("BEGIN IMMEDIATE")
        try:
            for table in records:
                if target.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]:
                    raise ValueError("SQL Server destination must be empty: " + table)
            counts = {}
            for table, rows in records.items():
                if table == "sessions":
                    counts[table] = 0
                    continue
                for row in rows:
                    columns = list(row)
                    placeholders = ",".join("?" for _ in columns)
                    names = ",".join("[" + name + "]" for name in columns)
                    target.execute(f"INSERT INTO {table} ({names}) VALUES ({placeholders})", tuple(row[name] for name in columns))
                copied = read_table(target, table)
                if fingerprint(copied) != manifest["sources"]["auramaxx"]["tables"][table]["sha256"]:
                    raise ValueError("Migration verification failed: " + table)
                counts[table] = len(copied)
            # All original SQL Server account, face, ownership and audit rows remain.
            auth = legacy_auth()
            with auth.faces._connect() as faces:
                for table, expected in manifest["sources"]["visionface"]["tables"].items():
                    if fingerprint(read_table(faces, table)) != expected["sha256"]:
                        raise ValueError("Source changed since backup; export again: " + table)
            target.execute("INSERT INTO data_handoffs (id, manifest_hash, imported_at, details) VALUES (?, ?, ?, ?)",
                           (folder.name, manifest_hash, datetime.now(timezone.utc).isoformat(), json.dumps(counts)))
            target.commit()
        except BaseException:
            target.rollback()
            raise
        # Make all migrated email accounts visible to the single local admin area.
        from backend.identity import ensure_legacy_account, project_account
        for user in target.execute("SELECT id, email, created_at FROM users").fetchall():
            ensure_legacy_account(target, user)
        for account in auth.admin_accounts():
            project_account(target, account)
        result = {"backup": str(folder), "verified": True, "copied": counts,
                  "sessions_invalidated": len(records.get("sessions", [])), "source_deleted": False}
        (folder / "sqlserver-handoff.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["export", "verify", "migrate-sqlserver"])
    parser.add_argument("--backup", type=Path)
    args = parser.parse_args()
    if args.command == "export":
        folder, manifest = export_current()
    elif args.command == "migrate-sqlserver":
        result = migrate_to_owner_sqlserver(args.backup.resolve())
        print(json.dumps(result, ensure_ascii=True))
        return
    else:
        folder = args.backup.resolve()
        manifest = verify_export(folder)
    print(json.dumps({"backup": str(folder), "verified": True,
                      "counts": {name: {table: data["rows"] for table, data in source["tables"].items()}
                                 for name, source in manifest["sources"].items()}}, ensure_ascii=True))


if __name__ == "__main__":
    try:
        main()
    finally:
        import sys
        from backend.database import close_database_pool
        close_database_pool()
        active_server = sys.modules.get("server")
        if active_server is not None and hasattr(active_server.face_database, "close"):
            active_server.face_database.close()
