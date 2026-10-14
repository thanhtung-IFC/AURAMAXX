import { api } from "./js/api.js";
import { initTheme } from "./js/theme.js";
import { showToast } from "./js/ui.js";

initTheme();
const $ = selector => document.querySelector(selector);
let accounts = [], people = [], currentUser = null, statusData = null, featureData = [];
const node = (tag, text, className) => { const item = document.createElement(tag); item.textContent = text ?? "—"; if (className) item.className = className; return item; };
const action = (label, callback, danger = false) => { const button = node("button", label, "button button-outline" + (danger ? " manage-danger" : "")); button.type = "button"; button.addEventListener("click", async () => { button.disabled = true; try { await callback(); } catch (error) { showToast(error.message, "error"); } finally { button.disabled = false; } }); return button; };
function showPassword(password) { $("#managed-temporary-password").value = password; $("#managed-temporary-password").type = "password"; $("#managed-password-dialog").showModal(); }
function clearPassword() { $("#managed-temporary-password").value = ""; $("#managed-password-dialog").close(); }
function central() { return Boolean(statusData?.is_central); }

function renderAccounts() {
  const body = $("#managed-accounts"); body.replaceChildren();
  const search = $("#account-search").value.toLocaleLowerCase("vi");
  for (const account of accounts.filter(item => [item.username, item.display_name, item.email].join(" ").toLocaleLowerCase("vi").includes(search))) {
    const row = document.createElement("tr"), name = node("td", account.display_name);
    name.append(node("small", account.email || account.username));
    if (account.is_central) name.append(node("span", "Admin trung tâm", "role-chip role-central"));
    else if (account.role === "admin") name.append(node("span", "Admin phụ", "role-chip"));
    const tools = node("td", ""), actions = node("div", "", "manage-actions"), own = account.user_id === currentUser.id;
    if (!own && (account.role !== "admin" || central())) {
      actions.append(action("Sửa", () => openAccount(account)), action(account.is_active ? "Khóa" : "Mở khóa", async () => { await api.post(`/api/manage/accounts/${account.id}/status`, { is_active: !account.is_active }); await load(); }));
      actions.append(action("Đặt lại mật khẩu", async () => { if (!confirm(`Đặt lại mật khẩu của ${account.display_name} và đăng xuất các phiên đang hoạt động?`)) return; const result = await api.post(`/api/manage/accounts/${account.id}/reset-password`, {}); showPassword(result.temporary_password); await load(); }));
      actions.append(action("Thu hồi phiên", async () => { if (!confirm(`Đăng xuất ${account.display_name} khỏi tất cả thiết bị?`)) return; await api.post(`/api/manage/accounts/${account.id}/revoke-sessions`, {}); showToast("Đã thu hồi các phiên.", "success"); await load(); }));
      if (account.role !== "admin" && central() && statusData.admin_count < statusData.admin_limit) actions.append(action("Cấp quyền admin", async () => { if (!confirm(`Cấp quyền admin phụ cho ${account.display_name}?`)) return; await api.patch(`/api/manage/accounts/${account.id}/role`, { role: "admin" }); await load(); }));
      if (account.role === "admin" && central()) actions.append(action("Hạ xuống người dùng", async () => { if (!confirm(`Gỡ quyền admin của ${account.display_name}? Các phiên đăng nhập sẽ bị thu hồi.`)) return; await api.patch(`/api/manage/accounts/${account.id}/role`, { role: "user" }); await load(); }, true));
      if (account.role !== "admin") actions.append(action("Xóa", async () => { if (!confirm(`Xóa tài khoản ${account.display_name} cùng hồ sơ và dữ liệu thuộc tài khoản?`)) return; await api.delete(`/api/manage/accounts/${account.id}`); await load(); }, true));
    }
    tools.append(actions);
    row.append(name, node("td", account.role === "admin" ? (account.is_central ? "Admin trung tâm" : "Admin phụ") : "Người dùng"), node("td", account.is_active ? "Hoạt động" : "Đã khóa"), node("td", account.people_count), tools); body.append(row);
  }
}

function renderPeople() {
  const body = $("#managed-people"); body.replaceChildren();
  for (const person of people) {
    const row = document.createElement("tr"), name = node("td", person.name); name.append(node("small", person.id));
    const tools = node("td", ""), actions = node("div", "", "manage-actions");
    actions.append(action("Sửa / gán chủ", () => openPerson(person)), action("Xóa", async () => { if (!confirm(`Xóa hồ sơ ${person.name} và tất cả mẫu khuôn mặt?`)) return; await api.delete(`/api/manage/people/${person.id}`); await load(); }, true));
    tools.append(actions); row.append(name, node("td", person.owner_username || "Chưa gán"), node("td", person.sample_count), tools); body.append(row);
  }
}

