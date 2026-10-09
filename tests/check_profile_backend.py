import base64
import io
import math
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image
from face_liveness_algorithms import LandmarkPoint, calculate_head_pose
from face_aesthetic_analyzer import run_multi_view_face_analysis


class ProfileBackendTests(unittest.TestCase):
    def test_yaw_follows_rotation_in_both_directions(self):
        for degrees in (-45, -25, 0, 25, 45):
            with self.subTest(degrees=degrees):
                angle = math.radians(degrees)
                points = [LandmarkPoint(0.5, 0.5) for _ in range(478)]
                points[234] = LandmarkPoint(
                    0.5 - 0.2 * math.cos(angle), 0.5, 0.2 * math.sin(angle)
                )
                points[454] = LandmarkPoint(
                    0.5 + 0.2 * math.cos(angle), 0.5, -0.2 * math.sin(angle)
                )
                self.assertAlmostEqual(calculate_head_pose(points)["yaw"], degrees)

    def test_profile_uses_its_own_image_dimensions(self):
        image = io.BytesIO()
        Image.new("RGB", (320, 640)).save(image, format="PNG")
        profile = base64.b64encode(image.getvalue()).decode("ascii")
        points = [{"x": 0.5, "y": 0.5, "z": 0} for _ in range(478)]

        class ReachedProfileAnalysis(Exception):
            pass

        def inspect_profile(profile_points, width, height):
            self.assertEqual((width, height), (320, 640))
            self.assertEqual(profile_points[0].px, 160)
            self.assertEqual(profile_points[0].py, 320)
            raise ReachedProfileAnalysis

        with patch("face_aesthetic_analyzer.run_comprehensive_face_analysis", return_value={"success": True}):
            with patch("face_aesthetic_analyzer.analyze_profile_view", side_effect=inspect_profile):
                with self.assertRaises(ReachedProfileAnalysis):
                    run_multi_view_face_analysis("unused", points, profile, points, 640, 480)


if __name__ == "__main__":
    unittest.main()
