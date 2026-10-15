import { api } from "../api.js";
import { showToast } from "../ui.js";
import { getSelectedArenaBot, selectArenaBot } from "../arena/bot-selection.js";
import { getArenaReadiness, submitArenaBattle } from "../arena/battle.js";
import { renderBotPortrait } from "../arena/portraits.js";

const page = document.querySelector('[data-page="arena"]');
const $ = selector => page.querySelector(selector);
const labels = { proportions: "Tỷ lệ khuôn mặt", eyesBrows: "Mắt & lông mày", nose: "Tỷ lệ mũi", lips: "Tỷ lệ môi", jawChin: "Hàm & cằm", skin: "Bề mặt da trong ảnh", fullness: "Độ đầy vùng mặt", front_view: "Chính diện", left_profile: "Nghiêng trái", right_profile: "Nghiêng phải" };
const resultLabels = { win: "Thắng", loss: "Thua", draw: "Hòa" };
const tabs = [["all", "Tất cả"], ["new", "Người chơi mới"]];
let profile = null, summary = null, bots = [], history = [], leaderboard = [];
let rules = null, activeTab = "all", historyFilter = "all", selectedDifficulty = "all";
let offset = 0, hasMore = false, loadingMore = false, battling = false;
let requestId = 0, controller = null, boardRequest = 0, boardController = null, accountGeneration = 0;
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const number = value => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(Number(value) || 0);
const signed = value => `${value > 0 ? "+" : ""}${number(value)}`;
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;

