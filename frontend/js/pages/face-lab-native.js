import { api, apiRequest } from "../api.js";
import { showToast } from "../ui.js";
import { createLandmarker } from "../face/landmarker.js";
import { drawLandmarkOverlay, sampleFrameLight } from "../face/analysis.js";
import { evaluateCapturePose } from "../face/capture-pose.js";
import { escapeText, renderReportDetails, reportToArenaGroups, setFaceReport } from "../face/report.js";
import { getSelectedArenaBotProfile as getSelectedArenaBot } from "../arena/bot-selection.js";

const $ = selector => document.querySelector(selector);
const page = document.querySelector('[data-page="face-lab"]');
const SCAN_INTERVAL = 120, STABLE_MS = 650;
let stream = null, detector = null, timer = 0, operation = 0, starting = false;
let frame = null, front = null, profile = null, report = null, stableSince = 0, previousPose = null;
let autoCapture = false, autoTimeout = 0, lastServerAt = 0, serverBusy = false, analyzing = false;
let facingMode = "user", selectedDevice = "", lastDetectionTime = 0, challengeActive = false, challengeVerified = false;
let botRequestId = null, knownPeople = [], uploading = false, peopleRequest = 0;
const sourceCanvas = document.createElement("canvas");
const lightCanvas = document.createElement("canvas");

