import { api } from "../api.js";
import { showToast } from "../ui.js";
import { getFaceReport } from "../face/report.js";
import { consumeSSE } from "../chat-stream.js";

let conversations = [];
let currentConversationId = null;
let abortController = null;
let isBusy = false;
let userReady = false;
let consentGranted = false;
let providerReady = false;
let loadId = 0;
let accessId = 0;
let identityId = 0;
let isLoading = false;

const $ = (selector) => document.querySelector(selector);
const body = () => $("#chat-body");

function setServiceBadge(label, state) {
  const badge = $("#aura-status-badge");
  badge.dataset.state = state;
  $("#aura-status-label").textContent = label;
}

function setAvailability() {
  const enabled = providerReady && userReady && consentGranted && !isBusy && !isLoading;
  $("#chat-input").disabled = !enabled;
  $("#chat-send").disabled = !enabled || !$("#chat-input").value.trim();
  $("#chat-new").disabled = !providerReady || !userReady || !consentGranted || isBusy || isLoading;
  $("#chat-clear-history").disabled = !userReady || conversations.length === 0 || isBusy || isLoading;
  $("#chat-delete-current").disabled = !currentConversationId || isBusy || isLoading;
  $("#chat-reconnect").disabled = isBusy || isLoading;
  $("#chat-character-count").textContent = `${$("#chat-input").value.length.toLocaleString("vi-VN")} / 4.000`;
  document.querySelectorAll("[data-chat-suggestion]").forEach((button) => { button.disabled = !enabled; });
  $("#chat-attach-report").disabled = !getFaceReport() || !userReady || isBusy;
  $("#chat-routine").disabled = false;
  document.querySelectorAll(".chat-conversation-item").forEach(button => { button.disabled = isBusy; });
  document.querySelectorAll(".chat-message-action").forEach(button => { button.disabled = isBusy || isLoading; });
}

function showNotice(message, actionLabel = "", action = "") {
  const notice = $("#chat-access-notice");
  notice.replaceChildren();
  notice.hidden = !message;
  if (!message) return;
  const text = document.createElement("span");
  text.textContent = message;
  notice.append(text);
  if (actionLabel) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "text-link";
    button.textContent = actionLabel;
    button.addEventListener("click", () => { window.location.hash = action; });
    notice.append(button);
  }
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

// Only the small Markdown subset requested by the chat is supported. Raw HTML is escaped first.
function safeMarkdown(source) {
  const blocks = [];
  const randomToken = globalThis.crypto?.randomUUID?.().replaceAll("-", "") || `${Date.now()}${Math.random().toString(36).slice(2)}`;
  const token = `AURACODE${randomToken}END`;
  let escaped = source.replace(/```([\w+-]*)\s*\n?([\s\S]*?)```/g, (_match, _language, code) => {
    const placeholder = `${token}${blocks.length}X`;
    blocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return placeholder;
  });
  escaped = escapeHtml(escaped)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  const rendered = escaped.split(/\n{2,}/).map((block) => {
    const heading = block.match(/^(#{1,3})\s+(.+)$/);
    if (heading) return `<h${heading[1].length}>${heading[2]}</h${heading[1].length}>`;
    const lines = block.split("\n");
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      return `<ul>${lines.map((line) => `<li>${line.replace(/^\s*[-*]\s+/, "")}</li>`).join("")}</ul>`;
    }
    return `<p>${block.replace(/\n/g, "<br>")}</p>`;
  }).join("");
  return rendered.replace(new RegExp(`${token}(\\d+)X`, "g"), (_match, index) => blocks[Number(index)] || "");
}

function scrollToLatest() {
  const container = body();
  if (!container.dataset.readingEarlier) container.scrollTop = container.scrollHeight;
}

function showWelcome(show) {
  $(".chat-welcome").hidden = !show;
}

function addMessage(role, content, { streaming = false, error = false } = {}) {
  const item = document.createElement("article");
  item.className = `chat-message chat-message-${role}${error ? " chat-message-error" : ""}`;
  item.dataset.role = role;
  const label = document.createElement("span");
  label.className = "chat-message-label";
  label.textContent = role === "user" ? "BẠN" : "AURA AI";
  const bubble = document.createElement("div");
  bubble.className = "chat-message-content";
  if (streaming) {
    bubble.textContent = "";
    const typing = document.createElement("span");
    typing.className = "chat-thinking";
    typing.textContent = "Aura đang soạn câu trả lời…";
    bubble.append(typing);
  } else if (error) {
    bubble.textContent = content;
  } else {
    if (role === "user") bubble.textContent = content;
    else bubble.innerHTML = safeMarkdown(content);
  }
  item.append(label, bubble);
  body().append(item);
  scrollToLatest();
  return { item, bubble };
}

function addCopyAction(message, content) {
  const action = document.createElement("button");
  action.type = "button";
  action.className = "chat-message-action";
  action.textContent = "Sao chép";
  action.setAttribute("aria-label", "Sao chép câu trả lời của Aura");
  action.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(content); showToast("Đã sao chép câu trả lời.", "success"); }
    catch { showToast("Bạn có thể chọn nội dung để sao chép thủ công."); }
  });
  message.item.append(action);
}

