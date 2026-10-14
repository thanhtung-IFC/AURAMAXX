"""Global feature switches controlled by project administrators."""

from fastapi import Depends, HTTPException

from backend.database import get_database

FEATURES = {
    "user_registration": "Đăng ký tài khoản mới",
    "aura_ai": "Aura AI",
    "health_tracking": "Nhật ký sức khỏe và tiến trình",
    "face_analysis": "Face Lab",
    "arena": "Arena",
}


def is_enabled(connection, key: str) -> bool:
    row = connection.execute(
        "SELECT enabled FROM admin_feature_flags WHERE feature_key = ?", (key,)
    ).fetchone()
    return bool(row[0]) if row else True


def require_feature(key: str):
    def dependency(connection=Depends(get_database)):
        if key not in FEATURES:
            raise HTTPException(404, "Tính năng không tồn tại.")
        if not is_enabled(connection, key):
            raise HTTPException(503, "Tính năng này hiện đã được quản trị viên tạm dừng.")
    return dependency
