const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10];
const SYMMETRY_PAIRS = [[234, 454], [127, 356], [93, 323], [33, 263], [133, 362], [61, 291], [172, 397]];

function pixelPoint(landmarks, index, width, height) {
  const point = landmarks[index];
  return point ? { x: point.x * width, y: point.y * height } : null;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(landmarks, indexes, width, height) {
  const points = indexes.map((index) => pixelPoint(landmarks, index, width, height)).filter(Boolean);
  if (!points.length) return null;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

export function sampleFrameLight(video, canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = 64;
  canvas.height = 64;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0;
  let squareSum = 0;
  const count = pixels.length / 4;
  for (let index = 0; index < pixels.length; index += 4) {
    const luminance = 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
    sum += luminance;
    squareSum += luminance * luminance;
  }
  const mean = sum / count;
  const gray = new Float32Array(count);
  for (let pixel = 0, index = 0; index < pixels.length; index += 4, pixel++) {
    gray[pixel] = 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
  }
  let edgeEnergy = 0;
  let samples = 0;
  for (let y = 1; y < canvas.height - 1; y++) {
    for (let x = 1; x < canvas.width - 1; x++) {
      const i = y * canvas.width + x;
      const laplacian = gray[i - 1] + gray[i + 1] + gray[i - canvas.width] + gray[i + canvas.width] - 4 * gray[i];
      edgeEnergy += laplacian * laplacian;
      samples++;
    }
  }
  return { mean, contrast: Math.sqrt(Math.max(0, squareSum / count - mean * mean)), sharpness: Math.sqrt(edgeEnergy / Math.max(1, samples)) };
}

export function assessFace(landmarks, width, height, light) {
  if (!landmarks || landmarks.length < 400) {
    return { status: "unclear", message: "Chưa nhận được đủ điểm mốc. Hãy nhìn thẳng vào camera và giữ khuôn mặt không bị che." };
  }

  const leftCheek = pixelPoint(landmarks, 234, width, height);
  const rightCheek = pixelPoint(landmarks, 454, width, height);
  const faceWidth = distance(leftCheek, rightCheek);
  const bounds = landmarks.reduce((box, point) => ({
    minX: Math.min(box.minX, point.x), maxX: Math.max(box.maxX, point.x),
    minY: Math.min(box.minY, point.y), maxY: Math.max(box.maxY, point.y),
  }), { minX: 1, maxX: 0, minY: 1, maxY: 0 });
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const widthRatio = faceWidth / width;

  if (light.mean < 36) return { status: "unclear", message: "Khung hình hơi tối. Hãy hướng về nơi sáng đều rồi thử lại.", centerX, centerY, widthRatio };
  if (light.mean > 228) return { status: "unclear", message: "Khung hình quá sáng. Hãy tránh nguồn sáng chiếu thẳng vào camera.", centerX, centerY, widthRatio };
  if (light.contrast < 8) return { status: "unclear", message: "Ảnh chưa đủ tương phản để đo ổn định. Hãy đổi nền hoặc ánh sáng.", centerX, centerY, widthRatio };
  if (Number.isFinite(light.sharpness) && light.sharpness < 1.2) return { status: "unclear", message: "Ảnh chưa đủ rõ nét. Hãy giữ camera chắc tay, lau ống kính và thử lại.", centerX, centerY, widthRatio };
  if (widthRatio < 0.24) return { status: "unclear", message: "Khuôn mặt còn nhỏ trong khung. Đưa camera gần hơn một chút.", centerX, centerY, widthRatio };
  if (widthRatio > 0.78) return { status: "unclear", message: "Khuôn mặt quá gần mép khung. Đưa camera ra xa hơn.", centerX, centerY, widthRatio };

  const leftEye = midpoint(landmarks, [33, 133], width, height);
  const rightEye = midpoint(landmarks, [362, 263], width, height);
  const nose = pixelPoint(landmarks, 1, width, height);
  const eyeDistance = distance(leftEye, rightEye);
  const eyeTilt = Math.abs(leftEye.y - rightEye.y) / eyeDistance;
  const leftEyeSpan = Math.abs(nose.x - leftEye.x);
  const rightEyeSpan = Math.abs(rightEye.x - nose.x);
  const yawEstimate = Math.abs(leftEyeSpan - rightEyeSpan) / Math.max(1, leftEyeSpan + rightEyeSpan);

  if (centerX < 0.32 || centerX > 0.68 || centerY < 0.23 || centerY > 0.76) {
    return { status: "align", message: "Căn khuôn mặt vào giữa khung hướng dẫn.", centerX, centerY, widthRatio };
  }
  if (eyeTilt > 0.13) return { status: "align", message: "Giữ điện thoại ngang hơn và đặt hai mắt gần cùng một đường ngang.", centerX, centerY, widthRatio };
  if (yawEstimate > 0.27) return { status: "align", message: "Hãy nhìn thẳng vào camera; khuôn mặt hiện đang hơi xoay.", centerX, centerY, widthRatio };

  return { status: "candidate", message: "Đã căn khuôn mặt. Giữ yên một nhịp để ổn định điểm mốc.", centerX, centerY, widthRatio };
}

export function isStable(samples) {
  if (samples.length < 3) return false;
  const xs = samples.map((sample) => sample.centerX);
  const ys = samples.map((sample) => sample.centerY);
  const widths = samples.map((sample) => sample.widthRatio);
  return Math.max(...xs) - Math.min(...xs) < 0.025
    && Math.max(...ys) - Math.min(...ys) < 0.03
    && Math.max(...widths) - Math.min(...widths) < 0.035;
}

export function analyzeGeometry(landmarks, width, height) {
  const point = (index) => pixelPoint(landmarks, index, width, height);
  const faceWidth = distance(point(234), point(454));
  const eyeCenterLeft = midpoint(landmarks, [33, 133], width, height);
  const eyeCenterRight = midpoint(landmarks, [362, 263], width, height);
  const eyeSpacing = distance(eyeCenterLeft, eyeCenterRight);
  const symmetryAxis = midpoint(landmarks, [168, 6, 197, 195, 5], width, height).x;
  const asymmetry = SYMMETRY_PAIRS.reduce((total, [leftIndex, rightIndex]) => {
    const left = point(leftIndex);
    const right = point(rightIndex);
    return total + Math.abs(Math.abs(left.x - symmetryAxis) - Math.abs(right.x - symmetryAxis)) / faceWidth;
  }, 0) / SYMMETRY_PAIRS.length;

  return [
    { label: "Khoảng cách hai mắt / chiều rộng vùng mặt", value: eyeSpacing / faceWidth, note: "Tỷ lệ khoảng cách giữa tâm hai mắt so với chiều rộng vùng má." },
    { label: "Chiều rộng mũi / chiều rộng vùng mặt", value: distance(point(98), point(327)) / faceWidth, note: "Tỷ lệ bề ngang tại hai cánh mũi so với chiều rộng vùng má." },
    { label: "Chiều rộng miệng / chiều rộng vùng mặt", value: distance(point(61), point(291)) / faceWidth, note: "Tỷ lệ khoảng cách hai khóe miệng so với chiều rộng vùng má." },
    { label: "Chiều cao vùng mặt / chiều rộng vùng mặt", value: distance(point(10), point(152)) / faceWidth, note: "Ước lượng từ vùng trán trên đến cằm; mô hình không xác định chính xác đường chân tóc." },
    { label: "Độ lệch trái–phải tương đối", value: asymmetry, note: "Trung bình độ chênh của một số cặp điểm đối xứng quanh trục mũi; không phải điểm số thẩm mỹ." },
  ];
}

export function drawLandmarkOverlay(context, landmarks, width, height, mapping, clear = true) {
  const { scale, offsetX, offsetY } = mapping;
  const toCanvas = (index) => {
    const point = landmarks[index];
    return { x: offsetX + point.x * width * scale, y: offsetY + point.y * height * scale };
  };

  if (clear) context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.lineJoin = "round";
  context.lineCap = "round";
  context.lineWidth = Math.max(1, context.canvas.width / 900);
  context.strokeStyle = "rgba(104, 226, 216, .78)";
  context.beginPath();
  FACE_OVAL.forEach((index, order) => {
    const p = toCanvas(index);
    if (order === 0) context.moveTo(p.x, p.y);
    else context.lineTo(p.x, p.y);
  });
  context.stroke();

  const features = [
    [33, 133, 159, 157, 173, 133], [362, 263, 386, 374, 398, 362],
    [168, 6, 197, 5, 4, 1, 19, 94], [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291],
  ];
  features.forEach((path, pathIndex) => {
    context.beginPath();
    path.forEach((index, order) => {
      const p = toCanvas(index);
      if (order === 0) context.moveTo(p.x, p.y);
      else context.lineTo(p.x, p.y);
    });
    context.strokeStyle = pathIndex < 2 ? "rgba(232, 196, 125, .8)" : "rgba(104, 226, 216, .7)";
    context.stroke();
  });

  context.fillStyle = "rgba(224, 244, 238, .92)";
  [1, 10, 33, 61, 133, 152, 168, 234, 263, 291, 362, 454].forEach((index) => {
    const p = toCanvas(index);
    context.beginPath();
    context.arc(p.x, p.y, Math.max(1.5, context.canvas.width / 420), 0, Math.PI * 2);
    context.fill();
  });
}