function renderMessages(messages) {
  body().querySelectorAll(".chat-message").forEach((node) => node.remove());
  showWelcome(messages.length === 0);
  delete body().dataset.readingEarlier;
  for (const message of messages) {
    const rendered = addMessage(message.role, message.content);
    if (message.role === "assistant") addCopyAction(rendered, message.content);
  }
  scrollToLatest();
}

function formatConversationDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat("vi-VN", { day: "numeric", month: "short" }).format(date);
}

function renderConversationList() {
  const list = $("#chat-conversation-list");
  list.replaceChildren();
  if (!userReady) {
    const empty = document.createElement("p");
    empty.className = "chat-list-empty";
    empty.textContent = "Đăng nhập để xem lịch sử hội thoại riêng của bạn.";
    list.append(empty);
    setAvailability();
    return;
  }
  if (!conversations.length) {
    const empty = document.createElement("p");
    empty.className = "chat-list-empty";
    empty.textContent = "Chưa có hội thoại được lưu.";
    list.append(empty);
  }
  const query = $("#chat-history-search").value.trim().toLocaleLowerCase("vi");
  const filtered = conversations.filter(item => item.title.toLocaleLowerCase("vi").includes(query));
  if (query && !filtered.length && conversations.length) {
    const empty = document.createElement("p");
    empty.className = "chat-list-empty";
    empty.textContent = "Không tìm thấy hội thoại phù hợp.";
    list.append(empty);
  }
  for (const conversation of filtered) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-conversation-item";
    button.classList.toggle("active", conversation.id === currentConversationId);
    button.setAttribute("aria-current", String(conversation.id === currentConversationId));
    button.disabled = isBusy;
    const title = document.createElement("b");
    title.textContent = conversation.title;
    const updated = document.createElement("span");
    updated.textContent = formatConversationDate(conversation.updated_at);
    button.append(title, updated);
    button.addEventListener("click", () => void openConversation(conversation.id));
    list.append(button);
  }
  setAvailability();
}

async function refreshConversations({ selectLatest = false } = {}) {
  if (!userReady) return;
  const identity = identityId;
  const result = await api.get("/api/aura/conversations");
  if (identity !== identityId) return;
  conversations = result;
  if (currentConversationId && !conversations.some((item) => item.id === currentConversationId)) currentConversationId = null;
  if (selectLatest && !currentConversationId && conversations.length) currentConversationId = conversations[0].id;
  renderConversationList();
}

