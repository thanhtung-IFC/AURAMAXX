"""Routine Builder rules from the merged Daily module, shared by Health Hub APIs.

The original intensity/feedback selection is retained. Database state owns
dates, completions and freezes so browser storage never becomes authoritative.
"""

import copy
import json
import re
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

LIBRARY = json.loads(Path(__file__).with_name("routine_library.json").read_text(encoding="utf-8"))
ITEMS = {item["id"]: item for item in LIBRARY}
LOCAL_TIMEZONE = timezone(timedelta(hours=7))


def today_key():
    return datetime.now(LOCAL_TIMEZONE).date().isoformat()


def lock_routine(connection, user_id):
    backend = getattr(connection, "backend", "sqlite")
    if backend == "postgres":
        connection.execute("SELECT pg_advisory_xact_lock(hashtext(?))", ("health_routine:" + user_id,))
    elif backend == "sqlserver":
        result = connection.execute("""
            IF @@TRANCOUNT = 0 BEGIN TRANSACTION;
            DECLARE @result INT;
            EXEC @result = sys.sp_getapplock @Resource = ?, @LockMode = 'Exclusive',
                @LockOwner = 'Transaction', @LockTimeout = 10000;
            SELECT @result AS lock_result;
        """, ("HealthRoutine:" + user_id,)).fetchone()
        if result[0] < 0:
            from face_store import StorageError
            raise StorageError("Could not obtain the routine write lock")
    elif not connection.in_transaction:
        connection.execute("BEGIN IMMEDIATE")


def empty_state(today):
    return {"date": today, "intensity": "moderate", "feedback": "balanced", "tasks": [],
            "report": None, "report_saved_at": None, "completed_dates": [], "frozen_dates": []}


def generate_tasks(state):
    choices = {
        "gentle": ["drink_water", "gentle_wash", "straight_posture"],
        "moderate": ["drink_water", "gentle_wash", "jaw_relax", "straight_posture"],
        "intensive": ["drink_water", "gentle_wash", "jaw_relax", "straight_posture", "mewing", "neck_stretch"],
    }
    identifiers = choices[state["intensity"]].copy()
    if state["feedback"] == "too_much":
        identifiers = [key for key in identifiers if key not in {"mewing", "neck_stretch"}]
    elif state["feedback"] == "can_more":
        identifiers.append("sunscreen")
    previous = {task["id"]: task for task in state["tasks"]}
    identifiers.extend(task["id"] for task in state["tasks"] if task.get("added_from_library"))
    state["tasks"] = [copy.deepcopy(previous.get(key, {
        "id": key, "completed": False, "dismissed": False, "time_shift": 0, "added_from_library": False,
    })) for key in dict.fromkeys(identifiers)]


def roll_day(state, today):
    if state["date"] == today:
        return
    completed, frozen = set(state["completed_dates"]), set(state["frozen_dates"])
    if completed:
        missing = date.fromisoformat(max(completed)) + timedelta(days=1)
        yesterday = date.fromisoformat(today) - timedelta(days=1)
        # Stop at the first unprotected gap; a long absence must not preserve a streak.
        while missing <= yesterday:
            key = missing.isoformat()
            if key not in completed and key not in frozen:
                month_count = sum(day.startswith(key[:7]) for day in frozen)
                if month_count >= 2:
                    break
                frozen.add(key)
            missing += timedelta(days=1)
    state["date"] = today
    state["completed_dates"] = sorted(completed)[-370:]
    state["frozen_dates"] = sorted(frozen)[-370:]
    for task in state["tasks"]:
        task.update(completed=False, dismissed=False, time_shift=0)
    if state["tasks"]:
        generate_tasks(state)


def update_completion(state):
    active = [task for task in state["tasks"] if not task["dismissed"]]
    dates = set(state["completed_dates"])
    if active and all(task["completed"] for task in active):
        dates.add(state["date"])
        state["frozen_dates"] = [day for day in state["frozen_dates"] if day != state["date"]]
    else:
        dates.discard(state["date"])
    state["completed_dates"] = sorted(dates)[-370:]


def streak_info(state):
    completed, frozen = set(state["completed_dates"]), set(state["frozen_dates"])
    day = date.fromisoformat(state["date"])
    if day.isoformat() not in completed | frozen:
        day -= timedelta(days=1)
    streak = 0
    while day.isoformat() in completed | frozen:
        streak += int(day.isoformat() in completed)
        day -= timedelta(days=1)
    left = max(0, 2 - sum(key.startswith(state["date"][:7]) for key in frozen))
    return {"count": streak, "freezes_left": left, "frozen_today": state["date"] in frozen,
            "completed_today": state["date"] in completed,
            "completed_dates": sorted(completed)[-370:], "frozen_dates": sorted(frozen)[-370:]}


