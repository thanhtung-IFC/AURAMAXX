import { api } from "../api.js";
import { getFaceReport, escapeText } from "../face/report.js";
import { showToast } from "../ui.js";

const $ = selector => document.querySelector(selector);
const page = () => $('[data-page="health-hub"]');
let routine = null, busy = false, requestNumber = 0, sessionNumber = 0, filter = "all";

function setBusy(value) {
  busy = value;
  page().querySelectorAll("[data-routine-action], #routine-generate, #routine-intensity, #routine-feedback").forEach(button => {
    const alreadyAdded = button.dataset.routineAction === "add" && routine?.tasks.some(task => task.id === button.dataset.taskId && !task.dismissed);
    button.disabled = value || !routine || alreadyAdded;
  });
  $("#routine-use-report").disabled = value || !routine || !getFaceReport();
  const streak = routine?.streak;
  $("#routine-freeze").disabled = value || !streak?.count || !streak.freezes_left || streak.frozen_today || streak.completed_today;
  $("#routine-clear-report").disabled = value || !routine;
}

function accessMessage(message, action = "") {
  const host = $("#routine-access");
  host.replaceChildren(document.createTextNode(message));
  host.hidden = false;
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "text-link";
    button.textContent = action === "login" ? "Đăng nhập" : action === "consent" ? "Quản lý đồng ý" : "Thử lại";
    button.addEventListener("click", () => {
      if (action === "login") window.dispatchEvent(new CustomEvent("auramaxx:auth-required", { detail: { mode: "login" } }));
      else if (action === "consent") window.location.hash = "my-aura";
      else void loadRoutine();
    });
    host.append(button);
  }
}

function guide(item) {
  return `<details class="routine-guide"><summary>Hướng dẫn & lý do gợi ý</summary><p>${escapeText(item.reason)}</p><ol>${item.instructions.map(step => `<li>${escapeText(step)}</li>`).join("")}</ol><small>${escapeText(item.tips)}</small></details>`;
}

function renderLibrary() {
  const host = $("#routine-library");
  host.replaceChildren();
  for (const item of routine?.library || []) {
    if (filter !== "all" && item.category !== filter) continue;
    const inToday = routine.tasks.some(task => task.id === item.id && !task.dismissed);
    const card = document.createElement("article");
    card.className = "panel routine-library-card";
    card.innerHTML = `<span class="panel-overline">${escapeText(item.categoryLabel)}${item.optional ? " · TÙY CHỌN" : ""}</span><h3>${escapeText(item.title)}</h3><p>${escapeText(item.desc)}</p><span class="routine-duration">${escapeText(item.duration)}</span>${guide(item)}<button class="button button-outline" type="button" data-routine-action="add" data-task-id="${escapeText(item.id)}" ${inToday ? "disabled" : ""}>${inToday ? "Đã có trong hôm nay" : "Thêm vào hôm nay"}</button>`;
    host.append(card);
  }
}

function render() {
  $("#routine-task-list").replaceChildren();
  $("#routine-skipped-list").replaceChildren();
  $("#routine-skipped").hidden = true;
  $("#routine-intensity").value = routine?.intensity || "moderate";
  $("#routine-feedback").value = routine?.feedback || "balanced";
  $("#routine-streak-count").textContent = routine?.streak.count || 0;
  $("#routine-week").replaceChildren();
  $("#routine-progress-label").textContent = `${routine?.completed || 0} / ${routine?.total || 0}`;
  $("#routine-progress-meter").max = routine?.total || 1;
  $("#routine-progress-meter").value = routine?.completed || 0;
  $("#routine-clear-report").hidden = !routine?.report;
  $("#routine-report-summary").textContent = routine?.report
    ? `Đã dùng số đo Face Lab ngày ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(routine.report_saved_at))}. Bạn có thể xem bối cảnh ở hướng dẫn từng mục hoặc xóa số đo bất cứ lúc nào.`
    : "Bạn có thể tạo routine cơ bản ngay, hoặc chọn dùng số đo vừa phân tích trong Face Lab.";
  $("#routine-freeze").textContent = `Bảo vệ hôm nay · còn ${routine?.streak.freezes_left ?? 2}/2 lượt`;
  $("#routine-freeze-note").textContent = routine?.streak.frozen_today ? "Hôm nay đã được bảo vệ. Lượt bảo vệ hồi theo tháng." : "Tối đa 2 ngày bảo vệ mỗi tháng; ngày hoàn thành chỉ được tính một lần.";
  $("#routine-generate").innerHTML = `<svg><use href="#i-spark"/></svg> ${routine?.tasks.length ? "Cập nhật routine hôm nay" : "Tạo routine hôm nay"}`;
  if (!routine) {
    renderLibrary();
    setBusy(false);
    return;
  }
  $("#routine-date").textContent = "HÔM NAY · " + routine.date.split("-").reverse().join("/");
  for (let offset = 6; offset >= 0; offset--) {
    const day = new Date(routine.date + "T12:00:00Z");
    day.setUTCDate(day.getUTCDate() - offset);
    const key = day.toISOString().slice(0, 10);
    const completed = routine.streak.completed_dates.includes(key), frozen = routine.streak.frozen_dates.includes(key);
    const mark = document.createElement("span");
    mark.className = completed ? "is-complete" : frozen ? "is-frozen" : "";
    mark.textContent = String(day.getUTCDate());
    mark.title = `${key}: ${completed ? "Hoàn thành" : frozen ? "Đã bảo vệ" : "Chưa hoàn thành"}`;
    $("#routine-week").append(mark);
  }
  if (!routine.tasks.length) accessMessage("Chọn mức độ rồi tạo routine hôm nay. Bạn cũng có thể thêm từng mục từ thư viện bên dưới.");
  else $("#routine-access").hidden = true;
  for (const task of routine.tasks) {
    const card = document.createElement("article");
    card.className = `routine-task${task.completed ? " is-complete" : ""}`;
    if (task.dismissed) {
      $("#routine-skipped").hidden = false;
      card.innerHTML = `<span>${escapeText(task.title)}</span><button class="text-link" type="button" data-routine-action="restore" data-task-id="${escapeText(task.id)}">Khôi phục</button>`;
      $("#routine-skipped-list").append(card);
      continue;
    }
    card.innerHTML = `<div class="routine-task-heading"><button class="routine-check" type="button" data-routine-action="complete" data-task-id="${escapeText(task.id)}" aria-pressed="${task.completed}" aria-label="${escapeText((task.completed ? "Bỏ hoàn thành: " : "Hoàn thành: ") + task.title)}">${task.completed ? "✓" : ""}</button><div><span class="panel-overline">${escapeText(task.categoryLabel)}${task.optional ? " · TÙY CHỌN" : ""}</span><h3>${escapeText(task.title)}</h3><span class="routine-duration">${escapeText(task.suggestedTime)} · ${escapeText(task.duration)}</span></div></div>${guide(task)}<div class="routine-task-actions"><button class="text-link" type="button" data-routine-action="shift" data-task-id="${escapeText(task.id)}">Dời 1 giờ</button><button class="text-link" type="button" data-routine-action="dismiss" data-task-id="${escapeText(task.id)}">Bỏ qua hôm nay</button></div>`;
    $("#routine-task-list").append(card);
  }
  renderLibrary();
  setBusy(busy);
}