function renderPage() {
  page.innerHTML = `
    <div class="page-heading-row"><div><div class="eyebrow"><span class="eyebrow-dot"></span> FACE LAB · VISIONFACE</div><h1 id="face-title">Hiểu khuôn mặt,<br><span>theo cách của bạn.</span></h1><p class="page-lead">Nhận diện, xác thực và phân tích đường nét trong cùng một không gian. Kết quả từ bộ phân tích VisionFace của bạn.</p></div><span class="coming-badge"><i></i> VISIONFACE ĐÃ TÍCH HỢP</span></div>
    <div class="face-native-layout">
      <div class="face-native-main">
        <article class="panel face-camera-panel">
          <div class="panel-heading"><div><span class="panel-overline">01 · CAMERA CỦA BẠN</span><h2>Giữ khuôn mặt trong khung</h2></div><span class="face-live-state" id="face-live-state" data-state="idle"><i></i><span>Camera đang tắt</span></span></div>
          <div class="face-camera-stage" id="face-camera-stage"><div class="face-camera-empty" id="face-camera-empty"><div class="camera-orbit"><svg><use href="#i-camera"/></svg><i></i></div><b>Sẵn sàng khi bạn cho phép</b><span>Webcam, camera USB hoặc camera điện thoại.</span></div><video id="face-video" autoplay muted playsinline hidden aria-label="Camera trực tiếp"></video><canvas id="face-overlay" hidden aria-hidden="true"></canvas><div class="face-guide-frame" id="face-guide-frame" hidden aria-hidden="true"><span></span><i></i></div><div class="face-camera-chip" id="face-camera-chip" hidden><i></i> VISIONFACE LIVE</div></div>
          <p class="face-live-message" id="face-live-message" role="status" aria-live="polite">Bật camera để bắt đầu. Bạn có thể dùng ảnh có sẵn để phân tích.</p>
          <div class="face-camera-actions"><button class="button button-primary" id="face-start-camera" type="button"><svg><use href="#i-camera"/></svg> Bật camera</button><button class="button button-outline" id="face-stop-camera" type="button" hidden>Dừng camera</button><button class="button button-outline" id="face-switch-camera" type="button" hidden>Đổi nhanh camera</button><button class="button button-outline" id="face-upload-button" type="button"><svg><use href="#i-upload"/></svg> Tải ảnh lên</button><input id="face-upload" type="file" accept="image/jpeg,image/png,image/webp" hidden></div>
          <div class="face-camera-settings"><label>Thiết bị camera<select id="face-device" aria-label="Thiết bị camera"><option value="">Camera mặc định</option></select></label><label>Độ phân giải<select id="face-resolution"><option value="720">HD · 1280 × 720</option><option value="1080">Full HD · 1920 × 1080</option><option value="480">VGA · 640 × 480</option></select></label><div class="face-camera-toggles"><label><input id="face-mirror" type="checkbox" checked> Lật gương</label><label><input id="face-show-mesh" type="checkbox" checked> Điểm mốc</label></div></div>
          <div class="face-privacy-note"><svg><use href="#i-shield"/></svg><p>Điểm mốc được gửi để nhận diện và xác thực. Ảnh được gửi khi bạn chọn phân tích; ảnh không tự lưu. Mô hình nhận diện tải từ CDN/Google.</p></div>
        </article>
        <section class="panel face-biometrics-panel"><div class="panel-heading"><div><span class="panel-overline">TÍN HIỆU TRỰC TIẾP</span><h2>Nhận diện & xác thực</h2></div><button class="button button-outline" id="face-challenge-start" type="button" disabled>Bắt đầu liveness</button></div><div class="face-biometric-grid"><div><span>Trạng thái mắt</span><b id="face-ear">—</b></div><div><span>Khẩu độ miệng</span><b id="face-mar">—</b></div><div><span>Góc quay đầu</span><b id="face-yaw">—</b></div><div><span>Đối chiếu hồ sơ</span><b id="face-match">Chưa nhận diện</b></div></div><p id="face-challenge-message" role="status">Chớp mắt, há miệng và quay đầu theo hướng dẫn khi bắt đầu.</p><progress id="face-challenge-progress" max="100" value="0" aria-label="Tiến độ xác thực"></progress></section>
      </div>
      <aside class="face-capture-column"><section class="panel face-capture-panel"><span class="panel-overline">02 · CHỤP & PHÂN TÍCH</span><h2>Chính diện, rồi góc nghiêng.</h2><p class="face-muted">Chụp chính diện để phân tích ngay; thêm góc nghiêng 15–40° để bổ sung phép đo.</p><div class="face-capture-slots"><article><div class="face-shot-preview" id="face-front-preview"><svg><use href="#i-face"/></svg></div><div><b>Chính diện</b><span id="face-front-state">Chưa chụp</span></div><button class="text-link" id="face-retake-front" type="button" hidden>Chụp lại</button></article><article><div class="face-shot-preview" id="face-profile-preview"><svg><use href="#i-face"/></svg></div><div><b>Góc nghiêng</b><span id="face-profile-state">Tùy chọn</span></div><button class="text-link" id="face-retake-profile" type="button" hidden>Chụp lại</button></article></div><div class="face-capture-guidance"><b id="face-capture-target">Nhìn thẳng vào camera</b><p id="face-capture-hint">Bật camera và giữ yên trong giây lát.</p><progress id="face-capture-stability" max="100" value="0" aria-label="Độ ổn định ảnh chụp"></progress></div><button class="button button-primary face-full-button" id="face-capture" type="button" disabled>Chụp chính diện</button><button class="button button-outline face-full-button" id="face-auto-profile" type="button" hidden disabled>Tự chụp khi đúng góc nghiêng</button><button class="text-link" id="face-cancel-auto" type="button" hidden>Hủy tự chụp</button><button class="button button-primary face-full-button" id="face-analyze" type="button" disabled><svg><use href="#i-spark"/></svg> Phân tích với VisionFace</button><div class="face-progress" id="face-progress" role="status" hidden><span class="face-spinner"></span><span>VisionFace đang phân tích…</span></div><p class="face-muted face-small">Góc máy và ánh sáng có thể làm thay đổi số đo. Điểm là chỉ số hình học tham khảo.</p></section></aside>
    </div>
    <section class="panel face-native-report" aria-labelledby="face-result-title"><div class="panel-overline">03 · BÁO CÁO VISIONFACE</div><div class="face-result-empty" id="face-result-empty"><span class="empty-orbit"><svg><use href="#i-chart"/></svg></span><h2 id="face-result-title">Kết quả sẽ xuất hiện tại đây</h2><p>Phân tích chính diện hoặc kết hợp góc nghiêng bằng cùng bộ thuật toán VisionFace.</p></div><div id="face-result-content" hidden></div></section>
    <section class="panel face-profiles-panel"><div class="panel-heading"><div><span class="panel-overline">04 · HỒ SƠ CỦA BẠN</span><h2>Lưu mẫu, nhận diện lần sau</h2></div><button class="text-link" id="face-refresh-people" type="button">Tải lại</button></div><form id="face-register-form" class="face-register-form"><label>Hồ sơ<select id="face-person"><option value="">Tạo hồ sơ mới</option></select></label><label>Tên hồ sơ<input id="face-person-name" maxlength="120" required placeholder="Tên bạn muốn lưu"></label><button class="button button-primary" id="face-register" type="submit" disabled>Lưu mẫu khuôn mặt</button></form><p class="face-muted" id="face-people-status">Đăng nhập để quản lý hồ sơ và mẫu khuôn mặt của bạn.</p><div id="face-people-list" class="face-people-list"></div></section>`;
}

function message(text, state = "info") { $("#face-live-message").textContent = text; $("#face-live-message").dataset.state = state; }
function live(text, state = "idle") { $("#face-live-state span").textContent = text; $("#face-live-state").dataset.state = state; }
function cancelAuto() { autoCapture = false; clearTimeout(autoTimeout); autoTimeout = 0; $("#face-cancel-auto").hidden = true; }
function resetStability() { frame = null; stableSince = 0; previousPose = null; $("#face-capture-stability").value = 0; $("#face-capture").disabled = true; $("#face-register").disabled = !front; }
function clearShots() { front = null; profile = null; cancelAuto(); resetStability(); updateShots(); }

