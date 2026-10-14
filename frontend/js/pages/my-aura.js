import { api } from "../api.js";
import { showToast } from "../ui.js";
import { getAppearance, setTheme, setReducedMotion } from "../theme.js";

const PURPOSES = [
  {
    id: "face_analysis", title: "Phân tích khuôn mặt",
    description: "Cho phép VisionFace xử lý điểm mốc để nhận diện và xác thực. Ảnh chỉ được gửi khi bạn chọn phân tích; mẫu khuôn mặt chỉ lưu khi bạn chọn lưu hồ sơ. Mô hình được tải từ CDN/Google.",
    warning: "Kết quả khuôn mặt đã đính kèm vào routine và dữ liệu đấu BOT sẽ bị xóa. Hồ sơ khuôn mặt đã lưu vẫn còn; bạn có thể quản lý từng hồ sơ tại Face Lab.",
  },
  {
    id: "health_tracking", title: "Lưu dữ liệu sức khỏe",
    description: "Đồng bộ routine, chuỗi ngày và nhật ký giữa các thiết bị. Tạo và điều chỉnh routine ngay trong Health Hub.",
    warning: "Routine và chuỗi ngày của bạn sẽ bị xóa. Nhật ký đã ghi vẫn còn nhưng chỉ xem được khi bật lại quyền sức khỏe. Bạn có thể tải một bản sao ở mục Dữ liệu cá nhân trước khi tiếp tục.",
  },
  {
    id: "ai_chat", title: "Gửi nội dung cho Aura AI",
    description: "Gửi hội thoại đến nhà cung cấp AI đã cấu hình và lưu lịch sử trong tài khoản. Số đo VisionFace chỉ được đính kèm khi bạn chủ động chọn.",
    warning: "Toàn bộ lịch sử hội thoại Aura AI trong tài khoản sẽ bị xóa. Thu hồi quyền không hoàn tác nội dung đã gửi đến nhà cung cấp AI.",
  },
];

const $ = (selector) => document.querySelector(selector);
let currentUser = null;
let sessions = [];
let consents = [];
let generation = 0;
let busy = false;
let loading = false;
let pendingConfirmation = null;

function message(selector, text = "", error = true) {
  const node = $(selector);
  node.textContent = text;
  node.hidden = !text;
  node.classList.toggle("success", !error);
}

function date(value, time = false) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Không xác định" : new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium", ...(time ? { timeStyle: "short" } : {}),
  }).format(parsed);
}

function setBusy(value) {
  busy = value;
  const disabled = busy || loading || !currentUser;
  document.querySelectorAll("[data-account-control], input[data-consent]").forEach((node) => { node.disabled = disabled; });
  ["#logout-button", "#aura-export", "#open-delete-dialog"].forEach((selector) => { $(selector).disabled = disabled; });
  $("#aura-revoke-others").disabled = disabled || !sessions.some((session) => !session.current);
  document.querySelectorAll("[data-session-revoke]").forEach((button) => { button.disabled = disabled; });
  document.querySelectorAll("#delete-form input, #delete-form button").forEach((node) => { node.disabled = busy; });
  $("[data-page='my-aura']").setAttribute("aria-busy", String(busy || loading));
}

function updateConsents(records) {
  consents = records;
  const granted = new Map(records.map((record) => [record.purpose, Boolean(record.granted)]));
  PURPOSES.forEach((purpose) => {
    const value = granted.get(purpose.id) || false;
    const input = $(`input[data-consent="${purpose.id}"]`);
    input.checked = value;
    const state = $(`[data-consent-state="${purpose.id}"]`);
    state.textContent = value ? "ĐÃ ĐỒNG Ý" : "CHƯA BẬT";
    state.classList.toggle("is-granted", value);
  });
}

