"""Trạng thái API server cho Face Lab; xử lý khuôn mặt diễn ra trong trình duyệt."""

from fastapi import APIRouter, Depends

from backend.features import require_feature


router = APIRouter(prefix="/api/face-analyses", tags=["Face Lab"])
router.dependencies.append(Depends(require_feature("face_analysis")))


@router.get("/status")
def face_analysis_status() -> dict[str, str | bool]:
    return {
        "available": False,
        "status": "client_side_only",
        "advanced_available": True,
        "advanced_endpoint": "/api/vision/analyze_face",
        "message": "Backend không nhận hoặc xử lý hình ảnh. Face Landmarker chạy trong trình duyệt trên thiết bị người dùng.",
    }
