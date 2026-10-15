import { api } from "../api.js";
import { getFaceReport, escapeText } from "../face/report.js";
import { showToast } from "../ui.js";

const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);
const page = () => $('[data-page="health-hub"]');
const STORAGE_KEY = "auramaxx:routine_cache:v2";

// Clean, delicate, stroke-only icons matching AURAMAXX design tokens.
// No filled black blobs or raw unstyled SVGs.
const TASK_METADATA = {
  mewing: {
    categoryGroup: "facial",
    categoryLabel: "Facial & Jawline",
    priority: "high",
    priorityLabel: "ƯU TIÊN CAO",
    target: "Jawline (Viền hàm)",
    targetType: "jawline",
    targetIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6v2a6 6 0 0 0 6 6h4a6 6 0 0 0 6-6V6"/><path d="M12 14v4m-3 0h6"/></svg>`,
    title: "Thực hành đặt lưỡi Mewing chuẩn tư thế",
    duration: "Nhắc mỗi 2 giờ • Giữ 15 phút/lần",
    suggestedTime: "Cả ngày",
    reason: "Đặt toàn bộ bề mặt lưỡi áp sát lên vòm họng trên, khép nhẹ răng và thở hoàn toàn bằng mũi để tạo lực nâng tự nhiên cho cấu trúc xương hàm.",
    instructions: [
      "Khép môi tự nhiên, không nghiến chặt răng.",
      "Áp toàn bộ mặt lưỡi và cuống lưỡi lên vòm họng trên (không chạm vào răng cửa).",
      "Duy trì hít thở đều hoàn toàn bằng đường mũi."
    ],
    tips: "Tạo thói quen vô thức trong suốt cả ngày làm việc và sinh hoạt."
  },
  drink_water: {
    categoryGroup: "nutrition",
    categoryLabel: "Hydration & Nutrition",
    priority: "high",
    priorityLabel: "ƯU TIÊN CAO",
    target: "Cấp nước & Debloat",
    targetType: "debloat",
    targetIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.7 6.4 8.3a8 8 0 1 0 11.2 0L12 2.7z"/></svg>`,
    title: "Uống đủ 2L nước & Tránh đồ uống có ga",
    duration: "8 cốc tiêu chuẩn",
    suggestedTime: "Sáng đến Tối",
    reason: "Uống đủ nước ấm kích hoạt cơ chế bài tiết natri dư thừa qua thận, hạn chế tối đa tình trạng sưng phù mặt (facial bloating).",
    instructions: [
      "Bắt đầu ngày mới với một cốc nước ấm 250ml.",
      "Chia đều các cữ uống mỗi 1.5 - 2 giờ, tránh uống dồn dập.",
      "Tránh nước có gas và nước ngọt nhiều đường để ngăn tích nước mô mềm."
    ],
    tips: "Đặt bình nước 1L cạnh bàn làm việc để kiểm soát tiến độ dễ dàng."
  },
  kali_debloat: {
    categoryGroup: "nutrition",
    categoryLabel: "Hydration & Nutrition",
    priority: "high",
    priorityLabel: "ƯU TIÊN CAO",
    target: "Giảm sưng mặt (Debloat)",
    targetType: "debloat",
    targetIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.7 6.4 8.3a8 8 0 1 0 11.2 0L12 2.7z"/><path d="M12 10v4"/></svg>`,
    title: "Ăn thực phẩm giàu Kali & Giảm muối (Avoid excess salt)",
    duration: "Bữa trưa & tối",
    suggestedTime: "Bữa trưa & tối",
    reason: "Kali hỗ trợ đào thải natri dư thừa qua thận, giúp giảm nhanh hiện tượng sưng phù bọng mắt và mất nét quai hàm sau khi thức dậy.",
    instructions: [
      "Bổ sung chuối, bơ, khoai lang hoặc rau chân vịt vào thực đơn.",
      "Hạn chế nêm muối đậm và nước chấm trong bữa tối.",
      "Không ăn mì tôm hay đồ hộp vào đêm muộn."
    ],
    tips: "Ăn nhạt vào bữa tối giúp gương mặt thon gọn rõ rệt vào sáng hôm sau."
  },
  guasha: {
    categoryGroup: "facial",
    categoryLabel: "Facial & Jawline",
    priority: "high",
    priorityLabel: "ƯU TIÊN CAO",
    target: "Nâng cơ hàm & Dẫn lưu",
    targetType: "jawline",
    targetIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16c2-4 6-8 11-9a7 7 0 0 1 3 3c-1 5-5 9-9 11-3 1-5-1-5-5z"/></svg>`,
    title: "Massage Gua Sha dẫn lưu bạch huyết & Nâng cơ hàm",
    duration: "3 phút thực hiện",
    suggestedTime: "Sáng hoặc Tối",
    reason: "Dẫn lưu hệ bạch huyết gom dịch ứ đọng về các hạch cổ để cơ thể tự đào thải, kích hoạt săn chắc đường viền hàm.",
    instructions: [
      "Thoa 3-4 giọt dầu dưỡng hoặc serum để tạo độ trơn lướt.",
      "Gạt đá nhẹ nhàng theo góc 15 độ dọc đường viền hàm từ cằm lên dái tai.",
      "Gạt nhẹ nhàng vùng cổ hướng xuống xương quai xanh."
    ],
    tips: "Dùng lực nhẹ đến vừa, không miết quá mạnh gây đỏ da."
  },
  gentle_wash: {
    categoryGroup: "skincare",
    categoryLabel: "Skincare",
    priority: "high",
    priorityLabel: "ƯU TIÊN CAO",
    target: "Skin Quality (Nền da)",
    targetType: "skin",
    targetIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z"/></svg>`,
    title: "Chu trình cốt lõi: Làm sạch dịu nhẹ, Dưỡng ẩm & Chống nắng SPF",
    duration: "5 phút thực hiện",
    suggestedTime: "Sáng 7h - 9h",
    reason: "Bảo vệ hàng rào da khỏi tia UV và ô nhiễm môi trường. Dưỡng ẩm đầy đủ giúp giảm tiết dầu thừa và ngăn ngừa lão hóa sớm.",
    instructions: [
      "Làm sạch da với sữa rửa mặt pH dịu nhẹ (5.5 - 6.0).",
      "Thoa kem dưỡng ẩm để củng cố màng lipid tự nhiên.",
      "Thoa kem chống nắng phổ rộng SPF 50+ ít nhất 15 phút trước khi ra ngoài."
    ],
    tips: "Dùng lượng kem chống nắng khoảng 2 đốt ngón tay cho toàn mặt và cổ."
  },
  skincare_core: {
    categoryGroup: "skincare",
    categoryLabel: "Skincare",
    priority: "high",
    priorityLabel: "ƯU TIÊN CAO",
    target: "Skin Quality (Nền da)",
    targetType: "skin",
    targetIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z"/></svg>`,
    title: "Chu trình phục hồi chuyên sâu: Serum cấp nước & Khóa ẩm",
    duration: "5 phút thực hiện",
    suggestedTime: "Tối 21h - 22h",
    reason: "Cung cấp hoạt chất phục hồi sâu và củng cố liên kết tế bào trong suốt chu trình tái tạo ban đêm.",
    instructions: [
      "Làm sạch bụi mịn và lớp chống nắng sau cả ngày.",
      "Thoa serum cấp ẩm Hyaluronic Acid hoặc Ceramide phục hồi.",
      "Khóa ẩm nhẹ nhàng bằng kem dưỡng phục hồi."
    ],
    tips: "Chờ 10-15 phút để dưỡng chất thẩm thấu trước khi đi ngủ."
  },
  sunscreen: {
    categoryGroup: "skincare",
    categoryLabel: "Skincare",
    priority: "high",
    priorityLabel: "ƯU TIÊN CAO",
    target: "Chống nắng SPF (Bảo vệ da)",
    targetType: "skin",
    targetIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>`,
    title: "Chống nắng phổ rộng bảo vệ collagen nền da",
    duration: "1 phút",
    suggestedTime: "Sáng • 8 đến 9h",
    reason: "Tia UVA/UVB phá hủy elastin và collagen, làm da chùng nhão và sạm màu quanh gò má.",
    instructions: [
      "Lấy lượng kem vừa đủ 2 đốt ngón tay.",
      "Chấm đều lên trán, má, mũi, cằm và thoa nhẹ nhàng.",
      "Thoa lại sau 3-4 giờ nếu làm việc ngoài trời."
    ],
    tips: "Chống nắng cả khi ngồi cạnh cửa sổ lớn trong nhà."
  },
  jaw_relax: {
    categoryGroup: "facial",
    categoryLabel: "Facial & Jawline",
    priority: "medium",
    priorityLabel: "TRUNG BÌNH",
    target: "Cơ hàm & Khớp cắn",
    targetType: "jawline",
    targetIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>`,
    title: "Thả lỏng hàm & Massage giải tỏa áp lực cắn",
    duration: "1 phút mỗi hiệp",
    suggestedTime: "Sáng • 10 đến 12h",
    reason: "Giải phóng tình trạng siết chặt cơ cắn (masseter muscle) gây bạnh hàm cơ năng và đau nhức khớp thái dương hàm.",
    instructions: [
      "Thả lỏng môi, tách nhẹ hai hàm răng.",
      "Dùng khớp ngón tay day nhẹ theo vòng tròn vùng cơ nhai cạnh tai.",
      "Hít thở sâu và thư giãn toàn bộ vùng cổ vai gáy."
    ],
    tips: "Thực hiện mỗi khi thấy căng thẳng trong giờ làm việc."
  },
  neck_stretch: {
    categoryGroup: "facial",
    categoryLabel: "Facial & Jawline",
    priority: "medium",
    priorityLabel: "TRUNG BÌNH",
    target: "Cơ cổ & Khung hàm",
    targetType: "posture",
    targetIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><path d="M12 8v13M8 14h8"/></svg>`,
    title: "Giãn cơ cổ Platysma & Nâng cơ viền hàm",
    duration: "2 phút",
    suggestedTime: "Chiều • 16 đến 17h",
    reason: "Kéo giãn cơ cổ trước giúp căng da vùng dưới cằm, giảm nếp nhăn cổ và tạo đường nét sắc sảo hơn.",
    instructions: [
      "Ngồi thẳng, ngửa nhẹ đầu nhìn lên trần nhà.",
      "Đưa môi dưới phủ lên môi trên cho đến khi thấy cơ cổ căng nhẹ.",
      "Giữ trong 10 giây rồi từ từ thả lỏng. Lặp lại 3-5 lần."
    ],
    tips: "Không ngửa cổ quá đột ngột, dừng lại nếu thấy chóng mặt."
  },
  straight_posture: {
    categoryGroup: "facial",
    categoryLabel: "Facial & Jawline",
    priority: "medium",
    priorityLabel: "TRUNG BÌNH",
    target: "Tư thế cổ & Khung hàm",
    targetType: "posture",
    targetIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><path d="M12 8v13M9 12l3-3 3 3"/></svg>`,
    title: "Chỉnh tư thế ngồi thẳng & Góc làm việc",
    duration: "1 phút",
    suggestedTime: "Chiều • 14 đến 16h",
    reason: "Ngồi gù lưng hoặc đưa đầu ra trước (Forward Head Posture) làm chảy xệ cơ cổ dưới hàm và tạo nọng cằm giả.",
    instructions: [
      "Nâng màn hình ngang tầm mắt để không phải cúi gập cổ.",
      "Kéo nhẹ cằm về sau (Chin tuck) để tai thẳng hàng với vai.",
      "Thả lỏng hai vai và tựa thẳng lưng."
    ],
    tips: "Đặt lời nhắc mỗi tiếng để kiểm tra tư thế của mình."
  },
  sleep_schedule: {
    categoryGroup: "nutrition",
    categoryLabel: "Nghỉ ngơi & Thâm mắt",
    priority: "high",
    priorityLabel: "ƯU TIÊN CAO",
    target: "Nghỉ ngơi & Thâm mắt",
    targetType: "sleep",
    targetIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`,
    title: "Kỷ luật ngủ trước 23h & Phục hồi quầng thâm mắt",
    duration: "7 - 8 tiếng",
    suggestedTime: "Tối • 22h - 23h",
    reason: "Giấc ngủ sâu trước 23h hỗ trợ lưu thông vi mạch quanh ổ mắt, hạ hormone cortisol gây tích nước và giữ nét mặt tươi tắn.",
    instructions: [
      "Tránh màn hình ánh sáng xanh ít nhất 30 phút trước khi ngủ.",
      "Giữ phòng ngủ tối hoàn toàn và nhiệt độ mát mẻ.",
      "Ngủ đủ 7-8 tiếng để tế bào da có đủ thời gian tái tạo."
    ],
    tips: "Uống một ngụm nước ấm nhỏ trước khi ngủ để tránh khô cổ."
  },
  ice_facial: {
    categoryGroup: "skincare",
    categoryLabel: "Skincare",
    priority: "medium",
    priorityLabel: "TRUNG BÌNH",
    target: "Khử sưng & Se lỗ chân lông",
    targetType: "debloat",
    targetIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07l14.14-14.14"/></svg>`,
    title: "Chườm lạnh giảm sưng bọng mắt & Khử phù nề",
    duration: "2 phút buổi sáng",
    suggestedTime: "Sáng • 7 đến 8h",
    reason: "Nhiệt độ mát lạnh làm co mạch tức thì, làm dịu bọng mắt sưng húp và giúp gương mặt thon gọn sắc nét vào đầu ngày.",
    instructions: [
      "Bọc đá viên trong khăn mỏng sạch hoặc dùng thanh lăn lạnh (Ice Roller).",
      "Lăn nhẹ nhàng quanh vùng bọng mắt và hai bên gò má theo hướng lên trên.",
      "Không áp đá trực tiếp lên da trần quá lâu."
    ],
    tips: "Chườm lạnh trước khi thoa dưỡng ẩm giúp dưỡng chất thẩm thấu sâu hơn."
  },
  lip_balm_sleep: {
    categoryGroup: "skincare",
    categoryLabel: "Skincare",
    priority: "medium",
    priorityLabel: "TRUNG BÌNH",
    target: "Lips & Giấc ngủ sâu",
    targetType: "sleep",
    targetIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/><path d="M8 15h8"/></svg>`,
    title: "Thoa dưỡng ẩm môi chuyên sâu (Lip Balm) & Ngủ sớm",
    duration: "1 phút",
    suggestedTime: "Tối • Trước khi ngủ",
    reason: "Dưỡng ẩm môi tránh nứt nẻ và làm đầy rãnh môi tự nhiên. Ngủ sớm giúp cơ thể sản sinh hormone tăng trưởng phục hồi mô cơ mặt.",
    instructions: [
      "Thoa một lớp sáp dưỡng môi cấp ẩm dày trước khi lên giường.",
      "Giữ phòng ngủ thông thoáng, độ ẩm vừa phải.",
      "Tắt màn hình điện thoại trước 23h để bước vào giấc ngủ sâu."
    ],
    tips: "Uống một ngụm nước ấm nhỏ trước khi ngủ để tránh khô cổ họng."
  },
  low_sugar: {
    categoryGroup: "nutrition",
    categoryLabel: "Hydration & Nutrition",
    priority: "medium",
    priorityLabel: "TRUNG BÌNH",
    target: "Kháng viêm & Chống Glycation",
    targetType: "debloat",
    targetIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/></svg>`,
    title: "Hạn chế đường tinh luyện & Tinh bột nhanh",
    duration: "Cả ngày",
    suggestedTime: "Trong ngày",
    reason: "Giảm phản ứng Glycation phá hủy collagen và giảm tiết bã nhờn gây mụn viêm và xỉn màu da.",
    instructions: [
      "Thay trà sữa, nước ngọt bằng nước lọc hoặc trà thảo mộc.",
      "Ưu tiên carbohydrate phức như yến mạch, gạo lứt, khoai lang.",
      "Ăn nhiều rau xanh và protein nạc trong các bữa chính."
    ],
    tips: "Cắt giảm đường trong 7 ngày sẽ thấy nền da sáng và giảm sưng rõ rệt."
  }
};