function recordLabel(key) { return ({id: "ID", user_id: "Người dùng", conversation_id: "Hội thoại", title: "Tiêu đề", category: "Danh mục", value: "Giá trị", note: "Ghi chú", content: "Nội dung", created_at: "Ngày tạo", recorded_at: "Ngày ghi nhận", updated_at: "Cập nhật", display_name: "Tên hiển thị", leaderboard_public: "Công khai", elo: "ELO", granted: "Đồng ý", purpose: "Mục đích"})[key] || key; }
function renderRecords(host, records, {table = null, deletable = false} = {}) {
  host.replaceChildren();
  if (!records.length) { host.append(node("p", "Chưa có bản ghi.")); return; }
  const columns = Object.keys(records[0]), tableNode = document.createElement("table"), head = document.createElement("thead"), heading = document.createElement("tr");
  columns.forEach(column => heading.append(node("th", recordLabel(column))));
  if (deletable) heading.append(node("th", "Thao tác")); head.append(heading); tableNode.append(head);
  const body = document.createElement("tbody");
  records.forEach(record => {
    const row = document.createElement("tr");
    columns.forEach(column => { const value = String(record[column] ?? "—"), cell = node("td", value.length > 180 ? value.slice(0, 180) + "…" : value); cell.title = value; row.append(cell); });
    if (deletable) { const tools = node("td", ""), btn = action("Xóa", async () => { if (!confirm("Xóa bản ghi này? Thao tác này không thể hoàn tác.")) return; const key = table === "arena_profiles" || table === "arena_bot_profiles" ? record.user_id : table === "arena_match_participants" ? `${record.match_id}|${record.user_id}` : table === "arena_achievements" ? `${record.user_id}|${record.achievement_key}` : record.id; await api.delete(`/api/manage/data/${table}/${encodeURIComponent(key)}`); await loadData(); }, true); tools.append(btn); row.append(tools); }
    body.append(row);
  });
  tableNode.append(body); host.append(tableNode);
}

async function loadData() { const table = $("#managed-data-kind").value, result = await api.get(`/api/manage/data/${table}`); renderRecords($("#managed-data"), result.records, {table, deletable: true}); }
function renderFeatures() {
  const host = $("#managed-features"); host.replaceChildren();
  for (const feature of featureData) {
    const card = node("article", "", "feature-card"), info = node("div", "", "feature-info"), state = node("span", feature.enabled ? "Đang hoạt động" : "Đã tạm dừng", `feature-state ${feature.enabled ? "is-on" : "is-off"}`);
    info.append(node("strong", feature.name), state); const label = node("label", "", "switch-label"), toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.checked = feature.enabled; toggle.disabled = !central(); toggle.setAttribute("aria-label", `Bật ${feature.name}`);
    toggle.addEventListener("change", async () => { toggle.disabled = true; try { await api.patch(`/api/manage/features/${feature.key}`, {enabled: toggle.checked}); feature.enabled = toggle.checked; renderFeatures(); showToast(`${feature.name} đã được ${feature.enabled ? "mở" : "tạm dừng"}.`, "success"); } catch (error) { toggle.checked = !toggle.checked; toggle.disabled = !central(); showToast(error.message, "error"); } });
    const slider = node("span", "", "switch-slider"); label.append(toggle, slider); card.append(info, label); host.append(card);
  }
}

async function load() {
  try {
    currentUser = await api.get("/api/auth/me");
    const status = await api.get("/api/manage/status"); statusData = status;
    $("#manage-content").hidden = false; $("#manage-access").hidden = true;
    $("#manage-status").textContent = "Đang đăng nhập an toàn.";
    const identity = $("#admin-identity"); identity.hidden = false; identity.replaceChildren(node("strong", currentUser.display_name), node("span", central() ? "ADMIN TRUNG TÂM · TOÀN QUYỀN" : "ADMIN PHỤ · QUẢN TRỊ VẬN HÀNH", central() ? "central-label" : "delegated-label"));
    $("#storage-title").textContent = `${status.server} · ${status.database}`;
    $("#storage-description").textContent = `Ứng dụng: ${status.application_database} · Khuôn mặt: ${status.face_database}`;
    const metrics = $("#manage-metrics"); metrics.replaceChildren();
    for (const [label, value] of [["Người dùng", status.counts.users], ["Admin", `${status.admin_count}/${status.admin_limit}`], ["Hồ sơ khuôn mặt", status.faces.people], ["Nhật ký sức khỏe", status.counts.habit_entries], ["Hội thoại AI", status.counts.ai_conversations]]) { const item = node("article", "", "manage-metric"); item.append(node("strong", value), node("span", label)); metrics.append(item); }
    $("#admin-capacity").textContent = `Admin ${status.admin_count}/${status.admin_limit} · chỉ admin trung tâm được cấp hoặc gỡ quyền admin.`;
    $("#open-create-account").disabled = status.admin_count >= status.admin_limit && central();
    $("#managed-role").disabled = !central() || status.admin_count >= status.admin_limit;
    const [accountData, personData, audit, features] = await Promise.all([api.get("/api/manage/accounts"), api.get("/api/manage/people"), api.get("/api/manage/audit"), api.get("/api/manage/features")]);
    accounts = accountData.accounts; people = personData.people; featureData = features.features;
    renderAccounts(); renderPeople(); renderRecords($("#managed-audit"), audit.events); renderFeatures(); await loadData();
  } catch (error) { $("#manage-content").hidden = true; $("#manage-access").hidden = false; $("#manage-status").textContent = error.message; }
}