async function openConversation(id) {
  if (isBusy) return;
  const requestId = ++loadId;
  currentConversationId = id;
  renderConversationList();
  const selected = conversations.find((item) => item.id === id);
  $("#chat-current-title").textContent = selected?.title || "Aura AI";
  renderMessages([]);
  isLoading = true;
  showWelcome(false);
  setAvailability();
  try {
    const messages = await api.get(`/api/aura/conversations/${encodeURIComponent(id)}/messages`);
    if (requestId === loadId && currentConversationId === id) {
      renderMessages(messages);
      $("#chat-connection-state").innerHTML = "<i></i> Sẵn sàng trò chuyện";
      $("#chat-connection-state").dataset.state = "ready";
    }
  } catch (error) {
    if (requestId === loadId) {
      currentConversationId = null;
      await refreshConversations();
      showNotice(error.message);
    }
  } finally {
    if (requestId === loadId) { isLoading = false; setAvailability(); }
  }
}

async function createConversation() {
  if (isBusy || isLoading) return;
  isLoading = true;
  const identity = identityId;
  setAvailability();
  try {
    const conversation = await api.post("/api/aura/conversations", { title: "Cuộc trò chuyện mới" });
    if (identity !== identityId) return;
    currentConversationId = conversation.id;
    $("#chat-current-title").textContent = conversation.title;
    $("#chat-input").value = "";
    $("#chat-history-search").value = "";
    renderMessages([]);
    await refreshConversations();
    showNotice("");
    $("#chat-connection-state").innerHTML = "<i></i> Sẵn sàng nhận câu hỏi";
    $("#chat-connection-state").dataset.state = "ready";
  } finally { if (identity === identityId) { isLoading = false; setAvailability(); } }
  $("#chat-input").focus();
}

async function loadAccess() {
  if (isBusy) return;
  const run = ++accessId;
  const previousConversation = currentConversationId;
  const isCurrent = () => run === accessId;
  isLoading = true;
  userReady = false;
  consentGranted = false;
  setAvailability();
  showNotice("");
  setServiceBadge("Đang kiểm tra dịch vụ…", "loading");
  $("#chat-connection-state").innerHTML = "<i></i> Đang kiểm tra dịch vụ";
  let provider = null;
  try {
    provider = await api.get("/api/aura/status");
  } catch {
    provider = { available: false, status: "offline", message: "Không kết nối được backend Aura AI." };
  }
  if (!isCurrent()) return;
  providerReady = Boolean(provider.available);
  setServiceBadge(providerReady ? "Dịch vụ đã cấu hình" : "AI chưa sẵn sàng", providerReady ? "ready" : "offline");
  $("#chat-connection-state").innerHTML = providerReady ? "<i></i> Sẵn sàng nhận câu hỏi" : "<i></i> Dịch vụ chưa sẵn sàng";
  $("#chat-connection-state").dataset.state = providerReady ? "ready" : "offline";

  userReady = false;
  consentGranted = false;
  try {
    await api.get("/api/auth/me");
    if (!isCurrent()) return;
    userReady = true;
    const consents = await api.get("/api/consents");
    if (!isCurrent()) return;
    consentGranted = consents.some((item) => item.purpose === "ai_chat" && item.granted);
    if (consentGranted) await refreshConversations({ selectLatest: true });
    else {
      conversations = [];
      currentConversationId = null;
      renderMessages([]);
      renderConversationList();
    }
    if (!isCurrent()) return;
    if (currentConversationId && (currentConversationId !== previousConversation || !body().querySelector(".chat-message"))) await openConversation(currentConversationId);
  } catch (error) {
    if (!isCurrent()) return;
    if (error.status !== 401) showNotice(error.message);
    else {
      currentConversationId = null;
      conversations = [];
      renderMessages([]);
      renderConversationList();
    }
  }
  if (!isCurrent()) return;
  isLoading = false;
  if (!providerReady) showNotice(provider.message || "Aura AI chưa sẵn sàng. Vui lòng thử kết nối lại sau.");
  else if (!userReady) showNotice("Đăng nhập để chat riêng tư và lưu lịch sử vào tài khoản.", "Mở My Aura", "my-aura");
  else if (!consentGranted) showNotice("Để gửi tin nhắn và lưu lịch sử, hãy bật đồng ý AURA AI trong My Aura.", "Cài đặt đồng ý", "my-aura");
  setAvailability();
}