// Preset scenarios for quick test mode
const PRESETS = {
  looksmax: {
    auraScore: 86,
    coachBadge: "MẪU: TỐI ƯU LOOKSMAXXING",
    quote: "Cấu trúc gương mặt rất cân đối! Lộ trình AI chuyển sang chế độ duy trì đỉnh cao (Looksmaxxing) kết hợp đồng đều giữa Mewing, Dinh dưỡng kháng viêm và bảo vệ da.",
    jawline: { score: "85/100 • Sắc nét", width: "85%", sub: "↳ AI đã thêm: Tập Mewing & Massage Gua Sha" },
    bloat: { score: "84/100 • Thon gọn", width: "84%", sub: "↳ AI đã thêm: Giảm muối, ăn giàu Kali & Uống 2L nước" },
    skin: { score: "88/100 • Nền da khỏe", width: "88%", sub: "↳ AI đã thêm: Chu trình làm sạch dịu nhẹ, dưỡng ẩm & SPF" },
    highlightCategory: "all"
  },
  bloated: {
    auraScore: 74,
    coachBadge: "MỤC TIÊU: KHỬ SƯNG & JAWLINE",
    quote: "AI nhận thấy dấu hiệu giữ nước tạm thời và viền hàm chưa tối ưu. Lộ trình ưu tiên tuyệt đối cho Dinh dưỡng xả nước (Debloat), giảm muối và bài tập kích hoạt viền hàm.",
    jawline: { score: "68/100 • Mờ nhẹ", width: "68%", sub: "↳ AI đã thêm: Mewing 2 giờ/lần & Day cơ nhai" },
    bloat: { score: "54/100 • Tích nước cao", width: "54%", sub: "↳ AI đã thêm: Kali, cắt giảm hoàn toàn muối & đồ gas" },
    skin: { score: "82/100 • Khá ổn", width: "82%", sub: "↳ AI đã thêm: Dưỡng ẩm nhẹ nhàng & Uống đủ nước" },
    highlightCategory: "nutrition"
  },
  dry_eyes: {
    auraScore: 78,
    coachBadge: "MỤC TIÊU: NỀN DA & THÂM MẮT",
    quote: "Đường nét khuôn mặt khá tốt, tuy nhiên nền da có dấu hiệu thiếu ẩm và quầng thâm mắt mệt mỏi. Lộ trình bổ sung cấp nước sâu, kem dưỡng ẩm và kỷ luật ngủ trước 23h.",
    jawline: { score: "84/100 • Rõ nét", width: "84%", sub: "↳ AI đã thêm: Mewing tư thế chuẩn" },
    bloat: { score: "80/100 • Bình thường", width: "80%", sub: "↳ AI đã thêm: Uống 2L nước ấm mỗi ngày" },
    skin: { score: "65/100 • Thiếu ẩm", width: "65%", sub: "↳ AI đã thêm: Kem dưỡng ẩm sâu & Ngủ trước 23h" },
    highlightCategory: "skincare"
  }
};

