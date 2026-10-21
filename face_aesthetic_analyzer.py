"""Measure visible 2D face geometry and pixel variation from a single image.

Outputs are image observations, not clinical measurements, skin assessments,
population norms, or objective ratings of a person's appearance.
"""

import base64
import io
import math
from typing import Dict, Any, List, Optional, Tuple
 
import numpy as np
from PIL import Image


class FaceAnalyzerPoint:
    """Điểm mốc 2D/3D phục vụ đo lường hình học."""
    __slots__ = ('x', 'y', 'z', 'px', 'py')

    def __init__(self, x: float, y: float, z: float = 0.0, img_w: int = 1, img_h: int = 1):
        self.x = float(x)
        self.y = float(y)
        self.z = float(z)
        self.px = float(x * img_w)
        self.py = float(y * img_h)


def dist_2d(p1: FaceAnalyzerPoint, p2: FaceAnalyzerPoint) -> float:
    """Khoảng cách Euclid pixel 2D giữa hai điểm."""
    return math.hypot(p1.px - p2.px, p1.py - p2.py)


def angle_between_points(p1: FaceAnalyzerPoint, p_center: FaceAnalyzerPoint, p2: FaceAnalyzerPoint) -> float:
    """Tính góc (đơn vị độ) hợp bởi p1 - p_center - p2."""
    v1_x = p1.px - p_center.px
    v1_y = p1.py - p_center.py
    v2_x = p2.px - p_center.px
    v2_y = p2.py - p_center.py

    dot = v1_x * v2_x + v1_y * v2_y
    mag1 = math.hypot(v1_x, v1_y)
    mag2 = math.hypot(v2_x, v2_y)

    if mag1 * mag2 == 0:
        return 0.0

    cosine = max(-1.0, min(1.0, dot / (mag1 * mag2)))
    return math.degrees(math.acos(cosine))


def point_line_distance(pt: FaceAnalyzerPoint, line_p1: FaceAnalyzerPoint, line_p2: FaceAnalyzerPoint) -> float:
    """Khoảng cách có hướng từ một điểm đến đường thẳng tạo bởi line_p1 và line_p2."""
    dx = line_p2.px - line_p1.px
    dy = line_p2.py - line_p1.py
    length = math.hypot(dx, dy)
    if length == 0:
        return dist_2d(pt, line_p1)
    cross = (line_p2.px - line_p1.px) * (line_p1.py - pt.py) - (line_p1.px - pt.px) * (line_p2.py - line_p1.py)
    return cross / length


# =========================================================================
# 1. ĐỘ CÂN ĐỐI CỦA KHUÔN MẶT (FACIAL SYMMETRY - KHÁCH QUAN & KHOA HỌC)
# =========================================================================

def analyze_facial_symmetry(points: List[FaceAnalyzerPoint], img_w: int, img_h: int) -> Dict[str, Any]:
    """
    Đo lường độ bất đối xứng tự nhiên hai bên trục giữa khuôn mặt.
    Tiêu chí nhân trắc học: Không ai đối xứng 100%. Thang điểm thực tế, không tâng bốc.
    """
    forehead = points[10]
    chin = points[152]

    # Eye corners describe the structure; pupil centers move when the user looks aside.
    eye_center_l = FaceAnalyzerPoint((points[33].x + points[133].x) / 2, (points[33].y + points[133].y) / 2, 0, img_w, img_h)
    eye_center_r = FaceAnalyzerPoint((points[362].x + points[263].x) / 2, (points[362].y + points[263].y) / 2, 0, img_w, img_h)

    # Các cặp đối xứng quan trọng và trọng số
    pairs = [
        ("Tâm hai khóe mắt", eye_center_l, eye_center_r, 1.25),
        ("Khóe mắt ngoài", points[33], points[263], 1.0),
        ("Khóe mắt trong", points[133], points[362], 1.0),
        ("Gò má", points[234], points[454], 1.15),
        ("Cánh mũi", points[102], points[331], 1.05),
        ("Khóe miệng", points[61], points[291], 1.1),
        ("Góc xương hàm", points[172], points[397], 1.2),
        ("Đuôi chân mày", points[70], points[300], 0.85)
    ]

    face_width = max(dist_2d(points[234], points[454]), 1.0)
    total_weight = 0.0
    weighted_symmetry = 0.0
    details = []
    asymmetry_flaws = []

    for name, pt_l, pt_r, weight in pairs:
        dist_l = abs(point_line_distance(pt_l, forehead, chin))
        dist_r = abs(point_line_distance(pt_r, forehead, chin))

        diff_px = abs(dist_l - dist_r)
        avg_d = (dist_l + dist_r) / 2.0 + 1e-4

        # Tính tỷ lệ lệch tương đối (chặt chẽ, phản ánh đúng khuyết điểm)
        rel_diff = diff_px / avg_d
        sym_score = max(30.0, min(100.0, 100.0 - (rel_diff * 140.0)))

        weighted_symmetry += sym_score * weight
        total_weight += weight

        # Pixel thay đổi theo độ phân giải; so sánh độ lệch với bề rộng mặt.
        diff_face_pct = diff_px / face_width * 100.0
        if diff_face_pct > 1.0:
            side = "bên phải xa trục hơn" if dist_r > dist_l else "bên trái xa trục hơn"
            asymmetry_flaws.append(f"{name} lệch khoảng {round(diff_face_pct, 1)}% bề rộng mặt ({side})")

        details.append({
            "feature": name,
            "score": round(sym_score, 1),
            "left_dist_px": round(dist_l, 1),
            "right_dist_px": round(dist_r, 1),
            "diff_px": round(diff_px, 1),
            "diff_face_width_pct": round(diff_face_pct, 2)
        })

    # Độ lệch cao độ hai mắt (Eye Level Tilt)
    eye_dy = eye_center_r.py - eye_center_l.py
    eye_dx = eye_center_r.px - eye_center_l.px
    eye_tilt_deg = math.degrees(math.atan2(eye_dy, eye_dx))

    overall_score = round(weighted_symmetry / total_weight, 1)

    # Đánh giá công bằng, trung thực
    if overall_score >= 88.0 and abs(eye_tilt_deg) <= 0.8:
        level = "Điểm đối xứng cao theo phép đo hình học"
        feedback = "Khuôn mặt có sự đồng đều đáng kể giữa hai nửa bán cầu mặt."
    elif overall_score >= 76.0:
        level = "Độ lệch thấp theo ngưỡng đo tham khảo"
        feedback = "Các điểm mốc nhìn chung gần trục giữa trong ảnh; biểu cảm và góc chụp vẫn có thể ảnh hưởng."
    elif overall_score >= 64.0:
        level = "Có điểm mốc lệch khỏi trục giữa"
        feedback = "Có một số điểm mốc lệch khỏi trục giữa; hãy kiểm tra lại với ảnh chính diện và ánh sáng đều."
    else:
        level = "Bất đối xứng đáng kể"
        feedback = "Các điểm mốc lệch tương đối nhiều khỏi trục giữa; tư thế, biểu cảm và độ chính xác landmark có thể góp phần."

    if asymmetry_flaws:
        feedback += f" Điểm cần lưu ý: {', '.join(asymmetry_flaws[:2])}."

    return {
        "overall_symmetry_score": overall_score,
        "evaluation": level,
        "feedback": feedback,
        "eye_tilt_deg": round(eye_tilt_deg, 2),
        "details": details,
        "asymmetry_flaws": asymmetry_flaws,
        "midline_axis": {
            "top": {"x": round(forehead.px, 1), "y": round(forehead.py, 1)},
            "bottom": {"x": round(chin.px, 1), "y": round(chin.py, 1)}
        }
    }


