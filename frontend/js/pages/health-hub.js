import { api } from "../api.js";
import { showToast } from "../ui.js";
import { initRoutine } from "../health/routine.js";

const CATEGORY_LABELS = {
  water: "Uống nước",
  sleep: "Nghỉ ngơi",
  movement: "Vận động",
  self_care: "Chăm sóc bản thân",
};
const CATEGORY_ICONS = { water: "i-water", sleep: "i-moon", movement: "i-heart", self_care: "i-leaf" };
let initialized = false;
let habitRequest = 0;

function ensureJournal() {
  const panel = document.querySelector(".habit-empty");
  if (panel.querySelector("#habit-entry-form")) return;
  const form = document.createElement("form");
  form.className = "health-entry-panel";
  form.id = "habit-entry-form";
  form.innerHTML = `
    <div class="habit-entry-form">
      <div class="habit-field"><label for="habit-category">Thói quen</label><select id="habit-category" required><option value="">Chọn một mục</option><option value="water">Uống nước</option><option value="sleep">Nghỉ ngơi</option><option value="movement">Vận động</option><option value="self_care">Chăm sóc bản thân</option></select></div>
      <div class="habit-field"><label for="habit-value">Giá trị bạn muốn ghi</label><input id="habit-value" maxlength="100" required placeholder="Ví dụ: 250" autocomplete="off"></div>
      <div class="habit-field"><label for="habit-unit">Đơn vị (tùy chọn)</label><input id="habit-unit" maxlength="24" placeholder="ml, giờ…" autocomplete="off"></div>
      <button class="button button-primary" type="submit"><svg><use href="#i-plus"/></svg> Ghi nhận</button>
      <div class="habit-field habit-note-field"><label for="habit-note">Ghi chú (tùy chọn)</label><input id="habit-note" maxlength="500" placeholder="Thêm ghi chú riêng cho bản ghi này" autocomplete="off"></div>
    </div>
  `;
  const records = document.createElement("div");
  records.id = "habit-records";
  records.className = "habit-records";
  records.setAttribute("aria-live", "polite");
  panel.append(form, records);
  form.addEventListener("submit", createHabit);
  records.addEventListener("click", deleteHabit);
}

