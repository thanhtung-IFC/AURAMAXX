"""Application AI request budgets, reserved atomically before provider calls.

One admitted request consumes one turn, including failures and client stops.
No prompts, answers, keys or inferred provider billing data are stored here.
"""
from datetime import datetime, timedelta, timezone
import uuid

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from backend.settings import AI_RATE_LIMIT_PER_MINUTE

VIETNAM = timezone(timedelta(hours=7))


class QuotaPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    daily_limit: int | None = Field(default=None, ge=0, le=1_000_000)
    monthly_limit: int | None = Field(default=None, ge=0, le=10_000_000)
    per_minute: int = Field(default=AI_RATE_LIMIT_PER_MINUTE, ge=1, le=60)
    enabled: bool = True


class QuotaSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    daily_limit: int | None = Field(default=None, ge=0, le=1_000_000)
    monthly_limit: int | None = Field(default=None, ge=0, le=10_000_000)
    per_minute: int = Field(default=AI_RATE_LIMIT_PER_MINUTE, ge=1, le=60)
    global_daily_limit: int | None = Field(default=None, ge=0, le=10_000_000)
    global_monthly_limit: int | None = Field(default=None, ge=0, le=100_000_000)


def periods(now=None):
    now = now or datetime.now(timezone.utc)
    local = now.astimezone(VIETNAM)
    day = local.replace(hour=0, minute=0, second=0, microsecond=0)
    month = day.replace(day=1)
    next_month = (month.replace(day=28) + timedelta(days=4)).replace(day=1)
    utc = lambda value: value.astimezone(timezone.utc).isoformat()
    return {"day_start": utc(day), "month_start": utc(month), "day_end": utc(day + timedelta(days=1)),
            "month_end": utc(next_month), "day": day.date().isoformat(), "month": month.strftime("%Y-%m"),
            "timezone": "Asia/Ho_Chi_Minh"}


def settings(connection):
    row = connection.execute("SELECT daily_limit, monthly_limit, per_minute, global_daily_limit, global_monthly_limit FROM ai_quota_settings WHERE id = 1").fetchone()
    return dict(row) if row else QuotaSettings().model_dump()


def policy(connection, user_id, defaults=None):
    defaults = defaults or settings(connection)
    row = connection.execute("SELECT daily_limit, monthly_limit, per_minute, enabled FROM ai_user_quotas WHERE user_id = ?", (user_id,)).fetchone()
    if row:
        return {**dict(row), "enabled": bool(row["enabled"])}, True
    return {key: defaults[key] for key in ("daily_limit", "monthly_limit", "per_minute")} | {"enabled": True}, False


def usage(connection, window, user_id=None):
    where = "created_at >= ? AND created_at < ?"
    parameters = [window["day_start"], window["day_end"], window["month_start"], window["month_end"]]
    if user_id is not None:
        where += " AND user_id = ?"
        parameters.append(user_id)
    row = connection.execute(
        "SELECT COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END), 0) AS today, COUNT(*) AS month FROM ai_usage_events WHERE " + where,
        parameters,
    ).fetchone()
    return {"today": row["today"], "month": row["month"]}


def remaining(limit, used):
    return None if limit is None else max(0, limit - used)


def user_status(connection, user_id, now=None):
    window = periods(now)
    limits, overridden = policy(connection, user_id)
    counts = usage(connection, window, user_id)
    return {"policy": limits, "overridden": overridden, "usage": counts,
            "remaining": {"today": remaining(limits["daily_limit"], counts["today"]), "month": remaining(limits["monthly_limit"], counts["month"])},
            "period": window}


def reserve_request(connection, user_id, now=None):
    """Serialize count/check/insert on SQLite, PostgreSQL and SQL Server.

    Commit before streaming so provider waits never hold the quota write lock.
    Rejected requests have no usage event and never reach the provider.
    """
    now = now or datetime.now(timezone.utc)
    window = periods(now)
    cutoff = (now - timedelta(seconds=60)).isoformat()
    try:
        connection.execute("BEGIN IMMEDIATE")
        defaults = settings(connection)
        limits, _ = policy(connection, user_id, defaults)
        if not limits["enabled"]:
            raise HTTPException(429, "AURA AI của tài khoản này đang được quản trị viên tạm dừng.")
        counts = usage(connection, window, user_id) if limits["daily_limit"] is not None or limits["monthly_limit"] is not None else {"today": 0, "month": 0}
        totals = usage(connection, window) if defaults["global_daily_limit"] is not None or defaults["global_monthly_limit"] is not None else {"today": 0, "month": 0}
        for limit, used, label in (
            (limits["daily_limit"], counts["today"], "Tài khoản đã hết lượt AI hôm nay. Hạn mức làm mới lúc 00:00 giờ Việt Nam."),
            (limits["monthly_limit"], counts["month"], "Tài khoản đã hết lượt AI trong tháng. Hạn mức làm mới vào đầu tháng theo giờ Việt Nam."),
            (defaults["global_daily_limit"], totals["today"], "Hệ thống đã hết hạn mức AI hôm nay. Vui lòng thử lại sau hoặc liên hệ quản trị viên."),
            (defaults["global_monthly_limit"], totals["month"], "Hệ thống đã hết hạn mức AI trong tháng. Vui lòng liên hệ quản trị viên."),
        ):
            if limit is not None and used >= limit:
                raise HTTPException(429, label)
        connection.execute("DELETE FROM ai_request_limits WHERE created_at < ?", (cutoff,))
        minute_count = connection.execute("SELECT COUNT(*) FROM ai_request_limits WHERE user_id = ? AND created_at > ?", (user_id, cutoff)).fetchone()[0]
        if minute_count >= limits["per_minute"]:
            raise HTTPException(429, "Bạn gửi quá nhanh. Hãy chờ một phút rồi thử lại.")
        request_id = str(uuid.uuid4())
        for table in ("ai_request_limits", "ai_usage_events"):
            connection.execute(f"INSERT INTO {table} (id, user_id, created_at) VALUES (?, ?, ?)", (request_id, user_id, now.isoformat()))
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