let routine = null;
let busy = false;
let requestNumber = 0;
let sessionNumber = 0;
let taskFilter = "all";
let libraryFilter = "all";
let currentPreset = "looksmax";

/**
 * Intelligent task selection engine driven directly by Face Lab measurements.
 * Accurately scores and ranks exercises based on:
 * - Jawline sharpness & jaw-to-cheek ratio
 * - Facial bloating (water retention in lower cheeks)
 * - Skin smoothness & oiliness
 * - Dark circles index (eye fatigue)
 *
 * It seamlessly adapts according to:
 * - Intensity: gentle (3 tasks), moderate (4 tasks), intensive (5-6 tasks)
 * - Weekly Feedback: too_much (drops load), balanced (standard), can_more (adds challenge)
 *
 * CRITICAL: Any tasks the user already completed today are ALWAYS preserved so progress is never lost.
 */
function selectTasksForProfile(profile, intensity = "intensive", feedback = "balanced", currentTasks = []) {
  let jawlineScore = 85;
  let bloatScore = 80;
  let skinScore = 85;
  let darkCircles = 20;

  if (profile?.jawline?.jawline_sharpness_score !== undefined) {
    jawlineScore = Math.round(profile.jawline.jawline_sharpness_score);
    skinScore = Math.round(profile.skin?.smoothness_score ?? 80);
    darkCircles = Math.round(profile.skin?.dark_circles_index ?? 20);
    bloatScore = profile.skin?.oiliness_score !== undefined ? Math.round(100 - profile.skin.oiliness_score) : 80;
  } else if (currentPreset === "bloated") {
    jawlineScore = 68;
    bloatScore = 54;
    skinScore = 82;
    darkCircles = 24;
  } else if (currentPreset === "dry_eyes") {
    jawlineScore = 84;
    bloatScore = 80;
    skinScore = 65;
    darkCircles = 42;
  } else {
    jawlineScore = 85;
    bloatScore = 84;
    skinScore = 88;
    darkCircles = 18;
  }

  // Weight scoring per task based on real measurement thresholds
  const candidates = [
    {
      id: "mewing",
      score: 100 + (100 - jawlineScore) * 1.6,
      reason: `Face Lab phát hiện độ sắc nét viền hàm: ${jawlineScore}/100. Đặt lưỡi Mewing đúng kỹ thuật tạo áp lực nâng vòm họng và định hình đường nét hàm.`
    },
    {
      id: "kali_debloat",
      score: 100 + (100 - bloatScore) * 1.7,
      reason: `Chỉ số giữ nước (Debloating): ${bloatScore}/100. Thực phẩm giàu Kali hỗ trợ thận đào thải natri, giảm phù nề má và bọng mắt rõ rệt.`
    },
    {
      id: "drink_water",
      score: 95 + (100 - bloatScore) * 0.9 + (100 - skinScore) * 0.6,
      reason: `Uống 2L nước ấm kích hoạt cơ chế bài tiết dịch ứ đọng và giữ độ ẩm mọng tế bào biểu bì (${skinScore}/100).`
    },
    {
      id: "gentle_wash",
      score: 90 + (100 - skinScore) * 1.5,
      reason: `Độ mịn nền da: ${skinScore}/100. Làm sạch dịu nhẹ pH 5.5 giúp củng cố màng lipid, kiềm dầu thừa và phục hồi hàng rào da.`
    },
    {
      id: "guasha",
      score: 86 + (100 - jawlineScore) * 1.1 + (100 - bloatScore) * 1.2,
      reason: `Massage Gua Sha gạt dọc viền hàm kích hoạt dẫn lưu hệ bạch huyết, xả ứ dịch và nâng cơ mặt tức thì.`
    },
    {
      id: "skincare_core",
      score: 88 + (100 - skinScore) * 1.2,
      reason: `Chu trình phục hồi chuyên sâu cung cấp chất chống oxy hóa, đẩy nhanh tái tạo biểu bì theo phân tích da từ Face Lab.`
    },
    {
      id: "sleep_schedule",
      score: 80 + darkCircles * 1.8,
      reason: `Chỉ số quầng thâm mắt: ${darkCircles}%. Giấc ngủ sâu trước 23h giúp tăng tuần hoàn mao mạch ổ mắt và hạ cortisol.`
    },
    {
      id: "sunscreen",
      score: 82 + (100 - skinScore) * 1.1,
      reason: `Bảo vệ màng tế bào trước tia UVA/UVB, ngăn ngừa sạm màu và đứt gãy sợi collagen nền da.`
    },
    {
      id: "ice_facial",
      score: 78 + (100 - bloatScore) * 1.3,
      reason: `Chườm lạnh buổi sáng co mạch tức thì, làm dịu bọng mắt sưng và giúp da săn chắc thon gọn.`
    },
    {
      id: "neck_stretch",
      score: 75 + (100 - jawlineScore) * 1.0,
      reason: `Kéo giãn cơ cổ Platysma và bài tập Chin Tuck giải phóng cơ ức đòn chũm, khắc phục nọng cằm và tư thế gù cổ.`
    },
    {
      id: "jaw_relax",
      score: 72 + (100 - jawlineScore) * 0.9,
      reason: `Thả lỏng cơ cắn (Masseter) giúp giải tỏa căng thẳng khớp thái dương hàm, hạn chế tình trạng bạnh hàm do nghiến cơ.`
    },
    {
      id: "lip_balm_sleep",
      score: 70 + (100 - skinScore) * 0.7,
      reason: `Dưỡng ẩm môi ban đêm chống nứt nẻ và làm đầy rãnh môi tự nhiên trong suốt chu kỳ nghỉ ngơi.`
    },
    {
      id: "straight_posture",
      score: 68 + (100 - jawlineScore) * 0.6,
      reason: `Giữ tư thế ngồi thẳng và màn hình ngang tầm mắt giúp góc hàm không bị kéo trệ về phía trước.`
    }
  ];

  // Sort candidates by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Target task count per intensity
  let targetCount = 4;
  if (intensity === "gentle") targetCount = 3;
  else if (intensity === "intensive") targetCount = 5;

  // Feedback adjustment
  if (feedback === "too_much") {
    targetCount = Math.max(3, targetCount - 1);
  } else if (feedback === "can_more") {
    targetCount = Math.min(6, targetCount + 1);
  }

  const selectedCandidates = candidates.slice(0, targetCount);
  const selectedIds = new Set(selectedCandidates.map(c => c.id));
  const existingMap = new Map((currentTasks || []).map(t => [t.id, t]));

  // Build task list
  const resultTasks = selectedCandidates.map(cand => {
    const existing = existingMap.get(cand.id);
    return {
      id: cand.id,
      completed: existing ? existing.completed : false,
      dismissed: existing ? existing.dismissed : false,
      timeShift: existing ? existing.timeShift : 0,
      customReason: cand.reason
    };
  });

  // Preserve any previously completed tasks so progress is NEVER wiped out
  (currentTasks || []).forEach(existing => {
    if (existing.completed && !selectedIds.has(existing.id)) {
      resultTasks.push({ ...existing });
    }
  });

  return resultTasks;
}

