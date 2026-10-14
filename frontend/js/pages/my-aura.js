import { api } from "../api.js";
import { showToast } from "../ui.js";

const PURPOSES = [
  {
    id: "face_analysis",
    title: "Phân tích khuôn mặt",
    description: "VisionFace gửi điểm mốc để nhận diện và xác thực; ảnh chỉ được gửi khi bạn chọn phân tích. Hồ sơ chỉ được lưu khi bạn chọn lưu mẫu khuôn mặt. Mô hình tải từ CDN/Google.",
  },
  {
    id: "health_tracking",
    title: "Lưu dữ liệu sức khỏe",
    description: "Lưu routine, chuỗi ngày và nhật ký Health Hub vào tài khoản để đồng bộ giữa các thiết bị. Thu hồi đồng ý sẽ xóa routine và chuỗi ngày; nhật ký đã ghi được khóa cho đến khi bạn đồng ý lại.",
  },
  {
    id: "ai_chat",
    title: "Gửi nội dung cho Aura AI",
    description: "Aura AI gửi hội thoại tới nhà cung cấp AI đã cấu hình và lưu lịch sử trong tài khoản. Bạn có thể đính kèm số đo VisionFace để giải thích kết quả hoặc xây dựng routine. Thu hồi đồng ý sẽ xóa lịch sử Aura AI của bạn.",
  },
];

let currentUser = null;


function setFormMessage(id, message = "", isError = true) {
  const node = document.querySelector(id);
  node.textContent = message;
  node.hidden = !message;
  node.classList.toggle("success", !isError);
}

function ensureAccountActions() {
  const card = document.querySelector(".profile-card");
  const oldButton = card.querySelector(":scope > .button-disabled");
  oldButton.classList.add("legacy-auth-button");
  oldButton.hidden = true;

  let actions = card.querySelector(".profile-auth-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "profile-auth-actions";
    actions.innerHTML = `
      <button class="button button-outline" type="button" data-auth-open="login">Đăng nhập</button>
      <button class="button button-primary" type="button" data-auth-open="register">Tạo tài khoản</button>
      <button class="button button-outline" type="button" id="logout-button" hidden>Đăng xuất</button>
    `;
    oldButton.after(actions);
  }
  actions.querySelectorAll("[data-auth-open]").forEach((button) => {
    button.addEventListener("click", () => openAuth(button.dataset.authOpen));
  });
  actions.querySelector("#logout-button").addEventListener("click", logout);
  if (!card.querySelector(".unified-account-links")) {
    const links = document.createElement("div");
    links.className = "unified-account-links";
    links.hidden = true;
    links.innerHTML = '<a class="button button-outline" href="/account.html">Đổi mật khẩu</a><a class="button button-outline" href="/manage" data-unified-admin hidden>Quản lý dữ liệu</a>';
    actions.after(links);
  }
  if (!card.querySelector('[data-admin-signin]')) {
    const link = document.createElement("a");
    link.href = "/admin-login.html"; link.textContent = "Đăng nhập quản trị";
    link.className = "text-link"; link.dataset.adminSignin = "";
    actions.after(link);
  }

  const deleteButton = document.querySelector(".data-control-panel > .button-disabled");
  deleteButton.hidden = true;
  if (!document.querySelector("#open-delete-dialog")) {
    const button = document.createElement("button");
    button.className = "button button-danger";
    button.id = "open-delete-dialog";
    button.type = "button";
    button.textContent = "Xóa tài khoản của tôi";
    button.hidden = true;
    button.addEventListener("click", () => document.querySelector("#delete-dialog").showModal());
    deleteButton.after(button);
  }
}

