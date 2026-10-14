"""Owner administration for all project data through the unified backend."""

import re
import secrets
import zipfile

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from backend.database import get_database
from backend.features import FEATURES, is_enabled
from backend.identity import delete_legacy_account, ensure_legacy_account, legacy_auth, project_account, revoke_linked_sessions
from backend.security import get_current_user, require_csrf
from backend.settings import AURAMAXX_DB_BACKEND, PROJECT_ROOT, SUPABASE_DATABASE_URL
from database_config import load_settings


def require_admin(user=Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(403, "Chỉ quản trị viên được quản lý dữ liệu.")
    return user


def require_central(user=Depends(require_admin)):
    if legacy_auth().central_admin_id() != user["account_id"]:
        raise HTTPException(403, "Thao tác này chỉ dành cho admin trung tâm.")
    return user


router = APIRouter(prefix="/api/manage", tags=["Quản trị của chủ dự án"], dependencies=[Depends(require_admin)])


class AccountCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    display_name: str = Field(min_length=1, max_length=120)
    role: str = "user"


class AccountProfile(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    display_name: str = Field(min_length=1, max_length=120)


class AccountStatus(BaseModel):
    is_active: bool


class AccountRole(BaseModel):
    role: str


class FeatureUpdate(BaseModel):
    enabled: bool


class PasswordReset(BaseModel):
    temporary_password: str | None = Field(default=None, min_length=12, max_length=128)


class PersonUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    account_id: str | None = None


@router.get("/status")
def status(user=Depends(require_admin), connection=Depends(get_database)):
    config = load_settings(PROJECT_ROOT)
    auth = legacy_auth()
    server_name, database_name = config.get("server", "Máy hiện tại"), config.get("database", "SQLite")
    if AURAMAXX_DB_BACKEND == "postgres":
        from psycopg.conninfo import conninfo_to_dict
        server_name = "Supabase PostgreSQL"
        database_name = conninfo_to_dict(SUPABASE_DATABASE_URL).get("dbname", "postgres")
    admins = [account for account in auth.admin_accounts() if account["role"] == "admin"]
    return {"application_database": AURAMAXX_DB_BACKEND, "face_database": auth.faces.backend,
            "server": server_name, "database": database_name,
            "counts": {table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                       for table in ("users", "habit_entries", "ai_conversations", "arena_bot_matches")},
            "faces": auth.faces.counts(), "old_management_enabled": False,
            "central_admin_id": auth.central_admin_id(), "is_central": user["account_id"] == auth.central_admin_id(),
            "admin_count": len(admins), "admin_limit": 3}


@router.get("/accounts")
def accounts(connection=Depends(get_database)):
    mapped = {row["account_id"]: dict(row) for row in connection.execute(
        """SELECT l.account_id, u.id AS user_id, u.email,
        (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS session_count
        FROM legacy_account_links l JOIN users u ON u.id = l.user_id""").fetchall()}
    result = []
    for account in legacy_auth().admin_accounts():
        data = {**account, **mapped.get(account["id"], {})}
        if data.get("email", "").endswith("@legacy.auramaxx.local"):
            data["email"] = ""
        result.append(data)
    central_id = legacy_auth().central_admin_id()
    for account in result:
        account["is_central"] = account["id"] == central_id
    return {"accounts": result}


@router.post("/accounts", status_code=201, dependencies=[Depends(require_csrf)])
def create_account(payload: AccountCreate, user=Depends(require_admin), connection=Depends(get_database)):
    if payload.role == "admin" and legacy_auth().central_admin_id() != user["account_id"]:
        raise HTTPException(403, "Chỉ admin trung tâm được tạo admin bổ sung.")
    actor = ensure_legacy_account(connection, user)
    password = secrets.token_urlsafe(18)
    account = legacy_auth().create_account(payload.username, payload.display_name, password,
                                         role=payload.role, force_change=True, actor_id=actor["id"])
    project_account(connection, account)
    return {"account": account, "temporary_password": password}


@router.patch("/accounts/{account_id}", dependencies=[Depends(require_csrf)])
def update_account(account_id: str, payload: AccountProfile, user=Depends(require_admin), connection=Depends(get_database)):
    actor = ensure_legacy_account(connection, user)
    if account_id == legacy_auth().central_admin_id():
        raise HTTPException(403, "Hồ sơ admin trung tâm được quản lý trong phần Tài khoản.")
    target = legacy_auth().account(account_id)
    if target and target["role"] == "admin" and actor["id"] != legacy_auth().central_admin_id():
        raise HTTPException(403, "Chỉ admin trung tâm được sửa tài khoản admin khác.")
    legacy_auth().update_account(actor["id"], account_id, payload.username, payload.display_name)
    revoke_linked_sessions(connection, account_id)
    return {"success": True}


@router.post("/accounts/{account_id}/status", dependencies=[Depends(require_csrf)])
def account_status(account_id: str, payload: AccountStatus, user=Depends(require_admin), connection=Depends(get_database)):
    actor = ensure_legacy_account(connection, user)
    target = legacy_auth().account(account_id)
    if target and target["role"] == "admin" and (actor["id"] != legacy_auth().central_admin_id() or target["id"] == legacy_auth().central_admin_id()):
        raise HTTPException(403, "Chỉ admin trung tâm được quản lý admin phụ; không thể khóa admin trung tâm.")
    legacy_auth().set_active(actor["id"], account_id, payload.is_active)
    revoke_linked_sessions(connection, account_id)
    return {"success": True}


@router.post("/accounts/{account_id}/reset-password", dependencies=[Depends(require_csrf)])
def reset_password(account_id: str, payload: PasswordReset, user=Depends(require_admin), connection=Depends(get_database)):
    actor = ensure_legacy_account(connection, user)
    target = legacy_auth().account(account_id)
    if target and target["role"] == "admin" and (actor["id"] != legacy_auth().central_admin_id() or target["id"] == legacy_auth().central_admin_id()):
        raise HTTPException(403, "Chỉ admin trung tâm được đặt lại mật khẩu admin phụ.")
    password = legacy_auth().reset_user_password(actor["id"], account_id, payload.temporary_password)
    revoke_linked_sessions(connection, account_id)
    return {"temporary_password": password}


@router.post("/accounts/{account_id}/revoke-sessions", dependencies=[Depends(require_csrf)])
def revoke_sessions(account_id: str, user=Depends(require_admin), connection=Depends(get_database)):
    actor = ensure_legacy_account(connection, user)
    target = legacy_auth().account(account_id)
    if target and target["role"] == "admin" and (actor["id"] != legacy_auth().central_admin_id() or target["id"] == legacy_auth().central_admin_id()):
        raise HTTPException(403, "Chỉ admin trung tâm được thu hồi phiên admin phụ.")
    legacy_auth().revoke_user_sessions(actor["id"], account_id)
    revoke_linked_sessions(connection, account_id)
    return {"success": True}


@router.delete("/accounts/{account_id}", dependencies=[Depends(require_csrf)])
def delete_account(account_id: str, user=Depends(require_admin), connection=Depends(get_database)):
    actor = ensure_legacy_account(connection, user)
    account = legacy_auth().account(account_id)
    if account is None:
        raise HTTPException(404, "Không tìm thấy tài khoản.")
    if account["role"] == "admin" or actor["id"] == account_id:
        raise HTTPException(403, "Không xóa tài khoản quản trị qua thao tác này; có thể khóa tài khoản nếu còn admin khác.")
    link = connection.execute("SELECT user_id FROM legacy_account_links WHERE account_id = ?", (account_id,)).fetchone()
    if link is None:
        project_account(connection, account)
        link = connection.execute("SELECT user_id FROM legacy_account_links WHERE account_id = ?", (account_id,)).fetchone()
    delete_legacy_account(connection, link["user_id"])
    connection.execute("DELETE FROM users WHERE id = ?", (link["user_id"],))
    connection.commit()
    return {"success": True}


@router.patch("/accounts/{account_id}/role", dependencies=[Depends(require_csrf)])
def update_account_role(account_id: str, payload: AccountRole, user=Depends(require_central), connection=Depends(get_database)):
    if payload.role not in {"admin", "user"}:
        raise HTTPException(422, "Quyền tài khoản không hợp lệ.")
    auth = legacy_auth()
    if account_id == auth.central_admin_id():
        raise HTTPException(403, "Không thể thay đổi quyền admin trung tâm.")
    with auth.faces._connect() as legacy:
        auth.write_lock(legacy)
        target = legacy.execute("SELECT role FROM accounts WHERE id = ?", (account_id,)).fetchone()
        if not target:
            raise HTTPException(404, "Không tìm thấy tài khoản.")
        if target[0] != payload.role and payload.role == "admin":
            count = legacy.execute("SELECT COUNT(*) FROM accounts WHERE role = 'admin'").fetchone()[0]
            if count >= 3:
                raise HTTPException(409, "Đã đạt giới hạn tối đa 3 admin.")
        legacy.execute("UPDATE accounts SET role = ? WHERE id = ?", (payload.role, account_id))
        auth.audit(legacy, user["account_id"], "account.role_changed", account_id)
        if payload.role != "admin":
            legacy.execute("DELETE FROM auth_sessions WHERE account_id = ?", (account_id,))
    revoke_linked_sessions(connection, account_id)
    return {"success": True}


@router.get("/features")
def features(connection=Depends(get_database)):
    return {"features": [{"key": key, "name": name, "enabled": is_enabled(connection, key)} for key, name in FEATURES.items()]}


@router.patch("/features/{feature_key}", dependencies=[Depends(require_csrf)])
def update_feature(feature_key: str, payload: FeatureUpdate, _user=Depends(require_central), connection=Depends(get_database)):
    if feature_key not in FEATURES:
        raise HTTPException(404, "Tính năng không tồn tại.")
    updated = connection.execute(
        "UPDATE admin_feature_flags SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE feature_key = ?",
        (int(payload.enabled), feature_key),
    )
    if updated.rowcount == 0:
        connection.execute(
            "INSERT INTO admin_feature_flags (feature_key, enabled, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
            (feature_key, int(payload.enabled)),
        )
    connection.commit()
    auth = legacy_auth()
    with auth.faces._connect() as legacy:
        auth.audit(legacy, _user["account_id"], "feature.enabled" if payload.enabled else "feature.disabled", feature_key)
    return {"key": feature_key, "enabled": payload.enabled}


@router.get("/people")
def people():
    return {"people": legacy_auth().admin_people()}


@router.get("/people/{person_id}")
def person(person_id: str):
    return legacy_auth().person_detail(person_id)


@router.patch("/people/{person_id}", dependencies=[Depends(require_csrf)])
def update_person(person_id: str, payload: PersonUpdate, user=Depends(require_admin), connection=Depends(get_database)):
    actor = ensure_legacy_account(connection, user)
    legacy_auth().update_person(actor["id"], person_id, payload.name, payload.account_id)
    return {"success": True}


@router.delete("/people/{person_id}", dependencies=[Depends(require_csrf)])
def delete_person(person_id: str, user=Depends(require_admin), connection=Depends(get_database)):
    actor = ensure_legacy_account(connection, user)
    if not legacy_auth().faces.delete_person(person_id, actor_id=actor["id"]):
        raise HTTPException(404, "Không tìm thấy hồ sơ.")
    return {"success": True}


@router.get("/audit")
def audit():
    return {"events": legacy_auth().logs()}


@router.get("/data/{table}")
def application_data(table: str, connection=Depends(get_database)):
    order_by = {
        "habit_entries": "created_at", "user_consents": "created_at", "ai_conversations": "updated_at",
        "ai_messages": "created_at", "ai_request_limits": "created_at", "arena_profiles": "updated_at",
        "arena_matches": "created_at", "arena_match_participants": "match_id", "arena_elo_history": "created_at",
        "arena_achievements": "awarded_at", "arena_bot_profiles": "updated_at", "arena_bot_matches": "created_at",
    }
    if table not in order_by:
        raise HTTPException(404, "Loại dữ liệu không được hỗ trợ.")
    records = connection.execute(f"SELECT * FROM {table} ORDER BY {order_by[table]} DESC LIMIT 100").fetchall()
    return {"records": [dict(row) for row in records]}


@router.delete("/data/{table}/{record_id}", dependencies=[Depends(require_csrf)])
def delete_application_record(table: str, record_id: str, _user=Depends(require_admin), connection=Depends(get_database)):
    allowed = {
        "habit_entries": ("id", "Nhật ký sức khỏe"), "user_consents": ("id", "lịch sử đồng ý"),
        "ai_conversations": ("id", "hội thoại AI"), "ai_messages": ("id", "tin nhắn AI"),
        "ai_request_limits": ("id", "giới hạn yêu cầu AI"), "arena_profiles": ("user_id", "hồ sơ Arena"),
        "arena_matches": ("id", "trận Arena"), "arena_elo_history": ("id", "lịch sử ELO"),
        "arena_bot_profiles": ("user_id", "hồ sơ BOT"), "arena_bot_matches": ("id", "trận đấu BOT"),
        "arena_match_participants": (None, "người tham gia trận Arena"), "arena_achievements": (None, "thành tích Arena"),
    }
    if table not in allowed:
        raise HTTPException(404, "Loại dữ liệu không được hỗ trợ.")
    key, label = allowed[table]
    if table in {"arena_match_participants", "arena_achievements"}:
        left, separator, right = record_id.partition("|")
        if not separator:
            raise HTTPException(422, "Mã bản ghi không hợp lệ.")
        keys = ("match_id", "user_id") if table == "arena_match_participants" else ("user_id", "achievement_key")
        result = connection.execute(f"DELETE FROM {table} WHERE {keys[0]} = ? AND {keys[1]} = ?", (left, right))
    else:
        result = connection.execute(f"DELETE FROM {table} WHERE {key} = ?", (record_id,))
    if result.rowcount == 0:
        raise HTTPException(404, "Không tìm thấy bản ghi.")
    connection.commit()
    auth = legacy_auth()
    with auth.faces._connect() as legacy:
        auth.audit(legacy, _user["account_id"], "application_data.deleted", f"{table}:{record_id}")
    return {"success": True, "deleted": label}


@router.post("/backups", status_code=201, dependencies=[Depends(require_csrf)])
def backup():
    from backend.data_handoff import export_current
    folder, manifest = export_current()
    archive = folder / "project-data.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zipped:
        for name in ("manifest.json", "visionface.json", "auramaxx.json"):
            zipped.write(folder / name, name)
    return {"id": folder.name, "path": str(folder), "verified": True,
            "download": "/api/manage/backups/" + folder.name + "/download"}


@router.get("/backups/{backup_id}/download")
def download_backup(backup_id: str):
    if not re.fullmatch(r"owner-handoff-\d{8}T\d{12}Z", backup_id):
        raise HTTPException(404, "Không tìm thấy bản sao lưu.")
    folder = (PROJECT_ROOT / "backups" / backup_id).resolve()
    if not folder.is_relative_to((PROJECT_ROOT / "backups").resolve()) or not (folder / "project-data.zip").is_file():
        raise HTTPException(404, "Không tìm thấy bản sao lưu.")
    return FileResponse(folder / "project-data.zip", filename=backup_id + ".zip", media_type="application/zip")