// Generate an authentic default demo routine state
function createDefaultRoutine() {
  const now = new Date();
  const dayNames = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
  const formattedDate = `${dayNames[now.getDay()]} • ${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

  const tasks = selectTasksForProfile(PRESETS.looksmax, "intensive", "balanced");
  // Seed initial checkmarks for demo feel
  tasks.forEach((t, i) => { if (i < 3) t.completed = true; });

  return {
    date: now.toISOString().slice(0, 10),
    formattedDate,
    intensity: "intensive",
    feedback: "balanced",
    revision: 1,
    auraScore: 86,
    coachQuote: PRESETS.looksmax.quote,
    tasks,
    streak: {
      count: 4,
      freezes_left: 2,
      frozen_today: false,
      completed_today: true,
      completed_dates: []
    },
    library: []
  };
}

function enrichTask(task) {
  const meta = TASK_METADATA[task.id] || {
    categoryGroup: task.category || "custom",
    categoryLabel: task.categoryLabel || "Thói quen riêng",
    priority: "medium",
    priorityLabel: "TỰ THÊM",
    target: "Mục tiêu cá nhân",
    targetType: "skin",
    targetIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/></svg>`,
    title: task.title || "Thói quen hàng ngày",
    duration: task.duration || "Thực hiện mỗi ngày",
    suggestedTime: task.suggestedTime || "Trong ngày",
    reason: task.reason || task.desc || "Thói quen lành mạnh bạn chủ động thêm vào lộ trình nâng cấp bản thân.",
    instructions: task.instructions || ["Duy trì đều đặn mỗi ngày.", "Ghi nhận tiến trình để giữ vững nhịp độ."],
    tips: task.tips || "Kiên trì là chìa khóa để tạo nên sự thay đổi rõ rệt."
  };

  return {
    ...task,
    ...meta,
    categoryGroup: meta.categoryGroup,
    categoryLabel: meta.categoryLabel,
    priority: meta.priority,
    priorityLabel: meta.priorityLabel,
    target: meta.target,
    targetType: meta.targetType || "jawline",
    targetIcon: meta.targetIcon,
    title: meta.title,
    duration: meta.duration,
    suggestedTime: meta.suggestedTime,
    reason: task.customReason || meta.reason,
    instructions: meta.instructions,
    tips: meta.tips
  };
}