function setBusy(value) {
  isBusy = value;
  $("#chat-stop").hidden = !value;
  $("#chat-send").hidden = value;
  body().setAttribute("aria-busy", String(value));
  setAvailability();
}

async function sendMessage(event) {
  event?.preventDefault();
  const input = $("#chat-input");
  const message = input.value.trim();
  if (!message || message.length > 4000 || !providerReady || !userReady || !consentGranted || isBusy || isLoading) return;
  const identity = identityId;
  setBusy(true);
  input.value = "";
  input.style.height = "auto";
  // A first conversation is created by /chat only after the provider completes.
  // This also keeps rejected questions out of conversation titles.
  body().querySelectorAll("[data-unsaved]").forEach(node => node.remove());
  delete body().dataset.readingEarlier;
  showWelcome(false);
  const userMessage = addMessage("user", message);
  const assistant = addMessage("assistant", "", { streaming: true });
  const liveText = document.createTextNode("");
  let responseText = "";
  let completed = false;
  abortController = new AbortController();
  const turnController = abortController;
  const timeout = window.setTimeout(() => turnController.abort(new DOMException("Aura phản hồi quá lâu. Hãy thử lại.", "TimeoutError")), 125000);
  showNotice("");
  $("#chat-connection-state").innerHTML = "<i></i> Aura đang phản hồi";
  $("#chat-connection-state").dataset.state = "loading";
  try {
    const analysis = $("#chat-attach-report").checked ? getFaceReport() : null;
    const response = await api.stream("/api/aura/chat", { conversation_id: currentConversationId, message, ...(analysis ? { analysis } : {}) }, abortController.signal);
    if (identity !== identityId) { await response.body?.cancel(); return; }
    if (!response.ok) {
      let detail = `Yêu cầu không thành công (${response.status}).`;
      try {
        const payload = await response.json();
        const value = payload.detail || payload.message;
        detail = Array.isArray(value) ? value.map(item => item.msg).join(" ") : value || detail;
      } catch { /* Keep generic message. */ }
      const error = new Error(detail);
      error.status = response.status;
      throw error;
    }
    await consumeSSE(response, (eventData) => {
      if (identity !== identityId) return;
      if (eventData.type === "delta") {
        if (!responseText) assistant.bubble.replaceChildren(liveText);
        responseText += eventData.text || "";
        liveText.textContent = responseText;
        assistant.bubble.classList.add("is-streaming");
        scrollToLatest();
      } else if (eventData.type === "done") {
        completed = true;
        currentConversationId = eventData.conversation_id;
        assistant.bubble.classList.remove("is-streaming");
        assistant.bubble.innerHTML = safeMarkdown(responseText);
        addCopyAction(assistant, responseText);
      } else if (eventData.type === "error") {
        const error = new Error(eventData.message || "Aura AI chưa thể trả lời.");
        error.status = eventData.status;
        throw error;
      }
    });
    if (identity !== identityId) return;
    if (!completed || !responseText.trim()) throw new Error("Kết nối bị ngắt trước khi câu trả lời hoàn tất. Lượt chat chưa được lưu.");
    try { await refreshConversations(); } catch { showToast("Câu trả lời đã lưu. Chưa tải lại được danh sách hội thoại."); }
    const title = conversations.find((item) => item.id === currentConversationId)?.title;
    if (title) $("#chat-current-title").textContent = title;
    $("#chat-connection-state").innerHTML = "<i></i> Sẵn sàng trò chuyện";
    $("#chat-connection-state").dataset.state = "ready";
    setServiceBadge("AI đã kết nối", "ready");
  } catch (error) {
    if (identity !== identityId) return;
    if (error instanceof TypeError) error = new Error("Không kết nối được tới Aura. Hãy kiểm tra mạng rồi thử lại.");
    userMessage.item.dataset.unsaved = "true";
    assistant.item.dataset.unsaved = "true";
    input.value = message;
    assistant.bubble.classList.remove("is-streaming");
    if (error.name === "AbortError") {
      assistant.bubble.textContent = responseText ? `${responseText}\n\n[Đã dừng · lượt chat chưa được lưu]` : "Đã dừng trước khi có câu trả lời. Lượt chat chưa được lưu.";
      assistant.item.classList.add("chat-message-error");
      $("#chat-connection-state").innerHTML = "<i></i> Đã dừng · chưa lưu";
    } else {
      assistant.bubble.textContent = error.message;
      assistant.item.classList.add("chat-message-error");
      $("#chat-connection-state").innerHTML = "<i></i> Có lỗi · lượt chat chưa lưu";
      if (error.status === 401) {
        userReady = false;
        showNotice("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để tiếp tục.", "Mở My Aura", "my-aura");
      } else if (error.status === 403) {
        consentGranted = false;
        showNotice(error.message, "Cài đặt đồng ý", "my-aura");
      } else if (error.status === 429) showToast(error.message, "error");
      else showToast(error.message, "error");
    }
    $("#chat-connection-state").dataset.state = "offline";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "chat-message-action";
    retry.textContent = "Thử gửi lại";
    retry.addEventListener("click", () => { if (!isBusy) { input.value = message; void sendMessage(); } });
    assistant.item.append(retry);
  } finally {
    window.clearTimeout(timeout);
    if (identity !== identityId) return;
    abortController = null;
    setBusy(false);
    setAvailability();
    scrollToLatest();
    input.focus({ preventScroll: true });
  }
}

