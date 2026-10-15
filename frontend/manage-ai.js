import { api } from "./js/api.js";
import { showToast } from "./js/ui.js";

const $ = selector => document.querySelector(selector);
const element = (tag, text, className = "") => {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
};
const number = value => Number(value).toLocaleString("vi-VN");
const limitText = value => value === null ? "Không giới hạn" : number(value);
const inputLimit = id => $(id).value === "" ? null : Number($(id).value);
let data = null, selectedId = null, requestId = 0, changed = null;

function usageCell(used, limit) {
  const cell = element("td", `${number(used)} / ${limit === null ? "∞" : number(limit)}`);
  cell.append(element("small", limit === null ? "Không giới hạn" : `Còn ${number(Math.max(0, limit - used))} lượt`));
  if (limit !== null && limit > 0) {
    const progress = document.createElement("progress");
    progress.max = limit;
    progress.value = Math.min(limit, used);
    progress.setAttribute("aria-label", `Đã dùng ${used} trong ${limit} lượt`);
    cell.append(progress);
  }
  return cell;
}

function renderUsers() {
  const host = $("#ai-quota-users");
  host.replaceChildren();
  if (!data) return;
  const query = $("#ai-quota-search").value.trim().toLocaleLowerCase("vi");
  const accounts = data.accounts.filter(account => `${account.display_name} ${account.username}`.toLocaleLowerCase("vi").includes(query));
  accounts.sort((a, b) => b.usage.month - a.usage.month);
  for (const account of accounts) {
    const row = document.createElement("tr");
    row.dataset.accountId = account.id;
    const name = element("td", account.display_name);
    name.append(element("small", `${account.username} · ${account.role === "admin" ? "Admin" : "Thành viên"}`));
    const limits = element("td", account.overridden ? "Mức riêng" : "Mặc định");
    limits.append(element("small", `${account.policy.per_minute} lượt/phút`));
    const state = account.policy.enabled ? (account.is_active ? "Được phép" : "Tài khoản đã khóa") : "AI tạm dừng";
    const status = element("td", state, account.policy.enabled ? "" : "manage-danger");
    const tools = element("td", "");
    const actions = element("div", "", "manage-actions");
    if (account.editable) {
      const edit = element("button", "Điều chỉnh", "button button-outline");
      edit.type = "button";
      edit.addEventListener("click", () => openAIQuota(account.id));
      const toggle = element("button", account.policy.enabled ? "Tạm dừng AI" : "Mở lại AI", "button button-outline");
      toggle.type = "button";
      toggle.addEventListener("click", async () => {
        const version = requestId;
        toggle.disabled = true;
        try {
          await api.patch(`/api/manage/accounts/${encodeURIComponent(account.id)}/ai-quota`, { ...account.policy, enabled: !account.policy.enabled });
          if (version !== requestId) return;
          await changed();
          showToast("Đã cập nhật quyền dùng AI.", "success");
        } catch (error) { if (version === requestId) showToast(error.message, "error"); }
        finally { toggle.disabled = false; }
      });
      actions.append(edit, toggle);
    } else actions.append(element("small", "Admin trung tâm quản lý"));
    tools.append(actions);
    row.append(name, usageCell(account.usage.today, account.policy.daily_limit), usageCell(account.usage.month, account.policy.monthly_limit), limits, status, tools);
    host.append(row);
  }
  if (!accounts.length) {
    const row = document.createElement("tr"), cell = element("td", "Không tìm thấy tài khoản phù hợp.");
    cell.colSpan = 6; row.append(cell); host.append(row);
  }
}

function render() {
  const summary = $("#ai-quota-summary");
  summary.replaceChildren();
  for (const [label, used, limit] of [["Toàn hệ thống hôm nay", data.usage.today, data.settings.global_daily_limit], ["Toàn hệ thống tháng này", data.usage.month, data.settings.global_monthly_limit]]) {
    const card = element("article", "", "manage-metric");
    card.append(element("span", label), element("strong", number(used)), element("small", `Trần: ${limitText(limit)}${limit === null ? "" : ` · Còn ${number(Math.max(0, limit - used))}`}`));
    summary.append(card);
  }
  const configured = data.provider.available ? `${data.provider.provider} · ${data.provider.model}` : "Dịch vụ AI chưa được cấu hình";
  $("#ai-quota-provider").textContent = `${configured} · ${data.feature_enabled ? "AURA AI đang mở" : "AURA AI đã tạm dừng toàn hệ thống"}`;
  for (const [id, key] of [["#ai-default-day", "daily_limit"], ["#ai-default-month", "monthly_limit"], ["#ai-default-minute", "per_minute"], ["#ai-global-day", "global_daily_limit"], ["#ai-global-month", "global_monthly_limit"]]) $(id).value = data.settings[key] ?? "";
  $("#ai-quota-default-fields").disabled = !data.can_edit_defaults;
  $("#ai-quota-save-defaults").disabled = !data.can_edit_defaults;
  $("#ai-quota-default-note").textContent = `${data.can_edit_defaults ? "Mặc định áp dụng cho tài khoản chưa đặt mức riêng." : "Chỉ admin trung tâm được thay đổi mặc định và trần hệ thống."} Để trống = không giới hạn; 0 = không cấp lượt.`;
  $("#ai-quota-updated").textContent = `Cập nhật ${new Intl.DateTimeFormat("vi-VN", { timeStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date())} · Ngày ${data.period.day} · Tháng ${data.period.month} · Giờ Việt Nam`;
  renderUsers();
}