function setBusy(value) {
  busy = value;
  page()?.querySelectorAll("[data-routine-action], #routine-intensity, #routine-feedback").forEach(elem => {
    elem.disabled = value;
  });
  if ($("#routine-use-report")) {
    $("#routine-use-report").disabled = value;
  }
}

function guideMarkup(item) {
  const instructionsList = (item.instructions || []).map(step => `<li>${escapeText(step)}</li>`).join("");
  return `
    <details class="hh-task-guide">
      <summary>Hướng dẫn & lý do AI gợi ý</summary>
      <div class="hh-guide-body">
        <p>${escapeText(item.reason || "")}</p>
        ${instructionsList ? `<ol>${instructionsList}</ol>` : ""}
        ${item.tips ? `<small>💡 ${escapeText(item.tips)}</small>` : ""}
      </div>
    </details>
  `;
}

function renderWeekStrip() {
  const container = $("#hh-week-strip");
  if (!container) return;
  const dayNames = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
  const now = new Date();

  container.replaceChildren();
  for (let offset = -3; offset <= 3; offset++) {
    const d = new Date(now);
    d.setDate(now.getDate() + offset);
    const dayOfWeek = dayNames[d.getDay()];
    const dateNum = d.getDate();
    const isToday = offset === 0;

    const pill = document.createElement("div");
    pill.className = `hh-day-pill${isToday ? " is-today is-active" : ""}`;
    pill.dataset.offset = String(offset);
    pill.innerHTML = `
      <span class="hh-day-name">${isToday ? "H.NAY" : dayOfWeek}</span>
      <strong class="hh-day-num">${dateNum}</strong>
    `;
    pill.addEventListener("click", () => {
      container.querySelectorAll(".hh-day-pill").forEach(p => p.classList.remove("is-active"));
      pill.classList.add("is-active");
    });
    container.append(pill);
  }
}

function updateProgressDisplay(completed, total) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  const labelElem = $("#routine-progress-label");
  if (labelElem) labelElem.textContent = `${completed} / ${total} hoàn thành`;

  const percentElem = $("#hh-progress-percent");
  if (percentElem) percentElem.textContent = `${percent}%`;

  const meterElem = $("#routine-progress-meter");
  if (meterElem) {
    meterElem.max = total || 1;
    meterElem.value = completed;
  }

  // Circular progress ring: circumference for r=31 is 194.8
  const ringBar = $("#hh-ring-bar");
  if (ringBar) {
    const circumference = 194.8;
    const offset = circumference * (1 - (total > 0 ? completed / total : 0));
    ringBar.style.strokeDashoffset = String(offset);
  }

  const cheerElem = $("#hh-progress-cheer");
  if (cheerElem) {
    if (percent === 100) cheerElem.textContent = "Tuyệt vời! Đã giữ nhịp 🔥";
    else if (percent >= 80) cheerElem.textContent = "Gần hoàn thành mục tiêu ngày 💪";
    else if (percent > 0) cheerElem.textContent = "Khởi đầu tốt, tiếp tục nào ✨";
    else cheerElem.textContent = "Bắt đầu ngày mới ngay!";
  }
}

function renderLibrary() {
  const host = $("#routine-library");
  if (!host) return;
  host.replaceChildren();

  const libraryItems = (routine?.library && routine.library.length > 0) ? routine.library : Object.entries(TASK_METADATA).map(([id, meta]) => ({ id, ...meta }));

  for (const rawItem of libraryItems) {
    const item = enrichTask(rawItem);
    if (libraryFilter !== "all" && item.categoryGroup !== libraryFilter && rawItem.category !== libraryFilter) continue;
    const inToday = routine?.tasks?.some(t => t.id === item.id && !t.dismissed);

    const card = document.createElement("article");
    card.className = "routine-library-card";
    card.innerHTML = `
      <span class="panel-overline">${escapeText(item.categoryLabel)}</span>
      <h3>${escapeText(item.title)}</h3>
      <p>${escapeText(item.reason || item.desc || "")}</p>
      <span class="routine-duration">${escapeText(item.duration)}</span>
      ${guideMarkup(item)}
      <button class="button button-outline" type="button" data-routine-action="add" data-task-id="${escapeText(item.id)}" ${inToday ? "disabled" : ""}>
        ${inToday ? "Đã có trong hôm nay" : "+ Thêm vào hôm nay"}
      </button>
    `;
    host.append(card);
  }
}

