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
    prepare_session,
    set_session_cookies,
)
from backend.settings import SESSION_COOKIE_NAME
from backend.identity import delete_user_account, ensure_legacy_account, legacy_auth, linked_account, login_legacy, login_limiter, register_user_account
from backend.transactions import identity_transaction


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
        account = register_user_account(
            connection, user_id, payload.email, hash_password(payload.password), created_at,
            payload.display_name, response,
        )
    except sqlite3.IntegrityError as error:
        if connection.execute("SELECT id FROM users WHERE email = ?", (payload.email,)).fetchone():
            raise HTTPException(status_code=409, detail="Email này đã được sử dụng.") from error
        raise

    return _public_user({"id": user_id, "email": payload.email, "created_at": created_at,
                         "display_name": account["display_name"], "role": account["role"]})


@router.post("/login", response_model=PublicUser)
def login(
    payload: LoginRequest,
    response: Response,
    request: Request,
    connection: sqlite3.Connection = Depends(get_database),
) -> PublicUser:
    return _login(payload, response, request, connection)


@router.post("/admin/login", response_model=PublicUser)
def admin_login(
    payload: LoginRequest,
    response: Response,
    request: Request,
    connection: sqlite3.Connection = Depends(get_database),
) -> PublicUser:
    return _login(payload, response, request, connection, required_role="admin")


def _login(payload, response, request, connection, required_role=None):
    login_limiter.check(request.client.host if request.client else "local")
    row = connection.execute(
        "SELECT id, email, password_hash, created_at FROM users WHERE email = ?",
        (payload.email,),
    ).fetchone()
    if row is None or not verify_password(payload.password, row["password_hash"]):
        username = payload.email
        if row is not None:
            link = connection.execute("SELECT account_id FROM legacy_account_links WHERE user_id = ?", (row["id"],)).fetchone()
            if link:
                account = legacy_auth().account(link["account_id"])
                if account:
                    username = account["username"]
        if "@" in username:
            raise HTTPException(status_code=401, detail="Email hoặc mật khẩu chưa chính xác.")
        row = login_legacy(connection, username, payload.password, required_role)
        if "@" in payload.email:
            connection.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(payload.password), row["id"]))
            connection.commit()

    account = linked_account(connection, row["id"]) if required_role else ensure_legacy_account(connection, row)
    if required_role and (not account or account["role"] != required_role):
        raise HTTPException(401, "Tài khoản hoặc mật khẩu quản trị chưa chính xác.")
    public = dict(row)
    if account:
        public.update(display_name=account["display_name"], role=account["role"], must_change_password=account["must_change_password"])

    if required_role:
        auth_store = legacy_auth()
        with identity_transaction(connection, auth_store) as legacy:
            current = legacy.execute("SELECT role, is_active, password_hash, must_change_password FROM accounts WHERE id = ?", (account["id"],)).fetchone()
            if not current or current[0] != required_role or not current[1] or current[2] != account["password_hash"]:
                raise HTTPException(401, "Tài khoản quản trị đã thay đổi. Vui lòng đăng nhập lại.")
            public["must_change_password"] = bool(current[3])
            legacy.execute("UPDATE accounts SET last_login = ? WHERE id = ?", (datetime.now(timezone.utc).isoformat(), account["id"]))
            auth_store.audit(legacy, account["id"], "account.admin_login", account["id"])
            old_token = request.cookies.get(SESSION_COOKIE_NAME)
            if old_token:
                connection.execute("DELETE FROM sessions WHERE token_hash = ?", (hashlib.sha256(old_token.encode()).hexdigest(),))
            session_token, csrf_token = prepare_session(connection, row["id"])
        set_session_cookies(response, session_token, csrf_token)
    else:
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

    delete_user_account(connection, user["id"])
    clear_session_cookies(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
