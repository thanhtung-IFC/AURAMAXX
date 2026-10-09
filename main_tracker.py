"""
VisionFace Desktop - Ứng dụng theo dõi khuôn mặt thời gian thực bằng Python & OpenCV
Chạy: py main_tracker.py
Yêu cầu: pip install opencv-python mediapipe
"""

import sys
import time

try:
    import cv2
    import mediapipe as mp
except ImportError:
    print("=" * 60)
    print("LƯU Ý: Để chạy ứng dụng camera desktop trực tiếp bằng OpenCV,")
    print("vui lòng cài đặt opencv-python và mediapipe bằng lệnh:")
    print("    py -m pip install opencv-python mediapipe")
    print("\nHoặc bạn có thể khởi động Backend Server để dùng cùng trình duyệt:")
    print("    py server.py")
    print("=" * 60)
    sys.exit(0)

from face_liveness_algorithms import (
    LandmarkPoint,
    calculate_ear,
    calculate_mar,
    calculate_head_pose,
    LivenessChallengeEngine
)

def main():
    print("Khởi động camera...")
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("Lỗi: Không thể mở webcam!")
        return

    mp_face_mesh = mp.solutions.face_mesh
    mp_drawing = mp.solutions.drawing_utils
    mp_drawing_styles = mp.solutions.drawing_styles

    face_mesh = mp_face_mesh.FaceMesh(
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5
    )

    challenge_engine = LivenessChallengeEngine()
    challenge_engine.start()

    prev_time = time.time()

    print("Camera đã sẵn sàng. Bấm phím 'q' để thoát, 'c' để khởi động lại Liveness Challenge.")

    while cap.isOpened():
        success, frame = cap.read()
        if not success:
            continue

        # Lật gương khung hình
        frame = cv2.flip(frame, 1)

        # Chuyển đổi BGR -> RGB cho MediaPipe
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = face_mesh.process(rgb_frame)

        # Đo FPS
        curr_time = time.time()
        fps = int(1.0 / (curr_time - prev_time)) if (curr_time - prev_time) > 0 else 0
        prev_time = curr_time

        if results.multi_face_landmarks:
            landmarks_raw = results.multi_face_landmarks[0].landmark
            points = [LandmarkPoint(pt.x, pt.y, pt.z) for pt in landmarks_raw]

            # Áp dụng thuật toán từ module Python
            _, _, ear = calculate_ear(points)
            mar = calculate_mar(points)
            pose = calculate_head_pose(points)

            # Cập nhật Liveness Challenge
            c_state = challenge_engine.update(ear, mar, pose)

            # Vẽ lưới FaceMesh
            mp_drawing.draw_landmarks(
                image=frame,
                landmark_list=results.multi_face_landmarks[0],
                connections=mp_face_mesh.FACEMESH_TESSELLATION,
                landmark_drawing_spec=None,
                connection_drawing_spec=mp_drawing_styles.get_default_face_mesh_tessellation_style()
            )

            # Vẽ HUD thông số
            cv2.rectangle(frame, (10, 10), (320, 150), (15, 23, 42), -1)
            cv2.rectangle(frame, (10, 10), (320, 150), (6, 182, 212), 1)

            cv2.putText(frame, f"FPS: {fps} | Face Detected", (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)
            cv2.putText(frame, f"EAR (Blink): {ear:.2f} [{'CLOSED' if ear < 0.20 else 'OPEN'}]", (20, 65), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (6, 182, 212), 1)
            cv2.putText(frame, f"MAR (Mouth): {mar:.2f} [{'OPEN' if mar > 0.38 else 'CLOSED'}]", (20, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (16, 185, 129), 1)
            cv2.putText(frame, f"Pose: {pose['direction']} (Yaw: {pose['yaw']} deg)", (20, 115), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (244, 63, 94), 1)
            cv2.putText(frame, f"Liveness: {c_state['status_message']}", (20, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (52, 211, 153), 1)

        else:
            cv2.putText(frame, "KHONG TIM THAY MAT", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)

        cv2.imshow("VisionFace Pro - Desktop Python Tracker", frame)
        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            break
        elif key == ord('c'):
            challenge_engine.start()
            print("[Liveness] Đã bắt đầu lại bài kiểm tra Liveness!")

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()

