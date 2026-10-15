"""Điểm khởi chạy ứng dụng FastAPI của AURAMAXX."""

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from backend.database import check_database_connection, initialize_database, close_database_pool
from backend.database import get_database
from backend.features import FEATURES
from backend.http_performance import WebCompressionMiddleware
from backend.routers import account, arena, assistant, aura, auth, consents, face_analysis, habits, health_hub, progress, vision, manage
from backend.identity import initialize_legacy
from backend.security import get_current_user
from auth_store import AuthError
from backend.settings import ALLOWED_ORIGINS, APP_NAME, APP_VERSION, PROJECT_ROOT
from backend.services.ai_service import ai_http_pool


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Initialize and check the configured database when the server starts."""
    initialize_database()
    initialize_legacy()
    try:
        async with ai_http_pool():
            yield
    finally:
        close_database_pool()
        from server import face_database
        if hasattr(face_database, "close"):
            face_database.close()


app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="API nền tảng cho dự án AURAMAXX.",
    lifespan=lifespan,
)

app.add_middleware(WebCompressionMiddleware, minimum_size=1000, compresslevel=5)

# Same-origin by default; explicit development origins remain configurable.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)

app.include_router(auth.router)
app.include_router(account.router)
app.include_router(consents.router)
app.include_router(habits.router)
app.include_router(health_hub.router)
app.include_router(progress.router)
app.include_router(assistant.router)
app.include_router(aura.router)
app.include_router(face_analysis.router)
app.include_router(arena.router)
app.include_router(vision.router)
app.include_router(manage.router)


@app.exception_handler(AuthError)
async def auth_error(_request: Request, error: AuthError):
    return JSONResponse({"detail": str(error), "message": str(error)}, status_code=error.status)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    if request.method not in {"GET", "HEAD", "OPTIONS"} and request.url.path.startswith("/api/"):
        origin = request.headers.get("Origin")
        if origin and origin not in {*ALLOWED_ORIGINS, str(request.base_url).rstrip("/")}:
            return JSONResponse({"detail": "Nguồn yêu cầu không hợp lệ."}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "same-origin"
    if (request.url.path.startswith("/api/") or request.url.path.endswith(".html")
            or request.url.path in {"/", "/manage", "/admin/login"}
            or response.headers.get("Content-Type", "").startswith("text/html")):
        response.headers["Cache-Control"] = "no-store"
    elif request.method in {"GET", "HEAD"} and response.status_code in {200, 304}:
        # Asset names are not fingerprinted: validate ETags on reuse so a new
        # deployment cannot leave the browser with mismatched module versions.
        response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
    return response


@app.get("/api/health", tags=["Hệ thống"])
def health_check() -> dict[str, str]:
    """Report API and configured database readiness."""
    try:
        check_database_connection()
    except Exception as error:
        raise HTTPException(
            status_code=503,
            detail="Cơ sở dữ liệu hiện chưa sẵn sàng.",
        ) from error

    return {
        "status": "ok",
        "service": APP_NAME,
        "database": "ok",
    }


@app.get("/api/features", include_in_schema=False)
def public_feature_status(connection=Depends(get_database)):
    overrides = {row["feature_key"]: bool(row["enabled"]) for row in connection.execute(
        "SELECT feature_key, enabled FROM admin_feature_flags"
    ).fetchall()}
    return {"features": {key: overrides.get(key, True) for key in FEATURES}}


@app.get("/api/status", include_in_schema=False)
def legacy_health():
    from server import face_database
    health_check()
    counts = face_database.counts()
    return {"status": "online", "database": face_database.backend,
            "registered_faces_count": counts["people"], "registered_samples_count": counts["samples"]}


@app.get("/", include_in_schema=False)
def frontend_index() -> FileResponse:
    """Serve giao diện và API cùng một cổng để chạy local đơn giản hơn."""
    return FileResponse(PROJECT_ROOT / "frontend" / "index.html")


@app.get("/index.html", include_in_schema=False)
def index_alias():
    return frontend_index()


@app.get("/visionface.html", include_in_schema=False)
@app.get("/real_time_face_landmark_liveness_tracker.html", include_in_schema=False)
def integrated_face_lab():
    return RedirectResponse("/#face-lab", status_code=303)


@app.get("/login.html", include_in_schema=False)
def login_page():
    return FileResponse(PROJECT_ROOT / "login.html")


@app.get("/account.html", include_in_schema=False)
def legacy_page(request: Request):
    name = request.url.path.rsplit("/", 1)[-1]
    html = (PROJECT_ROOT / name).read_text(encoding="utf-8")
    html = html.replace('"assets/', '"/legacy-assets/')
    html = html.replace("<head>", '<head><script>window.VISIONFACE_API_PREFIX="/api/vision";</script>', 1)
    html = html.replace("</head>", '<link rel="stylesheet" href="/legacy-assets/integration.css"><script defer src="/legacy-assets/integration.js"></script></head>', 1)
    return HTMLResponse(html)


@app.get("/manage", include_in_schema=False)
def owner_management(request: Request, connection=Depends(get_database)):
    try:
        user = get_current_user(request, connection)
    except HTTPException as error:
        if error.status_code == 401:
            return RedirectResponse("/admin-login.html?next=%2Fmanage", status_code=303)
        if error.status_code == 403:
            return RedirectResponse("/account.html?next=%2Fmanage", status_code=303)
        raise
    if user["role"] != "admin":
        return RedirectResponse("/admin-login.html?next=%2Fmanage", status_code=303)
    return FileResponse(PROJECT_ROOT / "frontend" / "manage.html")


@app.get("/admin.html", include_in_schema=False)
def retired_admin_page():
    return RedirectResponse("/manage", status_code=303)


@app.get("/admin-login.html", include_in_schema=False)
def admin_login_page():
    return FileResponse(PROJECT_ROOT / "frontend" / "admin-login.html")


@app.get("/admin/login", include_in_schema=False)
def admin_login_alias():
    return RedirectResponse("/admin-login.html", status_code=303)


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PATCH", "DELETE", "HEAD"], include_in_schema=False)
def unknown_api(path: str):
    raise HTTPException(404, "Không tìm thấy API.")


app.mount("/legacy-assets", StaticFiles(directory=PROJECT_ROOT / "assets"), name="visionface-assets")


# Mount sau các API route để các đường dẫn /api/* vẫn được ưu tiên.
app.mount(
    "/",
    StaticFiles(directory=PROJECT_ROOT / "frontend", html=True),
    name="frontend",
)