function stopGeneration() {
  abortController?.abort();
}

async function deleteCurrentConversation() {
  if (!currentConversationId || isBusy || isLoading) return;
  const id = currentConversationId;
  const identity = identityId;
  isLoading = true;
  setAvailability();
  try {
    await api.delete(`/api/aura/conversations/${encodeURIComponent(id)}`);
    if (identity !== identityId) return;
    currentConversationId = null;
    $("#chat-current-title").textContent = "Aura AI";
    renderMessages([]);
    await refreshConversations({ selectLatest: true });
    if (currentConversationId) await openConversation(currentConversationId);
    showToast("Đã xóa hội thoại và tin nhắn của nó.", "success");
  } catch (error) { if (identity === identityId) showToast(error.message, "error"); }
  finally { if (identity === identityId) { isLoading = false; setAvailability(); } }
}

async function clearHistory() {
  if (!conversations.length || isBusy || isLoading || !window.confirm("Xóa toàn bộ lịch sử Aura AI của tài khoản này? Hành động này không thể hoàn tác.")) return;
  const identity = identityId;
  isLoading = true;
  setAvailability();
  try {
    await api.delete("/api/aura/conversations");
    if (identity !== identityId) return;
    currentConversationId = null;
    conversations = [];
    $("#chat-current-title").textContent = "Aura AI";
    renderMessages([]);
    renderConversationList();
    showToast("Đã xóa toàn bộ lịch sử Aura AI.", "success");
  } catch (error) { if (identity === identityId) showToast(error.message, "error"); }
  finally { if (identity === identityId) { isLoading = false; setAvailability(); } }
}

function onComposerKeydown(event) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void sendMessage();
  }
}