# =========================================================================
# 2. TỶ LỆ KHUÔN MẶT & DÁNG MẶT (FACIAL PROPORTIONS - CHUẨN NHÂN TRẮC HỌC)
# =========================================================================

def estimate_true_trichion(
    points: List[FaceAnalyzerPoint],
    img_w: int,
    img_h: int,
    image_pil: Optional[Image.Image] = None
) -> FaceAnalyzerPoint:
    """Compatibility helper returning the upper Face Mesh boundary, not a hairline.

    Face Mesh does not observe the actual hairline. Pixel-color transitions also
    confuse hair, shadows, makeup and backgrounds, so do not invent a trichion.
    """
    del img_w, img_h, image_pil
    return points[10]


def analyze_facial_proportions(
    points: List[FaceAnalyzerPoint],
    img_w: int,
    img_h: int,
    image_pil: Optional[Image.Image] = None
) -> Dict[str, Any]:
    """Return neutral 2D measurements from the visible Face Mesh boundary."""
    trichion = estimate_true_trichion(points, img_w, img_h, image_pil)
    glabella = points[9]            # Chân mày
    subnasale = points[2]           # Chân mũi
    chin_bot = points[152]          # Đáy cằm

    upper_h = dist_2d(trichion, glabella)
    middle_h = dist_2d(glabella, subnasale)
    lower_h = dist_2d(subnasale, chin_bot)
    total_h = upper_h + middle_h + lower_h + 1e-6

    upper_pct = round((upper_h / total_h) * 100.0, 1)
    middle_pct = round((middle_h / total_h) * 100.0, 1)
    lower_pct = round((lower_h / total_h) * 100.0, 1)

    thirds_spread = round(max(upper_pct, middle_pct, lower_pct) - min(upper_pct, middle_pct, lower_pct), 1)
    thirds_note = (
        f"Tỷ trọng trong ảnh: vùng trên {upper_pct}%, vùng giữa {middle_pct}%, vùng dưới {lower_pct}%. "
        "Vùng trên bắt đầu tại rìa Face Mesh, không phải chân tóc; các tỷ lệ không được chấm theo một chuẩn vẻ đẹp."
    )

    # Chiều dài và chiều rộng khuôn mặt (fWHR)
    face_length = dist_2d(trichion, chin_bot)
    cheekbone_width = dist_2d(points[234], points[454]) + 1e-6
    ratio_hw = round(face_length / cheekbone_width, 2)
    # The 1.618 ratio is not a validated universal target; retain the raw ratio only.
    golden_score = None

    # Chiều rộng trán và hàm
    forehead_w = dist_2d(points[103], points[332])
    cheek_w = cheekbone_width
    jaw_w = dist_2d(points[172], points[397])

    # Broad shape labels describe the visible 2D outline and carry no value judgment.
    if ratio_hw > 1.58:
        face_shape = "Mặt Dài / Chữ Nhật (Oblong)"
        shape_desc = "Viền Face Mesh trong ảnh có tỷ lệ dọc/rộng thuộc nhóm dài theo ngưỡng phân loại nội bộ; không bao gồm đường chân tóc."
    elif ratio_hw < 1.22:
        if jaw_w / cheek_w > 0.84:
            face_shape = "Mặt Vuông (Square)"
            shape_desc = "Tỷ lệ viền hàm và vùng má trong ảnh gần nhóm vuông; đây là mô tả đường nét 2D, không suy ra cấu trúc xương."
        else:
            face_shape = "Mặt Tròn (Round)"
            shape_desc = "Tỷ lệ dọc/rộng trong ảnh gần nhóm tròn theo ngưỡng phân loại nội bộ; góc máy và biểu cảm có thể làm thay đổi kết quả."
    elif forehead_w > cheek_w * 0.95 and jaw_w < cheek_w * 0.72:
        face_shape = "Mặt Trái Tim (Heart)"
        shape_desc = "Vùng thái dương của Face Mesh rộng hơn vùng hàm trong ảnh; đường chân tóc và bề ngang trán thật chưa được đo."
    elif cheek_w > forehead_w * 1.15 and cheek_w > jaw_w * 1.25:
        face_shape = "Mặt Kim Cương (Diamond)"
        shape_desc = "Vùng má rộng hơn vùng thái dương và hàm trong ảnh; nhãn chỉ tóm tắt tỷ lệ 2D, không phải đánh giá thẩm mỹ."
    else:
        face_shape = "Mặt Trái Xoan (Oval)"
        shape_desc = "Tỷ lệ viền Face Mesh gần nhóm oval theo các ngưỡng nội bộ; không bao gồm đường chân tóc và không phải xếp hạng."

    return {
        "face_shape": face_shape,
        "face_shape_description": shape_desc,
        "trichion": {
            "x": round(trichion.x, 4),
            "y": round(trichion.y, 4),
            "px": round(trichion.px, 1),
            "py": round(trichion.py, 1),
            "source": "face_mesh_top",
            "hairline_measured": False
        },
        "forehead": {
            "mesh_top_to_brow_px": round(upper_h, 1),
            "temple_width_px": round(forehead_w, 1),
            "mesh_top_to_brow_pct_of_visible_height": round(upper_h / max(face_length, 1e-6) * 100.0, 1),
            "hairline_measured": False,
            "note": "Mốc trên là rìa Face Mesh, không phải đường chân tóc; độ cao trán thật không được suy đoán."
        },
        "rule_of_thirds": {
            "upper_third_pct": upper_pct,
            "middle_third_pct": middle_pct,
            "lower_third_pct": lower_pct,
            "harmony_score": None,
            "spread_pct": thirds_spread,
            "honest_evaluation": thirds_note,
            "reference": "Rìa Face Mesh → mốc giữa chân mày → chân mũi → đáy cằm; không phải phép đo đủ ba tầng giải phẫu."
        },
        "length_to_width_ratio": ratio_hw,
        "golden_ratio_target": None,
        "golden_ratio_fit_score": golden_score,
        "dimensions_px": {
            "face_length": round(face_length, 1),
            "upper_face_mesh_height": round(upper_h, 1),
            "forehead_width": round(forehead_w, 1),
            "cheekbone_width": round(cheek_w, 1),
            "jaw_width": round(jaw_w, 1)
        }
    }