function ensureConsentControls() {
  const panel = document.querySelector(".settings-panel");
  if (panel.querySelector(".consent-controls")) return;

  const controls = document.createElement("section");
  controls.className = "panel consent-controls";
  controls.setAttribute("aria-labelledby", "consent-controls-title");
  controls.innerHTML = `
    <div class="panel-overline" id="consent-controls-title">LỰA CHỌN ĐỒNG Ý</div>
    <p>Các lựa chọn được lưu theo tài khoản. Bạn có thể thay đổi hoặc thu hồi bất kỳ lúc nào.</p>
    ${PURPOSES.map((purpose) => `
      <div class="consent-control-row">
        <div class="consent-control-copy"><b>${purpose.title}</b><span>${purpose.description}</span></div>
        <label class="switch-control"><input type="checkbox" data-consent="${purpose.id}" disabled aria-label="${purpose.title}"><span class="switch-track"></span></label>
      </div>
    `).join("")}
    <p class="consent-saving" id="consent-saving" hidden></p>
  `;
  panel.after(controls);
  controls.querySelectorAll("input[data-consent]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => saveConsent(checkbox));
  });
}

function openAuth(mode = "login") {
  const next = "/" + (window.location.hash || "#home");
  window.location.assign(`/login.html?mode=${mode === "register" ? "register" : "login"}&next=${encodeURIComponent(next)}`);
}

function renderAccount(user) {
  currentUser = user;
  document.querySelector('[data-page="my-aura"] .coming-badge').textContent = "ĐÃ ĐĂNG NHẬP";
  const card = document.querySelector(".profile-card");
  const title = card.querySelector("h2");
  const description = card.querySelector(":scope > p");
  const status = card.querySelector(".profile-status");
  const letter = (user.display_name || user.email).slice(0, 1).toUpperCase();

  title.textContent = user.display_name || user.email;
  title.style.overflowWrap = "anywhere";
  description.textContent = "Tài khoản AURAMAXX của bạn. Các lựa chọn đồng ý được lưu riêng theo từng mục đích.";
  status.dataset.state = "online";
  status.querySelector("span:first-child").innerHTML = "<i></i> Đã đăng nhập";
  status.querySelector("span:last-child").textContent = "Dữ liệu được tách theo tài khoản";
  document.querySelectorAll(".avatar-small, .avatar-top").forEach((avatar) => { avatar.textContent = letter; });
  card.querySelector("[data-auth-open='login']").hidden = true;
  card.querySelector("[data-auth-open='register']").hidden = true;
  card.querySelector("#logout-button").hidden = false;
  document.querySelector("#open-delete-dialog").hidden = false;
  document.querySelector(".unified-account-links").hidden = false;
  document.querySelector("[data-unified-admin]").hidden = user.role !== "admin";
  document.querySelector("#open-delete-dialog").hidden = user.role === "admin";
  if (user.must_change_password) window.location.assign("/account.html");
  document.querySelectorAll("input[data-consent]").forEach((input) => { input.disabled = false; });
  loadConsents();
}

function renderAnonymous(message = "Dữ liệu chưa gắn với tài khoản") {
  currentUser = null;
  document.querySelector('[data-page="my-aura"] .coming-badge').textContent = "PHIÊN KHÁCH";
  const card = document.querySelector(".profile-card");
  card.querySelector("h2").textContent = "Chưa đăng nhập";
  card.querySelector(":scope > p").textContent = "Đăng nhập hoặc tạo tài khoản để quản lý dữ liệu và các lựa chọn riêng tư.";
  const status = card.querySelector(".profile-status");
  status.dataset.state = "offline";
  status.querySelector("span:first-child").innerHTML = "<i></i> Phiên khách";
  status.querySelector("span:last-child").textContent = message;
  document.querySelectorAll(".avatar-small, .avatar-top").forEach((avatar) => { avatar.textContent = "A"; });
  card.querySelector("[data-auth-open='login']").hidden = false;
  card.querySelector("[data-auth-open='register']").hidden = false;
  card.querySelector("#logout-button").hidden = true;
  document.querySelector("#open-delete-dialog").hidden = true;
  document.querySelector(".unified-account-links").hidden = true;
  document.querySelectorAll("input[data-consent]").forEach((input) => {
    input.checked = false;
    input.disabled = true;
  });
  updateConsentLabels([]);
}

