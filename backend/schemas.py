"""Các cấu trúc kiểm tra dữ liệu REST API."""

import re
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=128)
    display_name: str | None = Field(default=None, min_length=1, max_length=120)

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        name = " ".join(value.split())
        if not name or any(ord(char) < 32 for char in name):
            raise ValueError("Vui lòng nhập tên hiển thị hợp lệ.")
        return name

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        email = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise ValueError("Vui lòng nhập địa chỉ email hợp lệ.")
        if email.endswith("@legacy.auramaxx.local"):
            raise ValueError("Tên miền này được dành riêng cho tài khoản VisionFace.")
        return email


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class DeleteAccountRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)
    confirmation: Literal["DELETE"]


class PublicUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    created_at: str
    display_name: str = ""
    role: str = "user"
    must_change_password: bool = False


class ConsentRequest(BaseModel):
    purpose: Literal["face_analysis", "health_tracking", "ai_chat"]
    granted: bool
    policy_version: str = Field(default="v1", min_length=1, max_length=32)


class ConsentRecord(BaseModel):
    id: str
    purpose: str
    granted: bool
    policy_version: str
    created_at: str


class HabitCreate(BaseModel):
    category: Literal["water", "sleep", "movement", "self_care"]
    value: str = Field(min_length=1, max_length=100)
    unit: str = Field(default="", max_length=24)
    note: str = Field(default="", max_length=500)
    recorded_at: datetime | None = None

    @field_validator("value")
    @classmethod
    def non_blank_value(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Giá trị ghi nhận không được để trống.")
        return normalized


    @field_validator("recorded_at")
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("Thời gian cần có múi giờ.")
        return value.astimezone(timezone.utc) if value is not None else None


class HabitRecord(BaseModel):
    id: str
    category: str
    value: str
    unit: str
    note: str
    recorded_at: str
    created_at: str


class AssistantMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)

    @field_validator("message")
    @classmethod
    def non_blank_message(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Tin nhắn không được để trống.")
        return normalized


class AuraChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: UUID | None = None
    analysis: dict | None = None

    @field_validator("analysis")
    @classmethod
    def clean_analysis(cls, value: dict | None) -> dict | None:
        from backend.services.vision_context import sanitize_analysis
        return sanitize_analysis(value)

    @field_validator("message")
    @classmethod
    def non_blank_aura_message(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Tin nhắn không được để trống.")
        return normalized


class AuraConversationRequest(BaseModel):
    title: str = Field(default="Cuộc trò chuyện mới", min_length=1, max_length=120)

    @field_validator("title")
    @classmethod
    def non_blank_title(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Tiêu đề không được để trống.")
        return normalized


class ArenaProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=2, max_length=24)
    leaderboard_public: bool | None = None

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        if len(normalized) < 2 or any(ord(character) < 32 for character in normalized):
            raise ValueError("Display name must contain 2 to 24 printable characters.")
        return normalized


class ArenaBotScoreGroup(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Literal["proportions", "eyesBrows", "nose", "lips", "jawChin", "skin", "fullness"]
    score: float | None = Field(default=None, ge=0, le=100)
    status: Literal["complete", "partial", "missing", "unreliable"]


class ArenaBotMatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: UUID
    bot_id: Literal["rookie", "casual", "skilled", "elite", "champion"]
    groups: list[ArenaBotScoreGroup] = Field(min_length=7, max_length=7)
    round_scores: list[float] | None = Field(default=None, min_length=3, max_length=3)
