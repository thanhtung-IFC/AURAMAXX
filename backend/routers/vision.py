"""In-process compatibility layer for the tested VisionFace API.

Only HTTP input/output is adapted. Recognition, liveness and ownership
operations continue to run through VisionFaceRequestHandler and its stores.
No second listener or internal network proxy is needed.
"""

import hashlib
import io
from datetime import datetime
from email.message import Message

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool

from backend.database import get_database
from backend.features import is_enabled
from backend.identity import ensure_legacy_account, legacy_auth, login_legacy, login_limiter
from backend.security import clear_session_cookies, create_session, get_current_user, require_csrf, require_consent, verify_password, hash_password
from backend.settings import SESSION_COOKIE_NAME
from backend.services.ai_quota import reserve_request
from server import VisionFaceRequestHandler


router = APIRouter(prefix="/api/vision", tags=["VisionFace"])


class VisionAPIAdapter(VisionFaceRequestHandler):
    def __init__(self, request, path, body, session):
        self.path = "/api/" + path
        if request.url.query:
            self.path += "?" + request.url.query
        self.headers = Message()
        for key, value in request.headers.items():
            self.headers[key] = value
        if "Content-Length" in self.headers:
            self.headers.replace_header("Content-Length", str(len(body)))
        else:
            self.headers["Content-Length"] = str(len(body))
        self.client_address = (request.client.host if request.client else "local", 0)
        self.rfile, self.wfile = io.BytesIO(body), io.BytesIO()
        self._current_session = session
        self.response_status = 200
        self.response_headers = {}

    def send_response(self, code, message=None):
        self.response_status = int(code)

    def send_header(self, key, value):
        self.response_headers[key] = str(value)

    def end_headers(self):
        pass

    def send_error(self, code, message=None, explain=None):
        self._send_json({"success": False, "message": message or "Không tìm thấy API."}, code)

    def result(self):
        return Response(self.wfile.getvalue(), status_code=self.response_status, headers=self.response_headers)


def _session(request, connection, user):
    account = ensure_legacy_account(connection, user)
    token = request.cookies.get(SESSION_COOKIE_NAME, "")
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    session = connection.execute("SELECT csrf_token, expires_at FROM sessions WHERE token_hash = ?", (token_hash,)).fetchone()
    return {**account, "token_hash": token_hash, "csrf_token": session["csrf_token"],
            "expires_at": int(datetime.fromisoformat(session["expires_at"]).timestamp())}


@router.get("/auth/me")
def me(request: Request, user=Depends(get_current_user), connection=Depends(get_database)):
    session = _session(request, connection, user)
    return {"authenticated": True, "account": VisionFaceRequestHandler.public_session(session), "csrf_token": session["csrf_token"]}


@router.post("/auth/{role}/login")
def legacy_login(role: str, payload: dict, request: Request, response: Response, connection=Depends(get_database)):
    if role not in {"admin", "user"}:
        raise HTTPException(404, "Không tìm thấy API.")
    adapter = VisionAPIAdapter(request, "", b"", None)
    adapter.check_origin()
    login_limiter.check(request.client.host if request.client else "local")
    username, password = payload.get("username"), payload.get("password")
    if not isinstance(username, str) or not isinstance(password, str):
        raise HTTPException(422, "Vui lòng nhập tên đăng nhập và mật khẩu.")
    user = login_legacy(connection, username, password, role)
    create_session(connection, user["id"], response)
    account = legacy_auth().account(connection.execute("SELECT account_id FROM legacy_account_links WHERE user_id = ?", (user["id"],)).fetchone()[0])
    return {"success": True, "account": account}


@router.post("/auth/register", status_code=201)
def legacy_register(payload: dict, request: Request, connection=Depends(get_database)):
    VisionAPIAdapter(request, "", b"", None).check_origin()
    if not is_enabled(connection, "user_registration"):
        raise HTTPException(503, "Đăng ký tài khoản mới hiện đã được quản trị viên tạm dừng.")
    login_limiter.check(request.client.host if request.client else "local")
    if "role" in payload:
        raise HTTPException(400, "Không được tự chọn quyền tài khoản.")
    account = legacy_auth().create_account(payload.get("username"), payload.get("display_name"), payload.get("password"))
    return {"success": True, "account": account}


@router.post("/auth/logout")
def logout(response: Response, request: Request, user=Depends(get_current_user), _csrf=Depends(require_csrf), connection=Depends(get_database)):
    token_hash = hashlib.sha256(request.cookies.get(SESSION_COOKIE_NAME, "").encode()).hexdigest()
    connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
    connection.commit()
    clear_session_cookies(response)
    return {"success": True}


