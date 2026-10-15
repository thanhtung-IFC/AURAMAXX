"""Face Lab landmark detection runs locally; image measurements run on the server."""

from fastapi import APIRouter, Depends

from backend.features import require_feature


router = APIRouter(prefix="/api/face-analyses", tags=["Face Lab"])
router.dependencies.append(Depends(require_feature("face_analysis")))


@router.get("/status")
def face_analysis_status() -> dict[str, str | bool]:
    return {
        "available": True,
        "status": "ready",
        "advanced_available": True,
        "advanced_endpoint": "/api/vision/analyze_face",
        "message": "Điểm mốc được phát hiện trên thiết bị; ảnh chỉ gửi tới máy chủ khi bạn chọn phân tích.",
    }
