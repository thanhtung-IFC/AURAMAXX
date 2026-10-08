"""
Module: face_aesthetic_analyzer.py
Mô tả: Hệ thống phân tích nhân trắc học thẩm mỹ và sinh trắc học khuôn mặt từ ảnh chụp tĩnh.
Tiêu chí: ĐÁNH GIÁ CÔNG BẰNG, KHÁCH QUAN, KHOA HỌC, KHÔNG NỊNH NỌT, PHÂN TÍCH RÕ ƯU VÀ NHƯỢC ĐIỂM.
Bao gồm:
1. Độ cân đối khuôn mặt (Facial Symmetry - Đo độ bất đối xứng tự nhiên)
2. Tỷ lệ khuôn mặt (Rule of Thirds, Rule of Fifths, fWHR, Tỷ lệ vàng, Dáng mặt)
3. Tỷ lệ mũi (Nose Proportions, Alar Width, Bridge Deviation, Thẳng/Lệch)
4. Đường viền hàm & Cằm (Jawline Angle, Bigonial Width, Chin Sharpness, Bạnh/Thon)
5. Tình trạng da (Skin Tone, Smoothness, Uniformity, Dark Circles, Oiliness, Redness)
6. Kiểu tóc & Chân tóc (Hairline Shape, Hair Color, Lời khuyên khắc phục khuyết điểm)
Tác giả: VisionAI Team
"""

import base64
import io
import math
from typing import Dict, Any, List, Tuple, Optional

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

    # Tâm mắt an toàn cho cả chuẩn 468 điểm (không iris) và 478 điểm (có iris)
    has_iris = len(points) >= 478
    if has_iris:
        eye_center_l = points[468]
        eye_center_r = points[473]
    else:
        eye_center_l = FaceAnalyzerPoint(
            (points[159].x + points[145].x) / 2.0,
            (points[159].y + points[145].y) / 2.0,
            0.0, img_w, img_h
        )
        eye_center_r = FaceAnalyzerPoint(
            (points[386].x + points[374].x) / 2.0,
            (points[386].y + points[374].y) / 2.0,
            0.0, img_w, img_h
        )

    # Các cặp đối xứng quan trọng và trọng số
    pairs = [
        ("Mắt (Tâm đồng tử)", eye_center_l, eye_center_r, 1.25),
        ("Khóe mắt ngoài", points[33], points[362], 1.0),
        ("Khóe mắt trong", points[133], points[263], 1.0),
        ("Gò má", points[234], points[454], 1.15),
        ("Cánh mũi", points[102], points[331], 1.05),
        ("Khóe miệng", points[61], points[291], 1.1),
        ("Góc xương hàm", points[172], points[397], 1.2),
        ("Đuôi chân mày", points[70], points[300], 0.85)
    ]

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

        # Ghi nhận khuyết điểm nếu độ lệch đáng chú ý
        if diff_px > 4.5:
            side = "bên phải xa trục hơn" if dist_r > dist_l else "bên trái xa trục hơn"
            asymmetry_flaws.append(f"{name} lệch {round(diff_px, 1)}px ({side})")

        details.append({
            "feature": name,
            "score": round(sym_score, 1),
            "left_dist_px": round(dist_l, 1),
            "right_dist_px": round(dist_r, 1),
            "diff_px": round(diff_px, 1)
        })

    # Độ lệch cao độ hai mắt (Eye Level Tilt)
    eye_dy = eye_center_r.py - eye_center_l.py
    eye_dx = eye_center_r.px - eye_center_l.px
    eye_tilt_deg = math.degrees(math.atan2(eye_dy, eye_dx))

    overall_score = round(weighted_symmetry / total_weight, 1)

    # Đánh giá công bằng, trung thực
    if overall_score >= 88.0 and abs(eye_tilt_deg) <= 0.8:
        level = "Cân đối rất cao (Thuộc nhóm 10% người có khuôn mặt ít lệch nhất)"
        feedback = "Khuôn mặt có sự đồng đều đáng kể giữa hai nửa bán cầu mặt."
    elif overall_score >= 76.0:
        level = "Cân đối mức trung bình khá (Đặc trưng tự nhiên phổ biến)"
        feedback = "Có độ bất đối xứng nhẹ ở mức người bình thường, không ảnh hưởng thẩm mỹ tổng thể."
    elif overall_score >= 64.0:
        level = "Có độ lệch nhẹ nhận thấy được"
        feedback = "Hai bên mặt có sự chênh lệch rõ ở khung hàm hoặc trục mắt, thường do thói quen nhai một bên hoặc ngủ nghiêng."
    else:
        level = "Bất đối xứng đáng kể"
        feedback = "Trục khuôn mặt có sự sai lệch rõ rệt giữa hai bên, cần chú ý góc đặt máy ảnh thẳng chính diện hoặc điều chỉnh thói quen cơ mặt."

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
# 2. TỶ LỆ KHUÔN MẶT & DÁNG MẶT (FACIAL PROPORTIONS - PHÂN TÍCH TRUNG THỰC)
# =========================================================================

