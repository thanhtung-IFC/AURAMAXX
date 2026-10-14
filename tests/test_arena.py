"""Unit tests for authoritative Arena rating calculations."""

import unittest

from backend.services.arena_rating import (
    ELO_INITIAL,
    SCORE_WEIGHTS,
    calculate_elo,
    calculate_match_score,
    calculate_weighted_score,
    determine_match_outcome,
    rank_for_elo,
    validate_score_weights,
)
from backend.services.arena_bots import public_bot_profiles, score_submitted_groups


class ArenaRatingTests(unittest.TestCase):
    def test_bot_configuration_and_scores_are_explicitly_simulated(self) -> None:
        bots = public_bot_profiles()
        self.assertEqual([bot["elo"] for bot in bots], [700, 900, 1100, 1300, 1500])
        self.assertTrue(all(bot["simulated"] and "BOT" in bot["label"] for bot in bots))
        self.assertTrue(all(set(bot["scores"]) == set(SCORE_WEIGHTS) for bot in bots))
        self.assertTrue(all(set(bot["round_scores"]) == {"front_view", "left_profile", "right_profile"} for bot in bots))
        self.assertIn("symmetry", bots[0]["unavailable_categories"])
        self.assertEqual([bot["score"] for bot in bots], sorted(bot["score"] for bot in bots))

    def test_bot_scoring_uses_supported_groups_and_coverage(self) -> None:
        groups = [
            {"id": category, "score": 80, "status": "complete"}
            for category in SCORE_WEIGHTS
        ]
        self.assertEqual(score_submitted_groups(groups), (80.0, 100))
        groups[-1] = {"id": "fullness", "score": None, "status": "unreliable"}
        score, coverage = score_submitted_groups(groups)
        self.assertEqual(score, 80.0)
        self.assertEqual(coverage, 90)
        with self.assertRaises(ValueError):
            score_submitted_groups(groups[:-1])

    def test_three_round_scoring_is_equal_weight_and_numeric(self) -> None:
        player = {"front_view": 85.0, "left_profile": 80.0, "right_profile": 78.0}
        bot = {"front_view": 82.0, "left_profile": 79.0, "right_profile": 75.0}
        self.assertAlmostEqual(calculate_match_score(player), 81.0)
        self.assertAlmostEqual(calculate_match_score(bot), 78.67, places=2)
        self.assertEqual(determine_match_outcome(calculate_match_score(player), calculate_match_score(bot)), 1.0)
        self.assertEqual(determine_match_outcome(60.0, 60.0), 0.5)
        with self.assertRaises(ValueError):
            calculate_match_score({"front_view": 50.0, "left_profile": 40.0})

    def test_score_weights_total_one_hundred_percent(self) -> None:
        validate_score_weights()
        self.assertAlmostEqual(sum(SCORE_WEIGHTS.values()), 1.0)

    def test_weighted_score_uses_configured_categories(self) -> None:
        score = calculate_weighted_score({category: 80 for category in SCORE_WEIGHTS})
        self.assertEqual(score, 80)

    def test_weighted_score_rejects_missing_or_out_of_range_measurements(self) -> None:
        with self.assertRaises(ValueError):
            calculate_weighted_score({})
        with self.assertRaises(ValueError):
            calculate_weighted_score({category: 101 for category in SCORE_WEIGHTS})

    def test_elo_win_loss_draw_and_new_player_factor(self) -> None:
        self.assertEqual(calculate_elo(ELO_INITIAL, ELO_INITIAL, 1, 0, 0), (1020, 980))
        self.assertEqual(calculate_elo(ELO_INITIAL, ELO_INITIAL, 0, 0, 0), (980, 1020))
        self.assertEqual(calculate_elo(ELO_INITIAL, ELO_INITIAL, 0.5, 0, 0), (1000, 1000))
        self.assertEqual(calculate_elo(ELO_INITIAL, ELO_INITIAL, 1, 10, 10), (1016, 984))

    def test_elo_validation_and_upset_expectation(self) -> None:
        with self.assertRaises(ValueError):
            calculate_elo(1000, 1000, 0.25)
        with self.assertRaises(ValueError):
            calculate_elo(-1, 1000, 1)
        favorite, underdog = calculate_elo(1600, 1000, 0)
        self.assertLess(favorite, 1600)
        self.assertGreater(underdog, 1000)

    def test_rank_boundaries_and_progress(self) -> None:
        self.assertEqual(rank_for_elo(999)["name"], "Bronze")
        self.assertEqual(rank_for_elo(1000)["name"], "Silver")
        self.assertEqual(rank_for_elo(1200)["name"], "Gold")
        self.assertEqual(rank_for_elo(1400)["name"], "Platinum")
        self.assertEqual(rank_for_elo(1600)["name"], "Diamond")
        self.assertEqual(rank_for_elo(1800)["name"], "Master")
        self.assertEqual(rank_for_elo(2000)["name"], "Grandmaster")
        self.assertEqual(rank_for_elo(1000)["progress_percent"], 0)
        self.assertEqual(rank_for_elo(2000)["progress_percent"], 100)


if __name__ == "__main__":
    unittest.main()