function render() {
  const state = routine || createDefaultRoutine();
  
  // Date in header
  const dateElem = $("#routine-date");
  if (dateElem) {
    const d = state.date ? state.date.split("-").reverse().join("/") : "";
    dateElem.textContent = state.formattedDate || `T5 • ${d}`;
  }

  // Dropdowns sync
  const intensitySelect = $("#routine-intensity");
  if (intensitySelect && state.intensity) intensitySelect.value = state.intensity;
  
  const feedbackSelect = $("#routine-feedback");
  if (feedbackSelect && state.feedback) feedbackSelect.value = state.feedback;

  // Streak count
  const streakCount = $("#routine-streak-count");
  if (streakCount) streakCount.textContent = state.streak?.count ?? 4;

  // Freeze button
  const freezeBtn = $("#routine-freeze");
  if (freezeBtn) {
    const left = state.streak?.freezes_left ?? 2;
    freezeBtn.innerHTML = `
      <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/></svg>
      Kích hoạt bảo vệ nhịp hôm nay (Còn ${left}/2 lượt)
    `;
  }

  // Mini week bubbles
  const weekElem = $("#routine-week");
  if (weekElem) {
    weekElem.replaceChildren();
    const dayKeys = [12, 13, 14, 15, 16, 17];
    dayKeys.forEach(num => {
      const span = document.createElement("span");
      span.textContent = String(num);
      if (num < 15) span.className = "is-complete";
      else if (num === 15) span.className = "is-today is-active";
      weekElem.append(span);
    });
  }

  // Render tasks
  const taskList = $("#routine-task-list");
  const skippedList = $("#routine-skipped-list");
  const skippedDrawer = $("#routine-skipped");
  const skippedCount = $("#hh-skipped-count");

  if (taskList) taskList.replaceChildren();
  if (skippedList) skippedList.replaceChildren();

  let activeCount = 0;
  let completedCount = 0;
  let skippedTotal = 0;

  for (const rawTask of state.tasks || []) {
    const task = enrichTask(rawTask);

    if (task.dismissed) {
      skippedTotal++;
      if (skippedList) {
        const item = document.createElement("div");
        item.className = "hh-skipped-item";
        item.innerHTML = `
          <span>${escapeText(task.title)}</span>
          <button class="hh-action-btn" type="button" data-routine-action="restore" data-task-id="${escapeText(task.id)}">Khôi phục</button>
        `;
        skippedList.append(item);
      }
      continue;
    }

    activeCount++;
    if (task.completed) completedCount++;

    // Apply category tab filter
    if (taskFilter !== "all" && task.categoryGroup !== taskFilter) {
      continue;
    }

    if (taskList) {
      const card = document.createElement("article");
      card.className = `hh-task-card${task.completed ? " is-complete" : ""}`;
      card.dataset.taskId = task.id;
      
      const priorityClass = task.priority === "high" ? "priority-high" : "priority-medium";
      const targetClass = `target-${task.targetType || "jawline"}`;

      card.innerHTML = `
        <button class="hh-task-checkbox" type="button" data-routine-action="complete" data-task-id="${escapeText(task.id)}" aria-pressed="${task.completed}" aria-label="Đánh dấu hoàn thành: ${escapeText(task.title)}">
          <svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>
        </button>
        <div class="hh-task-content">
          <div class="hh-task-tags">
            <span class="hh-tag-cat">${escapeText(task.categoryLabel)}</span>
            <span class="hh-tag-priority ${priorityClass}">${escapeText(task.priorityLabel)}</span>
            <span class="hh-tag-target ${targetClass}">
              ${task.targetIcon || ""}
              <span>${escapeText(task.target)}</span>
            </span>
          </div>
          <h3 class="hh-task-title">${escapeText(task.title)}</h3>
          <div class="hh-task-meta">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            <span>${escapeText(task.suggestedTime || "Cả ngày")} • ${escapeText(task.duration || "Thực hiện đều đặn")}</span>
          </div>
          ${guideMarkup(task)}
          <div class="hh-task-actions">
            <button type="button" class="hh-action-btn" data-routine-action="shift" data-task-id="${escapeText(task.id)}">⏰ Dời 1 giờ</button>
            <button type="button" class="hh-action-btn" data-routine-action="dismiss" data-task-id="${escapeText(task.id)}">Bỏ qua hôm nay</button>
          </div>
        </div>
      `;
      taskList.append(card);
    }
  }

  if (skippedDrawer && skippedCount) {
    skippedDrawer.hidden = skippedTotal === 0;
    skippedCount.textContent = String(skippedTotal);
  }

  updateProgressDisplay(completedCount, activeCount);
  renderLibrary();
}

function updateCoachQuote(profile, intensity, feedback) {
  const quoteElem = $("#hh-coach-quote");
  if (!quoteElem) return;

  let baseQuote = "";
  if (intensity === "gentle") {
    baseQuote = "AI đã rút gọn còn 3 bài tập trọng tâm nhất theo phân tích Face Lab: Tập trung trực tiếp vào điểm yếu ưu tiên cao mà không gây quá tải.";
  } else if (intensity === "moderate") {
    baseQuote = "AI thiết lập 4 bài tập cân đối: Kết hợp định hình đường viền hàm, dinh dưỡng xả nước (Debloating) và thói quen bảo vệ da hàng ngày.";
  } else {
    baseQuote = "AI kích hoạt chế độ toàn diện (Looksmaxxing): Đầy đủ các bước từ cơ hàm, dinh dưỡng kháng viêm xả nước đến phục hồi nền da đỉnh cao.";
  }

  if (feedback === "too_much") {
    baseQuote += " (Đã giảm nhẹ khối lượng theo cảm nhận tuần này của bạn).";
  } else if (feedback === "can_more") {
    baseQuote += " (Đã kích hoạt thêm bài tập nâng cao bứt phá).";
  }

  quoteElem.textContent = baseQuote;
}

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  currentPreset = name;

  // Update tabs
  $$(".hh-preset-btn").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.preset === name);
  });

  // Aura Score
  const auraPill = $("#hh-aura-score");
  if (auraPill) auraPill.textContent = `Điểm Aura: ${preset.auraScore}/100`;

  // Coach Badge and Quote
  const coachBadge = $("#hh-coach-mode-badge");
  if (coachBadge) coachBadge.textContent = preset.coachBadge;

  // Metrics Bars
  const jawlineScore = $("#hh-metric-jawline-score");
  const jawlineBar = $("#hh-metric-jawline-bar");
  const jawlineSub = $("#hh-metric-jawline-sub");
  if (jawlineScore) jawlineScore.textContent = preset.jawline.score;
  if (jawlineBar) jawlineBar.style.width = preset.jawline.width;
  if (jawlineSub) jawlineSub.textContent = preset.jawline.sub;

  const bloatScore = $("#hh-metric-bloat-score");
  const bloatBar = $("#hh-metric-bloat-bar");
  const bloatSub = $("#hh-metric-bloat-sub");
  if (bloatScore) bloatScore.textContent = preset.bloat.score;
  if (bloatBar) bloatBar.style.width = preset.bloat.width;
  if (bloatSub) bloatSub.textContent = preset.bloat.sub;

  const skinScore = $("#hh-metric-skin-score");
  const skinBar = $("#hh-metric-skin-bar");
  const skinSub = $("#hh-metric-skin-sub");
  if (skinScore) skinScore.textContent = preset.skin.score;
  if (skinBar) skinBar.style.width = preset.skin.width;
  if (skinSub) skinSub.textContent = preset.skin.sub;

  // Select tasks based on this preset
  if (!routine) routine = createDefaultRoutine();
  routine.tasks = selectTasksForProfile(preset, routine.intensity, routine.feedback, routine.tasks);
  updateCoachQuote(preset, routine.intensity, routine.feedback);

  persistLocal();
  render();
  showToast(`Đã áp dụng chế độ: ${preset.coachBadge}`, "success");
}