function updateShots() {
  for (const [kind, shot] of [["front", front], ["profile", profile]]) {
    const host = $(`#face-${kind}-preview`); host.replaceChildren();
    if (shot) { const image = new Image(); image.src = shot.image; image.alt = kind === "front" ? "Ảnh chính diện đã chụp" : "Ảnh góc nghiêng đã chụp"; host.append(image); }
    else host.innerHTML = '<svg><use href="#i-face"/></svg>';
    $(`#face-${kind}-state`).textContent = shot ? "Đã chụp" : kind === "front" ? "Chưa chụp" : "Tùy chọn";
    $(`#face-retake-${kind}`).hidden = !shot;
  }
  $("#face-capture").textContent = front ? "Chụp góc nghiêng" : "Chụp chính diện";
  $("#face-capture-target").textContent = front ? "Nghiêng nhẹ 15–40°" : "Nhìn thẳng vào camera";
  $("#face-auto-profile").hidden = !front || Boolean(profile);
  $("#face-auto-profile").disabled = !stream;
  $("#face-capture").hidden = Boolean(front && profile);
  $("#face-analyze").disabled = !front || analyzing;
  $("#face-register").disabled = !front && !frame?.stable;
}

async function hasConsent() {
  try {
    await api.get("/api/auth/me");
    const consents = await api.get("/api/consents");
    if (consents.some(item => item.purpose === "face_analysis" && item.granted)) return true;
    message("Bật đồng ý phân tích khuôn mặt trong My Aura để tiếp tục.", "error");
    return false;
  } catch (error) {
    if (error.status === 401) window.dispatchEvent(new CustomEvent("auramaxx:auth-required"));
    else message(error.message, "error");
    return false;
  }
}

function cameraError(error) {
  return ({ NotAllowedError: "Hãy cho phép camera trong trình duyệt rồi thử lại.", NotFoundError: "Không tìm thấy camera. Hãy kiểm tra kết nối USB.", NotReadableError: "Camera đang được ứng dụng khác sử dụng. Đóng ứng dụng đó rồi thử lại.", OverconstrainedError: "Camera không hỗ trợ chế độ này. Hãy chọn độ phân giải khác.", AbortError: "Camera bị ngắt khi khởi động. Hãy thử lại." })[error.name] || error.message || "Không thể mở camera.";
}

async function enumerateCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "videoinput");
  const select = $("#face-device");
  if (!select) return;
  const current = stream?.getVideoTracks()[0]?.getSettings().deviceId || selectedDevice;
  select.replaceChildren(new Option("Camera mặc định", ""));
  devices.forEach((device, index) => {
    const external = /usb|logitech|obs|droidcam|external/i.test(device.label);
    select.add(new Option(`${external ? "USB · " : ""}${device.label || `Camera ${index + 1}`}`, device.deviceId));
  });
  if (devices.some(device => device.deviceId === current)) select.value = current;
  $("#face-switch-camera").hidden = !stream || devices.length < 2;
}

async function openCameraDevice(deviceId, mode) {
  const height = Number($("#face-resolution").value), width = height === 480 ? 640 : Math.round(height * 16 / 9);
  const device = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: mode } };
  const presets = [{ ...device, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 20, max: 30 } }, { ...device, width: { ideal: width }, height: { ideal: height } }, { ...device, width: { ideal: 640 } }, device];
  let lastError;
  for (const video of presets) {
    try { return await navigator.mediaDevices.getUserMedia({ video, audio: false }); }
    catch (error) { lastError = error; if (!["OverconstrainedError", "NotReadableError", "AbortError"].includes(error.name)) throw error; }
  }
  throw lastError;
}

async function startCamera(deviceId = $("#face-device").value, mode = facingMode) {
  if (starting || analyzing || uploading) return;
  starting = true;
  const id = ++operation;
  $("#face-start-camera").disabled = true;
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("Mở web bằng localhost hoặc HTTPS để dùng camera.");
    if (!await hasConsent() || id !== operation) return;
    message("Đang mở camera…"); live("Đang mở", "loading");
    const next = await openCameraDevice(deviceId, mode);
    if (id !== operation) { next.getTracks().forEach(track => track.stop()); return; }
    stream = next; facingMode = mode;
    selectedDevice = next.getVideoTracks()[0]?.getSettings().deviceId || deviceId;
    const video = $("#face-video"); video.srcObject = next; video.hidden = false;
    $("#face-camera-empty").hidden = true; $("#face-overlay").hidden = false;
    $("#face-guide-frame").hidden = false; $("#face-camera-chip").hidden = false;
    $("#face-start-camera").hidden = true; $("#face-stop-camera").hidden = false;
    mirrorCamera(); await video.play();
    if (id !== operation) return;
    await enumerateCameras();
    message("Camera đã mở. Đang tải nhận diện điểm mốc…");
    const nextDetector = detector || await createLandmarker();
    if (id !== operation) { if (nextDetector !== detector) nextDetector.close(); return; }
    detector = nextDetector;
    next.getVideoTracks()[0]?.addEventListener("ended", () => { if (id === operation) { stopCamera(); message("Camera đã ngắt kết nối. Hãy chọn lại thiết bị.", "error"); } }, { once: true });
    $("#face-challenge-start").disabled = false; updateShots();
    live("Đang tìm khuôn mặt", "loading"); timer = window.setTimeout(scanFrame, 50);
  } catch (error) { if (id === operation) { stopCamera(); message(cameraError(error), "error"); live("Camera chưa sẵn sàng", "error"); } }
  finally { if (id === operation) { starting = false; $("#face-start-camera").disabled = false; } }
}

