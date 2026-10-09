"""Accounts, server-side sessions and face ownership for both database adapters."""

import hashlib
import re
import secrets
import threading
import time
import uuid
from collections import deque
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from face_store import FaceStore, StorageError

PASSWORDS = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
DUMMY_HASH = PASSWORDS.hash(secrets.token_urlsafe(32))
SESSION_SECONDS = 8 * 60 * 60
AUTH_SCHEMA_VERSION = "2"
MAX_ADMIN_ACCOUNTS = 3
PUBLIC_COLUMNS = "id, username, display_name, role, is_active, must_change_password, created_at, last_login"


class AuthError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class LoginLimiter:
    def __init__(self, limit=15, window=300):
        self.limit, self.window = limit, window
        self.attempts = {}
        self.lock = threading.Lock()

    def check(self, key):
        now = time.monotonic()
        with self.lock:
            for expired in [k for k, values in self.attempts.items() if not values or values[-1] <= now - self.window]:
                del self.attempts[expired]
            if len(self.attempts) >= 10000 and key not in self.attempts:
                raise AuthError("Quá nhiều yêu cầu. Vui lòng thử lại sau.", 429)
            values = self.attempts.setdefault(key, deque())
            while values and values[0] <= now - self.window:
                values.popleft()
            if len(values) >= self.limit:
                raise AuthError("Bạn thử quá nhiều lần. Vui lòng chờ 5 phút.", 429)
            values.append(now)