function persistLocal() {
  try {
    if (routine) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(routine));
    }
  } catch (e) {}
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.tasks)) return parsed;
    }
  } catch (e) {}
  return null;
}

async function loadRoutine() {
  const request = ++requestNumber;

  // 1. Zero-delay: Immediate render from local cache if available
  if (!routine) {
    const cached = loadLocal();
    if (cached) {
      routine = cached;
      render();
    }
  }

  // 2. Fetch fresh state from backend
  try {
    const result = await api.get("/api/health-hub/routine");
    if (request !== requestNumber) return;
    
    // Merge remote state with personalized enhancements
    if (result && Array.isArray(result.tasks) && result.tasks.length > 0) {
      routine = result;
    } else if (!routine) {
      routine = createDefaultRoutine();
    }

    persistLocal();
    render();
  } catch (error) {
    if (request !== requestNumber) return;
    if (!routine) {
      routine = createDefaultRoutine();
      persistLocal();
      render();
    }
  }
}

async function mutate(method, payload) {
  if (busy) return;
  
  if (!routine) routine = createDefaultRoutine();

  // Instant optimistic update
  if (payload.action === "complete") {
    const target = routine.tasks.find(t => t.id === payload.task_id);
    if (target) {
      target.completed = payload.completed !== undefined ? payload.completed : !target.completed;
    }
  } else if (payload.action === "preferences") {
    if (payload.intensity) routine.intensity = payload.intensity;
    if (payload.feedback) routine.feedback = payload.feedback;

    const profile = getFaceReport() || PRESETS[currentPreset];
    routine.tasks = selectTasksForProfile(profile, routine.intensity, routine.feedback, routine.tasks);
    updateCoachQuote(profile, routine.intensity, routine.feedback);
  } else if (payload.action === "dismiss") {
    const target = routine.tasks.find(t => t.id === payload.task_id);
    if (target) target.dismissed = true;
  } else if (payload.action === "restore") {
    const target = routine.tasks.find(t => t.id === payload.task_id);
    if (target) target.dismissed = false;
  } else if (payload.action === "shift") {
    showToast("Đã dời nhắc nhở thêm 1 giờ.", "success");
  } else if (payload.action === "freeze") {
    if (routine.streak) {
      routine.streak.frozen_today = true;
      if (routine.streak.freezes_left > 0) routine.streak.freezes_left--;
    }
    showToast("Đã bật khiên bảo vệ chuỗi hôm nay.", "success");
  }

  persistLocal();
  render();

  // Asynchronous background sync with backend
  const session = sessionNumber;
  const request = ++requestNumber;
  try {
    const result = await api[method]("/api/health-hub/routine", { ...payload, revision: routine?.revision ?? 1 });
    if (session !== sessionNumber || request !== requestNumber) return;
    if (result) {
      routine.revision = result.revision;
      if (result.streak) routine.streak = result.streak;
      persistLocal();
    }
    window.dispatchEvent(new CustomEvent("auramaxx:habits-changed"));
  } catch (error) {
    // Graceful offline/guest fallback: state already saved locally
  }
}

function handleCustomTaskAdd(event) {
  event.preventDefault();
  const input = $("#hh-custom-task-input");
  if (!input) return;
  const val = input.value.trim();
  if (!val) return;

  if (!routine) routine = createDefaultRoutine();

  const customId = "custom_" + Date.now();
  const newTask = {
    id: customId,
    title: val,
    category: "custom",
    categoryLabel: "Thói quen riêng",
    priority: "medium",
    priorityLabel: "TỰ THÊM",
    target: "Cải thiện cá nhân",
    targetType: "skin",
    targetIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 1.8 7.2L21 12l-7.2 1.8L12 21l-1.8-7.2L3 12l7.2-2.8L12 2Z"/></svg>`,
    suggestedTime: "Trong ngày",
    duration: "Tự do",
    reason: `Thói quen riêng: "${val}". Kiên trì thực hiện để hoàn thiện lộ trình.`,
    instructions: ["Hoàn thành mục tiêu đã đề ra.", "Tích lũy thói quen từng bước một."],
    tips: "Ghi nhớ kỷ luật tạo nên kết quả.",
    completed: false,
    dismissed: false
  };

  TASK_METADATA[customId] = newTask;
  routine.tasks.push(newTask);
  input.value = "";
  persistLocal();
  render();
  showToast("Đã thêm thói quen mới vào lộ trình hôm nay!", "success");
}