function stopCamera() {
  operation++; starting = false; clearTimeout(timer); timer = 0; cancelAuto();
  analyzing = false; uploading = false; $("#face-progress").hidden = true;
  challengeActive = false; challengeVerified = false; $("#face-challenge-progress").value = 0;
  $("#face-challenge-message").textContent = "Bật camera và bắt đầu liveness để xác thực.";
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null; resetStability();
  const video = $("#face-video"); video.pause(); video.srcObject = null; video.hidden = true;
  for (const id of ["face-overlay", "face-guide-frame", "face-camera-chip", "face-stop-camera", "face-switch-camera"]) $(`#${id}`).hidden = true;
  $("#face-camera-empty").hidden = false; $("#face-start-camera").hidden = false; $("#face-start-camera").disabled = false;
  $("#face-challenge-start").disabled = true; $("#face-auto-profile").disabled = true;
  $("#face-overlay").getContext("2d")?.clearRect(0, 0, $("#face-overlay").width, $("#face-overlay").height);
  live("Camera đang tắt");
}

function mirrorCamera() {
  const mirrored = String($("#face-mirror").checked);
  $("#face-video").dataset.mirror = mirrored; $("#face-overlay").dataset.mirror = mirrored;
}

function drawOverlay(landmarks) {
  const canvas = $("#face-overlay"), video = $("#face-video"), rect = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.max(1, rect.width * dpr); canvas.height = Math.max(1, rect.height * dpr);
  if (!$("#face-show-mesh").checked) return;
  const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
  drawLandmarkOverlay(canvas.getContext("2d"), landmarks, video.videoWidth, video.videoHeight, { scale, offsetX: (canvas.width - video.videoWidth * scale) / 2, offsetY: (canvas.height - video.videoHeight * scale) / 2 });
}

function snapshot(source, landmarks, yaw = 0) {
  const canvas = document.createElement("canvas"); canvas.width = source.width; canvas.height = source.height;
  canvas.getContext("2d").drawImage(source, 0, 0);
  return { image: canvas.toDataURL("image/jpeg", .88), landmarks: landmarks.map(point => ({ x: point.x, y: point.y, z: point.z || 0 })), width: canvas.width, height: canvas.height, poseYaw: yaw, deviceId: selectedDevice };
}

function trackCapture(landmarks, now) {
  const step = front ? 2 : 1;
  let quality = evaluateCapturePose(landmarks, step, front?.poseYaw || 0, sourceCanvas.width / sourceCanvas.height);
  const light = sampleFrameLight(sourceCanvas, lightCanvas);
  if (light.mean < 36 || light.mean > 228 || light.contrast < 8) quality = { ...quality, ready: false, message: "Điều chỉnh ánh sáng để thấy rõ các đường nét." };
  const previous = previousPose;
  const moving = !previous || now - previous.time > 350 || Math.abs(quality.yaw - previous.yaw) > 4 || Math.hypot(landmarks[1].x - previous.x, landmarks[1].y - previous.y) > .018;
  if (!quality.ready || moving) stableSince = now;
  previousPose = { time: now, yaw: quality.yaw, x: landmarks[1].x, y: landmarks[1].y };
  const stable = quality.ready && now - stableSince >= STABLE_MS;
  frame = { landmarks, yaw: (quality.yaw || 0) + (front?.poseYaw || 0), stable, time: now };
  $("#face-capture-stability").value = quality.ready ? Math.min(100, (now - stableSince) / STABLE_MS * 100) : 0;
  $("#face-capture-hint").textContent = quality.message;
  $("#face-capture").disabled = !stable || analyzing;
  $("#face-register").disabled = !front && (!stable || step !== 1);
  if (stable && autoCapture && step === 2 && !profile) captureShot();
  live(stable ? "Đã căn đúng khuôn mặt" : "Đang căn chỉnh", stable ? "ready" : "loading");
  message(quality.message);
}

