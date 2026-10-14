"""Đăng ký, đăng nhập, đăng xuất và xóa tài khoản."""

import hashlib
import sqlite3
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from backend.database import get_database
from backend.features import is_enabled
from backend.schemas import DeleteAccountRequest, LoginRequest, PublicUser, RegisterRequest
from backend.security import (
    clear_session_cookies,
    create_session,
    get_current_user,
    hash_password,
    require_csrf,
    verify_password,
)
from backend.settings import SESSION_COOKIE_NAME
from backend.identity import delete_legacy_account, ensure_legacy_account, linked_account, login_legacy, login_limiter


router = APIRouter(prefix="/api/auth", tags=["Tài khoản"])


def _public_user(row: sqlite3.Row) -> PublicUser:
    data = dict(row)
    return PublicUser(id=data["id"], email=data["email"], created_at=data["created_at"],
                      display_name=data.get("display_name", data["email"]),
                      role=data.get("role", "user"),
                      must_change_password=bool(data.get("must_change_password", False)))


@router.post("/register", response_model=PublicUser, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    response: Response,
    request: Request,
    connection: sqlite3.Connection = Depends(get_database),
) -> PublicUser:
    if not is_enabled(connection, "user_registration"):
        raise HTTPException(status_code=503, detail="Đăng ký tài khoản mới hiện đã được quản trị viên tạm dừng.")
    login_limiter.check(request.client.host if request.client else "local")
    user_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    try:
        connection.execute(
            "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (user_id, payload.email, hash_password(payload.password), created_at),
        )
        connection.commit()
    except sqlite3.IntegrityError as error:
        connection.rollback()
        raise HTTPException(status_code=409, detail="Email này đã được sử dụng.") from error

    row = connection.execute("SELECT id, email, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
    account = ensure_legacy_account(connection, row, payload.display_name)
    create_session(connection, user_id, response)
    return _public_user({**dict(row), "display_name": account["display_name"], "role": account["role"]})


@router.post("/login", response_model=PublicUser)
def login(
    payload: LoginRequest,
    response: Response,
    request: Request,
    connection: sqlite3.Connection = Depends(get_database),
) -> PublicUser:
    login_limiter.check(request.client.host if request.client else "local")
    row = connection.execute(
        "SELECT id, email, password_hash, created_at FROM users WHERE email = ?",
        (payload.email,),
    ).fetchone()
    if row is None or not verify_password(payload.password, row["password_hash"]):
        username = payload.email
        if row is not None:
            from backend.identity import legacy_auth
            link = connection.execute("SELECT account_id FROM legacy_account_links WHERE user_id = ?", (row["id"],)).fetchone()
            if link:
                account = legacy_auth().account(link["account_id"])
                if account:
                    username = account["username"]
        if "@" in username:
            raise HTTPException(status_code=401, detail="Email hoặc mật khẩu chưa chính xác.")
        row = login_legacy(connection, username, payload.password)
        if "@" in payload.email:
            connection.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(payload.password), row["id"]))
            connection.commit()

    account = ensure_legacy_account(connection, row)
    public = dict(row)
    if account:
        public.update(display_name=account["display_name"], role=account["role"], must_change_password=account["must_change_password"])

    create_session(connection, row["id"], response)
    return _public_user(public)


@router.get("/me", response_model=PublicUser)
def get_me(user: sqlite3.Row = Depends(get_current_user)) -> PublicUser:
    return _public_user(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    _csrf: None = Depends(require_csrf),
    connection: sqlite3.Connection = Depends(get_database),
) -> Response:
    raw_token = request.cookies.get(SESSION_COOKIE_NAME, "")
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
    connection.commit()
    clear_session_cookies(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    payload: DeleteAccountRequest,
    request: Request,
    response: Response,
    _csrf: None = Depends(require_csrf),
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_database),
) -> Response:
    row = connection.execute("SELECT password_hash FROM users WHERE id = ?", (user["id"],)).fetchone()
    valid = row is not None and verify_password(payload.password, row["password_hash"])
    if not valid and row is not None and row["password_hash"] == "legacy":
        from auth_store import PASSWORDS
        account = linked_account(connection, user["id"])
        try:
            valid = bool(account and PASSWORDS.verify(account["password_hash"], payload.password))
        except Exception:
            valid = False
    if not valid:
        raise HTTPException(status_code=401, detail="Mật khẩu xác nhận chưa chính xác.")

    delete_legacy_account(connection, user["id"])
    connection.execute("DELETE FROM users WHERE id = ?", (user["id"],))
    connection.commit()
    clear_session_cookies(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