def explanation(item, report):
    if item.get("optional"):
        return "Mục tham khảo tùy chọn. Bạn có thể bỏ qua; không có cam kết thay đổi cấu trúc khuôn mặt."
    skin = (report or {}).get("skin") or {}
    fields = {"gentle_wash": ("oiliness_score", "độ bóng trong ảnh"),
              "sunscreen": ("uniformity_score", "độ đều màu trong ảnh"),
              "drink_water": ("smoothness_score", "độ mịn trong ảnh"),
              "sleep_schedule": ("dark_circles_index", "vùng dưới mắt trong ảnh")}
    metric = fields.get(item["id"])
    if metric and skin.get(metric[0]) is not None:
        return f"Số đo {metric[1]}: {skin[metric[0]]:g}/100. Đây là bối cảnh tham khảo từ ảnh, không xác định nguyên nhân hay tình trạng sức khỏe. Bạn tự quyết định mục này có phù hợp không."
    return "Gợi ý từ thư viện Routine Builder theo mức độ và phản hồi bạn chọn. Bạn có thể đổi giờ, bỏ qua hoặc thêm mục khác."


def present_state(state, revision):
    tasks = []
    for task in state["tasks"]:
        item = copy.deepcopy(ITEMS[task["id"]])
        shifted = task["time_shift"]
        if shifted:
            item["suggestedTime"] = re.sub(
                r"(\d{1,2}) đến (\d{1,2})h",
                lambda match: f"{(int(match[1]) + shifted) % 24} đến {(int(match[2]) + shifted) % 24}h",
                item["suggestedTime"],
            )
        tasks.append({**item, **task, "reason": explanation(item, state["report"])})
    active = [task for task in tasks if not task["dismissed"]]
    library = [{**item, "reason": explanation(item, state["report"])} for item in LIBRARY]
    return {"revision": revision, "date": state["date"], "intensity": state["intensity"],
            "feedback": state["feedback"], "tasks": tasks, "library": library,
            "report": state["report"], "report_saved_at": state["report_saved_at"],
            "completed": sum(task["completed"] for task in active), "total": len(active),
            "streak": streak_info(state)}


@contextmanager
def routine_transaction(connection, user_id):
    try:
        lock_routine(connection, user_id)
        from backend.security import require_consent
        require_consent(connection, user_id, "health_tracking")
        row = connection.execute("SELECT state_json, revision FROM health_routines WHERE user_id = ?", (user_id,)).fetchone()
        state = json.loads(row["state_json"]) if row else empty_state(today_key())
        original = copy.deepcopy(state)
        revision = row["revision"] if row else 0
        roll_day(state, today_key())
        version = {"revision": revision}
        yield state, version
        if state != original or row is None:
            revision += 1
            encoded = json.dumps(state, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            now = datetime.now(timezone.utc).isoformat()
            if row:
                connection.execute("UPDATE health_routines SET state_json = ?, revision = ?, updated_at = ? WHERE user_id = ?", (encoded, revision, now, user_id))
            else:
                connection.execute("INSERT INTO health_routines (user_id, state_json, revision, updated_at) VALUES (?, ?, ?, ?)", (user_id, encoded, revision, now))
        connection.commit()
        version["revision"] = revision
    except BaseException:
        connection.rollback()
        raise


def habit_id(user_id, day, task_id):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"health-routine:{user_id}:{day}:{task_id}"))


def record_task(connection, user_id, day, task):
    identifier = habit_id(user_id, day, task["id"])
    connection.execute("DELETE FROM habit_entries WHERE id = ? AND user_id = ?", (identifier, user_id))
    if task["completed"]:
        item = ITEMS[task["id"]]
        category = "water" if task["id"] == "drink_water" else "sleep" if task["id"] == "sleep_schedule" else "movement" if item["category"] in {"exercise", "posture"} else "self_care"
        now = datetime.now(timezone.utc).isoformat()
        connection.execute(
            "INSERT INTO habit_entries (id, user_id, category, value, unit, note, recorded_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (identifier, user_id, category, "Hoàn thành", "", "Routine · " + item["title"], day + "T12:00:00+07:00", now),
        )


def clear_face_report(connection, user_id):
    row = connection.execute("SELECT state_json FROM health_routines WHERE user_id = ?", (user_id,)).fetchone()
    if row:
        state = json.loads(row["state_json"])
        state.update(report=None, report_saved_at=None)
        connection.execute("UPDATE health_routines SET state_json = ?, revision = revision + 1, updated_at = ? WHERE user_id = ?", (json.dumps(state, ensure_ascii=False), datetime.now(timezone.utc).isoformat(), user_id))


def uncomplete_entry(connection, user_id, record_id, recorded_at):
    """A removed routine journal entry also removes its task/day completion."""
    day = recorded_at[:10]
    task_id = next((key for key in ITEMS if habit_id(user_id, day, key) == record_id), None)
    if task_id is None:
        return
    lock_routine(connection, user_id)
    row = connection.execute("SELECT state_json FROM health_routines WHERE user_id = ?", (user_id,)).fetchone()
    if row:
        state = json.loads(row["state_json"])
        if state["date"] == day:
            for task in state["tasks"]:
                if task["id"] == task_id:
                    task["completed"] = False
            update_completion(state)
        else:
            state["completed_dates"] = [key for key in state["completed_dates"] if key != day]
        connection.execute("UPDATE health_routines SET state_json = ?, revision = revision + 1, updated_at = ? WHERE user_id = ?", (json.dumps(state, ensure_ascii=False), datetime.now(timezone.utc).isoformat(), user_id))
