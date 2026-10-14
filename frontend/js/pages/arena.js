import { api } from "../api.js";
import { showToast } from "../ui.js";
import { getSelectedArenaBot, selectArenaBot } from "../arena/bot-selection.js";

const page = document.querySelector('[data-page="arena"]');
const tabs = [
  ["all", "Toàn hệ thống"],
  ["top", "Top Elo"],
  ["new", "Người chơi mới"],
  ["friends", "Bạn bè"],
];
const botCategoryLabels = {
  proportions: "Tỷ lệ khuôn mặt", eyesBrows: "Mắt & lông mày", nose: "Tỷ lệ mũi",
  lips: "Tỷ lệ môi", jawChin: "Hàm & cằm", skin: "Bề mặt da · ước lượng ảnh",
  fullness: "Độ đầy vùng mặt",
};
let arenaStatus = null;
let profile = null;
let activeTab = "all";
let pageOffset = 0;
let leaderboard = [];
let hasMore = false;
let loadingMore = false;
let bots = [];

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function renderPage() {
  page.innerHTML = `
    <header class="arena-heading page-heading-row">
      <div><div class="eyebrow"><span class="eyebrow-dot"></span> AURAMAXX · COMPETITIVE MODE</div>
        <h1 id="arena-title">AURA FACE <span>ARENA</span></h1>
        <p class="page-lead">Analyze. Compete. Ascend. · Phân tích khuôn mặt, thử thách bản thân và chinh phục bảng xếp hạng.</p>
      </div><span class="arena-live-badge" id="arena-live-badge"><i></i> BETA · MINH BẠCH</span>
    </header>
    <section class="arena-status panel" id="arena-status" role="status"><span class="arena-status-mark">!</span><div><b>Đang kiểm tra chế độ thi đấu…</b><p>Trạng thái được lấy từ backend, không dùng dữ liệu minh họa.</p></div></section>
    <div class="arena-grid">
      <section class="arena-main-column">
        <article class="arena-rank-card panel" id="arena-rank-card"><div class="arena-panel-heading"><div><span class="panel-overline">HỒ SƠ THI ĐẤU</span><h2>Hạng hiện tại</h2></div><span class="arena-rank-icon" id="arena-rank-icon">✦</span></div>
          <div class="arena-profile-skeleton" id="arena-profile-skeleton"><i></i><i></i><i></i></div>
          <div id="arena-profile-content" hidden></div>
        </article>
        <article class="arena-battle-card panel"><div class="arena-panel-heading"><div><span class="panel-overline">1V1 · ELO RANKED</span><h2>Face Battle</h2></div><span class="arena-lock">CHƯA MỞ</span></div>
          <p>Trận xếp hạng PvP chỉ hoạt động khi máy chủ tự xác minh kết quả phân tích. Quy trình xác minh trận PvP chưa hoàn thiện, nên chế độ này chưa tạo đối thủ hoặc thay đổi Elo PvP.</p>
          <div class="arena-battle-actions"><a class="button button-outline" href="#face-lab">Mở Face Lab <span aria-hidden="true">↗</span></a><button class="button button-disabled" type="button" disabled title="Chờ xác minh phân tích phía máy chủ">Tìm trận · chưa khả dụng</button></div>
          <div class="arena-empty-history" id="arena-history"><span class="panel-overline">LỊCH SỬ TRẬN</span><p>Chưa có trận đấu được máy chủ xác nhận.</p></div>
        </article>
        <article class="arena-bot-card panel"><div class="arena-panel-heading"><div><span class="panel-overline">BOT BATTLE · PRACTICE ELO</span><h2>Chọn đối thủ BOT</h2></div><span class="arena-bot-tag">BOT ONLY</span></div>
          <p class="arena-bot-intro">Các đối thủ và điểm số là mô phỏng, không phải người dùng thật. Điểm nhóm Face Lab được gửi để tính trận nhưng chưa được máy chủ xác minh; BOT không ảnh hưởng PvP. Lịch sử chỉ lưu điểm tổng và Elo, không lưu ảnh hoặc landmark. Thu hồi quyền Face Lab sẽ xóa lịch sử BOT.</p>
          <div class="arena-bot-list" id="arena-bot-list" aria-live="polite"><p>Đang tải danh sách BOT…</p></div>
          <div class="arena-bot-selected" id="arena-bot-selected" hidden></div>
          <a class="button button-primary" id="arena-bot-start" href="#face-lab" aria-disabled="true">Chọn BOT để bắt đầu</a>
          <div class="arena-bot-summary" id="arena-bot-summary" hidden></div>
          <div class="arena-empty-history" id="arena-bot-history"><span class="panel-overline">LỊCH SỬ BOT RIÊNG</span><p>Đăng nhập để xem các trận BOT đã lưu.</p></div>
        </article>
      </section>
      <section class="arena-leaderboard panel" aria-labelledby="arena-leaderboard-title"><div class="arena-panel-heading"><div><span class="panel-overline">RANKINGS · ELO</span><h2 id="arena-leaderboard-title">Bảng xếp hạng</h2></div><span class="arena-live-pip" aria-label="Dữ liệu backend"></span></div>
        <div class="arena-tabs" role="tablist" aria-label="Chọn bảng xếp hạng">${tabs.map(([id, label]) => `<button type="button" role="tab" aria-selected="${id === activeTab}" data-arena-tab="${id}">${label}</button>`).join("")}</div>
        <div class="arena-leaderboard-state" id="arena-leaderboard-state" aria-live="polite">Đang tải bảng xếp hạng…</div>
        <ol class="arena-leaderboard-list" id="arena-leaderboard-list"></ol>
        <button class="button button-outline arena-more" id="arena-load-more" type="button" hidden>Tải thêm</button>
      </section>
    </div>
    <aside class="arena-integrity-note"><span>01</span><p>Điểm Face Lab là ước tính hình học trên một khung hình, không phải thước đo vẻ đẹp khách quan. Ảnh không được gửi hoặc lưu bởi Arena.</p></aside>
  `;
  page.querySelectorAll("[data-arena-tab]").forEach((button) => button.addEventListener("click", () => void selectTab(button.dataset.arenaTab)));
  page.querySelector("#arena-load-more").addEventListener("click", () => void loadMore());
  page.querySelector("#arena-bot-start").addEventListener("click", (event) => {
    if (!getSelectedArenaBot()) {
      event.preventDefault();
      showToast("Hãy chọn một BOT trước khi mở Face Lab.", "info");
    }
  });
}