async function loadRoutine() {
  const request = ++requestNumber;
  setBusy(true);
  try {
    const result = await api.get("/api/health-hub/routine");
    if (request !== requestNumber) return;
    routine = result;
    busy = false;
    render();
  } catch (error) {
    if (request !== requestNumber) return;
    routine = null;
    render();
    accessMessage(error.status === 401 ? "Đăng nhập để lưu và đồng bộ routine của bạn." : error.status === 403 ? "Bật lưu dữ liệu Health Hub trong My Aura để tạo routine." : error.message,
      error.status === 401 ? "login" : error.status === 403 ? "consent" : "retry");
  }
}

async function mutate(method, payload) {
  if (busy || !routine) return;
  const session = sessionNumber;
  const request = ++requestNumber;
  setBusy(true);
  try {
    const result = await api[method]("/api/health-hub/routine", { ...payload, revision: routine.revision });
    if (session !== sessionNumber || request !== requestNumber) return;
    routine = result;
    showToast("Đã cập nhật Health Hub.", "success");
    window.dispatchEvent(new CustomEvent("auramaxx:habits-changed"));
  } catch (error) {
    if (session !== sessionNumber) return;
    showToast(error.message, "error");
    // Refresh an expired session/consent or a newer revision rather than overwriting it.
    if ([401, 403, 409].includes(error.status)) { await loadRoutine(); return; }
  } finally {
    if (session === sessionNumber && request === requestNumber) {
      busy = false;
      render();
    }
  }
}

export function initRoutine() {
  $("#routine-generate").addEventListener("click", () => void mutate("post", {}));
  $("#routine-use-report").addEventListener("click", () => {
    const report = getFaceReport();
    if (report) void mutate("post", { report: { skin: report.skin || {} } });
  });
  $("#routine-intensity").addEventListener("change", event => void mutate("patch", { action: "preferences", intensity: event.target.value }));
  $("#routine-feedback").addEventListener("change", event => void mutate("patch", { action: "preferences", feedback: event.target.value }));
  $("#routine-freeze").addEventListener("click", () => void mutate("patch", { action: "freeze" }));
  $("#routine-clear-report").addEventListener("click", () => void mutate("patch", { action: "clear_report" }));
  page().addEventListener("click", event => {
    const button = event.target.closest("button[data-routine-action]");
    if (!button || button.disabled) return;
    const payload = { action: button.dataset.routineAction, task_id: button.dataset.taskId };
    if (payload.action === "complete") payload.completed = !routine.tasks.find(task => task.id === payload.task_id)?.completed;
    void mutate("patch", payload);
  });
  page().querySelectorAll("[data-routine-filter]").forEach(button => button.addEventListener("click", () => {
    filter = button.dataset.routineFilter;
    page().querySelectorAll("[data-routine-filter]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    renderLibrary();
    if (busy) setBusy(true);
  }));
  window.addEventListener("hashchange", () => { if (window.location.hash === "#health-hub") void loadRoutine(); });
  window.addEventListener("auramaxx:auth-changed", () => {
    sessionNumber++; requestNumber++; routine = null; busy = false;
    render();
    accessMessage("Đăng nhập để xem routine trong tài khoản của bạn.", "login");
    if (window.location.hash === "#health-hub") void loadRoutine();
  });
  window.addEventListener("auramaxx:consent-changed", event => {
    if (!["health_tracking", "face_analysis"].includes(event.detail?.purpose)) return;
    requestNumber++; routine = null; busy = false; render();
    if (window.location.hash === "#health-hub") void loadRoutine();
  });
  window.addEventListener("auramaxx:face-report-changed", () => setBusy(busy));
  window.addEventListener("auramaxx:habits-changed", () => { if (!busy && window.location.hash === "#health-hub") void loadRoutine(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && window.location.hash === "#health-hub" && !busy) void loadRoutine(); });
  // Recheck the server's date when a tab stays open across midnight.
  window.setInterval(() => { if (!document.hidden && window.location.hash === "#health-hub" && !busy) void loadRoutine(); }, 60000);
  if (window.location.hash === "#health-hub") void loadRoutine();
}