async function processFrame(landmarks, id) {
  if (serverBusy || performance.now() - lastServerAt < 360) return;
  serverBusy = true; lastServerAt = performance.now();
  try {
    const result = await api.post("/api/vision/process", { landmarks, check_challenge: challengeActive });
    if (id !== operation || !stream) return;
    const metrics = result.biometrics || {};
    $("#face-ear").textContent = Number.isFinite(metrics.ear) ? `${metrics.is_eye_closed ? "Đang nhắm" : "Đang mở"} · ${metrics.ear}` : "—";
    $("#face-mar").textContent = Number.isFinite(metrics.mar) ? `${metrics.is_mouth_open ? "Đang mở" : "Khép"} · ${metrics.mar}` : "—";
    $("#face-yaw").textContent = Number.isFinite(metrics.head_pose?.yaw) ? `${Math.round(metrics.head_pose.yaw)}°` : "—";
    $("#face-match").textContent = result.match?.matched ? `${result.match.name} · ${result.match.confidence}%` : "Chưa có hồ sơ khớp";
    if (result.challenge) {
      $("#face-challenge-message").textContent = result.challenge.status_message;
      $("#face-challenge-progress").value = result.challenge.progress_percentage || 0;
      challengeVerified = Boolean(result.challenge.is_verified);
      challengeActive = Boolean(result.challenge.is_active);
    }
  } catch (error) {
    if (id !== operation) return;
    if (error.status === 401 || error.status === 403) clearSensitiveView();
    message(`Chưa nhận được kết quả nhận diện: ${error.message}`, "error");
  }
  finally { serverBusy = false; }
}

function scanFrame() {
  if (!stream || !detector || document.hidden) return;
  const id = operation;
  try {
    const video = $("#face-video");
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const scale = Math.min(1, 1280 / video.videoWidth);
      sourceCanvas.width = Math.round(video.videoWidth * scale); sourceCanvas.height = Math.round(video.videoHeight * scale);
      sourceCanvas.getContext("2d").drawImage(video, 0, 0, sourceCanvas.width, sourceCanvas.height);
      const now = Math.max(performance.now(), lastDetectionTime + 1); lastDetectionTime = now;
      const faces = detector.detectForVideo(sourceCanvas, now).faceLandmarks || [];
      if (faces.length !== 1) {
        resetStability(); live(faces.length > 1 ? "Có nhiều khuôn mặt" : "Chưa thấy khuôn mặt", "idle");
        message(faces.length > 1 ? "Chỉ để một khuôn mặt trong khung để nhận diện và phân tích." : "Đưa khuôn mặt vào giữa khung.");
        $("#face-capture-hint").textContent = "Đang chờ một khuôn mặt rõ trong khung.";
        $("#face-overlay").getContext("2d").clearRect(0, 0, $("#face-overlay").width, $("#face-overlay").height);
      } else {
        drawOverlay(faces[0]); trackCapture(faces[0], now); void processFrame(faces[0], id);
      }
    }
  } catch (error) { resetStability(); message(cameraError(error), "error"); }
  if (stream && id === operation) timer = window.setTimeout(scanFrame, SCAN_INTERVAL);
}

function captureShot() {
  if (!frame?.stable || performance.now() - frame.time > 450 || analyzing || !stream) return;
  const captured = snapshot(sourceCanvas, frame.landmarks, frame.yaw);
  invalidateReport();
  if (!front) { front = captured; profile = null; }
  else { profile = captured; cancelAuto(); }
  resetStability(); updateShots();
  showToast(profile ? "Đã chụp góc nghiêng. Sẵn sàng phân tích." : "Đã chụp chính diện. Có thể phân tích ngay hoặc thêm góc nghiêng.", "success");
}

async function analyzeFace() {
  if (!front || analyzing) return;
  const before = operation;
  if (!await hasConsent() || before !== operation || !front) return;
  const savedFront = front, savedProfile = profile;
  stopCamera(); const id = operation;
  invalidateReport(); analyzing = true; $("#face-progress").hidden = false; updateShots();
  try {
    const payload = savedProfile ? { width: savedFront.width, height: savedFront.height, frontal: savedFront, profile: savedProfile } : { image: savedFront.image, landmarks: savedFront.landmarks, width: savedFront.width, height: savedFront.height };
    const result = await apiRequest("/api/vision/analyze_face", { method: "POST", body: JSON.stringify(payload), timeout: 45000 });
    if (id !== operation) return;
    if (!result.success) throw new Error(result.error || result.message || "VisionFace chưa phân tích được ảnh này.");
    report = result; setFaceReport(result); showResults(result, savedFront, savedProfile);
    message("Đã phân tích với VisionFace. Bạn có thể xem chi tiết hoặc xây dựng routine cùng Aura AI.", "success");
  } catch (error) { if (id === operation) { message(error.message, "error"); showToast(error.message, "error"); } }
  finally { if (id === operation) { analyzing = false; $("#face-progress").hidden = true; updateShots(); } }
}

