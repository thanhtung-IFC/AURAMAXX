import { PROFILE_CONFIG } from "./profile-config.js";

const point = (landmarks, index, width, height) => {
  const p = landmarks?.[index];
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x * width, y: p.y * height } : null;
};
const dist = (a, b) => a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
const avg = (points) => {
  const valid = points.filter(Number.isFinite);
  return valid.length ? valid.reduce((s, p) => s + p, 0) / valid.length : null;
};
const ratio = (a, b) => Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null;
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const available = (v) => Number.isFinite(v) && v >= 0;

export function scoreFromTarget(value, target, tolerance) {
  if (![value, target, tolerance].every(Number.isFinite) || tolerance <= 0) return null;
  return Math.round(clamp(100 * (1 - Math.abs(value - target) / tolerance)));
}

function confidenceFor(landmarks, indexes, quality) {
  const valid = indexes.filter((index) => {
    const p = landmarks[index];
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  }).length / indexes.length;
  const qualityPart = quality?.sharpness == null ? 0.68 : clamp((quality.sharpness - 1.5) / 9, 0.35, 1);
  const lightPart = quality?.mean == null ? 0.72 : clamp(1 - Math.abs(quality.mean - 132) / 180, 0.35, 1);
  const skinPart = indexes.includes(50) && quality?.skinConfidence != null ? clamp(quality.skinConfidence / 80, 0.2, 1) : 1;
  return Math.round(valid * qualityPart * lightPart * skinPart * 100);
}

function group(name, metrics, targetPairs, indexes, landmarks, quality, factors = []) {
  const validMetrics = metrics.filter((m) => available(m.value));
  if (!validMetrics.length) return { id: name.id, name: name.name, score: null, confidence: 0, status: "missing", metrics, explanation: name.missing, factors };
  const scores = validMetrics.map((m) => scoreFromTarget(m.value, ...targetPairs[m.key]));
  const score = Math.round(avg(scores));
  const confidence = confidenceFor(landmarks, indexes, quality);
  const status = confidence < PROFILE_CONFIG.minConfidence * 100 ? "unreliable" : validMetrics.length < metrics.length ? "partial" : "complete";
  return { id: name.id, name: name.name, score: status === "unreliable" ? null : score, confidence, status, metrics, explanation: status === "unreliable" ? "Điểm mốc hoặc chất lượng ảnh chưa đủ tin cậy cho nhóm này." : name.explanation, factors };
}

export function classifyFaceShape(measures) {
  const { lengthWidth, jawToCheek, foreheadToCheek, chinRatio } = measures;
  if (![lengthWidth, jawToCheek, foreheadToCheek, chinRatio].every(available)) return { label: "Chưa xác định", confidence: 0, status: "missing" };
  const candidates = Object.entries(PROFILE_CONFIG.faceShape).map(([key, t]) => {
    const upper = Math.min(t.maxRatio, t.minRatio + 0.55);
    const center = (t.minRatio + upper) / 2;
    const halfRange = Math.max(0.08, (upper - t.minRatio) / 2);
    const ratioFit = 1 - Math.abs(lengthWidth - center) / halfRange;
    const jawFit = 1 - Math.abs(jawToCheek - t.jawToCheek) / PROFILE_CONFIG.classification.featureTolerance;
    const foreheadFit = 1 - Math.abs(foreheadToCheek - t.foreheadToCheek) / PROFILE_CONFIG.classification.featureTolerance;
    const inRange = lengthWidth >= t.minRatio && lengthWidth <= t.maxRatio;
    const chinFit = key === "heart" || key === "diamond" ? 1 - Math.abs(chinRatio - PROFILE_CONFIG.classification.chinTarget) / PROFILE_CONFIG.classification.chinTolerance : 0.55;
    return { key, confidence: clamp((0.45 * ratioFit + 0.23 * jawFit + 0.18 * foreheadFit + 0.14 * chinFit) * 100), inRange };
  }).sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];
  const margin = best.confidence - (candidates[1]?.confidence || 0);
  if (!best.inRange || best.confidence < PROFILE_CONFIG.classification.minConfidence || margin < PROFILE_CONFIG.classification.minMargin) return { label: "Chưa xác định", confidence: Math.round(Math.max(0, best.confidence)), status: "uncertain" };
  const labels = { round: "Tròn", oval: "Oval", square: "Vuông", oblong: "Dài", heart: "Trái tim", diamond: "Kim cương" };
  return { label: labels[best.key], confidence: Math.round(Math.min(best.confidence, best.confidence + margin / 2)), status: "estimated" };
}

