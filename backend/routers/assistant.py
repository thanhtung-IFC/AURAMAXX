"""Endpoint Aura AI giữ rõ trạng thái chưa kết nối mô hình."""

import sqlite3

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from backend.database import get_database
from backend.features import require_feature
from backend.schemas import AssistantMessageRequest
from backend.security import get_current_user, latest_consent, require_csrf
from backend.services.ai_service import AIServiceUnavailable, ai_configuration, get_ai_service


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
    if not latest_consent(connection, user["id"], "ai_chat"):
        return JSONResponse(
            status_code=403,
            content={"detail": "Bạn cần đồng ý trước khi gửi nội dung hội thoại."},
        )
    try:
        reply = await get_ai_service().reply([{"role": "user", "content": payload.message}])
    except AIServiceUnavailable as error:
        return JSONResponse(
            status_code=error.status_code,
            content={"detail": str(error), "kind": error.kind},
        )
    return {"reply": reply.text, "provider": reply.provider, "model": reply.model}
