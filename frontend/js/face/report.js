// Presentation and sharing of the existing VisionFace engine's output.
let latestReport = null;
const FIELDS = ["measurement_confidence_score", "overall_harmony_score", "overall_grade", "measurement_quality", "symmetry", "proportions", "nose", "jawline", "skin", "hair", "profile"];

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
    proportions: null,
    eyesBrows: null, nose: null, lips: null,
    jawChin: null, skin: null, fullness: null,
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
  const forehead = proportions.forehead || {};
  const regions = skin.regions || {};
  const section = (title, content, open = false) => `<details class="face-engine-detail"${open ? " open" : ""}><summary>${title}</summary><div>${content}</div></details>`;
  const regionNames = { left_cheek: "Má trái trong ảnh", right_cheek: "Má phải trong ảnh", forehead: "Vùng trán trong ảnh", under_eye_left: "Dưới mắt trái trong ảnh", under_eye_right: "Dưới mắt phải trong ảnh" };
  const skinRegionRows = Object.entries(regions).map(([name, region]) =>
    `<p><b>${escapeText(regionNames[name] || name)}</b></p>${metric("Độ sáng pixel trung vị", region.mean_luminance, " / 255")}${metric("Biến thiên pixel tương đối", region.texture_variation_pct, "%")}${metric("Pixel gần đen", region.shadow_clipped_pct, "%")}${metric("Pixel gần trắng", region.highlight_clipped_pct, "%")}`
  ).join("");
  const symmetryRows = (symmetry.details || []).map(item =>
    `<p><b>${escapeText(item.feature)}</b></p>${metric("Khoảng cách trục trái", item.left_dist_px, " px")}${metric("Khoảng cách trục phải", item.right_dist_px, " px")}${metric("Độ lệch có dấu trái", item.left_offset_px_signed, " px")}${metric("Độ lệch có dấu phải", item.right_offset_px_signed, " px")}${metric("Chênh lệch / bề rộng mặt", item.diff_face_width_pct, "%")}`
  ).join("");
  return [
    section("Sai khác landmark hai bên", prose(symmetry.measurement_status) + metric("Sai khác trung vị / bề rộng mặt", symmetry.median_pair_difference_pct_of_face_width, "%") + metric("Độ nghiêng đường nối tâm mắt", symmetry.eye_tilt_deg, "°") + symmetryRows + prose(symmetry.measurement_note || symmetry.feedback)),
    section("Trán & tỷ lệ trong ảnh", prose(proportions.face_shape_description) + metric("Tỷ lệ dài / rộng của vùng Face Mesh", proportions.length_to_width_ratio) + metric("Rìa Face Mesh đến giữa chân mày", forehead.mesh_top_to_brow_px, " px") + metric("Đoạn trên / chiều cao thấy được", forehead.mesh_top_to_brow_pct_of_visible_height, "%") + metric("Bề ngang vùng thái dương Face Mesh", forehead.temple_width_px, " px") + metric("Tỷ trọng đoạn trên", thirds.upper_third_pct, "%") + metric("Tỷ trọng đoạn giữa", thirds.middle_third_pct, "%") + metric("Tỷ trọng đoạn dưới", thirds.lower_third_pct, "%") + metric("Độ chênh ba đoạn", thirds.spread_pct, "%") + prose(thirds.honest_evaluation) + prose(forehead.note), true),
    section("Mũi · số đo ảnh", metric("Bề ngang cánh mũi", nose.alar_width_px, " px") + metric("Chiều dài gốc đến chân mũi", nose.nose_length_px, " px") + metric("Khoảng cách hai khóe mắt", nose.intercanthal_distance_px, " px") + metric("Bề ngang cánh mũi / chiều dài", nose.width_to_length_ratio) + metric("Bề ngang cánh mũi / khoảng cách khóe mắt", nose.alar_to_intercanthal_ratio) + metric("Lệch có dấu chóp mũi / bề rộng mặt", nose.bridge_offset_face_width_pct_signed, "%") + prose(nose.measurement_note)),
    section("Hàm & cằm", metric("Góc đường viền trái", jawline.jaw_angle_left_deg, "°") + metric("Góc đường viền phải", jawline.jaw_angle_right_deg, "°") + metric("Góc mở đường viền cằm", jawline.chin_apex_angle_deg, "°") + metric("Chiều cao phần dưới mặt trong ảnh", jawline.chin_lower_face_height_pct, "%") + metric("Tỷ lệ bề ngang hàm / má", jawline.jaw_to_cheek_ratio) + prose(jawline.jawline_evaluation) + prose(jawline.measurement_note), true),
    section("Bề mặt da trong ảnh", metric("Số vùng lấy mẫu", skin.measurement_coverage) + metric("Chênh sáng hai má", skin.left_right_cheek_luminance_difference_pct, "%") + metric("Trán so với hai má", skin.forehead_vs_cheek_luminance_difference_pct, "%") + metric("Dưới mắt so với má", skin.under_eye_vs_cheek_luminance_difference_pct, "%") + metric("Biến thiên pixel ở má", skin.cheek_texture_variation_pct, "%") + skinRegionRows + prose(skin.skin_health_evaluation)),
    section("Tóc & gợi ý tạo kiểu", prose(hair.hairline_type) + prose(hair.hair_recommendations?.for_men) + prose(hair.hair_recommendations?.for_women) + prose(hair.hair_recommendations?.stylist_advice)),
    profile ? section("Góc nghiêng · số đo 2D", metric("Góc quay Face Mesh ước tính", profile.pose_yaw_deg, "°") + metric("Nghiêng đầu ước tính", profile.pose_roll_deg, "°") + metric("Môi trên so với đường tham chiếu", profile.ricketts_eline?.upper_lip_offset_pct, "%") + metric("Môi dưới so với đường tham chiếu", profile.ricketts_eline?.lower_lip_offset_pct, "%") + metric("Góc mũi–môi", profile.nasolabial_angle_deg, "°") + metric("Lệch mốc sống mũi giữa", profile.nasal_bridge_profile?.rhinion_offset_pct, "%") + metric("Góc viền hàm trong ảnh", profile.profile_gonial_angle_deg, "°") + prose(profile.ricketts_eline?.reference_name) + prose(profile.measurement_note)) : "",
  ].join("");
}