@router.post("/auth/password")
def change_password(payload: dict, request: Request, response: Response, user=Depends(get_current_user), _csrf=Depends(require_csrf), connection=Depends(get_database)):
    from auth_store import PASSWORDS
    old, new = payload.get("current_password"), payload.get("new_password")
    auth = legacy_auth()
    auth.password(new)
    if not isinstance(old, str) or old == new:
        raise HTTPException(400, "Mật khẩu mới phải khác mật khẩu hiện tại.")
    row = connection.execute("SELECT password_hash FROM users WHERE id = ?", (user["id"],)).fetchone()
    account = ensure_legacy_account(connection, user)
    if row["password_hash"] == "legacy":
        try:
            valid = PASSWORDS.verify(account["password_hash"], old)
        except Exception:
            valid = False
    else:
        valid = verify_password(old, row["password_hash"])
    if not valid:
        raise HTTPException(400, "Mật khẩu hiện tại không đúng.")
    digest = PASSWORDS.hash(new)
    app_digest = hash_password(new) if row["password_hash"] != "legacy" else "legacy"
    from backend.transactions import identity_transaction
    with identity_transaction(connection, auth) as legacy:
        current = legacy.execute("SELECT password_hash, is_active FROM accounts WHERE id = ?", (account["id"],)).fetchone()
        app_current = connection.execute("SELECT password_hash FROM users WHERE id = ?", (user["id"],)).fetchone()
        if not current or not current[1] or not app_current or current[0] != account["password_hash"] or app_current["password_hash"] != row["password_hash"]:
            raise HTTPException(409, "Mật khẩu đã thay đổi. Vui lòng đăng nhập lại.")
        legacy.execute("UPDATE accounts SET password_hash = ?, must_change_password = 0 WHERE id = ?", (digest, account["id"]))
        legacy.execute("DELETE FROM auth_sessions WHERE account_id = ?", (account["id"],))
        connection.execute("UPDATE users SET password_hash = ? WHERE id = ?", (app_digest, user["id"]))
        connection.execute("UPDATE legacy_account_links SET credential_hash = ? WHERE user_id = ?", (hashlib.sha256(digest.encode()).hexdigest(), user["id"]))
        connection.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))
        auth.audit(legacy, account["id"], "account.password_changed", account["id"])
    clear_session_cookies(response)
    return {"success": True}


async def _read_body(request):
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 12 * 1024 * 1024:
            raise HTTPException(413, "Dữ liệu gửi lên quá lớn.")
    return bytes(body)


@router.api_route("/{path:path}", methods=["GET", "POST", "DELETE"])
async def dispatch(path: str, request: Request, user=Depends(get_current_user), connection=Depends(get_database)):
    if path.startswith("admin/"):
        raise HTTPException(410, "Quản trị VisionFace cũ đã được gỡ. Sử dụng /manage.")
    if path.startswith("auth/"):
        raise HTTPException(404, "Không tìm thấy API.")
    allowed = {"status", "faces", "process", "register", "challenge/start", "challenge/reset", "analyze_face", "chat"}
    if path not in allowed:
        raise HTTPException(404, "Không tìm thấy API.")
    feature_key = "aura_ai" if path == "chat" else "face_analysis" if path in {"process", "register", "challenge/start", "challenge/reset", "analyze_face"} else None
    if feature_key and not is_enabled(connection, feature_key):
        raise HTTPException(503, "Tính năng này hiện đã được quản trị viên tạm dừng.")
    methods = {"status": {"GET"}, "faces": {"GET", "DELETE"}}
    if request.method not in methods.get(path, {"POST"}):
        raise HTTPException(405, "Phương thức không được hỗ trợ.")
    if path in {"process", "register", "challenge/start", "challenge/reset", "analyze_face"}:
        require_consent(connection, user["id"], "face_analysis")
    if path == "chat":
        require_consent(connection, user["id"], "ai_chat")
    session = await run_in_threadpool(_session, request, connection, user)
    body = await _read_body(request)
    adapter = VisionAPIAdapter(request, path, body, session)
    if path == "chat":
        adapter.reserve_chat_usage = lambda: reserve_request(connection, user["id"])
    handler = {"GET": adapter._handle_get, "POST": adapter._handle_post, "DELETE": adapter._handle_delete}[request.method]
    await run_in_threadpool(adapter._dispatch, handler)
    return adapter.result()
