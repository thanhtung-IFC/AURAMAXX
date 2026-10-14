"""CÃ´ng thá»©c Elo, rank vÃ  chá»‰ sá»‘ hÃ¬nh há»c cho AURA FACE ARENA."""

from collections.abc import Mapping
from math import isfinite


ELO_INITIAL = 1000
ELO_K_STANDARD = 32
ELO_K_NEW_PLAYER = 40
NEW_PLAYER_MATCH_LIMIT = 10

# Trá»ng sá»‘ cáº¥u hÃ¬nh; chá»‰ dÃ¹ng khi cÃ³ bá»™ phÃ¢n tÃ­ch Ä‘Æ°á»£c backend xÃ¡c minh.
SCORE_WEIGHTS = {
    "proportions": 0.24,
    "eyesBrows": 0.16,
    "nose": 0.12,
    "lips": 0.10,
    "jawChin": 0.18,
    "skin": 0.10,
    "fullness": 0.10,
}

ROUND_WEIGHTS = {
    "front_view": 1 / 3,
    "left_profile": 1 / 3,
    "right_profile": 1 / 3,
}


def validate_score_weights(weights: Mapping[str, float] = SCORE_WEIGHTS) -> None:
    if not weights or any(not isfinite(value) or value < 0 for value in weights.values()):
        raise ValueError("Score weights must be non-negative.")
    if abs(sum(weights.values()) - 1.0) > 1e-9:
        raise ValueError("Score weights must sum to 100%.")


def calculate_weighted_score(scores: Mapping[str, float]) -> float:
    """Tráº£ None khi cÃ²n thiáº¿u phÃ©p Ä‘o; khÃ´ng suy diá»…n Ä‘iá»ƒm cÃ²n trá»‘ng."""
    validate_score_weights()
    if any(key not in scores for key in SCORE_WEIGHTS):
        raise ValueError("A verified score is required for every category.")
    values = [float(scores[key]) for key in SCORE_WEIGHTS]
    if any(not isfinite(value) or value < 0 or value > 100 for value in values):
        raise ValueError("Scores must be between 0 and 100.")
    return round(sum(float(scores[key]) * weight for key, weight in SCORE_WEIGHTS.items()), 2)


def calculate_partial_weighted_score(scores: Mapping[str, float]) -> tuple[float, float]:
    """Tính điểm theo các nhóm hợp lệ và trả coverage 0..100, giống Face Lab."""
    validate_score_weights()
    if not scores or any(key not in SCORE_WEIGHTS for key in scores):
        raise ValueError("At least one supported category is required.")
    values = {key: float(value) for key, value in scores.items()}
    if any(not isfinite(value) or value < 0 or value > 100 for value in values.values()):
        raise ValueError("Scores must be between 0 and 100.")
    available_weight = sum(SCORE_WEIGHTS[key] for key in values)
    score = sum(values[key] * SCORE_WEIGHTS[key] for key in values) / available_weight
    return round(score, 2), round(available_weight * 100)


def calculate_match_score(round_scores: Mapping[str, float]) -> float:
    """Tính điểm trận đấu theo ba góc nhìn với trọng số bằng nhau 1/3."""
    validate_score_weights(ROUND_WEIGHTS)
    if not round_scores or set(round_scores) != set(ROUND_WEIGHTS):
        raise ValueError("All three rounds must be complete to calculate a match score.")
    scores = {key: float(value) for key, value in round_scores.items()}
    if any(not isfinite(value) or value < 0 or value > 100 for value in scores.values()):
        raise ValueError("Round scores must be between 0 and 100.")
    total = sum(scores[key] * ROUND_WEIGHTS[key] for key in ROUND_WEIGHTS)
    return round(total, 2)


def determine_match_outcome(player_score: float, bot_score: float) -> float:
    """Trả về 1.0 win, 0.5 draw hoặc 0.0 loss sau khi so sánh số."""
    if not isfinite(player_score) or not isfinite(bot_score):
        raise ValueError("Scores used for comparison must be numeric and finite.")
    if player_score == bot_score:
        return 0.5
    return 1.0 if player_score > bot_score else 0.0


def calculate_elo(
    elo_a: int,
    elo_b: int,
    result_a: float,
    matches_a: int = NEW_PLAYER_MATCH_LIMIT,
    matches_b: int = NEW_PLAYER_MATCH_LIMIT,
) -> tuple[int, int]:
    if elo_a < 0 or elo_b < 0:
        raise ValueError("Elo cannot be negative.")
    if matches_a < 0 or matches_b < 0:
        raise ValueError("Match counts cannot be negative.")
    if result_a not in (0, 0.5, 1):
        raise ValueError("A match result must be a win, draw, or loss.")
    expected_a = 1 / (1 + 10 ** ((elo_b - elo_a) / 400))
    expected_b = 1 - expected_a
    k_a = ELO_K_NEW_PLAYER if matches_a < NEW_PLAYER_MATCH_LIMIT else ELO_K_STANDARD
    k_b = ELO_K_NEW_PLAYER if matches_b < NEW_PLAYER_MATCH_LIMIT else ELO_K_STANDARD
    result_b = 1 - result_a
    return (
        max(0, round(elo_a + k_a * (result_a - expected_a))),
        max(0, round(elo_b + k_b * (result_b - expected_b))),
    )


RANKS = (
    (0, 999, "Bronze", "bronze", "#c58b61"),
    (1000, 1199, "Silver", "silver", "#aebbd0"),
    (1200, 1399, "Gold", "gold", "#e6bf63"),
    (1400, 1599, "Platinum", "platinum", "#65d8d2"),
    (1600, 1799, "Diamond", "diamond", "#68a8ff"),
    (1800, 1999, "Master", "master", "#b68cff"),
    (2000, None, "Grandmaster", "grandmaster", "#f18ac9"),
)


def rank_for_elo(elo: int) -> dict[str, int | str | None]:
    if elo < 0:
        raise ValueError("Elo cannot be negative.")
    for index, (minimum, maximum, name, key, color) in enumerate(RANKS):
        if maximum is None or elo <= maximum:
            next_minimum = RANKS[index + 1][0] if index + 1 < len(RANKS) else None
            span = (next_minimum - minimum) if next_minimum is not None else None
            progress = min(100, max(0, round((elo - minimum) * 100 / span))) if span else 100
            return {
                "name": name,
                "key": key,
                "color": color,
                "minimum_elo": minimum,
                "next_rank_elo": next_minimum,
                "progress_percent": progress,
            }
    raise AssertionError("Unreachable rank lookup.")
