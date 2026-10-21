import { api } from "./js/api.js";
import { initTheme } from "./js/theme.js";

initTheme();
const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
let mode = "login", busy = false;

function validatePasswordConfirmation() {
  const confirmation = $("#confirmPassword");
  const hint = $("#confirmPasswordHint");
  const mismatch = mode === "register" && confirmation.value.length > 0 && confirmation.value !== $("#password").value;
  const message = "Mật khẩu xác nhận chưa khớp.";
  confirmation.setCustomValidity(mismatch ? message : "");
  confirmation.setAttribute("aria-invalid", String(mismatch));
  hint.textContent = mismatch ? message : "";
  hint.dataset.state = mismatch ? "error" : "";
  hint.hidden = !mismatch;
}

export function safeNext(value) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/app#home";
  const url = new URL(value, location.origin);
  if (url.origin !== location.origin || /\/(?:login|admin-login)\.html$/i.test(url.pathname)) return "/app#home";
  return url.pathname + url.search + url.hash;
}

function selectMode(value) {
  if (busy) return;
  mode = value === "register" ? "register" : "login";
  const register = mode === "register";
  $("#displayNameLabel").hidden = !register;
  $("#displayName").required = register;
  $("#confirmPasswordLabel").hidden = !register;
  $("#confirmPassword").required = register;
  $("#confirmPassword").minLength = register ? 12 : 0;
  $("#confirmPassword").autocomplete = "new-password";
  $("#confirmPassword").value = "";
  $("#username").type = register ? "email" : "text";
  $("#username").placeholder = register ? "ban@example.com" : "Email hoặc tên đăng nhập VisionFace";
  $("#identityLabel").textContent = register ? "Email" : "Email hoặc tên đăng nhập";
  $("#password").minLength = register ? 12 : 1;
  $("#password").autocomplete = register ? "new-password" : "current-password";
  $("#passwordHint").hidden = !register;
  $("#formTitle").textContent = register ? "Bắt đầu hành trình của bạn" : "Chào mừng bạn trở lại";
  $("#formDescription").textContent = register ? "Một tài khoản cho toàn bộ không gian AURAMAXX." : "Dùng tài khoản hiện có để tiếp tục hành trình.";
  $("#submitLogin").textContent = register ? "Tạo tài khoản" : "Đăng nhập";
  for (const [id, selected] of [["tabLogin", !register], ["tabRegister", register]]) {
    $("#" + id).setAttribute("aria-selected", String(selected));
    $("#" + id).setAttribute("aria-pressed", String(selected));
  }
  $("#loginMessage").textContent = "";
  validatePasswordConfirmation();
}

$("#tabLogin").addEventListener("click", () => selectMode("login"));
$("#tabRegister").addEventListener("click", () => selectMode("register"));
$("#password").addEventListener("input", validatePasswordConfirmation);
$("#confirmPassword").addEventListener("input", validatePasswordConfirmation);
$("#togglePassword").addEventListener("click", () => {
  const visible = $("#password").type === "password";
  $("#password").type = visible ? "text" : "password";
  $("#togglePassword").setAttribute("aria-pressed", String(visible));
  $("#togglePassword").setAttribute("aria-label", visible ? "Ẩn mật khẩu" : "Hiện mật khẩu");
});
$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault(); if (busy) return;
  validatePasswordConfirmation();
  if (mode === "register" && $("#password").value !== $("#confirmPassword").value) {
    $("#confirmPassword").reportValidity();
    $("#confirmPassword").focus();
    return;
  }
  busy = true; $("#submitLogin").disabled = true;
  $("#loginMessage").textContent = "";
  const payload = { email: $("#username").value.trim(), password: $("#password").value };
  if (mode === "register") payload.display_name = $("#displayName").value.trim();
  $("#submitLogin").textContent = mode === "register" ? "Đang tạo tài khoản…" : "Đang đăng nhập…";
  try {
    const user = await api.post(`/api/auth/${mode}`, payload);
    $("#password").value = ""; $("#confirmPassword").value = "";
    location.assign(user.must_change_password ? "/account.html" : safeNext(params.get("next")));
  } catch (error) {
    $("#loginMessage").textContent = error.message;
    $("#password").value = ""; $("#confirmPassword").value = ""; validatePasswordConfirmation(); $("#password").focus();
  } finally {
    busy = false; $("#submitLogin").disabled = false;
    $("#submitLogin").textContent = mode === "register" ? "Tạo tài khoản" : "Đăng nhập";
  }
});
selectMode(params.get("mode"));
