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

export async function openCamera({ mediaDevices = navigator.mediaDevices, deviceId = "", facingMode = "user", strictFacing = false, resolution = "auto", frameRate = 24, preferFullHD = true, signal } = {}) {
  let selection = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { [strictFacing ? "exact" : "ideal"]: facingMode } };
  const height = resolution === "auto" ? 720 : Number(resolution);
  const width = height === 480 ? 640 : Math.round(height * 16 / 9);
  let result, fallback = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const video = attempt === 2 ? selection : {
      ...selection, width: { ideal: attempt ? 640 : width }, height: { ideal: attempt ? 480 : height }, frameRate: { ideal: frameRate, max: 30 },
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
    if (resolution === "auto" && preferFullHD && track.applyConstraints) {
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

export const CAMERA_PROFILES = Object.freeze({
  economy: Object.freeze({ longestEdge: 480, interval: 125, overlayInterval: 200, pixelRatio: 1, frameRate: 20, height: 720 }),
  balanced: Object.freeze({ longestEdge: 640, interval: 90, overlayInterval: 100, pixelRatio: 1.5, frameRate: 24, height: 720 }),
  quality: Object.freeze({ longestEdge: 960, interval: 66, overlayInterval: 66, pixelRatio: 2, frameRate: 30, height: 1080 }),
});
const TIERS = Object.keys(CAMERA_PROFILES);
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] || 0;
};

// Timed calibration and hysteresis use camera/UI measurements, never API latency.
export class CameraWorkload {
  constructor(options) { this.reset(options); }
  reset({ mode = "auto", hint = "balanced", now = performance.now() } = {}) {
    this.mode = mode === "auto" || TIERS.includes(mode) ? mode : "auto";
    this.tier = this.mode === "auto" ? (TIERS.includes(hint) ? hint : "balanced") : this.mode;
    this.phase = this.mode === "auto" ? "warming" : "ready";
    this.startedAt = now; this.changedAt = now; this.samples = []; this.warmup = 0;
    this.slowAt = null; this.fastAt = null; this.liveness = false;
  }
  get profile() { return CAMERA_PROFILES[this.tier]; }
  get longestEdge() { return this.liveness ? Math.max(640, this.profile.longestEdge) : this.profile.longestEdge; }
  get interval() { return this.liveness ? Math.min(66, this.profile.interval) : this.profile.interval; }
  setLiveness(active, now = performance.now()) {
    if (this.liveness === active) return;
    this.liveness = active; this.samples = []; this.slowAt = null; this.fastAt = null;
    if (this.mode === "auto" && this.phase !== "ready") { this.startedAt = now; this.warmup = 0; }
  }
  observe(milliseconds, { now = performance.now(), uiDelay = 0 } = {}) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0 || !Number.isFinite(now)) return false;
    if (this.mode !== "auto" || this.liveness) return false;
    // Ignore initial WASM/shader warmup before comparing sustained costs.
    if (this.warmup++ < 3) return false;
    this.samples.push({ cost: milliseconds, ui: Number.isFinite(uiDelay) ? Math.max(0, uiDelay) : 0 });
    if (this.samples.length > 24) this.samples.shift();
    this.phase = this.phase === "warming" ? "calibrating" : this.phase;
    const cost = percentile(this.samples.map(item => item.cost), .9), ui = percentile(this.samples.map(item => item.ui), .9);
    const current = TIERS.indexOf(this.tier);
    let target = current;
    if (this.phase === "calibrating") {
      if (now - this.startedAt < 3000 || this.samples.length < 12) return false;
      target = cost > 110 || ui > 60 ? 0 : cost > 55 || ui > 30 ? 1 : 2;
      this.phase = "ready";
    } else {
      const slow = cost > (current === 2 ? 95 : 140) || ui > 60;
      const fast = cost < 40 && ui < 20;
      this.slowAt = slow ? this.slowAt ?? now : null;
      this.fastAt = fast ? this.fastAt ?? now : null;
      if (this.samples.length >= 6 && this.slowAt !== null && now - this.slowAt >= 2000 && current > 0) target--;
      else if (this.fastAt !== null && now - this.fastAt >= 10000 && now - this.changedAt >= 10000 && current < 2) target++;
    }
    if (target === current) return false;
    this.tier = TIERS[target]; this.changedAt = now; this.samples = []; this.slowAt = null; this.fastAt = null;
    return true;
  }
}

// Coalesce rapid changes and preserve unrelated camera constraints (focus, etc.).
export class CameraConfigurator {
  constructor(track) { this.track = track; this.revision = 0; this.pending = Promise.resolve(false); this.key = ""; this.closed = false; }
  close() { this.closed = true; this.revision++; }
  configure({ height = null, frameRate = 24 } = {}) {
    const key = `${height}:${frameRate}`;
    if (this.closed || key === this.key) return this.pending;
    this.key = key;
    const revision = ++this.revision;
    this.pending = this.pending.catch(() => false).then(async () => {
      const track = this.track;
      if (this.closed || revision !== this.revision || track.readyState === "ended" || !track.applyConstraints) return false;
      const settings = cameraSettings(track), caps = cameraCapabilities(track);
      const base = { ...(settings.width ? { width: { ideal: settings.width } } : {}), ...(settings.height ? { height: { ideal: settings.height } } : {}), ...track.getConstraints?.() };
      const rate = Math.max(caps.frameRate?.min || 1, Math.min(caps.frameRate?.max || 30, frameRate));
      const next = { ...base, frameRate: { ideal: rate, max: rate } };
      const portrait = settings.width < settings.height;
      if (height && (height <= 720 || Math.max(caps.width?.max || 0, caps.height?.max || 0) >= 1920 && Math.min(caps.width?.max || 0, caps.height?.max || 0) >= 1080)) {
        const width = Math.round(height * 16 / 9);
        next.width = { ideal: portrait ? height : width, max: portrait ? height : width };
        next.height = { ideal: portrait ? width : height, max: portrait ? width : height };
      }
      try { await track.applyConstraints(next); }
      catch {
        if (this.closed || revision !== this.revision || track.readyState === "ended") return false;
        try { await track.applyConstraints({ ...base, frameRate: next.frameRate }); } catch { return false; }
      }
      return !this.closed && revision === this.revision;
    });
    return this.pending;
  }
}
