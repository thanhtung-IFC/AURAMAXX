"""Link AURAMAXX sessions to existing VisionFace accounts without moving face data."""

import hashlib
import secrets
import uuid

from fastapi import HTTPException

from auth_store import AuthError, AuthStore, LoginLimiter


login_limiter = LoginLimiter(limit=60)


def legacy_auth() -> AuthStore:
    # Import after settings have loaded .env. Keep the established DB adapters.
    from server import face_database
    return AuthStore(face_database)


def initialize_legacy() -> None:
    auth = legacy_auth()
    auth.faces.initialize()
    auth.initialize()


def linked_account(connection, user_id):
    link = connection.execute(
        "SELECT account_id, credential_hash FROM legacy_account_links WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if link is None:
        return None
    auth = legacy_auth()
    with auth.faces._connect() as legacy:
        rows = auth.rows(legacy.execute("SELECT * FROM accounts WHERE id = ?", (link["account_id"],)))
    if not rows or not rows[0]["is_active"]:
        raise HTTPException(401, "Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên.")
    account = rows[0]
    fingerprint = hashlib.sha256(account["password_hash"].encode()).hexdigest()
    if not secrets.compare_digest(link["credential_hash"], fingerprint):
        raise HTTPException(401, "Mật khẩu đã thay đổi. Vui lòng đăng nhập lại.")
    return account


def save_link(connection, user_id, account_id):
    auth = legacy_auth()
    with auth.faces._connect() as legacy:
        row = legacy.execute("SELECT password_hash FROM accounts WHERE id = ?", (account_id,)).fetchone()
    fingerprint = hashlib.sha256(row[0].encode()).hexdigest()
    previous = connection.execute("SELECT credential_hash FROM legacy_account_links WHERE user_id = ?", (user_id,)).fetchone()
    if previous and previous["credential_hash"] != fingerprint:
        connection.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    if previous:
        connection.execute("UPDATE legacy_account_links SET credential_hash = ? WHERE user_id = ?", (fingerprint, user_id))
    else:
        connection.execute("INSERT INTO legacy_account_links (user_id, account_id, credential_hash) VALUES (?, ?, ?)", (user_id, account_id, fingerprint))
    connection.commit()


def ensure_legacy_account(connection, user, display_name=None):
    account = linked_account(connection, user["id"])
    if account:
        return account
    # Stable private username: email accounts authenticate only through AURAMAXX.
    username = "aura_" + uuid.UUID(user["id"]).hex
    auth = legacy_auth()
    try:
        account = auth.create_account(username, display_name or user["email"][:120], secrets.token_urlsafe(48))
    except AuthError as error:
        if error.status != 409:
            raise
        with auth.faces._connect() as legacy:
            account_id = legacy.execute("SELECT id FROM accounts WHERE username = ?", (username,)).fetchone()[0]
        account = auth.account(account_id)
    save_link(connection, user["id"], account["id"])
    return linked_account(connection, user["id"])


def login_legacy(connection, username, password, role=None):
    auth = legacy_auth()
    if role is None:
        with auth.faces._connect() as legacy:
            row = legacy.execute("SELECT role FROM accounts WHERE username = ?", (username.lower(),)).fetchone()
        role = row[0] if row else "user"
    try:
        _token, session = auth.login(username, password, role)
    except AuthError as error:
        raise HTTPException(error.status, str(error)) from error
    # The new session is authoritative; don't retain an extra legacy cookie/session.
    auth.logout(session)
    return project_account(connection, auth.account(session["id"]))


def project_account(connection, account):
    """Attach an existing local account to app data without creating a login."""
    link = connection.execute("SELECT user_id FROM legacy_account_links WHERE account_id = ?", (account["id"],)).fetchone()
    if link:
        user_id = link["user_id"]
    else:
        user_id = str(uuid.uuid5(uuid.NAMESPACE_URL, "visionface:" + account["id"]))
        connection.execute(
            "INSERT OR IGNORE INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (user_id, account["id"] + "@legacy.auramaxx.local", "legacy", account["created_at"]),
        )
    save_link(connection, user_id, account["id"])
    return connection.execute("SELECT id, email, created_at FROM users WHERE id = ?", (user_id,)).fetchone()


def revoke_linked_sessions(connection, account_id):
    connection.execute(
        "DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM legacy_account_links WHERE account_id = ?)",
        (account_id,),
    )
    connection.commit()


def delete_legacy_account(connection, user_id):
    account = linked_account(connection, user_id)
    if account is None:
        return
    auth = legacy_auth()
    if account["role"] == "admin":
        raise HTTPException(403, "Tài khoản quản trị được quản lý qua công cụ quản trị.")
    for person_id in auth.owned_ids(account["id"]):
        auth.faces.delete_person(person_id, actor_id=account["id"], access_account_id=account["id"])
    with auth.faces._connect() as legacy:
        legacy.execute("DELETE FROM accounts WHERE id = ?", (account["id"],))
