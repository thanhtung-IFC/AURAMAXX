/* Text-only chat; report and conversation live only in this page's memory. */
(() => {
  const root = document.createElement('aside');
  root.className = 'vision-chat';
  root.innerHTML = `
    <button id="chatToggle" class="chat-toggle" type="button" aria-controls="chatPanel" aria-expanded="false">✦ Tư vấn AI</button>
    <section id="chatPanel" class="chat-panel" aria-label="Tư vấn kết quả khuôn mặt" hidden>
      <header class="chat-header"><div><strong>Trợ lý VisionFace</strong><small>Giải thích kết quả · Gợi ý phù hợp</small></div>
        <button id="chatClose" type="button" aria-label="Đóng khung chat">×</button></header>
      <p class="chat-notice">Câu hỏi và kết quả bạn chọn đính kèm được gửi đến Google Gemini. Không gửi ảnh khuôn mặt. Tư vấn mang tính tham khảo.</p>
      <label class="chat-context"><input id="chatAttach" type="checkbox" checked> Đính kèm kết quả gần nhất</label>
      <p id="chatContextStatus" class="chat-context-status">Chưa có kết quả phân tích.</p>
      <div id="chatMessages" class="chat-messages" role="log" aria-live="polite" aria-relevant="additions"></div>
      <div class="chat-suggestions"><button type="button">Giải thích kết quả của tôi</button><button type="button">Gợi ý kiểu tóc phù hợp</button></div>
      <p id="chatStatus" class="chat-status" role="status"></p>
      <form id="chatForm" class="chat-form">
        <label for="chatInput" class="chat-sr-only">Câu hỏi của bạn</label>
        <textarea id="chatInput" maxlength="2000" rows="2" placeholder="Bạn muốn tìm hiểu điều gì?" required></textarea>
        <button id="chatSend" type="submit">Gửi</button>
      </form>
      <button id="chatClear" class="chat-clear" type="button">Xóa cuộc trò chuyện</button>
    </section>`;
  document.body.append(root);
  const find = id => root.querySelector('#' + id);
  const toggle = find('chatToggle'), panel = find('chatPanel'), input = find('chatInput');
  const messages = find('chatMessages'), status = find('chatStatus'), attach = find('chatAttach');
  let analysis = null, history = [], controller = null, revision = 0;
  const fields = ['overall_harmony_score', 'overall_grade', 'measurement_quality', 'symmetry',
    'proportions', 'nose', 'jawline', 'skin', 'hair', 'profile'];
  function append(role, text) {
    const message = document.createElement('div');
    message.className = 'chat-message chat-message-' + role;
    const label = document.createElement('strong');
    label.textContent = role === 'user' ? 'Bạn' : 'VisionFace';
    const content = document.createElement('p');
    content.textContent = text;
    message.append(label, content);
    messages.append(message);
    messages.scrollTop = messages.scrollHeight;
  }
  function busy(value) {
    find('chatSend').disabled = value;
    input.disabled = value;
    root.querySelectorAll('.chat-suggestions button').forEach(button => { button.disabled = value; });
    find('chatForm').setAttribute('aria-busy', String(value));
  }
  function reset() {
    revision++;
    if (controller) controller.abort();
    controller = null;
    history = [];
    messages.replaceChildren();
    append('model', 'Chào bạn! Tôi có thể giải thích kết quả phân tích và gợi ý cách tạo kiểu phù hợp. Bạn muốn tìm hiểu điều gì?');
    status.textContent = '';
    busy(false);
  }
  function contextStatus() {
    find('chatContextStatus').textContent = !attach.checked ? 'Không đính kèm kết quả.' :
      analysis ? 'Sẽ đính kèm kết quả phân tích gần nhất.' : 'Chưa có kết quả. Bạn có thể hỏi chung hoặc phân tích khuôn mặt trước.';
  }
  window.VisionChat = {
    setAnalysis(report) {
      // Switching reports also clears history so advice cannot refer to an earlier face.
      analysis = report ? Object.fromEntries(fields.filter(key => key in report).map(key => [key, report[key]])) : null;
      reset();
      contextStatus();
    }
  };
  function open(value) {
    panel.hidden = !value;
    toggle.setAttribute('aria-expanded', String(value));
    if (value) input.focus(); else toggle.focus();
  }
  toggle.addEventListener('click', () => open(panel.hidden));
  find('chatClose').addEventListener('click', () => open(false));
  root.addEventListener('keydown', event => { if (event.key === 'Escape') open(false); });
  find('chatClear').addEventListener('click', reset);
  attach.addEventListener('change', () => { reset(); contextStatus(); });
  root.querySelectorAll('.chat-suggestions button').forEach(button => {
    button.addEventListener('click', () => { input.value = button.textContent; find('chatForm').requestSubmit(); });
  });
  find('chatForm').addEventListener('submit', async event => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || controller) return;
    const currentRevision = revision;
    const requestController = new AbortController();
    controller = requestController;
    const timeout = setTimeout(() => requestController.abort(), 55000);
    append('user', message);
    input.value = '';
    busy(true);
    status.textContent = 'Đang trả lời…';
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: history.slice(-12), analysis: attach.checked ? analysis : null }),
        signal: requestController.signal
      });
      const result = await response.json();
      if (!response.ok || !result.success || typeof result.reply !== 'string') {
        throw new Error(result.message || 'Chưa nhận được câu trả lời. Vui lòng thử lại.');
      }
      if (revision !== currentRevision) return;
      history.push({ role: 'user', text: message }, { role: 'model', text: result.reply });
      history = history.slice(-12);
      append('model', result.reply);
      status.textContent = '';
    } catch (error) {
      if (revision !== currentRevision) return;
      status.textContent = error.name === 'AbortError' ? 'Chờ phản hồi quá lâu. Bạn hãy thử lại.' : error.message;
      input.value = message;
    } finally {
      clearTimeout(timeout);
      if (revision === currentRevision) { controller = null; busy(false); if (!panel.hidden) input.focus(); }
    }
  });
  reset();
  contextStatus();
})();
