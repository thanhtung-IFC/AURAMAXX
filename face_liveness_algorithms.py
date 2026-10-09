"""
Module: face_liveness_algorithms.py
Mô tả: Module thuật toán xử lý đặc trưng khuôn mặt, đo lường sinh trắc học và kiểm tra Liveness (Anti-Spoofing).
Tác giả:  AURAMAXX Team
"""

import math
from typing import List, Dict, Tuple, Optional, Any


class LandmarkPoint:
    """Đại diện cho một điểm mốc 3D của khuôn mặt."""
    __slots__ = ('x', 'y', 'z')

    def __init__(self, x: float, y: float, z: float = 0.0):
        self.x = float(x)
        self.y = float(y)
        self.z = float(z)

    def to_dict(self) -> Dict[str, float]:
        return {"x": self.x, "y": self.y, "z": self.z}


def euclidean_distance(p1: LandmarkPoint, p2: LandmarkPoint, include_z: bool = True) -> float:
    """Tính khoảng cách Euclid giữa 2 điểm mốc."""
    dx = p1.x - p2.x
    dy = p1.y - p2.y
    if include_z:
        dz = p1.z - p2.z
        return math.sqrt(dx * dx + dy * dy + dz * dz)
    return math.hypot(dx, dy)


def calculate_ear(landmarks: List[LandmarkPoint]) -> Tuple[float, float, float]:
    """
    Tính chỉ số Eye Aspect Ratio (EAR) cho cả 2 mắt.
    Công thức dựa theo nghiên cứu của Soukupová & Čech (2016):
    EAR = (|p2 - p6| + |p3 - p5|) / (2 * |p1 - p4|)

    Chỉ số các điểm trong MediaPipe Face Mesh:
    - Mắt trái:
        Trên: 159 (hoặc 160, 158), Dưới: 145 (hoặc 144, 153)
        Góc ngoài: 33, Góc trong: 133
    - Mắt phải:
        Trên: 386, Dưới: 374
        Góc ngoài: 362, Góc trong: 263
    
    Returns:
        (left_ear, right_ear, avg_ear)
    """
    if len(landmarks) < 468:
        return 0.0, 0.0, 0.0

    # Mắt trái
    l_top, l_bot = landmarks[159], landmarks[145]
    l_out, l_in = landmarks[33], landmarks[133]
    l_vert = euclidean_distance(l_top, l_bot)
    l_horiz = euclidean_distance(l_out, l_in) + 1e-6
    left_ear = l_vert / l_horiz

    # Mắt phải
    r_top, r_bot = landmarks[386], landmarks[374]
    r_out, r_in = landmarks[362], landmarks[263]
    r_vert = euclidean_distance(r_top, r_bot)
    r_horiz = euclidean_distance(r_out, r_in) + 1e-6
    right_ear = r_vert / r_horiz

    avg_ear = (left_ear + right_ear) / 2.0
    return left_ear, right_ear, avg_ear


def calculate_mar(landmarks: List[LandmarkPoint]) -> float:
    """
    Tính chỉ số Mouth Aspect Ratio (MAR) để xác định trạng thái mở/há miệng.
    MAR = |môi trên - môi dưới| / |khóe trái - khóe phải|
    
    Điểm MediaPipe Face Mesh:
    - Môi trên giữa: 13
    - Môi dưới giữa: 14
    - Khóe môi trái: 61
    - Khóe môi phải: 291
    """
    if len(landmarks) < 468:
        return 0.0

    top_lip = landmarks[13]
    bot_lip = landmarks[14]
    left_corner = landmarks[61]
    right_corner = landmarks[291]

    vertical = euclidean_distance(top_lip, bot_lip)
    horizontal = euclidean_distance(left_corner, right_corner) + 1e-6
    return vertical / horizontal


