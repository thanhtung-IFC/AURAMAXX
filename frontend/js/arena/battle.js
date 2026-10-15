import { api } from "../api.js";
import { getFaceReport, reportToArenaGroups, setFaceReport } from "../face/report.js";
import { PROFILE_CONFIG } from "../face/profile-config.js";
import { getSelectedArenaBotProfile } from "./bot-selection.js";

let reportReference = null;
let generation = 0;
const attempts = new Map();

function reset() { generation++; reportReference = null; attempts.clear(); }
window.addEventListener("auramaxx:auth-changed", () => { reset(); setFaceReport(null); });
window.addEventListener("auramaxx:face-report-changed", reset);
window.addEventListener("auramaxx:consent-changed", event => {
  if (event.detail?.purpose === "face_analysis" && !event.detail.granted) { reset(); setFaceReport(null); }
});

export function getArenaReadiness() {
  const report = getFaceReport();
  const groups = report ? reportToArenaGroups(report) : [];
  const coverage = groups.reduce((sum, group) => sum + (group.score === null ? 0 : PROFILE_CONFIG.overallWeights[group.id]), 0);
  return { hasReport: Boolean(report), groups, coverage, eligible: coverage >= 50 };
}

export async function submitArenaBattle() {
  const bot = getSelectedArenaBotProfile();
  const report = getFaceReport();
  const readiness = getArenaReadiness();
  if (!bot) throw new Error("Hãy chọn một đối thủ BOT.");
  if (!readiness.eligible) throw new Error("Cần kết quả Face Lab có ít nhất 50% tiêu chí hợp lệ. Hãy phân tích lại ảnh rõ, nhìn thẳng.");
  if (reportReference !== report) { reset(); reportReference = report; }
  let attempt = attempts.get(bot.id);
  if (!attempt) {
    attempt = { payload: { request_id: crypto.randomUUID(), bot_id: bot.id, groups: readiness.groups }, pending: null, result: null };
    attempts.set(bot.id, attempt);
  }
  if (attempt.result) return { ...attempt.result, replayed: true };
  if (attempt.pending) return attempt.pending;
  const before = generation;
  attempt.pending = api.post("/api/arena/bot-matches", attempt.payload).then(match => {
    if (before !== generation) throw new Error("Kết quả đã thay đổi. Hãy chọn lại trận luyện tập.");
    attempt.result = match;
    window.dispatchEvent(new CustomEvent("auramaxx:arena-match-saved"));
    return match;
  }).finally(() => { attempt.pending = null; });
  return attempt.pending;
}
