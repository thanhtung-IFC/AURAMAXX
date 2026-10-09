"""Render entry point: require external PostgreSQL and secure session cookies."""
import os


def main():
    if os.environ.get("FACE_DB_BACKEND") != "postgres" or not os.environ.get("DATABASE_URL"):
        raise SystemExit("Configure FACE_DB_BACKEND=postgres and DATABASE_URL before deploying")
    if os.environ.get("FACE_COOKIE_SECURE", "").lower() != "true":
        raise SystemExit("Configure FACE_COOKIE_SECURE=true for HTTPS deployment")
    from server import run_server
    run_server()


if __name__ == "__main__":
    main()