class AuthStore:
    def __init__(self, faces):
        self.faces = faces

    @staticmethod
    def rows(cursor):
        columns = [c[0] for c in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]

    def write_lock(self, connection):
        if self.faces.backend != "sqlite":
            self.faces._write_lock(connection)
        else:
            connection.execute("BEGIN IMMEDIATE")

    def initialize(self):
        with self.faces._connect() as connection:
            self.write_lock(connection)
            version = connection.execute("SELECT [value] FROM metadata WHERE [key] = 'auth_schema_version'").fetchone()
            if version and version[0] not in ("1", AUTH_SCHEMA_VERSION):
                raise StorageError("Unsupported authentication schema version")
            filename = "auth_schema.sql" if self.faces.backend == "sqlserver" else "auth_schema_sqlite.sql"
            if self.faces.backend == "postgres":
                filename = "auth_schema_postgres.sql"
            text = (Path(__file__).with_name("sql") / filename).read_text(encoding="utf-8")
            # SQLite executescript commits implicitly; execute statements inside our transaction instead.
            # SQL Server's IF/BEGIN blocks are separated explicitly below.
            statements = text.split(";\n") if self.faces.backend == "sqlite" else re.split(r"\n(?=IF OBJECT_ID)", text)
            if self.faces.backend == "postgres":
                statements = [text]
            for statement in statements:
                if statement.strip():
                    connection.execute(statement)
            if self.faces.backend == "postgres":
                for table in ("accounts", "account_people", "auth_sessions", "audit_logs"):
                    connection.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
            if not version:
                connection.execute("INSERT INTO metadata ([key], [value]) VALUES ('auth_schema_version', ?)", (AUTH_SCHEMA_VERSION,))
            elif version[0] != AUTH_SCHEMA_VERSION:
                connection.execute("UPDATE metadata SET [value] = ? WHERE [key] = 'auth_schema_version'", (AUTH_SCHEMA_VERSION,))

    @staticmethod
    def username(value):
        if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{3,64}", value):
            raise AuthError("Tên đăng nhập cần 3–64 ký tự: chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang.")
        return value.lower()

    @staticmethod
    def password(value):
        if not isinstance(value, str) or not 12 <= len(value) <= 128:
            raise AuthError("Mật khẩu cần từ 12 đến 128 ký tự.")
        return value

    @staticmethod
    def audit(connection, actor, action, target=None):
        connection.execute("INSERT INTO audit_logs (id, actor_id, action, target_id, created_at) VALUES (?, ?, ?, ?, ?)",
                           ("evt_" + uuid.uuid4().hex, actor, action, target, FaceStore._timestamps()[0]))

    def create_account(self, username, display_name, password, *, role="user", force_change=False, actor_id=None):
        username = self.username(username)
        display_name = FaceStore._name(display_name)
        self.password(password)
        if role not in ("admin", "user"):
            raise AuthError("Quyền tài khoản không hợp lệ.")
        hashed = PASSWORDS.hash(password)
        identifier = "acc_" + uuid.uuid4().hex
        with self.faces._connect() as connection:
            self.write_lock(connection)
            if role == "admin":
                admin_count = connection.execute("SELECT COUNT(*) FROM accounts WHERE role = 'admin'").fetchone()[0]
                if admin_count >= MAX_ADMIN_ACCOUNTS:
                    raise AuthError("Đã đạt giới hạn 3 tài khoản admin.", 409)
            if connection.execute("SELECT id FROM accounts WHERE username = ?", (username,)).fetchone():
                raise AuthError("Tên đăng nhập đã được sử dụng.", 409)
            connection.execute("""INSERT INTO accounts
                (id, username, display_name, password_hash, role, is_active, must_change_password, created_at)
                VALUES (?, ?, ?, ?, ?, 1, ?, ?)""",
                (identifier, username, display_name, hashed, role, int(force_change), FaceStore._timestamps()[0]))
            action = "account.admin_created" if role == "admin" else "account.created"
            self.audit(connection, actor_id or identifier, action, identifier)
        return self.account(identifier)

    def account(self, identifier):
        with self.faces._connect() as connection:
            rows = self.rows(connection.execute(f"SELECT {PUBLIC_COLUMNS} FROM accounts WHERE id = ?", (identifier,)))
            return rows[0] if rows else None

    def login(self, username, password, role):
        if not isinstance(password, str) or len(password) > 128:
            raise AuthError("Tên đăng nhập hoặc mật khẩu không đúng.", 401)
        try:
            username = self.username(username)
        except AuthError:
            username = ""
        with self.faces._connect() as connection:
            rows = self.rows(connection.execute("SELECT * FROM accounts WHERE username = ?", (username,)))
        account = rows[0] if rows else None
        try:
            valid = PASSWORDS.verify(account["password_hash"] if account else DUMMY_HASH, password)
        except (VerificationError, InvalidHashError):
            valid = False
        if not valid or not account or not account["is_active"] or account["role"] != role:
            raise AuthError("Tên đăng nhập hoặc mật khẩu không đúng cho khu vực này.", 401)
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with self.faces._connect() as connection:
            self.write_lock(connection)
            current = connection.execute("SELECT password_hash, is_active, username, role FROM accounts WHERE id = ?", (account["id"],)).fetchone()
            if not current or not current[1] or current[0] != account["password_hash"] or current[2] != username or current[3] != role:
                raise AuthError("Vui lòng đăng nhập lại.", 401)
            connection.execute("DELETE FROM auth_sessions WHERE expires_at <= ?", (int(time.time()),))
            connection.execute("INSERT INTO auth_sessions (token_hash, account_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)",
                               (token_hash, account["id"], csrf, int(time.time()) + SESSION_SECONDS))
            connection.execute("UPDATE accounts SET last_login = ? WHERE id = ?", (FaceStore._timestamps()[0], account["id"]))
            self.audit(connection, account["id"], "account.login", account["id"])
        return token, self.session(token)

    def session(self, token):
        if not isinstance(token, str) or not 20 <= len(token) <= 128:
            return None
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with self.faces._connect() as connection:
            rows = self.rows(connection.execute("""
                SELECT a.id, a.username, a.display_name, a.role, a.must_change_password,
                       s.csrf_token, s.token_hash, s.expires_at
                FROM auth_sessions s JOIN accounts a ON a.id = s.account_id
                WHERE s.token_hash = ? AND s.expires_at > ? AND a.is_active = 1
            """, (token_hash, int(time.time()))))
            return rows[0] if rows else None

    def logout(self, session):
        with self.faces._connect() as connection:
            connection.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (session["token_hash"],))

    def change_password(self, session, old, new):
        self.password(new)
        if not isinstance(old, str) or len(old) > 128 or old == new:
            raise AuthError("Mật khẩu mới phải khác mật khẩu hiện tại.")
        with self.faces._connect() as connection:
            row = connection.execute("SELECT password_hash FROM accounts WHERE id = ?", (session["id"],)).fetchone()
        try:
            PASSWORDS.verify(row[0], old)
        except (VerificationError, InvalidHashError):
            raise AuthError("Mật khẩu hiện tại không đúng.", 400) from None
        hashed = PASSWORDS.hash(new)
        with self.faces._connect() as connection:
            self.write_lock(connection)
            current = connection.execute("SELECT password_hash FROM accounts WHERE id = ?", (session["id"],)).fetchone()
            if current[0] != row[0]:
                raise AuthError("Mật khẩu đã thay đổi. Vui lòng đăng nhập lại.", 401)
            connection.execute("UPDATE accounts SET password_hash = ?, must_change_password = 0 WHERE id = ?", (hashed, session["id"]))
            connection.execute("DELETE FROM auth_sessions WHERE account_id = ?", (session["id"],))
            self.audit(connection, session["id"], "account.password_changed", session["id"])

    def owned_ids(self, account_id):
        with self.faces._connect() as connection:
            return {row[0] for row in connection.execute("SELECT person_id FROM account_people WHERE account_id = ?", (account_id,)).fetchall()}

    def people(self, session):
        people = self.faces.list_people()
        if session["role"] == "admin":
            return people
        allowed = self.owned_ids(session["id"])
        return [person for person in people if person["id"] in allowed]

    def require_person(self, session, person_id):
        if session["role"] != "admin" and person_id not in self.owned_ids(session["id"]):
            raise AuthError("Bạn không có quyền truy cập hồ sơ này.", 403)

    def admin_accounts(self):
        with self.faces._connect() as connection:
            return self.rows(connection.execute(f"""SELECT {PUBLIC_COLUMNS},
                (SELECT COUNT(*) FROM account_people WHERE account_id = accounts.id) AS people_count
                FROM accounts ORDER BY created_at, id"""))

    def account_detail(self, identifier):
        account = self.account(identifier)
        if not account:
            raise AuthError("Không tìm thấy tài khoản.", 404)
        with self.faces._connect() as connection:
            active_sessions = connection.execute(
                "SELECT COUNT(*) FROM auth_sessions WHERE account_id = ? AND expires_at > ?",
                (identifier, int(time.time()))).fetchone()[0]
        return {**account, "active_sessions": active_sessions,
                "people": [person for person in self.admin_people() if person["account_id"] == identifier]}

    @staticmethod
    def require_managed_account(connection, actor, identifier):
        row = connection.execute("SELECT username, role FROM accounts WHERE id = ?", (identifier,)).fetchone()
        if not row:
            raise AuthError("Không tìm thấy tài khoản.", 404)
        if identifier == actor:
            raise AuthError("Admin quản lý tài khoản cá nhân tại trang Tài khoản.", 403)
        return row

    def update_account(self, actor, identifier, username, display_name):
        username, display_name = self.username(username), FaceStore._name(display_name)
        with self.faces._connect() as connection:
            self.write_lock(connection)
            current = self.require_managed_account(connection, actor, identifier)
            if connection.execute("SELECT id FROM accounts WHERE username = ? AND id <> ?", (username, identifier)).fetchone():
                raise AuthError("Tên đăng nhập đã được sử dụng.", 409)
            connection.execute("UPDATE accounts SET username = ?, display_name = ? WHERE id = ?", (username, display_name, identifier))
            if current[0] != username:
                connection.execute("DELETE FROM auth_sessions WHERE account_id = ?", (identifier,))
            self.audit(connection, actor, "account.updated", identifier)

    def reset_user_password(self, actor, identifier, password=None):
        password = secrets.token_urlsafe(18) if password in (None, "") else self.password(password)
        hashed = PASSWORDS.hash(password)
        with self.faces._connect() as connection:
            self.write_lock(connection)
            self.require_managed_account(connection, actor, identifier)
            connection.execute("UPDATE accounts SET password_hash = ?, must_change_password = 1 WHERE id = ?", (hashed, identifier))
            connection.execute("DELETE FROM auth_sessions WHERE account_id = ?", (identifier,))
            self.audit(connection, actor, "account.password_reset", identifier)
        return password

    def revoke_user_sessions(self, actor, identifier):
        with self.faces._connect() as connection:
            self.write_lock(connection)
            self.require_managed_account(connection, actor, identifier)
            connection.execute("DELETE FROM auth_sessions WHERE account_id = ?", (identifier,))
            self.audit(connection, actor, "account.sessions_revoked", identifier)

    def admin_people(self):
        with self.faces._connect() as connection:
            return self.rows(connection.execute("""
                SELECT p.id, p.name, p.created_at, p.display_date AS date,
                       o.account_id, a.username AS owner_username, COUNT(s.id) AS sample_count
                FROM people p LEFT JOIN account_people o ON o.person_id = p.id
                LEFT JOIN accounts a ON a.id = o.account_id
                LEFT JOIN face_samples s ON s.person_id = p.id
                GROUP BY p.id, p.name, p.created_at, p.display_date, o.account_id, a.username
                ORDER BY p.created_at, p.id
            """))

    def person_detail(self, identifier):
        people = [p for p in self.admin_people() if p["id"] == identifier]
        if not people:
            raise AuthError("Không tìm thấy hồ sơ.", 404)
        with self.faces._connect() as connection:
            samples = self.rows(connection.execute("""SELECT id, person_id, feature_version, dimension,
                landmark_count, created_at FROM face_samples WHERE person_id = ? ORDER BY created_at, id""", (identifier,)))
        return {**people[0], "samples": samples}

    def update_person(self, actor, identifier, name, owner):
        name = FaceStore._name(name)
        if owner is not None and not isinstance(owner, str):
            raise AuthError("Tài khoản sở hữu không hợp lệ.")
        with self.faces._connect() as connection:
            self.write_lock(connection)
            if not connection.execute("SELECT id FROM people WHERE id = ?", (identifier,)).fetchone():
                raise AuthError("Không tìm thấy hồ sơ.", 404)
            if owner and not connection.execute("SELECT id FROM accounts WHERE id = ? AND is_active = 1", (owner,)).fetchone():
                raise AuthError("Tài khoản sở hữu không tồn tại hoặc đã bị khóa.", 400)
            connection.execute("UPDATE people SET name = ? WHERE id = ?", (name, identifier))
            connection.execute("DELETE FROM account_people WHERE person_id = ?", (identifier,))
            if owner:
                connection.execute("INSERT INTO account_people (person_id, account_id) VALUES (?, ?)", (identifier, owner))
            if self.faces.backend == "sqlite":
                FaceStore._bump_revision(connection)
            self.audit(connection, actor, "person.updated", identifier)

    def set_active(self, actor, identifier, active):
        if not isinstance(active, bool):
            raise AuthError("Trạng thái tài khoản không hợp lệ.")
        with self.faces._connect() as connection:
            self.write_lock(connection)
            row = connection.execute("SELECT role FROM accounts WHERE id = ?", (identifier,)).fetchone()
            if not row:
                raise AuthError("Không tìm thấy tài khoản.", 404)
            if not active and identifier == actor:
                raise AuthError("Không thể khóa chính tài khoản đang đăng nhập.", 400)
            if not active and row[0] == "admin":
                active_admins = connection.execute(
                    "SELECT COUNT(*) FROM accounts WHERE role = 'admin' AND is_active = 1"
                ).fetchone()[0]
                if active_admins <= 1:
                    raise AuthError("Cần giữ ít nhất một admin đang hoạt động.", 400)
            connection.execute("UPDATE accounts SET is_active = ? WHERE id = ?", (int(active), identifier))
            if not active:
                connection.execute("DELETE FROM auth_sessions WHERE account_id = ?", (identifier,))
            self.audit(connection, actor, "account.enabled" if active else "account.disabled", identifier)

    def logs(self):
        limit = "TOP (100) " if self.faces.backend == "sqlserver" else ""
        tail = " LIMIT 100" if self.faces.backend != "sqlserver" else ""
        with self.faces._connect() as connection:
            return self.rows(connection.execute(f"""SELECT {limit}l.id, a.username AS actor,
                l.action, l.target_id, l.created_at FROM audit_logs l LEFT JOIN accounts a ON a.id = l.actor_id
                ORDER BY l.created_at DESC, l.id DESC{tail}"""))
