const MODES = ["auto", "economy", "balanced", "quality"];
const STORAGE_KEY = "auramaxx-performance-mode";
let mode = "auto", tier = "balanced";

export function performanceHint(device = navigator) {
  const cores = Number(device.hardwareConcurrency), memory = Number(device.deviceMemory);
  return (cores > 0 && cores <= 4) || (memory > 0 && memory <= 2) ? "economy" : "balanced";
}
export function getPerformanceMode() { return mode; }
export function setPerformanceTier(value) {
  if (!["economy", "balanced", "quality"].includes(value)) return;
  tier = value;
  if (document.documentElement.dataset.performanceTier !== tier) document.documentElement.dataset.performanceTier = tier;
}
function applyMode() {
  document.documentElement.dataset.performanceMode = mode;
  setPerformanceTier(mode === "auto" ? performanceHint() : mode);
  document.querySelectorAll("[data-performance-mode-select]").forEach(select => { select.value = mode; });
  window.dispatchEvent(new CustomEvent("auramaxx:performance-mode", { detail: { mode, tier } }));
}
export function setPerformanceMode(value) {
  if (!MODES.includes(value)) return;
  mode = value;
  // Only the user's four-way preference is saved, never hardware or measurements.
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* Use this tab's choice. */ }
  applyMode();
}
export function initPerformance() {
  try { const saved = localStorage.getItem(STORAGE_KEY); if (MODES.includes(saved)) mode = saved; } catch { /* Defaults work without storage. */ }
  applyMode();
  document.addEventListener("change", event => {
    if (event.target.matches?.("[data-performance-mode-select]")) setPerformanceMode(event.target.value);
  });
  window.addEventListener("storage", event => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    mode = MODES.includes(event.newValue) ? event.newValue : "auto";
    applyMode();
  });
}