export function initAuraAI() {
  const attachment = document.createElement("div");
  attachment.className = "chat-report-attachment";
  attachment.innerHTML = '<label><input id="chat-attach-report" type="checkbox" disabled> Đính kèm số đo Face Lab</label><button class="text-link" id="chat-routine" type="button">Health Hub ↗</button><small id="chat-report-state">Chưa có báo cáo Face Lab trong phiên này.</small>';
  $("#chat-form").prepend(attachment);
  const updateReport = () => {
    const available = Boolean(getFaceReport());
    if (!available) $("#chat-attach-report").checked = false;
    $("#chat-report-state").textContent = available ? "Báo cáo sẵn sàng. Chọn đính kèm để gửi số đo; ảnh không được gửi." : "Phân tích trong Face Lab để đính kèm số đo. Ảnh không được gửi.";
    setAvailability();
  };
  const preparePrompt = (message, attach = false) => {
    $("#chat-input").value = message;
    $("#chat-attach-report").checked = attach && Boolean(getFaceReport());
    $("#chat-input").dispatchEvent(new Event("input", { bubbles: true }));
    $("#chat-input").focus();
  };
  $("#chat-routine").addEventListener("click", () => { window.location.hash = "health-hub"; });
  $("#chat-reconnect").addEventListener("click", () => void loadAccess());
  $("#chat-history-search").addEventListener("input", renderConversationList);
  $("#chat-history-toggle").addEventListener("click", () => {
    const layout = $(".chat-layout");
    const open = layout.dataset.historyOpen !== "true";
    layout.dataset.historyOpen = String(open);
    $("#chat-history-toggle").setAttribute("aria-expanded", String(open));
    if (open) $("#chat-history-search").focus();
  });
  body().addEventListener("scroll", () => {
    const container = body();
    if (container.scrollHeight - container.scrollTop - container.clientHeight > 100) container.dataset.readingEarlier = "true";
    else delete container.dataset.readingEarlier;
  }, { passive: true });
  window.addEventListener("auramaxx:ai-request", event => preparePrompt(event.detail.message, event.detail.attach));
  window.addEventListener("auramaxx:face-report-changed", updateReport);
  $("#chat-form").addEventListener("submit", (event) => void sendMessage(event));
  $("#chat-stop").addEventListener("click", stopGeneration);
  $("#chat-new").addEventListener("click", () => void createConversation().catch((error) => showToast(error.message, "error")));
  $("#chat-delete-current").addEventListener("click", () => void deleteCurrentConversation());
  $("#chat-clear-history").addEventListener("click", () => void clearHistory());
  $("#chat-input").addEventListener("input", (event) => {
    event.currentTarget.style.height = "auto";
    event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 150)}px`;
    setAvailability();
  });
  $("#chat-input").addEventListener("keydown", onComposerKeydown);
  document.querySelectorAll("[data-chat-suggestion]").forEach((button) => button.addEventListener("click", () => {
    $("#chat-input").value = button.dataset.chatSuggestion;
    $("#chat-input").dispatchEvent(new Event("input", { bubbles: true }));
    $("#chat-input").focus();
  }));
  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#aura-ai") void loadAccess();
  });
  const resetAccount = () => {
    identityId++;
    accessId++;
    loadId++;
    stopGeneration();
    abortController = null;
    isLoading = false;
    userReady = false;
    consentGranted = false;
    conversations = [];
    currentConversationId = null;
    $("#chat-input").value = "";
    $("#chat-attach-report").checked = false;
    $("#chat-history-search").value = "";
    $("#chat-current-title").textContent = "Aura AI";
    renderMessages([]);
    renderConversationList();
    setBusy(false);
  };
  window.addEventListener("auramaxx:consent-changed", (event) => {
    if (event.detail?.purpose === "ai_chat") {
      if (!event.detail.granted) {
        resetAccount();
      }
      if (window.location.hash === "#aura-ai") void loadAccess();
    }
  });
  window.addEventListener("auramaxx:auth-required", () => {
    if (window.location.hash === "#aura-ai") showNotice("Đăng nhập để chat riêng tư và xem lịch sử của bạn.", "Mở My Aura", "my-aura");
  });
  window.addEventListener("auramaxx:auth-changed", () => {
    resetAccount();
    void loadAccess();
  });
  renderConversationList();
  updateReport();
  void loadAccess();
}