# =========================================================================
# 3. TỶ LỆ MŨI (NOSE PROPORTIONS - THẲNG THẮN, KHÔNG GIẤU KHUYẾT ĐIỂM)
# =========================================================================

def analyze_nose_proportions(points: List[FaceAnalyzerPoint], img_w: int, img_h: int) -> Dict[str, Any]:
    """
    Đo một số tỷ lệ 2D quanh mũi; không suy ra bệnh lý từ ảnh.
    """
    nasion = points[168]        # Gốc sống mũi
    nose_tip = points[1]        # Đỉnh chóp mũi
    subnasale = points[2]       # Chân mũi
    alar_l = points[102]        # Cánh mũi trái
    alar_r = points[331]        # Cánh mũi phải

    inner_canthus_l = points[133]  # Khóe mắt trong trái
    inner_canthus_r = points[362]  # Khóe mắt trong phải

    nose_length = dist_2d(nasion, subnasale)
    alar_width = dist_2d(alar_l, alar_r)
    intercanthal_dist = dist_2d(inner_canthus_l, inner_canthus_r) + 1e-6

    width_to_length = round(alar_width / (nose_length + 1e-6), 2)
    alar_to_eye_ratio = round(alar_width / intercanthal_dist, 2)

    # Độ lệch sống mũi được so theo bề rộng mặt để không phụ thuộc độ phân giải.
    deviation_px = point_line_distance(nose_tip, nasion, subnasale)
    face_width = max(dist_2d(points[234], points[454]), 1.0)
    deviation_face_pct = abs(deviation_px) / face_width * 100.0

    # Đánh giá trục sống mũi thẳng hay vẹo
    if deviation_face_pct < 0.5:
        bridge_status = "Sống mũi thẳng, trục giữa chuẩn"
        dev_comment = "Đường giữa trong ảnh gần trùng với trục mặt; đây không phải đánh giá y khoa."
    elif deviation_px > 0:
        bridge_status = f"Đỉnh mũi lệch nhẹ sang PHẢI ({round(deviation_face_pct, 1)}% bề rộng mặt)"
        dev_comment = "Đỉnh mũi lệch khỏi trục giữa trong ảnh; góc chụp và biểu cảm có thể ảnh hưởng phép đo."
    else:
        bridge_status = f"Đỉnh mũi lệch nhẹ sang TRÁI ({round(deviation_face_pct, 1)}% bề rộng mặt)"
        dev_comment = "Đỉnh mũi lệch khỏi trục giữa trong ảnh; góc chụp và biểu cảm có thể ảnh hưởng phép đo."

    # Đánh giá cánh mũi
    if alar_to_eye_ratio <= 1.04:
        alar_status = "Cánh mũi thon gọn (Độ rộng vừa bằng khoảng cách 2 khóe mắt)"
    elif alar_to_eye_ratio <= 1.15:
        alar_status = "Cánh mũi hơi rộng nhẹ so với khoảng cách 2 mắt"
    else:
        alar_status = f"Cánh mũi bè to (Vượt {round((alar_to_eye_ratio - 1.0) * 100, 1)}% khoảng cách 2 mắt, làm mặt thiếu thanh thoát)"

    # Điểm thẩm mỹ mũi khắt khe, thực tế
    diff_wl = abs(width_to_length - 0.67)
    diff_alar = max(0.0, alar_to_eye_ratio - 1.0)
    dev_penalty = max(0.0, deviation_face_pct - 0.5) * 2.0

    nose_score = round(max(40.0, min(96.0, 100.0 - (diff_wl * 85.0) - (diff_alar * 65.0) - dev_penalty)), 1)

    return {
        "nose_aesthetic_score": nose_score,
        "nose_length_px": round(nose_length, 1),
        "alar_width_px": round(alar_width, 1),
        "width_to_length_ratio": width_to_length,
        "ideal_width_to_length": "0.65 - 0.70",
        "alar_to_intercanthal_ratio": alar_to_eye_ratio,
        "alar_status": alar_status,
        "bridge_status": bridge_status,
        "bridge_comment": dev_comment,
        "bridge_deviation_px": round(abs(deviation_px), 1),
        "bridge_deviation_face_width_pct": round(deviation_face_pct, 2)
    }


