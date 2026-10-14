"""Lưu và đọc lịch sử đồng ý cho từng mục đích sử dụng dữ liệu."""

import sqlite3
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from backend.database import get_database
from backend.schemas import ConsentRecord, ConsentRequest
from backend.security import get_current_user, require_csrf
from backend.routines import clear_face_report, lock_routine


router = APIRouter(prefix="/api/consents", tags=["Quyền riêng tư"])


@router.get("", response_model=list[ConsentRecord])
def list_consents(
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_database),
) -> list[ConsentRecord]:
    rows = connection.execute(
        """
        SELECT id, purpose, granted, policy_version, created_at
        FROM (
            SELECT id, purpose, granted, policy_version, created_at,
                ROW_NUMBER() OVER (PARTITION BY purpose ORDER BY created_at DESC, id DESC) AS rank
            FROM user_consents WHERE user_id = ?
        ) WHERE rank = 1 ORDER BY purpose
        """,
        (user["id"],),
    ).fetchall()
    return [
        ConsentRecord(
            id=row["id"], purpose=row["purpose"], granted=bool(row["granted"]),
            policy_version=row["policy_version"], created_at=row["created_at"],
        )
        for row in rows
    ]


@router.post("", response_model=ConsentRecord, status_code=201)
def record_consent(
    payload: ConsentRequest,
    _csrf: None = Depends(require_csrf),
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_database),
) -> ConsentRecord:
    record_id = str(uuid.uuid4())
    if payload.purpose in {"health_tracking", "face_analysis"}:
        lock_routine(connection, user["id"])
    created_at = datetime.now(timezone.utc).isoformat()
    connection.execute(
        """
        INSERT INTO user_consents (id, user_id, purpose, granted, policy_version, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (record_id, user["id"], payload.purpose, int(payload.granted), payload.policy_version, created_at),
    )
    if payload.purpose == "ai_chat" and not payload.granted:
        # Khi quyền gửi hội thoại bị thu hồi, xóa nội dung đã lưu cùng user trong một giao dịch.
        connection.execute("DELETE FROM ai_conversations WHERE user_id = ?", (user["id"],))
    if payload.purpose == "face_analysis" and not payload.granted:
        # Kết quả BOT gắn với điểm khuôn mặt tổng hợp nên được xóa khi quyền bị thu hồi.
        connection.execute("DELETE FROM arena_bot_matches WHERE user_id = ?", (user["id"],))
        connection.execute("DELETE FROM arena_bot_profiles WHERE user_id = ?", (user["id"],))
        clear_face_report(connection, user["id"])
    if payload.purpose == "health_tracking" and not payload.granted:
        connection.execute("DELETE FROM health_routines WHERE user_id = ?", (user["id"],))
    connection.commit()
    return ConsentRecord(
        id=record_id, purpose=payload.purpose, granted=payload.granted,
        policy_version=payload.policy_version, created_at=created_at,
    )
