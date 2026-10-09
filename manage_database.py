"""Provision SQL Server and migrate a consistent backup without editing SQLite."""

import argparse
import json
import re
import sqlite3
import sys
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from database_config import CONFIG_NAME
from sql_server_store import SqlServerFaceStore, connection_string

BASE_DIR = Path(__file__).resolve().parent


def provision(args):
    import pyodbc

    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", args.database):
        raise ValueError("Database name must contain only letters, numbers and underscores")
    if args.database.lower() in {"master", "tempdb", "model", "msdb", "visionfacepractice"}:
        raise ValueError("Choose a separate application database, not a system or practice database")
    source = Path(args.source).resolve()
    if not source.is_file():
        raise ValueError("SQLite source file does not exist")
    # backup() creates a consistent snapshot even when a reader/server is open.
    folder = BASE_DIR / "backups"
    folder.mkdir(exist_ok=True)
    backup = folder / ("faces-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".sqlite3")
    with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as origin:
        with closing(sqlite3.connect(backup)) as target:
            origin.backup(target)
    print(f"SQLite backup: {backup}")
    master = connection_string(args.server, "master", args.driver, args.trust_server_certificate)
    with closing(pyodbc.connect(master, autocommit=True, timeout=5)) as connection:
        if connection.execute("SELECT DB_ID(?)", args.database).fetchone()[0] is None:
            connection.execute(f"CREATE DATABASE [{args.database}]")
    store = SqlServerFaceStore(connection_string(
        args.server, args.database, args.driver, args.trust_server_certificate
    ))
    store.initialize()
    imported = store.import_sqlite(backup)
    print("Imported:", json.dumps(imported))
    print("Current counts:", json.dumps(store.counts()))
    if args.activate:
        config = {
            "backend": "sqlserver", "server": args.server, "database": args.database,
            "driver": args.driver, "trust_certificate": args.trust_server_certificate,
        }
        path = BASE_DIR / CONFIG_NAME
        if path.exists():
            saved = folder / ("database-config-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".json")
            saved.write_bytes(path.read_bytes())
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        temporary.replace(path)
        print("SQL Server activated for the next server start. Restart server.py.")
    return store


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    setup = commands.add_parser("setup-sqlserver", help="Create schema, back up SQLite and import once")
    setup.add_argument("--server", default=r"localhost\SQLEXPRESS")
    setup.add_argument("--database", default="VisionFaceDB")
    setup.add_argument("--driver", default="ODBC Driver 18 for SQL Server")
    setup.add_argument("--source", default=str(BASE_DIR / "face_database.sqlite3"))
    setup.add_argument("--trust-server-certificate", action="store_true", help="For a trusted local development instance")
    setup.add_argument("--activate", action="store_true", help="Switch future server starts after successful import")
    args = parser.parse_args()
    provision(args)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