def calculate_head_pose(landmarks: List[LandmarkPoint]) -> Dict[str, Any]:
    """
    Ước tính góc quay đầu (Yaw: trái/phải, Pitch: ngẩng/cúi) dựa trên tương quan hình học 3D.
    - Điểm quy chiếu:
        1: Mũi (Nose tip)
        234: Gò má trái (Left cheek)
        454: Gò má phải (Right cheek)
        10: Đỉnh trán (Forehead)
        152: Cằm (Chin)
    """
    if len(landmarks) < 468:
        return {"yaw": 0, "pitch": 0, "direction": "Không xác định"}

    nose = landmarks[1]
    left_cheek = landmarks[234]
    right_cheek = landmarks[454]
    forehead = landmarks[10]
    chin = landmarks[152]

    # Tính Yaw (Quay ngang)
    yaw_angle = round(math.degrees(math.atan2(
        left_cheek.z - right_cheek.z,
        max(1e-6, right_cheek.x - left_cheek.x)
    )), 1)

    # Tính Pitch (Ngẩng / Cúi)
    face_height = euclidean_distance(forehead, chin) + 1e-6
    dist_top = euclidean_distance(forehead, nose)
    dist_bot = euclidean_distance(nose, chin)
    pitch_ratio = (dist_top - dist_bot) / face_height
    pitch_angle = round(pitch_ratio * 65.0, 1)

    direction = "Chính diện"
    if yaw_angle < -14.0:
        direction = "Quay Trái"
    elif yaw_angle > 14.0:
        direction = "Quay Phải"
    elif pitch_angle > 15.0:
        direction = "Cúi đầu"
    elif pitch_angle < -12.0:
        direction = "Ngẩng đầu"

    return {
        "yaw": yaw_angle,
        "pitch": pitch_angle,
        "direction": direction
    }


def extract_face_feature_vector(landmarks: List[LandmarkPoint]) -> List[float]:
    """
    Trích xuất vector đặc trưng hình học chuẩn hóa (Normalized Facial Geometric Vector).
    Phương pháp:
    - 20 điểm mốc cấu trúc đại diện phân bố đều trên khuôn mặt.
    - Chuẩn hóa tịnh tiến: Lấy đỉnh mũi (Landmark 1) làm gốc tọa độ (0, 0, 0).
    - Chuẩn hóa tỷ lệ: Chia theo khoảng cách liên trắc diện giữa 2 gò má (234 và 454)
      giúp vector bất biến với khoảng cách xa/gần của camera.
    """
    anchor_indices = [
        1, 10, 152, 234, 454,           # Mũi, trán, cằm, gò má trái, gò má phải
        33, 133, 159, 145, 468,         # Mắt trái và đồng tử trái
        362, 263, 386, 374, 473,        # Mắt phải và đồng tử phải
        61, 291, 13, 14, 17             # Khóe môi và viền môi
    ]

    center = landmarks[1]
    scale = euclidean_distance(landmarks[234], landmarks[454])
    if scale <= 1e-6:
        scale = 1.0

    vector: List[float] = []
    for idx in anchor_indices:
        pt = landmarks[idx] if idx < len(landmarks) else center
        vector.append((pt.x - center.x) / scale)
        vector.append((pt.y - center.y) / scale)
        vector.append((pt.z - center.z) / scale)

    return vector


def compare_face_vectors(vec1: List[float], vec2: List[float], metric: str = "euclidean") -> float:
    """
    So sánh độ tương đồng giữa hai vector đặc trưng khuôn mặt.
    metric:
    - 'euclidean': Khoảng cách Euclid (càng nhỏ càng giống nhau).
    - 'cosine': Khoảng cách Cosine (1 - cosine_similarity).
    """
    if not vec1 or not vec2 or len(vec1) != len(vec2):
        return float("inf")

    if metric == "cosine":
        dot = sum(a * b for a, b in zip(vec1, vec2))
        norm_a = math.sqrt(sum(a * a for a in vec1))
        norm_b = math.sqrt(sum(b * b for b in vec2))
        if norm_a == 0 or norm_b == 0:
            return 1.0
        similarity = dot / (norm_a * norm_b)
        return max(0.0, 1.0 - similarity)

    # Euclidean mặc định
    diff_sq = sum((a - b) ** 2 for a, b in zip(vec1, vec2))
    return math.sqrt(diff_sq)


