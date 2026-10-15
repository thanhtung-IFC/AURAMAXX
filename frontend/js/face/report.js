// Presentation and sharing of the existing VisionFace engine's output.
let latestReport = null;
const FIELDS = ["overall_harmony_score", "overall_grade", "measurement_quality", "symmetry", "proportions", "nose", "jawline", "skin", "hair", "profile"];

export function setFaceReport(report) {
  const privateFields = new Set(["image", "images", "landmarks", "visual_guides", "midline_axis", "snapshot", "name", "user_id", "account_id", "id"]);
  const clean = value => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !privateFields.has(key)).map(([key, item]) => [key, clean(item)]));
    return typeof value === "string" && value.startsWith("data:") ? null : value;
  };
  latestReport = report ? Object.fromEntries(FIELDS.filter(key => key in report).map(key => [key, clean(report[key])])) : null;
  window.dispatchEvent(new CustomEvent("auramaxx:face-report-changed"));
}

export function getFaceReport() { return latestReport; }

export function reportToArenaGroups(report) {
  const pose = report.measurement_quality?.front_pose;
  const unreliable = pose && (Math.abs(pose.yaw_deg) > 10 || Math.abs(pose.roll_deg) > 8 || pose.clipped || pose.face_height_fraction < .25 || Math.min(pose.image_width, pose.image_height) < 320);
  const values = {
    proportions: report.proportions?.rule_of_thirds?.harmony_score,
    eyesBrows: null, nose: report.nose?.nose_aesthetic_score, lips: null,
    jawChin: report.jawline?.jawline_sharpness_score, skin: report.skin?.smoothness_score, fullness: null,
  };
  return Object.entries(values).map(([id, score]) => {
    const measured = Number.isFinite(score) && score >= 0 && score <= 100;
    return { id, score: measured && !unreliable ? score : null, status: unreliable ? "unreliable" : measured ? "complete" : "missing" };
  });
}

export function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

const metric = (label, value, unit = "") => `<div class="face-metric-row"><span>${label}</span><b>${Number.isFinite(value) ? value.toFixed(1) : "Chưa đo"}${Number.isFinite(value) ? unit : ""}</b></div>`;
const prose = value => {
  if (Array.isArray(value)) return value.map(item => `<p>${escapeText(typeof item === "object" ? item.description || item.evaluation || JSON.stringify(item) : item)}</p>`).join("");
  return value ? `<p>${escapeText(value)}</p>` : "";
};

export function renderReportDetails(report) {
  const { symmetry = {}, proportions = {}, nose = {}, jawline = {}, skin = {}, hair = {}, profile } = report;
  const thirds = proportions.rule_of_thirds || {};
  const section = (title, content) => `<details class="face-engine-detail" open><summary>${title}</summary><div>${content}</div></details>`;
  return [
    section("Đối xứng khuôn mặt", metric("Chỉ số đối xứng", symmetry.overall_symmetry_score, " / 100") + metric("Độ nghiêng trục mắt", symmetry.eye_tilt_deg, "°") + prose(symmetry.evaluation) + prose(symmetry.asymmetry_flaws)),
    section("Tỷ lệ & hình dáng", prose(proportions.face_shape_description) + metric("Tỷ lệ dài / rộng", proportions.length_to_width_ratio) + metric("Tầng trên", thirds.upper_third_pct, "%") + metric("Tầng giữa", thirds.middle_third_pct, "%") + metric("Tầng dưới", thirds.lower_third_pct, "%") + prose(thirds.honest_evaluation)),
    section("Mũi", metric("Chỉ số theo phép đo", nose.nose_aesthetic_score, " / 100") + metric("Độ lệch theo chiều rộng mặt", nose.bridge_deviation_face_width_pct, "%") + prose(nose.alar_status) + prose(nose.bridge_comment)),
    section("Hàm & cằm", metric("Góc hàm trung bình", jawline.average_jaw_angle_deg, "°") + metric("Tỷ lệ hàm / má", jawline.jaw_to_cheek_ratio) + metric("Chỉ số viền hàm", jawline.jawline_sharpness_score, " / 100") + prose(jawline.jawline_evaluation) + prose(jawline.chin_flaw)),
    section("Bề mặt da trong ảnh", metric("Độ mịn", skin.smoothness_score, " / 100") + metric("Độ đều màu", skin.uniformity_score, " / 100") + metric("Vùng dưới mắt", skin.dark_circles_index, "%") + metric("Độ bóng", skin.oiliness_score, "%") + prose([skin.skin_tone, skin.undertone].filter(Boolean).join(" · ")) + prose(skin.skin_health_evaluation)),
    section("Tóc & gợi ý tạo kiểu", prose(hair.hairline_type) + prose(hair.hair_recommendations?.for_men) + prose(hair.hair_recommendations?.for_women) + prose(hair.hair_recommendations?.stylist_advice)),
    profile ? section("Góc nghiêng", metric("Góc hàm", profile.profile_gonial_angle_deg, "°") + metric("Góc mũi / môi", profile.nasolabial_angle_deg, "°") + prose(profile.profile_jaw_description) + prose(profile.nasal_bridge_profile?.description)) : "",
  ].join("");
}
