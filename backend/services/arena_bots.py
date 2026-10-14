"""Cấu hình đối thủ BOT mô phỏng cho AURA FACE ARENA."""

from backend.services.arena_rating import (
    SCORE_WEIGHTS,
    calculate_partial_weighted_score as _calculate_partial_weighted_score,
    calculate_weighted_score,
)


_BOT_DATA = (
    {
        "id": "rookie", "name": "Rookie", "elo": 700, "difficulty": "Rất dễ",
        "avatar": "🟢", "description": "Đối thủ nhập môn để làm quen với Arena.",
        "scores": {"proportions": 60, "eyesBrows": 58, "nose": 61, "lips": 57, "jawChin": 59, "skin": 62, "fullness": 60},
        "round_scores": {"front_view": 63.0, "left_profile": 58.5, "right_profile": 59.0},
    },
    {
        "id": "casual", "name": "Casual", "elo": 900, "difficulty": "Dễ",
        "avatar": "🔵", "description": "Mức thử thách nhẹ, phù hợp để luyện tập.",
        "scores": {"proportions": 68, "eyesBrows": 67, "nose": 66, "lips": 69, "jawChin": 65, "skin": 68, "fullness": 67},
        "round_scores": {"front_view": 70.0, "left_profile": 66.0, "right_profile": 67.5},
    },
    {
        "id": "skilled", "name": "Skilled", "elo": 1100, "difficulty": "Trung bình",
        "avatar": "🟣", "description": "Đối thủ cân bằng cho người đã quen Face Lab.",
        "scores": {"proportions": 77, "eyesBrows": 75, "nose": 76, "lips": 74, "jawChin": 78, "skin": 73, "fullness": 76},
        "round_scores": {"front_view": 79.0, "left_profile": 75.5, "right_profile": 75.0},
    },
    {
        "id": "elite", "name": "Elite", "elo": 1300, "difficulty": "Khó",
        "avatar": "🟠", "description": "Thử thách cao với điểm mô phỏng nổi bật.",
        "scores": {"proportions": 86, "eyesBrows": 84, "nose": 85, "lips": 83, "jawChin": 87, "skin": 82, "fullness": 85},
        "round_scores": {"front_view": 87.0, "left_profile": 83.5, "right_profile": 84.5},
    },
    {
        "id": "champion", "name": "Champion", "elo": 1500, "difficulty": "Rất khó",
        "avatar": "🟡", "description": "Đối thủ BOT cấp cao nhất hiện tại.",
        "scores": {"proportions": 94, "eyesBrows": 93, "nose": 92, "lips": 93, "jawChin": 95, "skin": 91, "fullness": 94},
        "round_scores": {"front_view": 95.0, "left_profile": 92.0, "right_profile": 93.0},
    },
)

BOT_PROFILES = {bot["id"]: bot for bot in _BOT_DATA}
UNAVAILABLE_CATEGORIES = ("symmetry", "overall_harmony", "jawline")


def get_bot(bot_id: str) -> dict:
    try:
        return BOT_PROFILES[bot_id]
    except KeyError as error:
        raise ValueError("Unknown bot opponent.") from error


def public_bot_profiles() -> list[dict]:
    return [
        {
            "id": bot["id"],
            "name": bot["name"],
            "elo": bot["elo"],
            "difficulty": bot["difficulty"],
            "avatar": bot["avatar"],
            "description": bot["description"],
            "label": "BOT · AI OPPONENT",
            "simulated": True,
            "supported_categories": list(SCORE_WEIGHTS),
            "unavailable_categories": list(UNAVAILABLE_CATEGORIES),
            "scores": dict(bot["scores"]),
            "round_scores": dict(bot["round_scores"]),
            "score": calculate_weighted_score(bot["scores"]),
        }
        for bot in _BOT_DATA
    ]


def score_submitted_groups(groups: list[dict]) -> tuple[float, int]:
    expected = set(SCORE_WEIGHTS)
    if len(groups) != len(expected) or {group["id"] for group in groups} != expected:
        raise ValueError("All seven supported Face Lab categories must be provided.")

    valid_scores = {}
    for group in groups:
        status = group["status"]
        score = group["score"]
        if status in {"complete", "partial"}:
            if score is None:
                raise ValueError("Measured categories must include a score.")
            valid_scores[group["id"]] = score
        elif status in {"missing", "unreliable"}:
            if score is not None:
                raise ValueError("Unavailable categories cannot include a score.")
        else:
            raise ValueError("Unknown Face Lab category status.")

    score, coverage = _calculate_partial_weighted_score(valid_scores)
    if coverage < 50:
        raise ValueError("Face Lab coverage must be at least 50% to enter a BOT match.")
    return score, coverage
