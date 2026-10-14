"""Health Hub owns the routine builder, task journal and streak on one account."""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from backend.database import get_database
from backend.features import require_feature
from backend.routines import (
    ITEMS, generate_tasks, present_state, record_task, routine_transaction,
    streak_info, update_completion,
)
from backend.security import get_current_user, require_consent, require_csrf

router = APIRouter(prefix="/api/health-hub", tags=["Health Hub"], dependencies=[Depends(require_feature("health_tracking"))])


class RoutineSkin(BaseModel):
    smoothness_score: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    uniformity_score: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    oiliness_score: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    dark_circles_index: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)


class RoutineReport(BaseModel):
    # Raw images, landmarks and account identifiers are never accepted as state.
    skin: RoutineSkin | None = None


class RoutineBuild(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
    report: RoutineReport | None = None


class RoutineAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
    action: Literal["preferences", "complete", "shift", "dismiss", "restore", "add", "freeze", "clear_report"]
    task_id: str | None = Field(default=None, max_length=64)
    completed: bool | None = None
    intensity: Literal["gentle", "moderate", "intensive"] | None = None
    feedback: Literal["too_much", "balanced", "can_more"] | None = None


def check_version(version, expected):
    if version["revision"] != expected:
        raise HTTPException(409, "Routine đã thay đổi ở lượt thao tác hoặc thiết bị khác. Hãy tải lại rồi thử lại.")


@router.get("/routine")
def get_routine(user=Depends(get_current_user), connection=Depends(get_database)):
    with routine_transaction(connection, user["id"]) as (state, version):
        pass
    return present_state(state, version["revision"])


@router.post("/routine", dependencies=[Depends(require_csrf)])
def build_routine(payload: RoutineBuild, user=Depends(get_current_user), connection=Depends(get_database)):
    with routine_transaction(connection, user["id"]) as (state, version):
        check_version(version, payload.revision)
        if payload.report is not None:
            require_consent(connection, user["id"], "face_analysis")
            state["report"] = payload.report.model_dump(exclude_none=True)
            state["report_saved_at"] = datetime.now(timezone.utc).isoformat()
        generate_tasks(state)
        update_completion(state)
    return present_state(state, version["revision"])


@router.patch("/routine", dependencies=[Depends(require_csrf)])
def update_routine(payload: RoutineAction, user=Depends(get_current_user), connection=Depends(get_database)):
    with routine_transaction(connection, user["id"]) as (state, version):
        check_version(version, payload.revision)
        if payload.action == "preferences":
            if payload.intensity is not None:
                state["intensity"] = payload.intensity
            if payload.feedback is not None:
                state["feedback"] = payload.feedback
            if state["tasks"]:
                generate_tasks(state)
        elif payload.action == "clear_report":
            state.update(report=None, report_saved_at=None)
        elif payload.action == "freeze":
            streak = streak_info(state)
            if not streak["count"] or streak["completed_today"] or streak["frozen_today"] or not streak["freezes_left"]:
                raise HTTPException(409, "Chưa thể bảo vệ chuỗi hôm nay hoặc đã hết 2 lượt trong tháng.")
            state["frozen_dates"].append(state["date"])
        else:
            if payload.task_id not in ITEMS:
                raise HTTPException(404, "Không tìm thấy mục routine.")
            task = next((task for task in state["tasks"] if task["id"] == payload.task_id), None)
            if payload.action == "add":
                if task is None:
                    state["tasks"].append({"id": payload.task_id, "completed": False, "dismissed": False, "time_shift": 0, "added_from_library": True})
                else:
                    task["dismissed"] = False
            elif task is None:
                raise HTTPException(404, "Mục này chưa có trong routine hôm nay.")
            elif payload.action == "complete":
                if payload.completed is None:
                    raise HTTPException(422, "Cần chọn trạng thái hoàn thành.")
                if task["dismissed"]:
                    raise HTTPException(409, "Khôi phục mục đã bỏ qua trước khi đánh dấu hoàn thành.")
                if task["completed"] != payload.completed:
                    task["completed"] = payload.completed
                    record_task(connection, user["id"], state["date"], task)
            elif payload.action == "shift":
                task["time_shift"] = (task["time_shift"] + 1) % 24
            elif payload.action in {"dismiss", "restore"}:
                task["dismissed"] = payload.action == "dismiss"
        update_completion(state)
    return present_state(state, version["revision"])
