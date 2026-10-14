"""Tổng hợp hành trình từ các bản ghi thật của chính người dùng."""

import sqlite3

from fastapi import APIRouter, Depends

from backend.database import get_database
from backend.features import require_feature
from backend.security import get_current_user, require_consent
from backend.routers.habits import _record


router = APIRouter(prefix="/api/progress", tags=["Tiến trình"])
router.dependencies.append(Depends(require_feature("health_tracking")))


@router.get("/summary")
def get_progress_summary(
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_database),
) -> dict:
    require_consent(connection, user["id"], "health_tracking")
    rows = connection.execute(
        "SELECT * FROM habit_entries WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 100",
        (user["id"],),
    ).fetchall()
    total = connection.execute(
        "SELECT COUNT(*) AS total FROM habit_entries WHERE user_id = ?",
        (user["id"],),
    ).fetchone()["total"]
    categories = connection.execute(
        """
        SELECT category, COUNT(*) AS entries
        FROM habit_entries WHERE user_id = ? GROUP BY category ORDER BY category
        """,
        (user["id"],),
    ).fetchall()
    return {
        "total_entries": total,
        "categories": [{"category": row["category"], "entries": row["entries"]} for row in categories],
        "entries": [_record(row).model_dump() for row in rows],
    }