function updateConsentLabels(consents) {
  const granted = new Map(consents.map((consent) => [consent.purpose, consent.granted]));
  const settings = [...document.querySelectorAll(".settings-panel .setting-row")];
  PURPOSES.forEach((purpose, index) => {
    const status = settings[index]?.querySelector(".setting-state");
    if (status) {
      status.textContent = granted.get(purpose.id) ? "ĐÃ ĐỒNG Ý" : "CHƯA BẬT";
      status.classList.toggle("is-granted", Boolean(granted.get(purpose.id)));
    }
    const input = document.querySelector(`input[data-consent="${purpose.id}"]`);
    if (input) input.checked = Boolean(granted.get(purpose.id));
  });
}

async function loadConsents() {
  if (!currentUser) return;
  try {
    const consents = await api.get("/api/consents");
    updateConsentLabels(consents);
  } catch (error) {
    if (error.status === 401) renderAnonymous("Phiên đăng nhập đã hết hạn");
    else showToast(error.message, "error");
  }
}

async function saveConsent(input) {
  if (!currentUser) return;
  const saving = document.querySelector("#consent-saving");
  const previous = !input.checked;
  input.disabled = true;
  saving.textContent = "Đang lưu lựa chọn…";
  saving.hidden = false;
  try {
    await api.post("/api/consents", {
      purpose: input.dataset.consent,
      granted: input.checked,
      policy_version: "v1",
    });
    updateConsentLabels(await api.get("/api/consents"));
    showToast(input.checked ? "Đã lưu lựa chọn đồng ý." : "Đã thu hồi lựa chọn đồng ý.", "success");
    window.dispatchEvent(new CustomEvent("auramaxx:consent-changed", { detail: { purpose: input.dataset.consent, granted: input.checked } }));
  } catch (error) {
    input.checked = previous;
    showToast(error.message, "error");
    if (error.status === 401) renderAnonymous("Phiên đăng nhập đã hết hạn");
  } finally {
    input.disabled = !currentUser;
    saving.hidden = true;
  }
}

async function loadAccount() {
  ensureAccountActions();
  ensureConsentControls();
  try {
    const user = await api.get("/api/auth/me");
    renderAccount(user);
  } catch (error) {
    if (error.status === 401) renderAnonymous();
    else {
      renderAnonymous("Backend chưa kết nối; dữ liệu không được lưu ở trình duyệt.");
      document.querySelector(".profile-status").dataset.state = "error";
    }
  }
}

async function logout() {
  try {
    await api.post("/api/auth/logout");
    renderAnonymous();
    window.dispatchEvent(new CustomEvent("auramaxx:auth-changed"));
    showToast("Bạn đã đăng xuất.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteAccount(event) {
  event.preventDefault();
  const password = document.querySelector("#delete-password").value;
  const confirmation = document.querySelector("#delete-confirm").value;
  if (confirmation !== "DELETE") {
    setFormMessage("#delete-status", "Hãy nhập chính xác từ DELETE để xác nhận.");
    return;
  }
  try {
    await api.delete("/api/auth/me", { password, confirmation });
    document.querySelector("#delete-dialog").close();
    document.querySelector("#delete-form").reset();
    renderAnonymous("Tài khoản và dữ liệu liên quan đã được xóa");
    window.dispatchEvent(new CustomEvent("auramaxx:auth-changed"));
    updateConsentLabels([]);
    showToast("Tài khoản và dữ liệu liên quan đã được xóa.", "success");
    window.location.hash = "home";
  } catch (error) {
    setFormMessage("#delete-status", error.message);
  }
}

export function initMyAura() {
  ensureAccountActions();
  ensureConsentControls();
  renderAnonymous();
  document.querySelector("#delete-form").addEventListener("submit", deleteAccount);
  document.querySelector("#close-delete").addEventListener("click", () => document.querySelector("#delete-dialog").close());
  window.addEventListener("auramaxx:auth-required", (event) => openAuth(event.detail?.mode || "login"));
  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#my-aura") loadAccount();
  });
  loadAccount();
}
