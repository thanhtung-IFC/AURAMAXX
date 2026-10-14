import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import face_aesthetic_analyzer
import face_liveness_algorithms as algorithms
import thuat_toan_xac_thuc_hien_dien_khuon_mat as legacy_liveness
from server import validate_landmarks


class AlgorithmPipelineTests(unittest.TestCase):
    def test_skin_analysis_uses_left_cheek_luminance_for_under_eye_comparison(self):
        image = Image.new("RGB", (128, 128), (200, 200, 200))
        ImageDraw.Draw(image).rectangle((30, 43, 46, 59), fill=(160, 160, 160))
        points = [face_aesthetic_analyzer.FaceAnalyzerPoint(.5, .5, 0, 128, 128) for _ in range(478)]
        for index, x, y in [(234, .2, .5), (454, .8, .5), (116, .3, .6), (345, .7, .6), (151, .5, .2), (111, .3, .4)]:
            points[index] = face_aesthetic_analyzer.FaceAnalyzerPoint(x, y, 0, 128, 128)
        result = face_aesthetic_analyzer.analyze_skin_condition(image, points)
        self.assertEqual(result["dark_circles_index"], 44.0)
        self.assertEqual(result["smoothness_score"], 95.0)

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
