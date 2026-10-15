import { api } from "../api.js";

const LABELS = { water: "Uống nước", sleep: "Nghỉ ngơi", movement: "Vận động", self_care: "Chăm sóc bản thân" };
let initialized = false;
let progressRequest = 0;
let progressController = null;

function showAccessMessage(title, description, action) {
  const empty = document.querySelector(".progress-empty-panel .empty-state");
  empty.replaceChildren();
  const icon = document.createElement("span");
  icon.className = "empty-orbit";
  icon.innerHTML = '<svg><use href="#i-chart"/></svg>';
  const heading = document.createElement("b");
  heading.textContent = title;
  const copy = document.createElement("p");
  copy.textContent = description;
  const button = document.createElement("button");
  button.className = "button button-outline";
  button.type = "button";
  button.textContent = action === "consent" ? "Quản lý đồng ý trong My Aura" : action === "retry" ? "Thử lại" : action === "health" ? "Mở Health Hub" : "Đăng nhập";
  button.addEventListener("click", () => {
    if (action === "consent") window.location.hash = "my-aura";
    else if (action === "login") window.dispatchEvent(new CustomEvent("auramaxx:auth-required", { detail: { mode: "login" } }));
    else if (action === "health") window.location.hash = "health-hub";
    else loadProgress();
  });
  empty.append(icon, heading, copy, button);
  empty.hidden = false;
  document.querySelector(".progress-data-summary")?.remove();
}

function renderProgress(summary) {
  const empty = document.querySelector(".progress-empty-panel .empty-state");
  if (summary.total_entries === 0) {
    showAccessMessage("Chưa có bản ghi để tổng hợp", "Khi bạn ghi nhận thói quen, dữ liệu thật sẽ xuất hiện ở đây.", "health");
    return;
  }

  empty.hidden = true;
  let result = document.querySelector(".progress-data-summary");
  if (!result) {
    result = document.createElement("div");
    result.className = "progress-data-summary";
    document.querySelector(".progress-empty-panel").append(result);
  }
  result.replaceChildren();

  const total = document.createElement("div");
  total.className = "progress-total";
  const number = document.createElement("strong");
  number.textContent = String(summary.total_entries);
  const label = document.createElement("span");
  label.textContent = "bản ghi do bạn tạo";
  total.append(number, label);
  result.append(total);

  const categories = document.createElement("div");
  categories.className = "progress-category-list";
  const maxCount = Math.max(1, ...summary.categories.map((item) => item.entries));
  summary.categories.forEach((item) => {
    const row = document.createElement("div");
    row.className = "progress-category";
    const name = document.createElement("span");
    name.textContent = LABELS[item.category] || "Thói quen";
    const track = document.createElement("span");
    track.className = "progress-category-track";
    const bar = document.createElement("i");
    bar.style.width = `${Math.round(item.entries / maxCount * 100)}%`;
    track.append(bar);
    const count = document.createElement("span");
    count.className = "progress-category-count";
    count.textContent = String(item.entries);
    row.append(name, track, count);
    categories.append(row);
  });
  result.append(categories);

  if (summary.entries.length) {
    const recent = document.createElement("div");
    recent.className = "progress-recent";
    const recentTitle = document.createElement("b");
    recentTitle.textContent = "Bản ghi gần đây";
    const detail = document.createElement("p");
    const item = summary.entries[0];
    detail.textContent = `${LABELS[item.category] || "Thói quen"}: ${item.value}${item.unit ? ` ${item.unit}` : ""}`;
    recent.append(recentTitle, detail);
    result.append(recent);
  }
}

async function loadProgress() {
  if (window.location.hash !== "#progress") return;
  const request = ++progressRequest;
  progressController?.abort();
  progressController = new AbortController();
  try {
    const summary = await api.get("/api/progress/summary", { signal: progressController.signal });
    if (request !== progressRequest) return;
    renderProgress(summary);
  } catch (error) {
    if (request !== progressRequest) return;
    if (error.status === 401) showAccessMessage("Đăng nhập để xem tiến trình", "Tiến trình chỉ tổng hợp dữ liệu thuộc tài khoản của bạn.", "login");
    else if (error.status === 403) showAccessMessage("Bạn chưa bật theo dõi sức khỏe", "Hãy xem lựa chọn Health Hub trong My Aura nếu bạn muốn xem tiến trình.", "consent");
    else showAccessMessage("Chưa tải được tiến trình", "Dữ liệu chưa thay đổi. Kiểm tra kết nối backend rồi thử lại.", "retry");
  }
}

function cancelProgress() {
  progressRequest++;
  progressController?.abort();
}

function resetProgress() {
  cancelProgress();
  showAccessMessage("Đăng nhập để xem tiến trình", "Tiến trình chỉ tổng hợp dữ liệu thuộc tài khoản của bạn.", "login");
  if (window.location.hash === "#progress") void loadProgress();
}

export function initProgress() {
  if (initialized) return;
  initialized = true;
  window.addEventListener("auramaxx:auth-changed", resetProgress);
  document.addEventListener("auramaxx:routechange", () => {
    if (window.location.hash === "#progress") loadProgress();
    else cancelProgress();
  });
  window.addEventListener("auramaxx:progress-refresh", () => {
    if (window.location.hash === "#progress") loadProgress();
  });
  window.addEventListener("auramaxx:consent-changed", (event) => {
    if (event.detail?.purpose === "health_tracking") resetProgress();
  });
  if (window.location.hash === "#progress") loadProgress();
}