function showResults(result, frontShot, profileShot) {
  const content = $("#face-result-content"), bot = getSelectedArenaBot();
  const warnings = result.measurement_quality?.warnings || [];
  content.innerHTML = `<div class="face-report-heading"><div><span class="panel-overline">VISIONFACE · KẾT QUẢ PHÂN TÍCH</span><h2>${escapeText(result.proportions?.face_shape || "Báo cáo khuôn mặt")}</h2><p>${escapeText(result.overall_grade)}</p></div><div class="face-engine-score"><strong>${Number.isFinite(result.overall_harmony_score) ? result.overall_harmony_score : "—"}</strong><span>/ 100 · chỉ số tham khảo</span></div></div><div class="face-report-images"></div><div class="face-report-quality"><b>Chất lượng & giới hạn phép đo</b><p>${escapeText(result.measurement_quality?.label || "Các số đo hình học chỉ có tính tham khảo.")}</p>${warnings.map(warning => `<p>${escapeText(warning)}</p>`).join("")}</div><div class="face-engine-details">${renderReportDetails(result)}</div><div class="face-result-actions"><button class="button button-primary" type="button" data-face-action="routine"><svg><use href="#i-spark"/></svg> Xây dựng routine với Aura AI</button><button class="button button-outline" type="button" data-face-action="explain">Giải thích kết quả</button><button class="button button-outline" type="button" data-face-action="download">Tải báo cáo JSON</button><button class="button button-outline" type="button" data-face-action="print">In báo cáo</button><button class="text-link" type="button" data-face-action="delete">Xóa kết quả</button></div><div class="face-native-bot"><div><span class="panel-overline">ARENA · LUYỆN TẬP</span><p>${bot ? `Đối thủ đã chọn: ${escapeText(bot.name)}` : "Chọn đối thủ trong Arena để dùng kết quả này."}</p><small>Chỉ dùng nhóm có phép đo từ VisionFace. Các nhóm chưa được đo sẽ để trống.</small></div><button class="button button-outline" data-face-action="bot" type="button" ${bot ? "" : "disabled"}>Đấu BOT</button><p id="face-bot-battle-outcome" role="status"></p></div>`;
  for (const [shot, label] of [[frontShot, "Chính diện"], [profileShot, "Góc nghiêng"]]) {
    if (!shot) continue;
    const figure = document.createElement("figure"), caption = document.createElement("figcaption");
    figure.className = "face-report-figure"; caption.textContent = `${label} · đường đo VisionFace`;
    const visual = document.createElement("div"); visual.className = "face-report-visual";
    const image = new Image(), overlay = document.createElement("canvas");
    image.alt = label; overlay.setAttribute("aria-hidden", "true");
    image.onload = () => {
      if (!content.contains(figure)) return;
      overlay.width = image.naturalWidth; overlay.height = image.naturalHeight;
      drawReportGuides(overlay, label === "Chính diện" ? result.visual_guides : result.profile?.visual_guides);
    };
    image.src = shot.image; visual.append(image, overlay); figure.append(visual, caption);
    content.querySelector(".face-report-images").append(figure);
  }
  content.querySelector('[data-face-action="routine"]').addEventListener("click", () => askAI("Hãy gợi ý routine chăm sóc cơ bản trong 7 ngày dựa trên kết quả VisionFace này. Hỏi thêm về loại da, mục tiêu và thói quen của tôi trước khi cá nhân hóa. Không suy ra tình trạng sức khỏe từ khuôn mặt."));
  content.querySelector('[data-face-action="explain"]').addEventListener("click", () => askAI("Giải thích kết quả VisionFace của tôi, ưu tiên chất lượng ảnh, giới hạn số đo và các gợi ý chăm sóc có thể thực hiện."));
  content.querySelector('[data-face-action="delete"]').addEventListener("click", clearResults);
  content.querySelector('[data-face-action="download"]').addEventListener("click", downloadReport);
  content.querySelector('[data-face-action="print"]').addEventListener("click", () => window.print());
  content.querySelector('[data-face-action="bot"]').addEventListener("click", event => void submitBotBattle(event.currentTarget));
  $("#face-result-empty").hidden = true; content.hidden = false;
  content.scrollIntoView({ behavior: "smooth", block: "start" });
}