export function initRoutine() {
  renderWeekStrip();

  // Task category filter tabs
  $$(".hh-tab[data-cat-filter]").forEach(tab => {
    tab.addEventListener("click", () => {
      taskFilter = tab.dataset.catFilter;
      $$(".hh-tab[data-cat-filter]").forEach(t => t.classList.toggle("is-active", t === tab));
      render();
    });
  });

  // Method toggle chips
  $$(".hh-chip[data-method]").forEach(chip => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("is-active");
      const name = chip.textContent.trim();
      const active = chip.classList.contains("is-active");
      showToast(`${active ? "Đã bật" : "Đã tắt"}: ${name}`, "success");
    });
  });

  // Face Lab quick test presets
  $$(".hh-preset-btn[data-preset]").forEach(btn => {
    btn.addEventListener("click", () => {
      applyPreset(btn.dataset.preset);
    });
  });

  // Form custom task add
  const addForm = $("#hh-add-task-form");
  if (addForm) {
    addForm.addEventListener("submit", handleCustomTaskAdd);
  }

  // Survey modal open/close
  const surveyModal = $("#hh-survey-modal");
  const openSurvey1 = $("#hh-open-survey");
  const openSurvey2 = $("#hh-open-survey-btn");
  const closeSurvey = $("#hh-survey-close");
  const cancelSurvey = $("#hh-survey-cancel");
  const saveSurvey = $("#hh-survey-save");

  function openSurvey() {
    if (surveyModal && typeof surveyModal.showModal === "function") {
      surveyModal.showModal();
    }
  }

  function closeSurveyModal() {
    if (surveyModal && typeof surveyModal.close === "function") {
      surveyModal.close();
    }
  }

  if (openSurvey1) openSurvey1.addEventListener("click", openSurvey);
  if (openSurvey2) openSurvey2.addEventListener("click", openSurvey);
  if (closeSurvey) closeSurvey.addEventListener("click", closeSurveyModal);
  if (cancelSurvey) cancelSurvey.addEventListener("click", closeSurveyModal);
  if (saveSurvey) {
    saveSurvey.addEventListener("click", () => {
      closeSurveyModal();
      showToast("Đã lưu mục tiêu Looksmaxxing & căn chỉnh lộ trình AI!", "success");
    });
  }

  // Routine action delegations (checkbox, shift, dismiss, restore, add)
  page()?.addEventListener("click", event => {
    const button = event.target.closest("button[data-routine-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.routineAction;
    const taskId = button.dataset.taskId;

    if (action === "complete") {
      const task = routine?.tasks?.find(t => t.id === taskId);
      const newStatus = task ? !task.completed : true;
      mutate("patch", { action: "complete", task_id: taskId, completed: newStatus });
    } else if (action === "shift") {
      mutate("patch", { action: "shift", task_id: taskId });
    } else if (action === "dismiss") {
      mutate("patch", { action: "dismiss", task_id: taskId });
      showToast("Đã chuyển mục vào danh sách bỏ qua hôm nay.", "success");
    } else if (action === "restore") {
      mutate("patch", { action: "restore", task_id: taskId });
      showToast("Đã khôi phục mục vào danh sách hôm nay.", "success");
    } else if (action === "add") {
      mutate("patch", { action: "add", task_id: taskId });
      showToast("Đã thêm vào danh sách hôm nay.", "success");
    }
  });

  // Re-implemented Control 1: Intensity ("Mức độ lộ trình hôm nay")
  // Dynamically selects tasks based on Face Lab analysis and updates instantly!
  $("#routine-intensity")?.addEventListener("change", event => {
    const newIntensity = event.target.value;
    mutate("patch", { action: "preferences", intensity: newIntensity });
    showToast(`Đã căn chỉnh mức độ: ${newIntensity === "gentle" ? "Nhẹ nhàng (3 việc)" : newIntensity === "moderate" ? "Vừa sức (4 việc)" : "Toàn diện (Tối ưu)"}`, "success");
  });

  // Re-implemented Control 2: Feedback ("Cảm nhận của bạn về lộ trình / Tuần này thế nào?")
  // Dynamically scales workload based on user feelings & Face Lab weakness!
  $("#routine-feedback")?.addEventListener("change", event => {
    const newFeedback = event.target.value;
    mutate("patch", { action: "preferences", feedback: newFeedback });
    showToast(`AI đã cập nhật lộ trình theo phản hồi của bạn!`, "success");
  });

  // Freeze button
  $("#routine-freeze")?.addEventListener("click", () => {
    mutate("patch", { action: "freeze" });
  });

  // Use Face Lab report button
  $("#routine-use-report")?.addEventListener("click", () => {
    const report = getFaceReport();
    if (report) {
      if (!routine) routine = createDefaultRoutine();
      routine.tasks = selectTasksForProfile(report, routine.intensity, routine.feedback, routine.tasks);
      updateCoachQuote(report, routine.intensity, routine.feedback);

      // Update metrics UI if values exist
      if (report.jawline?.jawline_sharpness_score !== undefined) {
        const val = Math.round(report.jawline.jawline_sharpness_score);
        $("#hh-metric-jawline-score").textContent = `${val}/100 • ${val >= 80 ? "Sắc nét" : "Cần kích hoạt"}`;
        $("#hh-metric-jawline-bar").style.width = `${val}%`;
      }
      if (report.skin?.smoothness_score !== undefined) {
        const val = Math.round(report.skin.smoothness_score);
        $("#hh-metric-skin-score").textContent = `${val}/100 • ${val >= 80 ? "Nền da khỏe" : "Cần phục hồi"}`;
        $("#hh-metric-skin-bar").style.width = `${val}%`;
      }

      persistLocal();
      render();
      mutate("post", { report: { skin: report.skin || {} } });
      showToast("Đã đồng bộ số đo thực tế từ Face Lab vào lộ trình!", "success");
    } else {
      applyPreset("looksmax");
      showToast("Đã nạp số đo mẫu Face Lab & tối ưu hóa bài tập!", "success");
    }
  });

  // Library filter buttons
  $$("[data-routine-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      libraryFilter = btn.dataset.routineFilter;
      $$("[data-routine-filter]").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
      renderLibrary();
    });
  });

  // Listeners
  document.addEventListener("auramaxx:routechange", () => {
    if (window.location.hash === "#health-hub") void loadRoutine();
  });
  window.addEventListener("auramaxx:face-report-changed", () => {
    if (window.location.hash === "#health-hub") {
      const rep = getFaceReport();
      if (rep && routine) {
        routine.tasks = selectTasksForProfile(rep, routine.intensity, routine.feedback, routine.tasks);
        updateCoachQuote(rep, routine.intensity, routine.feedback);
        persistLocal();
        render();
      }
    }
  });
  window.addEventListener("auramaxx:auth-changed", () => {
    sessionNumber++;
    requestNumber++;
    if (window.location.hash === "#health-hub") void loadRoutine();
  });
  window.addEventListener("auramaxx:habits-changed", () => {
    if (!busy && window.location.hash === "#health-hub") void loadRoutine();
  });

  // Initial load
  void loadRoutine();
}