function renderBots() {
  const list = page.querySelector("#arena-bot-list");
  if (!bots.length) {
    list.innerHTML = "<p>Chưa tải được hồ sơ BOT. Hãy tải lại trang.</p>";
    return;
  }
  const selectedId = getSelectedArenaBot();
  list.innerHTML = bots.map((bot) => `
    <article class="arena-bot-item"><button class="arena-bot-option${bot.id === selectedId ? " is-selected" : ""}" type="button" data-select-bot="${escapeHtml(bot.id)}" aria-pressed="${bot.id === selectedId}">
      <span class="arena-bot-avatar" aria-hidden="true">${escapeHtml(bot.avatar)}</span>
      <span class="arena-bot-copy"><b>${escapeHtml(bot.name)} <small>BOT</small></b><span>${escapeHtml(bot.difficulty)} · ${escapeHtml(bot.description)}</span></span>
      <strong>${bot.elo}<small> ELO</small></strong>
    </button><details class="arena-bot-score-preview"><summary>Điểm mô phỏng · xem tiêu chí</summary><div>${Object.entries(bot.scores).map(([id, score]) => `<span>${escapeHtml(botCategoryLabels[id] || id)}<b>${score}</b></span>`).join("")}</div><small>Chưa khả dụng: đối xứng độc lập, hàm riêng và hài hòa tổng thể. BOT không có phép đo Face Lab thật.</small></details></article>`).join("");
  list.querySelectorAll("[data-select-bot]").forEach((button) => button.addEventListener("click", () => {
    const bot = bots.find((item) => item.id === button.dataset.selectBot);
    if (!bot) return;
    selectArenaBot(bot.id, bot);
    const selected = page.querySelector("#arena-bot-selected");
    selected.dataset.botId = bot.id;
    selected.hidden = false;
    selected.textContent = `Đã chọn ${bot.name} · BOT ${bot.elo} Elo. Hãy mở Face Lab và hoàn tất một lần phân tích.`;
    const start = page.querySelector("#arena-bot-start");
    start.textContent = `Phân tích rồi đấu ${bot.name}`;
    start.setAttribute("aria-disabled", "false");
    renderBots();
  }));
}