function renderSessions(records) {
  sessions = records;
  const list = $("#aura-session-list");
  list.replaceChildren();
  if (!records.length) {
    const empty = document.createElement("p");
    empty.className = "aura-empty";
    empty.textContent = currentUser ? "Không có phiên đang hoạt động." : "Đăng nhập để xem các phiên của bạn.";
    list.append(empty);
  }
  records.forEach((session) => {
    const row = document.createElement("div");
    row.className = "aura-session";
    const copy = document.createElement("div");
    const title = document.createElement("b");
    title.textContent = session.current ? "Phiên hiện tại" : "Phiên đăng nhập khác";
    copy.append(title);
    if (session.current) {
      const badge = document.createElement("span");
      badge.className = "aura-session-current";
      badge.textContent = "ĐANG SỬ DỤNG";
      copy.append(badge);
    }
    const created = document.createElement("p");
    created.textContent = `Đăng nhập: ${date(session.created_at, true)}`;
    const expiry = document.createElement("p");
    expiry.textContent = `Hết hạn: ${date(session.expires_at, true)}`;
    copy.append(created, expiry);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-outline";
    button.dataset.sessionRevoke = session.id;
    button.textContent = session.current ? "Đăng xuất" : "Kết thúc phiên";
    button.addEventListener("click", () => revokeSession(session));
    row.append(copy, button);
    list.append(row);
  });
  setBusy(busy);
}

function renderAccount(profile) {
  currentUser = profile;
  const name = profile.display_name || profile.email || profile.username;
  $(".profile-card h2").textContent = name;
  $(".profile-card > p").textContent = profile.email || `Tên đăng nhập: ${profile.username}`;
  $("#aura-display-name").value = profile.display_name;
  $("#aura-login-id").value = profile.email || profile.username;
  $("#aura-login-label").textContent = profile.email ? "Email đăng nhập" : "Tên đăng nhập";
  const letter = Array.from(name)[0]?.toLocaleUpperCase("vi-VN") || "A";
  document.querySelectorAll(".avatar-small, .avatar-top, #aura-profile-avatar").forEach((node) => { node.textContent = letter; });
  $("#aura-role").hidden = false;
  $("#aura-role").textContent = profile.role === "admin" ? "Quản trị viên" : "Thành viên Aura";
  $("#aura-member-since").hidden = false;
  $("#aura-member-since").textContent = `Tham gia từ ${date(profile.created_at)}`;
  $("[data-page='my-aura'] .coming-badge").textContent = "ĐÃ ĐĂNG NHẬP";
  $(".profile-status").dataset.state = "online";
  $(".profile-status span:first-child").innerHTML = "<i></i> Đã đăng nhập";
  $(".profile-status span:last-child").textContent = "Dữ liệu được quản lý theo tài khoản";
  document.querySelectorAll(".profile-card [data-auth-open]").forEach((node) => { node.hidden = true; });
  $("#logout-button").hidden = false;
  $(".unified-account-links").hidden = profile.role !== "admin";
  $("[data-unified-admin]").hidden = profile.role !== "admin";
  $("[data-admin-signin]").hidden = true;
  $("#open-delete-dialog").hidden = profile.role === "admin";
  $("#aura-admin-delete-note").hidden = profile.role !== "admin";
  $("#aura-account-notice").hidden = true;
  setBusy(busy);
}

function clearPrivateView(text = "Đăng nhập để chỉnh sửa hồ sơ, bảo mật và dữ liệu. Bạn vẫn có thể tùy chỉnh giao diện bên dưới.") {
  currentUser = null;
  busy = false;
  loading = false;
  if ($("#aura-confirm-dialog").open) $("#aura-confirm-dialog").close("cancel");
  if ($("#delete-dialog").open) $("#delete-dialog").close();
  ["#aura-profile-form", "#aura-password-form", "#delete-form"].forEach((selector) => { $(selector).reset(); });
  ["#aura-current-password", "#aura-new-password", "#aura-confirm-password"].forEach((selector) => { $(selector).type = "password"; });
  ["#aura-profile-status", "#aura-password-status", "#aura-data-status", "#delete-status"].forEach((selector) => message(selector));
  $("#consent-saving").hidden = true;
  $(".profile-card h2").textContent = "Chưa đăng nhập";
  $(".profile-card > p").textContent = "Đăng nhập để đồng bộ hồ sơ và các lựa chọn riêng tư.";
  $("#aura-role").hidden = true;
  $("#aura-member-since").hidden = true;
  $("#aura-role").textContent = "";
  $("#aura-member-since").textContent = "";
  $("#aura-login-id").value = "";
  $("#aura-login-label").textContent = "Email đăng nhập";
  $(".profile-status").dataset.state = "offline";
  $(".profile-status span:first-child").innerHTML = "<i></i> Phiên khách";
  $(".profile-status span:last-child").textContent = "Các lựa chọn riêng tư cần đăng nhập";
  $("[data-page='my-aura'] .coming-badge").textContent = "PHIÊN KHÁCH";
  document.querySelectorAll(".avatar-small, .avatar-top, #aura-profile-avatar").forEach((node) => { node.textContent = "A"; });
  document.querySelectorAll(".profile-card [data-auth-open]").forEach((node) => { node.hidden = false; });
  $("#logout-button").hidden = true;
  $(".unified-account-links").hidden = true;
  $("[data-unified-admin]").hidden = true;
  $("[data-admin-signin]").hidden = false;
  $("#open-delete-dialog").hidden = true;
  $("#aura-admin-delete-note").hidden = true;
  const notice = $("#aura-account-notice");
  notice.textContent = text;
  notice.dataset.state = "";
  notice.hidden = false;
  updateConsents([]);
  renderSessions([]);
}