function drawReportGuides(canvas, guides = {}) {
  const context = canvas.getContext("2d");
  context.lineWidth = Math.max(2, canvas.width / 400); context.lineJoin = "round";
  const line = (points, color, closed = false) => {
    if (!Array.isArray(points) || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return;
    context.strokeStyle = color; context.beginPath();
    points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    if (closed) context.closePath(); context.stroke();
  };
  line(guides.midline, "#54d6cf"); line(guides.jawline_polygon, "#54d6cf"); line(guides.nose_triangle, "#e9c982", true);
  line(guides.eline, "#54d6cf"); line(guides.nasolabial_rays, "#e9c982"); line(guides.jaw_profile_triangle, "#bc8bff");
  for (const item of guides.thirds_lines || []) if (Number.isFinite(item.y)) line([{ x: canvas.width * .18, y: item.y }, { x: canvas.width * .82, y: item.y }], "#bc8bff");
}

function askAI(prompt) {
  window.location.hash = "aura-ai";
  window.dispatchEvent(new CustomEvent("auramaxx:ai-request", { detail: { message: prompt, attach: true } }));
}

async function submitBotBattle(button) {
  const bot = getSelectedArenaBot(); if (!bot || !report) return;
  button.disabled = true; botRequestId ||= crypto.randomUUID();
  try {
    const match = await api.post("/api/arena/bot-matches", { request_id: botRequestId, bot_id: bot.id, groups: reportToArenaGroups(report) });
    $("#face-bot-battle-outcome").textContent = `${match.result === "win" ? "Thắng" : match.result === "draw" ? "Hòa" : "Thua"} · ${match.elo_after} ELO luyện tập`;
    window.dispatchEvent(new CustomEvent("auramaxx:arena-refresh"));
  } catch (error) { $("#face-bot-battle-outcome").textContent = error.message; button.disabled = false; }
}

function downloadReport() {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "visionface-report.json"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function invalidateReport() {
  report = null; botRequestId = null; setFaceReport(null);
  $("#face-result-content").replaceChildren(); $("#face-result-content").hidden = true; $("#face-result-empty").hidden = false;
}

function clearResults() {
  stopCamera();
  invalidateReport();
  clearShots(); message("Đã xóa ảnh chụp và kết quả khỏi bộ nhớ của trang.");
}

async function startChallenge() {
  const id = operation;
  if (!stream || !await hasConsent() || id !== operation || !stream) return;
  $("#face-challenge-start").disabled = true;
  try {
    const result = await api.post("/api/vision/challenge/start", {});
    if (id !== operation) return;
    challengeActive = true; challengeVerified = false;
    $("#face-challenge-message").textContent = result.state.status_message;
    $("#face-challenge-progress").value = result.state.progress_percentage || 0;
  } catch (error) { if (id === operation) message(error.message, "error"); }
  finally { if (id === operation) $("#face-challenge-start").disabled = !stream; }
}

async function loadPeople() {
  const request = ++peopleRequest;
  try {
    const result = await api.get("/api/vision/faces");
    if (request !== peopleRequest) return;
    knownPeople = result.faces;
    const select = $("#face-person"), list = $("#face-people-list"), selected = select.value;
    select.replaceChildren(new Option("Tạo hồ sơ mới", "")); list.replaceChildren();
    for (const person of knownPeople) {
      select.add(new Option(`${person.name} · ${person.sample_count} mẫu`, person.id));
      const card = document.createElement("article"); card.className = "face-person-card";
      const name = document.createElement("b"); name.textContent = person.name;
      const count = document.createElement("span"); count.textContent = `${person.sample_count} mẫu đã lưu`;
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-link"; remove.textContent = "Xóa";
      remove.addEventListener("click", async () => { if (!confirm(`Xóa hồ sơ ${person.name} và các mẫu khuôn mặt?`)) return; try { await api.delete("/api/vision/faces", { id: person.id }); await loadPeople(); } catch (error) { showToast(error.message, "error"); } });
      card.append(name, count, remove); list.append(card);
    }
    const person = knownPeople.find(item => item.id === selected);
    if (person) { select.value = person.id; $("#face-person-name").value = person.name; $("#face-person-name").readOnly = true; }
    else if ($("#face-person-name").readOnly) { $("#face-person-name").value = ""; $("#face-person-name").readOnly = false; }
    $("#face-people-status").textContent = knownPeople.length ? "Chọn hồ sơ để thêm mẫu; mỗi hồ sơ giữ các mẫu riêng." : "Chưa có hồ sơ. Chụp chính diện rồi đặt tên để lưu mẫu đầu tiên.";
  } catch (error) { if (request !== peopleRequest) return; knownPeople = []; $("#face-people-list").replaceChildren(); $("#face-people-status").textContent = error.status === 401 ? "Đăng nhập để quản lý hồ sơ khuôn mặt." : error.message; }
}

async function registerFace(event) {
  event.preventDefault();
  const captured = front || (frame?.stable ? snapshot(sourceCanvas, frame.landmarks, frame.yaw) : null);
  if (!captured || !await hasConsent()) return;
  const button = $("#face-register"); button.disabled = true;
  try {
    const personId = $("#face-person").value;
    const payload = { name: $("#face-person-name").value.trim(), landmarks: captured.landmarks, ...(personId ? { user_id: personId } : {}) };
    const result = await api.post("/api/vision/register", payload);
    showToast(result.message, "success"); await loadPeople();
  } catch (error) { showToast(error.message, "error"); }
  finally { button.disabled = !front && !frame?.stable; }
}

async function uploadImage(event) {
  const file = event.target.files?.[0]; event.target.value = "";
  const before = operation;
  if (!file || analyzing || uploading || !await hasConsent() || before !== operation) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) { message("Chọn ảnh JPG, PNG hoặc WebP tối đa 8 MB.", "error"); return; }
  stopCamera(); clearResults(); const id = operation; uploading = true;
  let imageDetector;
  $("#face-progress").hidden = false;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const canvas = document.createElement("canvas"), scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale); canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    imageDetector = await createLandmarker("IMAGE");
    if (id !== operation) return;
    const faces = imageDetector.detect(canvas).faceLandmarks || [];
    if (faces.length !== 1) throw new Error(faces.length ? "Ảnh có nhiều khuôn mặt. Chọn ảnh chỉ có một người." : "Không tìm thấy khuôn mặt trong ảnh. Chọn ảnh chính diện rõ hơn.");
    front = snapshot(canvas, faces[0]); profile = null; updateShots();
    await analyzeFace();
  } catch (error) { if (id === operation) message(error.message || "Không đọc được ảnh.", "error"); }
  finally { imageDetector?.close(); if (id === operation) { uploading = false; $("#face-progress").hidden = !analyzing; } }
}