export async function loadAIQuotaManagement() {
  const version = ++requestId;
  const result = await api.get("/api/manage/ai/usage");
  if (version !== requestId) return;
  data = result;
  render();
}

export function clearAIQuotaManagement() {
  requestId++;
  data = null;
  selectedId = null;
  $("#ai-quota-users").replaceChildren();
  $("#ai-quota-summary").replaceChildren();
  $("#ai-quota-default-form").reset();
  $("#ai-quota-user-form").reset();
  for (const id of ["#ai-quota-user-name", "#ai-quota-user-usage", "#ai-quota-updated", "#ai-quota-default-error", "#ai-quota-user-error"]) $(id).textContent = "";
  if ($("#ai-quota-dialog").open) $("#ai-quota-dialog").close();
}

export function openAIQuota(accountId) {
  const account = data?.accounts.find(item => item.id === accountId);
  if (!account?.editable) return;
  selectedId = account.id;
  $("#ai-quota-user-name").textContent = `${account.display_name} · ${account.username}`;
  $("#ai-quota-user-usage").textContent = `Đã dùng hôm nay: ${number(account.usage.today)} · Tháng này: ${number(account.usage.month)}`;
  $("#ai-quota-custom").checked = account.overridden;
  $("#ai-quota-user-fields").disabled = !account.overridden;
  $("#ai-user-day").value = account.policy.daily_limit ?? "";
  $("#ai-user-month").value = account.policy.monthly_limit ?? "";
  $("#ai-user-minute").value = account.policy.per_minute;
  $("#ai-user-enabled").checked = account.policy.enabled;
  $("#ai-quota-user-error").textContent = "";
  $("#ai-quota-dialog").showModal();
}

export function initAIQuotaManagement(onChanged) {
  changed = onChanged;
  $("#ai-quota-search").addEventListener("input", renderUsers);
  $("#ai-quota-user-close").addEventListener("click", () => $("#ai-quota-dialog").close());
  $("#ai-quota-custom").addEventListener("change", event => { $("#ai-quota-user-fields").disabled = !event.target.checked; });
  $("#ai-quota-refresh").addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await loadAIQuotaManagement(); } catch (error) { showToast(error.message, "error"); }
    finally { button.disabled = false; }
  });
  $("#ai-quota-default-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!data?.can_edit_defaults) return;
    const version = requestId, button = $("#ai-quota-save-defaults");
    button.disabled = true;
    $("#ai-quota-default-error").textContent = "";
    try {
      await api.patch("/api/manage/ai/settings", { daily_limit: inputLimit("#ai-default-day"), monthly_limit: inputLimit("#ai-default-month"), per_minute: inputLimit("#ai-default-minute"), global_daily_limit: inputLimit("#ai-global-day"), global_monthly_limit: inputLimit("#ai-global-month") });
      if (version !== requestId) return;
      await changed();
      showToast("Đã lưu hạn mức mặc định và trần hệ thống.", "success");
    } catch (error) { if (version === requestId) $("#ai-quota-default-error").textContent = error.message; }
    finally { button.disabled = !data?.can_edit_defaults; }
  });
  $("#ai-quota-user-form").addEventListener("submit", async event => {
    event.preventDefault();
    const version = requestId, id = selectedId, button = $("#ai-quota-user-save");
    if (!id) return;
    button.disabled = true;
    try {
      const path = `/api/manage/accounts/${encodeURIComponent(id)}/ai-quota`;
      if ($("#ai-quota-custom").checked) await api.patch(path, { daily_limit: inputLimit("#ai-user-day"), monthly_limit: inputLimit("#ai-user-month"), per_minute: inputLimit("#ai-user-minute"), enabled: $("#ai-user-enabled").checked });
      else await api.delete(path);
      if (version !== requestId) return;
      $("#ai-quota-dialog").close();
      await changed();
      showToast("Đã lưu hạn mức AI của tài khoản.", "success");
    } catch (error) { if (version === requestId) $("#ai-quota-user-error").textContent = error.message; }
    finally { button.disabled = false; }
  });
}
