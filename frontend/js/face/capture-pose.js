// Capture guidance reused from the original VisionFace camera controller.
    function calcDistance(pt1, pt2) {
      return Math.hypot(pt1.x - pt2.x, pt1.y - pt2.y, (pt1.z || 0) - (pt2.z || 0));
    }

    // Tính chỉ số EAR (Eye Aspect Ratio) cho chớp mắt

    function calculateHeadPose(pts) {
      const nose = pts[1];
      const leftCheek = pts[234];
      const rightCheek = pts[454];
      const forehead = pts[10];
      const chin = pts[152];

      // Chênh lệch độ sâu hai má thay đổi khi quay đầu (góc ước tính).
      const yaw = Math.round(Math.atan2((leftCheek.z || 0) - (rightCheek.z || 0),
        Math.max(0.0001, rightCheek.x - leftCheek.x)) * 180 / Math.PI);

      const faceHeight = calcDistance(forehead, chin) + 0.0001;
      const topDist = calcDistance(forehead, nose);
      const botDist = calcDistance(nose, chin);
      const pitchRatio = (topDist - botDist) / faceHeight;
      const pitch = Math.round(pitchRatio * 65);

      let text = "Chính diện";
      if (yaw < -15) text = "Quay Trái";
      else if (yaw > 15) text = "Quay Phải";
      else if (pitch > 15) text = "Cúi đầu";
      else if (pitch < -12) text = "Ngẩng đầu";

      return { yaw, pitch, text };
    }

    // Trích xuất vector đặc trưng hình học chuẩn hóa (Normalized Geometric Landmark Vector)

export function evaluateCapturePose(landmarks, step, baselineYaw = 0, aspectRatio = 4 / 3) {
      const invalid = { ready: false, yaw: null, message: step === 2
        ? "Mất mặt: quay lại một chút để thấy cả hai mắt, rồi quay chậm."
        : "Đưa khuôn mặt vào khung." };
      if (!landmarks || landmarks.length < 468) return invalid;
      const needed = [1, 10, 152, 234, 454, 33, 263];
      if (needed.some(i => !landmarks[i] || !Number.isFinite(landmarks[i].x)
        || !Number.isFinite(landmarks[i].y) || !Number.isFinite(landmarks[i].z ?? 0))) return invalid;
      const yaw = calculateHeadPose(landmarks).yaw - baselineYaw;
      const absYaw = Math.abs(yaw);
      const result = { ready: false, yaw, message: "" };
      const outline = [10, 152, 234, 454].map(i => landmarks[i]);
      if (outline.some(p => p.x < 0.025 || p.x > 0.975 || p.y < 0.025 || p.y > 0.975)) {
        return { ...result, message: "Mặt bị cắt: đưa cả trán và cằm vào khung." };
      }
      const height = landmarks[152].y - landmarks[10].y;
      if (height < 0.25) return { ...result, message: "Đưa mặt gần camera hơn một chút." };
      if (height > 0.88) return { ...result, message: "Lùi ra một chút để mặt không bị cắt." };
      const eyeL = landmarks[33], eyeR = landmarks[263];
      const roll = Math.atan2(eyeR.y - eyeL.y, Math.max(0.001, (eyeR.x - eyeL.x) * aspectRatio)) * 180 / Math.PI;
      if (Math.abs(roll) > 12) return { ...result, message: "Giữ đầu thẳng, không nghiêng vai hoặc cúi đầu." };
      if (step === 1 && absYaw > 10) return { ...result, message: "Nhìn thẳng vào ống kính để lưu ảnh chính diện." };
      if (step === 2 && absYaw < 15) return { ...result, message: "Quay từ từ sang trái hoặc phải; vẫn để thấy cả hai mắt." };
      if (step === 2 && absYaw > 40) return { ...result, message: "Quay lại nhẹ: góc quá lớn dễ làm mất nhận diện." };
      return { ...result, ready: true, message: "Đúng góc, giữ yên một chút." };
    }
