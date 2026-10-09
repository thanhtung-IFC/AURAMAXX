"""Read-only database and deployed HTTPS checks. Uses local config or environment."""
import argparse
import json
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError

from database_config import create_store
from face_store import StorageError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", help="Optional deployed HTTPS website URL")
    args = parser.parse_args()
    store = create_store(Path(__file__).resolve().parent)
    with store._connect() as connection:
        if store.backend == "sqlserver":
            row = connection.execute("SELECT DB_NAME(), CAST(SERVERPROPERTY('Edition') AS NVARCHAR(128))").fetchone()
            schema = connection.execute("SELECT OBJECT_ID(N'dbo.audit_logs', N'U')").fetchone()[0]
        elif store.backend == "postgres":
            row = connection.execute("SELECT current_database(), version()").fetchone()
            schema = connection.execute("SELECT to_regclass('audit_logs')").fetchone()[0]
        else:
            raise ValueError("Choose sqlserver or postgres for deployment checks")
        print(json.dumps({"database": row[0], "edition": row[1], "auth_schema_present": schema is not None}))
    if schema is not None:
        from auth_store import AuthStore
        print(json.dumps({"counts": store.counts(), "readable_audit_events": len(AuthStore(store).logs())}))
    if args.url:
        if not args.url.startswith("https://"):
            raise ValueError("Use the deployed HTTPS URL")
        base = args.url.rstrip("/")
        with urlopen(base + "/api/status", timeout=90) as response:
            status = json.load(response)
        if status.get("database") != store.backend:
            raise ValueError("Deployed web is not using the selected database")
        try:
            with urlopen(Request(base + "/api/admin/accounts"), timeout=90) as response:
                raise ValueError("Admin API was accessible without login")
        except HTTPError as error:
            if error.code != 401:
                raise
        print(json.dumps({"web_status": status, "anonymous_admin_access": "blocked"}))


if __name__ == "__main__":
    try:
        main()
    except (StorageError, ValueError) as error:
        raise SystemExit(str(error)) from None
