"""Copy existing accounts, ownership, faces and audit logs to an empty PostgreSQL schema.

Source comes from database.local.json (or FACE_DB_BACKEND overrides).
Destination is supplied through a hidden interactive prompt; never log credentials.
Source transactions are read-only. Sessions are deliberately excluded.
"""
import argparse
import getpass
import hashlib
import json
from pathlib import Path

from auth_store import AuthStore
from database_config import create_store
from face_store import FaceStore, StorageError
from postgres_store import PostgresFaceStore

TABLES = {
    "accounts": "id,username,display_name,password_hash,role,is_active,must_change_password,created_at,last_login",
    "people": "id,name,created_at,display_date",
    "face_samples": "id,person_id,vector_json,feature_version,dimension,landmark_count,created_at",
    "account_people": "person_id,account_id",
    "audit_logs": "id,actor_id,action,target_id,created_at",
}


def snapshot(source):
    with source._connect() as connection:
        # A consistent snapshot without initializing or modifying the source.
        if source.backend == "sqlite":
            connection.execute("BEGIN")
        elif source.backend == "sqlserver":
            connection.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
        else:
            connection.execute("BEGIN")
        version = connection.execute("SELECT [value] FROM metadata WHERE [key]='auth_schema_version'").fetchone()
        if not version or version[0] != "2":
            raise ValueError("Source authentication schema must be version 2")
        records = {table: AuthStore.rows(connection.execute(f"SELECT {columns} FROM {table}"))
                   for table, columns in TABLES.items()}
    # Reject invalid vectors before opening the destination write transaction.
    for row in records["face_samples"]:
        FaceStore._vector(json.loads(row["vector_json"]))
        if row["dimension"] != 60:
            raise ValueError("Unsupported source vector dimension")
    if not any(row["role"] == "admin" and row["is_active"] for row in records["accounts"]):
        raise ValueError("Source must have an active administrator")
    return records


def fingerprint(records):
    canonical = {table: sorted(rows, key=lambda row: tuple(str(row[k]) for k in TABLES[table].split(",")))
                 for table, rows in records.items()}
    return hashlib.sha256(json.dumps(canonical, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def migrate(source, destination, *, dry_run=False):
    records = snapshot(source)
    counts = {table: len(rows) for table, rows in records.items()}
    if dry_run:
        return {"mode": "preview", "source": source.backend, "counts": counts}
    destination.initialize()
    AuthStore(destination).initialize()
    with destination._connect() as connection:
        destination._write_lock(connection)
        if connection.execute("SELECT value FROM metadata WHERE key='full_import_completed'").fetchone():
            raise ValueError("Destination already imported; refusing to import again")
        for table in (*TABLES, "auth_sessions"):
            if connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]:
                raise ValueError("Destination must be empty; existing data will not be overwritten")
        for table, columns in TABLES.items():
            keys = columns.split(",")
            sql = f"INSERT INTO {table} ({columns}) VALUES ({','.join('?' for _ in keys)})"
            for row in records[table]:
                connection.execute(sql, tuple(row[key] for key in keys))
        copied = {table: AuthStore.rows(connection.execute(f"SELECT {columns} FROM {table}"))
                  for table, columns in TABLES.items()}
        if fingerprint(copied) != fingerprint(records):
            raise StorageError("Migration verification failed; destination transaction rolled back")
        connection.execute("INSERT INTO metadata VALUES ('full_import_completed', ?)", (FaceStore._timestamps()[0],))
    return {"mode": "imported_and_verified", "source": source.backend, "counts": counts, "sessions_copied": 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview", action="store_true", help="Read source counts only; no cloud connection")
    args = parser.parse_args()
    source = create_store(Path(__file__).resolve().parent)
    destination = None
    try:
        if args.preview:
            result = migrate(source, None, dry_run=True)
        else:
            url = getpass.getpass("Supabase Session pooler DATABASE_URL (hidden): ")
            destination = PostgresFaceStore(url)
            result = migrate(source, destination)
        print(json.dumps(result, ensure_ascii=False))
    finally:
        for store in (source, destination):
            if store and hasattr(store, "close"):
                store.close()


if __name__ == "__main__":
    try:
        main()
    except (StorageError, ValueError) as error:
        raise SystemExit(str(error)) from None