function renderBotSummary(summary) {
  const node = page.querySelector("#arena-bot-summary");
  if (!node || !summary) return;
  node.hidden = false;
  node.innerHTML = `<span>BOT ELO RIÊNG</span><strong>${summary.elo} ELO</strong><div><b>${summary.wins} thắng</b><b>${summary.losses} thua</b><b>${summary.draws} hòa</b></div><small>${summary.matches_played} trận BOT · không cộng vào PvP</small>`;
}

function renderBotHistory(matches) {
  const node = page.querySelector("#arena-bot-history");
  if (!node) return;
  if (!matches.length) {
    node.innerHTML = '<span class="panel-overline">LỊCH SỬ BOT RIÊNG</span><p>Chưa có trận BOT được lưu.</p>';
    return;
  }
  node.innerHTML = `<span class="panel-overline">LỊCH SỬ BOT RIÊNG</span><ul>${matches.map((match) => `<li><b>${escapeHtml(match.bot_name)} · BOT</b><span>${match.result === "win" ? "Thắng" : match.result === "loss" ? "Thua" : "Hòa"}</span><small>Bạn ${Number(match.player_score).toFixed(1)} : BOT ${Number(match.bot_score).toFixed(1)} · Elo ${match.elo_before} → ${match.elo_after} · ${new Date(match.created_at).toLocaleDateString()}</small></li>`).join("")}</ul>`;
}

function updateStatus(status) {
  const banner = page.querySelector("#arena-status");
  const heading = banner.querySelector("b");
  const detail = banner.querySelector("p");
  if (!status) return;
  if (status.ranked_matches_available) {
    banner.dataset.state = "ready";
    heading.textContent = "Chế độ xếp hạng đã sẵn sàng.";
    detail.textContent = "Backend xác minh phân tích và kết quả trận đấu.";
  } else {
    banner.dataset.state = "limited";
    heading.textContent = "PvP xếp hạng đang chờ máy chủ xác minh; BOT Battle đã mở để luyện tập.";
    detail.textContent = "Elo BOT và lịch sử được lưu riêng; kết quả BOT không cộng/trừ Elo PvP và không vào leaderboard PvP.";
  }
}