function signedOut(text = "Bạn đã đăng xuất.") {
  generation += 1;
  clearPrivateView();
  window.dispatchEvent(new CustomEvent("auramaxx:auth-changed"));
  showToast(text, "success");
}

function handleError(error, selector) {
  if (error.status === 401) {
    generation += 1;
    clearPrivateView("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để tiếp tục.");
    window.dispatchEvent(new CustomEvent("auramaxx:auth-changed"));
  } else if (selector) message(selector, error.message);
  else showToast(error.message, "error");
}

async function loadAccount() {
  if (busy) return;
  const stamp = ++generation;
  loading = true;
  setBusy(false);
  try {
    const user = await api.get("/api/auth/me");
    if (stamp !== generation) return;
    if (user.must_change_password) {
      window.location.assign(user.role === "admin" ? "/account.html?next=%2Fmanage" : "/account.html");
      return;
    }
    const data = await api.get("/api/account/settings");
    if (stamp !== generation) return;
    renderAccount(data.profile);
    updateConsents(data.consents);
    renderSessions(data.sessions);
  } catch (error) {
    if (stamp !== generation) return;
    clearPrivateView(error.status === 401 ? undefined : "Không tải được cài đặt. Vui lòng thử lại.");
    if (error.status !== 401) {
      const notice = $("#aura-account-notice");
      notice.dataset.state = "error";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Thử lại";
      retry.addEventListener("click", loadAccount);
      notice.append(retry);
    }
  } finally {
    if (stamp === generation) { loading = false; setBusy(false); }
  }
}

function askConfirmation(title, description, action = "Xác nhận") {
  if (pendingConfirmation) return Promise.resolve(false);
  const dialog = $("#aura-confirm-dialog");
  $("#aura-confirm-title").textContent = title;
  $("#aura-confirm-description").textContent = description;
  $("#aura-confirm-action").textContent = action;
  dialog.returnValue = "cancel";
  return new Promise((resolve) => {
    pendingConfirmation = resolve;
    dialog.addEventListener("close", () => {
      pendingConfirmation = null;
      resolve(dialog.returnValue === "confirm");
    }, { once: true });
    dialog.showModal();
  });
}

async function saveConsent(input) {
  if (!currentUser || busy || loading) return;
  const stamp = generation;
  const purpose = PURPOSES.find((item) => item.id === input.dataset.consent);
  const granted = input.checked;
  // Keep the saved state visible while a destructive change awaits confirmation.
  input.checked = !granted;
  if (!granted && !await askConfirmation(`Thu hồi quyền ${purpose.title.toLocaleLowerCase("vi-VN")}?`, purpose.warning, "Thu hồi quyền")) return;
  if (stamp !== generation || !currentUser || busy) return;
  setBusy(true);
  $("#consent-saving").textContent = "Đang lưu lựa chọn…";
  $("#consent-saving").hidden = false;
  try {
    const saved = await api.post("/api/consents", { purpose: purpose.id, granted, policy_version: "v1" });
    if (stamp !== generation) return;
    updateConsents([...consents.filter((record) => record.purpose !== purpose.id), saved]);
    window.dispatchEvent(new CustomEvent("auramaxx:consent-changed", { detail: { purpose: purpose.id, granted } }));
    showToast(granted ? "Đã lưu lựa chọn đồng ý." : "Đã thu hồi quyền và xử lý dữ liệu liên quan.", "success");
  } catch (error) {
    if (stamp === generation) handleError(error);
  } finally {
    if (stamp === generation) { $("#consent-saving").hidden = true; setBusy(false); }
  }
}

