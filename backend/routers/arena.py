"""Há»“ sÆ¡ AURA FACE ARENA, báº£ng xáº¿p háº¡ng cÃ´ng khai vÃ  tráº¡ng thÃ¡i thi Ä‘áº¥u."""

import sqlite3
import uuid
import json
from hashlib import sha256
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.database import get_database
from backend.features import require_feature
from backend.schemas import ArenaBotMatchRequest, ArenaProfileUpdate
from backend.security import get_current_user, require_consent, require_csrf
from backend.services.arena_bots import get_bot, public_bot_profiles, bot_scoring_rules, evaluate_bot_match
from backend.routines import lock_routine
from backend.services.arena_rating import (
    ELO_INITIAL,
    calculate_elo,
    ELO_K_NEW_PLAYER,
    ELO_K_STANDARD,
    NEW_PLAYER_MATCH_LIMIT,
    expected_match_score,
    rank_for_elo,
)


router = APIRouter(prefix="/api/arena", tags=["AURA FACE ARENA"], dependencies=[Depends(require_feature("arena"))])


def _ensure_profile(connection: sqlite3.Connection, user_id: str) -> sqlite3.Row:
    connection.execute(
        """
        INSERT OR IGNORE INTO arena_profiles (user_id, display_name)
        VALUES (?, ?)
        """,
        (user_id, f"Aura-{user_id.replace('-', '')[:10].upper()}"),
    )
    connection.commit()
    row = connection.execute(
        "SELECT * FROM arena_profiles WHERE user_id = ?", (user_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Arena profile is unavailable.")
    return row


def _profile_payload(row: sqlite3.Row, connection: sqlite3.Connection) -> dict:
    total = int(row["matches_played"])
    wins = int(row["wins"])
    history = connection.execute(
        "SELECT elo_before, elo_after, created_at FROM arena_elo_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 30",
        (row["user_id"],),
    ).fetchall()
    achievements = connection.execute(
        "SELECT achievement_key, awarded_at FROM arena_achievements WHERE user_id = ? ORDER BY awarded_at DESC",
        (row["user_id"],),
    ).fetchall()
    return {
        "display_name": row["display_name"],
        "leaderboard_public": bool(row["leaderboard_public"]),
        "elo": int(row["elo"]),
        "rank": rank_for_elo(int(row["elo"])),
        "highest_elo": int(row["highest_elo"]),
        "matches_played": total,
        "wins": wins,
        "losses": int(row["losses"]),
        "draws": int(row["draws"]),
        "win_rate": round(wins * 100 / total, 1) if total else 0,
        "elo_history": [dict(item) for item in history],
        "achievements": [dict(item) for item in achievements],
    }


@router.get("/status")
def arena_status() -> dict[str, bool | str]:
    return {
        "available": True,
        "profile_available": True,
        "leaderboard_available": True,
        "ranked_matches_available": False,
        "analysis_mode": "practice_submitted_measurements",
        "message": "BOT practice is available. Ranked PvP needs an authenticated match verification flow.",
    }


@router.get("/profile")
def get_arena_profile(
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_database),
) -> dict:
    profile = _ensure_profile(connection, user["id"])
    return _profile_payload(profile, connection)


@router.patch("/profile")
def update_arena_profile(
    payload: ArenaProfileUpdate,
    _csrf: None = Depends(require_csrf),
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_database),
) -> dict:
    profile = _ensure_profile(connection, user["id"])
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not changes:
        return _profile_payload(profile, connection)
    allowed = {"display_name", "leaderboard_public"}
    if set(changes) - allowed:
        raise HTTPException(status_code=422, detail="Invalid profile fields.")
    if "leaderboard_public" in changes:
        changes["leaderboard_public"] = int(changes["leaderboard_public"])
    assignments = ", ".join(f"{field} = ?" for field in changes)
    values = [*changes.values(), datetime.now(timezone.utc).isoformat(), user["id"]]
    try:
        connection.execute(
            f"UPDATE arena_profiles SET {assignments}, updated_at = ? WHERE user_id = ?", values
        )
        connection.commit()
    except sqlite3.IntegrityError as error:
        connection.rollback()
        raise HTTPException(status_code=409, detail="Display name is already in use.") from error
    updated = connection.execute(
        "SELECT * FROM arena_profiles WHERE user_id = ?", (user["id"],)
    ).fetchone()
    return _profile_payload(updated, connection)


