"""Mật khẩu, phiên đăng nhập và kiểm tra CSRF."""

import hashlib
import hmac
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, Response, status
from backend.database import get_database
from backend.settings import (
    COOKIE_SECURE,
    CSRF_COOKIE_NAME,
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE_SECONDS,
)


SCRYPT_N = 2**17
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_MAX_MEMORY = 256 * 1024 * 1024


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=SCRYPT_N,
        r=SCRYPT_R, p=SCRYPT_P, dklen=32, maxmem=SCRYPT_MAX_MEMORY,
    )
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, n_text, r_text, p_text, salt_hex, digest_hex = stored_hash.split("$")
        n, r, p = int(n_text), int(r_text), int(p_text)
        if algorithm != "scrypt" or n < 2**14 or n > 2**18 or r < 1 or r > 16 or p < 1 or p > 4:
            return False
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.scrypt(
            password.encode("utf-8"), salt=bytes.fromhex(salt_hex),
            n=n, r=r, p=p, dklen=len(expected), maxmem=SCRYPT_MAX_MEMORY,
        )
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def _hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(
    connection: sqlite3.Connection,
    user_id: str,
    response: Response,
) -> None:
    """Lưu mã phiên đã băm; gửi mã gốc cho trình duyệt bằng cookie an toàn."""
    session_token = secrets.token_urlsafe(32)
    csrf_token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=SESSION_MAX_AGE_SECONDS)

    connection.execute(
        """
        INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            _hash_session_token(session_token),
            user_id,
            csrf_token,
            now.isoformat(),
            expires_at.isoformat(),
        ),
    )
    connection.commit()

    common = {
        "max_age": SESSION_MAX_AGE_SECONDS,
        "secure": COOKIE_SECURE,
        "samesite": "strict",
        "path": "/",
    }
    response.set_cookie(
        SESSION_COOKIE_NAME,
        session_token,
        httponly=True,
        **common,
    )
    response.set_cookie(
        CSRF_COOKIE_NAME,
        csrf_token,
        httponly=False,
        **common,
    )


def clear_session_cookies(response: Response) -> None:
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        path="/",
        secure=COOKIE_SECURE,
        httponly=True,
        samesite="strict",
    )
    response.delete_cookie(
        CSRF_COOKIE_NAME,
        path="/",
        secure=COOKIE_SECURE,
        httponly=False,
        samesite="strict",
    )


def get_current_user(
    request: Request,
    connection: sqlite3.Connection = Depends(get_database),
) -> sqlite3.Row:
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Vui lòng đăng nhập.")

    session = connection.execute(
        """
        SELECT users.id, users.email, users.created_at
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?
        """,
        (_hash_session_token(session_token), datetime.now(timezone.utc).isoformat()),
    ).fetchone()
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Phiên đã hết hạn. Vui lòng đăng nhập lại.")
    from backend.identity import linked_account
    account = linked_account(connection, session["id"])
    user = dict(session)
    user.update(display_name=account["display_name"] if account else user["email"],
                role=account["role"] if account else "user",
                account_id=account["id"] if account else None,
                must_change_password=bool(account and account["must_change_password"]))
    password_routes = {"/api/auth/me", "/api/auth/logout", "/api/vision/auth/me",
                       "/api/vision/auth/logout", "/api/vision/auth/password"}
    if user["must_change_password"] and request.url.path not in password_routes:
        raise HTTPException(403, "Bạn cần đổi mật khẩu tại /account.html trước khi sử dụng.")
    return user


def require_csrf(
    request: Request,
    _user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_database),
) -> None:
    session_token = request.cookies.get(SESSION_COOKIE_NAME, "")
    cookie_token = request.cookies.get(CSRF_COOKIE_NAME, "")
    header_token = request.headers.get("X-CSRF-Token", "")
    if not cookie_token or not header_token or not hmac.compare_digest(cookie_token, header_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Mã bảo vệ yêu cầu không hợp lệ.")

    session = connection.execute(
        "SELECT csrf_token FROM sessions WHERE token_hash = ?",
        (_hash_session_token(session_token),),
    ).fetchone()
    if session is None or not hmac.compare_digest(session["csrf_token"], header_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Mã bảo vệ yêu cầu không hợp lệ.")


def latest_consent(
    connection: sqlite3.Connection,
    user_id: str,
    purpose: str,
) -> bool:
    row = connection.execute(
        """
        SELECT granted FROM user_consents
        WHERE user_id = ? AND purpose = ?
        ORDER BY created_at DESC, id DESC LIMIT 1
        """,
        (user_id, purpose),
    ).fetchone()
    return bool(row and row["granted"])


def require_consent(
    connection: sqlite3.Connection,
    user_id: str,
    purpose: str,
) -> None:
    if not latest_consent(connection, user_id, purpose):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Bạn cần đồng ý với mục đích {purpose} trước khi dùng tính năng này.",
        )