async function changeCamera(deviceId, mode = facingMode) {
  clearResults(); selectedDevice = deviceId;
  await new Promise(resolve => window.setTimeout(resolve, 250));
  if (window.location.hash === "#face-lab") await startCamera(deviceId, mode);
}

function clearSensitiveView() {
  peopleRequest++; knownPeople = []; $("#face-people-list").replaceChildren();
  $("#face-person").replaceChildren(new Option("Tạo hồ sơ mới", ""));
  $("#face-person-name").value = ""; $("#face-person-name").readOnly = false;
  stopCamera(); clearResults(); challengeActive = false; challengeVerified = false;
  $("#face-challenge-progress").value = 0; $("#face-match").textContent = "Chưa nhận diện";
  for (const id of ["face-ear", "face-mar", "face-yaw"]) $(`#${id}`).textContent = "—";
  detector?.close(); detector = null;
}

export function initFaceLab() {
  renderPage();
  $("#face-start-camera").addEventListener("click", () => void startCamera());
  $("#face-stop-camera").addEventListener("click", () => { stopCamera(); message("Camera đã tắt."); });
  $("#face-device").addEventListener("change", event => { selectedDevice = event.target.value; if (stream) void changeCamera(selectedDevice); });
  $("#face-resolution").addEventListener("change", () => { if (stream) void changeCamera(selectedDevice); });
  $("#face-switch-camera").addEventListener("click", () => {
    const devices = [...$("#face-device").options].filter(option => option.value);
    const index = devices.findIndex(option => option.value === selectedDevice);
    const next = devices[(index + 1) % Math.max(1, devices.length)];
    const previousFacingMode = facingMode;
    const nextMode = previousFacingMode === "user" ? "environment" : "user";
    void changeCamera(next?.value || "", nextMode);
  });
  $("#face-mirror").addEventListener("change", mirrorCamera);
  $("#face-capture").addEventListener("click", captureShot);
  $("#face-auto-profile").addEventListener("click", () => { if (!stream || !front) return; autoCapture = true; $("#face-cancel-auto").hidden = false; autoTimeout = window.setTimeout(() => { cancelAuto(); message("Đã hết thời gian tự chụp. Bạn có thể thử lại."); }, 20000); });
  $("#face-cancel-auto").addEventListener("click", cancelAuto);
  $("#face-retake-front").addEventListener("click", clearResults);
  $("#face-retake-profile").addEventListener("click", () => { if (analyzing) stopCamera(); invalidateReport(); profile = null; cancelAuto(); resetStability(); updateShots(); });
  $("#face-analyze").addEventListener("click", () => void analyzeFace());
  $("#face-challenge-start").addEventListener("click", () => void startChallenge());
  $("#face-upload-button").addEventListener("click", () => $("#face-upload").click());
  $("#face-upload").addEventListener("change", event => void uploadImage(event));
  $("#face-register-form").addEventListener("submit", event => void registerFace(event));
  $("#face-person").addEventListener("change", event => { const person = knownPeople.find(item => item.id === event.target.value); $("#face-person-name").value = person?.name || ""; $("#face-person-name").readOnly = Boolean(person); });
  $("#face-refresh-people").addEventListener("click", () => void loadPeople());
  window.addEventListener("hashchange", () => {
    if (window.location.hash !== "#face-lab") { stopCamera(); clearShots(); $("#face-result-content").querySelectorAll(".face-report-figure").forEach(figure => figure.remove()); }
    else void loadPeople();
  });
  window.addEventListener("auramaxx:auth-changed", () => { clearSensitiveView(); void loadPeople(); });
  window.addEventListener("auramaxx:bot-selected", () => {
    const button = page.querySelector('[data-face-action="bot"]');
    if (!button) return;
    const bot = getSelectedArenaBot(); botRequestId = null;
    button.disabled = !bot;
    page.querySelector(".face-native-bot p").textContent = bot ? `Đối thủ đã chọn: ${bot.name}` : "Chọn đối thủ trong Arena để dùng kết quả này.";
    $("#face-bot-battle-outcome").textContent = "";
  });
  window.addEventListener("auramaxx:consent-changed", event => { if (event.detail?.purpose === "face_analysis" && !event.detail.granted) clearSensitiveView(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopCamera(); });
  navigator.mediaDevices?.addEventListener?.("devicechange", () => void enumerateCameras().catch(() => {}));
  window.addEventListener("pagehide", clearSensitiveView);
  void enumerateCameras().catch(() => {}); void loadPeople();
}
