"""Render entry point: require external PostgreSQL and secure session cookies."""
import os


def main():
    if os.environ.get("FACE_DB_BACKEND") != "postgres" or not os.environ.get("DATABASE_URL"):
        raise SystemExit("Configure FACE_DB_BACKEND=postgres and DATABASE_URL before deploying")
    if os.environ.get("FACE_COOKIE_SECURE", "").lower() != "true":
        raise SystemExit("Configure FACE_COOKIE_SECURE=true for HTTPS deployment")
    os.environ.setdefault("SUPABASE_DATABASE_URL", os.environ["DATABASE_URL"])
    os.environ.setdefault("AUTH_COOKIE_SECURE", "true")
    import uvicorn
    uvicorn.run("backend.main:app", host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8000")))


if __name__ == "__main__":
    main()