function renderProfile() {
  const skeleton = page.querySelector("#arena-profile-skeleton");
  const content = page.querySelector("#arena-profile-content");
  skeleton.hidden = true;
  content.hidden = false;
  if (!profile) {
    content.innerHTML = `<div class="arena-login-state"><b>Đăng nhập để tạo hồ sơ Arena</b><p>Hồ sơ bắt đầu ở 1000 Elo. Tên và thứ hạng chỉ công khai khi bạn chủ động bật lựa chọn bên dưới.</p><a class="button button-primary" href="#my-aura">Mở My Aura để đăng nhập</a></div>`;
    return;
  }
  const rank = profile.rank;
  content.innerHTML = `
    <div class="arena-rank-summary"><div class="arena-rank-name" style="--rank-color:${escapeHtml(rank.color)}"><span>${escapeHtml(rank.name)}</span><strong>${profile.elo}<small> ELO</small></strong></div>
      <div class="arena-rank-progress"><div><span>${escapeHtml(rank.name)}</span><span>${rank.next_rank_elo === null ? "Bậc cao nhất" : `${rank.next_rank_elo} Elo đến bậc tiếp theo`}</span></div><i style="--rank-progress:${rank.progress_percent}%"></i></div>
    </div>
    <div class="arena-stat-grid"><div><strong>${profile.matches_played}</strong><span>Trận</span></div><div><strong>${profile.wins}</strong><span>Thắng</span></div><div><strong>${profile.win_rate}%</strong><span>Tỷ lệ thắng</span></div><div><strong>${profile.highest_elo}</strong><span>Elo cao nhất</span></div></div>
    <form class="arena-profile-form" id="arena-profile-form"><label for="arena-display-name">Tên hiển thị</label><input id="arena-display-name" name="display_name" minlength="2" maxlength="24" value="${escapeHtml(profile.display_name)}" required>
      <label class="arena-public-choice"><input type="checkbox" name="leaderboard_public" ${profile.leaderboard_public ? "checked" : ""}><span><b>Hiển thị hồ sơ trên bảng xếp hạng</b><small>Chỉ công khai tên hiển thị, Elo, rank và thống kê trận. Không công khai email hay ảnh khuôn mặt.</small></span></label>
      <button class="button button-outline" type="submit">Lưu hồ sơ</button><span class="arena-save-message" id="arena-save-message" role="status"></span>
    </form>`;
  content.querySelector("#arena-profile-form").addEventListener("submit", saveProfile);
}

function renderLeaderboard() {
  const state = page.querySelector("#arena-leaderboard-state");
  const list = page.querySelector("#arena-leaderboard-list");
  const loadButton = page.querySelector("#arena-load-more");
  list.replaceChildren();
  loadButton.hidden = !hasMore;
  if (activeTab === "friends") {
    state.hidden = false;
    state.textContent = "Chưa có hệ thống kết bạn. Không có người chơi nào được tạo giả để minh họa.";
    return;
  }
  if (!leaderboard.length) {
    state.hidden = false;
    state.textContent = "Chưa có hồ sơ công khai. Bảng xếp hạng sẽ xuất hiện khi người chơi thật chọn công khai.";
    return;
  }
  state.hidden = true;
  leaderboard.forEach((entry) => {
    const item = document.createElement("li");
    item.className = `arena-player-row${entry.position <= 3 ? ` podium-${entry.position}` : ""}`;
    item.innerHTML = `<span class="arena-position">${entry.position}</span><span class="arena-player-avatar">${escapeHtml(entry.display_name.slice(0, 1).toUpperCase())}</span><span class="arena-player-copy"><b>${escapeHtml(entry.display_name)}</b><small>${escapeHtml(entry.rank.name)} · ${entry.matches_played} trận</small></span><span class="arena-player-rating"><b>${entry.elo}</b><small>ELO</small></span>`;
    list.append(item);
  });
  loadButton.disabled = loadingMore;
  loadButton.textContent = loadingMore ? "Đang tải…" : "Tải thêm";
}

async function fetchLeaderboard(reset = true) {
  if (reset) {
    pageOffset = 0;
    leaderboard = [];
  }
  const state = page.querySelector("#arena-leaderboard-state");
  state.hidden = false;
  state.textContent = "Đang tải dữ liệu từ backend…";
  try {
    const result = await api.get(`/api/arena/leaderboard?tab=${activeTab}&limit=20&offset=${pageOffset}`);
    if (reset) leaderboard = result.entries;
    else leaderboard.push(...result.entries);
    hasMore = result.has_more;
    renderLeaderboard();
    if (!result.available) {
      state.hidden = false;
      state.textContent = "Chưa có hệ thống kết bạn. Không có người chơi nào được tạo giả để minh họa.";
    }
  } catch (error) {
    state.hidden = false;
    state.textContent = `Không tải được bảng xếp hạng: ${error.message}`;
  }
}