export function measureFaceProfile(landmarks, width, height, quality = {}) {
  const p = (i) => point(landmarks, i, width, height);
  const d = (a, b) => dist(p(a), p(b));
  const mid = (...indexes) => {
    const pts = indexes.map(p).filter(Boolean);
    return pts.length ? { x: avg(pts.map((x) => x.x)), y: avg(pts.map((x) => x.y)) } : null;
  };
  const cheekWidth = d(234, 454);
  const foreheadWidth = d(103, 332);
  const jawWidth = d(172, 397);
  const faceHeight = d(10, 152);
  const leftEyeWidth = d(33, 133);
  const rightEyeWidth = d(362, 263);
  const leftEyeCenter = mid(33, 133);
  const rightEyeCenter = mid(362, 263);
  const noseTip = p(1);
  const axis = mid(168, 6, 197, 195, 5);
  const noseCenter = noseTip && axis && cheekWidth ? Math.abs(noseTip.x - axis.x) / cheekWidth : null;
  const upper = d(0, 13);
  const lower = d(13, 17);
  const browY = avg([p(105)?.y, p(334)?.y].filter(Number.isFinite));
  const noseBaseY = p(2)?.y;
  const chinY = p(152)?.y;
  const topY = p(10)?.y;
  const thirds = [ratio(browY - topY, faceHeight), ratio(noseBaseY - browY, faceHeight), ratio(chinY - noseBaseY, faceHeight)];
  const measures = {
    lengthWidth: ratio(faceHeight, cheekWidth), jawToCheek: ratio(jawWidth, cheekWidth),
    foreheadToCheek: ratio(foreheadWidth, cheekWidth), chinRatio: ratio(d(17, 152), faceHeight),
    cheekVsFrame: ratio(cheekWidth, avg([foreheadWidth, jawWidth])),
  };
  const eyeSpacing = leftEyeCenter && rightEyeCenter ? dist(leftEyeCenter, rightEyeCenter) : null;
  const groups = [
    group({ id: "proportions", name: "Tỷ lệ khuôn mặt", explanation: "Dựa trên tỷ lệ dài/rộng và độ cân bằng tương đối của ba vùng dọc.", missing: "Thiếu điểm mốc ở viền mặt hoặc vùng giữa." }, [
      { key: "faceLengthWidth", label: "Chiều dài / chiều rộng", value: measures.lengthWidth, unit: "tỷ lệ" },
      { key: "topThird", label: "Vùng trên · viền trán đến lông mày", value: thirds[0], unit: "phần của chiều cao vùng mặt; chân tóc không được nhận diện" },
      { key: "middleThird", label: "Vùng giữa · lông mày đến chân mũi", value: thirds[1], unit: "phần của chiều cao vùng mặt" },
      { key: "bottomThird", label: "Vùng dưới · chân mũi đến cằm", value: thirds[2], unit: "phần của chiều cao vùng mặt" },
    ], PROFILE_CONFIG.targets, [10, 152, 103, 332, 105, 334, 2, 168, 197, 195, 5, 234, 454], landmarks, quality, ["Đường chân tóc không được mô hình nhận diện; điểm trên cùng chỉ là viền trán ước lượng."]),
    group({ id: "eyesBrows", name: "Mắt & lông mày", explanation: "Tỷ lệ khoảng cách mắt và chênh lệch bề ngang hai mắt trên ảnh.", missing: "Thiếu điểm mốc quanh mắt." }, [
      { key: "eyeSpacingFace", label: "Khoảng cách tâm mắt / chiều rộng mặt", value: ratio(eyeSpacing, cheekWidth), unit: "tỷ lệ" },
      { key: "eyeBalance", label: "Chênh lệch độ rộng hai mắt", value: ratio(Math.abs(leftEyeWidth - rightEyeWidth), avg([leftEyeWidth, rightEyeWidth])), unit: "tỷ lệ; thấp hơn nghĩa là gần nhau hơn" },
      { key: "browHeightBalance", label: "Chênh cao hai đầu lông mày", value: ratio(Math.abs((p(105)?.y ?? NaN) - (p(334)?.y ?? NaN)), cheekWidth), unit: "tỷ lệ; thấp hơn nghĩa là gần nhau hơn" },
    ], { ...PROFILE_CONFIG.targets, browHeightBalance: [0, 0.08] }, [33, 133, 362, 263, 105, 334, 234, 454], landmarks, quality, ["Biểu cảm, chớp mắt, nghiêng đầu và góc camera ảnh hưởng đến phép đo."]),
    group({ id: "nose", name: "Mũi", explanation: "Bề ngang cánh mũi, chiều dài tương đối và độ lệch khỏi trục giữa.", missing: "Thiếu điểm mốc mũi hoặc trục giữa." }, [
      { key: "noseWidthFace", label: "Bề ngang cánh mũi / chiều rộng mặt", value: ratio(d(98, 327), cheekWidth), unit: "tỷ lệ" },
      { key: "noseLengthFace", label: "Chiều dài sống mũi / chiều cao mặt", value: ratio(d(168, 2), faceHeight), unit: "tỷ lệ 2D" },
      { key: "noseCenter", label: "Độ lệch khỏi trục giữa", value: noseCenter, unit: "tỷ lệ; thấp hơn nghĩa là gần trục hơn" },
    ], PROFILE_CONFIG.targets, [98, 327, 1, 168, 2, 6, 197, 195, 5, 234, 454], landmarks, quality, ["Phối cảnh và góc xoay có thể làm thay đổi tỷ lệ nhìn thấy."]),
    group({ id: "lips", name: "Môi", explanation: "Bề ngang môi và tỷ lệ độ mở môi trên/dưới theo landmark nhìn thấy.", missing: "Thiếu điểm mốc môi." }, [
      { key: "mouthWidthFace", label: "Chiều rộng miệng / chiều rộng mặt", value: ratio(d(61, 291), cheekWidth), unit: "tỷ lệ" },
      { key: "lipBalance", label: "Độ mở môi trên / tổng độ mở", value: ratio(upper, upper + lower), unit: "tỷ lệ" },
    ], PROFILE_CONFIG.targets, [61, 291, 0, 13, 17, 14, 234, 454], landmarks, quality, ["Khép môi, nói chuyện hoặc biểu cảm làm phép đo thay đổi; không đo thể tích môi."]),
    group({ id: "jawChin", name: "Hàm & cằm", explanation: "Bề ngang hàm so với vùng má và tỷ lệ phần cằm nhìn thấy.", missing: "Thiếu landmark ở viền hàm hoặc cằm." }, [
      { key: "jawBalance", label: "Chiều rộng hàm / chiều rộng vùng má", value: measures.jawToCheek, unit: "tỷ lệ" },
      { key: "chinRatio", label: "Độ dài cằm tương đối", value: measures.chinRatio, unit: "tỷ lệ chiều cao mặt" },
    ], PROFILE_CONFIG.targets, [172, 397, 152, 234, 454], landmarks, quality, ["Tóc che viền hàm, râu, góc nghiêng và landmark 2D làm giảm độ tin cậy."]),
    scoreVisualSkin(quality, landmarks),
    group({ id: "fullness", name: "Độ đầy vùng mặt", explanation: "Mô tả hình dáng tương đối vùng má so với trán và hàm trên ảnh; không suy ra cân nặng hay mỡ cơ thể.", missing: "Thiếu landmark vùng má/hàm." }, [
      { key: "fullnessBalance", label: "Chiều rộng vùng má / trung bình trán và hàm", value: measures.cheekVsFrame, unit: "tỷ lệ hình học 2D; không phải chỉ số cơ thể" },
    ], PROFILE_CONFIG.targets, [172, 397, 234, 454], landmarks, quality, ["Đây chỉ là hình dáng 2D; không đo mô mềm hay thể tích gương mặt."]),
  ];
  const shape = classifyFaceShape(measures);
  const valid = groups.filter((g) => g.score !== null && g.status !== "unreliable");
  const weights = valid.reduce((total, g) => total + PROFILE_CONFIG.overallWeights[g.id], 0);
  const overall = weights ? Math.round(valid.reduce((total, g) => total + g.score * PROFILE_CONFIG.overallWeights[g.id], 0) / weights) : null;
  return { groups, shape, overall, coverage: Math.round(weights), quality: { ...quality }, disclaimer: "Điểm nội bộ theo heuristic AURAMAXX; không phải chuẩn khách quan về vẻ đẹp, đánh giá giá trị con người hay tư vấn y tế. Phân tích 2D không xác định cấu trúc 3D." };
}

