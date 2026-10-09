import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import face_aesthetic_analyzer
import face_liveness_algorithms as algorithms
import thuat_toan_xac_thuc_hien_dien_khuon_mat as legacy_liveness
from server import validate_landmarks


class AlgorithmPipelineTests(unittest.TestCase):
    def test_validated_points_are_reused_without_changing_results(self):
        raw = [{"x": i / 500, "y": 0.4, "z": 0.0} for i in range(478)]
        database = [{"id": "person", "name": "An", "vector": [0.0] * 60}]
        expected = algorithms.analyze_frame_landmarks(raw, database)
        points = validate_landmarks(raw)
        with patch.object(algorithms, "LandmarkPoint", side_effect=AssertionError("Repeated conversion")):
            actual = algorithms.analyze_frame_landmarks(raw, database, validated_points=points)
        self.assertEqual(actual, expected)

    def test_legacy_paths_use_the_current_implementations(self):
        self.assertIs(legacy_liveness.calculate_head_pose, algorithms.calculate_head_pose)
        source = Path(__file__).resolve().parents[1] / "tt tham-my-khuon-mat.py"
        spec = importlib.util.spec_from_file_location("legacy_aesthetic", source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertIs(module.run_multi_view_face_analysis, face_aesthetic_analyzer.run_multi_view_face_analysis)


if __name__ == "__main__":
    unittest.main()
