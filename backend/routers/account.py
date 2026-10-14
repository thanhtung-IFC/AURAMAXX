"""Personal account controls; every query is scoped to the signed-in owner."""

import hashlib
import json
import unicodedata
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.database import get_database
from backend.identity import ensure_legacy_account, legacy_auth
from backend.routers.consents import list_consents
from backend.security import clear_session_cookies, get_current_user, require_csrf
from backend.settings import SESSION_COOKIE_NAME
from backend.transactions import identity_transaction


router = APIRouter(prefix="/api/account", tags=["Cài đặt cá nhân"])


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str = Field(min_length=1, max_length=120)

    @field_validator("display_name")
    @classmethod
    def clean_name(cls, value):
        value = " ".join(unicodedata.normalize("NFC", value).split())
        if not value or any(unicodedata.category(char).startswith("C") for char in value):
            raise ValueError("Tên hiển thị không hợp lệ.")
        return value


def _token_hash(request):
    return hashlib.sha256(request.cookies.get(SESSION_COOKIE_NAME, "").encode()).hexdigest()


def _session_id(token_hash):
    # A public identifier must never be the credential used to authenticate.
    return hashlib.sha256(("account-session:" + token_hash).encode()).hexdigest()


def _sessions(connection, user_id, current_hash):
    rows = connection.execute(
        "SELECT token_hash, created_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC",
        (user_id, datetime.now(timezone.utc).isoformat()),
    ).fetchall()
    return [{"id": _session_id(row["token_hash"]), "current": row["token_hash"] == current_hash,
             "created_at": row["created_at"], "expires_at": row["expires_at"]} for row in rows]


def _profile(user, account):
    return {"id": user["id"], "display_name": account["display_name"],
            "email": None if user["email"].endswith("@legacy.auramaxx.local") else user["email"],
            "username": account["username"] if user["email"].endswith("@legacy.auramaxx.local") else None,
            "role": account["role"], "created_at": user["created_at"]}


@router.get("/settings")
def settings(request: Request, user=Depends(get_current_user), connection=Depends(get_database)):
    account = ensure_legacy_account(connection, user)
    return {"profile": _profile(user, account),
            "consents": [record.model_dump() for record in list_consents(user, connection)],
            "sessions": _sessions(connection, user["id"], _token_hash(request))}


@router.patch("/profile")
def update_profile(payload: ProfileUpdate, user=Depends(get_current_user),
                   _csrf=Depends(require_csrf), connection=Depends(get_database)):
    account = ensure_legacy_account(connection, user)
    auth = legacy_auth()
    with identity_transaction(connection, auth) as legacy:
        legacy.execute("UPDATE accounts SET display_name = ? WHERE id = ?", (payload.display_name, account["id"]))
        auth.audit(legacy, account["id"], "account.profile_updated", account["id"])
    return {"display_name": payload.display_name}


@router.post("/sessions/revoke-others")
def revoke_others(request: Request, user=Depends(get_current_user),
                  _csrf=Depends(require_csrf), connection=Depends(get_database)):
    # Existing VisionFace sessions also grant access; revoke them in the same commit.
    auth = legacy_auth()
    with identity_transaction(connection, auth) as legacy:
        connection.execute("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?", (user["id"], _token_hash(request)))
        if user["account_id"]:
            legacy.execute("DELETE FROM auth_sessions WHERE account_id = ?", (user["account_id"],))
            auth.audit(legacy, user["account_id"], "account.other_sessions_revoked", user["account_id"])
    return {"sessions": _sessions(connection, user["id"], _token_hash(request))}


@router.delete("/sessions/{session_id}")
def revoke_session(session_id: str, request: Request, response: Response, user=Depends(get_current_user),
                   _csrf=Depends(require_csrf), connection=Depends(get_database)):
    rows = connection.execute("SELECT token_hash FROM sessions WHERE user_id = ?", (user["id"],)).fetchall()
    target = next((row["token_hash"] for row in rows if _session_id(row["token_hash"]) == session_id), None)
    if target is None:
        raise HTTPException(404, "Phiên đăng nhập không còn tồn tại.")
    connection.execute("DELETE FROM sessions WHERE user_id = ? AND token_hash = ?", (user["id"], target))
    connection.commit()
    current = target == _token_hash(request)
    if current:
        clear_session_cookies(response)
    return {"signed_out": current, "sessions": [] if current else _sessions(connection, user["id"], _token_hash(request))}


@router.get("/export")
def export_data(user=Depends(get_current_user), connection=Depends(get_database)):
    account = ensure_legacy_account(connection, user)
    # Explicit fields prevent credentials or future private columns leaking into exports.
    fields = {
        "user_consents": "id, purpose, granted, policy_version, created_at",
        "habit_entries": "id, category, value, unit, note, recorded_at, created_at",
        "health_routines": "state_json, revision, updated_at",
        "ai_conversations": "id, title, created_at, updated_at",
        "arena_profiles": "display_name, leaderboard_public, elo, highest_elo, matches_played, wins, losses, draws, created_at, updated_at",
        "arena_bot_profiles": "elo, highest_elo, matches_played, wins, losses, draws, updated_at",
        "arena_bot_matches": "id, bot_id, result, player_score, bot_score, bot_elo, elo_before, elo_after, coverage, created_at",
        "arena_match_participants": "match_id, result, elo_before, elo_after",
        "arena_elo_history": "id, match_id, elo_before, elo_after, created_at",
        "arena_achievements": "achievement_key, awarded_at",
    }
    auth = legacy_auth()
    with identity_transaction(connection, auth) as legacy:
        data = {table: [dict(row) for row in connection.execute(
            f"SELECT {columns} FROM {table} WHERE user_id = ?", (user["id"],)).fetchall()]
            for table, columns in fields.items()}
        for routine in data["health_routines"]:
            routine["state"] = json.loads(routine.pop("state_json"))
        data["ai_messages"] = [dict(row) for row in connection.execute(
            "SELECT m.id, m.conversation_id, m.role, m.content, m.created_at FROM ai_messages m JOIN ai_conversations c ON c.id = m.conversation_id WHERE c.user_id = ?",
            (user["id"],)).fetchall()]
        data["arena_matches"] = [dict(row) for row in connection.execute(
            "SELECT m.id, m.status, m.created_at, m.completed_at FROM arena_matches m JOIN arena_match_participants p ON p.match_id = m.id WHERE p.user_id = ?",
            (user["id"],)).fetchall()]
        data["face_profiles"] = auth.rows(legacy.execute(
            "SELECT p.id, p.name, p.created_at FROM people p JOIN account_people a ON a.person_id = p.id WHERE a.account_id = ?", (account["id"],)))
        auth.audit(legacy, account["id"], "account.data_exported", account["id"])
    return JSONResponse({"format_version": 1, "exported_at": datetime.now(timezone.utc).isoformat(),
                         "profile": _profile(user, account), "data": data,
                         "excluded": ["passwords", "session_tokens", "face_embeddings", "raw_images"]},
                        headers={"Content-Disposition": 'attachment; filename="my-aura-data.json"'})