@router.get("/leaderboard")
def get_leaderboard(
    tab: Literal["all", "top", "new", "friends"] = "all",
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=10000),
    connection: sqlite3.Connection = Depends(get_database),
) -> dict:
    if tab == "friends":
        return {"entries": [], "tab": tab, "limit": limit, "offset": offset, "has_more": False, "available": False}

    new_players_filter = "AND matches_played < 10" if tab == "new" else ""
    rows = connection.execute(
        f"""
        SELECT display_name, elo, highest_elo, matches_played, wins, losses, draws
        FROM arena_profiles
        WHERE leaderboard_public = 1 {new_players_filter}
        ORDER BY elo DESC, matches_played DESC, display_name COLLATE NOCASE ASC
        LIMIT ? OFFSET ?
        """,
        (limit + 1, offset),
    ).fetchall()
    has_more = len(rows) > limit
    entries = []
    for position, row in enumerate(rows[:limit], start=offset + 1):
        matches = int(row["matches_played"])
        wins = int(row["wins"])
        entries.append({
            "position": position,
            "display_name": row["display_name"],
            "elo": int(row["elo"]),
            "rank": rank_for_elo(int(row["elo"])),
            "highest_elo": int(row["highest_elo"]),
            "matches_played": matches,
            "wins": wins,
            "losses": int(row["losses"]),
            "draws": int(row["draws"]),
            "win_rate": round(wins * 100 / matches, 1) if matches else 0,
        })
    return {"entries": entries, "tab": tab, "limit": limit, "offset": offset, "has_more": has_more, "available": True}


@router.get("/leaderboard/me")
def get_my_leaderboard_position(
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_database),
) -> dict:
    profile = _ensure_profile(connection, user["id"])
    if not profile["leaderboard_public"]:
        return {"public": False, "position": None, "message": "Enable public profile to appear on the leaderboard."}
    position = connection.execute(
        """
        SELECT COUNT(*) + 1 AS position FROM arena_profiles
        WHERE leaderboard_public = 1 AND (
            elo > ? OR (elo = ? AND matches_played > ?) OR
            (elo = ? AND matches_played = ? AND display_name COLLATE NOCASE < ?)
        )
        """,
        (profile["elo"], profile["elo"], profile["matches_played"], profile["elo"],
         profile["matches_played"], profile["display_name"]),
    ).fetchone()["position"]
    return {"public": True, "position": int(position)}


@router.get("/matches/history")
def get_match_history(
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_database),
) -> list[dict]:
    rows = connection.execute(
        """
        SELECT m.id, m.status, m.created_at, m.completed_at,
               p.result, p.elo_before, p.elo_after
        FROM arena_matches AS m
        JOIN arena_match_participants AS p ON p.match_id = m.id
        WHERE p.user_id = ? ORDER BY m.created_at DESC LIMIT 50
        """,
        (user["id"],),
    ).fetchall()
    return [dict(row) for row in rows]


def _bot_match_payload(row: sqlite3.Row) -> dict:
    bot = get_bot(row["bot_id"])
    return {
        "id": row["id"],
        "bot_id": row["bot_id"],
        "bot_name": bot["name"],
        "bot_label": "BOT · AI OPPONENT",
        "simulated": True,
        "result": row["result"],
        "player_score": row["player_score"],
        "bot_score": row["bot_score"],
        "bot_elo": row["bot_elo"],
        "elo_before": row["elo_before"],
        "elo_after": row["elo_after"],
        "elo_delta": row["elo_after"] - row["elo_before"],
        "coverage": row["coverage"],
        "created_at": row["created_at"],
        "scoring": json.loads(row["details_json"]) if "details_json" in row.keys() and row["details_json"] else None,
    }


@router.get("/bots")
def list_arena_bots() -> dict:
    """Trả cấu hình BOT tĩnh; điểm và ảnh hồ sơ đều được đánh dấu mô phỏng."""
    return {"bots": public_bot_profiles(), "simulated": True, "rules": bot_scoring_rules()}


@router.get("/bot-matches/summary")
def get_bot_match_summary(
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_database),
) -> dict:
    row = connection.execute(
        "SELECT * FROM arena_bot_profiles WHERE user_id = ?", (user["id"],)
    ).fetchone()
    summary = {key: int(row[key]) if row is not None else ELO_INITIAL if key in {"elo", "highest_elo"} else 0
               for key in ("elo", "highest_elo", "matches_played", "wins", "losses", "draws")}
    recent = connection.execute(
        "SELECT result, elo_before, elo_after, player_score FROM arena_bot_matches WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 20",
        (user["id"],),
    ).fetchall()
    summary["rank"] = rank_for_elo(summary["elo"])
    summary["win_rate"] = round(summary["wins"] * 100 / summary["matches_played"], 1) if summary["matches_played"] else 0
    summary["recent_form"] = [item["result"] for item in reversed(recent[:10])]
    summary["elo_trend"] = ([recent[-1]["elo_before"]] + [item["elo_after"] for item in reversed(recent)]) if recent else [ELO_INITIAL]
    summary["recent_elo_delta"] = summary["elo"] - recent[-1]["elo_before"] if recent else 0
    summary["recommended_bot_id"] = min(public_bot_profiles(), key=lambda bot: abs(bot["elo"] - summary["elo"]))["id"]
    return summary


