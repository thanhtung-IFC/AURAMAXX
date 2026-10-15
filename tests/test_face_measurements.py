"""Geometric invariance and missing-measurement regressions; no personal images."""
import base64
import io
import math
import unittest

import numpy as np
from PIL import Image
import face_aesthetic_analyzer as analyzer


def landmarks(count=478):
    points = [{"x": .5, "y": .5, "z": 0} for _ in range(count)]
    coordinates = {10:(.5,.12), 152:(.5,.87), 33:(.32,.38), 133:(.42,.38), 362:(.58,.38), 263:(.68,.38),
                   234:(.2,.5),454:(.8,.5),102:(.44,.58),331:(.56,.58),61:(.4,.7),291:(.6,.7),
                   172:(.3,.75),397:(.7,.75),70:(.3,.3),300:(.7,.3),116:(.35,.55),345:(.65,.55),151:(.5,.23),111:(.35,.43)}
    for index, (x, y) in coordinates.items():
        points[index] = {"x": x, "y": y, "z": 0}
    return points


def convert(raw, width=640, height=480):
    return [analyzer.FaceAnalyzerPoint(point["x"],point["y"],point["z"],width,height) for point in raw]


class FaceMeasurementTests(unittest.TestCase):
    def test_symmetric_eye_corners_are_paired_with_the_same_feature(self):
        result = analyzer.analyze_facial_symmetry(convert(landmarks()),640,480)
        self.assertEqual(result["overall_symmetry_score"],100)
        self.assertTrue(all(item["diff_px"] == 0 for item in result["details"]))

    def test_symmetry_does_not_change_with_iris_gaze_or_iris_availability(self):
        raw = landmarks()
        original = analyzer.analyze_facial_symmetry(convert(raw),640,480)
        raw[468] = {"x":.45,"y":.39,"z":0}
        raw[473] = {"x":.7,"y":.4,"z":0}
        self.assertEqual(analyzer.analyze_facial_symmetry(convert(raw),640,480),original)
        self.assertEqual(analyzer.analyze_facial_symmetry(convert(raw[:468]),640,480),original)

    def test_symmetry_is_invariant_to_resolution_and_in_plane_rotation(self):
        raw = landmarks()
        original = analyzer.analyze_facial_symmetry(convert(raw),640,480)
        for width, height in ((640,480),(1280,960),(320,240)):
            theta = math.radians(9)
            rotated = []
            for point in raw:
                x, y = (point["x"]-.5)*width,(point["y"]-.5)*height
                rotated.append({"x":.5+(x*math.cos(theta)-y*math.sin(theta))/width,
                                "y":.5+(x*math.sin(theta)+y*math.cos(theta))/height,"z":0})
            result = analyzer.analyze_facial_symmetry(convert(rotated,width,height),width,height)
            self.assertEqual(result["overall_symmetry_score"],original["overall_symmetry_score"])

    def test_missing_skin_roi_has_no_invented_numeric_scores(self):
        points = convert(landmarks(),128,128)
        for index in (116,345,151,111): points[index] = analyzer.FaceAnalyzerPoint(3,3,0,128,128)
        result = analyzer.analyze_skin_condition(Image.new("RGB",(128,128),(180,160,150)),points)
        self.assertFalse(result["measurement_available"])
        for key in ("smoothness_score","uniformity_score","dark_circles_index","oiliness_score"):
            self.assertIsNone(result[key])

    def test_linear_illumination_gradient_is_not_mistaken_for_skin_texture(self):
        image = np.repeat(np.linspace(140,210,256,dtype=np.uint8)[None,:,None],256,axis=0)
        image = np.repeat(image,3,axis=2)
        result = analyzer.analyze_skin_condition(Image.fromarray(image),convert(landmarks(),256,256))
        self.assertGreater(result["smoothness_score"],92)

    def test_degenerate_landmarks_do_not_return_a_plausible_report(self):
        buffer = io.BytesIO(); Image.new("RGB",(128,128),(180,160,150)).save(buffer,format="PNG")
        result = analyzer.run_comprehensive_face_analysis(base64.b64encode(buffer.getvalue()).decode(),[{"x":.5,"y":.5,"z":0}]*478,128,128)
        self.assertFalse(result["success"])


if __name__ == "__main__":
    unittest.main()
