"""Endpoint Aura AI giữ rõ trạng thái chưa kết nối mô hình."""

import sqlite3

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from backend.database import get_database
from backend.features import require_feature
from backend.schemas import AssistantMessageRequest
from backend.security import get_current_user, require_csrf
from backend.services.ai_service import ai_configuration
from backend.routers.aura import legacy_send_message


router = APIRouter(prefix="/api/assistant", tags=["Aura AI"], dependencies=[Depends(require_feature("aura_ai"))])


@router.get("/status")
def assistant_status() -> dict[str, str | bool]:
    return ai_configuration()


@router.post("/messages", response_model=None)
async def send_message(
    payload: AssistantMessageRequest,
    _csrf: None = Depends(require_csrf),
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_database),
) -> dict | JSONResponse:
    return await legacy_send_message(payload, _csrf, user, connection)
