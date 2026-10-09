"""Database selection: explicit environment overrides local configuration."""

import json
import os
from pathlib import Path

from face_store import FaceStore

CONFIG_NAME = "database.local.json"


def load_settings(base_dir):
    path = Path(base_dir) / CONFIG_NAME
    settings = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    if not isinstance(settings, dict):
        raise ValueError("Database config must be an object")
    for key, variable in (("backend", "FACE_DB_BACKEND"), ("server", "SQLSERVER_SERVER"),
                          ("database", "SQLSERVER_DATABASE"), ("driver", "SQLSERVER_DRIVER")):
        if variable in os.environ:
            settings[key] = os.environ[variable]
    if "SQLSERVER_TRUST_CERTIFICATE" in os.environ:
        value = os.environ["SQLSERVER_TRUST_CERTIFICATE"].lower()
        if value not in ("true", "false", "1", "0", "yes", "no"):
            raise ValueError("Invalid SQLSERVER_TRUST_CERTIFICATE")
        settings["trust_certificate"] = value in ("true", "1", "yes")
    if "trust_certificate" in settings and not isinstance(settings["trust_certificate"], bool):
        raise ValueError("trust_certificate must be a boolean")
    for key in ("backend", "server", "database", "driver"):
        if key in settings and (not isinstance(settings[key], str) or not settings[key].strip()):
            raise ValueError(f"Invalid database setting: {key}")
    return settings


def create_store(base_dir):
    settings = load_settings(base_dir)
    backend = settings.get("backend", "sqlite").lower()
    if backend == "sqlite":
        return FaceStore(os.environ.get("FACE_DATABASE_PATH", str(Path(base_dir) / "face_database.sqlite3")))
    if backend == "sqlserver":
        from sql_server_store import SqlServerFaceStore, connection_string
        return SqlServerFaceStore(connection_string(
            settings.get("server", r"localhost\SQLEXPRESS"),
            settings.get("database", "VisionFaceDB"),
            settings.get("driver", "ODBC Driver 18 for SQL Server"),
            settings.get("trust_certificate", False),
            username=os.environ.get("SQLSERVER_USERNAME"),
            password=os.environ.get("SQLSERVER_PASSWORD"),
        ))
    if backend == "postgres":
        from postgres_store import PostgresFaceStore
        return PostgresFaceStore(os.environ.get("DATABASE_URL"))
    raise ValueError("FACE_DB_BACKEND must be sqlite, sqlserver or postgres")