def analyze_facial_proportions(points: List[FaceAnalyzerPoint], img_w: int, img_h: int) -> Dict[str, Any]:
    """
    Quy tắc 3 phần (Rule of Thirds), Tỷ lệ vàng (fWHR) và dáng mặt.
    Đánh giá thẳng thắn về trán dô/ngắn, cằm lẹm/dài, khuôn mặt bạnh/gầy.
    """
    forehead_top = points[10]       # Chân tóc / đỉnh trán
    glabella = points[9]            # Chân mày
    subnasale = points[2]           # Chân mũi
    chin_bot = points[152]          # Đáy cằm

    upper_h = dist_2d(forehead_top, glabella)
    middle_h = dist_2d(glabella, subnasale)
    lower_h = dist_2d(subnasale, chin_bot)
    total_h = upper_h + middle_h + lower_h + 1e-6

    upper_pct = round((upper_h / total_h) * 100.0, 1)
    middle_pct = round((middle_h / total_h) * 100.0, 1)
    lower_pct = round((lower_h / total_h) * 100.0, 1)

    # Đánh giá thẳng thắn từng tầng mặt
    thirds_analysis = []
    if upper_pct > 36.5:
        thirds_analysis.append(f"Tầng trên (Trán) chiếm {upper_pct}% (hơi cao/dài so với chuẩn 33.3%, trán dô hoặc đường chân tóc cao)")
    elif upper_pct < 29.5:
        thirds_analysis.append(f"Tầng trên (Trán) chỉ chiếm {upper_pct}% (trán ngắn/hẹp, tạo cảm giác mặt thấp)")

    if middle_pct > 37.0:
        thirds_analysis.append(f"Tầng giữa (Mũi) dài ({middle_pct}%), sống mũi dài")
    elif middle_pct < 29.5:
        thirds_analysis.append(f"Tầng giữa ngắn ({middle_pct}%), trục giữa khuôn mặt bị nén")

    if lower_pct > 36.5:
        thirds_analysis.append(f"Tầng dưới (Cằm) dài ({lower_pct}%), cằm phát triển dài hoặc nhô")
    elif lower_pct < 29.5:
        thirds_analysis.append(f"Tầng dưới (Cằm) ngắn ({lower_pct}%), cằm hơi lẹm hoặc khoảng cách mũi-cằm hẹp")

    if not thirds_analysis:
        thirds_analysis.append("Cả 3 tầng phân bổ khá đồng đều, bám sát tỷ lệ chuẩn 1:1:1.")

    # Điểm hài hòa 3 tầng (chặt chẽ)
    dev_3rds = abs(upper_pct - 33.33) + abs(middle_pct - 33.33) + abs(lower_pct - 33.33)
    thirds_harmony = round(max(40.0, min(98.0, 100.0 - dev_3rds * 3.8)), 1)

    # Chiều dài và chiều rộng khuôn mặt (fWHR)
    face_length = dist_2d(forehead_top, chin_bot)
    cheekbone_width = dist_2d(points[234], points[454]) + 1e-6
    ratio_hw = round(face_length / cheekbone_width, 2)
    golden_diff = round(abs(ratio_hw - 1.618), 2)
    golden_score = round(max(40.0, min(98.0, 100.0 - golden_diff * 60.0)), 1)

    # Chiều rộng trán và hàm
    forehead_w = dist_2d(points[103], points[332])
    cheek_w = cheekbone_width
    jaw_w = dist_2d(points[172], points[397])

    # Xác định hình dáng khuôn mặt và đánh giá ưu/nhược
    if ratio_hw > 1.58:
        face_shape = "Mặt Dài / Chữ Nhật (Oblong)"
        shape_desc = "Chiều dài khuôn mặt áp đảo chiều ngang. Nhược điểm: Dễ tạo cảm giác mặt gầy hoặc già dặn nếu không có tóc mái cân đối lại."
    elif ratio_hw < 1.22:
        if jaw_w / cheek_w > 0.84:
            face_shape = "Mặt Vuông (Square)"
            shape_desc = "Khung xương hàm bạnh, góc cạnh rõ rệt. Ưu điểm: Cá tính, sắc nét. Nhược điểm: Thiếu sự mềm mại, viền hàm dưới hơi thô."
        else:
            face_shape = "Mặt Tròn (Round)"
            shape_desc = "Chiều dài và chiều rộng gần bằng nhau, viền má bầu bĩnh. Ưu điểm: Trẻ lâu, phúc hậu. Nhược điểm: Thiếu góc cạnh và độ thanh thoát V-line."
    elif forehead_w > cheek_w * 0.95 and jaw_w < cheek_w * 0.72:
        face_shape = "Mặt Trái Tim (Heart)"
        shape_desc = "Trán rộng nổi bật trong khi cằm nhọn và hàm hẹp. Cần cân đối phần tóc gần cằm để giảm sự tương phản trán-cằm."
    elif cheek_w > forehead_w * 1.15 and cheek_w > jaw_w * 1.25:
        face_shape = "Mặt Kim Cương (Diamond)"
        shape_desc = "Gò má cao và rộng nhất, trán và cằm đều hẹp. Ưu điểm: Góc cạnh thời trang. Nhược điểm: Gò má hơi nhô nếu mặt gầy."
    else:
        face_shape = "Mặt Trái Xoan (Oval)"
        shape_desc = "Dáng mặt cân đối chuẩn mực, đường viền thon gọn, không có khuyết điểm góc cạnh nổi cộm."

    return {
        "face_shape": face_shape,
        "face_shape_description": shape_desc,
        "rule_of_thirds": {
            "upper_third_pct": upper_pct,
            "middle_third_pct": middle_pct,
            "lower_third_pct": lower_pct,
            "harmony_score": thirds_harmony,
            "honest_evaluation": " • ".join(thirds_analysis)
        },
        "length_to_width_ratio": ratio_hw,
        "golden_ratio_target": 1.618,
        "golden_ratio_fit_score": golden_score,
        "dimensions_px": {
            "face_length": round(face_length, 1),
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
    Đánh giá trung thực: Cánh mũi có bè to không? Sống mũi có bị lệch vách ngăn không?
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

    # Độ lệch sống mũi
    deviation_px = point_line_distance(nose_tip, nasion, subnasale)

    # Đánh giá trục sống mũi thẳng hay vẹo
    if abs(deviation_px) < 1.8:
        bridge_status = "Sống mũi thẳng, trục giữa chuẩn"
        dev_comment = "Không phát hiện độ vẹo vách ngăn rõ rệt."
    elif deviation_px > 0:
        bridge_status = f"Sống mũi lệch sang PHẢI ({round(abs(deviation_px), 1)}px)"
        dev_comment = "Đỉnh chóp mũi có xu hướng lệch sang bên phải trục mặt (nghi vấn lệch nhẹ vách ngăn hoặc sống mũi cong)."
    else:
        bridge_status = f"Sống mũi lệch sang TRÁI ({round(abs(deviation_px), 1)}px)"
        dev_comment = "Đỉnh chóp mũi có xu hướng lệch sang bên trái trục mặt."

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
    dev_penalty = abs(deviation_px) * 3.5

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
        "bridge_deviation_px": round(abs(deviation_px), 1)
    }


# =========================================================================
# 4. ĐƯỜNG VIỀN HÀM & CẰM (JAWLINE & CHIN - ĐÁNH GIÁ CHÂN THỰC)
# =========================================================================

def analyze_jawline_and_chin(points: List[FaceAnalyzerPoint], img_w: int, img_h: int) -> Dict[str, Any]:
    """
    Phân tích góc xương hàm (Gonial Angle), tỷ lệ gò má/hàm và hình thái cằm.
    """
    chin = points[152]
    jaw_l = points[172]
    jaw_r = points[397]
    ear_l = points[234]
    ear_r = points[454]

    angle_l = angle_between_points(ear_l, jaw_l, chin)
    angle_r = angle_between_points(ear_r, jaw_r, chin)
    avg_jaw_angle = round((angle_l + angle_r) / 2.0, 1)

    jaw_w = dist_2d(jaw_l, jaw_r)
    cheek_w = dist_2d(ear_l, ear_r) + 1e-6
    ratio_jaw_cheek = round(jaw_w / cheek_w, 2)

    chin_angle = angle_between_points(jaw_l, chin, jaw_r)

    # Đánh giá hình thái cằm thẳng thắn
    if chin_angle < 82.0:
        chin_type = "Cằm V-line nhọn sắc nét"
        chin_flaw = "Cằm rất nhọn, nếu mặt gầy có thể tạo cảm giác sắc sảo."
    elif chin_angle < 96.0:
        chin_type = "Cằm thon gọn tự nhiên"
        chin_flaw = "Độ nhọn và độ mở cằm cân bằng tốt."
    elif chin_angle < 112.0:
        chin_type = "Cằm tròn đầy đặn"
        chin_flaw = "Cằm tròn, thiếu độ sắc nét góc cạnh, dễ lộ nọng nếu tăng cân."
    else:
        chin_type = "Cằm vuông / bạnh ngang"
        chin_flaw = "Đáy cằm phẳng và ngang, làm phần dưới khuôn mặt trông nặng nề."

    # Đánh giá góc xương hàm
    if avg_jaw_angle < 118.0:
        jawline_desc = f"Góc hàm bạnh ({avg_jaw_angle}° < 120°): Khung xương hàm phát triển vuông vức, viền hàm thô."
        sharpness_score = round(max(45.0, 75.0 - (120.0 - avg_jaw_angle) * 2.0), 1)
    elif avg_jaw_angle <= 130.0:
        jawline_desc = f"Góc hàm chuẩn ({avg_jaw_angle}°): Viền hàm có độ dốc thanh thoát, bám sát góc tỷ lệ nhân trắc học."
        sharpness_score = round(max(75.0, min(95.0, 95.0 - abs(avg_jaw_angle - 125.0) * 2.0)), 1)
    else:
        jawline_desc = f"Góc hàm mở rộng ({avg_jaw_angle}° > 130°): Đường viền hàm phẳng, thiếu góc cạnh định hình rõ nét."
        sharpness_score = round(max(50.0, 80.0 - (avg_jaw_angle - 130.0) * 2.5), 1)

    return {
        "average_jaw_angle_deg": avg_jaw_angle,
        "jaw_angle_left_deg": round(angle_l, 1),
        "jaw_angle_right_deg": round(angle_r, 1),
        "chin_type": chin_type,
        "chin_flaw": chin_flaw,
        "chin_apex_angle_deg": round(chin_angle, 1),
        "jaw_to_cheek_ratio": ratio_jaw_cheek,
        "jawline_sharpness_score": sharpness_score,
        "jawline_evaluation": jawline_desc
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


def analyze_skin_condition(image_pil: Image.Image, points: List[FaceAnalyzerPoint]) -> Dict[str, Any]:
    """
    Phân tích pixel thực tế: Quầng thâm, lỗ chân lông/độ sần sùi, dầu nhờn T-zone, mẩn đỏ.
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

    valid_rois = [r for r in [roi_left_cheek, roi_right_cheek, roi_forehead] if r is not None and r.size > 0]
    if not valid_rois:
        return {
            "skin_tone": "Không rõ",
            "smoothness_score": 65.0,
            "uniformity_score": 65.0,
            "dark_circles_index": 25.0,
            "oiliness_score": 30.0,
            "redness_score": 20.0,
            "skin_health_evaluation": "Chưa đủ điều kiện ánh sáng để đo chính xác bề mặt da."
        }

    combined_skin = np.concatenate([r.reshape(-1, 3) for r in valid_rois], axis=0)
    mean_r, mean_g, mean_b = np.mean(combined_skin, axis=0)

    luminance = 0.299 * mean_r + 0.587 * mean_g + 0.114 * mean_b

    if luminance > 185:
        skin_tone = "Trắng Sáng (Fair / Light)"
    elif luminance > 150:
        skin_tone = "Trắng Tự Nhiên / Trung Tính (Medium Fair)"
    elif luminance > 120:
        skin_tone = "Tự Nhiên / Bánh Mật (Natural Olive / Tan)"
    else:
        skin_tone = "Ngăm Khỏe Khoắn (Deep / Warm Tan)"

    if mean_r > mean_b + 28:
        undertone = "Tông Ấm (Warm Undertone)"
    elif mean_b > mean_g - 5:
        undertone = "Tông Lạnh (Cool Undertone)"
    else:
        undertone = "Tông Trung Tính (Neutral Undertone)"

    # Đo độ mịn màng thực tế qua độ lệch chuẩn và độ nhám bề mặt (Texture variance)
    gray_cheek = np.dot(roi_left_cheek[...,:3], [0.299, 0.587, 0.114]) if roi_left_cheek is not None else np.zeros((10,10))
    std_dev = np.std(gray_cheek)
    # Không áp trần ảo: std_dev cao do lỗ chân lông to hoặc sần sùi sẽ bị trừ điểm thực tế
    smoothness_score = round(max(35.0, min(95.0, 95.0 - std_dev * 3.2)), 1)

    # Đo độ đồng đều sắc tố giữa các vùng
    means = [np.mean(r, axis=(0,1)) for r in valid_rois]
    diff_between_zones = np.max([np.linalg.norm(m1 - m2) for m1 in means for m2 in means])
    uniformity_score = round(max(40.0, min(95.0, 95.0 - diff_between_zones * 2.2)), 1)

    # Quầng thâm mắt
    dark_circles_index = 15.0
    if roi_under_eye_l is not None and roi_left_cheek is not None:
        eye_lum = np.mean(0.299 * roi_under_eye_l[...,0] + 0.587 * roi_under_eye_l[...,1] + 0.114 * roi_under_eye_l[...,2])
        cheek_lum = np.mean(gray_cheek)
        if cheek_lum > eye_lum:
            ratio_dark = (cheek_lum - eye_lum) / cheek_lum
            dark_circles_index = round(min(90.0, ratio_dark * 220.0), 1)

    # Độ bóng nhờn vùng trán (T-zone)
    oiliness_score = 15.0
    if roi_forehead is not None:
        forehead_gray = np.dot(roi_forehead[...,:3], [0.299, 0.587, 0.114])
        shiny_pixels = np.sum(forehead_gray > 215)
        oiliness_score = round(min(90.0, (shiny_pixels / forehead_gray.size) * 400.0 + 8.0), 1)

    # Đánh giá da chân thật, chỉ rõ khuyết điểm
    skin_flaws = []
    if dark_circles_index > 35.0:
        skin_flaws.append(f"Quầng thâm mắt rõ ({dark_circles_index}%), dấu hiệu thiếu ngủ hoặc mỏi mắt")
    if oiliness_score > 45.0:
        skin_flaws.append(f"Vùng chữ T nhiều dầu bóng nhờn ({oiliness_score}%)")
    if smoothness_score < 70.0:
        skin_flaws.append("Bề mặt da chưa mịn màng, có dấu hiệu lỗ chân lông to hoặc sần sùi nhẹ")
    if uniformity_score < 72.0:
        skin_flaws.append("Sắc tố da không đều giữa các vùng má và trán")

    if not skin_flaws:
        skin_health_desc = "Tình trạng da khá tốt, bề mặt sạch và sắc tố tương đối ổn định."
    else:
        skin_health_desc = "Cảnh báo khuyết điểm da: " + " • ".join(skin_flaws) + "."

    return {
        "skin_tone": skin_tone,
        "undertone": undertone,
        "hex_color": f"#{int(mean_r):02x}{int(mean_g):02x}{int(mean_b):02x}",
        "smoothness_score": smoothness_score,
        "uniformity_score": uniformity_score,
        "dark_circles_index": dark_circles_index,
        "oiliness_score": oiliness_score,
        "skin_health_evaluation": skin_health_desc
    }


# =========================================================================
# 6. KIỂU TÓC & LỜI KHUYÊN KHẮC PHỤC KHUYẾT ĐIỂM THỰC TẾ
# =========================================================================

def analyze_hair_and_hairline(image_pil: Image.Image, points: List[FaceAnalyzerPoint], face_shape: str) -> Dict[str, Any]:
    """
    Phân tích chân tóc và đưa ra lời khuyên tạo mẫu tóc để KHẮC PHỤC KHUYẾT ĐIỂM THỰC TẾ.
    """
    img_rgb = image_pil.convert("RGB")
    np_img = np.array(img_rgb)
    h, w = np_img.shape[:2]

    forehead_top = points[10]
    temple_l = points[103]
    temple_r = points[332]

    crop_y2 = int(forehead_top.py)
    crop_y1 = max(0, int(crop_y2 - (points[152].py - forehead_top.py) * 0.35))
    crop_x1 = max(0, int(temple_l.px - 20))
    crop_x2 = min(w, int(temple_r.px + 20))

    dominant_color = "Đen Tự Nhiên"
    if crop_y2 > crop_y1 and crop_x2 > crop_x1:
        hair_roi = np_img[crop_y1:crop_y2, crop_x1:crop_x2]
        if hair_roi.size > 0:
            r_mean = np.mean(hair_roi[..., 0])
            g_mean = np.mean(hair_roi[..., 1])
            b_mean = np.mean(hair_roi[..., 2])
            lum = 0.299 * r_mean + 0.587 * g_mean + 0.114 * b_mean

            if lum < 55:
                dominant_color = "Đen Tuyền"
            elif lum < 95:
                dominant_color = "Đen Tự Nhiên"
            elif r_mean > b_mean + 20 and lum < 140:
                dominant_color = "Nâu Hạt Dẻ"
            elif lum >= 140:
                dominant_color = "Nâu Sáng / Nhuộm Sáng"
            else:
                dominant_color = "Nâu Đen"

    forehead_height_ratio = forehead_top.py / max(1.0, points[152].py)
    if forehead_height_ratio > 0.33:
        hairline_type = "Đường Chân Tóc Cao / Trán Dô"
    elif abs(temple_l.py - forehead_top.py) > 22.0:
        hairline_type = "Chân Tóc Chữ M (Widow's Peak / Có dấu hiệu lùi trán 2 bên)"
    else:
        hairline_type = "Đường Chân Tóc Tròn Tiêu Chuẩn"

    # Lời khuyên tập trung sửa khuyết điểm chân thực
    recommendations_map = {
        "Mặt Tròn (Round)": {
            "nam": "Cần tạo chiều dài: Cắt sát 2 bên (Fade), vuốt phồng cao (Quiff, Pompadour). Tuyệt đối tránh để tóc mái ngố tròn che trán vì sẽ làm mặt tròn hơn.",
            "nu": "Cần che bớt má: Tóc Layer mái bay rẽ ngôi 6/4 hoặc 7/3, tóc dài xoăn sóng lơi qua vai. Tránh cắt tóc ngắn ngang cằm hoặc mái bằng dày.",
            "loi_khuyen": "Khuyết điểm của bạn là khuôn mặt thiếu chiều sâu góc cạnh. Hãy dùng kiểu tóc có độ phồng ở đỉnh đầu để kéo dài tỷ lệ khuôn mặt."
        },
        "Mặt Vuông (Square)": {
            "nam": "Cần làm mềm góc hàm bạnh: Side Part rẽ ngôi uốn nhẹ gợn sóng hoặc Quiff mềm. Tránh cạo quá vuông vức hai bên mang tai.",
            "nu": "Cần che góc hàm thô: Tóc tỉa tầng ôm sát xương hàm, tóc uốn lọn xoăn mềm mại dài ngang lưng. Tránh tóc Bob thẳng đuột ngắn chạm đúng góc hàm.",
            "loi_khuyen": "Khung xương hàm của bạn khá vuông vức. Cần dùng các đường lượn sóng mềm của tóc để trung hòa sự góc cạnh thô cứng."
        },
        "Mặt Dài / Chữ Nhật (Oblong)": {
            "nam": "Cần thu ngắn chiều dài trán: Để tóc có mái rủ (Textured Crop, Comma hair, 7/3 rủ). Tuyệt đối KHÔNG vuốt dựng cao vì sẽ làm mặt dài ngoằng.",
            "nu": "Cần che trán và tạo chiều ngang: Mái thưa Hàn Quốc, mái bằng, tóc uốn phồng xòe 2 bên tai. Tránh để tóc dài thẳng đuột không mái rẽ ngôi giữa.",
            "loi_khuyen": "Khuôn mặt bạn có chiều dài lớn hơn tỷ lệ chuẩn. Bắt buộc nên có tóc mái để che bớt trán và tạo độ phồng sang hai bên."
        },
        "Mặt Trái Tim (Heart)": {
            "nam": "Cần cân đối trán rộng và cằm nhọn: Tóc rủ mái dài vừa phải, tóc vuốt lệch phồng vừa. Tránh cạo quá trắng hai bên thái dương.",
            "nu": "Cần tăng độ đầy đặn cho vùng cằm: Tóc Bob ngang cằm uốn cụp, tóc uốn xoăn đuôi phồng ôm cằm. Tránh buộc tóc quá chặt vuốt hết ra sau.",
            "loi_khuyen": "Phần trán của bạn to bản hơn nhiều so với cằm. Hãy tập trung tạo độ bồng bềnh ở phần đuôi tóc ngang quai hàm."
        },
        "Mặt Kim Cương (Diamond)": {
            "nam": "Cần che bớt gò má cao: Side Part mái rủ, Textured Fringe rối tự nhiên. Tránh cạo sát phần thái dương vì sẽ làm gò má nhô to hơn.",
            "nu": "Mái bay dài buông nhẹ qua gò má để che xương má cao, tóc uốn lơi nhẹ nhàng. Tránh vén hết tóc sau tai.",
            "loi_khuyen": "Gò má là điểm nhô rộng nhất trên mặt bạn. Tóc mái bay nhẹ qua gò má sẽ giúp tổng thể thanh thoát hơn."
        },
        "Mặt Trái Xoan (Oval)": {
            "nam": "Dáng mặt cân đối, hợp hầu hết các kiểu: Side Part, Layer, Pompadour. Tuy nhiên cần chú ý nếu trán hơi cao thì nên để mái rủ nhẹ.",
            "nu": "Hợp hầu hết kiểu tóc: Layer mái bay, xoăn sóng, tóc ngang vai. Chọn kiểu theo phong cách cá nhân.",
            "loi_khuyen": "Khuôn mặt bạn có tỷ lệ nền tảng tốt, chỉ cần chú ý chăm sóc tóc và chọn màu nhuộm tôn da."
        }
    }

    rec = recommendations_map.get(face_shape, recommendations_map["Mặt Trái Xoan (Oval)"])

    return {
        "dominant_hair_color": dominant_color,
        "hairline_type": hairline_type,
        "hair_recommendations": {
            "for_men": rec["nam"],
            "for_women": rec["nu"],
            "stylist_advice": rec["loi_khuyen"]
        }
    }


# =========================================================================
# 7. HÀM TỔNG HỢP: COMPREHENSIVE FACE ANALYSIS (THANG ĐIỂM CHUẨN KHOA HỌC)
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

    actual_w = img_width if img_width > 0 else w
    actual_h = img_height if img_height > 0 else h

    points = [FaceAnalyzerPoint(p.get("x", 0), p.get("y", 0), p.get("z", 0), actual_w, actual_h) for p in landmarks_data]
    if len(points) < 468:
        return {
            "success": False,
            "error": "Dữ liệu khuôn mặt không đủ 468 điểm mốc để phân tích chính xác."
        }

    # Phân tích từng chuyên mục theo chuẩn nghiêm ngặt
    symmetry = analyze_facial_symmetry(points, actual_w, actual_h)
    proportions = analyze_facial_proportions(points, actual_w, actual_h)
    nose = analyze_nose_proportions(points, actual_w, actual_h)
    jawline = analyze_jawline_and_chin(points, actual_w, actual_h)
    skin = analyze_skin_condition(pil_img, points)
    hair = analyze_hair_and_hairline(pil_img, points, proportions["face_shape"])

    # Điểm hài hòa tổng thể thực tế (Không tâng bốc ảo):
    # Đối xứng (25%), Tỷ lệ 3 tầng (25%), Mũi (18%), Viền hàm (17%), Da (15%)
    harmony_score = round(
        symmetry["overall_symmetry_score"] * 0.25 +
        proportions["rule_of_thirds"]["harmony_score"] * 0.25 +
        nose["nose_aesthetic_score"] * 0.18 +
        jawline["jawline_sharpness_score"] * 0.17 +
        skin["smoothness_score"] * 0.15,
        1
    )

    # Phân loại cấp bậc chuẩn khoa học (Realistic Bell Curve)
    if harmony_score >= 85.0:
        overall_grade = "Hài Hòa Xuất Sắc (Thuộc Top 5% Tỷ Lệ Nhân Trắc Học)"
    elif harmony_score >= 75.0:
        overall_grade = "Khá Cân Đối (Đạt Chuẩn Thẩm Mỹ Tự Nhiên)"
    elif harmony_score >= 63.0:
        overall_grade = "Mức Trung Bình Phổ Biến (Tồn Tại Độ Lệch Tự Nhiên)"
    elif harmony_score >= 50.0:
        overall_grade = "Mất Cân Đối Nhẹ (Có Khuyết Điểm Cần Chú Ý)"
    else:
        overall_grade = "Bất Đối Xứng Rõ Rệt (Nhiều Điểm Lệch Khỏi Chuẩn)"

    visual_guide_lines = {
        "midline": [
            {"x": symmetry["midline_axis"]["top"]["x"], "y": symmetry["midline_axis"]["top"]["y"]},
            {"x": symmetry["midline_axis"]["bottom"]["x"], "y": symmetry["midline_axis"]["bottom"]["y"]}
        ],
        "thirds_lines": [
            {"name": "Trán", "y": round(points[10].py, 1)},
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
        "overall_harmony_score": harmony_score,
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
        }
    }