async function saveProfile(event) {
  event.preventDefault();
  if (!currentUser || busy || loading) return;
  const stamp = generation;
  message("#aura-profile-status");
  setBusy(true);
  try {
    const data = await api.patch("/api/account/profile", { display_name: $("#aura-display-name").value.trim() });
    if (stamp !== generation) return;
    renderAccount({ ...currentUser, display_name: data.display_name });
    message("#aura-profile-status", "Đã lưu hồ sơ.", false);
  } catch (error) { if (stamp === generation) handleError(error, "#aura-profile-status"); }
  finally { if (stamp === generation) setBusy(false); }
}

async function changePassword(event) {
  event.preventDefault();
  if (!currentUser || busy || loading) return;
  const oldPassword = $("#aura-current-password").value;
  const newPassword = $("#aura-new-password").value;
  if (newPassword !== $("#aura-confirm-password").value) { message("#aura-password-status", "Hai mật khẩu mới chưa khớp."); return; }
  if (oldPassword === newPassword) { message("#aura-password-status", "Mật khẩu mới phải khác mật khẩu hiện tại."); return; }
  const stamp = generation;
  message("#aura-password-status");
  setBusy(true);
  try {
    await api.post("/api/vision/auth/password", { current_password: oldPassword, new_password: newPassword });
    if (stamp === generation) signedOut("Đã đổi mật khẩu và đăng xuất các phiên. Hãy đăng nhập bằng mật khẩu mới.");
  } catch (error) { if (stamp === generation) handleError(error, "#aura-password-status"); }
  finally { if (stamp === generation) setBusy(false); }
}

async function logout() {
  if (!currentUser || busy || loading) return;
  const stamp = generation;
  setBusy(true);
  try {
    await api.post("/api/auth/logout");
    if (stamp === generation) signedOut();
  } catch (error) { if (stamp === generation) handleError(error); }
  finally { if (stamp === generation) setBusy(false); }
}

async function revokeSession(session) {
  if (session.current) { await logout(); return; }
  if (!currentUser || busy || loading) return;
  const stamp = generation;
  if (!await askConfirmation("Kết thúc phiên đăng nhập?", "Phiên được chọn sẽ phải đăng nhập lại. Phiên hiện tại của bạn vẫn được giữ.", "Kết thúc phiên")) return;
  if (stamp !== generation || !currentUser || busy) return;
  setBusy(true);
  try {
    const data = await api.delete(`/api/account/sessions/${encodeURIComponent(session.id)}`);
    if (stamp !== generation) return;
    renderSessions(data.sessions);
    showToast("Đã kết thúc phiên đăng nhập.", "success");
  } catch (error) {
    if (stamp === generation) {
      handleError(error);
      if (error.status === 404) { setBusy(false); await loadAccount(); }
    }
  } finally { if (stamp === generation) setBusy(false); }
}

async function revokeOthers() {
  if (!currentUser || busy || loading) return;
  const stamp = generation;
  if (!await askConfirmation("Đăng xuất các phiên khác?", "Tất cả phiên đăng nhập khác của tài khoản sẽ bị kết thúc. Bạn tiếp tục sử dụng phiên hiện tại.", "Đăng xuất phiên khác")) return;
  if (stamp !== generation || !currentUser || busy) return;
  setBusy(true);
  try {
    const data = await api.post("/api/account/sessions/revoke-others");
    if (stamp !== generation) return;
    renderSessions(data.sessions);
    showToast("Đã đăng xuất các phiên khác.", "success");
  } catch (error) { if (stamp === generation) handleError(error); }
  finally { if (stamp === generation) setBusy(false); }
}

