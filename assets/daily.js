/**
 * VisionFace - Module Hằng Ngày (Daily Routine & Duolingo-style Streak Engine)
 * Xử lý:
 * 1. Khóa/Mở khóa tính năng Hằng ngày khi quét mặt lần đầu.
 * 2. Lưu trữ và phân tích báo cáo thống kê khuôn mặt gần nhất.
 * 3. Đưa ra bài tập phù hợp theo mục tiêu (Nhẹ nhàng, Vừa, Chuyên sâu) dựa trên số đo sinh trắc học.
 * 4. Chuỗi giữ lửa (Streak) phong cách Duolingo, hiệu ứng ngọn lửa, âm thanh Web Audio, reset vào 00:00 theo múi giờ cục bộ.
 * 5. Cơ chế Đóng Băng Chuỗi (Streak Freeze): Tối đa 2 lần/tháng, tự động reset vào đầu tháng.
 * 6. Khảo sát "Tuần này thấy thế nào?" để AI tối ưu hóa lộ trình.
 * 7. Thư viện gợi ý đa dạng với tính năng "Tại sao gợi ý này?" dựa trên dữ liệu quét.
 */

(function () {
  'use strict';

  // --- CÁCH LY DỮ LIỆU THEO TÀI KHOẢN (ACCOUNT-SCOPED DATA ISOLATION) ---
  function getCurrentAccountId() {
    const account = window.VisionAuth?.state?.account;
    if (account && account.id) {
      return String(account.id);
    }
    return 'guest';
  }

  function getScopedKey(baseKey) {
    const accountId = getCurrentAccountId();
    return `visionface_acc_${accountId}_${baseKey}`;
  }

  // Danh sách các khóa toàn cục cũ không theo tài khoản cần dọn sạch để tránh rò rỉ dữ liệu chéo nick
  const LEGACY_GLOBAL_KEYS = [
    'visionface_daily_unlocked',
    'visionface_latest_report',
    'visionface_latest_snapshot',
    'visionface_daily_streak',
    'visionface_daily_last_completed_date',
    'visionface_daily_last_active_date',
    'visionface_freezes_left',
    'visionface_freeze_month',
    'visionface_freeze_year',
    'visionface_frozen_dates',
    'visionface_completed_dates',
    'visionface_daily_intensity',
    'visionface_weekly_feedback',
    'visionface_today_tasks',
    'visionface_hide_score',
    'visionface_registered_users_v1'
  ];

  function clearLegacyGlobalKeys() {
    LEGACY_GLOBAL_KEYS.forEach(key => {
      try {
        localStorage.removeItem(key);
      } catch (e) {}
    });
  }

  // --- DỮ LIỆU THƯ VIỆN GỢI Ý (ĐÃ LOẠI BỎ PHẦN KIỂU, KÈM HƯỚNG DẪN TẬP / LÀM CHI TIẾT) ---
  const LIBRARY_ITEMS = [
    {
      id: 'drink_water',
      category: 'habit',
      categoryLabel: 'Thói quen',
      badge: '',
      title: 'Uống nước đều trong ngày',
      desc: 'Để một chai nước gần chỗ ngồi và uống vài ngụm mỗi khi nhớ ra. Không cần đếm chính xác.',
      duration: '1 phút mỗi lần',
      suggestedTime: 'Sáng • 1 đến 3h • 1 phút mỗi lần',
      instructions: [
        'Chuẩn bị sẵn một bình nước sạch (500ml - 1000ml) đặt ngay trên bàn làm việc trong tầm mắt.',
        'Uống từng ngụm nhỏ vừa miệng (khoảng 50 - 100ml) mỗi 30 - 45 phút, không chờ đến khi khát khô cổ mới uống.',
        'Khi uống, giữ nước trong khoang miệng 2-3 giây rồi nuốt chậm để tăng khả năng thẩm thấu của niêm mạc.',
        'Uống một cốc nước ấm (khoảng 200ml) ngay sau khi thức dậy vào buổi sáng để thanh lọc cơ thể và cấp ẩm tế bào.'
      ],
      tips: 'Tránh uống một lượng nước quá lớn dồn dập (trên 300ml cùng lúc) vì sẽ gây áp lực lọc cho thận mà tế bào da chưa kịp hấp thụ.',
      reasoning: (report) => {
        const skin = report?.skin;
        const smoothness = skin?.smoothness_score ?? 70;
        return `Dữ liệu đo da ghi nhận độ mịn màng bề mặt đạt ${smoothness}%. Duy trì đủ nước giúp cấp ẩm gian bào biểu bì, tăng đàn hồi da mặt và giảm hiện tượng trũng quầng thâm mắt.`;
      }
    },
    {
      id: 'sleep_schedule',
      category: 'habit',
      categoryLabel: 'Thói quen',
      badge: '',
      title: 'Ngủ đủ và đúng giờ',
      desc: 'Chọn một giờ đi ngủ vừa sức rồi cố gắn đúng mỗi ngày. Lệch vài hôm cũng không sao.',
      duration: 'Mỗi tối',
      suggestedTime: 'Tối • 22 đến 23h • Mỗi tối',
      instructions: [
        'Cố định một khung giờ đi ngủ mỗi ngày (lý tưởng nhất từ 22:30 đến 23:00) và duy trì giấc ngủ 7-8 tiếng.',
        'Tắt hoặc để xa điện thoại, máy tính và các nguồn phát ánh sáng xanh ít nhất 30 phút trước khi ngủ.',
        'Giữ phòng ngủ tối hoàn toàn, nhiệt độ phòng mát mẻ (~23-25°C) và không gian yên tĩnh thông thoáng.',
        'Thực hiện 5 nhịp hít thở sâu chậm hoặc buông lỏng toàn bộ cơ thể trên giường để đưa não bộ vào trạng thái ngủ sâu.'
      ],
      tips: 'Khoảng thời gian từ 23:00 - 02:00 là thời điểm vàng để da tự sửa chữa và tái sinh collagen, hạn chế tối đa bọng mắt và quầng thâm.',
      reasoning: (report) => {
        const darkCircles = report?.skin?.dark_circles_index ?? 25;
        return `Chỉ số quầng thâm mắt của bạn đo được là ${darkCircles}%. Ngủ đúng nhịp sinh học hỗ trợ phục hồi vi tuần hoàn máu quanh mao mạch mắt, giảm tích nước gây bọng mắt buổi sáng.`;
      }
    },
    {
      id: 'jaw_relax',
      category: 'exercise',
      categoryLabel: 'Bài tập',
      badge: '',
      title: 'Thả lỏng hàm',
      desc: 'Chừa môi nhẹ, để răng không chạm nhau và thả lỏng cơ hai bên hàm. Dừng lại nếu thấy đau khớp hàm.',
      duration: '1 phút',
      suggestedTime: 'Cả buổi • 10 đến 12h • 1 phút',
      instructions: [
        'Khép nhẹ hai cánh môi, giữ hai hàm răng trên và dưới cách nhau một khoảng nhỏ 2 - 3mm (tuyệt đối không nghiến chặt răng).',
        'Đặt đầu lưỡi nhẹ nhàng tựa vào vòm miệng phía sau chân răng cửa trên.',
        'Hít vào chậm, khi thở ra hãy cảm nhận hai bên cơ má và quai hàm trĩu xuống, thả lỏng toàn bộ cơ nhai (masseter).',
        'Dùng 2 đầu ngón tay xoa tròn nhẹ nhàng vùng cơ trước mang tai trong 30 giây để giải tỏa co thắt cơ cắn.'
      ],
      tips: 'Thực hiện mỗi khi thấy căng thẳng hoặc tập trung cao độ; dừng lại ngay nếu cảm thấy đau nhói ở khớp thái dương hàm.',
      reasoning: (report) => {
        const jaw = report?.jawline;
        const angle = jaw?.average_jaw_angle_deg || 124.5;
        return `Góc xương hàm ước tính ${angle}°. Nghiến răng hoặc căng cơ cắn (masseter) khi làm việc khiến góc hàm bị phì đại thô cứng. Bài tập thả lỏng giúp giảm tải áp lực khớp thái dương hàm và làm mềm viền hàm.`;
      }
    },
    {
      id: 'nose_breathing',
      category: 'exercise',
      categoryLabel: 'Bài tập',
      badge: '',
      title: 'Thở bằng mũi',
      desc: 'Hít vào chậm bằng mũi, thở ra nhẹ nhàng. Làm khi ngồi yên hoặc khi đi bộ.',
      duration: '2 phút',
      suggestedTime: 'Trưa • 12 đến 13h • 2 phút',
      instructions: [
        'Ngồi hoặc đứng thẳng lưng, thả lỏng hoàn toàn hai vai và lồng ngực.',
        'Khép miệng tự nhiên, hai môi chạm nhẹ, đầu lưỡi tựa nhẹ lên vòm miệng.',
        'Hít vào êm dịu và sâu qua mũi trong 4 giây, cảm nhận bụng phình nhẹ ra (thở cơ hoành).',
        'Thở ra từ từ và đều đặn qua mũi trong 5 - 6 giây, cảm nhận bụng xẹp xuống. Lặp lại 10 - 15 nhịp thở.'
      ],
      tips: 'Thở bằng mũi lọc bụi bẩn, giữ ẩm đường thở và kích hoạt hệ thần kinh phó giao cảm giúp giảm hormone căng thẳng cortisol.',
      reasoning: (report) => {
        const fwhr = report?.proportions?.length_to_width_ratio ?? 1.45;
        return `Tỷ lệ dài/rộng mặt fWHR là ${fwhr}. Thở bằng mũi giữ vòm họng cao, hỗ trợ phát triển cấu trúc xương mặt phía trước theo chiều ngang, ngăn ngừa mặt dài chảy xệ do thở miệng.`;
      }
    },
    {
      id: 'mewing',
      category: 'exercise',
      categoryLabel: 'Bài tập',
      badge: 'Tuỳ chọn',
      title: 'Tư thế lưỡi (Mewing)',
      desc: 'Một lựa chọn thêm, không bắt buộc. Hiện chưa có bằng chứng chắc chắn rằng mewing làm thay đổi xương hàm ở người trưởng thành.',
      duration: '30 giây',
      suggestedTime: 'Chiều • 15 đến 16h • 30 giây',
      instructions: [
        'Khép nhẹ môi, hai hàm răng chạm nhẹ tự nhiên hoặc cách nhau 1mm (không nghiến cắn chặt).',
        'Thực hiện động tác nuốt nước bọt để cảm nhận phần cuống và thân sau của lưỡi tự động nâng lên áp sát vào vòm họng trên.',
        'Giữ đầu lưỡi cách chân răng cửa trên khoảng 1cm (không dùng lực đẩy lưỡi xô vào răng cửa để tránh xô lệch răng).',
        'Duy trì toàn bộ bề mặt lưỡi áp đều lên vòm miệng, hít thở nhẹ nhàng qua mũi trong 30 - 60 giây mỗi hiệp.'
      ],
      tips: 'Đây là bài tập rèn thói quen tư thế nâng cơ sàn miệng. Không gồng lực quá mức làm căng mỏi vùng cơ dưới cằm.',
      reasoning: (report) => {
        const chin = report?.jawline?.chin_type || 'Cằm tự nhiên';
        return `Phân tích dáng cằm: "${chin}". Đặt toàn bộ thân lưỡi áp sát vòm miệng giúp kích hoạt cơ nâng sàn miệng, hỗ trợ định hình đường viền cằm dưới và giảm mỡ nọng tức thời.`;
      }
    },
    {
      id: 'neck_stretch',
      category: 'exercise',
      categoryLabel: 'Bài tập',
      badge: '',
      title: 'Kéo giãn cổ và vai',
      desc: 'Nghiêng đầu sang từng bên và giữ vài nhịp thở. Hợp với người ngồi máy tính nhiều giờ.',
      duration: '2 phút',
      suggestedTime: 'Chiều • 16 đến 17h • 2 phút',
      instructions: [
        'Ngồi thẳng lưng trên ghế, hạ thấp hai vai xuống tự nhiên.',
        'Nghiêng đầu từ từ sang bên phải, đưa tai phải lại gần vai phải cho đến khi cảm thấy cơ cổ bên trái căng giãn nhẹ.',
        'Đặt nhẹ bàn tay phải lên đỉnh đầu để tăng nhẹ độ giãn (chỉ đặt tay, không dùng lực giật mạnh). Giữ nguyên 15 - 20 giây.',
        'Hít thở sâu, đưa đầu về vị trí chính diện rồi đổi sang bên trái. Thực hiện mỗi bên 2 - 3 hiệp.'
      ],
      tips: 'Giữ lưng và cột sống thẳng cố định trong suốt bài tập; không xoay vặn cổ đột ngột để tránh chấn thương khớp đốt sống cổ.',
      reasoning: (report) => {
        const tilt = report?.symmetry?.eye_tilt_deg ?? 0.5;
        return `Độ nghiêng trục mắt/đầu ước tính ${tilt}°. Co cứng cơ ức đòn chũm và cơ thang một bên thường là nguyên nhân gây lệch mặt và lệch vai khi ngồi làm việc.`;
      }
    },
    {
      id: 'straight_posture',
      category: 'posture',
      categoryLabel: 'Tư thế',
      badge: '',
      title: 'Ngồi thẳng, màn hình ngang tầm mắt',
      desc: 'Nâng màn hình lên ngang mắt, hai bàn chân chạm sàn, vai thả lỏng.',
      duration: '1 phút',
      suggestedTime: 'Chiều • 14 đến 16h • 1 phút',
      instructions: [
        'Điều chỉnh độ cao ghế sao cho cả hai bàn chân đặt phẳng trên mặt sàn, khớp gối vuông góc ~90°.',
        'Kê cao hoặc chỉnh màn hình máy tính sao cho cạnh trên của màn hình ngang tầm mắt khi nhìn thẳng.',
        'Kéo nhẹ xương bả vai ra sau và hạ xuống, giữ lưng áp sát tựa ghế để cột sống duy trì đường cong sinh lý tự nhiên.',
        'Cẳng tay đặt vuông góc thoải mái trên bàn, cổ tay thả lỏng khi gõ phím.'
      ],
      tips: 'Cứ mỗi 45 - 60 phút làm việc, hãy đứng dậy vươn vai và nhìn ra xa 20 giây để giảm áp lực cho mắt và cột sống.',
      reasoning: (report) => {
        const symmetry = report?.symmetry?.overall_symmetry_score ?? 85;
        return `Điểm đối xứng khuôn mặt là ${symmetry}%. Tư thế ngồi gù gập cổ khiến trọng lực kéo dồn mô mềm xuống dưới, làm tăng rãnh cười và nọng cằm.`;
      }
    },
    {
      id: 'chin_tuck',
      category: 'posture',
      categoryLabel: 'Tư thế',
      badge: '',
      title: 'Thu cằm nhẹ khi nhìn điện thoại',
      desc: 'Đưa điện thoại lên gần tầm mắt thay vì cúi đầu xuống.',
      duration: '30 giây',
      suggestedTime: 'Tối • 19 đến 20h • 30 giây',
      instructions: [
        'Nâng điện thoại lên cao gần ngang tầm mắt thay vì cúi gập cổ nhìn xuống.',
        'Mắt nhìn thẳng phía trước, trượt nhẹ cằm ra phía sau theo phương ngang (như động tác thụt cằm tạo cằm đôi nhẹ).',
        'Giữ nguyên tư thế thu cằm trong 5 giây, cảm nhận cơ gáy phía sau được kéo dài ra và cơ trước cổ siết nhẹ.',
        'Thả lỏng về vị trí tự nhiên và lặp lại 5 - 10 lần mỗi khi dùng thiết bị di động.'
      ],
      tips: 'Giữ mắt nhìn ngang, không ngửa đầu ra sau cũng không cúi gập đầu xuống ngực.',
      reasoning: (report) => {
        return `Cúi đầu 45° gây áp lực tương đương 22kg lên cột sống cổ. Thu cằm nhẹ giúp duy trì đường cong sinh lý cổ và giữ đường viền quai hàm sắc nét.`;
      }
    },
    {
      id: 'gentle_wash',
      category: 'skincare',
      categoryLabel: 'Chăm sóc da',
      badge: '',
      title: 'Rửa mặt dịu nhẹ buổi sáng',
      desc: 'Dùng sữa rửa mặt nhẹ, rửa với nước vừa phải và lau khô bằng khăn sạch.',
      duration: '2 phút',
      suggestedTime: 'Sáng • 7 đến 9h • 2 phút',
      instructions: [
        'Rửa sạch hai bàn tay bằng xà phòng trước khi chạm tay lên da mặt.',
        'Làm ướt toàn bộ khuôn mặt bằng nước mát hoặc nước ấm nhẹ (tránh dùng nước nóng làm khô tróc da).',
        'Lấy một lượng sữa rửa mặt dịu nhẹ (pH ~ 5.5) bằng hạt đậu, tạo bọt mịn trên lòng bàn tay.',
        'Thoa bọt lên mặt và massage nhẹ nhàng theo chiều xoắn ốc từ trong ra ngoài, từ dưới lên trên trong 30-45 giây, tập trung vùng chữ T.',
        'Rửa sạch lại với nước và dùng khăn bông mềm sạch chấm nhẹ thấm khô (không chà xát miết da).'
      ],
      tips: 'Buổi sáng chỉ cần làm sạch dầu thừa và bụi gối, không cần dùng sản phẩm có tính tẩy rửa quá mạnh.',
      reasoning: (report) => {
        const tone = report?.skin?.skin_tone || 'Sáng tự nhiên';
        const oiliness = report?.skin?.oiliness_score ?? 30;
        return `Tông màu da: ${tone}, chỉ số bóng nhờn vùng T-zone: ${oiliness}%. Rửa mặt dịu nhẹ buổi sáng lấy đi dầu thừa và bã nhờn tích tụ ban đêm mà không làm tổn thương màng lipid bảo vệ da.`;
      }
    },
    {
      id: 'sunscreen',
      category: 'skincare',
      categoryLabel: 'Chăm sóc da',
      badge: '',
      title: 'Kem chống nắng mỗi sáng',
      desc: 'Chọn SPF 30 trở lên và thoa trước khi ra ngoài.',
      duration: '1 phút',
      suggestedTime: 'Sáng • 8 đến 9h • 1 phút',
      instructions: [
        'Thoa kem chống nắng sau bước dưỡng ẩm buổi sáng khoảng 2 - 3 phút để kem dưỡng kịp thẩm thấu.',
        'Lấy lượng kem vừa đủ chuẩn: khoảng 2 đốt ngón tay trỏ hoặc bằng kích thước một đồng xu lớn.',
        'Chấm đều các điểm nhỏ lên trán, 2 bên má, mũi, cằm và thoa đều cả vùng cổ và vành tai.',
        'Dùng các đầu ngón tay vỗ nhẹ nhàng và tán đều để kem tệp vào da mà không để lại vệt trắng hay bít tắc lỗ chân lông.',
        'Thoa trước khi ra ngoài trời khoảng 15 - 20 phút để màng lọc chống nắng ổn định bảo vệ da.'
      ],
      tips: 'Nên chọn kem chống nắng có chỉ số tối thiểu SPF 30 và PA+++ trở lên; thoa lại sau 3-4 tiếng nếu hoạt động ngoài trời ra nhiều mồ hôi.',
      reasoning: (report) => {
        const uniformity = report?.skin?.uniformity_score ?? 75;
        return `Độ đồng đều sắc tố da đạt ${uniformity}%. Tia UV là nguyên nhân hàng đầu gây đốm nâu, sạm nám và phá vỡ cấu trúc collagen nâng đỡ mô mỡ mặt.`;
      }
    },
    {
      id: 'moisturize_night',
      category: 'skincare',
      categoryLabel: 'Chăm sóc da',
      badge: '',
      title: 'Dưỡng ẩm buổi tối',
      desc: 'Thoa một lớp mỏng sau khi rửa mặt, trước lúc đi ngủ.',
      duration: '2 phút',
      suggestedTime: 'Tối • 21 đến 22h • 2 phút',
      instructions: [
        'Thực hiện sau khi đã làm sạch da mặt kỹ càng vào buổi tối và thoa toner/serum (nếu có).',
        'Lấy lượng kem dưỡng ẩm vừa đủ (khoảng 1 hạt đậu lớn) ra mu bàn tay.',
        'Chấm đều lên 5 điểm: trán, 2 gò má, mũi và cằm.',
        'Thoa đều theo hướng vuốt nâng cơ từ dưới cằm lên thái dương và từ khóe miệng sang mang tai.',
        'Xoa hai lòng bàn tay vào nhau cho ấm rồi áp nhẹ lên mặt trong 10 giây để kem thẩm thấu sâu hơn trước khi đi ngủ.'
      ],
      tips: 'Dưỡng ẩm ban đêm tạo màng khóa ẩm, ngăn mất nước qua biểu bì trong phòng điều hòa.',
      reasoning: (report) => {
        return `Ban đêm là thời điểm tế bào sừng tái tạo mạnh nhất. Dưỡng ẩm giúp khóa ẩm biểu bì, duy trì hàng rào bảo vệ da căng mịn vào sáng hôm sau.`;
      }
    }
  ];

  // --- QUẢN LÝ DỮ LIỆU CỤC BỘ THEO TÀI KHOẢN (STATE & STORAGE) ---
  class DailyManager {
    constructor() {
      // initDateCheck sẽ được gọi sau khi VisionAuth sẵn sàng
    }

    getItem(key) {
      return localStorage.getItem(getScopedKey(key));
    }

    setItem(key, value) {
      localStorage.setItem(getScopedKey(key), value);
    }

    removeItem(key) {
      localStorage.removeItem(getScopedKey(key));
    }

    // Lấy chuỗi ngày YYYY-MM-DD theo múi giờ cục bộ của máy tính người dùng
    getLocalDateString(offsetDays = 0) {
      const d = new Date();
      if (offsetDays !== 0) {
        d.setDate(d.getDate() + offsetDays);
      }
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    isUnlocked() {
      return this.getItem('UNLOCKED') === 'true';
    }

    setUnlocked(value = true) {
      this.setItem('UNLOCKED', value ? 'true' : 'false');
    }

    getLatestReport() {
      try {
        const raw = this.getItem('LATEST_REPORT');
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        console.warn('Lỗi đọc latest report:', e);
        return null;
      }
    }

    getLatestSnapshot() {
      return this.getItem('LATEST_SNAPSHOT');
    }

    saveLatestReport(reportData, snapshotUrl = null) {
      try {
        this.setItem('LATEST_REPORT', JSON.stringify(reportData));
        if (snapshotUrl) {
          this.setItem('LATEST_SNAPSHOT', snapshotUrl);
        }
        // Tự động mở khóa chức năng hàng ngày cho tài khoản này khi có báo cáo đầu tiên
        this.setUnlocked(true);
      } catch (e) {
        console.error('Không thể lưu báo cáo vào LocalStorage:', e);
      }
    }

    getIntensity() {
      return this.getItem('INTENSITY') || 'moderate'; // 'gentle', 'moderate', 'intensive'
    }

    setIntensity(level) {
      this.setItem('INTENSITY', level);
    }

    getWeeklyFeedback() {
      return this.getItem('WEEKLY_FEEDBACK') || 'balanced';
    }

    setWeeklyFeedback(val) {
      this.setItem('WEEKLY_FEEDBACK', val);
    }

    getHideScore() {
      return this.getItem('HIDE_SCORE') === 'true';
    }

    setHideScore(val) {
      this.setItem('HIDE_SCORE', val ? 'true' : 'false');
    }

    // --- CƠ CHẾ ĐÓNG BĂNG CHUỖI (STREAK FREEZE: TỐI ĐA 2 LẦN/THÁNG CHO MỖI TÀI KHOẢN) ---
    getFreezeInfo() {
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();

      let savedMonth = parseInt(this.getItem('FREEZE_MONTH'), 10);
      let savedYear = parseInt(this.getItem('FREEZE_YEAR'), 10);
      let freezesLeft = parseInt(this.getItem('FREEZES_LEFT'), 10);

      // Nếu bước sang tháng mới -> tự động hồi phục 2 lượt đóng băng cho tài khoản
      if (isNaN(savedMonth) || isNaN(savedYear) || savedMonth !== currentMonth || savedYear !== currentYear) {
        freezesLeft = 2;
        this.setItem('FREEZE_MONTH', String(currentMonth));
        this.setItem('FREEZE_YEAR', String(currentYear));
        this.setItem('FREEZES_LEFT', '2');
      }

      if (isNaN(freezesLeft)) {
        freezesLeft = 2;
        this.setItem('FREEZES_LEFT', '2');
      }

      let frozenDates = [];
      try {
        const raw = this.getItem('FROZEN_DATES');
        frozenDates = raw ? JSON.parse(raw) : [];
      } catch (e) {
        frozenDates = [];
      }

      return { freezesLeft, frozenDates, currentMonth, currentYear };
    }

    useFreeze(targetDate) {
      const info = this.getFreezeInfo();
      if (info.freezesLeft <= 0) return false;

      const dateStr = targetDate || this.getLocalDateString();
      if (!info.frozenDates.includes(dateStr)) {
        info.frozenDates.push(dateStr);
        info.freezesLeft -= 1;
        this.setItem('FREEZES_LEFT', String(info.freezesLeft));
        this.setItem('FROZEN_DATES', JSON.stringify(info.frozenDates));
        return true;
      }
      return false;
    }

    // --- CƠ CHẾ CHUỖI GIỮ LỬA (STREAK & MIDNIGHT RESET) ---
    getStreakInfo() {
      const rawStreak = this.getItem('STREAK');
      let streak = rawStreak !== null ? parseInt(rawStreak, 10) : 0;
      const lastCompletedDate = this.getItem('LAST_COMPLETED_DATE') || '';
      const lastActiveDate = this.getItem('LAST_ACTIVE_DATE') || '';

      let completedDates = [];
      try {
        const raw = this.getItem('COMPLETED_DATES');
        if (raw) {
          completedDates = JSON.parse(raw);
        } else {
          completedDates = [];
        }
      } catch (e) {
        completedDates = [];
      }

      return { streak, lastCompletedDate, lastActiveDate, completedDates };
    }

    // Kiểm tra chuyển ngày (00:00 cục bộ máy người dùng)
    initDateCheck() {
      const today = this.getLocalDateString();
      const lastActive = this.getItem('LAST_ACTIVE_DATE');
      const lastCompleted = this.getItem('LAST_COMPLETED_DATE');
      const yesterday = this.getLocalDateString(-1);

      if (lastActive && lastActive !== today) {
        console.log(`[Daily] Chuyển ngày mới từ ${lastActive} sang ${today}`);

        const streakInfo = this.getStreakInfo();
        if (streakInfo.streak > 0) {
          // Kiểm tra xem ngày hôm qua người dùng có hoàn thành không
          if (lastCompleted !== yesterday && lastActive === yesterday) {
            // Ngày hôm qua bị bỏ lỡ -> Kiểm tra xem có đóng băng bảo vệ không
            const freezeInfo = this.getFreezeInfo();
            if (freezeInfo.frozenDates.includes(yesterday)) {
              console.log('[Daily] Ngày hôm qua đã được đóng băng chuỗi, bảo toàn ngọn lửa!');
            } else if (freezeInfo.freezesLeft > 0) {
              // Tự động dùng 1 lần đóng băng cứu chuỗi nếu còn lượt
              this.useFreeze(yesterday);
              console.log('[Daily] Tự động kích hoạt Đóng Băng Chuỗi để giữ ngọn lửa cho ngày hôm qua!');
              setTimeout(() => {
                window.DailyRoutine?.showToast('❄️ Đã tự động dùng 1 lần đóng băng để bảo vệ chuỗi ngày của bạn!', 'info');
              }, 1000);
            } else {
              // Hết lượt đóng băng và bỏ lỡ ngày hôm qua -> Mất chuỗi về 0
              console.log('[Daily] Bỏ lỡ ngày hôm qua và hết lượt đóng băng, chuỗi giữ lửa bị gián đoạn.');
              this.setItem('STREAK', '0');
            }
          }
        }

        // Tạo mới danh sách bài tập cho ngày hôm nay (chưa hoàn thành)
        this.resetTodayTasksForNewDay();
      }

      this.setItem('LAST_ACTIVE_DATE', today);
    }

    resetTodayTasksForNewDay() {
      const tasks = this.getTodayTasks();
      const resetTasks = tasks.map(t => ({ ...t, completed: false, dismissed: false }));
      this.setItem('TODAY_TASKS', JSON.stringify(resetTasks));
    }

    // --- DANH SÁCH BÀI TẬP HÔM NAY ---
    getTodayTasks() {
      try {
        const raw = this.getItem('TODAY_TASKS');
        if (raw) {
          return JSON.parse(raw);
        }
      } catch (e) {
        console.warn('Lỗi đọc today tasks:', e);
      }
      return this.generateDefaultTasks();
    }

    saveTodayTasks(tasks) {
      this.setItem('TODAY_TASKS', JSON.stringify(tasks));
    }

    // Tạo danh sách bài tập dựa trên Báo Cáo Gần Nhất + Mục Tiêu Cường Độ (Nhẹ / Vừa / Chuyên sâu) + Khảo Sát Tuần
    generateDefaultTasks() {
      const report = this.getLatestReport();
      const intensity = this.getIntensity();
      const feedback = this.getWeeklyFeedback();

      // Danh sách việc cơ bản ban đầu:
      // 1. Uống nước đều trong ngày
      // 2. Rửa mặt dịu nhẹ buổi sáng
      // 3. Thả lỏng hàm
      // 4. Ngồi thẳng, màn hình ngang tầm mắt
      let taskIds = ['drink_water', 'gentle_wash', 'jaw_relax', 'straight_posture'];

      if (intensity === 'gentle') {
        // Nhẹ nhàng: 3 việc đơn giản
        taskIds = ['drink_water', 'gentle_wash', 'straight_posture'];
      } else if (intensity === 'intensive') {
        // Chuyên sâu: Thêm bài tập tập trung vào cằm/cơ mặt và chống nắng
        taskIds = ['drink_water', 'gentle_wash', 'jaw_relax', 'straight_posture', 'mewing', 'neck_stretch'];
      }

      // Điều chỉnh theo phản hồi "Tuần này thấy thế nào?"
      if (feedback === 'too_much') {
        // Nếu người dùng thấy hơi nhiều -> Giảm bớt 1 bài nặng
        taskIds = taskIds.filter(id => id !== 'mewing' && id !== 'neck_stretch');
        if (taskIds.length < 3) taskIds.push('drink_water');
      } else if (feedback === 'can_more') {
        // Nếu người dùng muốn thêm -> Thêm 1 bài tập hữu ích
        if (!taskIds.includes('sunscreen')) taskIds.push('sunscreen');
      }

      const tasks = taskIds.map(id => {
        const item = LIBRARY_ITEMS.find(it => it.id === id);
        return {
          id: item.id,
          title: item.title,
          category: item.category,
          categoryLabel: item.categoryLabel,
          suggestedTime: item.suggestedTime,
          completed: false,
          dismissed: false,
          addedFromLibrary: false
        };
      });

      this.saveTodayTasks(tasks);
      return tasks;
    }

    // Tích hoàn thành 1 bài tập
    toggleTaskCompleted(taskId) {
      const tasks = this.getTodayTasks();
      const target = tasks.find(t => t.id === taskId);
      if (!target) return null;

      target.completed = !target.completed;
      this.saveTodayTasks(tasks);

      // Kiểm tra xem tất cả bài tập hôm nay đã hoàn thành chưa
      const activeTasks = tasks.filter(t => !t.dismissed);
      const allDone = activeTasks.length > 0 && activeTasks.every(t => t.completed);

      const today = this.getLocalDateString();
      const streakInfo = this.getStreakInfo();

      let isNewStreakUnlocked = false;

      if (allDone && streakInfo.lastCompletedDate !== today) {
        // Tăng streak
        const newStreak = streakInfo.streak + 1;
        const newCompletedDates = [...streakInfo.completedDates, today];
        this.setItem('STREAK', String(newStreak));
        this.setItem('LAST_COMPLETED_DATE', today);
        this.setItem('COMPLETED_DATES', JSON.stringify(newCompletedDates));
        isNewStreakUnlocked = true;
      }

      return {
        target,
        allDone,
        isNewStreakUnlocked,
        tasks
      };
    }


    // Đổi 1 giờ (dời thời gian biểu)
    shiftTaskTime(taskId) {
      const tasks = this.getTodayTasks();
      const target = tasks.find(t => t.id === taskId);
      if (!target) return null;

      // Phân tích và cộng 1 giờ vào khung giờ
      const timeRegex = /(\d{1,2})\s*đến\s*(\d{1,2})h/;
      const match = target.suggestedTime.match(timeRegex);
      if (match) {
        let start = (parseInt(match[1], 10) + 1) % 24;
        let end = (parseInt(match[2], 10) + 1) % 24;
        target.suggestedTime = target.suggestedTime.replace(timeRegex, `${start} đến ${end}h`);
      } else {
        target.suggestedTime = target.suggestedTime + ' (Đã dời +1h)';
      }

      this.saveTodayTasks(tasks);
      return target;
    }

    // Bỏ qua bài tập hôm nay
    dismissTask(taskId) {
      const tasks = this.getTodayTasks();
      const target = tasks.find(t => t.id === taskId);
      if (!target) return;
      target.dismissed = true;
      this.saveTodayTasks(tasks);
    }

    // Thêm bài tập từ thư viện gợi ý vào hôm nay
    addTaskFromLibrary(libraryItemId) {
      const item = LIBRARY_ITEMS.find(it => it.id === libraryItemId);
      if (!item) return false;

      const tasks = this.getTodayTasks();
      const existing = tasks.find(t => t.id === libraryItemId);
      if (existing) {
        if (existing.dismissed) {
          existing.dismissed = false;
          this.saveTodayTasks(tasks);
          return true;
        }
        return false; // Đã có rồi
      }

      tasks.push({
        id: item.id,
        title: item.title,
        category: item.category,
        categoryLabel: item.categoryLabel,
        suggestedTime: item.suggestedTime,
        completed: false,
        dismissed: false,
        addedFromLibrary: true
      });
      this.saveTodayTasks(tasks);
      return true;
    }
  }

  // --- ÂM THANH KỶ NIỆM GIỮ LỬA DUOLINGO (WEB AUDIO API TỰ SINH) ---
  function playDuolingoStreakChime() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();

      const notes = [261.63, 329.63, 392.00, 523.25, 659.25]; // C4, E4, G4, C5, E5
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);

        gain.gain.setValueAtTime(0, ctx.currentTime + idx * 0.08);
        gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + idx * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.08 + 0.4);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + idx * 0.08);
        osc.stop(ctx.currentTime + idx * 0.08 + 0.45);
      });
    } catch (e) {
      console.warn('Audio synthesis not supported or blocked:', e);
    }
  }

  // --- CONTROLLER GIAO DIỆN HẰNG NGÀY ---
  const manager = new DailyManager();
  let currentActiveTab = 'scan'; // 'scan' | 'daily'
  let libraryActiveFilter = 'all';

  // Khởi tạo các phần tử DOM và gắn Event Listeners
  async function init() {
    if (typeof window !== 'undefined' && window.VisionAuth && window.VisionAuth.ready) {
      try {
        await window.VisionAuth.ready;
      } catch (e) {
        console.warn('[Daily] VisionAuth error:', e);
      }
    }

    clearLegacyGlobalKeys();
    manager.initDateCheck();

    renderSidebarStatus();
    renderDailyView();
    bindEvents();

    // Hẹn giờ kiểm tra chuyển ngày mỗi phút
    setInterval(() => {
      manager.initDateCheck();
    }, 60000);
  }

  // Cập nhật trạng thái khóa/mở khóa ở thanh Sidebar
  function renderSidebarStatus() {
    const isUnlocked = manager.isUnlocked();
    const navDaily = document.getElementById('navItemDaily');
    const lockIcon = document.getElementById('dailyLockIcon');
    const unlockNote = document.getElementById('dailyUnlockNote');

    if (!navDaily) return;

    if (isUnlocked) {
      if (lockIcon) lockIcon.classList.add('hidden');
      if (unlockNote) unlockNote.classList.add('hidden');
      navDaily.classList.remove('opacity-60', 'cursor-not-allowed');
      navDaily.title = 'Xem kế hoạch và bài tập hôm nay';
    } else {
      if (lockIcon) lockIcon.classList.remove('hidden');
      if (unlockNote) unlockNote.classList.remove('hidden');
      navDaily.classList.add('opacity-60');
      navDaily.title = 'Quét một lần đầu xong để mở khóa mục Hằng ngày.';
    }
  }

  // Chuyển đổi giữa 2 Giao diện: Quét Mặt <-> Hằng Ngày
  function switchTab(target) {
    if (target === 'daily' && !manager.isUnlocked()) {
      showToast('Vui lòng quét mặt trước để mở khóa tính năng Hằng ngày!', 'info');
      return;
    }

    currentActiveTab = target;

    const viewScan = document.getElementById('viewScanFace');
    const viewDaily = document.getElementById('viewDailyRoutine');
    const navScan = document.getElementById('navItemScan');
    const navDaily = document.getElementById('navItemDaily');
    const headerTitleScan = document.getElementById('headerTitleScan');
    const headerTitleDaily = document.getElementById('headerTitleDaily');
    const scanHeaderControls = document.getElementById('scanHeaderControls');
    const btnRescanFace = document.getElementById('btnRescanFace');

    if (target === 'daily') {
      if (viewScan) viewScan.classList.add('hidden');
      if (viewDaily) viewDaily.classList.remove('hidden');
      if (navScan) navScan.classList.remove('bg-surface-800', 'border-surface-700', 'text-white');
      if (navDaily) navDaily.classList.add('bg-surface-800', 'border-surface-700', 'text-white');
      if (headerTitleScan) headerTitleScan.classList.add('hidden');
      if (headerTitleDaily) headerTitleDaily.classList.remove('hidden');
      if (scanHeaderControls) scanHeaderControls.classList.add('hidden');
      if (btnRescanFace) btnRescanFace.classList.remove('hidden');

      renderDailyView();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      if (viewDaily) viewDaily.classList.add('hidden');
      if (viewScan) viewScan.classList.remove('hidden');
      if (navDaily) navDaily.classList.remove('bg-surface-800', 'border-surface-700', 'text-white');
      if (navScan) navScan.classList.add('bg-surface-800', 'border-surface-700', 'text-white');
      if (headerTitleDaily) headerTitleDaily.classList.add('hidden');
      if (headerTitleScan) headerTitleScan.classList.remove('hidden');
      if (scanHeaderControls) scanHeaderControls.classList.remove('hidden');
      if (btnRescanFace) btnRescanFace.classList.add('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // Render toàn bộ giao diện Hằng Ngày
  function renderDailyView() {
    renderTodayTasks();
    renderStreakCard();
    renderFeedbackCard();
    renderLatestScanCard();
    renderRecommendationLibrary();
  }

  // 1. Render Danh sách "Việc hôm nay"
  function renderTodayTasks() {
    const taskContainer = document.getElementById('dailyTaskList');
    const progressLabel = document.getElementById('dailyProgressText');
    const intensity = manager.getIntensity();

    // Đồng bộ nút chọn mức độ [Nhẹ] [Vừa] [Chuyên sâu]
    document.querySelectorAll('.btn-intensity').forEach(btn => {
      const level = btn.dataset.intensity;
      if (level === intensity) {
        btn.className = 'btn-intensity px-3 py-1 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 shadow-sm transition';
      } else {
        btn.className = 'btn-intensity px-3 py-1 text-xs font-semibold rounded-lg text-slate-400 hover:text-white transition';
      }
    });

    if (!taskContainer) return;

    const allTasks = manager.getTodayTasks();
    const activeTasks = allTasks.filter(t => !t.dismissed);
    const completedCount = activeTasks.filter(t => t.completed).length;

    if (progressLabel) {
      progressLabel.textContent = `${completedCount} trên ${activeTasks.length} việc đã xong`;
    }

    if (activeTasks.length === 0) {
      taskContainer.innerHTML = `
        <div class="p-6 text-center text-xs text-slate-400 bg-surface-900/40 rounded-xl border border-dashed border-surface-700">
          Hôm nay chưa có việc nào. Bạn có thể thêm bài tập từ thư viện gợi ý bên dưới!
        </div>
      `;
      return;
    }

    taskContainer.innerHTML = '';
    activeTasks.forEach(task => {
      const itemEl = document.createElement('div');
      itemEl.className = `p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
        task.completed
          ? 'bg-surface-900/40 border-surface-700/60 opacity-80'
          : 'bg-surface-900/90 border-surface-700 hover:border-cyan-500/40'
      }`;

      itemEl.innerHTML = `
        <div class="flex items-center gap-3 min-w-0">
          <button type="button" class="btn-check-task w-6 h-6 rounded-full flex items-center justify-center transition flex-shrink-0 ${
            task.completed
              ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/30'
              : 'border-2 border-slate-600 hover:border-cyan-400 text-transparent'
          }" data-id="${task.id}" title="${task.completed ? 'Đánh dấu chưa xong' : 'Đánh dấu hoàn thành'}">
            <i class="fa-solid fa-check text-xs"></i>
          </button>
          <div class="min-w-0">
            <h4 class="text-xs font-semibold ${task.completed ? 'line-through text-slate-400' : 'text-white'} truncate">
              ${escapeHtml(task.title)}
            </h4>
            <div class="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
              <span class="text-cyan-400 font-medium">${escapeHtml(task.categoryLabel || 'Bài tập')}</span>
              <span>•</span>
              <span class="truncate">${escapeHtml(task.suggestedTime || '1 phút')}</span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-1.5 flex-shrink-0">
          <button type="button" class="btn-guide-task px-2.5 py-1 text-[11px] rounded-lg bg-surface-800 hover:bg-surface-700 text-cyan-300 hover:text-cyan-200 transition border border-surface-700 flex items-center gap-1.5 font-medium" data-id="${task.id}" title="Xem hướng dẫn cách tập / làm">
            <i class="fa-solid fa-book-open text-[10px]"></i>
            <span>Hướng dẫn</span>
          </button>
          ${
            task.completed
              ? `<span class="text-[11px] font-mono text-emerald-400 flex items-center gap-1 px-1"><i class="fa-solid fa-circle-check"></i> Đã xong</span>`
              : `
              <button type="button" class="btn-shift-task px-2.5 py-1 text-[11px] rounded-lg bg-surface-800 hover:bg-surface-700 text-slate-300 transition border border-surface-700" data-id="${task.id}">
                Đổi 1 giờ
              </button>
              <button type="button" class="btn-dismiss-task px-2.5 py-1 text-[11px] rounded-lg bg-surface-800 hover:bg-rose-950 hover:text-rose-300 text-slate-400 transition border border-surface-700" data-id="${task.id}">
                Bỏ qua hôm nay
              </button>
            `
          }
        </div>
      `;

      taskContainer.appendChild(itemEl);
    });
  }

  // 2. Render Card "Tuần này" (Chuỗi giữ lửa Duolingo & Đóng Băng Chuỗi)
  function renderStreakCard() {
    const streakInfo = manager.getStreakInfo();
    const freezeInfo = manager.getFreezeInfo();

    const lblStreakNum = document.getElementById('dailyStreakNumber');
    const lblStreakDaysDesc = document.getElementById('dailyStreakDaysDesc');
    const lblFreezeStatus = document.getElementById('dailyFreezeStatus');
    const weekDaysContainer = document.getElementById('dailyWeekDaysRow');

    if (lblStreakNum) lblStreakNum.textContent = String(streakInfo.streak);

    // Tính toán 7 ngày trong tuần hiện tại (T2 -> CN)
    const now = new Date();
    const currentDayOfWeek = (now.getDay() + 6) % 7; // 0: Thứ 2, ..., 6: Chủ nhật
    const monday = new Date(now);
    monday.setDate(now.getDate() - currentDayOfWeek);

    const weekDays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
    let completedInWeek = 0;

    if (weekDaysContainer) {
      weekDaysContainer.innerHTML = '';
      for (let i = 0; i < 7; i++) {
        const dayDate = new Date(monday);
        dayDate.setDate(monday.getDate() + i);
        const dateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;

        const isCompleted = streakInfo.completedDates.includes(dateStr);
        const isFrozen = freezeInfo.frozenDates.includes(dateStr);
        const isToday = i === currentDayOfWeek;
        const isPast = i < currentDayOfWeek;

        if (isCompleted || isFrozen) completedInWeek++;

        const col = document.createElement('div');
        col.className = 'flex flex-col items-center gap-1.5 flex-1';

        let iconHtml = '';
        if (isCompleted) {
          iconHtml = `<div class="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white text-xs shadow-md shadow-orange-500/30 duolingo-flame-pulse"><i class="fa-solid fa-fire"></i></div>`;
        } else if (isFrozen) {
          iconHtml = `<div class="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center text-white text-xs shadow-md shadow-cyan-500/30" title="Đã bảo vệ bằng Đóng Băng Chuỗi"><i class="fa-solid fa-snowflake"></i></div>`;
        } else if (isToday) {
          iconHtml = `<div class="w-8 h-8 rounded-full border-2 border-dashed border-amber-400/80 bg-surface-900 flex items-center justify-center text-amber-400 text-xs animate-pulse"><i class="fa-solid fa-fire"></i></div>`;
        } else if (isPast) {
          iconHtml = `<div class="w-8 h-8 rounded-full bg-surface-900 border border-surface-700 flex items-center justify-center text-slate-600 text-xs"><i class="fa-solid fa-droplet"></i></div>`;
        } else {
          iconHtml = `<div class="w-8 h-8 rounded-full bg-surface-900 border border-surface-700/60 flex items-center justify-center text-slate-700 text-xs">•</div>`;
        }

        col.innerHTML = `
          <span class="text-[10px] font-mono ${isToday ? 'text-amber-400 font-bold' : 'text-slate-400'}">${weekDays[i]}</span>
          ${iconHtml}
        `;
        weekDaysContainer.appendChild(col);
      }
    }

    if (lblStreakDaysDesc) {
      lblStreakDaysDesc.textContent = `Bạn đã giữ lửa ${completedInWeek} ngày trong tuần này. Đổ lỡ một ngày không làm mất gì cả.`;
    }

    if (lblFreezeStatus) {
      lblFreezeStatus.innerHTML = `
        <span class="inline-flex items-center gap-1.5 text-[11px] text-cyan-300 bg-cyan-950/60 border border-cyan-800/80 px-2.5 py-1 rounded-lg">
          <i class="fa-solid fa-snowflake text-cyan-400"></i>
          <span>Bảo vệ chuỗi: Còn <strong>${freezeInfo.freezesLeft}/2</strong> lần đóng băng tháng ${freezeInfo.currentMonth + 1}</span>
        </span>
      `;
    }
  }

  // 3. Render Card "Tuần này thấy thế nào?"
  function renderFeedbackCard() {
    const feedback = manager.getWeeklyFeedback();
    const btnFeedbackList = document.querySelectorAll('.btn-feedback');

    btnFeedbackList.forEach(btn => {
      const val = btn.dataset.feedback;
      if (val === feedback) {
        btn.className = 'btn-feedback flex-1 py-1.5 px-2 rounded-xl text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/60 transition';
      } else {
        btn.className = 'btn-feedback flex-1 py-1.5 px-2 rounded-xl text-xs font-medium bg-surface-900 border border-surface-700 text-slate-400 hover:text-white transition';
      }
    });

    const feedbackNotice = document.getElementById('dailyFeedbackNotice');
    if (feedbackNotice) {
      if (feedback === 'too_much') {
        feedbackNotice.textContent = '💡 AI đã ghi nhận: Giảm tải khối lượng và ưu tiên các bài tập thư giãn ngắn.';
      } else if (feedback === 'can_more') {
        feedbackNotice.textContent = '💡 AI đã ghi nhận: Đã bổ sung thêm thử thách và bài tập nâng cao cho bạn.';
      } else {
        feedbackNotice.textContent = 'Chọn một đáp án, lịch tuần sau sẽ được chỉnh cho hợp với bạn.';
      }
    }
  }

  // 4. Render Card "Từ lần quét gần nhất"
  function renderLatestScanCard() {
    const report = manager.getLatestReport();
    const hideScore = manager.getHideScore();

    const lblShape = document.getElementById('dailyLatestFaceShape');
    const lblDirection = document.getElementById('dailyLatestRefDirection');
    const lblScore = document.getElementById('dailyLatestHarmonyScore');
    const btnToggleScore = document.getElementById('btnToggleDailyScore');

    if (report) {
      const shape = report?.proportions?.face_shape || 'Trái xoan (Oval)';
      const symmetry = report?.symmetry?.overall_symmetry_score ?? 80;
      const refDir = symmetry >= 85 ? 'Cân bằng' : symmetry >= 70 ? 'Cân đối khá' : 'Lệch nhẹ trục';
      const score = report?.overall_harmony_score ?? 76.8;

      if (lblShape) lblShape.textContent = shape;
      if (lblDirection) lblDirection.textContent = refDir;
      if (lblScore) {
        lblScore.textContent = hideScore ? '--- / 100' : `${score} / 100`;
      }
    } else {
      if (lblShape) lblShape.textContent = 'Chưa quét';
      if (lblDirection) lblDirection.textContent = '---';
      if (lblScore) lblScore.textContent = '--- / 100';
    }

    if (btnToggleScore) {
      btnToggleScore.textContent = hideScore ? 'Hiện điểm số' : 'Ẩn điểm số';
    }
  }

  // 5. Render "Thư viện gợi ý" (13 Cards)
  function renderRecommendationLibrary() {
    const container = document.getElementById('dailyLibraryGrid');
    if (!container) return;

    const report = manager.getLatestReport();
    const todayTasks = manager.getTodayTasks();
    const todayIds = todayTasks.filter(t => !t.dismissed).map(t => t.id);

    // Lọc theo tabs: Tất cả, Bài tập, Tư thế, Chăm sóc da, Kiểu, Thói quen
    let items = LIBRARY_ITEMS;
    if (libraryActiveFilter !== 'all') {
      items = LIBRARY_ITEMS.filter(it => it.category === libraryActiveFilter);
    }

    container.innerHTML = '';
    items.forEach(item => {
      const isInToday = todayIds.includes(item.id);
      const title = typeof item.dynamicTitle === 'function' && report
        ? item.dynamicTitle(report?.proportions?.face_shape)
        : item.title;
      const desc = typeof item.dynamicDesc === 'function' && report
        ? item.dynamicDesc(report)
        : item.desc;

      const card = document.createElement('div');
      card.className = 'bg-surface-900/90 border border-surface-700/80 hover:border-surface-600 rounded-2xl p-4 flex flex-col justify-between transition shadow-md';

      card.innerHTML = `
        <div>
          <div class="flex items-center justify-between gap-2 mb-2">
            <span class="text-[11px] font-mono text-cyan-400 font-semibold flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
              <span>${escapeHtml(item.categoryLabel)}</span>
            </span>
            ${item.badge ? `<span class="text-[10px] px-2 py-0.5 rounded-full bg-surface-800 text-slate-300 border border-surface-700 font-mono">${item.badge}</span>` : ''}
          </div>
          <h3 class="text-sm font-bold text-white mb-1.5 leading-snug">${escapeHtml(title)}</h3>
          <p class="text-xs text-slate-400 leading-relaxed mb-3">${escapeHtml(desc)}</p>
        </div>
        <div>
          <div class="text-[11px] font-mono text-slate-500 mb-3">${escapeHtml(item.duration)}</div>
          <div class="flex items-center justify-between gap-2 pt-2 border-t border-surface-700/60">
            ${
              isInToday
                ? `<button type="button" disabled class="px-3 py-1.5 rounded-xl bg-surface-800/80 text-slate-500 text-xs font-semibold cursor-not-allowed border border-surface-700">Đã có trong lịch</button>`
                : `<button type="button" class="btn-add-library px-3 py-1.5 rounded-xl bg-surface-800 hover:bg-surface-700 text-cyan-300 hover:text-white text-xs font-semibold transition border border-surface-700" data-id="${item.id}">Thêm vào hôm nay</button>`
            }
            <div class="flex items-center gap-2.5">
              <button type="button" class="btn-guide-task text-xs text-cyan-400 hover:text-cyan-300 transition flex items-center gap-1 font-medium" data-id="${item.id}" title="Xem hướng dẫn tập / làm">
                <i class="fa-solid fa-book-open text-[10px]"></i>
                <span>Hướng dẫn</span>
              </button>
              <button type="button" class="btn-why-library text-xs text-slate-400 hover:text-cyan-300 transition underline underline-offset-2" data-id="${item.id}">
                Tại sao gợi ý?
              </button>
            </div>
          </div>
        </div>
      `;

      container.appendChild(card);
    });
  }

  // Hiển thị Modal Hướng Dẫn Tập / Làm Chi Tiết
  function showGuideModal(taskId) {
    const item = LIBRARY_ITEMS.find(it => it.id === taskId);
    if (!item) return;

    const modal = document.getElementById('modalTaskGuide');
    if (!modal) return;

    const titleEl = document.getElementById('taskGuideTitle');
    const catEl = document.getElementById('taskGuideCategory');
    const durEl = document.getElementById('taskGuideDuration');
    const descEl = document.getElementById('taskGuideDesc');
    const stepsContainer = document.getElementById('taskGuideStepsList');
    const tipBox = document.getElementById('taskGuideTipBox');
    const tipText = document.getElementById('taskGuideTipText');

    if (titleEl) titleEl.textContent = item.title;
    if (catEl) catEl.textContent = item.categoryLabel;
    if (durEl) durEl.textContent = item.duration;
    if (descEl) descEl.textContent = item.desc;

    if (stepsContainer) {
      stepsContainer.innerHTML = '';
      const instructions = Array.isArray(item.instructions) && item.instructions.length > 0
        ? item.instructions
        : [item.desc];

      instructions.forEach((step, idx) => {
        const stepRow = document.createElement('div');
        stepRow.className = 'flex items-start gap-3 p-3 rounded-2xl bg-surface-850 border border-surface-700/80 shadow-sm';
        stepRow.innerHTML = `
          <div class="w-6 h-6 rounded-lg bg-cyan-950 border border-cyan-800 text-cyan-400 flex items-center justify-center text-xs font-mono font-bold flex-shrink-0 mt-0.5">
            ${idx + 1}
          </div>
          <div class="text-xs text-slate-200 leading-relaxed font-normal">${escapeHtml(step)}</div>
        `;
        stepsContainer.appendChild(stepRow);
      });
    }

    if (tipBox && tipText) {
      if (item.tips) {
        tipBox.classList.remove('hidden');
        tipText.textContent = item.tips;
      } else {
        tipBox.classList.add('hidden');
      }
    }

    const btnGotIt = document.getElementById('btnGotItTaskGuide');
    if (btnGotIt) {
      btnGotIt.onclick = () => {
        modal.classList.add('hidden');
      };
    }

    modal.classList.remove('hidden');
  }

  // Hiển thị Modal "Tại sao gợi ý này?"
  function showWhyModal(itemId) {
    const item = LIBRARY_ITEMS.find(it => it.id === itemId);
    if (!item) return;

    const report = manager.getLatestReport();
    const explanation = typeof item.reasoning === 'function'
      ? item.reasoning(report)
      : 'Bài tập được xây dựng trên nguyên lý thư giãn hệ cơ mặt và cân đối tỷ lệ nhân trắc học.';

    const modal = document.getElementById('modalAiExplanation');
    if (!modal) return;

    document.getElementById('aiExplTitle').textContent = item.title;
    document.getElementById('aiExplCategory').textContent = item.categoryLabel;
    document.getElementById('aiExplText').textContent = explanation;

    const btnAdd = document.getElementById('aiExplBtnAdd');
    if (btnAdd) {
      const todayTasks = manager.getTodayTasks();
      const alreadyIn = todayTasks.some(t => t.id === itemId && !t.dismissed);
      btnAdd.disabled = alreadyIn;
      btnAdd.textContent = alreadyIn ? 'Đã có trong hôm nay' : 'Thêm vào hôm nay';
      btnAdd.onclick = () => {
        manager.addTaskFromLibrary(itemId);
        renderDailyView();
        modal.classList.add('hidden');
        showToast(`Đã thêm "${item.title}" vào hôm nay!`, 'success');
      };
    }

    modal.classList.remove('hidden');
  }

  // Hiển thị Hiệu Ứng Bùng Lửa Giữ Lửa Duolingo (Flame Celebration)
  function triggerDuolingoFlameCelebration() {
    playDuolingoStreakChime();

    const overlay = document.getElementById('modalStreakCelebration');
    if (!overlay) return;

    const streak = manager.getStreakInfo().streak;
    const streakNum = document.getElementById('celebrationStreakNum');
    if (streakNum) streakNum.textContent = String(streak);

    overlay.classList.remove('hidden');

    // Tạo các tia lửa (flame sparks confetti)
    const sparksContainer = document.getElementById('flameSparksContainer');
    if (sparksContainer) {
      sparksContainer.innerHTML = '';
      for (let i = 0; i < 24; i++) {
        const spark = document.createElement('div');
        spark.className = 'flame-spark';
        const left = Math.random() * 100;
        const delay = Math.random() * 0.8;
        const size = Math.random() * 12 + 6;
        spark.style.cssText = `
          left: ${left}%;
          bottom: 20%;
          width: ${size}px;
          height: ${size}px;
          animation-delay: ${delay}s;
        `;
        sparksContainer.appendChild(spark);
      }
    }
  }

  // Đóng Modal Kỷ Niệm
  function closeCelebrationModal() {
    const overlay = document.getElementById('modalStreakCelebration');
    if (overlay) overlay.classList.add('hidden');
  }

  // Gắn kết tất cả sự kiện tương tác
  function bindEvents() {
    // 1. Navigation chuyển Tab Quét mặt <-> Hằng ngày
    document.getElementById('navItemScan')?.addEventListener('click', () => switchTab('scan'));
    document.getElementById('navItemDaily')?.addEventListener('click', () => switchTab('daily'));
    document.getElementById('btnRescanFace')?.addEventListener('click', () => switchTab('scan'));

    // 2. Chuyển đổi mức độ mục tiêu [Nhẹ] [Vừa] [Chuyên sâu]
    document.querySelectorAll('.btn-intensity').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const level = e.currentTarget.dataset.intensity;
        manager.setIntensity(level);
        manager.generateDefaultTasks();
        renderDailyView();
        showToast(`Đã cập nhật mục tiêu: ${e.currentTarget.textContent.trim()}`, 'info');
      });
    });

    // 3. Tương tác checkbox hoàn thành việc hôm nay
    document.getElementById('dailyTaskList')?.addEventListener('click', (e) => {
      const checkBtn = e.target.closest('.btn-check-task');
      if (checkBtn) {
        const taskId = checkBtn.dataset.id;
        const res = manager.toggleTaskCompleted(taskId);
        if (res) {
          renderDailyView();
          if (res.isNewStreakUnlocked) {
            triggerDuolingoFlameCelebration();
          } else if (res.target.completed) {
            showToast(`Tuyệt vời! Đã hoàn thành "${res.target.title}"`, 'success');
          }
        }
        return;
      }

      // Nút "Đổi 1 giờ"
      const shiftBtn = e.target.closest('.btn-shift-task');
      if (shiftBtn) {
        const taskId = shiftBtn.dataset.id;
        const target = manager.shiftTaskTime(taskId);
        if (target) {
          renderDailyView();
          showToast(`Đã dời thời gian: ${target.suggestedTime}`, 'info');
        }
        return;
      }

      // Nút "Hướng dẫn"
      const guideBtn = e.target.closest('.btn-guide-task');
      if (guideBtn) {
        const taskId = guideBtn.dataset.id;
        showGuideModal(taskId);
        return;
      }

      // Nút "Bỏ qua hôm nay"
      const dismissBtn = e.target.closest('.btn-dismiss-task');
      if (dismissBtn) {
        const taskId = dismissBtn.dataset.id;
        manager.dismissTask(taskId);
        renderDailyView();
        showToast('Đã bỏ qua bài tập này trong hôm nay.', 'info');
        return;
      }
    });

    // 4. Khảo sát "Tuần này thấy thế nào?"
    document.querySelectorAll('.btn-feedback').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const val = e.currentTarget.dataset.feedback;
        manager.setWeeklyFeedback(val);
        manager.generateDefaultTasks();
        renderDailyView();
        showToast('AI đã ghi nhận phản hồi và tối ưu lại lịch bài tập!', 'success');
      });
    });

    // 5. Thẻ "Từ lần quét gần nhất"
    document.getElementById('btnToggleDailyScore')?.addEventListener('click', () => {
      const current = manager.getHideScore();
      manager.setHideScore(!current);
      renderLatestScanCard();
    });

    document.getElementById('btnViewFullReport')?.addEventListener('click', () => {
      const report = manager.getLatestReport();
      const snapshot = manager.getLatestSnapshot();
      if (report && typeof window.displayAnalysisReport === 'function') {
        window.displayAnalysisReport(report, snapshot);
      } else if (report) {
        const modal = document.getElementById('modalAnalysisReport');
        if (modal) modal.classList.remove('hidden');
      } else {
        showToast('Tài khoản này chưa có báo cáo quét khuôn mặt. Vui lòng quét mặt trước!', 'info');
      }
    });

    // 6. Thư viện gợi ý: Filter tabs
    document.querySelectorAll('.btn-lib-filter').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-lib-filter').forEach(b => {
          b.className = 'btn-lib-filter px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-800 text-slate-300 hover:text-white transition';
        });
        e.currentTarget.className = 'btn-lib-filter px-3 py-1.5 rounded-full text-xs font-semibold bg-cyan-500 text-slate-950 transition';
        libraryActiveFilter = e.currentTarget.dataset.category;
        renderRecommendationLibrary();
      });
    });

    // 7. Thư viện gợi ý: Thêm vào hôm nay, Hướng dẫn & Tại sao gợi ý này
    document.getElementById('dailyLibraryGrid')?.addEventListener('click', (e) => {
      const addBtn = e.target.closest('.btn-add-library');
      if (addBtn) {
        const id = addBtn.dataset.id;
        const success = manager.addTaskFromLibrary(id);
        if (success) {
          renderDailyView();
          showToast('Đã thêm bài tập vào lịch hôm nay!', 'success');
        }
        return;
      }

      const guideBtn = e.target.closest('.btn-guide-task');
      if (guideBtn) {
        const id = guideBtn.dataset.id;
        showGuideModal(id);
        return;
      }

      const whyBtn = e.target.closest('.btn-why-library');
      if (whyBtn) {
        const id = whyBtn.dataset.id;
        showWhyModal(id);
        return;
      }
    });

    // 8. Đóng modal hướng dẫn và giải thích AI
    document.getElementById('btnCloseTaskGuide')?.addEventListener('click', () => {
      document.getElementById('modalTaskGuide')?.classList.add('hidden');
    });

    document.getElementById('btnCloseAiExplanation')?.addEventListener('click', () => {
      document.getElementById('modalAiExplanation')?.classList.add('hidden');
    });

    // 9. Đóng modal kỷ niệm giữ lửa
    document.getElementById('btnCloseCelebration')?.addEventListener('click', closeCelebrationModal);
    document.getElementById('btnContinueCelebration')?.addEventListener('click', closeCelebrationModal);


    // 11. Nút "Xóa toàn bộ dữ liệu" ở thanh Sidebar
    document.getElementById('btnClearAllData')?.addEventListener('click', () => {
      const ok = confirm('Bạn có chắc muốn xóa toàn bộ lịch sử quét, chuỗi ngày giữ lửa và cài đặt cục bộ?');
      if (ok) {
        localStorage.clear();
        showToast('Đã xóa toàn bộ dữ liệu thành công.', 'info');
        setTimeout(() => window.location.reload(), 1000);
      }
    });
  }

  // Escape HTML helper
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Toast notification helper
  function showToast(message, type = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
      return;
    }
    const toast = document.getElementById('toastNotification');
    const toastMsg = document.getElementById('toastMessage');
    const toastIcon = document.getElementById('toastIcon');
    if (!toast || !toastMsg) return;

    toastMsg.textContent = message;
    if (toastIcon) {
      toastIcon.className = type === 'success' ? 'text-emerald-400 text-lg' : type === 'error' ? 'text-rose-400 text-lg' : 'text-cyan-400 text-lg';
      toastIcon.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-info'}"></i>`;
    }

    toast.classList.remove('translate-y-20', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');

    setTimeout(() => {
      toast.classList.add('translate-y-20', 'opacity-0');
      toast.classList.remove('translate-y-0', 'opacity-100');
    }, 3200);
  }

  // --- PUBLIC API CHO TOÀN BỘ ỨNG DỤNG ---
  window.DailyRoutine = {
    manager,
    switchTab,
    renderSidebarStatus,
    renderDailyView,
    showToast,
    reloadForAccount() {
      clearLegacyGlobalKeys();
      manager.initDateCheck();
      renderSidebarStatus();
      renderDailyView();
    },
    // Hàm gọi khi hoàn tất phân tích quét mặt
    onFaceAnalysisComplete(reportData, snapshotUrl) {
      const wasUnlocked = manager.isUnlocked();
      manager.saveLatestReport(reportData, snapshotUrl);
      renderSidebarStatus();
      renderDailyView();

      if (!wasUnlocked) {
        showToast('🎉 Quét mặt thành công! Báo cáo đã được lưu và chức năng Hằng ngày đã được mở khóa!', 'success');
      } else {
        showToast('✨ Báo cáo phân tích đã được cập nhật vào lịch Hằng ngày!', 'success');
      }
    }
  };

  // Khởi động khi DOM đã tải xong
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