function openAccount(account = null) {
  $("#managed-account-form").reset(); $("#managed-account-error").textContent = "";
  $("#managed-account-title").textContent = account ? "Chỉnh sửa tài khoản" : "Tạo tài khoản";
  $("#managed-account-id").value = account?.id || ""; $("#managed-username").value = account?.username || ""; $("#managed-display-name").value = account?.display_name || "";
  $("#managed-role").hidden = Boolean(account); $("#managed-role-label").hidden = Boolean(account); $("#managed-account-dialog").showModal();
}
function openPerson(person) {
  $("#managed-person-id").value = person.id; $("#managed-person-name").value = person.name; $("#managed-person-error").textContent = "";
  const select = $("#managed-person-owner"); select.replaceChildren(); const none = node("option", "Chưa gán"); none.value = ""; select.append(none);
  accounts.filter(account => account.is_active || account.id === person.account_id).forEach(account => { const option = node("option", account.display_name + " · " + account.username); option.value = account.id; select.append(option); }); select.value = person.account_id || "";
  $("#managed-person-dialog").showModal();
}

$("#account-search").addEventListener("input", renderAccounts);
$("#open-create-account").addEventListener("click", () => openAccount());
$("#managed-account-form").addEventListener("submit", async event => { event.preventDefault(); const submit = event.currentTarget.querySelector('[type="submit"]'); submit.disabled = true; try { const id = $("#managed-account-id").value, body = {username: $("#managed-username").value, display_name: $("#managed-display-name").value}; if (id) await api.patch(`/api/manage/accounts/${id}`, body); else { const result = await api.post("/api/manage/accounts", {...body, role: $("#managed-role").value}); showPassword(result.temporary_password); } $("#managed-account-dialog").close(); await load(); } catch (error) { $("#managed-account-error").textContent = error.message; } finally { submit.disabled = false; } });
$("#managed-person-form").addEventListener("submit", async event => { event.preventDefault(); try { await api.patch(`/api/manage/people/${$("#managed-person-id").value}`, {name: $("#managed-person-name").value, account_id: $("#managed-person-owner").value || null}); $("#managed-person-dialog").close(); await load(); } catch (error) { $("#managed-person-error").textContent = error.message; } });
$("#close-managed-account").addEventListener("click", () => $("#managed-account-dialog").close()); $("#close-managed-person").addEventListener("click", () => $("#managed-person-dialog").close());
$("#close-managed-password").addEventListener("click", clearPassword); $("#managed-password-dialog").addEventListener("cancel", clearPassword);
$("#reveal-managed-password").addEventListener("click", () => { const input = $("#managed-temporary-password"); input.type = input.type === "password" ? "text" : "password"; });
$("#managed-data-kind").addEventListener("change", () => loadData().catch(error => showToast(error.message, "error")));
document.querySelectorAll("[data-manage-tab]").forEach(button => button.addEventListener("click", () => { document.querySelectorAll("[data-manage-tab]").forEach(tab => tab.setAttribute("aria-pressed", String(tab === button))); document.querySelectorAll("[data-manage-panel]").forEach(panel => { panel.hidden = panel.dataset.managePanel !== button.dataset.manageTab; }); }));
$("#create-backup").addEventListener("click", async event => { const button = event.currentTarget; button.disabled = true; try { const result = await api.post("/api/manage/backups", {}); const link = $("#backup-download"); link.href = result.download; link.hidden = false; showToast("Bản sao lưu đã được kiểm tra và lưu trên máy chủ.", "success"); } catch (error) { showToast(error.message, "error"); } finally { button.disabled = false; } });
void load();
