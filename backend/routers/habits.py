"""Nhật ký thói quen do chính người dùng ghi nhận."""

import sqlite3
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from backend.database import get_database
from backend.features import require_feature
from backend.schemas import HabitCreate, HabitRecord
from backend.security import get_current_user, require_consent, require_csrf
from backend.routines import routine_transaction, habit_id, ITEMS, update_completion


router = APIRouter(prefix="/api/habits", tags=["Health Hub"], dependencies=[Depends(require_feature("health_tracking"))])


def _record(row: sqlite3.Row) -> HabitRecord:
    return HabitRecord(
        id=row["id"], category=row["category"], value=row["value"],
        unit=row["unit"], note=row["note"], recorded_at=row["recorded_at"],
        created_at=row["created_at"],
    )


@router.get("", response_model=list[HabitRecord])
def list_habits(
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_database),
) -> list[HabitRecord]:
    require_consent(connection, user["id"], "health_tracking")
    rows = connection.execute(
        "SELECT * FROM habit_entries WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 100",
        (user["id"],),
    ).fetchall()
    return [_record(row) for row in rows]


@router.post("", response_model=HabitRecord, status_code=status.HTTP_201_CREATED)
def create_habit(
    payload: HabitCreate,
    _csrf: None = Depends(require_csrf),
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_database),
) -> HabitRecord:
    require_consent(connection, user["id"], "health_tracking")
    record_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    recorded_at = (payload.recorded_at or datetime.now(timezone.utc)).isoformat()
    connection.execute(
        """
        INSERT INTO habit_entries
            (id, user_id, category, value, unit, note, recorded_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (record_id, user["id"], payload.category, payload.value, payload.unit,
         payload.note, recorded_at, now),
    )
    connection.commit()
    return HabitRecord(
        id=record_id, category=payload.category, value=payload.value,
        unit=payload.unit, note=payload.note, recorded_at=recorded_at, created_at=now,
    )


@router.delete("/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_habit(
    record_id: str,
    _csrf: None = Depends(require_csrf),
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_database),
) -> None:
    with routine_transaction(connection, user["id"]) as (state, _version):
        row = connection.execute("SELECT recorded_at FROM habit_entries WHERE id = ? AND user_id = ?", (record_id, user["id"])).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy bản ghi.")
        day = row["recorded_at"][:10]
        task_id = next((key for key in ITEMS if habit_id(user["id"], day, key) == record_id), None)
        connection.execute("DELETE FROM habit_entries WHERE id = ? AND user_id = ?", (record_id, user["id"]))
        if task_id:
            if day == state["date"]:
                for task in state["tasks"]:
                    if task["id"] == task_id:
                        task["completed"] = False
                update_completion(state)
            else:
                state["completed_dates"] = [key for key in state["completed_dates"] if key != day]