function renderPage() {
  page.innerHTML = `
    <header class="arena-heading page-heading-row"><div><div class="eyebrow">KHÔNG GIAN LUYỆN TẬP</div><h1 id="arena-title">Face Arena</h1><p class="page-lead">Chọn một thử thách vừa sức. Hiểu từng kết quả. Theo dõi hành trình của bạn.</p></div><button class="button button-outline arena-refresh" data-arena-refresh type="button">${icon("clock")} Làm mới</button></header>
    <section class="arena-overview panel"><div class="arena-overview-copy"><span class="arena-mode-chip">${icon("spark")} BOT PRACTICE</span><h2>Mỗi lần luyện tập,<br><span>một góc nhìn mới.</span></h2><p>Dùng kết quả Face Lab để so sánh từng tiêu chí với 5 đối thủ mô phỏng, từ làm quen đến thử thách.</p><button class="text-link" data-arena-jump type="button">Chọn đối thủ ${icon("arrow")}</button></div><div class="arena-bot-summary" id="arena-bot-summary"></div><div class="arena-overview-mark" aria-hidden="true">${icon("face")}</div></section>
    <div class="arena-stat-grid" data-arena-stats></div>
    <section class="arena-status" id="arena-status" role="status"><span class="arena-status-mark">${icon("info")}</span><div><b>Đang kết nối Arena…</b><p>Chuẩn bị danh sách đối thủ và hồ sơ của bạn.</p></div></section>
      <section class="arena-bot-card panel" aria-labelledby="arena-opponents-title"><div class="arena-panel-heading"><div><span class="panel-overline">01 · CHỌN THỬ THÁCH</span><h2 id="arena-opponents-title">Đối thủ của bạn</h2></div><button class="text-link" data-arena-recommend type="button">${icon("spark")} Gợi ý vừa sức</button></div><p class="arena-section-copy">Mỗi BOT có bộ điểm cố định. Chọn mức phù hợp rồi bắt đầu với kết quả Face Lab của bạn.</p>
      <div class="arena-filters" role="group" aria-label="Lọc độ khó">${[["all", "Tất cả"], ["warmup", "Khởi động"], ["balanced", "Vừa sức"], ["challenge", "Thử thách"]].map(([id, label]) => `<button type="button" data-bot-filter="${id}" aria-pressed="${id === selectedDifficulty}">${label}</button>`).join("")}</div><p class="arena-opponent-order"><span>01 <span aria-hidden="true">→</span> 05</span> <span class="arena-order-label">Thấp đến cao</span><span class="arena-swipe-hint">Vuốt để xem đủ 5 cấp</span></p><div class="arena-bot-list" id="arena-bot-list" aria-live="polite"><p class="arena-empty">Đang tải đối thủ…</p></div><div class="arena-bot-selected" id="arena-bot-selected"></div><div class="arena-match-actions"><button class="button button-primary" id="arena-bot-start" type="button" disabled>Chọn BOT để bắt đầu ${icon("arrow")}</button><a class="button button-outline" href="#face-lab">${icon("camera")} Mở Face Lab</a></div><p class="arena-action-note" data-arena-readiness role="status"></p></section>
    <div class="arena-grid"><div class="arena-main-column">
      <section class="arena-results panel" aria-label="Lịch sử luyện tập"><div class="arena-panel-heading"><div><span class="panel-overline">02 · HÀNH TRÌNH CỦA BẠN</span><h2>Kết quả luyện tập</h2></div><span class="arena-history-count" data-arena-history-count></span></div><div class="arena-filters" role="group" aria-label="Lọc kết quả">${[["all", "Tất cả"], ["win", "Thắng"], ["draw", "Hòa"], ["loss", "Thua"]].map(([id, label]) => `<button type="button" data-history-filter="${id}" aria-pressed="${id === historyFilter}">${label}</button>`).join("")}</div><div class="arena-bot-history" id="arena-bot-history"></div></section>
      <details class="arena-rulebook panel"><summary>${icon("info")} Cách tính điểm & Elo <span aria-hidden="true">+</span></summary><div data-arena-rules><p>Đang tải quy tắc tính điểm…</p></div></details>
    </div><aside class="arena-side-column">
      <section class="arena-rank-card panel"><div class="arena-panel-heading"><div><span class="panel-overline">HỒ SƠ CỦA BẠN</span><h2>Danh tính Arena</h2></div><span class="arena-rank-icon">${icon("shield")}</span></div><div class="arena-profile-skeleton" id="arena-profile-skeleton"><i></i><i></i></div><div id="arena-profile-content" hidden></div></section>
      <section class="arena-leaderboard panel" aria-labelledby="arena-leaderboard-title"><div class="arena-panel-heading"><div><span class="panel-overline">CỘNG ĐỒNG · PVP</span><h2 id="arena-leaderboard-title">Bảng xếp hạng</h2></div>${icon("chart")}</div><p class="arena-section-copy">Hồ sơ công khai của người chơi. Elo luyện tập BOT được lưu riêng.</p><div class="arena-tabs" role="tablist" aria-label="Bảng xếp hạng">${tabs.map(([id, label]) => `<button type="button" role="tab" id="arena-tab-${id}" data-arena-tab="${id}" aria-selected="${id === activeTab}" tabindex="${id === activeTab ? 0 : -1}" aria-controls="arena-board-panel">${label}</button>`).join("")}</div><div id="arena-board-panel" role="tabpanel" aria-labelledby="arena-tab-all" tabindex="0"><div class="arena-leaderboard-state" id="arena-leaderboard-state" role="status"></div><ol class="arena-leaderboard-list" id="arena-leaderboard-list"></ol></div><button class="button button-outline arena-more" id="arena-load-more" type="button" hidden>Tải thêm</button></section>
      <section class="arena-battle-card panel"><div class="arena-panel-heading"><div><span class="panel-overline">CHẾ ĐỘ TIẾP THEO</span><h2>Đấu PvP xếp hạng</h2></div><span class="arena-lock">${icon("lock")} Chưa mở</span></div><p>PvP sẽ mở khi có quy trình xác minh trận đấu. Hiện bạn có thể luyện tập đầy đủ với BOT.</p><div id="arena-history" class="arena-empty-history"></div></section>
    </aside></div><footer class="arena-integrity-note">${icon("shield")}<p>Điểm là chỉ số hình học tham khảo, có thể thay đổi theo góc chụp và ánh sáng. Arena lưu điểm, tiêu chí so sánh và Elo khi bạn đấu BOT; không lưu ảnh hay điểm mốc. Bạn có thể xóa dữ liệu trong My Aura.</p></footer>`;
  page.addEventListener("click", handleClick);
  page.addEventListener("keydown", event => {
    if (!event.target.closest("[data-arena-tab]") || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); const index = tabs.findIndex(([id]) => id === activeTab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    void selectTab(tabs[next][0]); $(`[data-arena-tab="${tabs[next][0]}"]`).focus();
  });
  renderStats(); renderHistory(); renderSelected();
}

function difficulty(bot) { const delta = bot.elo - (summary?.elo ?? 1000); return delta < -200 ? "warmup" : delta > 200 ? "challenge" : "balanced"; }
function scrollTo(selector) { $(selector).scrollIntoView({ behavior: document.documentElement.dataset.reducedMotion === "true" ? "instant" : "smooth", block: "start" }); }
function chooseBot(id, scroll = false) {
  const bot = bots.find(item => item.id === id); if (!bot) return;
  selectArenaBot(bot.id, bot); renderBots(); renderSelected(); if (scroll) scrollTo(".arena-bot-card");
  const option = $(`[data-select-bot="${bot.id}"]`);
  option?.focus({ preventScroll: true });
  const list = $("#arena-bot-list");
  if (option && list.scrollWidth > list.clientWidth) list.scrollTo({ left: option.offsetLeft - list.offsetLeft - (list.clientWidth - option.clientWidth) / 2, behavior: document.documentElement.dataset.reducedMotion === "true" ? "instant" : "smooth" });
}

function renderBots() {
  const selected = getSelectedArenaBot();
  const visible = bots.filter(bot => selectedDifficulty === "all" || difficulty(bot) === selectedDifficulty);
  $("#arena-bot-list").innerHTML = visible.length ? visible.map(bot => {
    const level = bots.findIndex(item => item.id === bot.id) + 1, recommended = bot.id === (summary?.recommended_bot_id ?? "casual");
    return `<button class="arena-bot-option${bot.id === selected ? " is-selected" : ""}" type="button" data-select-bot="${escapeHtml(bot.id)}" aria-pressed="${bot.id === selected}"><span class="arena-bot-topline"><small>BOT · ${String(level).padStart(2, "0")}</small><span class="arena-bot-check">${icon(bot.id === selected ? "check" : "plus")}</span></span>${renderBotPortrait(bot)}<span class="arena-bot-copy"><b>${escapeHtml(bot.name)}</b><span>${escapeHtml(bot.difficulty)}</span></span><span class="arena-bot-rating"><strong>${number(bot.elo)}</strong> Elo</span><span class="arena-bot-level" aria-label="Mức ${level} trên 5">${Array.from({ length: 5 }, (_, i) => `<i${i < level ? ' class="filled"' : ""}></i>`).join("")}</span><span class="arena-bot-hint">${recommended ? "Gợi ý cho bạn" : difficulty(bot) === "warmup" ? "Làm quen nhịp đấu" : difficulty(bot) === "challenge" ? "Thêm thử thách" : "Mức vừa sức"}</span></button>`;
  }).join("") : '<p class="arena-empty">Chưa có BOT ở mức này. Bạn có thể chọn mức khác.</p>';
}

function renderSelected() {
  const bot = bots.find(item => item.id === getSelectedArenaBot()), ready = getArenaReadiness();
  const node = $("#arena-bot-selected"), button = $("#arena-bot-start"); if (!node || !button) return;
  node.dataset.botId = bot?.id ?? "";
  node.innerHTML = bot ? `<div class="arena-selection-heading"><div class="arena-selection-identity">${renderBotPortrait(bot, true)}<div><span class="panel-overline">ĐỐI THỦ ĐÃ CHỌN</span><h3>${escapeHtml(bot.name)} <small>${number(bot.elo)} Elo</small></h3></div></div><span class="arena-selection-score"><b>${number(bot.score)}</b><small>điểm mô phỏng</small></span></div><p class="arena-selection-description">${escapeHtml(bot.description)}</p><details class="arena-bot-score-preview"><summary>Xem tiêu chí & kết quả Face Lab của bạn</summary><div class="arena-score-legend"><span>Bạn</span><span>BOT</span></div>${comparisonRows(ready.groups.length ? ready.groups.map(group => ({ id: group.id, player_score: group.score, bot_score: bot.scores[group.id] })) : Object.entries(bot.scores).map(([id, score]) => ({ id, player_score: null, bot_score: score })))}</details>` : `<div class="arena-selection-empty">${icon("face")}<div><b>Bắt đầu bằng một đối thủ</b><p>Chọn BOT phía trên hoặc dùng gợi ý vừa sức.</p></div></div>`;
  button.disabled = battling || !bot || !ready.eligible || !profile;
  button.setAttribute("aria-disabled", String(button.disabled));
  button.innerHTML = `${battling ? "Đang tính kết quả…" : !bot ? "Chọn BOT để bắt đầu" : !profile ? "Đăng nhập để đấu BOT" : !ready.eligible ? "Cần kết quả Face Lab" : `Đấu với ${escapeHtml(bot.name)}`} ${icon("arrow")}`;
  $("[data-arena-readiness]").innerHTML = !profile ? '<a class="text-link" href="#my-aura">Đăng nhập trong My Aura</a> để lưu Elo và lịch sử luyện tập.' : ready.eligible ? `${icon("check")} Kết quả Face Lab sẵn sàng · ${ready.coverage}% tiêu chí có dữ liệu. Hai bên chỉ so các tiêu chí này.` : ready.hasReport ? `${ready.coverage}% tiêu chí hợp lệ · cần ít nhất 50%. Hãy chụp lại ảnh rõ và nhìn thẳng trong Face Lab.` : "Mở Face Lab và phân tích một ảnh. Kết quả sẽ sẵn sàng tại đây trong phiên này.";
}

function comparisonRows(rows) {
  return `<div class="arena-comparison">${rows.map(row => `<div class="arena-comparison-row"><span>${escapeHtml(labels[row.id] || row.id)}${row.weight_percent ? `<small>${number(row.weight_percent)}%</small>` : ""}</span><div class="arena-comparison-bars" aria-hidden="true"><i class="player" style="--score:${row.player_score ?? 0}%"></i><i class="opponent" style="--score:${row.bot_score}%"></i></div><b>${row.player_score === null ? "—" : number(row.player_score)} <small>/ ${number(row.bot_score)}</small></b></div>`).join("")}</div>`;
}

function renderStats() {
  const values = summary ? [[summary.matches_played, "Trận luyện tập", "chart"], [`${number(summary.win_rate)}%`, "Tỷ lệ thắng", "spark"], [signed(summary.recent_elo_delta), "Elo · 20 trận gần nhất", "arrow"], [summary.highest_elo, "Elo cao nhất", "shield"]] : [["—", "Trận luyện tập", "chart"], ["—", "Tỷ lệ thắng", "spark"], ["—", "Biến động Elo", "arrow"], ["—", "Elo cao nhất", "shield"]];
  $("[data-arena-stats]").innerHTML = values.map(([value, label, glyph]) => `<div><span>${icon(glyph)}</span><strong>${typeof value === "number" ? number(value) : value}</strong><small>${label}</small></div>`).join("");
  const node = $("#arena-bot-summary");
  if (!summary) { node.innerHTML = profile ? '<span class="panel-overline">ELO LUYỆN TẬP</span><strong>—</strong><span class="arena-summary-note">Chưa tải được điểm. Làm mới Arena để thử lại.</span>' : '<span class="panel-overline">ELO LUYỆN TẬP</span><strong>1.000 <small>ELO</small></strong><span class="arena-summary-note">Mức khởi điểm · đăng nhập để lưu hành trình</span>'; return; }
  const rank = summary.rank;
  node.innerHTML = `<div class="arena-summary-top"><span class="panel-overline">ELO LUYỆN TẬP</span><span class="arena-tier">${escapeHtml(rank.name)}</span></div><strong>${number(summary.elo)} <small>ELO</small></strong><div class="arena-rank-progress"><span>${rank.next_rank_elo ? `${number(Math.max(0, rank.next_rank_elo - summary.elo))} Elo đến bậc tiếp theo` : "Đã đạt bậc cao nhất"}</span><progress max="100" value="${rank.progress_percent}" aria-label="Tiến độ bậc luyện tập"></progress></div>${trendChart(summary.elo_trend)}<div class="arena-recent-form" aria-label="Kết quả 10 trận gần nhất">${summary.recent_form.map(result => `<span data-result="${result}" title="${resultLabels[result]}" aria-label="${resultLabels[result]}">${result === "win" ? "T" : result === "loss" ? "B" : "H"}</span>`).join("") || '<small>Trận đầu tiên đang chờ bạn.</small>'}</div>`;
}

function trendChart(values) {
  if (values.length < 2) return "";
  const min = Math.min(...values) - 10, max = Math.max(...values) + 10;
  const points = values.map((value, index) => `${4 + index * 272 / (values.length - 1)},${50 - (value - min) * 44 / (max - min)}`).join(" ");
  return `<svg class="arena-trend" viewBox="0 0 280 58" role="img" aria-label="Elo gần đây từ ${values[0]} đến ${values.at(-1)}"><path d="M4 52H276" class="arena-trend-axis"/><polyline points="${points}" fill="none"/><circle cx="276" cy="${points.split(" ").at(-1).split(",")[1]}" r="3"/></svg>`;
}

function renderHistory() {
  const node = $("#arena-bot-history"); $("[data-arena-history-count]").textContent = `${history.length} trận gần nhất`;
  if (!profile) { node.innerHTML = `<div class="arena-empty">${icon("chart")}<b>Hành trình bắt đầu từ trận đầu tiên</b><p>Đăng nhập để lưu và xem lại kết quả luyện tập.</p></div>`; return; }
  const matches = history.filter(match => historyFilter === "all" || match.result === historyFilter);
  if (!matches.length) { node.innerHTML = `<div class="arena-empty">${icon("chart")}<b>${history.length ? "Chưa có trận ở bộ lọc này" : "Sẵn sàng cho thử thách đầu tiên?"}</b><p>${history.length ? "Thử chọn bộ lọc khác để xem hành trình của bạn." : "Chọn một BOT và dùng kết quả Face Lab để bắt đầu."}</p></div>`; return; }
  node.innerHTML = matches.map(match => `<article class="arena-match-row"><details><summary><span class="arena-result-badge" data-result="${match.result}">${resultLabels[match.result]}</span><span class="arena-match-opponent">${renderBotPortrait({id: match.bot_id}, true)}<span class="arena-match-copy"><b>${escapeHtml(match.bot_name)} <small>BOT</small></b><small>${new Date(match.created_at).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · ${match.coverage}% tiêu chí</small></span></span><span class="arena-match-points">${number(match.player_score)} <small>/ ${number(match.bot_score)}</small></span><span class="arena-match-delta">${signed(match.elo_delta)}<small>Elo</small></span></summary><div class="arena-match-detail"><div class="arena-score-legend"><span>Bạn</span><span>BOT</span></div>${match.scoring?.comparison ? comparisonRows(match.scoring.comparison) : '<p>Trận cũ chỉ lưu điểm tổng và Elo.</p>'}<p>${match.scoring ? `Chênh lệch trong ${number(match.scoring.draw_margin)} điểm tính hòa · K điều chỉnh ${number(match.scoring.effective_k)} · ${escapeHtml(match.scoring.mode === "three_views" ? "Ba góc nhìn, trọng số bằng nhau" : "Chỉ so các tiêu chí cùng có dữ liệu")}.` : "Quy tắc tại thời điểm diễn ra trận được giữ nguyên."}</p><div class="arena-match-detail-footer"><span>${number(match.elo_before)} → ${number(match.elo_after)} Elo</span><button type="button" class="text-link" data-rematch-bot="${escapeHtml(match.bot_id)}">Chọn lại đối thủ ${icon("arrow")}</button></div></div></details></article>`).join("");
}

function renderRules() {
  if (!rules) return;
  $("[data-arena-rules]").innerHTML = `<ol><li><b>Cùng tiêu chí, cùng trọng số.</b> Chỉ dùng tiêu chí bạn có số đo hợp lệ; trọng số hai bên được chuẩn hóa lại trên cùng tập tiêu chí.</li><li><b>Chênh lệch nhỏ được tính hòa.</b> Khoảng cách không quá ${number(rules.draw_margin)} điểm là hòa. Cần tối thiểu ${rules.min_coverage}% tiêu chí có dữ liệu.</li><li><b>Elo theo mức thử thách.</b> K = ${rules.new_player_k} trong ${rules.placement_matches} trận đầu, sau đó K = ${rules.standard_k}. K được nhân với tỷ lệ tiêu chí có dữ liệu để giảm biến động khi phép đo chưa đầy đủ.</li><li><b>Mỗi kết quả chỉ ghi nhận một lần với từng BOT.</b> Gửi lại trận từ Arena hoặc Face Lab trong cùng phiên sẽ trả lại kết quả đã lưu. Phân tích ảnh mới để tạo lượt luyện tập tiếp theo.</li></ol><div class="arena-weight-list">${Object.entries(rules.weights).map(([id, weight]) => `<span>${labels[id]}<b>${Math.round(weight * 100)}%</b></span>`).join("")}</div><p>Đây là quy tắc luyện tập của AURAMAXX, không phải chuẩn đánh giá vẻ đẹp. BOT là đối thủ mô phỏng; bảng xếp hạng PvP tách riêng.</p>`;
}

function renderProfile() {
  $("#arena-profile-skeleton").hidden = true; const node = $("#arena-profile-content"); node.hidden = false;
  if (!profile) { node.innerHTML = '<div class="arena-login-state"><b>Lưu hành trình của riêng bạn</b><p>Đăng nhập để lưu kết quả, theo dõi Elo và chọn tên hiển thị.</p><a class="button button-outline" href="#my-aura">Đăng nhập trong My Aura ↗</a></div>'; return; }
  node.innerHTML = `<div class="arena-profile-identity"><span class="arena-player-avatar">${escapeHtml(profile.display_name.slice(0, 1).toUpperCase())}</span><div><b>${escapeHtml(profile.display_name)}</b><small>${profile.leaderboard_public ? "Hồ sơ PvP công khai" : "Hồ sơ PvP riêng tư"}</small></div></div><div class="arena-pvp-mini"><span>PvP · ${escapeHtml(profile.rank.name)}</span><b>${number(profile.elo)} Elo</b></div><details class="arena-profile-settings"><summary>Chỉnh sửa hồ sơ & quyền hiển thị</summary><form class="arena-profile-form" id="arena-profile-form"><label for="arena-display-name">Tên hiển thị</label><input id="arena-display-name" name="display_name" minlength="2" maxlength="24" value="${escapeHtml(profile.display_name)}" required autocomplete="nickname"><label class="arena-public-choice"><input type="checkbox" name="leaderboard_public" ${profile.leaderboard_public ? "checked" : ""}><span><b>Hiện trên bảng xếp hạng PvP</b><small>Công khai tên, bậc và thống kê PvP. Lịch sử BOT được giữ riêng.</small></span></label><button class="button button-outline" type="submit">Lưu hồ sơ</button><span class="arena-save-message" id="arena-save-message" role="status"></span></form></details>`;
  $("#arena-profile-form").addEventListener("submit", saveProfile);
}

function renderLeaderboard() {
  const state = $("#arena-leaderboard-state"), list = $("#arena-leaderboard-list"), button = $("#arena-load-more");
  button.hidden = !hasMore; button.disabled = loadingMore; button.textContent = loadingMore ? "Đang tải…" : "Tải thêm"; state.hidden = Boolean(leaderboard.length);
  if (!leaderboard.length) state.innerHTML = `${icon("chart")}<b>Chưa có hồ sơ công khai</b><p>Bạn có thể chọn công khai hồ sơ trong phần Danh tính Arena.</p>`;
  list.innerHTML = leaderboard.map(entry => `<li class="arena-player-row"><span class="arena-position">${entry.position}</span><span class="arena-player-avatar">${escapeHtml(entry.display_name.slice(0, 1).toUpperCase())}</span><span class="arena-player-copy"><b>${escapeHtml(entry.display_name)}</b><small>${escapeHtml(entry.rank.name)} · ${entry.matches_played} trận PvP</small></span><span class="arena-player-rating"><b>${number(entry.elo)}</b><small>Elo</small></span></li>`).join("");
}

async function fetchLeaderboard(reset = true) {
  const id = ++boardRequest; boardController?.abort(); boardController = new AbortController(); const nextOffset = reset ? 0 : offset + 20;
  if (reset) { leaderboard = []; offset = 0; hasMore = false; }
  $("#arena-leaderboard-state").hidden = false; $("#arena-leaderboard-state").textContent = "Đang tải bảng xếp hạng…"; $("#arena-load-more").hidden = true;
  try {
    const result = await api.get(`/api/arena/leaderboard?tab=${activeTab}&limit=20&offset=${nextOffset}`, { signal: boardController.signal });
    if (id !== boardRequest) return;
    offset = nextOffset; leaderboard = reset ? result.entries : [...leaderboard, ...result.entries]; hasMore = result.has_more; renderLeaderboard();
  } catch (error) { if (id === boardRequest) { $("#arena-leaderboard-state").hidden = false; $("#arena-leaderboard-state").textContent = error.message; $("#arena-load-more").hidden = !hasMore; } }
}

async function selectTab(tab) {
  if (!tabs.some(([id]) => id === tab)) return; activeTab = tab; loadingMore = false;
  page.querySelectorAll("[data-arena-tab]").forEach(button => { button.setAttribute("aria-selected", String(button.dataset.arenaTab === tab)); button.tabIndex = button.dataset.arenaTab === tab ? 0 : -1; });
  $("[role=tabpanel]").setAttribute("aria-labelledby", `arena-tab-${tab}`); await fetchLeaderboard();
}

async function saveProfile(event) {
  event.preventDefault(); const form = event.currentTarget, before = accountGeneration;
  form.querySelector("button").disabled = true; $("#arena-save-message").textContent = "Đang lưu…";
  try {
    const updated = await api.patch("/api/arena/profile", { display_name: form.elements.display_name.value, leaderboard_public: form.elements.leaderboard_public.checked });
    if (before !== accountGeneration) return; profile = updated; renderProfile(); $(".arena-profile-settings").open = true;
    $("#arena-save-message").textContent = "Đã lưu hồ sơ."; await fetchLeaderboard();
  } catch (error) { if (before === accountGeneration && form.isConnected) $("#arena-save-message").textContent = error.message; }
  finally { if (before === accountGeneration && form.isConnected) form.querySelector("button").disabled = false; }
}

async function battle() {
  if (battling || !profile || !getArenaReadiness().eligible) return; const before = accountGeneration; battling = true; renderSelected();
  try {
    const match = await submitArenaBattle(); if (before !== accountGeneration) return;
    showToast(`${resultLabels[match.result]} · ${signed(match.elo_delta)} Elo${match.replayed ? " · kết quả đã lưu" : ""}`, "success");
    await loadArena(); if (before === accountGeneration && !page.hidden) scrollTo(".arena-results");
  } catch (error) { if (before === accountGeneration) showToast(error.message, "error"); }
  finally { if (before === accountGeneration) { battling = false; renderSelected(); } }
}

async function handleClick(event) {
  const button = event.target.closest("button"); if (!button) return;
  if (button.dataset.selectBot) chooseBot(button.dataset.selectBot);
  if (button.dataset.rematchBot) { selectedDifficulty = "all"; updateFilters("bot", "all"); chooseBot(button.dataset.rematchBot, true); }
  if (button.hasAttribute("data-arena-jump")) scrollTo(".arena-bot-card");
  if (button.hasAttribute("data-arena-recommend")) { selectedDifficulty = "all"; updateFilters("bot", "all"); chooseBot(summary?.recommended_bot_id ?? "casual"); showToast("Đã chọn BOT có Elo gần mức luyện tập của bạn.", "info"); }
  if (button.dataset.botFilter) { selectedDifficulty = button.dataset.botFilter; updateFilters("bot", selectedDifficulty); renderBots(); }
  if (button.dataset.historyFilter) { historyFilter = button.dataset.historyFilter; updateFilters("history", historyFilter); renderHistory(); }
  if (button.dataset.arenaTab) await selectTab(button.dataset.arenaTab);
  if (button.hasAttribute("data-arena-refresh")) await loadArena();
  if (button.id === "arena-bot-start") await battle();
  if (button.id === "arena-load-more" && !loadingMore && hasMore) { const tab = activeTab; loadingMore = true; renderLeaderboard(); await fetchLeaderboard(false); if (tab === activeTab) { loadingMore = false; renderLeaderboard(); } }
}

function updateFilters(kind, selected) { page.querySelectorAll(`[data-${kind}-filter]`).forEach(button => button.setAttribute("aria-pressed", String(button.dataset[`${kind}Filter`] === selected))); }

async function loadArena() {
  if (window.location.hash !== "#arena") return; const id = ++requestId; controller?.abort(); controller = new AbortController(); const options = { signal: controller.signal };
  $("[data-arena-refresh]").disabled = true;
  const results = await Promise.allSettled([api.get("/api/arena/bots", options), api.get("/api/arena/status", options), api.get("/api/arena/profile", options), api.get("/api/arena/bot-matches/summary", options), api.get("/api/arena/bot-matches/history", options), fetchLeaderboard()]);
  if (id !== requestId) return; $("[data-arena-refresh]").disabled = false;
  if (results[0].status === "fulfilled") { bots = [...results[0].value.bots].sort((a, b) => a.elo - b.elo); rules = results[0].value.rules; } else $("#arena-bot-list").innerHTML = `<p class="arena-empty">${escapeHtml(results[0].reason.message)}</p>`;
  profile = results[2].status === "fulfilled" ? results[2].value : null; summary = results[3].status === "fulfilled" ? results[3].value : null; history = results[4].status === "fulfilled" ? results[4].value : [];
  const banner = $("#arena-status"); banner.dataset.state = results[1].status === "fulfilled" ? "ready" : "error";
  banner.querySelector("b").textContent = results[1].status === "fulfilled" ? "BOT luyện tập đã sẵn sàng" : "Arena chưa kết nối được";
  banner.querySelector("p").textContent = results[1].status === "fulfilled" ? "Elo và lịch sử BOT được lưu riêng. PvP xếp hạng chưa mở." : results[1].reason.message;
  renderProfile(); renderStats(); renderHistory(); renderRules(); if (results[0].status === "fulfilled") renderBots(); renderSelected();
  if (results[2].status === "rejected" && results[2].reason.status !== 401) $("#arena-profile-content").innerHTML = `<div class="arena-login-state"><b>Chưa tải được hồ sơ</b><p>${escapeHtml(results[2].reason.message)}</p><button type="button" class="button button-outline" data-arena-refresh>Thử lại</button></div>`;
  if (profile && results[4].status === "rejected") $("#arena-bot-history").textContent = `Chưa tải được lịch sử: ${results[4].reason.message}`;
}

function cancelArena() { requestId++; boardRequest++; controller?.abort(); boardController?.abort(); const refresh = $("[data-arena-refresh]"); if (refresh) refresh.disabled = false; }
function clearPrivateArena() { accountGeneration++; battling = false; profile = null; summary = null; history = []; renderProfile(); renderStats(); renderHistory(); renderSelected(); }
export function initArena() {
  renderPage();
  window.addEventListener("auramaxx:auth-changed", () => { cancelArena(); clearPrivateArena(); void loadArena(); });
  window.addEventListener("auramaxx:consent-changed", event => { if (event.detail?.purpose === "face_analysis" && !event.detail.granted) { cancelArena(); clearPrivateArena(); void loadArena(); } });
  window.addEventListener("auramaxx:face-report-changed", renderSelected);
  window.addEventListener("auramaxx:arena-refresh", () => { void loadArena(); });
  window.addEventListener("auramaxx:arena-match-saved", () => { if (!battling) void loadArena(); });
  document.addEventListener("auramaxx:routechange", event => { if (event.detail?.route === "arena") void loadArena(); else cancelArena(); });
  void loadArena();
}