async function exportData() {
  if (!currentUser || busy || loading) return;
  const stamp = generation;
  setBusy(true);
  message("#aura-data-status", "Đang chuẩn bị bản sao dữ liệu…", false);
  try {
    const data = await api.get("/api/account/export");
    if (stamp !== generation) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `my-aura-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    message("#aura-data-status", "Đã tạo bản sao. Hãy giữ tệp tải xuống ở nơi riêng tư.", false);
  } catch (error) { if (stamp === generation) handleError(error, "#aura-data-status"); }
  finally { if (stamp === generation) setBusy(false); }
}

async function deleteAccount(event) {
  event.preventDefault();
  if (!currentUser || busy || loading || currentUser.role === "admin") return;
  if ($("#delete-confirm").value !== "DELETE") { message("#delete-status", "Hãy nhập chính xác từ DELETE để xác nhận."); return; }
  if (!$("#delete-password").value) { message("#delete-status", "Hãy nhập mật khẩu để xác nhận."); return; }
  const payload = { password: $("#delete-password").value, confirmation: "DELETE" };
  const stamp = generation;
  setBusy(true);
  message("#delete-status");
  try {
    await api.delete("/api/auth/me", payload);
    if (stamp !== generation) return;
    signedOut("Đã xóa tài khoản và dữ liệu liên quan.");
    window.location.hash = "home";
  } catch (error) {
    if (stamp === generation) {
      // A wrong confirmation password also returns 401; keep the form available.
      message("#delete-status", error.message);
    }
  } finally { if (stamp === generation) setBusy(false); }
}

function syncAppearance() {
  const appearance = getAppearance();
  document.querySelectorAll('input[name="aura-theme"]').forEach((input) => { input.checked = input.value === appearance.theme; });
  $("#aura-reduce-motion").checked = appearance.reduceMotion;
}

function openAuth(mode = "login") {
  const next = "/" + (window.location.hash || "#my-aura");
  window.location.assign(`/login.html?mode=${mode === "register" ? "register" : "login"}&next=${encodeURIComponent(next)}`);
}

export function initMyAura() {
  $("#aura-consent-list").innerHTML = PURPOSES.map((purpose) => `
    <div class="consent-control-row"><div class="consent-control-copy"><b id="consent-${purpose.id}-label">${purpose.title}</b><span id="consent-${purpose.id}-description">${purpose.description}</span><span class="setting-state" data-consent-state="${purpose.id}">CHƯA BẬT</span></div><label class="switch-control"><input type="checkbox" data-consent="${purpose.id}" disabled aria-labelledby="consent-${purpose.id}-label" aria-describedby="consent-${purpose.id}-description"><span class="switch-track"></span></label></div>`).join("");
  document.querySelectorAll("input[data-consent]").forEach((input) => input.addEventListener("change", () => saveConsent(input)));
  document.querySelectorAll(".profile-card [data-auth-open]").forEach((button) => button.addEventListener("click", () => openAuth(button.dataset.authOpen)));
  $("#logout-button").addEventListener("click", logout);
  $("#aura-profile-form").addEventListener("submit", saveProfile);
  $("#aura-password-form").addEventListener("submit", changePassword);
  $("#aura-show-password").addEventListener("change", (event) => {
    ["#aura-current-password", "#aura-new-password", "#aura-confirm-password"].forEach((selector) => { $(selector).type = event.target.checked ? "text" : "password"; });
  });
  $("#aura-export").addEventListener("click", exportData);
  $("#aura-revoke-others").addEventListener("click", revokeOthers);
  $("#open-delete-dialog").addEventListener("click", () => {
    $("#delete-form").reset();
    message("#delete-status");
    $("#delete-dialog").showModal();
  });
  $("#close-delete").addEventListener("click", () => $("#delete-dialog").close());
  $("#delete-form").addEventListener("submit", deleteAccount);
  $("#delete-dialog").addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
  $("#delete-dialog").addEventListener("close", () => { $("#delete-form").reset(); message("#delete-status"); });
  document.querySelectorAll("[data-settings-anchor]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault();
    $(`#${link.dataset.settingsAnchor}`).scrollIntoView({ behavior: document.documentElement.dataset.reducedMotion === "true" ? "auto" : "smooth", block: "start" });
  }));
  document.querySelectorAll('input[name="aura-theme"]').forEach((input) => input.addEventListener("change", () => setTheme(input.value)));
  $("#aura-reduce-motion").addEventListener("change", (event) => setReducedMotion(event.target.checked));
  window.addEventListener("auramaxx:appearance-changed", syncAppearance);
  window.addEventListener("auramaxx:auth-required", (event) => openAuth(event.detail?.mode || "login"));
  window.addEventListener("auramaxx:auth-changed", () => { generation += 1; clearPrivateView(); loadAccount(); });
  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#my-aura") loadAccount();
    else {
      $("#aura-password-form").reset();
      ["#aura-current-password", "#aura-new-password", "#aura-confirm-password"].forEach((selector) => { $(selector).type = "password"; });
      if ($("#aura-confirm-dialog").open) $("#aura-confirm-dialog").close("cancel");
    }
  });
  clearPrivateView();
  syncAppearance();
  loadAccount();
}