@router.get("/bot-matches/history")
def get_bot_match_history(
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_database),
) -> list[dict]:
    rows = connection.execute(
        "SELECT m.*, d.details_json FROM arena_bot_matches m LEFT JOIN arena_bot_match_details d ON d.match_id = m.id WHERE m.user_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 50",
        (user["id"],),
    ).fetchall()
    return [_bot_match_payload(row) for row in rows]


@router.post("/bot-matches")
def create_bot_match(
    payload: ArenaBotMatchRequest,
    _csrf: None = Depends(require_csrf),
    user: sqlite3.Row = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_database),
) -> dict:
    bot = get_bot(payload.bot_id)
    try:
        scoring = evaluate_bot_match(bot, [group.model_dump() for group in payload.groups], payload.round_scores)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    # Submitted scores are practice inputs, not an authenticated PvP result.
    # BOT ratings/history are isolated from arena_profiles and the PvP leaderboard.
    canonical = payload.model_dump(mode="json", exclude={"request_id"})
    canonical["groups"] = sorted(canonical["groups"], key=lambda group: group["id"])
    fingerprint = sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    lock_routine(connection, user["id"])
    try:
        # Share the consent lock, then check again before any Arena write.
        require_consent(connection, user["id"], "face_analysis")
        existing = connection.execute(
            "SELECT m.*, d.details_json, d.request_fingerprint FROM arena_bot_matches m LEFT JOIN arena_bot_match_details d ON d.match_id = m.id WHERE m.user_id = ? AND m.request_id = ?",
            (user["id"], str(payload.request_id)),
        ).fetchone()
        if existing is not None:
            if existing["bot_id"] != bot["id"] or (existing["request_fingerprint"] and existing["request_fingerprint"] != fingerprint):
                raise HTTPException(409, "Mã trận này đã được dùng cho một kết quả khác. Hãy tạo trận mới.")
            connection.commit()
            return {**_bot_match_payload(existing), "replayed": True}

        connection.execute(
            "INSERT OR IGNORE INTO arena_bot_profiles (user_id) VALUES (?)", (user["id"],)
        )
        profile = connection.execute(
            "SELECT * FROM arena_bot_profiles WHERE user_id = ?", (user["id"],)
        ).fetchone()
        result_name = scoring["result"]
        elo_after, _ = calculate_elo(
            int(profile["elo"]), int(bot["elo"]), scoring["outcome"],
            int(profile["matches_played"]), 10,
            rating_factor=scoring["rating_factor"],
        )
        scoring["expected_score"] = round(expected_match_score(int(profile["elo"]), int(bot["elo"])), 4)
        base_k = ELO_K_NEW_PLAYER if profile["matches_played"] < NEW_PLAYER_MATCH_LIMIT else ELO_K_STANDARD
        scoring["effective_k"] = round(base_k * scoring["rating_factor"], 2)
        now = datetime.now(timezone.utc).isoformat()
        match_id = str(uuid.uuid4())
        connection.execute(
            """INSERT INTO arena_bot_matches
               (id, request_id, user_id, bot_id, result, player_score, bot_score, bot_elo,
                elo_before, elo_after, coverage, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (match_id, str(payload.request_id), user["id"], bot["id"], result_name,
             scoring["player_score"], scoring["bot_score"], bot["elo"], profile["elo"],
             elo_after, scoring["coverage"], now),
        )
        connection.execute(
            "INSERT INTO arena_bot_match_details (match_id, request_fingerprint, details_json) VALUES (?, ?, ?)",
            (match_id, fingerprint, json.dumps(scoring, ensure_ascii=False, allow_nan=False)),
        )
        stats_column = {"win": "wins", "loss": "losses", "draw": "draws"}[result_name]
        connection.execute(
            f"""UPDATE arena_bot_profiles SET elo = ?, highest_elo = ?,
                matches_played = matches_played + 1, {stats_column} = {stats_column} + 1,
                updated_at = ? WHERE user_id = ?""",
            (elo_after, max(elo_after, int(profile["highest_elo"])), now, user["id"]),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise

    row = connection.execute("SELECT m.*, d.details_json FROM arena_bot_matches m LEFT JOIN arena_bot_match_details d ON d.match_id = m.id WHERE m.id = ?", (match_id,)).fetchone()
    return {**_bot_match_payload(row), "replayed": False}


@router.post("/matches", status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
def create_ranked_match(
    _csrf: None = Depends(require_csrf),
    _user: sqlite3.Row = Depends(get_current_user),
) -> None:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Ranked matchmaking is paused until face measurements can be verified by the backend. No opponent or result was generated.",
    )