# =========================================================================
# 4. ĐƯỜNG VIỀN HÀM & CẰM (JAWLINE & CHIN - ĐÁNH GIÁ CHÂN THỰC)
# =========================================================================

def analyze_jawline_and_chin(
    points: List[FaceAnalyzerPoint],
    img_w: int,
    img_h: int,
    pose_quality: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Measure visible lower-face geometry without assigning a preferred shape."""
    chin = points[152]
    jaw_l = points[172]
    jaw_r = points[397]
    cheek_l = points[234]
    cheek_r = points[454]

    angle_l = angle_between_points(cheek_l, jaw_l, chin)
    angle_r = angle_between_points(cheek_r, jaw_r, chin)
    avg_jaw_angle = round((angle_l + angle_r) / 2.0, 1)

    jaw_w = dist_2d(jaw_l, jaw_r)
    cheek_w = dist_2d(cheek_l, cheek_r) + 1e-6
    ratio_jaw_cheek = round(jaw_w / cheek_w, 2)
    chin_angle = angle_between_points(jaw_l, chin, jaw_r)
    visible_height = dist_2d(points[10], chin) + 1e-6
    lower_face_height = dist_2d(points[2], chin)
    yaw = abs(float((pose_quality or {}).get("yaw_deg", 0.0)))
    roll = abs(float((pose_quality or {}).get("roll_deg", 0.0)))
    reliability = "Hạn chế do góc chụp" if yaw > 8 or roll > 6 or (pose_quality or {}).get("clipped") else "Đo trên ảnh chính diện 2D"

    return {
        "average_jaw_angle_deg": avg_jaw_angle,
        "jaw_angle_left_deg": round(angle_l, 1),
        "jaw_angle_right_deg": round(angle_r, 1),
        "chin_type": "Không phân loại theo chuẩn thẩm mỹ",
        "chin_flaw": f"Góc mở đường viền hàm–cằm trên ảnh là {round(chin_angle, 1)}°. Mốc 2D không đủ để kết luận cằm nhô, lẹm hay cấu trúc xương.",
        "chin_apex_angle_deg": round(chin_angle, 1),
        "chin_lower_face_height_pct": round(lower_face_height / visible_height * 100.0, 1),
        "jaw_to_cheek_ratio": ratio_jaw_cheek,
        "jawline_sharpness_score": None,
        "jawline_evaluation": f"Góc đường viền trái/phải lần lượt {round(angle_l, 1)}° và {round(angle_r, 1)}°; tỷ lệ bề ngang hàm/má là {ratio_jaw_cheek}. {reliability}. Đây không phải góc xương hàm đo lâm sàng.",
        "measurement_note": "Điểm 234/454, 172/397 và 152 mô tả đường viền nhìn thấy; ánh sáng, râu, biểu cảm, tư thế và độ chính diện ảnh hưởng kết quả.",
        "measurement_reliability": reliability,
        "pose_yaw_deg": round(yaw, 1),
        "pose_roll_deg": round(roll, 1),
    }


# =========================================================================
# 5. TÌNH TRẠNG DA (SKIN CONDITION - PHÂN TÍCH KHÁCH QUAN, PHÁT HIỆN LỖI)
# =========================================================================

def _crop_skin_roi(np_img: np.ndarray, center_pt: FaceAnalyzerPoint, radius: int) -> Optional[np.ndarray]:
    """Cắt một vùng da (ROI) hình vuông kích thước an toàn."""
    cx = int(center_pt.px)
    cy = int(center_pt.py)
    h, w = np_img.shape[:2]

    x1 = max(0, cx - radius)
    y1 = max(0, cy - radius)
    x2 = min(w, cx + radius)
    y2 = min(h, cy + radius)

    if x2 <= x1 or y2 <= y1:
        return None
    return np_img[y1:y2, x1:x2]


def _skin_region_measurements(roi: Optional[np.ndarray]) -> Optional[Dict[str, float]]:
    """Measure image luminance and local texture without labeling skin health."""
    if roi is None or roi.size == 0 or roi.shape[0] < 16 or roi.shape[1] < 16:
        return None
    patch = np.asarray(Image.fromarray(roi).resize((32, 32), Image.Resampling.BILINEAR), dtype=np.float32)
    gray = np.dot(patch[..., :3], [0.299, 0.587, 0.114])
    mean_luminance = float(np.median(gray))
    yy, xx = np.mgrid[:32, :32]
    design = np.column_stack((xx.ravel(), yy.ravel(), np.ones(32 * 32)))
    fitted = design @ np.linalg.lstsq(design, gray.ravel(), rcond=None)[0]
    residual = gray.ravel() - fitted
    median_residual = float(np.median(residual))
    robust_variation = 1.4826 * float(np.median(np.abs(residual - median_residual)))
    return {
        "mean_luminance": round(mean_luminance, 1),
        "texture_variation_pct": round(100 * robust_variation / max(mean_luminance, 1.0), 2),
        "shadow_clipped_pct": round(float(np.mean(gray <= 5.0)) * 100.0, 1),
        "highlight_clipped_pct": round(float(np.mean(gray >= 250.0)) * 100.0, 1),
    }


def analyze_skin_condition(image_pil: Image.Image, points: List[FaceAnalyzerPoint]) -> Dict[str, Any]:
    """Return relative image observations for matched face regions.

    RGB tone, absolute brightness, makeup and camera processing are not reliable
    evidence of complexion, oiliness, texture health or pigmentation.
    """
    img_rgb = image_pil.convert("RGB")
    np_img = np.array(img_rgb)

    face_w = dist_2d(points[234], points[454])
    roi_radius = max(8, int(face_w * 0.065))

    roi_left_cheek = _crop_skin_roi(np_img, points[116], roi_radius)
    roi_right_cheek = _crop_skin_roi(np_img, points[345], roi_radius)
    roi_forehead = _crop_skin_roi(np_img, points[151], roi_radius)
    roi_under_eye_l = _crop_skin_roi(np_img, points[111], int(roi_radius * 0.75))
    roi_under_eye_r = _crop_skin_roi(np_img, points[340], int(roi_radius * 0.75))
    regions = {
        "left_cheek": _skin_region_measurements(roi_left_cheek),
        "right_cheek": _skin_region_measurements(roi_right_cheek),
        "forehead": _skin_region_measurements(roi_forehead),
        "under_eye_left": _skin_region_measurements(roi_under_eye_l),
        "under_eye_right": _skin_region_measurements(roi_under_eye_r),
    }
    available_regions = {name: value for name, value in regions.items() if value is not None}
    left_lum = regions["left_cheek"]["mean_luminance"] if regions["left_cheek"] else None
    right_lum = regions["right_cheek"]["mean_luminance"] if regions["right_cheek"] else None
    forehead_lum = regions["forehead"]["mean_luminance"] if regions["forehead"] else None
    under_eye_luminances = [regions[name]["mean_luminance"] for name in ("under_eye_left", "under_eye_right") if regions[name]]
    under_eye_lum = float(np.mean(under_eye_luminances)) if under_eye_luminances else None
    cheek_mean = (left_lum + right_lum) / 2 if left_lum is not None and right_lum is not None else None
    relative = lambda value, reference: round((value - reference) / max(reference, 1.0) * 100.0, 1) if value is not None and reference is not None else None
    cheek_difference = round(abs(left_lum - right_lum) / max((left_lum + right_lum) / 2, 1.0) * 100.0, 1) if left_lum is not None and right_lum is not None else None
    texture_values = [regions[name]["texture_variation_pct"] for name in ("left_cheek", "right_cheek") if regions[name]]
    # Keep deprecated fields for older clients; all current decisions use the
    # observation-only fields below and must ignore these uncalibrated scores.
    legacy_texture = []
    for cheek_roi in (roi_left_cheek, roi_right_cheek):
        if cheek_roi is not None and cheek_roi.shape[0] >= 16 and cheek_roi.shape[1] >= 16:
            patch = np.asarray(Image.fromarray(cheek_roi).resize((32, 32), Image.Resampling.BILINEAR), dtype=np.float32)
            gray = np.dot(patch[..., :3], [0.299, 0.587, 0.114])
            yy, xx = np.mgrid[:32, :32]
            design = np.column_stack((xx.ravel(), yy.ravel(), np.ones(32 * 32)))
            fitted = design @ np.linalg.lstsq(design, gray.ravel(), rcond=None)[0]
            legacy_texture.append(float(np.std(gray.ravel() - fitted)))
    legacy_smoothness = round(max(35.0, min(95.0, 95.0 - (float(np.median(legacy_texture)) if legacy_texture else 0.0) * 3.2)), 1) if legacy_texture else None
    legacy_dark_circles = None
    if roi_under_eye_l is not None and roi_left_cheek is not None and roi_under_eye_l.size and roi_left_cheek.size:
        eye_lum = float(np.mean(np.dot(roi_under_eye_l[..., :3], [0.299, 0.587, 0.114])))
        cheek_lum = float(np.mean(np.dot(roi_left_cheek[..., :3], [0.299, 0.587, 0.114])))
        legacy_dark_circles = round(min(90.0, max(0.0, (cheek_lum - eye_lum) / max(cheek_lum, 1.0) * 220.0)), 1)
    return {
        "skin_tone": None,
        "undertone": None,
        "hex_color": None,
        "smoothness_score": legacy_smoothness,
        "uniformity_score": None,
        "dark_circles_index": legacy_dark_circles,
        "oiliness_score": None,
        "redness_score": None,
        "measurement_available": regions["left_cheek"] is not None and regions["right_cheek"] is not None,
        "observation_only": True,
        "legacy_scores_deprecated": True,
        "measurement_coverage": len(available_regions),
        "regions": available_regions,
        "cheek_texture_variation_pct": round(float(np.median(texture_values)), 2) if texture_values else None,
        "left_right_cheek_luminance_difference_pct": cheek_difference,
        "forehead_vs_cheek_luminance_difference_pct": relative(forehead_lum, cheek_mean),
        "under_eye_vs_cheek_luminance_difference_pct": relative(under_eye_lum, cheek_mean),
        "skin_health_evaluation": "Chỉ mô tả độ sáng và biến thiên pixel trong các vùng ảnh lấy mẫu. Không suy ra tông da, dầu, mụn, sắc tố, quầng thâm hay sức khỏe da; bóng, trang điểm, camera và ánh sáng đều ảnh hưởng kết quả. Hai vùng dưới mắt giúp đối chiếu ảnh, nhưng không xác định nguyên nhân vùng tối."
    }


# =========================================================================
# 6. KIỂU TÓC & LỜI KHUYÊN KHẮC PHỤC KHUYẾT ĐIỂM THỰC TẾ
# =========================================================================

def analyze_hair_and_hairline(
    image_pil: Image.Image,
    points: List[FaceAnalyzerPoint],
    face_shape: str,
    trichion_data: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Avoid inferring hairline or hair color from a face-only mesh crop."""
    del image_pil, points, face_shape, trichion_data
    return {
        "dominant_hair_color": "Không xác định từ vùng ảnh hiện có",
        "hairline_type": "Chân tóc nằm ngoài vùng Face Mesh nên chưa được đo",
        "hair_recommendations": {
            "for_men": None,
            "for_women": None,
            "stylist_advice": "Không có một kiểu tóc tối ưu duy nhất được suy ra từ tỷ lệ 2D; hãy chọn theo sở thích và sự thoải mái."
        }
    }


# =========================================================================
# 7. PHÂN TÍCH SỐ ĐO HÌNH HỌC Ở GÓC NGHIÊNG
# =========================================================================

def analyze_profile_view(
    points: List[FaceAnalyzerPoint],
    img_w: int,
    img_h: int,
    pose_quality: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Report image-space profile measurements without clinical or beauty labels."""
    del img_w, img_h
    pronasale = points[1]
    subnasale = points[2]
    labrale_sup = points[0]
    labrale_inf = points[17]
    chin_boundary = points[152]
    nasion = points[168]

    # This is only an image-orientation hint; mirrored cameras can reverse it.
    dist_l = abs(points[234].px - pronasale.px)
    dist_r = abs(points[454].px - pronasale.px)
    is_left_profile = dist_l < dist_r
    jaw_contour = points[172] if is_left_profile else points[397]
    side_boundary = points[234] if is_left_profile else points[454]
    face_scale = dist_2d(nasion, chin_boundary) + 1e-6

    def signed_offset_pct(point: FaceAnalyzerPoint, start: FaceAnalyzerPoint, end: FaceAnalyzerPoint) -> float:
        # Sign is relative to image coordinates and changes with point order/mirroring.
        dx, dy = end.px - start.px, end.py - start.py
        cross = dx * (point.py - start.py) - dy * (point.px - start.px)
        return round(cross / max(math.hypot(dx, dy), 1e-6) / face_scale * 100.0, 2)

    upper_lip_offset = signed_offset_pct(labrale_sup, pronasale, chin_boundary)
    lower_lip_offset = signed_offset_pct(labrale_inf, pronasale, chin_boundary)
    nasolabial_angle = angle_between_points(pronasale, subnasale, labrale_sup)
    rhinion = points[6]
    bridge_offset_pct = signed_offset_pct(rhinion, nasion, pronasale)
    contour_angle = angle_between_points(side_boundary, jaw_contour, chin_boundary)
    pose = pose_quality or {}

    return {
        "profile_aesthetic_score": None,
        "view_side": "Bên trái trong ảnh (có thể bị đảo bởi camera)" if is_left_profile else "Bên phải trong ảnh (có thể bị đảo bởi camera)",
        "pose_yaw_deg": pose.get("yaw_deg"),
        "pose_roll_deg": pose.get("roll_deg"),
        "measurement_note": "Các số đo là hình học 2D trên ảnh, không phải chỉ định nha khoa hay chẩn đoán cấu trúc xương. Mốc 152 là rìa dưới Face Mesh, không phải điểm cằm lâm sàng; dấu +/- phụ thuộc hướng điểm và ảnh có thể bị lật.",
        "ricketts_eline": {
            "reference_name": "Đường nối chóp mũi với rìa dưới Face Mesh ở cằm (tham chiếu 2D)",
            "chin_projection": "Chỉ báo khoảng lệch môi so với đường tham chiếu; không phân loại cằm nhô/lẹm.",
            "chin_comment": "Không suy ra vị trí xương hàm hoặc chuẩn thẩm mỹ từ một ảnh 2D.",
            "upper_lip_offset_px": round(point_line_distance(labrale_sup, pronasale, chin_boundary), 1),
            "lower_lip_offset_px": round(point_line_distance(labrale_inf, pronasale, chin_boundary), 1),
            "upper_lip_offset_pct": upper_lip_offset,
            "lower_lip_offset_pct": lower_lip_offset,
            "score": None
        },
        "nasolabial_angle_deg": round(nasolabial_angle, 1),
        "nasolabial_status": "Góc tạo bởi các mốc chóp mũi, chân mũi và môi trên; ảnh hưởng bởi biểu cảm và góc máy.",
        "nasal_bridge_profile": {
            "type": None,
            "rhinion_offset_pct": bridge_offset_pct,
            "description": "Độ lệch có dấu của mốc sống mũi giữa so với đường nối gốc mũi và chóp mũi; chỉ là quan sát 2D."
        },
        "profile_gonial_angle_deg": round(contour_angle, 1),
        "profile_jaw_description": f"Góc tại mốc đường viền hàm trong ảnh: {round(contour_angle, 1)}°. Đây không phải góc xương hàm lâm sàng.",
        "visual_guides": {
            "eline": [
                {"x": round(pronasale.px, 1), "y": round(pronasale.py, 1)},
                {"x": round(chin_boundary.px, 1), "y": round(chin_boundary.py, 1)}
            ],
            "nasolabial_rays": [
                {"x": round(pronasale.px, 1), "y": round(pronasale.py, 1)},
                {"x": round(subnasale.px, 1), "y": round(subnasale.py, 1)},
                {"x": round(labrale_sup.px, 1), "y": round(labrale_sup.py, 1)}
            ],
            "jaw_profile_triangle": [
                {"x": round(side_boundary.px, 1), "y": round(side_boundary.py, 1)},
                {"x": round(jaw_contour.px, 1), "y": round(jaw_contour.py, 1)},
                {"x": round(chin_boundary.px, 1), "y": round(chin_boundary.py, 1)}
            ]
        }
    }


# =========================================================================
# 8. GIỮ RIÊNG SỐ ĐO CHÍNH DIỆN VÀ GÓC NGHIÊNG
# =========================================================================

def _pose_quality(points: List[FaceAnalyzerPoint], img_w: int, img_h: int) -> Dict[str, Any]:
    """Estimate capture pose from normalized Face Mesh geometry for quality gating."""
    cheek_width = max(abs(points[454].x - points[234].x), 1e-6)
    yaw_signed = math.degrees(math.atan2(points[234].z - points[454].z, cheek_width))
    yaw = abs(yaw_signed)
    eye_dx = (points[263].x - points[33].x) * img_w
    eye_dy = (points[263].y - points[33].y) * img_h
    roll = math.degrees(math.atan2(eye_dy, max(1e-6, abs(eye_dx))))
    face_height = abs(points[152].y - points[10].y)
    clipped = any(
        p.x < 0.015 or p.x > 0.985 or p.y < 0.015 or p.y > 0.985
        for p in (points[10], points[152], points[234], points[454])
    )
    return {
        "yaw_deg": round(yaw, 1),
        "yaw_signed_deg": round(yaw_signed, 1),
        "roll_deg": round(roll, 1),
        "face_height_fraction": round(face_height, 3),
        "clipped": clipped,
        "image_width": img_w,
        "image_height": img_h,
    }


def _front_quality_warnings(quality: Dict[str, Any]) -> List[str]:
    warnings = []
    if quality["yaw_deg"] > 10:
        warnings.append("Ảnh chính diện hơi quay; độ cân xứng có thể sai lệch.")
    if abs(quality["roll_deg"]) > 8:
        warnings.append("Đầu nghiêng sang một bên; các phép đo ngang có thể thiếu ổn định.")
    if quality["clipped"]:
        warnings.append("Một phần khuôn mặt sát mép ảnh; phép đo đường viền có thể thiếu chính xác.")
    if quality["face_height_fraction"] < 0.25:
        warnings.append("Khuôn mặt chiếm ít diện tích ảnh; hãy chụp gần hơn và đủ sáng.")
    if min(quality["image_width"], quality["image_height"]) < 320:
        warnings.append("Độ phân giải ảnh thấp; các phép đo chi tiết có độ tin cậy hạn chế.")
    return warnings


def _measurement_confidence(
    quality: Dict[str, Any],
    expected_yaw: Tuple[float, float] = (0.0, 5.0)
) -> int:
    """Estimate capture suitability, never a score for a person's appearance."""
    yaw = float(quality.get("yaw_deg", 0.0))
    yaw_excess = max(0.0, expected_yaw[0] - yaw, yaw - expected_yaw[1])
    roll_excess = max(0.0, abs(float(quality.get("roll_deg", 0.0))) - 3.0)
    face_height = float(quality.get("face_height_fraction", 0.0))
    resolution = min(int(quality.get("image_width", 0)), int(quality.get("image_height", 0)))
    penalty = min(35.0, yaw_excess * 2.2) + min(24.0, roll_excess * 2.0)
    penalty += 25.0 if quality.get("clipped") else 0.0
    penalty += min(25.0, max(0.0, 0.35 - face_height) * 100.0)
    penalty += 18.0 if resolution < 320 else 8.0 if resolution < 640 else 0.0
    return max(0, min(100, round(100.0 - penalty)))


def _confidence_label(score: int) -> str:
    if score >= 80:
        level = "cao"
    elif score >= 55:
        level = "vừa"
    else:
        level = "thấp"
    return f"Độ tin cậy phép đo {level} (ước lượng nội bộ, chưa hiệu chuẩn thống kê); điểm phản ánh chất lượng ảnh và tư thế, không đánh giá ngoại hình."

def run_multi_view_face_analysis(
    frontal_b64: str,
    frontal_landmarks: List[Dict[str, float]],
    profile_b64: str,
    profile_landmarks: List[Dict[str, float]],
    img_width: int,
    img_height: int
) -> Dict[str, Any]:
    """Keep front and side measurements separate; profile data does not redefine the face."""
    frontal_result = run_comprehensive_face_analysis(
        image_base64=frontal_b64,
        landmarks_data=frontal_landmarks,
        img_width=img_width,
        img_height=img_height
    )
    if not frontal_result.get("success"):
        return frontal_result

    actual_w, actual_h = img_width, img_height
    try:
        clean_b64 = profile_b64.split(",", 1)[1] if "," in profile_b64 else profile_b64
        p_bytes = base64.b64decode(clean_b64)
        p_img = Image.open(io.BytesIO(p_bytes))
        actual_w, actual_h = p_img.size
    except Exception:
        pass

    profile_points = [
        FaceAnalyzerPoint(p.get("x", 0), p.get("y", 0), p.get("z", 0), actual_w, actual_h)
        for p in profile_landmarks
    ]
    profile_warning = None
    profile_analysis = None
    profile_pose = None
    profile_confidence = None
    if len(profile_points) >= 468 and any(
        not all(math.isfinite(value) for value in (point.x, point.y, point.z)) for point in profile_points
    ):
        profile_warning = "Điểm mốc ảnh nghiêng chứa giá trị không hợp lệ; chưa thể đo góc nghiêng."
    elif len(profile_points) >= 468:
        profile_pose = _pose_quality(profile_points, actual_w, actual_h)
        if not 15 <= profile_pose["yaw_deg"] <= 40:
            profile_warning = "Góc quay của ảnh nghiêng nằm ngoài khoảng đo tham khảo 15–40°; chưa hiển thị các số đo góc nghiêng."
        elif abs(profile_pose["roll_deg"]) > 12 or profile_pose["clipped"]:
            profile_warning = "Ảnh nghiêng bị nghiêng đầu hoặc khuôn mặt sát mép ảnh; chưa hiển thị các số đo góc nghiêng."
        else:
            profile_analysis = analyze_profile_view(profile_points, actual_w, actual_h, profile_pose)
            profile_confidence = _measurement_confidence(profile_pose, expected_yaw=(15.0, 40.0))
            profile_analysis["measurement_confidence_score"] = profile_confidence
            profile_analysis["measurement_confidence_label"] = _confidence_label(profile_confidence)
    else:
        profile_warning = "Thiếu điểm mốc ở ảnh nghiêng; chưa thể đo góc nghiêng."

    quality = frontal_result["measurement_quality"]
    quality["profile_pose"] = profile_pose
    quality["profile_confidence_score"] = profile_confidence
    quality["profile_used"] = profile_analysis is not None
    if profile_warning:
        quality["warnings"].append(profile_warning)
    else:
        quality["warnings"].append("Các số đo góc nghiêng được giữ riêng, không gộp với tỷ lệ chính diện hoặc điểm tin cậy chính diện.")
    frontal_result["profile"] = profile_analysis
    frontal_result["is_multi_view"] = profile_analysis is not None
    return frontal_result
# =========================================================================
# 9. HÀM TỔNG HỢP: PHÂN TÍCH ẢNH KHUÔN MẶT
# =========================================================================

def run_comprehensive_face_analysis(
    image_base64: str,
    landmarks_data: List[Dict[str, float]],
    img_width: int,
    img_height: int
) -> Dict[str, Any]:
    """
    Điểm vào trung tâm (Pipeline entry):
    Đánh giá CÔNG BẰNG, KHÁCH QUAN, KHOA HỌC NHÂN TRẮC HỌC, KHÔNG NỊNH NỌT.
    Thang điểm chuẩn: 60 - 75 là mức trung bình của đa số người thật.
    """
    try:
        if "," in image_base64:
            image_base64 = image_base64.split(",", 1)[1]
        img_bytes = base64.b64decode(image_base64)
        pil_img = Image.open(io.BytesIO(img_bytes))
        w, h = pil_img.size
    except Exception as e:
        return {
            "success": False,
            "error": f"Không thể giải mã hình ảnh snapshot: {str(e)}"
        }

    # The encoded snapshot is authoritative; it must match pixel ROI coordinates.
    actual_w, actual_h = w, h

    points = [FaceAnalyzerPoint(p.get("x", 0), p.get("y", 0), p.get("z", 0), actual_w, actual_h) for p in landmarks_data]
    if len(points) < 468:
        return {
            "success": False,
            "error": "Dữ liệu khuôn mặt không đủ 468 điểm mốc để phân tích chính xác."
        }
    if any(not all(math.isfinite(value) for value in (point.x, point.y, point.z)) for point in points):
        return {"success": False, "error": "Điểm mốc chứa giá trị không hợp lệ. Hãy chụp lại ảnh."}
    if (dist_2d(points[234], points[454]) < max(8, actual_w * .03)
            or dist_2d(points[10], points[152]) < max(8, actual_h * .05)
            or dist_2d(points[33], points[263]) < max(4, actual_w * .01)):
        return {"success": False, "error": "Các điểm mốc không tạo thành khuôn mặt đủ rõ để đo. Hãy chụp gần hơn và nhìn thẳng."}

    quality = _pose_quality(points, actual_w, actual_h)
    quality_warnings = _front_quality_warnings(quality)

    # Trả về số đo ảnh và quan sát pixel, không xếp hạng ngoại hình.
    symmetry = analyze_facial_symmetry(points, actual_w, actual_h)
    proportions = analyze_facial_proportions(points, actual_w, actual_h, pil_img)
    nose = analyze_nose_proportions(points, actual_w, actual_h)
    jawline = analyze_jawline_and_chin(points, actual_w, actual_h, quality)
    skin = analyze_skin_condition(pil_img, points)
    hair = analyze_hair_and_hairline(pil_img, points, proportions["face_shape"], proportions.get("trichion"))

    confidence_score = _measurement_confidence(quality)
    if not skin.get("measurement_available", True):
        quality_warnings.append("Một số vùng ảnh không đủ dữ liệu để đo biến thiên pixel của da.")
    overall_grade = _confidence_label(confidence_score)

    visual_guide_lines = {
        "midline": [
            {"x": symmetry["midline_axis"]["top"]["x"], "y": symmetry["midline_axis"]["top"]["y"]},
            {"x": symmetry["midline_axis"]["bottom"]["x"], "y": symmetry["midline_axis"]["bottom"]["y"]}
        ],
        "thirds_lines": [
            {"name": "Rìa Face Mesh", "y": round(proportions.get("trichion", {}).get("py", points[10].py), 1)},
            {"name": "Chân mày", "y": round(points[9].py, 1)},
            {"name": "Chân mũi", "y": round(points[2].py, 1)},
            {"name": "Đáy cằm", "y": round(points[152].py, 1)}
        ],
        "jawline_polygon": [
            {"x": round(points[172].px, 1), "y": round(points[172].py, 1)},
            {"x": round(points[152].px, 1), "y": round(points[152].py, 1)},
            {"x": round(points[397].px, 1), "y": round(points[397].py, 1)}
        ],
        "nose_triangle": [
            {"x": round(points[168].px, 1), "y": round(points[168].py, 1)},
            {"x": round(points[102].px, 1), "y": round(points[102].py, 1)},
            {"x": round(points[331].px, 1), "y": round(points[331].py, 1)}
        ]
    }

    return {
        "success": True,
        "measurement_confidence_score": confidence_score,
        # Compatibility alias for older clients; this no longer describes appearance.
        "overall_harmony_score": confidence_score,
        "overall_grade": overall_grade,
        "symmetry": symmetry,
        "proportions": proportions,
        "nose": nose,
        "jawline": jawline,
        "skin": skin,
        "hair": hair,
        "visual_guides": visual_guide_lines,
        "metadata": {
            "image_width": actual_w,
            "image_height": actual_h,
            "landmarks_count": len(points)
        },
        "measurement_quality": {
            "label": "Chỉ báo nội bộ về độ phù hợp của ảnh và tư thế; chưa hiệu chuẩn thống kê, không đánh giá ngoại hình hay sức khỏe.",
            "front_pose": quality,
            "front_confidence_score": confidence_score,
            "warnings": quality_warnings,
            "profile_used": False
        }
    }
