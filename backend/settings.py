"""Cấu hình backend, đọc biến môi trường ở máy chạy server."""

import os
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Đọc tệp .env ở thư mục gốc nếu có. Biến môi trường của hệ thống luôn được ưu tiên.
load_dotenv(PROJECT_ROOT / ".env")

DEFAULT_DATABASE_PATH = PROJECT_ROOT / "backend" / "data" / "auramaxx.sqlite3"
DATABASE_PATH = Path(
    os.getenv("AURAMAXX_DB_PATH", str(DEFAULT_DATABASE_PATH))
).expanduser()
if not DATABASE_PATH.is_absolute():
    DATABASE_PATH = PROJECT_ROOT / DATABASE_PATH
SUPABASE_DATABASE_URL = os.getenv("SUPABASE_DATABASE_URL", "").strip() or os.getenv("DATABASE_URL", "").strip()
POSTGRES_SCHEMA = os.getenv("AURAMAXX_POSTGRES_SCHEMA", "public").strip()
AURAMAXX_DB_BACKEND = os.getenv("AURAMAXX_DB_BACKEND", "postgres" if SUPABASE_DATABASE_URL else "sqlite").strip().lower()
if AURAMAXX_DB_BACKEND not in {"sqlite", "postgres", "sqlserver"}:
    raise ValueError("AURAMAXX_DB_BACKEND must be sqlite, postgres or sqlserver")
if not SUPABASE_DATABASE_URL and os.getenv("FACE_DB_BACKEND") == "postgres":
    SUPABASE_DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

APP_NAME = "AURAMAXX API"
APP_VERSION = "0.1.0"

COOKIE_SECURE = os.getenv("AUTH_COOKIE_SECURE", os.getenv("FACE_COOKIE_SECURE", "false")).strip().lower() == "true"
SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
SESSION_COOKIE_NAME = "auramaxx_session"
CSRF_COOKIE_NAME = "auramaxx_csrf"

AI_PROVIDER = os.getenv("AI_PROVIDER", "none").strip().lower()
AI_API_KEY = os.getenv("AI_API_KEY", "").strip()
AI_MODEL = os.getenv("AI_MODEL", "gpt-6-astra").strip()
try:
    AI_TIMEOUT_SECONDS = max(5.0, min(float(os.getenv("AI_TIMEOUT_SECONDS", "45")), 120.0))
    AI_MAX_OUTPUT_TOKENS = max(64, min(int(os.getenv("AI_MAX_OUTPUT_TOKENS", "1200")), 2048))
except ValueError:
    AI_TIMEOUT_SECONDS = 45.0
    AI_MAX_OUTPUT_TOKENS = 1200
try:
    AI_RATE_LIMIT_PER_MINUTE = max(1, min(int(os.getenv("AI_RATE_LIMIT_PER_MINUTE", "8")), 60))
except ValueError:
    AI_RATE_LIMIT_PER_MINUTE = 8

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "AURAMAXX_ALLOWED_ORIGINS",
        "http://localhost:8000,http://127.0.0.1:8000",
    ).split(",")
    if origin.strip()
]