function scoreVisualSkin(quality, landmarks) {
  const value = quality?.skinEvenness;
  const metric = { key: "skinEvenness", label: "Độ đồng đều màu quan sát được", value: available(value) ? value : null, unit: "ước lượng ảnh 2D; ánh sáng ảnh hưởng lớn" };
  return group({ id: "skin", name: "Bề mặt da", explanation: "Ước lượng độ biến thiên màu tại một số vùng má nhìn thấy; không phải chẩn đoán da.", missing: "Không đủ pixel da hợp lệ trong vùng lấy mẫu." }, [metric], PROFILE_CONFIG.targets, [50, 101, 118, 205, 206, 216, 280, 330, 347], landmarks, quality, ["Ánh sáng, makeup, cân bằng trắng, camera, bóng và nếp da ảnh hưởng mạnh đến tín hiệu."]);
}

export function sampleSkinAppearance(canvas, landmarks) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const bounds = [10, 152, 234, 454].map((i) => landmarks[i]);
  if (bounds.some((p) => !p)) return { skinEvenness: null, skinConfidence: 0 };
  const xs = bounds.map((p) => p.x * width), ys = bounds.map((p) => p.y * height);
  const left = Math.max(0, Math.floor(Math.min(...xs))), right = Math.min(width, Math.ceil(Math.max(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys))), bottom = Math.min(height, Math.ceil(Math.max(...ys)));
  const patchStats = [];
  // Lấy mẫu đối xứng ở hai má, tránh mắt, môi và trục mũi theo hình học landmark.
  for (const side of [0.34, 0.66]) {
    const cx = Math.round(left + (right - left) * side), cy = Math.round(top + (bottom - top) * 0.59);
    const radius = Math.max(3, Math.round((right - left) * 0.045));
    const data = ctx.getImageData(Math.max(0, cx - radius), Math.max(0, cy - radius), Math.min(width - Math.max(0, cx - radius), radius * 2), Math.min(height - Math.max(0, cy - radius), radius * 2)).data;
    const light = [], chroma = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(1, Math.max(r, g, b));
      // Loại điểm gần đen/trắng hoặc ít màu như nền, vẫn chỉ là mask xấp xỉ.
      if (y > 35 && y < 238 && sat > 0.08 && sat < 0.72) { light.push(y); chroma.push((r - g) / 255); }
    }
    if (light.length >= 10) {
      const mean = avg(light), meanC = avg(chroma);
      const variance = avg(light.map((n) => (n - mean) ** 2));
      const varianceC = avg(chroma.map((n) => (n - meanC) ** 2));
      patchStats.push({ variance: Math.sqrt(variance) / 60 + Math.sqrt(varianceC) * 1.4, count: light.length });
    }
  }
  if (patchStats.length < 2) return { skinEvenness: null, skinConfidence: 0 };
  const variability = avg(patchStats.map((p) => p.variance));
  return { skinEvenness: clamp(100 * (1 - variability), 0, 100) / 100, skinConfidence: Math.min(...patchStats.map((p) => p.count)) };
}
