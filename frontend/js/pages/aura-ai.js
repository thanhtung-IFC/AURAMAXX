import { api } from "../api.js";
import { showToast } from "../ui.js";
import { getFaceReport } from "../face/report.js";

let conversations = [];
let currentConversationId = null;
let abortController = null;
let isBusy = false;
let userReady = false;
let consentGranted = false;
let providerReady = false;
let loadId = 0;

const $ = (selector) => document.querySelector(selector);
const body = () => $("#chat-body");

function setServiceBadge(label, state) {
  const badge = $("#aura-status-badge");
  badge.dataset.state = state;
  $("#aura-status-label").textContent = label;
}

function setAvailability() {
  const enabled = providerReady && userReady && consentGranted && !isBusy;
  $("#chat-input").disabled = !enabled;
  $("#chat-send").disabled = !enabled || !$("#chat-input").value.trim();
  $("#chat-new").disabled = !providerReady || !userReady || !consentGranted || isBusy;
  $("#chat-clear-history").disabled = !userReady || conversations.length === 0 || isBusy;
  $("#chat-delete-current").disabled = !currentConversationId || isBusy;
  document.querySelectorAll("[data-chat-suggestion]").forEach((button) => { button.disabled = !enabled; });
  $("#chat-attach-report").disabled = !getFaceReport() || !userReady || isBusy;
  $("#chat-routine").disabled = !enabled;
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
  container.scrollTop = container.scrollHeight;
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
    bubble.innerHTML = safeMarkdown(content);
  }
  item.append(label, bubble);
  body().append(item);
  scrollToLatest();
  return { item, bubble };
}

function renderMessages(messages) {
  body().querySelectorAll(".chat-message").forEach((node) => node.remove());
  showWelcome(messages.length === 0);
  for (const message of messages) addMessage(message.role, message.content);
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
  for (const conversation of conversations) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-conversation-item";
    button.classList.toggle("active", conversation.id === currentConversationId);
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
  conversations = await api.get("/api/aura/conversations");
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
  try {
    const messages = await api.get(`/api/aura/conversations/${encodeURIComponent(id)}/messages`);
    if (requestId === loadId && currentConversationId === id) renderMessages(messages);
  } catch (error) {
    if (requestId === loadId) {
      currentConversationId = null;
      await refreshConversations();
      showNotice(error.message);
    }
  }
}

async function createConversation() {
  const conversation = await api.post("/api/aura/conversations", { title: "Cuộc trò chuyện mới" });
  currentConversationId = conversation.id;
  $("#chat-current-title").textContent = conversation.title;
  renderMessages([]);
  await refreshConversations();
  $("#chat-input").focus();
}

async function loadAccess() {
  const run = ++loadId;
  showNotice("");
  setServiceBadge("Đang kiểm tra dịch vụ…", "loading");
  $("#chat-connection-state").innerHTML = "<i></i> Đang kiểm tra dịch vụ";
  let provider = null;
  try {
    provider = await api.get("/api/aura/status");
  } catch {
    provider = { available: false, status: "offline", message: "Không kết nối được backend Aura AI." };
  }
  if (run !== loadId) return;
  providerReady = Boolean(provider.available);
  setServiceBadge(providerReady ? "AI đã kết nối" : "AI chưa sẵn sàng", providerReady ? "ready" : "offline");
  $("#chat-connection-state").innerHTML = providerReady ? "<i></i> Kết nối an toàn qua backend" : "<i></i> Dịch vụ chưa sẵn sàng";

  userReady = false;
  consentGranted = false;
  try {
    await api.get("/api/auth/me");
    userReady = true;
    const consents = await api.get("/api/consents");
    consentGranted = consents.some((item) => item.purpose === "ai_chat" && item.granted);
    await refreshConversations({ selectLatest: true });
    if (currentConversationId) await openConversation(currentConversationId);
  } catch (error) {
    if (error.status !== 401) showNotice(error.message);
    else {
      currentConversationId = null;
      conversations = [];
      renderMessages([]);
      renderConversationList();
    }
  }
  if (!providerReady) showNotice(provider.message || "Aura AI chưa sẵn sàng. Kiểm tra cấu hình AI phía backend.");
  else if (!userReady) showNotice("Đăng nhập để chat riêng tư và lưu lịch sử vào tài khoản.", "Mở My Aura", "my-aura");
  else if (!consentGranted) showNotice("Để gửi tin nhắn và lưu lịch sử, hãy bật đồng ý AURA AI trong My Aura.", "Cài đặt đồng ý", "my-aura");
  setAvailability();
}

async function consumeSSE(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
      if (data) {
        let parsed;
        try { parsed = JSON.parse(data); } catch { continue; }
        onEvent(parsed);
      }
    }
    if (done) break;
  }
}

function setBusy(value) {
  isBusy = value;
  $("#chat-stop").hidden = !value;
  $("#chat-send").hidden = value;
  setAvailability();
}