function showEmpty(message, action = "login") {
  const empty = document.querySelector(".habit-empty .empty-state");
  empty.replaceChildren();
  const icon = document.createElement("span");
  icon.className = "empty-orbit";
  icon.innerHTML = '<svg><use href="#i-heart"/></svg>';
  const title = document.createElement("b");
  title.textContent = message.title;
  const description = document.createElement("p");
  description.textContent = message.description;
  empty.append(icon, title, description);
  if (message.error) {
    const error = document.createElement("span");
    error.className = "habit-error";
    error.textContent = message.error;
    empty.append(error);
  }
  const actionButton = document.createElement("button");
  actionButton.className = "text-link health-action";
  actionButton.type = "button";
  actionButton.textContent = action === "consent" ? "Quản lý đồng ý trong My Aura" : action === "retry" ? "Thử kết nối lại" : "Đăng nhập để tiếp tục";
  empty.append(actionButton);
  empty.querySelector(".health-action").addEventListener("click", () => {
    if (action === "login") window.dispatchEvent(new CustomEvent("auramaxx:auth-required", { detail: { mode: "login" } }));
    else if (action === "consent") window.location.hash = "my-aura";
    else loadHabits();
  });
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Thời gian không xác định";
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function renderRecords(records) {
  const empty = document.querySelector(".habit-empty .empty-state");
  const host = document.querySelector("#habit-records");
  host.replaceChildren();
  if (records.length === 0) {
    empty.hidden = false;
    empty.innerHTML = `<span class="empty-orbit"><svg><use href="#i-heart"/></svg></span><b>Nhật ký đang trống</b><p>Chỉ những bản ghi bạn tự nhập mới xuất hiện ở đây.</p>`;
    return;
  }
  empty.hidden = true;
  records.forEach((record) => {
    const item = document.createElement("article");
    item.className = "habit-record";
    item.innerHTML = `
      <span class="habit-record-icon"><svg><use href="#${CATEGORY_ICONS[record.category] || "i-leaf"}"/></svg></span>
      <div><b></b><span></span></div><strong class="habit-record-value"></strong>
      <button class="icon-button habit-delete" type="button" data-record-id="" aria-label="Xóa bản ghi"><svg><use href="#i-trash"/></svg></button>
    `;
    item.querySelector("b").textContent = CATEGORY_LABELS[record.category] || "Thói quen";
    item.querySelector("div span").textContent = `${formatDate(record.recorded_at)}${record.note ? ` · ${record.note}` : ""}`;
    item.querySelector(".habit-record-value").textContent = `${record.value}${record.unit ? ` ${record.unit}` : ""}`;
    item.querySelector(".habit-delete").dataset.recordId = record.id;
    host.append(item);
  });
}

async function loadHabits() {
  const request = ++habitRequest;
  ensureJournal();
  const form = document.querySelector("#habit-entry-form");
  const empty = document.querySelector(".habit-empty .empty-state");
  const host = document.querySelector("#habit-records");
  form.hidden = true;
  host.replaceChildren();
  empty.hidden = false;
  empty.innerHTML = `<div class="health-loading">Đang tải nhật ký của bạn…</div>`;

  try {
    const records = await api.get("/api/habits");
    if (request !== habitRequest) return;
    form.hidden = false;
    renderRecords(records);
  } catch (error) {
    if (request !== habitRequest) return;
    if (error.status === 401) {
      showEmpty({ title: "Đăng nhập để xem nhật ký", description: "Dữ liệu sức khỏe chỉ hiển thị trong tài khoản của bạn." }, "login");
    } else if (error.status === 403) {
      showEmpty({ title: "Bạn chưa bật lưu nhật ký", description: "Hãy xem và bật lựa chọn Health Hub trong My Aura nếu bạn muốn lưu dữ liệu." }, "consent");
    } else {
      showEmpty({ title: "Chưa tải được nhật ký", description: "Dữ liệu chưa thay đổi. Kiểm tra backend rồi thử lại.", error: error.message }, "retry");
    }
  }
}

async function createHabit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await api.post("/api/habits", {
      category: document.querySelector("#habit-category").value,
      value: document.querySelector("#habit-value").value,
      unit: document.querySelector("#habit-unit").value,
      note: document.querySelector("#habit-note").value,
    });
    form.reset();
    showToast("Đã lưu bản ghi vào tài khoản của bạn.", "success");
    await loadHabits();
    window.dispatchEvent(new CustomEvent("auramaxx:habits-changed"));
  } catch (error) {
    showToast(error.message, "error");
    if (error.status === 401) showEmpty({ title: "Phiên đăng nhập đã hết hạn", description: "Đăng nhập lại để tiếp tục." }, "login");
    else if (error.status === 403) showEmpty({ title: "Quyền lưu đã được thu hồi", description: "Hãy kiểm tra lựa chọn đồng ý trong My Aura." }, "consent");
  } finally {
    button.disabled = false;
  }
}

async function deleteHabit(event) {
  const button = event.target.closest("button[data-record-id]");
  if (!button) return;
  button.disabled = true;
  try {
    await api.delete(`/api/habits/${encodeURIComponent(button.dataset.recordId)}`);
    showToast("Đã xóa bản ghi.", "success");
    await loadHabits();
    window.dispatchEvent(new CustomEvent("auramaxx:habits-changed"));
  } catch (error) {
    button.disabled = false;
    showToast(error.message, "error");
  }
}

export function initHealthHub() {
  if (initialized) return;
  initialized = true;
  ensureJournal();
  initRoutine();
  window.addEventListener("auramaxx:auth-changed", () => void loadHabits());
  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#health-hub") loadHabits();
  });
  window.addEventListener("auramaxx:consent-changed", (event) => {
    if (event.detail?.purpose === "health_tracking" && window.location.hash === "#health-hub") loadHabits();
  });
  window.addEventListener("auramaxx:habits-changed", () => {
    if (window.location.hash === "#health-hub") void loadHabits();
    if (window.location.hash === "#progress") window.dispatchEvent(new CustomEvent("auramaxx:progress-refresh"));
  });
  if (window.location.hash === "#health-hub") loadHabits();
}
