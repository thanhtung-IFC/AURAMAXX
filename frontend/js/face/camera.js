// Camera negotiation uses advertised capabilities, never device brand guesses.
export function cameraSettings(track) {
  try { return track?.getSettings?.() || {}; } catch { return {}; }
}
export function cameraCapabilities(track) {
  try { return track?.getCapabilities?.() || {}; } catch { return {}; }
}
const cancelled = () => new DOMException("Đã hủy mở camera.", "AbortError");
const stop = stream => stream.getTracks().forEach(track => track.stop());

async function requestCamera(mediaDevices, video, signal) {
  if (signal?.aborted) throw cancelled();
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal?.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      if (signal?.aborted) throw cancelled();
      return mediaDevices.getUserMedia({ video, audio: false });
    }).then(stream => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) { stop(stream); reject(cancelled()); }
      else resolve(stream);
    }, error => { signal?.removeEventListener("abort", abort); reject(error); });
  });
}

export async function openCamera({ mediaDevices = navigator.mediaDevices, deviceId = "", facingMode = "user", strictFacing = false, resolution = "auto", signal } = {}) {
  let selection = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { [strictFacing ? "exact" : "ideal"]: facingMode } };
  const height = resolution === "auto" ? 720 : Number(resolution);
  const width = height === 480 ? 640 : Math.round(height * 16 / 9);
  let result, fallback = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const video = attempt === 2 ? selection : {
      ...selection, width: { ideal: attempt ? 640 : width }, height: { ideal: attempt ? 480 : height }, frameRate: { ideal: 24, max: 30 },
    };
    try { result = await requestCamera(mediaDevices, video, signal); break; }
    catch (error) {
      if (signal?.aborted || !["OverconstrainedError", "NotFoundError"].includes(error.name)) throw error;
      if (strictFacing && error.constraint === "facingMode") throw new Error("Thiết bị không cung cấp camera theo hướng đã chọn. Hãy chọn camera trong Cài đặt camera.");
      if (deviceId && (error.name === "NotFoundError" || error.constraint === "deviceId")) { selection = { facingMode: { ideal: facingMode } }; deviceId = ""; fallback = true; }
      if (attempt === 2) throw error;
    }
  }
  const abort = () => stop(result);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw cancelled();
    const track = result.getVideoTracks()[0];
    if (!track) throw new Error("Camera chưa cung cấp hình ảnh.");
    const capabilities = cameraCapabilities(track), settings = cameraSettings(track);
    let applied = track.getConstraints?.() || { width: { ideal: settings.width || width }, height: { ideal: settings.height || height }, frameRate: { ideal: 24, max: 30 } };
    if (resolution === "auto" && track.applyConstraints) {
      const maxWidth = capabilities.width?.max || 0, maxHeight = capabilities.height?.max || 0;
      const portrait = (settings.width || 0) < (settings.height || 0);
      if (Math.max(maxWidth, maxHeight) >= 1920 && Math.min(maxWidth, maxHeight) >= 1080) {
        // Cap capture at Full HD; keep the existing stream if negotiation fails.
        const upgrade = { ...applied, width: { ideal: portrait ? 1080 : 1920, max: portrait ? 1080 : 1920 }, height: { ideal: portrait ? 1920 : 1080, max: portrait ? 1920 : 1080 }, frameRate: { ideal: 24, max: 30 } };
        await track.applyConstraints(upgrade).then(() => { applied = upgrade; }).catch(() => {});
      }
    }
    if (signal?.aborted) throw cancelled();
    const automatic = {};
    for (const name of ["focusMode", "exposureMode", "whiteBalanceMode"]) {
      if (capabilities[name]?.includes?.("continuous")) automatic[name] = "continuous";
    }
    if (Object.keys(automatic).length && track.applyConstraints) await track.applyConstraints({ ...applied, advanced: [automatic] }).catch(() => {});
    if (signal?.aborted) throw cancelled();
    return { stream: result, capabilities, settings: cameraSettings(track), fallback };
  } catch (error) { stop(result); throw error; }
  finally { signal?.removeEventListener("abort", abort); }
}

export function fittedFrame(width, height, longestEdge) {
  const scale = Math.min(1, longestEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Hysteresis avoids repeatedly changing processing size on a busy device.
export class CameraWorkload {
  constructor() { this.reset(); }
  reset() { this.longestEdge = 960; this.interval = 66; this.average = 0; this.slow = 0; this.fast = 0; this.samples = 0; }
  observe(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    this.average = this.samples++ ? .8 * this.average + .2 * milliseconds : milliseconds;
    this.slow = this.average > 110 ? this.slow + 1 : 0;
    this.fast = this.average < 45 ? this.fast + 1 : 0;
    if (this.slow >= 6) {
      this.longestEdge = this.longestEdge > 640 ? 640 : 480;
      this.interval = this.longestEdge === 480 ? 125 : 90;
      this.slow = 0; this.fast = 0;
    } else if (this.fast >= 30 && this.longestEdge < 960) {
      this.longestEdge = this.longestEdge < 640 ? 640 : 960;
      this.interval = this.longestEdge === 960 ? 66 : 90;
      this.fast = 0;
    }
  }
}