async function sendMessage(event) {
  event?.preventDefault();
  const input = $("#chat-input");
  const message = input.value.trim();
  if (!message || !providerReady || !userReady || !consentGranted || isBusy) return;
  input.value = "";
  input.style.height = "auto";
  if (!currentConversationId) {
    try { await createConversation(); }
    catch (error) { showNotice(error.message); input.value = message; setAvailability(); return; }
  }
  showWelcome(false);
  addMessage("user", message);
  const assistant = addMessage("assistant", "", { streaming: true });
  const liveText = document.createTextNode("");
  assistant.bubble.replaceChildren(liveText);
  let responseText = "";
  let completed = false;
  abortController = new AbortController();
  setBusy(true);
  showNotice("");
  $("#chat-connection-state").innerHTML = "<i></i> Aura đang phản hồi";
  try {
    const analysis = $("#chat-attach-report").checked ? getFaceReport() : null;
    const response = await api.stream("/api/aura/chat", { conversation_id: currentConversationId, message, ...(analysis ? { analysis } : {}) }, abortController.signal);
    if (!response.ok) {
      let detail = `Yêu cầu không thành công (${response.status}).`;
      try { detail = (await response.json()).detail || detail; } catch { /* Keep generic message. */ }
      const error = new Error(detail);
      error.status = response.status;
      throw error;
    }
    await consumeSSE(response, (eventData) => {
      if (eventData.type === "delta") {
        responseText += eventData.text || "";
        liveText.textContent = responseText;
        assistant.bubble.classList.add("is-streaming");
        scrollToLatest();
      } else if (eventData.type === "done") {
        completed = true;
        currentConversationId = eventData.conversation_id;
        assistant.bubble.classList.remove("is-streaming");
        assistant.bubble.innerHTML = safeMarkdown(responseText);
      } else if (eventData.type === "error") {
        throw new Error(eventData.message || "Aura AI chưa thể trả lời.");
      }
    });
    if (!completed) throw new Error("Kết nối bị ngắt trước khi câu trả lời hoàn tất. Lượt chat chưa được lưu.");
    await refreshConversations();
    const title = conversations.find((item) => item.id === currentConversationId)?.title;
    if (title) $("#chat-current-title").textContent = title;
    $("#chat-connection-state").innerHTML = "<i></i> Sẵn sàng trò chuyện";
  } catch (error) {
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
  } finally {
    abortController = null;
    setBusy(false);
    setAvailability();
    scrollToLatest();
  }
}

function stopGeneration() {
  abortController?.abort();
}

async function deleteCurrentConversation() {
  if (!currentConversationId || isBusy) return;
  const id = currentConversationId;
  try {
    await api.delete(`/api/aura/conversations/${encodeURIComponent(id)}`);
    currentConversationId = null;
    $("#chat-current-title").textContent = "Aura AI";
    renderMessages([]);
    await refreshConversations({ selectLatest: true });
    if (currentConversationId) await openConversation(currentConversationId);
    showToast("Đã xóa hội thoại và tin nhắn của nó.", "success");
  } catch (error) { showToast(error.message, "error"); }
}

async function clearHistory() {
  if (!conversations.length || isBusy || !window.confirm("Xóa toàn bộ lịch sử Aura AI của tài khoản này? Hành động này không thể hoàn tác.")) return;
  try {
    await api.delete("/api/aura/conversations");
    currentConversationId = null;
    conversations = [];
    $("#chat-current-title").textContent = "Aura AI";
    renderMessages([]);
    renderConversationList();
    showToast("Đã xóa toàn bộ lịch sử Aura AI.", "success");
  } catch (error) { showToast(error.message, "error"); }
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
  attachment.innerHTML = '<label><input id="chat-attach-report" type="checkbox" disabled> Đính kèm số đo VisionFace</label><button class="text-link" id="chat-routine" type="button">Gợi ý routine 7 ngày</button><small id="chat-report-state">Phân tích trong Face Lab để đính kèm kết quả. Ảnh không được gửi cho AI.</small>';
  $("#chat-form").prepend(attachment);
  const updateReport = () => {
    const available = Boolean(getFaceReport());
    if (!available) $("#chat-attach-report").checked = false;
    $("#chat-report-state").textContent = available ? "Có báo cáo từ Face Lab trong phiên này. Chỉ số đo được đính kèm khi bạn chọn và gửi tin nhắn." : "Phân tích trong Face Lab để đính kèm kết quả. Ảnh không được gửi cho AI.";
    setAvailability();
  };
  const preparePrompt = (message, attach = false) => {
    $("#chat-input").value = message;
    $("#chat-attach-report").checked = attach && Boolean(getFaceReport());
    $("#chat-input").dispatchEvent(new Event("input", { bubbles: true }));
    $("#chat-input").focus();
  };
  $("#chat-routine").addEventListener("click", () => preparePrompt("Hãy giúp tôi xây dựng routine chăm sóc cơ bản trong 7 ngày. Hỏi về loại da, mục tiêu, thời gian và thói quen hiện tại trước khi cá nhân hóa.", Boolean(getFaceReport())));
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
    else if (isBusy) stopGeneration();
    else {
      loadId++;
      currentConversationId = null;
      renderMessages([]);
    }
  });
  window.addEventListener("auramaxx:consent-changed", (event) => {
    if (event.detail?.purpose === "ai_chat") {
      if (!event.detail.granted) {
        stopGeneration();
        conversations = [];
        currentConversationId = null;
        renderMessages([]);
      }
      if (window.location.hash === "#aura-ai") void loadAccess();
    }
  });
  window.addEventListener("auramaxx:auth-required", () => {
    if (window.location.hash === "#aura-ai") showNotice("Đăng nhập để chat riêng tư và xem lịch sử của bạn.", "Mở My Aura", "my-aura");
  });
  window.addEventListener("auramaxx:auth-changed", () => {
    stopGeneration();
    conversations = [];
    currentConversationId = null;
    renderMessages([]);
    renderConversationList();
    void loadAccess();
  });
  renderConversationList();
  updateReport();
  void loadAccess();
}