async function selectTab(tab) {
  if (!tabs.some(([id]) => id === tab)) return;
  activeTab = tab;
  page.querySelectorAll("[data-arena-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.arenaTab === tab)));
  await fetchLeaderboard();
}

async function loadMore() {
  if (loadingMore || !hasMore) return;
  loadingMore = true;
  pageOffset += 20;
  renderLeaderboard();
  await fetchLeaderboard(false);
  loadingMore = false;
  renderLeaderboard();
}

async function saveProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const message = form.querySelector("#arena-save-message");
  button.disabled = true;
  message.textContent = "Đang lưu…";
  try {
    profile = await api.patch("/api/arena/profile", {
      display_name: form.elements.display_name.value,
      leaderboard_public: form.elements.leaderboard_public.checked,
    });
    renderProfile();
    page.querySelector("#arena-save-message").textContent = "Đã lưu hồ sơ.";
    showToast("Hồ sơ Arena đã được cập nhật.", "success");
    if (activeTab !== "friends") await fetchLeaderboard();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    const currentButton = page.querySelector("#arena-profile-form button[type=submit]");
    if (currentButton) currentButton.disabled = false;
  }
}

async function loadArena() {
  try {
    const result = await api.get("/api/arena/bots");
    bots = result.bots;
    renderBots();
    const selectedId = getSelectedArenaBot();
    const selectedBot = bots.find((bot) => bot.id === selectedId);
    if (selectedBot) {
      const selected = page.querySelector("#arena-bot-selected");
      selected.dataset.botId = selectedBot.id;
      selected.hidden = false;
      selected.textContent = `Đã chọn ${selectedBot.name} · BOT ${selectedBot.elo} Elo. Hãy mở Face Lab và hoàn tất một lần phân tích.`;
      page.querySelector("#arena-bot-start").textContent = `Phân tích rồi đấu ${selectedBot.name}`;
    }
  } catch (error) {
    page.querySelector("#arena-bot-list").innerHTML = `<p>Không tải được danh sách BOT: ${escapeHtml(error.message)}</p>`;
  }
  try {
    arenaStatus = await api.get("/api/arena/status");
    updateStatus(arenaStatus);
  } catch (error) {
    const banner = page.querySelector("#arena-status");
    banner.dataset.state = "error";
    banner.querySelector("b").textContent = "Không kết nối được Arena backend.";
    banner.querySelector("p").textContent = error.message;
  }
  const tasks = [fetchLeaderboard()];
  try {
    profile = await api.get("/api/arena/profile");
    renderProfile();
  } catch (error) {
    profile = null;
    renderProfile();
    if (error.status !== 401) showToast(`Không tải được hồ sơ Arena: ${error.message}`, "error");
    return;
  }
  try {
    const [summary, botMatches] = await Promise.all([
      api.get("/api/arena/bot-matches/summary"),
      api.get("/api/arena/bot-matches/history"),
    ]);
    renderBotSummary(summary);
    renderBotHistory(botMatches);
  } catch (error) {
    if (error.status !== 401) showToast(`Không tải được lịch sử BOT: ${error.message}`, "error");
  }
  try {
    const matches = await api.get("/api/arena/matches/history");
    const history = page.querySelector("#arena-history");
    if (matches.length) history.innerHTML = `<span class="panel-overline">LỊCH SỬ TRẬN</span><p>${matches.length} trận đã được máy chủ ghi nhận.</p>`;
  } catch (error) {
    showToast(`Không tải được lịch sử Arena: ${error.message}`, "error");
  }
  await Promise.all(tasks);
}

export function initArena() {
  renderPage();
  window.addEventListener("auramaxx:auth-changed", () => void loadArena());
  void loadArena();
  document.addEventListener("auramaxx:routechange", (event) => {
    if (event.detail?.route === "arena") void loadArena();
  });
}