class LivenessChallengeEngine:
    """
    Máy trạng thái (State Machine) kiểm tra Liveness qua tương tác chủ động:
    Thách thức 3 bước chống giả mạo ảnh in/video phát lại:
    1. Chớp mắt 2 lần (Blink Challenge)
    2. Há miệng (Mouth Open Challenge)
    3. Quay mặt theo hướng yêu cầu (Head Turn Challenge)
    """

    EAR_THRESHOLD = 0.20
    MAR_THRESHOLD = 0.38
    YAW_THRESHOLD = 15.0

    def __init__(self):
        self.reset()

    def reset(self):
        self.is_active = False
        self.current_step = 1  # 1: Blink, 2: Mouth, 3: Turn, 4: Done
        self.blink_count = 0
        self.eyes_previously_closed = False
        self.status_message = "Chưa kích hoạt"
        self.is_verified = False
        self.progress_percentage = 0

    def start(self):
        self.reset()
        self.is_active = True
        self.status_message = "Vui lòng chớp mắt 2 lần"
        self.progress_percentage = 20

    def update(self, ear: float, mar: float, head_pose: Dict[str, Any]) -> Dict[str, Any]:
        """Cập nhật dữ liệu từ frame và tiến hành chuyển bước."""
        if not self.is_active:
            return self.get_state()

        # Bước 1: Kiểm tra chớp mắt 2 lần
        if self.current_step == 1:
            if ear < self.EAR_THRESHOLD:
                if not self.eyes_previously_closed:
                    self.eyes_previously_closed = True
                    self.blink_count += 1
                    if self.blink_count >= 2:
                        self.current_step = 2
                        self.status_message = "Tốt lắm! Bây giờ hãy há miệng"
                        self.progress_percentage = 60
            else:
                self.eyes_previously_closed = False

        # Bước 2: Kiểm tra há miệng
        elif self.current_step == 2:
            if mar > self.MAR_THRESHOLD:
                self.current_step = 3
                self.status_message = "Rất tốt! Hãy quay đầu sang trái"
                self.progress_percentage = 85

        # Bước 3: Kiểm tra quay đầu sang trái
        elif self.current_step == 3:
            yaw = head_pose.get("yaw", 0)
            if yaw < -self.YAW_THRESHOLD or head_pose.get("direction") == "Quay Trái":
                self.current_step = 4
                self.is_active = False
                self.is_verified = True
                self.status_message = "Xác thực Liveness thành công (100% Người thật)"
                self.progress_percentage = 100

        return self.get_state()

    def get_state(self) -> Dict[str, Any]:
        return {
            "is_active": self.is_active,
            "current_step": self.current_step,
            "blink_count": self.blink_count,
            "is_verified": self.is_verified,
            "status_message": self.status_message,
            "progress_percentage": self.progress_percentage
        }


def analyze_frame_landmarks(landmarks_data: List[Dict[str, float]], 
                            registered_db: Optional[List[Dict[str, Any]]] = None,
                            challenge_engine: Optional[LivenessChallengeEngine] = None) -> Dict[str, Any]:
    """
    Hàm phân tích tổng hợp một frame landmarks:
    - Chuyển đổi dữ liệu thô sang LandmarkPoint
    - Tính EAR, MAR, Head Pose
    - Trích xuất Face Vector & So khớp đối chiếu
    - Cập nhật Liveness Challenge
    """
    if not landmarks_data or len(landmarks_data) < 468:
        return {
            "success": False,
            "message": "Không đủ điểm mốc landmarks hoặc không nhận diện được mặt"
        }

    points = [LandmarkPoint(p.get("x", 0), p.get("y", 0), p.get("z", 0)) for p in landmarks_data]

    # 1. Tính toán sinh trắc học
    left_ear, right_ear, ear = calculate_ear(points)
    mar = calculate_mar(points)
    head_pose = calculate_head_pose(points)

    # 2. Vector đặc trưng & Đối soát khuôn mặt
    current_vector = extract_face_feature_vector(points)
    match_result = None

    if registered_db:
        best_match = None
        min_dist = float("inf")
        match_threshold = 0.44

        for user in registered_db:
            dist = compare_face_vectors(current_vector, user.get("vector", []))
            if dist < min_dist:
                min_dist = dist
                best_match = user

        if best_match and min_dist < match_threshold:
            confidence = max(0.0, min(99.9, (1.0 - (min_dist / match_threshold)) * 40.0 + 60.0))
            match_result = {
                "matched": True,
                "user_id": best_match.get("id"),
                "name": best_match.get("name"),
                "distance": round(min_dist, 4),
                "confidence": round(confidence, 1)
            }
        else:
            match_result = {
                "matched": False,
                "distance": round(min_dist, 4) if min_dist != float("inf") else None
            }

    # 3. Liveness State Machine
    challenge_state = None
    if challenge_engine and challenge_engine.is_active:
        challenge_state = challenge_engine.update(ear, mar, head_pose)

    return {
        "success": True,
        "biometrics": {
            "ear": round(ear, 3),
            "left_ear": round(left_ear, 3),
            "right_ear": round(right_ear, 3),
            "is_eye_closed": ear < LivenessChallengeEngine.EAR_THRESHOLD,
            "mar": round(mar, 3),
            "is_mouth_open": mar > LivenessChallengeEngine.MAR_THRESHOLD,
            "head_pose": head_pose
        },
        "feature_vector_length": len(current_vector),
        "feature_vector": current_vector,
        "match": match_result,
        "challenge": challenge_state
    }

