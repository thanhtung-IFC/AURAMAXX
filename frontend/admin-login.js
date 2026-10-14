import { api } from "./js/api.js";
import { initTheme } from "./js/theme.js";

initTheme();
const $ = selector => document.querySelector(selector);
const message = $("#admin-login-message");
let busy = false, attempted = false;

function enterManagement(user) {
  location.replace(user.must_change_password ? "/account.html?next=%2Fmanage" : "/manage");
}

$("#admin-toggle-password").addEventListener("click", () => {
  const input = $("#admin-password"), visible = input.type === "password";
  input.type = visible ? "text" : "password";
  $("#admin-toggle-password").setAttribute("aria-pressed", String(visible));
  $("#admin-toggle-password").setAttribute("aria-label", visible ? "Ẩn mật khẩu" : "Hiện mật khẩu");
});

$("#admin-login-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  attempted = true; busy = true;
  $("#admin-submit").disabled = true;
  $("#admin-submit").textContent = "Đang kiểm tra tài khoản…";
  message.textContent = ""; message.classList.remove("success");
  try {
    const user = await api.post("/api/auth/admin/login", {
      email: $("#admin-identity").value.trim(), password: $("#admin-password").value,
    });
    $("#admin-password").value = "";
    if (user.role !== "admin") throw new Error("Tài khoản này không có quyền quản trị.");
    enterManagement(user);
  } catch (error) {
    message.textContent = error.message;
    $("#admin-password").value = "";
    $("#admin-password").focus();
  } finally {
    busy = false; $("#admin-submit").disabled = false;
    $("#admin-submit").textContent = "Vào trang quản trị";
  }
});

if (new URLSearchParams(location.search).get("password_changed") === "1") {
  message.textContent = "Đã đổi mật khẩu. Đăng nhập lại bằng mật khẩu mới để quản lý.";
  message.classList.add("success");
}

// An existing administrator session can enter directly; never replace a typed login.
api.get("/api/auth/me").then(user => {
  if (attempted) return;
  if (user.role === "admin") enterManagement(user);
  else message.textContent = "Bạn đang dùng tài khoản người dùng. Nhập tài khoản admin để vào quản trị.";
}).catch(error => {
  if (attempted || error.status === 401 || error.status === 403) return;
  message.textContent = "Chưa kết nối được máy chủ. Bạn có thể thử đăng nhập lại.";
});
