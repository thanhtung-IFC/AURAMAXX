
    /**
     * VisionFace Pro - Kiến trúc điều khiển Camera và Nhận Diện Khuôn Mặt
     */
    
    // Các phần tử DOM
    const videoElement = document.getElementById('webcamVideo');
    const canvasElement = document.getElementById('outputCanvas');
    const canvasCtx = canvasElement.getContext('2d');
    
    // Nút và Điều khiển
    const btnToggleCamera = document.getElementById('btnToggleCamera');
    const btnCamIcon = document.getElementById('btnCamIcon');
    const btnCamText = document.getElementById('btnCamText');
    const btnQuickStart = document.getElementById('btnQuickStart');
    const cameraSelect = document.getElementById('cameraSelect');
    const resolutionSelect = document.getElementById('resolutionSelect');
    const chkMirror = document.getElementById('chkMirror');
    const lblMirrorMode = document.getElementById('lblMirrorMode');
    const btnRefreshDevices = document.getElementById('btnRefreshDevices');
    const btnToggleCamQuick = document.getElementById('btnToggleCamQuick');
    const lblCamHardwareType = document.getElementById('lblCamHardwareType');
    
    // Trạng thái AI & Overlay
    const aiStatusBadge = document.getElementById('aiStatusBadge');
    const aiIndicator = document.getElementById('aiIndicator');
    const aiStatusText = document.getElementById('aiStatusText');
    const overlayStandby = document.getElementById('overlayStandby');
    const standbyTitle = document.getElementById('standbyTitle');
    const standbyDesc = document.getElementById('standbyDesc');
    const standbyIcon = document.getElementById('standbyIcon');
    
    // Thông số HUD
    const lblFps = document.getElementById('lblFps');
    const lblLatency = document.getElementById('lblLatency');
    const lblActualRes = document.getElementById('lblActualRes');
    const faceStatusBadge = document.getElementById('faceStatusBadge');
    
    // Chỉ số Biometrics
    const txtBlinkCount = document.getElementById('txtBlinkCount');
    const badgeEyeState = document.getElementById('badgeEyeState');
    const barEar = document.getElementById('barEar');
    const txtMarScore = document.getElementById('txtMarScore');
    const badgeMouthState = document.getElementById('badgeMouthState');
    const barMar = document.getElementById('barMar');
    const txtHeadPose = document.getElementById('txtHeadPose');
    const txtPoseDegree = document.getElementById('txtPoseDegree');
    const txtLivenessState = document.getElementById('txtLivenessState');
    const barLiveness = document.getElementById('barLiveness');
    
    // Đăng ký & So khớp
    const inputPersonName = document.getElementById('inputPersonName');
    const btnRegisterFace = document.getElementById('btnRegisterFace');
    const registeredList = document.getElementById('registeredList');
    const lblUserCount = document.getElementById('lblUserCount');
    const btnClearAllFaces = document.getElementById('btnClearAllFaces');
    const matchCard = document.getElementById('matchCard');
    const matchName = document.getElementById('matchName');
    const matchScore = document.getElementById('matchScore');

    // Tùy chọn hiển thị & Tích hợp Python Backend
    const chkShowMesh = document.getElementById('chkShowMesh');
    const chkShowHUD = document.getElementById('chkShowHUD');
    const chkShowPoints = document.getElementById('chkShowPoints');
    const btnTriggerChallenge = document.getElementById('btnTriggerChallenge');

    // Các phần tử trạng thái Python Backend
    const backendStatusBadge = document.getElementById('backendStatusBadge');
    const backendIndicator = document.getElementById('backendIndicator');
    const backendStatusText = document.getElementById('backendStatusText');
    const chkUsePython = document.getElementById('chkUsePython');
    const lblEngineStatus = document.getElementById('lblEngineStatus');
    const lblEngineDesc = document.getElementById('lblEngineDesc');

    const isLocalPage = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
    const PYTHON_BACKEND_URL = window.VisionAuth ? window.location.origin : window.location.protocol === 'file:' || (isLocalPage && window.location.port !== '8000')
      ? 'http://localhost:8000'
      : window.location.origin;
    let isPythonBackendAvailable = false;
    let usePythonEngine = true;
    let isBackendFrameInFlight = false;

    // Các phần tử Chụp Ảnh Đa Chiều 2 Lần & Phân Tích Toàn Diện
    const badgeCaptureStep = document.getElementById('badgeCaptureStep');
    const txtCaptureStepDesc = document.getElementById('txtCaptureStepDesc');
    const btnCaptureCurrentStep = document.getElementById('btnCaptureCurrentStep');
    const lblBtnCapture = document.getElementById('lblBtnCapture');
    const btnRunMultiViewAnalysis = document.getElementById('btnRunMultiViewAnalysis');
    const btnResetTwoShot = document.getElementById('btnResetTwoShot');
    const thumbBoxFrontal = document.getElementById('thumbBoxFrontal');
    const imgThumbFrontal = document.getElementById('imgThumbFrontal');
    const placeholderFrontal = document.getElementById('placeholderFrontal');
    const btnRetakeFrontal = document.getElementById('btnRetakeFrontal');
    const checkFrontalDone = document.getElementById('checkFrontalDone');
    const thumbBoxProfile = document.getElementById('thumbBoxProfile');
    const imgThumbProfile = document.getElementById('imgThumbProfile');
    const placeholderProfile = document.getElementById('placeholderProfile');
    const btnRetakeProfile = document.getElementById('btnRetakeProfile');
    const checkProfileDone = document.getElementById('checkProfileDone');

    const inputUploadImage = document.getElementById('inputUploadImage');
    const chkShowGuideLines = document.getElementById('chkShowGuideLines');
    const lblCaptureGuide = document.getElementById('lblCaptureGuide');
    const shutterFlash = document.getElementById('shutterFlash');

    // Các phần tử Modal Báo Cáo
    const modalAnalysisReport = document.getElementById('modalAnalysisReport');
    const btnCloseReportModal = document.getElementById('btnCloseReportModal');
    const btnRetakePhoto = document.getElementById('btnRetakePhoto');
    const btnFinishReport = document.getElementById('btnFinishReport');
    const btnExportJson = document.getElementById('btnExportJson');
    const btnPrintReport = document.getElementById('btnPrintReport');
    const snapshotReportCanvas = document.getElementById('snapshotReportCanvas');
    const snapshotCtx = snapshotReportCanvas.getContext('2d');
    const chkModalShowLines = document.getElementById('chkModalShowLines');
    const chkModalShowPoints = document.getElementById('chkModalShowPoints');
    const btnTabModalFrontal = document.getElementById('btnTabModalFrontal');
    const btnTabModalProfile = document.getElementById('btnTabModalProfile');

    // Các phần tử Chẩn Đoán Trắc Diện Góc Nghiêng (Profile Diagnostics)
    const panelProfileDiagnostics = document.getElementById('panelProfileDiagnostics');
    const txtProfileAestheticScore = document.getElementById('txtProfileAestheticScore');
    const txtProfileViewSide = document.getElementById('txtProfileViewSide');
    const txtElineScore = document.getElementById('txtElineScore');
    const txtChinProjection = document.getElementById('txtChinProjection');
    const txtChinProjectionComment = document.getElementById('txtChinProjectionComment');
    const txtNasolabialDeg = document.getElementById('txtNasolabialDeg');
    const txtNasalBridgeProfile = document.getElementById('txtNasalBridgeProfile');
    const txtNasolabialStatus = document.getElementById('txtNasolabialStatus');
    const txtProfileGonialDeg = document.getElementById('txtProfileGonialDeg');
    const txtProfileJawDesc = document.getElementById('txtProfileJawDesc');

    // Điểm số & Nhãn Modal
    const badgeOverallGrade = document.getElementById('badgeOverallGrade');
    const txtOverallHarmonyScore = document.getElementById('txtOverallHarmonyScore');
    const txtShapeBadge = document.getElementById('txtShapeBadge');
    const txtSkinToneBadge = document.getElementById('txtSkinToneBadge');
    const dotSkinColor = document.getElementById('dotSkinColor');
    const txtSkinToneName = document.getElementById('txtSkinToneName');
    const txtShapeDescription = document.getElementById('txtShapeDescription');

    // Mục 1: Symmetry
    const txtSymmetryScore = document.getElementById('txtSymmetryScore');
    const txtSymmetryLevel = document.getElementById('txtSymmetryLevel');
    const listSymmetryDetails = document.getElementById('listSymmetryDetails');
    const txtEyeTilt = document.getElementById('txtEyeTilt');
    const boxAsymmetryFlaws = document.getElementById('boxAsymmetryFlaws');
    const listAsymmetryFlaws = document.getElementById('listAsymmetryFlaws');

    // Mục 2: Proportions
    const txtGoldenFitScore = document.getElementById('txtGoldenFitScore');
    const txtUpperThird = document.getElementById('txtUpperThird');
    const txtMiddleThird = document.getElementById('txtMiddleThird');
    const txtLowerThird = document.getElementById('txtLowerThird');
    const txtFwhrRatio = document.getElementById('txtFwhrRatio');
    const txtThirdsHarmony = document.getElementById('txtThirdsHarmony');
    const boxThirdsEvaluation = document.getElementById('boxThirdsEvaluation');
    const txtThirdsHonestEvaluation = document.getElementById('txtThirdsHonestEvaluation');

    // Mục 3: Nose
    const txtNoseScore = document.getElementById('txtNoseScore');
    const txtNoseWidthLength = document.getElementById('txtNoseWidthLength');
    const txtAlarStatus = document.getElementById('txtAlarStatus');
    const txtBridgeStatus = document.getElementById('txtBridgeStatus');
    const txtBridgeDev = document.getElementById('txtBridgeDev');
    const txtBridgeComment = document.getElementById('txtBridgeComment');
    const txtAlarComment = document.getElementById('txtAlarComment');

    // Mục 4: Jawline
    const txtJawSharpness = document.getElementById('txtJawSharpness');
    const txtJawAngle = document.getElementById('txtJawAngle');
    const txtChinType = document.getElementById('txtChinType');
    const txtChinAngle = document.getElementById('txtChinAngle');
    const txtJawCheekRatio = document.getElementById('txtJawCheekRatio');
    const txtJawEvaluation = document.getElementById('txtJawEvaluation');
    const boxChinFlaw = document.getElementById('boxChinFlaw');
    const txtChinFlaw = document.getElementById('txtChinFlaw');

    // Mục 5: Skin
    const txtSkinSmoothScore = document.getElementById('txtSkinSmoothScore');
    const txtSkinSmoothness = document.getElementById('txtSkinSmoothness');
    const txtSkinUniformity = document.getElementById('txtSkinUniformity');
    const txtDarkCircles = document.getElementById('txtDarkCircles');
    const txtSkinOiliness = document.getElementById('txtSkinOiliness');
    const txtSkinToneDetail = document.getElementById('txtSkinToneDetail');
    const paletteSkinColor = document.getElementById('paletteSkinColor');
    const txtSkinHex = document.getElementById('txtSkinHex');
    const txtSkinAdvice = document.getElementById('txtSkinAdvice');
    const boxSkinHealthAlerts = document.getElementById('boxSkinHealthAlerts');
    const listSkinHealthAlerts = document.getElementById('listSkinHealthAlerts');

    // Mục 6: Hair
    const txtHairlineType = document.getElementById('txtHairlineType');
    const txtHairlineComment = document.getElementById('txtHairlineComment');
    const txtDominantColor = document.getElementById('txtDominantColor');
    const txtHairMen = document.getElementById('txtHairMen');
    const txtHairWomen = document.getElementById('txtHairWomen');
    const boxStylistCorrection = document.getElementById('boxStylistCorrection');
    const txtHairCorrective = document.getElementById('txtHairCorrective');
    const txtHairFocus = document.getElementById('txtHairFocus');

    // Trạng thái ảnh snapshot và báo cáo
    let currentAnalysisReport = null;
    let currentSnapshotImage = null;
    let currentModalActiveTab = 'frontal'; // 'frontal' | 'profile'

    // Trạng thái Chụp 2 lần (Two-Step Multi-View State)
    let captureStep = 1; // 1: Mặt chính diện | 2: Góc nghiêng
    let frontalCaptureData = null; // { image: b64, landmarks: [...] }
    let profileCaptureData = null; // { image: b64, landmarks: [...] }
    let isAnalyzingSnapshot = false;
    let captureFrame = null;
    let captureFrameCanvas = null;
    let captureStableSince = null;
    let captureStableFrames = 0;
    let previousCapturePose = null;
    let profileCaptureArmed = false;
    let profileArmTimeout = null;
    const CAPTURE_STABLE_MS = 600;
    const CAPTURE_MAX_AGE_MS = 300;

    // Quản lý đồng bộ phần cứng Camera (Laptop & USB rời)
    let activeCameraDeviceId = null;
    let activeCameraLabel = '';
    const CAMERA_STORAGE_KEY = 'visionface_preferred_cam_v1';
    let knownCameraDeviceIds = new Set();
    let isProcessingFrame = false;
    let inferenceFrameCanvas = null;
    let lastInferenceVideoTime = -1;
    let frameCallbackId = null;

    // Biến trạng thái toàn cục
    let isCameraActive = false;
    let faceMesh = null;
    let faceMeshSetupPromise = null;
    let isUploadingImage = false;
    let currentStream = null;
    let latestLandmarks = null;
    let isMirrored = true;

    // Biến đo lường FPS
    let frameTimestamps = [];

    // Biometrics tracking
    let totalBlinks = 0;
    let isEyesClosed = false;
    const EAR_THRESHOLD = 0.20;
    const MAR_THRESHOLD = 0.38;

    // Liveness Challenge State Machine
    let isChallenging = false;
    let currentChallengeStep = 1; // 1: chớp mắt 2 lần, 2: há miệng, 3: quay mặt sang trái
    let challengeBlinkCount = 0;

    // Kho lưu trữ khuôn mặt
    const STORAGE_KEY = 'visionface_registered_users_v1';
    let registeredDatabase = [];

    function createFaceMeshEngine() {
      if (typeof FaceMesh !== 'function') {
        throw new Error("Không tải được MediaPipe. Hãy kiểm tra kết nối mạng và tải lại trang.");
      }
      const engine = new FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
      });
      engine.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.35,
        minTrackingConfidence: 0.35
      });
      return engine;
    }

    async function setupFaceMeshEngine() {
      if (faceMesh) return faceMesh;
      if (faceMeshSetupPromise) return faceMeshSetupPromise;
      faceMeshSetupPromise = (async () => {
        let engine = null;
        try {
          aiStatusText.innerText = "Đang tải MediaPipe FaceMesh...";
          engine = createFaceMeshEngine();
          engine.onResults(handleMeshResults);
          if (typeof engine.initialize === 'function') {
            await engine.initialize();
          }
          faceMesh = engine;
          aiIndicator.className = "w-2.5 h-2.5 rounded-full bg-emerald-400";
          aiStatusText.innerText = "Mô hình AI Sẵn sàng";
          showToast("Mô hình FaceMesh đã tải thành công!", "success");
          return faceMesh;
        } catch (error) {
          console.error("Lỗi khi tải FaceMesh:", error);
          if (engine && typeof engine.close === 'function') {
            await engine.close().catch(() => {});
          }
          aiIndicator.className = "w-2.5 h-2.5 rounded-full bg-rose-500 animate-none";
          aiStatusText.innerText = "Lỗi nạp mô hình AI";
          showToast(error.message || "Không thể tải mô hình AI từ CDN.", "error");
          return null;
        }
      })();
      try {
        return await faceMeshSetupPromise;
      } finally {
        faceMeshSetupPromise = null;
      }
    }

    function updateCameraSyncUI() {
      const lblActiveCamSync = document.getElementById('lblActiveCamSync');
      if (!lblActiveCamSync) return;
      if (!isCameraActive) {
        lblActiveCamSync.innerText = 'Đồng bộ 1 Cam: Chờ bật camera';
        return;
      }
      let cleanName = activeCameraLabel || (cameraSelect.options[cameraSelect.selectedIndex]?.text || 'Webcam');
      cleanName = cleanName.replace(/📷\s*\[USB Cam Rời\]\s*|💻\s*\[Cam Laptop\]\s*|📷\s*\[USB Cam Ngoài\]\s*|💻\s*\[Cam Tích Hợp\]\s*/g, '').trim();
      if (cleanName.length > 22) cleanName = cleanName.substring(0, 19) + '...';
      lblActiveCamSync.innerText = `Đồng bộ 1 Cam: ${cleanName}`;
    }

    function updateCameraHardwareLabel() {
      if (!lblCamHardwareType) return;
      const curOpt = cameraSelect.options[cameraSelect.selectedIndex];
      if (!curOpt || !curOpt.value) {
        lblCamHardwareType.innerText = '💻 Chưa có camera';
        return;
      }
      const isUsb = /\[USB Cam Rời\]/i.test(curOpt.text);
      lblCamHardwareType.innerHTML = isUsb 
        ? '<i class="fa-solid fa-usb text-emerald-400"></i> Đang chọn: USB Cam Rời' 
        : '<i class="fa-solid fa-laptop text-cyan-400"></i> Đang chọn: Cam Laptop';
    }

    async function enumerateVideoDevices(isTriggeredByHotplug = false) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        const savedCamId = localStorage.getItem(CAMERA_STORAGE_KEY);
        const prevSelected = cameraSelect.value || savedCamId;

        // Phát hiện thiết bị cắm nóng (Hot-plugging)
        if (isTriggeredByHotplug) {
          const newDevices = videoDevices.filter(d => !knownCameraDeviceIds.has(d.deviceId));
          newDevices.forEach(nd => {
            const label = nd.label || 'Webcam USB';
            const isInternal = /integrated|internal|built-in|true\s*vision|wide\s*vision|facetime|in-built|front camera|front\s*facing/i.test(label.toLowerCase());
            const isUsb = !isInternal && (/\busb\b|external|uvc|webcam/i.test(label.toLowerCase()));
            showToast(`🎉 Phát hiện thiết bị mới: ${isUsb ? '[USB Cam Rời]' : '[Camera Laptop]'} ${label}!`, "success");
            // Nếu camera đang tắt, ưu tiên chọn ngay camera mới vừa cắm
            if (!isCameraActive) {
              cameraSelect.value = nd.deviceId;
            }
          });
        }
        knownCameraDeviceIds = new Set(videoDevices.map(d => d.deviceId));

        cameraSelect.innerHTML = '';

        if (videoDevices.length === 0) {
          const opt = document.createElement('option');
          opt.value = '';
          opt.text = 'Không tìm thấy camera nào';
          cameraSelect.appendChild(opt);
          updateCameraHardwareLabel();
          updateCameraSyncUI();
          return;
        }

        let firstUsbId = null;
        let matchedSaved = false;

        videoDevices.forEach((device, idx) => {
          const opt = document.createElement('option');
          opt.value = device.deviceId;
          const devLabel = (device.label || '').toLowerCase();
          
          // Phân loại chính xác tuyệt đối:
          // 1. Nhận diện các dòng camera tích hợp trong máy laptop (HP True Vision, Lenovo EasyCamera, Integrated, v.v.)
          const isInternal = /integrated|internal|built-in|true\s*vision|wide\s*vision|facetime|in-built|front camera|front\s*facing/i.test(devLabel);
          // 2. Chỉ nhận diện là USB ngoài khi KHÔNG PHẢI camera tích hợp và có từ khóa USB/Webcam ngoại vi
          const isUsbExternal = !isInternal && (/\busb\b|external|uvc|webcam|c920|c922|c930|brio|streamcam|kiyo|droidcam|iriun|obs/i.test(devLabel));

          const cleanLabel = device.label || `Thiết bị Camera ${idx + 1}`;
          opt.text = isUsbExternal ? `📷 [USB Cam Rời] ${cleanLabel}` : `💻 [Cam Laptop] ${cleanLabel}`;

          if (isUsbExternal && !firstUsbId) {
            firstUsbId = device.deviceId;
          }

          if (device.deviceId === prevSelected) {
            opt.selected = true;
            matchedSaved = true;
          }
          cameraSelect.appendChild(opt);
        });

        // Nếu người dùng chưa chọn và phát hiện camera rời USB, ưu tiên camera rời USB
        if (!matchedSaved && firstUsbId) {
          cameraSelect.value = firstUsbId;
        }

        updateCameraHardwareLabel();
        updateCameraSyncUI();

      } catch (err) {
        console.warn("Chưa có quyền liệt kê camera chi tiết:", err);
      }
    }

    // Lắng nghe sự kiện cắm/rút camera rời USB (Hot-plugging) kèm debounce
    let deviceChangeDebounceTimer = null;
    navigator.mediaDevices?.addEventListener('devicechange', () => {
      clearTimeout(deviceChangeDebounceTimer);
      deviceChangeDebounceTimer = setTimeout(async () => {
        await enumerateVideoDevices(true);
      }, 450);
    });

    function getResolutionPreset(type) {
      switch (type) {
        case 'fhd': return { width: { ideal: 1920 }, height: { ideal: 1080 } };
        case 'hd':  return { width: { ideal: 1280 }, height: { ideal: 720 } };
        case 'vga':
        default:    return { width: { ideal: 640 }, height: { ideal: 480 } };
      }
    }

    // Vẽ camera độc lập với kết quả AI, kể cả khi mô hình gặp lỗi.
    function startFrameProcessingLoop() {
      cancelVideoFrameLoop();

      async function onCameraFrame() {
        if (!isCameraActive) return;
        try {
          if (videoElement.readyState >= 2 && !videoElement.paused && !videoElement.ended && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
            if (faceMesh && videoElement.currentTime === lastInferenceVideoTime) return;
            const w = canvasElement.width;
            const h = canvasElement.height;
            canvasCtx.save();
            try {
              canvasCtx.clearRect(0, 0, w, h);
              canvasCtx.drawImage(videoElement, 0, 0, w, h);
              if (!faceMesh && chkShowGuideLines?.checked) {
                drawOvalAlignmentGuide(w, h, null);
              }
            } finally {
              canvasCtx.restore();
            }

            if (faceMesh && !isProcessingFrame) {
              isProcessingFrame = true;
              const engine = faceMesh;
              const startStamp = performance.now();
              try {
                // Đóng băng đúng khung hình đưa vào AI để ảnh và landmarks khớp nhau.
                if (!inferenceFrameCanvas) inferenceFrameCanvas = document.createElement('canvas');
                const scale = Math.min(1, 1280 / Math.max(videoElement.videoWidth, videoElement.videoHeight));
                const inputWidth = Math.round(videoElement.videoWidth * scale);
                const inputHeight = Math.round(videoElement.videoHeight * scale);
                if (inferenceFrameCanvas.width !== inputWidth) inferenceFrameCanvas.width = inputWidth;
                if (inferenceFrameCanvas.height !== inputHeight) inferenceFrameCanvas.height = inputHeight;
                inferenceFrameCanvas.getContext('2d').drawImage(videoElement, 0, 0, inputWidth, inputHeight);
                lastInferenceVideoTime = videoElement.currentTime;
                await engine.send({ image: inferenceFrameCanvas });
                lblLatency.innerText = `${Math.round(performance.now() - startStamp)}ms`;
              } catch (err) {
                console.error("FaceMesh send frame error:", err);
                faceMesh = null;
                latestLandmarks = null;
                cancelProfileAutoCapture();
                updateCaptureTracking(null);
                matchCard.classList.add('opacity-0', 'translate-y-2');
                aiIndicator.className = "w-2.5 h-2.5 rounded-full bg-rose-500";
                aiStatusText.innerText = "Lỗi xử lý AI";
                faceStatusBadge.innerHTML = '<span>AI GẶP LỖI</span>';
                showToast(`AI không xử lý được camera: ${err.message || err}. Hãy tải lại trang để thử lại.`, "error");
                if (typeof engine.close === 'function') {
                  try { await engine.close(); } catch (closeError) { console.warn(closeError); }
                }
              } finally {
                isProcessingFrame = false;
              }
            } else if (!faceMesh) {
              updateFpsCounter();
            }
          }
        } catch (err) {
          console.error("Lỗi hiển thị khung hình camera:", err);
        } finally {
          if (isCameraActive) {
            frameCallbackId = requestAnimationFrame(onCameraFrame);
          }
        }
      }

      frameCallbackId = requestAnimationFrame(onCameraFrame);
    }

    function cancelVideoFrameLoop() {
      if (frameCallbackId !== null) {
        cancelAnimationFrame(frameCallbackId);
        frameCallbackId = null;
      }
      isProcessingFrame = false;
      lastInferenceVideoTime = -1;
    }

    async function startCameraStream(targetDeviceId = null) {
      if (isCameraActive) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        showToast("Trình duyệt không cho truy cập camera. Hãy mở web bằng HTTPS hoặc http://localhost:8000.", "error");
        return;
      }
      if (!faceMesh) setupFaceMeshEngine();

      const deviceId = targetDeviceId || cameraSelect.value || undefined;
      const resConfig = getResolutionPreset(resolutionSelect.value);

      standbyTitle.innerText = "Đang kết nối camera...";
      standbyDesc.innerText = "Đang khởi động phần cứng camera (Laptop / USB)...";

      // Cơ chế 5 cấp độ Fallback chống OverconstrainedError và xung đột phần cứng DirectShow/UVC
      let stream = null;
      let lastErr = null;

      // Cấp 1: Device ID chỉ định + preset độ phân giải lý tưởng
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            width: resConfig.width,
            height: resConfig.height,
            frameRate: { ideal: 30 }
          },
          audio: false
        });
      } catch (err1) {
        lastErr = err1;
        console.warn("Fallback Cấp 1 không thành công, thử Cấp 2:", err1.name, err1.message);

        // Cấp 2: Device ID chỉ định + chuẩn HD 720p linh hoạt
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: deviceId ? { exact: deviceId } : undefined,
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: false
          });
        } catch (err2) {
          lastErr = err2;
          console.warn("Fallback Cấp 2 không thành công, thử Cấp 3:", err2.name, err2.message);

          // Cấp 3: Device ID với độ phân giải mặc định của phần cứng camera
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: deviceId ? { deviceId: { exact: deviceId } } : true,
              audio: false
            });
          } catch (err3) {
            lastErr = err3;
            console.warn("Fallback Cấp 3 không thành công, thử Cấp 4 (Cam Laptop mặc định):", err3.name, err3.message);

            // Cấp 4: Fallback về camera trước mặc định của máy tính (facingMode: user)
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user' },
                audio: false
              });
            } catch (err4) {
              lastErr = err4;
              console.warn("Fallback Cấp 4 không thành công, thử Cấp 5:", err4.name, err4.message);

              // Cấp 5: Chấp nhận bất kỳ luồng video khả dụng nào
              try {
                stream = await navigator.mediaDevices.getUserMedia({
                  video: true,
                  audio: false
                });
              } catch (err5) {
                lastErr = err5;
              }
            }
          }
        }
      }

      if (!stream) {
        console.error("Lỗi khởi động camera:", lastErr);
        standbyTitle.innerText = "Không thể mở camera";
        standbyDesc.innerText = lastErr && lastErr.name === 'NotAllowedError' 
          ? "Bạn đã từ chối quyền camera. Hãy cấp quyền trên thanh địa chỉ URL."
          : `Lỗi kết nối phần cứng: ${lastErr ? lastErr.message : 'Camera đang bị ứng dụng khác chiếm giữ'}.`;
        standbyIcon.className = "fa-solid fa-triangle-exclamation text-rose-500";
        showToast("Lỗi mở camera! Vui lòng kiểm tra cáp cắm USB hoặc quyền truy cập.", "error");
        return;
      }

      try {
        currentStream = stream;
        videoElement.srcObject = currentStream;
        await videoElement.play();
        syncCanvasResolution();

        // Cập nhật lại danh sách camera chi tiết sau khi đã được cấp quyền truy cập
        await enumerateVideoDevices();
        if (deviceId) cameraSelect.value = deviceId;

        // Tối ưu hóa hiển thị thông tin phần cứng camera
        const videoTrack = currentStream.getVideoTracks()[0];
        let actualW = resConfig.width.ideal;
        let actualH = resConfig.height.ideal;
        if (videoTrack) {
          const settings = videoTrack.getSettings();
          if (settings.width && settings.height) {
            actualW = settings.width;
            actualH = settings.height;
          }
          videoElement.width = actualW;
          videoElement.height = actualH;
          videoElement.style.width = `${actualW}px`;
          videoElement.style.height = `${actualH}px`;

          const devLabel = videoTrack.label || 'Webcam';
          const isInternal = /integrated|internal|built-in|true\s*vision|wide\s*vision|facetime|in-built|front camera|front\s*facing/i.test(devLabel);
          const isUsb = !isInternal && (/\busb\b|external|uvc|webcam|c920|c922|c930|brio|streamcam|kiyo/i.test(devLabel));
          const prefix = isUsb ? '[USB Cam Rời]' : '[Cam Laptop]';
          const actualFps = settings.frameRate ? `${Math.round(settings.frameRate)}fps` : '30fps';
          lblActualRes.innerText = `${actualW}x${actualH} (${actualFps})`;
          lblActualRes.title = `${prefix} ${devLabel}`;

          // Lưu định danh phần cứng camera đang hoạt động để đồng bộ cho cả 2 ảnh
          activeCameraDeviceId = settings.deviceId || deviceId || cameraSelect.value || 'default';
          activeCameraLabel = `${prefix} ${devLabel}`;
          try { localStorage.setItem(CAMERA_STORAGE_KEY, activeCameraDeviceId); } catch(e) {}

          // Lắng nghe sự kiện rút USB khi camera đang hoạt động (Hot-unplug) -> Tự động chuyển về camera laptop
          videoTrack.onended = async () => {
            console.warn("Camera video track ended (có thể do rút cáp USB)");
            showToast("⚠️ Mất kết nối camera! Đang tự động chuyển về Camera laptop...", "warning");
            stopCameraStream();
            await enumerateVideoDevices();
            await new Promise(r => setTimeout(r, 350));
            if (cameraSelect.options.length > 0 && cameraSelect.options[0].value) {
              cameraSelect.selectedIndex = 0;
              await startCameraStream();
            }
          };
        }

        // Bắt đầu vòng lặp xử lý frame trực tiếp (Không dùng Camera wrapper để tránh gọi getUserMedia lần 2)
        isCameraActive = true;
        updateCameraHardwareLabel();
        updateCameraSyncUI();
        startFrameProcessingLoop();

        overlayStandby.classList.add('hidden');
        btnCamIcon.className = "fa-solid fa-stop";
        btnCamText.innerText = "Dừng Camera";
        btnToggleCamera.classList.replace('bg-cyan-500', 'bg-rose-500');
        btnToggleCamera.classList.replace('hover:bg-cyan-400', 'hover:bg-rose-400');

        showToast(`Đã kết nối thành công: ${activeCameraLabel}`, "success");
      } catch (runErr) {
        console.error("Lỗi chạy luồng camera:", runErr);
        stopCameraStream();
        showToast("Lỗi đồng bộ luồng video!", "error");
      }
    }

    function stopCameraStream() {
      if (!isCameraActive && !currentStream) return;

      cancelVideoFrameLoop();

      if (currentStream) {
        currentStream.getTracks().forEach(track => {
          try {
            track.onended = null;
            track.stop();
          } catch (e) {}
        });
        currentStream = null;
      }

      try {
        videoElement.pause();
        videoElement.srcObject = null;
      } catch (e) {}

      isCameraActive = false;
      cancelProfileAutoCapture();
      updateCaptureTracking(null);
      updateCameraSyncUI();
      overlayStandby.classList.remove('hidden');
      standbyTitle.innerText = "Camera Đang Tắt";
      standbyDesc.innerText = "Chọn nguồn camera (Laptop hoặc USB ngoài) và bấm Khởi Động để tiếp tục.";
      standbyIcon.className = "fa-solid fa-video-slash";

      btnCamIcon.className = "fa-solid fa-play";
      btnCamText.innerText = "Bật Camera";
      btnToggleCamera.classList.replace('bg-rose-500', 'bg-cyan-500');
      btnToggleCamera.classList.replace('hover:bg-rose-400', 'hover:bg-cyan-400');

      lblActualRes.innerText = "--";
      lblFps.innerText = "0";
      lblLatency.innerText = "0ms";
      matchCard.classList.add('opacity-0', 'translate-y-2');
      faceStatusBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-500"></span><span>KHÔNG CÓ MẶT</span>';
      faceStatusBadge.className = 'flex items-center gap-1.5 bg-surface-900/85 backdrop-blur px-3 py-1.2 rounded-lg border border-rose-900/60 text-[11px] font-mono text-rose-400';

      // Xóa khung canvas
      canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    }

    function calcDistance(pt1, pt2) {
      return Math.hypot(pt1.x - pt2.x, pt1.y - pt2.y, (pt1.z || 0) - (pt2.z || 0));
    }

    // Tính chỉ số EAR (Eye Aspect Ratio) cho chớp mắt
    function calculateEAR(pts) {
      // Mắt trái: 159 (trên), 145 (dưới), 33 (ngoài), 133 (trong)
      const lTop = pts[159], lBot = pts[145], lOut = pts[33], lIn = pts[133];
      // Mắt phải: 386 (trên), 374 (dưới), 362 (ngoài), 263 (trong)
      const rTop = pts[386], rBot = pts[374], rOut = pts[362], rIn = pts[263];

      const leftEAR = calcDistance(lTop, lBot) / (calcDistance(lOut, lIn) + 0.0001);
      const rightEAR = calcDistance(rTop, rBot) / (calcDistance(rOut, rIn) + 0.0001);

      return (leftEAR + rightEAR) / 2.0;
    }

    // Tính chỉ số MAR (Mouth Aspect Ratio) cho độ mở miệng
    function calculateMAR(pts) {
      // 13: Môi trên giữa, 14: Môi dưới giữa, 61: khóe môi trái, 291: khóe môi phải
      const top = pts[13], bot = pts[14], left = pts[61], right = pts[291];
      return calcDistance(top, bot) / (calcDistance(left, right) + 0.0001);
    }

    // Ước tính góc quay đầu (Yaw & Pitch)
    function calculateHeadPose(pts) {
      const nose = pts[1];
      const leftCheek = pts[234];
      const rightCheek = pts[454];
      const forehead = pts[10];
      const chin = pts[152];

      // Chênh lệch độ sâu hai má thay đổi khi quay đầu (góc ước tính).
      const yaw = Math.round(Math.atan2((leftCheek.z || 0) - (rightCheek.z || 0),
        Math.max(0.0001, rightCheek.x - leftCheek.x)) * 180 / Math.PI);

      const faceHeight = calcDistance(forehead, chin) + 0.0001;
      const topDist = calcDistance(forehead, nose);
      const botDist = calcDistance(nose, chin);
      const pitchRatio = (topDist - botDist) / faceHeight;
      const pitch = Math.round(pitchRatio * 65);

      let text = "Chính diện";
      if (yaw < -15) text = "Quay Trái";
      else if (yaw > 15) text = "Quay Phải";
      else if (pitch > 15) text = "Cúi đầu";
      else if (pitch < -12) text = "Ngẩng đầu";

      return { yaw, pitch, text };
    }

    // Trích xuất vector đặc trưng hình học chuẩn hóa (Normalized Geometric Landmark Vector)
    function extractFaceVector(landmarks) {
      // Chọn 20 điểm mốc hình thái then chốt phân bổ đều trên khuôn mặt
      const anchorIndices = [
        1, 10, 152, 234, 454,           // Mũi, trán, cằm, 2 gò má
        33, 133, 159, 145, 468,         // Mắt trái & tâm con ngươi
        362, 263, 386, 374, 473,        // Mắt phải & tâm con ngươi
        61, 291, 13, 14, 17             // Khung môi miệng
      ];

      // Tâm quy chiếu: Đỉnh mũi (Landmark 1)
      const center = landmarks[1];
      // Tỷ lệ chuẩn hóa dựa theo khoảng cách 2 má để độc lập với khoảng cách xa/gần
      const scale = calcDistance(landmarks[234], landmarks[454]) || 1.0;

      const vector = [];
      for (const idx of anchorIndices) {
        const pt = landmarks[idx] || center;
        vector.push((pt.x - center.x) / scale);
        vector.push((pt.y - center.y) / scale);
        vector.push(((pt.z || 0) - (center.z || 0)) / scale);
      }
      return vector;
    }

    // Đo khoảng cách Euclide chuẩn giữa 2 vector khuôn mặt
    function compareVectors(vecA, vecB) {
      if (!vecA || !vecB || vecA.length !== vecB.length) return Infinity;
      let sumSq = 0;
      for (let i = 0; i < vecA.length; i++) {
        const diff = vecA[i] - vecB[i];
        sumSq += diff * diff;
      }
      return Math.sqrt(sumSq);
    }

    function handleMeshResults(results) {
      updateFpsCounter();

      const w = canvasElement.width;
      const h = canvasElement.height;

      // Xóa và vẽ lại khung hình video gốc
      canvasCtx.save();
      canvasCtx.clearRect(0, 0, w, h);
      canvasCtx.drawImage(results.image || videoElement, 0, 0, w, h);

      if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const landmarks = results.multiFaceLandmarks[0];
        latestLandmarks = landmarks;
        updateCaptureTracking(landmarks, results.image || videoElement);

        faceStatusBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span><span>ĐANG THEO DÕI</span>';
        faceStatusBadge.className = 'flex items-center gap-1.5 bg-surface-900/85 backdrop-blur px-3 py-1.2 rounded-lg border border-emerald-900/60 text-[11px] font-mono text-emerald-400';

        // Phân tích Biometrics (Ưu tiên Python Backend, dự phòng Client JS)
        if (usePythonEngine && isPythonBackendAvailable) {
          processWithPythonBackend(landmarks);
        } else {
          analyzeBiometrics(landmarks);
        }

        // Vẽ Lưới Tessellation (Hỗ trợ cả 2 cách định danh của MediaPipe: FACEMESH_TESSELATION & FACEMESH_TESSELLATION)
        const tessellation = (typeof FACEMESH_TESSELATION !== 'undefined') ? FACEMESH_TESSELATION : 
                             ((typeof FACEMESH_TESSELLATION !== 'undefined') ? FACEMESH_TESSELLATION : null);
        if (chkShowMesh.checked && tessellation) {
          canvasCtx.strokeStyle = 'rgba(6, 182, 212, 0.28)';
          canvasCtx.lineWidth = 0.75;
          for (const [start, end] of tessellation) {
            const p1 = landmarks[start];
            const p2 = landmarks[end];
            if (p1 && p2) {
              canvasCtx.beginPath();
              canvasCtx.moveTo(p1.x * w, p1.y * h);
              canvasCtx.lineTo(p2.x * w, p2.y * h);
              canvasCtx.stroke();
            }
          }
        }

        // Vẽ Điểm mốc ngũ quan
        if (chkShowPoints.checked) {
          canvasCtx.fillStyle = '#10b981';
          const points = [1, 33, 133, 362, 263, 61, 291, 13, 14, 468, 473];
          for (const idx of points) {
            const pt = landmarks[idx];
            if (pt) {
              canvasCtx.beginPath();
              canvasCtx.arc(pt.x * w, pt.y * h, 2.5, 0, 2 * Math.PI);
              canvasCtx.fill();
            }
          }
        }

        // Vẽ Bounding Box & HUD
        let minX = 1, maxX = 0, minY = 1, maxY = 0;
        for (const pt of landmarks) {
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.y > maxY) maxY = pt.y;
        }

        const padX = (maxX - minX) * 0.12;
        const padY = (maxY - minY) * 0.15;
        const bx = Math.max(0, (minX - padX) * w);
        const by = Math.max(0, (minY - padY) * h);
        const bw = Math.min(w - bx, (maxX - minX + padX * 2) * w);
        const bh = Math.min(h - by, (maxY - minY + padY * 2) * h);

        if (chkShowHUD.checked) {
          drawSciFiCorners(bx, by, bw, bh);
        }

        // Vẽ khung căn chỉnh Oval hướng dẫn chụp ảnh
        if (chkShowGuideLines && chkShowGuideLines.checked) {
          drawOvalAlignmentGuide(w, h, landmarks);
        }

        // Thực hiện so khớp khuôn mặt khi chạy chế độ JS thuần
        if (!usePythonEngine || !isPythonBackendAvailable) {
          performFaceMatching(landmarks);
        }

      } else {
        latestLandmarks = null;
        updateCaptureTracking(null);
        if (chkShowGuideLines && chkShowGuideLines.checked) {
          drawOvalAlignmentGuide(w, h, null);
        }
        if (lblCaptureGuide) lblCaptureGuide.innerText = captureStep === 2
          ? "Quay lại nhẹ để thấy cả hai mắt; giữ mặt trong khung."
          : "Đưa khuôn mặt vào giữa khung.";
        faceStatusBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-500"></span><span>KHÔNG CÓ MẶT</span>';
        faceStatusBadge.className = 'flex items-center gap-1.5 bg-surface-900/85 backdrop-blur px-3 py-1.2 rounded-lg border border-rose-900/60 text-[11px] font-mono text-rose-400';
        matchCard.classList.add('opacity-0', 'translate-y-2');
      }

      canvasCtx.restore();
    }

    function drawSciFiCorners(x, y, w, h) {
      canvasCtx.strokeStyle = '#06b6d4';
      canvasCtx.lineWidth = 2;
      const len = 18;

      // Top-Left
      canvasCtx.beginPath();
      canvasCtx.moveTo(x, y + len);
      canvasCtx.lineTo(x, y);
      canvasCtx.lineTo(x + len, y);
      canvasCtx.stroke();

      // Top-Right
      canvasCtx.beginPath();
      canvasCtx.moveTo(x + w - len, y);
      canvasCtx.lineTo(x + w, y);
      canvasCtx.lineTo(x + w, y + len);
      canvasCtx.stroke();

      // Bottom-Left
      canvasCtx.beginPath();
      canvasCtx.moveTo(x, y + h - len);
      canvasCtx.lineTo(x, y + h);
      canvasCtx.lineTo(x + len, y + h);
      canvasCtx.stroke();

      // Bottom-Right
      canvasCtx.beginPath();
      canvasCtx.moveTo(x + w - len, y + h);
      canvasCtx.lineTo(x + w, y + h);
      canvasCtx.lineTo(x + w, y + h - len);
      canvasCtx.stroke();
    }

    function analyzeBiometrics(landmarks) {
      // 1. EAR (Chớp mắt)
      const ear = calculateEAR(landmarks);
      barEar.style.width = `${Math.min(100, Math.max(0, ear * 260))}%`;

      if (ear < EAR_THRESHOLD) {
        badgeEyeState.innerText = "NHẮM";
        badgeEyeState.className = "text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold";
        if (!isEyesClosed) {
          totalBlinks++;
          txtBlinkCount.innerText = totalBlinks;
          isEyesClosed = true;
          onBlinkAction();
        }
      } else {
        badgeEyeState.innerText = "MỞ";
        badgeEyeState.className = "text-[9px] font-mono px-1.5 py-0.5 rounded bg-surface-700 text-slate-400";
        isEyesClosed = false;
      }

      // 2. MAR (Khẩu độ miệng)
      const mar = calculateMAR(landmarks);
      txtMarScore.innerText = mar.toFixed(2);
      barMar.style.width = `${Math.min(100, Math.max(0, mar * 160))}%`;

      if (mar > MAR_THRESHOLD) {
        badgeMouthState.innerText = "HÁ MIỆNG";
        badgeMouthState.className = "text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold";
        onMouthAction();
      } else {
        badgeMouthState.innerText = "ĐÓNG";
        badgeMouthState.className = "text-[9px] font-mono px-1.5 py-0.5 rounded bg-surface-700 text-slate-400";
      }

      // 3. Head Pose (Quay đầu)
      const pose = calculateHeadPose(landmarks);
      txtHeadPose.innerText = pose.text;
      txtPoseDegree.innerText = `Yaw: ${pose.yaw}° | Pitch: ${pose.pitch}°`;
      onPoseAction(pose);
    }

    function onBlinkAction() {
      if (isChallenging && currentChallengeStep === 1) {
        challengeBlinkCount++;
        const badge = document.querySelector('#stepItemBlink .state-badge');
        badge.innerText = `${challengeBlinkCount} / 2`;
        
        if (challengeBlinkCount >= 2) {
          completeChallengeStep('#stepItemBlink');
          currentChallengeStep = 2;
          document.querySelector('#stepItemMouth .state-badge').innerText = 'Đang đợi...';
          barLiveness.style.width = '60%';
        }
      }
    }

    function onMouthAction() {
      if (isChallenging && currentChallengeStep === 2) {
        completeChallengeStep('#stepItemMouth');
        currentChallengeStep = 3;
        document.querySelector('#stepItemTurn .state-badge').innerText = 'Đang đợi...';
        barLiveness.style.width = '85%';
      }
    }

    function onPoseAction(pose) {
      if (isChallenging && currentChallengeStep === 3) {
        // Nếu lật gương, quay sang trái trên camera thực tế
        if (pose.text === "Quay Trái" || (isMirrored && pose.yaw < -15) || (!isMirrored && pose.yaw > 15)) {
          completeChallengeStep('#stepItemTurn');
          currentChallengeStep = 4;
          isChallenging = false;
          barLiveness.style.width = '100%';
          barLiveness.className = 'bg-emerald-400 h-full transition-all duration-300';
          txtLivenessState.innerText = "HỢP LỆ ✓";
          txtLivenessState.className = "text-sm font-mono font-bold text-emerald-400";
          btnTriggerChallenge.innerText = "Thành công";
          showToast("Xác thực Liveness thành công: Người thật 100%!", "success");
        }
      }
    }

    function completeChallengeStep(selector) {
      const row = document.querySelector(selector);
      const icon = row.querySelector('.indicator-icon');
      const badge = row.querySelector('.state-badge');
      icon.className = 'fa-solid fa-circle-check text-emerald-400';
      badge.innerText = 'Đạt';
      badge.className = 'font-mono text-emerald-400 font-bold text-[10px]';
      row.classList.add('border-emerald-700/60', 'bg-emerald-950/20');
    }

    async function checkPythonBackendStatus() {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200);
        const resp = await fetch(`${PYTHON_BACKEND_URL}/api/status`, { 
          method: 'GET',
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (resp.ok) {
          const info = await resp.json();
          isPythonBackendAvailable = true;
          backendIndicator.className = "w-2.5 h-2.5 rounded-full bg-emerald-400";
          backendStatusText.innerText = "Python: Online (Port 8000)";
          lblEngineStatus.innerText = "Python Engine";
          lblEngineDesc.innerText = "Đang kết nối: face_liveness_algorithms.py";
          chkUsePython.checked = true;
          usePythonEngine = true;
          await loadRegisteredFaces();
          return true;
        }
      } catch (e) {
        // Python server chưa bật hoặc quá hạn 1200ms
      }
      isPythonBackendAvailable = false;
      backendIndicator.className = "w-2.5 h-2.5 rounded-full bg-slate-500";
      backendStatusText.innerText = "Python: Chưa chạy (py server.py)";
      lblEngineStatus.innerText = "Client Engine (JS)";
      lblEngineDesc.innerText = "Chạy 'py server.py' để kích hoạt Python";
      usePythonEngine = false;
      chkUsePython.checked = false;
      return false;
    }

    async function processWithPythonBackend(landmarks) {
      if (isBackendFrameInFlight) return;
      isBackendFrameInFlight = true;

      try {
        const rawPoints = [];
        for (let i = 0; i < landmarks.length; i++) {
          const pt = landmarks[i];
          rawPoints.push({ x: pt.x, y: pt.y, z: pt.z || 0 });
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);

        const resp = await fetch(`${PYTHON_BACKEND_URL}/api/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            landmarks: rawPoints,
            check_challenge: isChallenging
          })
        });
        clearTimeout(timeoutId);

        if (resp.ok) {
          const data = await resp.json();
          if (data.success) {
            applyPythonBiometrics(data);
          }
        }
      } catch (err) {
        // Tự động chuyển tạm thời về local JS nếu kết nối mạng lỗi
        analyzeBiometrics(landmarks);
        performFaceMatching(landmarks);
      } finally {
        isBackendFrameInFlight = false;
      }
    }

    function applyPythonBiometrics(data) {
      if (!data || !data.biometrics) return;
      const b = data.biometrics;

      // 1. Cập nhật EAR
      const ear = b.ear;
      barEar.style.width = `${Math.min(100, Math.max(0, ear * 260))}%`;
      if (b.is_eye_closed) {
        badgeEyeState.innerText = "NHẮM";
        badgeEyeState.className = "text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold";
        if (!isEyesClosed) {
          totalBlinks++;
          txtBlinkCount.innerText = totalBlinks;
          isEyesClosed = true;
        }
      } else {
        badgeEyeState.innerText = "MỞ";
        badgeEyeState.className = "text-[9px] font-mono px-1.5 py-0.5 rounded bg-surface-700 text-slate-400";
        isEyesClosed = false;
      }

      // 2. Cập nhật MAR
      const mar = b.mar;
      txtMarScore.innerText = Number(mar).toFixed(2);
      barMar.style.width = `${Math.min(100, Math.max(0, mar * 160))}%`;
      if (b.is_mouth_open) {
        badgeMouthState.innerText = "HÁ MIỆNG";
        badgeMouthState.className = "text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold";
      } else {
        badgeMouthState.innerText = "ĐÓNG";
        badgeMouthState.className = "text-[9px] font-mono px-1.5 py-0.5 rounded bg-surface-700 text-slate-400";
      }

      // 3. Cập nhật Head Pose
      const pose = b.head_pose || { direction: "Chính diện", yaw: 0, pitch: 0 };
      txtHeadPose.innerText = pose.direction;
      txtPoseDegree.innerText = `Yaw: ${pose.yaw}° | Pitch: ${pose.pitch}°`;

      // 4. Cập nhật Face Matching
      if (data.match && data.match.matched) {
        matchName.innerText = data.match.name;
        matchScore.innerText = `${data.match.confidence}% (Khoảng cách: ${data.match.distance})`;
        matchCard.classList.remove('opacity-0', 'translate-y-2');
      } else {
        matchCard.classList.add('opacity-0', 'translate-y-2');
      }

      // 5. Cập nhật Liveness Challenge
      if (data.challenge && isChallenging) {
        const c = data.challenge;
        if (c.current_step === 1) {
          const badge = document.querySelector('#stepItemBlink .state-badge');
          if (badge) badge.innerText = `${c.blink_count} / 2`;
          barLiveness.style.width = `${c.progress_percentage}%`;
        } else if (c.current_step === 2) {
          completeChallengeStep('#stepItemBlink');
          const badge = document.querySelector('#stepItemMouth .state-badge');
          if (badge) badge.innerText = 'Đang đợi...';
          barLiveness.style.width = `${c.progress_percentage}%`;
        } else if (c.current_step === 3) {
          completeChallengeStep('#stepItemMouth');
          const badge = document.querySelector('#stepItemTurn .state-badge');
          if (badge) badge.innerText = 'Đang đợi...';
          barLiveness.style.width = `${c.progress_percentage}%`;
        } else if (c.current_step === 4 || c.is_verified) {
          completeChallengeStep('#stepItemTurn');
          isChallenging = false;
          barLiveness.style.width = '100%';
          barLiveness.className = 'bg-emerald-400 h-full transition-all duration-300';
          txtLivenessState.innerText = "HỢP LỆ ✓";
          txtLivenessState.className = "text-sm font-mono font-bold text-emerald-400";
          btnTriggerChallenge.innerText = "Thành công";
          showToast("Xác thực Liveness (Python Backend): Người thật 100%!", "success");
        }
      }
    }

    async function startLivenessVerification() {
      if (!isCameraActive) {
        showToast("Vui lòng bật camera trước khi test!", "info");
        await startCameraStream();
      }

      isChallenging = true;
      currentChallengeStep = 1;
      challengeBlinkCount = 0;
      txtLivenessState.innerText = "Đang kiểm tra...";
      txtLivenessState.className = "text-sm font-mono font-bold text-cyan-400";
      barLiveness.className = 'bg-cyan-400 h-full transition-all duration-300';
      barLiveness.style.width = '25%';
      btnTriggerChallenge.innerText = "Đang chạy...";

      if (usePythonEngine && isPythonBackendAvailable) {
        try {
          await fetch(`${PYTHON_BACKEND_URL}/api/challenge/start`, { method: 'POST' });
        } catch (e) {
          console.warn("Lỗi gọi Python challenge:", e);
        }
      }

      ['#stepItemBlink', '#stepItemMouth', '#stepItemTurn'].forEach((id, i) => {
        const row = document.querySelector(id);
        const icon = row.querySelector('.indicator-icon');
        const badge = row.querySelector('.state-badge');
        icon.className = 'fa-regular fa-circle text-slate-500 indicator-icon';
        badge.className = 'font-mono text-slate-400 text-[10px] state-badge';
        badge.innerText = i === 0 ? '0 / 2' : 'Chờ';
        row.className = 'flex items-center justify-between p-2 rounded-lg bg-surface-900 border border-surface-700/80';
      });
    }

    async function loadRegisteredFaces() {
      if (usePythonEngine && isPythonBackendAvailable) {
        try {
          const resp = await fetch(`${PYTHON_BACKEND_URL}/api/faces`);
          if (resp.ok) {
            const data = await resp.json();
            registeredDatabase = data.faces || [];
            renderFaceListUI();
            return;
          }
        } catch (e) {
          console.warn("Lỗi tải từ Python server, chuyển sang LocalStorage:", e);
        }
      }

      if (typeof window !== 'undefined' && window.VisionAuth) {
        registeredDatabase = [];
        renderFaceListUI();
        return;
      }
      try {
        const data = localStorage.getItem(STORAGE_KEY);
        registeredDatabase = data ? JSON.parse(data) : [];
      } catch (e) {
        registeredDatabase = [];
      }
      renderFaceListUI();
    }

    function saveRegisteredFaces() {
      if (typeof window !== 'undefined' && window.VisionAuth) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(registeredDatabase));
      renderFaceListUI();
    }

    function renderFaceListUI() {
      const totalSamples = registeredDatabase.reduce((total, user) => total + (user.sample_count ?? 1), 0);
      lblUserCount.innerText = `${registeredDatabase.length} người · ${totalSamples} mẫu`;
      registeredList.innerHTML = '';

      if (registeredDatabase.length === 0) {
        registeredList.innerHTML = `
          <div class="p-3 text-center text-xs text-slate-500 bg-surface-900/40 rounded-lg border border-dashed border-surface-700">
            Chưa có dữ liệu. Hãy đứng trước camera và bấm "Đăng Ký".
          </div>
        `;
        return;
      }

      registeredDatabase.forEach((user, idx) => {
        const item = document.createElement('div');
        item.className = 'flex items-center justify-between p-2 rounded-lg bg-surface-900 border border-surface-700 text-xs';
        item.innerHTML = `
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-cyan-400"></span>
            <span class="font-medium text-white">${escapeHtml(user.name)}</span>
            <span class="text-[10px] text-slate-500 font-mono">(${escapeHtml(user.date || '')}) · ${user.sample_count ?? 1} mẫu</span>
          </div>
          ${usePythonEngine && isPythonBackendAvailable ? '<button data-id="' + escapeHtml(user.id || '') + '" class="btn-add-face-sample text-cyan-300 hover:text-white p-1" title="Lưu thêm mẫu cho người này">+ Mẫu</button>' : ''}
          <button data-index="${idx}" data-id="${escapeHtml(user.id || '')}" class="btn-delete-user text-slate-500 hover:text-rose-400 transition p-1">
            <i class="fa-regular fa-trash-can"></i>
          </button>
        `;
        registeredList.appendChild(item);
      });

      registeredList.querySelectorAll('.btn-add-face-sample').forEach(btn => {
        btn.addEventListener('click', () => {
          const user = registeredDatabase.find(record => record.id === btn.getAttribute('data-id'));
          if (user) void registerCurrentFace({ userId: user.id, name: user.name });
        });
      });

      // Gắn sự kiện xóa từng người
      registeredList.querySelectorAll('.btn-delete-user').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const idx = parseInt(btn.getAttribute('data-index'), 10);
          const userId = btn.getAttribute('data-id');
          if (typeof window !== 'undefined' && window.VisionAuth && !(usePythonEngine && isPythonBackendAvailable)) {
            showToast("Cần kết nối máy chủ để xóa hồ sơ.", "error");
            return;
          }

          if (usePythonEngine && isPythonBackendAvailable && userId) {
            try {
              const response = await fetch(`${PYTHON_BACKEND_URL}/api/faces`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: userId })
              });
              const result = await response.json();
              if (!response.ok || !result.success) throw new Error(result.message || "Không thể xóa người dùng.");
              await loadRegisteredFaces();
              showToast("Đã xóa người dùng và các mẫu khuôn mặt.", "info");
            } catch (error) {
              showToast(error.message || "Không thể kết nối database.", "error");
            }
            return;
          }

          registeredDatabase.splice(idx, 1);
          saveRegisteredFaces();
          showToast("Đã xóa mẫu khuôn mặt!", "info");
        });
      });
    }

    async function registerCurrentFace(options = {}) {
      if (typeof window !== 'undefined' && window.VisionAuth && !(usePythonEngine && isPythonBackendAvailable)) {
        showToast("Cần kết nối máy chủ để lưu hồ sơ vào tài khoản.", "error");
        return;
      }
      if (!isCameraActive || !latestLandmarks) {
        showToast("Không tìm thấy khuôn mặt rõ nét để đăng ký!", "error");
        return;
      }

      const userId = typeof options.userId === 'string' ? options.userId : null;
      const name = userId ? options.name : inputPersonName.value.trim();
      if (!name) {
        showToast("Vui lòng nhập họ tên trước khi đăng ký!", "info");
        inputPersonName.focus();
        return;
      }

      if (usePythonEngine && isPythonBackendAvailable) {
        try {
          const rawPoints = latestLandmarks.map(p => ({ x: p.x, y: p.y, z: p.z || 0 }));
          const resp = await fetch(`${PYTHON_BACKEND_URL}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, landmarks: rawPoints, ...(userId ? { user_id: userId } : {}) })
          });
          const resJson = await resp.json();
          if (resp.ok && resJson.success) {
            showToast(userId ? `Đã thêm mẫu cho: ${name}` : `Đã đăng ký: ${name}`, "success");
            inputPersonName.value = '';
            await loadRegisteredFaces();
            return;
          }
          throw new Error(resJson.message || "Database chưa xác nhận lưu khuôn mặt.");
        } catch (err) {
          showToast(err.message || "Không thể kết nối database.", "error");
          return;
        }
      }
      if (userId) {
        showToast("Thêm mẫu cần kết nối Python database.", "info");
        return;
      }

      // Trích xuất vector đặc trưng lưu cục bộ
      const faceVector = extractFaceVector(latestLandmarks);
      const newRecord = {
        id: 'usr_' + Date.now(),
        name: name,
        vector: faceVector,
        date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      registeredDatabase.push(newRecord);
      saveRegisteredFaces();
      inputPersonName.value = '';
      showToast(`Đã lưu khuôn mặt của: ${name}`, "success");
    }

    function performFaceMatching(landmarks) {
      if (registeredDatabase.length === 0) {
        matchCard.classList.add('opacity-0', 'translate-y-2');
        return;
      }

      const currentVector = extractFaceVector(landmarks);
      let bestMatch = null;
      let minDistance = Infinity;

      for (const candidate of registeredDatabase) {
        const dist = compareVectors(currentVector, candidate.vector);
        if (dist < minDistance) {
          minDistance = dist;
          bestMatch = candidate;
        }
      }

      // Ngưỡng phân định khoảng cách hình học chuẩn hóa
      // Càng gần 0 thì càng giống; dưới 0.44 được xem là cùng một người
      const MATCH_DISTANCE_THRESHOLD = 0.44;

      if (bestMatch && minDistance < MATCH_DISTANCE_THRESHOLD) {
        const confidence = Math.max(0, Math.min(99.5, (1 - (minDistance / MATCH_DISTANCE_THRESHOLD)) * 40 + 60));
        matchName.innerText = bestMatch.name;
        matchScore.innerText = `${confidence.toFixed(1)}% (Khoảng cách: ${minDistance.toFixed(3)})`;
        matchCard.classList.remove('opacity-0', 'translate-y-2');
      } else {
        matchCard.classList.add('opacity-0', 'translate-y-2');
      }
    }

    function updateFpsCounter() {
      const now = performance.now();
      frameTimestamps.push(now);
      while (frameTimestamps.length > 0 && frameTimestamps[0] <= now - 1000) {
        frameTimestamps.shift();
      }
      lblFps.innerText = frameTimestamps.length;
    }

    function showToast(message, type = 'info') {
      const toast = document.getElementById('toastNotification');
      const toastMessage = document.getElementById('toastMessage');
      const toastIcon = document.getElementById('toastIcon');

      toastMessage.innerText = message;
      if (type === 'success') {
        toastIcon.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-400"></i>';
      } else if (type === 'error') {
        toastIcon.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-rose-400"></i>';
      } else {
        toastIcon.innerHTML = '<i class="fa-solid fa-circle-info text-cyan-400"></i>';
      }

      toast.classList.remove('translate-y-20', 'opacity-0');
      clearTimeout(toast._timeout);
      toast._timeout = setTimeout(() => {
        toast.classList.add('translate-y-20', 'opacity-0');
      }, 3200);
    }

    function escapeHtml(str) {
      return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
      }[tag] || tag));
    }

    function applyMirrorSetting() {
      isMirrored = chkMirror.checked;
      lblMirrorMode.innerText = isMirrored ? "Bật (Selfie)" : "Tắt (Cam Ngoài)";
      canvasElement.style.transform = isMirrored ? 'scaleX(-1)' : 'scaleX(1)';
    }

    function syncCanvasResolution() {
      const rect = canvasElement.parentElement.getBoundingClientRect();
      canvasElement.width = rect.width * (window.devicePixelRatio || 1);
      canvasElement.height = rect.height * (window.devicePixelRatio || 1);
    }

    window.addEventListener('resize', syncCanvasResolution);

    btnToggleCamera.addEventListener('click', () => {
      if (isCameraActive) stopCameraStream();
      else startCameraStream();
    });

    btnQuickStart.addEventListener('click', () => startCameraStream());

    // Nút đổi camera nhanh giữa laptop và USB
    if (btnToggleCamQuick) {
      btnToggleCamQuick.addEventListener('click', () => {
        if (cameraSelect.options.length <= 1) {
          showToast("Chỉ có 1 camera khả dụng. Hãy cắm thêm webcam USB để đổi qua lại!", "info");
          return;
        }
        let nextIndex = (cameraSelect.selectedIndex + 1) % cameraSelect.options.length;
        cameraSelect.selectedIndex = nextIndex;
        cameraSelect.dispatchEvent(new Event('change'));
      });
    }

    cameraSelect.addEventListener('change', async () => {
      const selectedDevId = cameraSelect.value;
      if (selectedDevId) {
        try { localStorage.setItem(CAMERA_STORAGE_KEY, selectedDevId); } catch(e) {}
      }

      updateCameraHardwareLabel();

      // Nhận diện loại camera để tối ưu chế độ lật gương
      const curOpt = cameraSelect.options[cameraSelect.selectedIndex];
      if (curOpt) {
        const isUsb = /\[USB Cam Rời\]/i.test(curOpt.text);
        if (!isUsb && !chkMirror.checked) {
          chkMirror.checked = true;
          applyMirrorSetting();
        } else if (isUsb && chkMirror.checked) {
          chkMirror.checked = false;
          applyMirrorSetting();
        }
      }

      // Bảo vệ tính đồng bộ: Nếu đã chụp ảnh Bước 1 mà đổi camera, phải chụp lại từ đầu bằng camera mới
      if (frontalCaptureData) {
        const confirmChange = confirm(
          "Bạn đang chuyển sang thiết bị camera khác!\n\n" +
          "Để đảm bảo tính đồng bộ tuyệt đối về tỉ lệ, tiêu cự và góc quang học, quy trình chụp 2 lần yêu cầu sử dụng cùng 1 camera.\n\n" +
          "Ảnh Bước 1 sẽ được làm mới để bạn chụp lại từ đầu bằng camera mới này.\n" +
          "Bạn có đồng ý tiếp tục?"
        );
        if (!confirmChange) {
          if (activeCameraDeviceId) cameraSelect.value = activeCameraDeviceId;
          updateCameraHardwareLabel();
          return;
        }
        resetTwoShotCapture();
        showToast("Đã làm mới quy trình. Hãy chụp Bước 1 bằng camera mới!", "info");
      }

      if (isCameraActive) {
        stopCameraStream();
        // Độ trễ giải phóng tài nguyên phần cứng cho USB DirectShow / UVC
        await new Promise(resolve => setTimeout(resolve, 300));
        await startCameraStream();
      }
    });

    resolutionSelect.addEventListener('change', async () => {
      if (isCameraActive) {
        stopCameraStream();
        await new Promise(resolve => setTimeout(resolve, 300));
        await startCameraStream();
      }
    });

    chkMirror.addEventListener('change', applyMirrorSetting);

    btnRefreshDevices.addEventListener('click', async () => {
      await enumerateVideoDevices();
      showToast("Đã cập nhật danh sách camera", "info");
    });

    btnRegisterFace.addEventListener('click', registerCurrentFace);

    inputPersonName.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') registerCurrentFace();
    });

    chkUsePython.addEventListener('change', () => {
      usePythonEngine = chkUsePython.checked;
      if (usePythonEngine) {
        if (isPythonBackendAvailable) {
          lblEngineStatus.innerText = "Python Engine";
          lblEngineDesc.innerText = "Đang kết nối: face_liveness_algorithms.py";
          showToast("Đã kích hoạt thuật toán Python Backend!", "success");
        } else {
          lblEngineStatus.innerText = "Python (Chưa kết nối)";
          lblEngineDesc.innerText = "Chạy 'py server.py' để kích hoạt máy chủ";
          showToast("Chưa tìm thấy server Python. Hãy chạy: py server.py", "info");
        }
      } else {
        lblEngineStatus.innerText = "Client Engine (JS)";
        lblEngineDesc.innerText = "Xử lý trực tiếp trên trình duyệt JavaScript";
        showToast("Đã chuyển sang thuật toán Client JS", "info");
      }
    });

    btnClearAllFaces.addEventListener('click', async () => {
      if (typeof window !== 'undefined' && window.VisionAuth && !(usePythonEngine && isPythonBackendAvailable)) {
        showToast("Cần kết nối máy chủ để xóa hồ sơ.", "error");
        return;
      }
      if (registeredDatabase.length === 0) return;
      if (usePythonEngine && isPythonBackendAvailable) {
        try {
          const response = await fetch(`${PYTHON_BACKEND_URL}/api/faces`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });
          const result = await response.json();
          if (!response.ok || !result.success) throw new Error(result.message || "Không thể xóa database.");
          await loadRegisteredFaces();
          showToast("Đã xóa toàn bộ dữ liệu khuôn mặt.", "info");
        } catch (error) {
          showToast(error.message || "Không thể kết nối database.", "error");
        }
        return;
      }
      registeredDatabase = [];
      saveRegisteredFaces();
      showToast("Đã xóa dữ liệu khuôn mặt trong trình duyệt.", "info");
    });

    btnTriggerChallenge.addEventListener('click', startLivenessVerification);

    // =========================================================================
    // CÁC HÀM XỬ LÝ CHỤP ẢNH & BÁO CÁO PHÂN TÍCH THẨM MỸ TOÀN DIỆN
    // =========================================================================

    // =========================================================================
    // CÁC HÀM XỬ LÝ CHỤP ẢNH ĐA CHIỀU 2 LẦN (FRONTAL + PROFILE) & PHÂN TÍCH
    // =========================================================================


    function evaluateCapturePose(landmarks, step, baselineYaw = 0, aspectRatio = 4 / 3) {
      const invalid = { ready: false, yaw: null, message: step === 2
        ? "Mất mặt: quay lại một chút để thấy cả hai mắt, rồi quay chậm."
        : "Đưa khuôn mặt vào khung." };
      if (!landmarks || landmarks.length < 468) return invalid;
      const needed = [1, 10, 152, 234, 454, 33, 263];
      if (needed.some(i => !landmarks[i] || !Number.isFinite(landmarks[i].x)
        || !Number.isFinite(landmarks[i].y) || !Number.isFinite(landmarks[i].z ?? 0))) return invalid;
      const yaw = calculateHeadPose(landmarks).yaw - baselineYaw;
      const absYaw = Math.abs(yaw);
      const result = { ready: false, yaw, message: "" };
      const outline = [10, 152, 234, 454].map(i => landmarks[i]);
      if (outline.some(p => p.x < 0.025 || p.x > 0.975 || p.y < 0.025 || p.y > 0.975)) {
        return { ...result, message: "Mặt bị cắt: đưa cả trán và cằm vào khung." };
      }
      const height = landmarks[152].y - landmarks[10].y;
      if (height < 0.25) return { ...result, message: "Đưa mặt gần camera hơn một chút." };
      if (height > 0.88) return { ...result, message: "Lùi ra một chút để mặt không bị cắt." };
      const eyeL = landmarks[33], eyeR = landmarks[263];
      const roll = Math.atan2(eyeR.y - eyeL.y, Math.max(0.001, (eyeR.x - eyeL.x) * aspectRatio)) * 180 / Math.PI;
      if (Math.abs(roll) > 12) return { ...result, message: "Giữ đầu thẳng, không nghiêng vai hoặc cúi đầu." };
      if (step === 1 && absYaw > 10) return { ...result, message: "Nhìn thẳng vào ống kính để lưu ảnh chính diện." };
      if (step === 2 && absYaw < 15) return { ...result, message: "Quay từ từ sang trái hoặc phải; vẫn để thấy cả hai mắt." };
      if (step === 2 && absYaw > 40) return { ...result, message: "Quay lại nhẹ: góc quá lớn dễ làm mất nhận diện." };
      return { ...result, ready: true, message: "Đúng góc, giữ yên một chút." };
    }

    function cancelProfileAutoCapture() {
      profileCaptureArmed = false;
      if (profileArmTimeout !== null) clearTimeout(profileArmTimeout);
      profileArmTimeout = null;
      document.getElementById('btnCancelAutoCapture')?.classList.add('hidden');
      if (captureStep === 2) lblBtnCapture.innerText = "Bật tự chụp góc nghiêng";
    }

    function resetCaptureStability() {
      captureStableSince = null;
      captureStableFrames = 0;
      previousCapturePose = null;
      captureFrame = null;
    }

    function renderCaptureAssist(quality, stableMs = 0) {
      const setText = (id, value) => { const el = document.getElementById(id); if (el) el.innerText = value; };
      setText('captureAngleTarget', captureStep === 1
        ? "Chính diện: góc ước tính ≤ 10°" : "Nghiêng nhẹ: góc tương đối ước tính 15–40°");
      setText('captureAngleValue', quality.yaw === null ? "Chưa có mặt" : "≈ " + Math.round(Math.abs(quality.yaw)) + "°");
      setText('captureTrackingHint', quality.message);
      const stable = Math.min(100, Math.floor(stableMs / CAPTURE_STABLE_MS * 100));
      setText('captureStability', quality.ready
        ? (stable >= 100 ? "Sẵn sàng chụp" : "Giữ yên · " + stable + "%")
        : (profileCaptureArmed ? "Đang chờ đúng góc…" : "Chờ căn chỉnh"));
      const fill = document.getElementById('captureAngleFill');
      if (fill) {
        fill.style.width = quality.yaw === null ? "0%" : Math.min(100, Math.abs(quality.yaw) / 50 * 100) + "%";
        fill.style.backgroundColor = quality.ready ? '#34d399' : '#fbbf24';
      }
      if (lblCaptureGuide) lblCaptureGuide.innerText = quality.message;
    }

    function updateCaptureTracking(landmarks, image) {
      const now = performance.now();
      const baseline = captureStep === 2 ? (frontalCaptureData?.poseYaw || 0) : 0;
      const quality = evaluateCapturePose(landmarks, captureStep, baseline,
        (videoElement.videoWidth || 640) / (videoElement.videoHeight || 480));
      if (!landmarks || !quality.ready) {
        resetCaptureStability();
        renderCaptureAssist(quality);
        return;
      }
      const nose = landmarks[1];
      const previous = previousCapturePose;
      const moving = !previous || now - previous.time > 250
        || Math.abs(quality.yaw - previous.yaw) > 4
        || Math.hypot(nose.x - previous.x, nose.y - previous.y) > 0.018;
      if (moving) { captureStableSince = now; captureStableFrames = 0; }
      captureStableFrames++;
      previousCapturePose = { time: now, yaw: quality.yaw, x: nose.x, y: nose.y };
      const stableMs = now - captureStableSince;
      const stable = stableMs >= CAPTURE_STABLE_MS && captureStableFrames >= 4;
      if (!captureFrameCanvas) captureFrameCanvas = document.createElement('canvas');
      const width = image?.videoWidth || image?.naturalWidth || image?.width || videoElement.videoWidth;
      const height = image?.videoHeight || image?.naturalHeight || image?.height || videoElement.videoHeight;
      if (!image || !width || !height) {
        resetCaptureStability();
        renderCaptureAssist({ ...quality, ready: false, message: "Đang chờ hình camera rõ nét." });
        return;
      }
      if (captureFrameCanvas.width !== width) captureFrameCanvas.width = width;
      if (captureFrameCanvas.height !== height) captureFrameCanvas.height = height;
      captureFrameCanvas.getContext('2d').drawImage(image, 0, 0, width, height);
      captureFrame = {
        canvas: captureFrameCanvas, width, height, time: now, stable, step: captureStep,
        deviceId: activeCameraDeviceId, poseYaw: calculateHeadPose(landmarks).yaw,
        relativeYaw: quality.yaw, landmarks: landmarks.map(p => ({ x:p.x, y:p.y, z:p.z || 0 }))
      };
      renderCaptureAssist(quality, stableMs);
      if (stable && captureStep === 2 && profileCaptureArmed && !isAnalyzingSnapshot) {
        void captureCurrentStepShot({ automatic: true });
      }
    }

    function updateCaptureStepUI() {
      resetCaptureStability();
      renderCaptureAssist(evaluateCapturePose(null, captureStep));
      if (captureStep === 1) {
        badgeCaptureStep.className = "px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-cyan-950 text-cyan-300 border border-cyan-700 flex items-center gap-1.5";
        badgeCaptureStep.innerHTML = '<span class="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span><span>BƯỚC 1/2: MẶT CHÍNH DIỆN</span>';
        txtCaptureStepDesc.innerText = "Nhìn thẳng vào camera (Góc quay Yaw ~ 0°)";
        lblBtnCapture.innerText = "Chụp Mặt Chính Diện";
        thumbBoxFrontal.className = "relative w-20 h-16 rounded-xl bg-surface-900 border-2 border-dashed border-cyan-500 overflow-hidden flex flex-col items-center justify-center text-center p-1 group ring-2 ring-cyan-500/30";
        thumbBoxProfile.className = "relative w-20 h-16 rounded-xl bg-surface-900 border-2 border-dashed border-surface-700 overflow-hidden flex flex-col items-center justify-center text-center p-1 group";
      } else {
        badgeCaptureStep.className = "px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-indigo-950 text-indigo-300 border border-indigo-700 flex items-center gap-1.5";
        badgeCaptureStep.innerHTML = '<span class="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span><span>BƯỚC 2/2: GÓC NGHIÊNG MẶT</span>';
        txtCaptureStepDesc.innerText = "Bật tự chụp, quay từ từ sang một bên và giữ cả hai mắt còn nhìn thấy.";
        lblBtnCapture.innerText = "Bật tự chụp góc nghiêng";
        thumbBoxProfile.className = "relative w-20 h-16 rounded-xl bg-surface-900 border-2 border-dashed border-indigo-500 overflow-hidden flex flex-col items-center justify-center text-center p-1 group ring-2 ring-indigo-500/30";
      }

      // Kích hoạt nút Phân tích đa chiều khi đã chụp đủ cả 2 góc
      if (frontalCaptureData) {
        btnRunMultiViewAnalysis.disabled = false;
        btnRunMultiViewAnalysis.classList.remove('opacity-40', 'cursor-not-allowed');
      } else {
        btnRunMultiViewAnalysis.disabled = true;
        btnRunMultiViewAnalysis.classList.add('opacity-40', 'cursor-not-allowed');
      }
    }


    function drawOvalAlignmentGuide(w, h, landmarks) {
      const quality = evaluateCapturePose(landmarks, captureStep,
        captureStep === 2 ? (frontalCaptureData?.poseYaw || 0) : 0,
        (videoElement.videoWidth || 640) / (videoElement.videoHeight || 480));
      canvasCtx.save();
      canvasCtx.beginPath();
      canvasCtx.ellipse(w / 2, h / 2, w * 0.25, h * 0.39, 0, 0, Math.PI * 2);
      canvasCtx.setLineDash([8, 6]);
      canvasCtx.lineWidth = quality.ready ? 2.5 : 1.8;
      canvasCtx.strokeStyle = quality.ready ? '#34d399' : '#fbbf24';
      canvasCtx.stroke();
      canvasCtx.restore();
    }

    function triggerShutterFlash() {
      if (shutterFlash) {
        shutterFlash.classList.add('flash-active');
        setTimeout(() => {
          shutterFlash.classList.remove('flash-active');
          shutterFlash.classList.add('flash-fade');
          setTimeout(() => shutterFlash.classList.remove('flash-fade'), 400);
        }, 120);
      }
    }

    // Chụp theo bước (Bước 1: Frontal, Bước 2: Profile)

    async function captureCurrentStepShot(options = {}) {
      if (isAnalyzingSnapshot || isUploadingImage) return;
      if (!isCameraActive) {
        showToast("Bật camera trước khi chụp.", "info");
        return;
      }
      if (captureStep === 2 && !frontalCaptureData) {
        showToast("Chụp ảnh chính diện trước.", "info");
        return;
      }
      if (captureStep === 2 && frontalCaptureData.deviceId
        && frontalCaptureData.deviceId !== activeCameraDeviceId) {
        cancelProfileAutoCapture();
        showToast("Camera đã đổi. Hãy chụp lại ảnh chính diện bằng camera hiện tại.", "error");
        return;
      }
      const frame = captureFrame;
      const usable = latestLandmarks && frame && frame.stable && frame.step === captureStep
        && frame.deviceId === activeCameraDeviceId && performance.now() - frame.time <= CAPTURE_MAX_AGE_MS;
      if (!usable) {
        if (captureStep === 2 && !options.automatic) {
          if (profileCaptureArmed) { cancelProfileAutoCapture(); return; }
          profileCaptureArmed = true;
          lblBtnCapture.innerText = "Đang chờ góc nghiêng…";
          document.getElementById('btnCancelAutoCapture')?.classList.remove('hidden');
          profileArmTimeout = setTimeout(() => {
            cancelProfileAutoCapture();
            showToast("Chưa lấy được góc nghiêng. Nhìn thẳng để bắt lại mặt rồi thử lại.", "info");
          }, 20000);
          showToast("Đã bật tự chụp: quay chậm, giữ cả hai mắt còn thấy và giữ yên khi thanh báo xanh.", "info");
        } else if (!options.automatic) {
          showToast("Nhìn thẳng và giữ yên cho đến khi báo sẵn sàng.", "info");
        }
        return;
      }
      cancelProfileAutoCapture();
      try {
        // Ảnh và landmarks từ cùng một lần suy luận; ảnh lưu không lật gương.
        const snapshotDataUrl = frame.canvas.toDataURL('image/jpeg', 0.95);
        const data = {
          image: snapshotDataUrl, landmarks: frame.landmarks.map(p => ({...p})),
          width: frame.width, height: frame.height,
          deviceId: frame.deviceId, cameraLabel: activeCameraLabel,
          poseYaw: frame.poseYaw, relativeYaw: frame.relativeYaw
        };
        triggerShutterFlash();
        if (captureStep === 1) {
          frontalCaptureData = data;
          profileCaptureData = null;
          imgThumbProfile.classList.add('hidden');
          placeholderProfile.classList.remove('hidden');
          btnRetakeProfile.classList.add('hidden');
          checkProfileDone.classList.add('hidden');
          imgThumbFrontal.src = snapshotDataUrl;
          imgThumbFrontal.classList.remove('hidden');
          placeholderFrontal.classList.add('hidden');
          btnRetakeFrontal.classList.remove('hidden');
          checkFrontalDone.classList.remove('hidden');
          captureStep = 2;
          updateCaptureStepUI();
          showToast("Đã lưu chính diện. Bấm bật tự chụp góc nghiêng rồi quay đầu từ từ.", "success");
        } else {
          profileCaptureData = data;
          imgThumbProfile.src = snapshotDataUrl;
          imgThumbProfile.classList.remove('hidden');
          placeholderProfile.classList.add('hidden');
          btnRetakeProfile.classList.remove('hidden');
          checkProfileDone.classList.remove('hidden');
          updateCaptureStepUI();
          showToast("Đã bắt được góc nghiêng ổn định. Bạn có thể nhìn thẳng lại.", "success");
          await triggerMultiViewAnalysis();
        }
      } catch (error) {
        console.error("Lỗi chụp ảnh:", error);
        showToast("Không thể lưu ảnh: " + error.message, "error");
      }
    }

    function retakeStepShot(step) {
      if (typeof window !== 'undefined' && window.VisionChat) window.VisionChat.setAnalysis(null);
      cancelProfileAutoCapture();
      if (step === 1) { resetTwoShotCapture(); return; }
      captureStep = step;
      if (step === 1) {
        frontalCaptureData = null;
        imgThumbFrontal.classList.add('hidden');
        placeholderFrontal.classList.remove('hidden');
        btnRetakeFrontal.classList.add('hidden');
        checkFrontalDone.classList.add('hidden');
        showToast("Hãy căn chỉnh mặt chính diện và bấm chụp lại.", "info");
      } else {
        profileCaptureData = null;
        imgThumbProfile.classList.add('hidden');
        placeholderProfile.classList.remove('hidden');
        btnRetakeProfile.classList.add('hidden');
        checkProfileDone.classList.add('hidden');
        showToast("Bật tự chụp góc nghiêng, sau đó quay đầu từ từ.", "info");
      }
      updateCaptureStepUI();
    }

    function resetTwoShotCapture() {
      if (typeof window !== 'undefined' && window.VisionChat) window.VisionChat.setAnalysis(null);
      cancelProfileAutoCapture();
      frontalCaptureData = null;
      profileCaptureData = null;
      captureStep = 1;

      imgThumbFrontal.classList.add('hidden');
      placeholderFrontal.classList.remove('hidden');
      btnRetakeFrontal.classList.add('hidden');
      checkFrontalDone.classList.add('hidden');

      imgThumbProfile.classList.add('hidden');
      placeholderProfile.classList.remove('hidden');
      btnRetakeProfile.classList.add('hidden');
      checkProfileDone.classList.add('hidden');

      updateCaptureStepUI();
      showToast("Đã làm mới quy trình chụp 2 lần.", "info");
    }

    // Kích hoạt phân tích hợp nhất đa chiều
    async function triggerMultiViewAnalysis() {
      if (isAnalyzingSnapshot) return;
      cancelProfileAutoCapture();

      if (!frontalCaptureData) {
        showToast("Bạn cần chụp ảnh mặt chính diện trước!", "error");
        captureStep = 1;
        updateCaptureStepUI();
        return;
      }

      isAnalyzingSnapshot = true;
      btnRunMultiViewAnalysis.disabled = true;
      btnRunMultiViewAnalysis.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Đang phân tích 3D...</span>';

      showToast(isPythonBackendAvailable ? "Đang gửi dữ liệu 2 góc chụp tới Python Multi-View Engine..." : "Đang hợp nhất phân tích đa chiều trực tiếp (Client Engine)...", "info");

      try {
        let data = null;

        if (isPythonBackendAvailable) {
          try {
            const payload = {
              width: frontalCaptureData.width || canvasElement.width,
              height: frontalCaptureData.height || canvasElement.height,
              image: frontalCaptureData.image,
              landmarks: frontalCaptureData.landmarks
            };

            if (profileCaptureData) {
              payload.frontal = {
                image: frontalCaptureData.image,
                landmarks: frontalCaptureData.landmarks
              };
              delete payload.image;
              delete payload.landmarks;
              payload.profile = {
                image: profileCaptureData.image,
                landmarks: profileCaptureData.landmarks
              };
            }

            const resp = await fetch(`${PYTHON_BACKEND_URL}/api/analyze_face`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });

            if (resp.ok) {
              const resJson = await resp.json();
              if (resJson.success) {
                data = resJson;
              }
            }
          } catch (fetchErr) {
            console.warn("Python backend không phản hồi, fallback sang Client Multi-View Engine:", fetchErr);
          }
        }

        // Tự động fallback sang Client Engine nếu máy chủ offline
        if (!data) {
          data = runClientMultiViewAnalysis(frontalCaptureData, profileCaptureData);
        }

        currentAnalysisReport = data;
        currentSnapshotImage = frontalCaptureData.image;
        currentModalActiveTab = 'frontal';

        displayAnalysisReport(data, frontalCaptureData.image);
        showToast("Đã hoàn tất phân tích đa chiều chuẩn xác 3D!", "success");

      } catch (err) {
        console.error("Lỗi phân tích đa chiều:", err);
        showToast(`Lỗi phân tích: ${err.message}`, "error");
      } finally {
        isAnalyzingSnapshot = false;
        btnRunMultiViewAnalysis.disabled = false;
        btnRunMultiViewAnalysis.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles text-sm"></i><span>Phân Tích Đa Chiều 3D</span>';
      }
    }

    // Hàm tương thích ngược (Hỗ trợ tải ảnh lên 1 ảnh đơn)
    async function captureAndAnalyzeFace(customSnapshotB64 = null, snapshotLandmarks = latestLandmarks, snapshotWidth = canvasElement.width, snapshotHeight = canvasElement.height) {
      if (customSnapshotB64) {
        cancelProfileAutoCapture();
        if (!snapshotLandmarks || snapshotLandmarks.length < 468) {
          throw new Error("Không tìm thấy khuôn mặt rõ nét trong ảnh tải lên!");
        }
        profileCaptureData = null;
        imgThumbProfile.classList.add('hidden');
        placeholderProfile.classList.remove('hidden');
        btnRetakeProfile.classList.add('hidden');
        checkProfileDone.classList.add('hidden');
        frontalCaptureData = {
          image: customSnapshotB64,
          landmarks: snapshotLandmarks.map(p => ({ x: p.x, y: p.y, z: p.z || 0 })),
          width: snapshotWidth,
          height: snapshotHeight
        };
        imgThumbFrontal.src = customSnapshotB64;
        imgThumbFrontal.classList.remove('hidden');
        placeholderFrontal.classList.add('hidden');
        checkFrontalDone.classList.remove('hidden');
        btnRetakeFrontal.classList.remove('hidden');
        captureStep = 2;
        updateCaptureStepUI();
        await triggerMultiViewAnalysis();
        return;
      }
      await captureCurrentStepShot();
    }

    // =========================================================================
    // CLIENT-SIDE MULTI-VIEW ENGINE (TỰ HỢP NHẤT TRÊN JS CHO GITHUB PAGES)
    // =========================================================================
    function runClientMultiViewAnalysis(frontalData, profileData) {
      const fResult = runClientAestheticAnalysis(
        frontalData.landmarks,
        frontalData.width || 640,
        frontalData.height || 480,
        frontalData.image
      );

      if (!profileData) {
        return fResult;
      }

      // Phân tích góc nghiêng client-side
      const pPoints = profileData.landmarks;
      const pW = profileData.width || 640;
      const pH = profileData.height || 480;

      const profileYaw = Math.abs(Math.atan2(
        (pPoints[234]?.z || 0) - (pPoints[454]?.z || 0),
        Math.max(1e-6, Math.abs(pPoints[454].x - pPoints[234].x))
      ) * (180 / Math.PI));
      if (profileYaw < 15 || profileYaw > 40) {
        fResult.is_multi_view = false;
        fResult.measurement_quality = {
          label: "Ước lượng hình học, không phải xếp hạng dân số hay chẩn đoán y khoa",
          warnings: ["Ảnh góc nghiêng chưa nằm trong khoảng 15–40°; điểm tổng hợp chỉ dùng ảnh chính diện."],
          profile_used: false
        };
        return fResult;
      }

      function d2d(p1, p2) {
        return Math.hypot((p1.x - p2.x) * pW, (p1.y - p2.y) * pH);
      }
      function pLineDist(p, a, b) {
        const px = p.x * pW, py = p.y * pH;
        const ax = a.x * pW, ay = a.y * pH;
        const bx = b.x * pW, by = b.y * pH;
        const abx = bx - ax, aby = by - ay;
        const mag = Math.hypot(abx, aby) + 1e-6;
        return (abx * (py - ay) - aby * (px - ax)) / mag;
      }
      function angleDeg(a, b, c) {
        const abx = (a.x - b.x) * pW, aby = (a.y - b.y) * pH;
        const cbx = (c.x - b.x) * pW, cby = (c.y - b.y) * pH;
        const dot = abx * cbx + aby * cby;
        const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby) + 1e-6;
        return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * (180 / Math.PI);
      }

      const pronasale = pPoints[1];
      const subnasale = pPoints[2];
      const labraleSup = pPoints[0];
      const labraleInf = pPoints[17];
      const pogonion = pPoints[152];
      const nasion = pPoints[168];
      const rhinion = pPoints[6];

      const distL = Math.abs((pPoints[234].x - pPoints[1].x) * pW);
      const distR = Math.abs((pPoints[454].x - pPoints[1].x) * pW);
      const isLeftProfile = distL < distR;

      const gonion = isLeftProfile ? pPoints[172] : pPoints[397];
      const earTragus = isLeftProfile ? pPoints[234] : pPoints[454];

      const elineDistUpper = pLineDist(labraleSup, pronasale, pogonion);
      const elineDistLower = pLineDist(labraleInf, pronasale, pogonion);
      const faceScale = d2d(nasion, pogonion) + 1e-6;
      const normLowerLip = (elineDistLower / faceScale) * 100.0;

      let chinProj = "Cằm đạt chuẩn tỷ lệ thẩm mỹ Ricketts E-line";
      let chinComment = "Cằm và môi có độ dốc hài hòa trên đường thẩm mỹ chuẩn.";
      let chinScore = 92.0;

      if (normLowerLip > 5.5) {
        chinProj = "Cằm lẹm (Retrognathia) / Môi nhô trước đường E-line";
        chinComment = "Đường E-line cho thấy cằm bị thụt lùi so với trục mũi và môi, làm góc nghiêng thiếu độ sắc nét.";
        chinScore = 65.0;
      } else if (normLowerLip < -3.5) {
        chinProj = "Cằm nhô / Cằm phát triển quá mức (Prognathia)";
        chinComment = "Cằm phát triển chìa ra trước nhiều hơn trục thẩm mỹ E-line.";
        chinScore = 72.0;
      }

      const nasolabialDeg = Math.round(angleDeg(pronasale, subnasale, labraleSup) * 10) / 10;
      let nasolabialStatus = nasolabialDeg >= 90 && nasolabialDeg <= 106 ? `Góc mũi môi lý tưởng (${nasolabialDeg}°)` :
                             nasolabialDeg < 90 ? `Góc mũi môi nhọn (${nasolabialDeg}° < 90°)` : `Góc mũi môi tù (${nasolabialDeg}° > 106°)`;

      const humpDist = pLineDist(rhinion, nasion, pronasale);
      const normHump = (humpDist / faceScale) * 100.0;
      let bridgeType = "Thẳng tự nhiên";
      let bridgeDesc = "Sống mũi thẳng tắp thanh thoát theo góc nhìn nghiêng.";
      if (normHump > 2.0) {
        bridgeType = "Gồ xương nhẹ";
        bridgeDesc = "Sống mũi gồ nhẹ (Dorsal Hump) ở phần xương chính mũi.";
      } else if (normHump < -2.2) {
        bridgeType = "Võng / Tẹt nhẹ";
        bridgeDesc = "Sống mũi trũng võng nhẹ ở góc nghiêng.";
      }

      const pGonial = Math.round(angleDeg(earTragus, gonion, pogonion) * 10) / 10;
      let pJawDesc = pGonial < 118 ? `Góc hàm vuông vức sắc nét (${pGonial}°)` :
                     pGonial <= 128 ? `Góc hàm nghiêng thanh tú (${pGonial}°)` : `Góc hàm nghiêng mở rộng (${pGonial}°)`;

      const pScore = Math.round((chinScore * 0.40 + (nasolabialDeg >= 90 && nasolabialDeg <= 106 ? 92 : 72) * 0.35 + 85 * 0.25) * 10) / 10;

      const profileAnalysis = {
        profile_aesthetic_score: pScore,
        view_side: isLeftProfile ? "Góc nghiêng Trái" : "Góc nghiêng Phải",
        ricketts_eline: {
          chin_projection: chinProj,
          chin_comment: chinComment,
          upper_lip_offset_px: Math.round(elineDistUpper * 10) / 10,
          lower_lip_offset_px: Math.round(elineDistLower * 10) / 10,
          score: chinScore
        },
        nasolabial_angle_deg: nasolabialDeg,
        nasolabial_status: nasolabialStatus,
        nasal_bridge_profile: {
          type: bridgeType,
          description: bridgeDesc
        },
        profile_gonial_angle_deg: pGonial,
        profile_jaw_description: pJawDesc,
        visual_guides: {
          eline: [
            { x: pronasale.x * pW, y: pronasale.y * pH },
            { x: pogonion.x * pW, y: pogonion.y * pH }
          ],
          nasolabial_rays: [
            { x: pronasale.x * pW, y: pronasale.y * pH },
            { x: subnasale.x * pW, y: subnasale.y * pH },
            { x: labraleSup.x * pW, y: labraleSup.y * pH }
          ],
          jaw_profile_triangle: [
            { x: earTragus.x * pW, y: earTragus.y * pH },
            { x: gonion.x * pW, y: gonion.y * pH },
            { x: pogonion.x * pW, y: pogonion.y * pH }
          ]
        }
      };

      // 3D Invariant Face Shape Cross-Check
      const fwhr = fResult.proportions.length_to_width_ratio;
      const frontJaw = fResult.jawline.average_jaw_angle_deg;

      if (fwhr > 1.55) {
        fResult.proportions.face_shape = "Mặt Dài / Chữ Nhật (Oblong)";
        fResult.proportions.face_shape_description = "Tỷ lệ chiều dài khuôn mặt lớn xác nhận từ cả góc thẳng lẫn nghiêng.";
      } else if (fwhr < 1.25) {
        if (pGonial < 120 || frontJaw < 120) {
          fResult.proportions.face_shape = "Mặt Vuông (Square)";
          fResult.proportions.face_shape_description = "Khung xương hàm bạnh và góc cạnh xác thực từ 2 góc chụp.";
        } else {
          fResult.proportions.face_shape = "Mặt Tròn (Round)";
          fResult.proportions.face_shape_description = "Đường nét má và hàm mềm mại bầu bĩnh, góc xương không gắt.";
        }
      } else if (chinProj.includes("lẹm") && fwhr < 1.35) {
        fResult.proportions.face_shape = "Mặt Tròn (Round / Cằm lẹm)";
        fResult.proportions.face_shape_description = "Góc nghiêng xác nhận độ lùi cằm làm phần dưới mặt trông ngắn hơn.";
      } else if (frontJaw > 124 && (pGonial >= 120 && pGonial <= 130)) {
        fResult.proportions.face_shape = "Mặt Trái Xoan (Oval)";
        fResult.proportions.face_shape_description = "Dáng mặt cân đối chuẩn mực xác nhận từ cả 2 góc nhìn.";
      }

      fResult.profile = profileAnalysis;
      fResult.is_multi_view = true;
      fResult.overall_harmony_score = Math.round((fResult.overall_harmony_score * 0.80 + pScore * 0.20) * 10) / 10;

      const sc = fResult.overall_harmony_score;
      fResult.overall_grade = sc >= 85 ? "Điểm tổng hợp cao theo tiêu chí tham khảo" :
                              sc >= 75 ? "Điểm tổng hợp khá theo tiêu chí tham khảo" :
                              sc >= 63 ? "Điểm tổng hợp trung bình theo tiêu chí tham khảo" :
                              sc >= 50 ? "Một số tỷ lệ lệch khỏi mốc tham khảo" : "Nhiều tỷ lệ lệch khỏi mốc tham khảo";
      fResult.measurement_quality = {
        label: "Ước lượng hình học, không phải xếp hạng dân số hay chẩn đoán y khoa",
        warnings: [], profile_used: true
      };

      return fResult;
    }

    // =========================================================================
    // CLIENT-SIDE AESTHETIC DIAGNOSTIC ENGINE (CHẠY 100% ĐỘC LẬP TRÊN WEB/GITHUB)
    // =========================================================================
    function runClientAestheticAnalysis(points, imgW, imgH, snapshotDataUrl) {
      function d2d(p1, p2) {
        return Math.hypot((p1.x - p2.x) * imgW, (p1.y - p2.y) * imgH);
      }
      function pLineDist(p, a, b) {
        const px = p.x * imgW, py = p.y * imgH;
        const ax = a.x * imgW, ay = a.y * imgH;
        const bx = b.x * imgW, by = b.y * imgH;
        const abx = bx - ax, aby = by - ay;
        const mag = Math.hypot(abx, aby) + 1e-6;
        return (abx * (py - ay) - aby * (px - ax)) / mag;
      }
      function angleDeg(a, b, c) {
        const abx = (a.x - b.x) * imgW, aby = (a.y - b.y) * imgH;
        const cbx = (c.x - b.x) * imgW, cby = (c.y - b.y) * imgH;
        const dot = abx * cbx + aby * cby;
        const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby) + 1e-6;
        return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * (180 / Math.PI);
      }

      // Xác định chân tóc Trichion thực tế thay vì lấy thô mốc xương trán số 10
      function estimateTrueTrichion(pts, w, h) {
        const gPt = pts[9];
        const p10 = pts[10];
        const sPt = pts[2];
        const cPt = pts[152];

        const gx = gPt.x * w, gy = gPt.y * h;
        const p10x = p10.x * w, p10y = p10.y * h;
        const dx = p10x - gx;
        const dy = p10y - gy;
        let dist910 = Math.hypot(dx, dy);
        if (dist910 < 1.0) dist910 = 1.0;
        const ux = dx / dist910;
        const uy = dy / dist910;

        const midH = Math.hypot((sPt.x - gPt.x) * w, (sPt.y - gPt.y) * h);
        const lowH = Math.hypot((cPt.x - sPt.x) * w, (cPt.y - sPt.y) * h);
        const refThird = (midH + lowH) / 2.0;

        // Chuẩn nhân trắc học Farkas: Tầng trán chuẩn = 1.50 - 1.55 lần dist(9, 10)
        let upperH = Math.max(dist910 * 1.48, Math.min(dist910 * 1.85, refThird * 0.98));
        upperH = Math.max(dist910 * 1.15, Math.min(dist910 * 2.15, upperH));

        const trichionPx = gx + ux * upperH;
        const trichionPy = gy + uy * upperH;
        return {
          x: trichionPx / w,
          y: trichionPy / h,
          px: trichionPx,
          py: trichionPy
        };
      }

      const trichion = estimateTrueTrichion(points, imgW, imgH);
      const forehead = trichion; // Khắc phục triệt để lỗi trán bị đánh giá thấp do mốc 10
      const glabella = points[9];
      const subnasale = points[2];
      const chin = points[152];

      const hasIris = points.length >= 478;
      const eyeL = hasIris ? points[468] : { x: (points[159].x + points[145].x) / 2, y: (points[159].y + points[145].y) / 2 };
      const eyeR = hasIris ? points[473] : { x: (points[386].x + points[374].x) / 2, y: (points[386].y + points[374].y) / 2 };

      const pairs = [
        ["Mắt (Tâm đồng tử)", eyeL, eyeR, 1.25],
        ["Khóe mắt ngoài", points[33], points[362], 1.0],
        ["Khóe mắt trong", points[133], points[263], 1.0],
        ["Gò má", points[234], points[454], 1.15],
        ["Cánh mũi", points[102], points[331], 1.05],
        ["Khóe miệng", points[61], points[291], 1.1],
        ["Góc xương hàm", points[172], points[397], 1.2],
        ["Đuôi chân mày", points[70] || points[33], points[300] || points[362], 0.85]
      ];

      let totW = 0, weightedSym = 0, symDetails = [], asymmetryFlaws = [];
      pairs.forEach(([name, pl, pr, w]) => {
        const dl = Math.abs(pLineDist(pl, forehead, chin));
        const dr = Math.abs(pLineDist(pr, forehead, chin));
        const diff = Math.abs(dl - dr);
        const avg = (dl + dr) / 2.0 + 1e-4;
        const rel = diff / avg;
        const score = Math.max(30, Math.min(100, 100 - (rel * 140)));
        weightedSym += score * w;
        totW += w;
        if (diff > 4.5) {
          const side = dr > dl ? "bên phải xa trục hơn" : "bên trái xa trục hơn";
          asymmetryFlaws.push(`${name} lệch ${diff.toFixed(1)}px (${side})`);
        }
        symDetails.push({ feature: name, score: Math.round(score * 10) / 10, diff_px: Math.round(diff * 10) / 10 });
      });

      const eyeDy = (eyeR.y - eyeL.y) * imgH;
      const eyeDx = (eyeR.x - eyeL.x) * imgW;
      const eyeTilt = Math.round(Math.atan2(eyeDy, eyeDx) * (180 / Math.PI) * 10) / 10;
      const overallSym = Math.round((weightedSym / totW) * 10) / 10;
      let symEval = overallSym >= 88 && Math.abs(eyeTilt) <= 0.8 ? "Điểm đối xứng cao theo phép đo hình học" :
                    overallSym >= 76 ? "Độ lệch thấp theo ngưỡng đo tham khảo" :
                    overallSym >= 64 ? "Lệch tự nhiên phổ biến (Thói quen nhai một bên)" : "Bất đối xứng rõ rệt";

      const upperH = d2d(forehead, glabella);
      const middleH = d2d(glabella, subnasale);
      const lowerH = d2d(subnasale, chin);
      const totH = upperH + middleH + lowerH + 1e-6;
      const upperPct = Math.round((upperH / totH) * 1000) / 10;
      const middlePct = Math.round((middleH / totH) * 1000) / 10;
      const lowerPct = Math.round((lowerH / totH) * 1000) / 10;

      const dev3 = Math.abs(upperPct - 33.3) + Math.abs(middlePct - 33.3) + Math.abs(lowerPct - 33.3);
      const thirdsHarm = Math.round(Math.max(40, Math.min(98, 100 - dev3 * 3.8)) * 10) / 10;

      let thirdsNotes = [];
      if (upperPct > 36.5) thirdsNotes.push(`Tầng trán chiếm ${upperPct}% (trán cao/dô)`);
      else if (upperPct < 29.5) thirdsNotes.push(`Tầng trán chỉ chiếm ${upperPct}% (trán ngắn/hẹp)`);
      if (middlePct > 37.0) thirdsNotes.push(`Tầng mũi dài (${middlePct}%)`);
      else if (middlePct < 29.5) thirdsNotes.push(`Tầng giữa ngắn (${middlePct}%)`);
      if (lowerPct > 36.5) thirdsNotes.push(`Tầng cằm dài (${lowerPct}%)`);
      else if (lowerPct < 29.5) thirdsNotes.push(`Tầng cằm ngắn (${lowerPct}%, cằm hơi lẹm)`);
      if (!thirdsNotes.length) thirdsNotes.push("3 tầng phân bổ tương đối đồng đều theo chuẩn 1:1:1.");

      const faceL = d2d(forehead, chin);
      const cheekW = d2d(points[234], points[454]) + 1e-6;
      const ratioHW = Math.round((faceL / cheekW) * 100) / 100;
      const goldenFit = Math.round(Math.max(40, Math.min(98, 100 - Math.abs(ratioHW - 1.618) * 60)) * 10) / 10;

      let faceShape = "Mặt Trái Xoan (Oval)";
      let shapeDesc = "Dáng mặt cân đối chuẩn mực, đường viền thanh thoát tự nhiên.";
      if (ratioHW > 1.58) {
        faceShape = "Mặt Dài / Chữ Nhật (Oblong)";
        shapeDesc = "Chiều dài khuôn mặt nổi bật hơn chiều ngang. Dễ tạo cảm giác mặt gầy.";
      } else if (ratioHW < 1.22) {
        faceShape = "Mặt Tròn (Round)";
        shapeDesc = "Chiều dài và rộng xấp xỉ nhau, má bầu bĩnh, trẻ lâu nhưng thiếu góc cạnh V-line.";
      }

      const alarW = d2d(points[102], points[331]);
      const noseL = d2d(points[168] || points[9], subnasale) + 1e-6;
      const noseRatio = Math.round((alarW / noseL) * 100) / 100;
      const noseScore = Math.round(Math.max(45, Math.min(97, 100 - Math.abs(noseRatio - 0.67) * 75)) * 10) / 10;
      const bridgeDevPx = Math.abs(pLineDist(points[1], forehead, chin));
      const bridgeDev = Math.round((bridgeDevPx / cheekW) * 1000) / 10;
      const bridgeComment = bridgeDev > 0.5 ? `Đỉnh mũi lệch ${bridgeDev}% bề rộng mặt trong ảnh; góc chụp có thể ảnh hưởng.` : "Đỉnh mũi gần trục giữa trong ảnh.";
      const alarComment = noseRatio > 0.74 ? "Cánh mũi hơi nở rộng so với chiều dài sống mũi." : "Cánh mũi thon gọn cân đối.";

      const gonialL = angleDeg(points[234], points[172], chin);
      const gonialR = angleDeg(points[454], points[397], chin);
      const avgGonial = Math.round(((gonialL + gonialR) / 2) * 10) / 10;
      const chinApex = Math.round(angleDeg(points[172], chin, points[397]) * 10) / 10;
      const jawScore = Math.round(Math.max(45, Math.min(98, 100 - Math.abs(avgGonial - 124.0) * 1.8)) * 10) / 10;
      let chinType = chinApex < 92 ? "Cằm V-line" : chinApex < 112 ? "Cằm tròn đều" : "Cằm bạnh / vuông";
      let chinFlaw = avgGonial < 118 ? "Khung xương hàm dưới bạnh vuông, góc hàm sắc nhưng thiếu độ thon." :
                     chinApex > 115 ? "Đáy cằm phẳng ngang, làm phần dưới khuôn mặt trông hơi thô." :
                     "Đường nét cằm và góc hàm hài hòa thanh thoát.";

      // Landmark-only fallback cannot measure skin texture or color reliably.
      const skinSmooth = null;
      const skinUnif = null;
      const darkCircles = null;
      const oiliness = null;
      const skinAlerts = ["Chưa đo tình trạng da: chế độ trình duyệt chỉ có điểm mốc khuôn mặt."];

      const hairAdvice = {
        for_men: faceShape.includes("Dài") ? "Side part vuốt nhẹ hoặc uốn layer tạo phồng 2 bên tai." : "Undercut gọn gàng hoặc Fade hai bên tạo sự nam tính.",
        for_women: faceShape.includes("Dài") ? "Tóc mái thưa hoặc xoăn sóng lơi ngang vai để rút ngắn cảm giác chiều dài mặt." : "Tóc tỉa layer nhẹ ôm xương quai hàm.",
        corrective_guidelines: upperPct > 36.5 ? "Để tóc mái (mái bay/mái thưa) giúp che bớt vầng trán cao và tạo chiều sâu gương mặt." : "Giữ chân tóc phồng nhẹ tự nhiên.",
        target_focus: "Cân bằng tỷ lệ 3 tầng và làm mềm góc hàm"
      };

      const harmonyScore = Math.round(((overallSym * 0.25 + thirdsHarm * 0.25 + noseScore * 0.18 + jawScore * 0.17) / 0.85) * 10) / 10;
      const overallGrade = harmonyScore >= 85 ? "Điểm tổng hợp cao theo tiêu chí tham khảo" :
                           harmonyScore >= 75 ? "Điểm tổng hợp khá theo tiêu chí tham khảo" :
                           harmonyScore >= 63 ? "Điểm tổng hợp trung bình theo tiêu chí tham khảo" :
                           harmonyScore >= 50 ? "Một số tỷ lệ lệch khỏi mốc tham khảo" : "Nhiều tỷ lệ lệch khỏi mốc tham khảo";

      return {
        success: true,
        overall_harmony_score: harmonyScore,
        overall_grade: overallGrade,
        symmetry: {
          overall_symmetry_score: overallSym,
          eye_tilt_deg: eyeTilt,
          evaluation: symEval,
          details: symDetails,
          asymmetry_flaws: asymmetryFlaws,
          midline_axis: { top: { x: forehead.x * imgW, y: forehead.y * imgH }, bottom: { x: chin.x * imgW, y: chin.y * imgH } }
        },
        proportions: {
          face_shape: faceShape,
          face_shape_description: shapeDesc,
          length_to_width_ratio: ratioHW,
          golden_ratio_fit_score: goldenFit,
          rule_of_thirds: {
            upper_third_pct: upperPct,
            middle_third_pct: middlePct,
            lower_third_pct: lowerPct,
            harmony_score: thirdsHarm,
            evaluation: thirdsNotes
          },
          honest_evaluation: thirdsNotes.join("; ")
        },
        nose: {
          nose_aesthetic_score: noseScore,
          width_to_length_ratio: noseRatio,
          alar_status: alarComment,
          alar_comment: alarComment,
          bridge_status: bridgeComment,
          bridge_comment: bridgeComment,
          bridge_deviation_px: Math.round(bridgeDevPx * 10) / 10,
          bridge_deviation_face_width_pct: bridgeDev
        },
        jawline: {
          jawline_sharpness_score: jawScore,
          average_jaw_angle_deg: avgGonial,
          chin_type: chinType,
          chin_apex_angle_deg: chinApex,
          jaw_to_cheek_ratio: Math.round((d2d(points[172], points[397]) / cheekW) * 100) / 100,
          jawline_evaluation: chinFlaw,
          chin_flaw: chinFlaw
        },
        skin: {
          smoothness_score: skinSmooth,
          uniformity_score: skinUnif,
          dark_circles_index: darkCircles,
          oiliness_score: oiliness,
          skin_tone: "Chưa đo",
          undertone: "",
          hex_color: "#808080",
          skin_health_evaluation: skinAlerts
        },
        hair: {
          hairline_type: upperPct > 36.5 ? "Đường Chân Tóc Cao / Trán Dô" : upperPct < 29.5 ? "Đường Chân Tóc Thấp" : "Tròn Đều Tự Nhiên",
          hairline_comment: upperPct > 36.5 ? "Vầng trán rộng, đường chân tóc cao tạo nét sáng sủa, thông tuệ." : upperPct < 29.5 ? "Đường chân tóc thấp, vầng trán hẹp." : "Đường chân tóc tự nhiên, cân đối theo tỷ lệ 3 tầng mặt.",
          dominant_hair_color: "Đen Tự Nhiên",
          hair_recommendations: hairAdvice
        },
        visual_guides: {
          midline: [{ x: forehead.x * imgW, y: forehead.y * imgH }, { x: chin.x * imgW, y: chin.y * imgH }],
          thirds_lines: [
            { name: "Chân tóc (Trichion)", y: Math.round(forehead.y * imgH) },
            { name: "Chân mày (Glabella)", y: Math.round(glabella.y * imgH) },
            { name: "Chân mũi (Subnasale)", y: Math.round(subnasale.y * imgH) },
            { name: "Đáy cằm (Menton)", y: Math.round(chin.y * imgH) }
          ],
          jawline_polygon: [
            { x: points[172].x * imgW, y: points[172].y * imgH },
            { x: chin.x * imgW, y: chin.y * imgH },
            { x: points[397].x * imgW, y: points[397].y * imgH }
          ],
          nose_triangle: [
            { x: (points[168] || points[1]).x * imgW, y: (points[168] || points[1]).y * imgH },
            { x: points[102].x * imgW, y: points[102].y * imgH },
            { x: points[331].x * imgW, y: points[331].y * imgH }
          ]
        },
        measurement_quality: {
          label: "Ước lượng hình học, không phải xếp hạng dân số hay chẩn đoán y khoa",
          warnings: ["Phân tích dự phòng trên trình duyệt; tình trạng da chưa được đo."],
          profile_used: false
        }
      };
    }

    async function handleImageUpload(e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (isUploadingImage || isAnalyzingSnapshot) {
        showToast("Đang xử lý ảnh, vui lòng chờ hoàn tất.", "info");
        return;
      }

      isUploadingImage = true;
      let imageMesh = null;
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("Không thể đọc tệp ảnh."));
          reader.onabort = () => reject(new Error("Đã hủy đọc tệp ảnh."));
          reader.readAsDataURL(file);
        });
        const img = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("Không thể mở ảnh. Hãy dùng ảnh JPG hoặc PNG hợp lệ."));
          image.src = dataUrl;
        });
        showToast("Đang phát hiện điểm mốc trên ảnh tải lên...", "info");

        // Mô hình riêng cho ảnh tĩnh: camera không thể ghi đè kết quả.
        let imageLandmarks = null;
        imageMesh = createFaceMeshEngine();
        imageMesh.onResults((results) => {
          const points = results.multiFaceLandmarks && results.multiFaceLandmarks[0];
          imageLandmarks = points ? points.map(p => ({ x: p.x, y: p.y, z: p.z || 0 })) : null;
        });
        if (typeof imageMesh.initialize === 'function') {
          await imageMesh.initialize();
        }
        await imageMesh.send({ image: img });
        if (!imageLandmarks || imageLandmarks.length < 468) {
          throw new Error("Không tìm thấy khuôn mặt rõ nét trong ảnh tải lên!");
        }
        await captureAndAnalyzeFace(dataUrl, imageLandmarks, img.naturalWidth, img.naturalHeight);
      } catch (error) {
        console.error("Lỗi xử lý ảnh tải lên:", error);
        showToast(error.message || "Không thể xử lý ảnh tải lên.", "error");
      } finally {
        if (imageMesh && typeof imageMesh.close === 'function') {
          try {
            await imageMesh.close();
          } catch (closeError) {
            console.warn("Không thể đóng mô hình ảnh:", closeError);
          }
        }
        isUploadingImage = false;
      }
    }

    function displayAnalysisReport(data, snapshotDataUrl) {
      if (typeof window !== 'undefined' && window.VisionChat) window.VisionChat.setAnalysis(data);
      // 1. Overall heuristic score and capture-quality note.
      txtOverallHarmonyScore.innerText = data.overall_harmony_score;
      badgeOverallGrade.innerText = data.overall_grade;
      const qualityNote = document.getElementById('analysisQualityNote');
      if (qualityNote) {
        const measurement = data.measurement_quality;
        const warnings = Array.isArray(measurement?.warnings) ? measurement.warnings : [];
        qualityNote.textContent = [measurement?.label || 'Điểm tham khảo từ các tỷ lệ hình học.', ...warnings].join(' ');
        qualityNote.classList.toggle('text-amber-300', warnings.length > 0);
        qualityNote.classList.toggle('text-slate-400', warnings.length === 0);
      }

      const score = data.overall_harmony_score;
      if (score >= 85) {
        badgeOverallGrade.className = "text-[10px] px-2.5 py-0.5 rounded-full font-mono bg-emerald-950 text-emerald-300 border border-emerald-700 font-bold";
      } else if (score >= 75) {
        badgeOverallGrade.className = "text-[10px] px-2.5 py-0.5 rounded-full font-mono bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold";
      } else if (score >= 63) {
        badgeOverallGrade.className = "text-[10px] px-2.5 py-0.5 rounded-full font-mono bg-blue-950 text-blue-300 border border-blue-800 font-semibold";
      } else if (score >= 50) {
        badgeOverallGrade.className = "text-[10px] px-2.5 py-0.5 rounded-full font-mono bg-amber-950 text-amber-300 border border-amber-800 font-semibold";
      } else {
        badgeOverallGrade.className = "text-[10px] px-2.5 py-0.5 rounded-full font-mono bg-rose-950 text-rose-300 border border-rose-800 font-semibold";
      }

      txtShapeBadge.innerText = data.proportions.face_shape;
      txtShapeDescription.innerText = data.proportions.face_shape_description;

      // 2. Độ Cân Đối (Facial Symmetry) - Chẩn đoán sai lệch thực tế
      txtSymmetryScore.innerText = `${data.symmetry.overall_symmetry_score}%`;
      txtSymmetryLevel.innerText = data.symmetry.evaluation;
      txtEyeTilt.innerText = `${data.symmetry.eye_tilt_deg}°`;

      listSymmetryDetails.innerHTML = '';
      if (data.symmetry.details) {
        data.symmetry.details.forEach(item => {
          const card = document.createElement('div');
          card.className = 'flex items-center justify-between p-2 rounded-lg bg-surface-900 border border-surface-700/80';
          card.innerHTML = `
            <span class="text-slate-300">${item.feature}:</span>
            <div class="flex items-center gap-2">
              <span class="text-[10px] text-slate-500 font-mono">(Lệch ${item.diff_face_width_pct ?? item.diff_px}% ${item.diff_face_width_pct !== undefined ? 'bề rộng mặt' : ''})</span>
              <strong class="font-mono text-cyan-400 font-bold">${item.score}%</strong>
            </div>
          `;
          listSymmetryDetails.appendChild(card);
        });
      }

      listAsymmetryFlaws.innerHTML = '';
      if (data.symmetry.asymmetry_flaws && data.symmetry.asymmetry_flaws.length > 0) {
        data.symmetry.asymmetry_flaws.forEach(flaw => {
          const li = document.createElement('li');
          li.className = 'leading-relaxed';
          li.innerText = flaw;
          listAsymmetryFlaws.appendChild(li);
        });
      } else {
        const li = document.createElement('li');
        li.className = 'text-emerald-400 list-none flex items-center gap-1.5';
        li.innerHTML = '<i class="fa-solid fa-check text-xs"></i><span>Không có sai lệch nào vượt ngưỡng hiển thị trong ảnh này.</span>';
        listAsymmetryFlaws.appendChild(li);
      }

      // 3. Tỷ Lệ Khuôn Mặt & Quy Tắc 3 Phần (Proportions)
      txtGoldenFitScore.innerText = `${data.proportions.golden_ratio_fit_score}%`;
      txtUpperThird.innerText = `${data.proportions.rule_of_thirds.upper_third_pct}%`;
      txtMiddleThird.innerText = `${data.proportions.rule_of_thirds.middle_third_pct}%`;
      txtLowerThird.innerText = `${data.proportions.rule_of_thirds.lower_third_pct}%`;
      txtFwhrRatio.innerText = data.proportions.length_to_width_ratio;
      txtThirdsHarmony.innerText = `${data.proportions.rule_of_thirds.harmony_score}%`;
      
      const thirdsDesc = data.proportions.honest_evaluation || 
        (data.proportions.rule_of_thirds && data.proportions.rule_of_thirds.evaluation ? data.proportions.rule_of_thirds.evaluation.join('. ') : '3 tầng phân bổ tương đối đồng đều.');
      txtThirdsHonestEvaluation.innerText = thirdsDesc;

      // 4. Mũi (Nose)
      txtNoseScore.innerText = `${data.nose.nose_aesthetic_score}%`;
      txtNoseWidthLength.innerText = data.nose.width_to_length_ratio;
      txtAlarStatus.innerText = data.nose.alar_status;
      txtBridgeStatus.innerText = data.nose.bridge_status;
      txtBridgeDev.innerText = data.nose.bridge_deviation_face_width_pct == null
        ? `Độ lệch: ${data.nose.bridge_deviation_px}px`
        : `Độ lệch: ${data.nose.bridge_deviation_face_width_pct}% bề rộng mặt`;
      txtBridgeComment.innerText = data.nose.bridge_comment || data.nose.bridge_status;
      txtAlarComment.innerText = data.nose.alar_comment || data.nose.alar_status;

      // 5. Đường Viền Hàm & Cằm (Jawline & Chin)
      txtJawSharpness.innerText = `${data.jawline.jawline_sharpness_score}%`;
      txtJawAngle.innerText = `${data.jawline.average_jaw_angle_deg || (data.jawline.gonial_angle_deg && data.jawline.gonial_angle_deg.average_deg) || 124.5}°`;
      txtChinType.innerText = data.jawline.chin_type;
      txtChinAngle.innerText = `Góc đỉnh cằm: ${data.jawline.chin_apex_angle_deg}°`;
      txtJawCheekRatio.innerText = data.jawline.jaw_to_cheek_ratio;
      txtJawEvaluation.innerText = data.jawline.jawline_evaluation;
      txtChinFlaw.innerText = data.jawline.chin_flaw || data.jawline.jawline_evaluation;

      // 5.5. Chẩn Đoán Trắc Diện Góc Nghiêng (Profile Diagnostics - Hiển thị khi có dữ liệu)
      if (data.profile && panelProfileDiagnostics) {
        panelProfileDiagnostics.classList.remove('hidden');
        txtProfileAestheticScore.innerText = `${data.profile.profile_aesthetic_score}%`;
        txtProfileViewSide.innerText = data.profile.view_side || "Góc nghiêng";

        const pRicketts = data.profile.ricketts_eline;
        if (pRicketts) {
          txtElineScore.innerText = `${pRicketts.score}%`;
          txtChinProjection.innerText = pRicketts.chin_projection;
          txtChinProjectionComment.innerText = pRicketts.chin_comment;
        }

        txtNasolabialDeg.innerText = `${data.profile.nasolabial_angle_deg}°`;
        txtNasolabialStatus.innerText = data.profile.nasolabial_status;

        if (data.profile.nasal_bridge_profile) {
          txtNasalBridgeProfile.innerText = data.profile.nasal_bridge_profile.description;
        }

        txtProfileGonialDeg.innerText = `${data.profile.profile_gonial_angle_deg}°`;
        txtProfileJawDesc.innerText = data.profile.profile_jaw_description;
      } else if (panelProfileDiagnostics) {
        panelProfileDiagnostics.classList.add('hidden');
      }

      // 6. Tình Trạng Da (Skin Health) - Chẩn đoán ROI thực tế
      const skinMetric = value => value == null ? 'Chưa đo' : `${value}%`;
      txtSkinSmoothScore.innerText = skinMetric(data.skin.smoothness_score);
      txtSkinSmoothness.innerText = skinMetric(data.skin.smoothness_score);
      txtSkinUniformity.innerText = skinMetric(data.skin.uniformity_score);
      txtDarkCircles.innerText = skinMetric(data.skin.dark_circles_index);
      txtSkinOiliness.innerText = skinMetric(data.skin.oiliness_score);
      txtSkinToneDetail.innerText = [data.skin.skin_tone, data.skin.undertone].filter(Boolean).join(' • ');
      txtSkinToneName.innerText = data.skin.skin_tone;
      dotSkinColor.style.backgroundColor = data.skin.hex_color || '#e4c5b0';
      paletteSkinColor.style.backgroundColor = data.skin.hex_color || '#e4c5b0';
      txtSkinHex.innerText = data.skin.hex_color || '#e4c5b0';

      listSkinHealthAlerts.innerHTML = '';
      if (Array.isArray(data.skin.skin_health_evaluation) && data.skin.skin_health_evaluation.length > 0) {
        data.skin.skin_health_evaluation.forEach(item => {
          const li = document.createElement('li');
          li.className = 'flex items-start gap-1.5 leading-relaxed';
          li.innerHTML = `<span class="text-rose-400 font-bold">•</span><span>${escapeHtml(item)}</span>`;
          listSkinHealthAlerts.appendChild(li);
        });
      } else if (typeof data.skin.skin_health_evaluation === 'string') {
        const li = document.createElement('li');
        li.className = 'flex items-start gap-1.5';
        li.innerHTML = `<span class="text-rose-400 font-bold">•</span><span>${escapeHtml(data.skin.skin_health_evaluation)}</span>`;
        listSkinHealthAlerts.appendChild(li);
      } else {
        listSkinHealthAlerts.innerHTML = '<li class="text-emerald-400 flex items-center gap-1.5"><i class="fa-solid fa-check text-xs"></i><span>Tình trạng da tương đối ổn định, không phát hiện quầng thâm hay sần sùi bất thường.</span></li>';
      }
      txtSkinAdvice.innerText = data.skin.smoothness_score == null
        ? 'Tình trạng da chưa được phân tích trong chế độ dự phòng trên trình duyệt.'
        : 'Kết quả pixel có thể thay đổi theo ánh sáng, camera và lớp trang điểm; chỉ dùng để tham khảo.';

      // 7. Kiểu Tóc & Khắc Phục Khuyết Điểm (Hair & Corrective Styling)
      txtHairlineType.innerText = data.hair.hairline_type;
      txtDominantColor.innerText = data.hair.dominant_hair_color;
      txtHairlineComment.innerText = data.hair.hairline_comment || '';
      txtHairMen.innerText = data.hair.hair_recommendations.for_men;
      txtHairWomen.innerText = data.hair.hair_recommendations.for_women;
      txtHairCorrective.innerText = data.hair.hair_recommendations.corrective_guidelines || 'Tạo phồng ở chân tóc để cân đối khung xương mặt.';
      txtHairFocus.innerText = `🎯 Mục tiêu chỉnh thể: ${data.hair.hair_recommendations.target_focus || 'Tối ưu độ cân đối tổng thể'}`;

      // 8. Vẽ ảnh và lớp trắc hình lên Canvas Báo Cáo
      drawReportCanvasOverlay();

      // Mở modal
      document.getElementById('profileGuideLegend')?.classList.add('hidden');
      modalAnalysisReport.classList.remove('hidden');
    }

    function closeAnalysisReport() {
      modalAnalysisReport.classList.add('hidden');
    }

    function drawReportCanvasOverlay() {
      if (!currentAnalysisReport || !currentSnapshotImage) return;

      const snapshotTab = currentModalActiveTab;
      const snapshotUrl = currentSnapshotImage;
      const report = currentAnalysisReport;
      const snapshotPoints = snapshotTab === 'profile' ? profileCaptureData?.landmarks : frontalCaptureData?.landmarks;
      const img = new Image();
      img.onload = () => {
        if (currentModalActiveTab !== snapshotTab || currentSnapshotImage !== snapshotUrl) return;
        snapshotReportCanvas.width = img.width;
        snapshotReportCanvas.height = img.height;
        snapshotCtx.clearRect(0, 0, img.width, img.height);
        snapshotCtx.drawImage(img, 0, 0, img.width, img.height);

        const rep = report;
        const g = snapshotTab === 'profile' ? rep.profile?.visual_guides : rep.visual_guides;
        // Báo cáo vẫn vẽ điểm mốc nếu không có đường hướng dẫn.

        // Vẽ các đường trắc hình
        if (chkModalShowLines.checked && g) {
          if (snapshotTab === 'profile') {
            const drawGuide = (points, color, label) => {
              if (!points || points.length < 2) return;
              snapshotCtx.beginPath();
              snapshotCtx.moveTo(points[0].x, points[0].y);
              for (const point of points.slice(1)) snapshotCtx.lineTo(point.x, point.y);
              snapshotCtx.strokeStyle = color;
              snapshotCtx.lineWidth = Math.max(2, img.width / 500);
              snapshotCtx.stroke();
              snapshotCtx.fillStyle = color;
              snapshotCtx.font = Math.max(12, img.width / 75) + "px sans-serif";
              snapshotCtx.fillText(label, points[0].x + 8, points[0].y - 8);
            };
            drawGuide(g.eline, '#fbbf24', 'E-line: mũi – cằm');
            drawGuide(g.nasolabial_rays, '#38bdf8', 'Góc mũi – môi');
            drawGuide(g.jaw_profile_triangle, '#34d399', 'Đường hàm');
          }
          // Trục giữa đối xứng
          if (g.midline && g.midline.length >= 2) {
            snapshotCtx.beginPath();
            snapshotCtx.moveTo(g.midline[0].x, g.midline[0].y);
            snapshotCtx.lineTo(g.midline[1].x, g.midline[1].y);
            snapshotCtx.strokeStyle = 'rgba(168, 85, 247, 0.9)';
            snapshotCtx.lineWidth = 2;
            snapshotCtx.setLineDash([6, 4]);
            snapshotCtx.stroke();
            snapshotCtx.setLineDash([]);
          }

          // Quy tắc 3 tầng (Trán - Chân mày - Chân mũi - Cằm)
          if (g.thirds_lines) {
            snapshotCtx.lineWidth = 1.5;
            g.thirds_lines.forEach(line => {
              snapshotCtx.beginPath();
              snapshotCtx.moveTo(0, line.y);
              snapshotCtx.lineTo(img.width, line.y);
              snapshotCtx.strokeStyle = 'rgba(250, 204, 21, 0.85)';
              snapshotCtx.setLineDash([4, 4]);
              snapshotCtx.stroke();
              snapshotCtx.setLineDash([]);

              snapshotCtx.fillStyle = 'rgba(250, 204, 21, 0.95)';
              snapshotCtx.font = '12px "JetBrains Mono", monospace';
              snapshotCtx.fillText(line.name, 14, line.y - 6);
            });
          }

          // Đa giác đường viền hàm
          if (g.jawline_polygon && g.jawline_polygon.length === 3) {
            snapshotCtx.beginPath();
            snapshotCtx.moveTo(g.jawline_polygon[0].x, g.jawline_polygon[0].y);
            snapshotCtx.lineTo(g.jawline_polygon[1].x, g.jawline_polygon[1].y);
            snapshotCtx.lineTo(g.jawline_polygon[2].x, g.jawline_polygon[2].y);
            snapshotCtx.strokeStyle = 'rgba(20, 184, 166, 0.9)';
            snapshotCtx.lineWidth = 2.5;
            snapshotCtx.stroke();
          }

          // Tam giác mũi
          if (g.nose_triangle && g.nose_triangle.length === 3) {
            snapshotCtx.beginPath();
            snapshotCtx.moveTo(g.nose_triangle[0].x, g.nose_triangle[0].y);
            snapshotCtx.lineTo(g.nose_triangle[1].x, g.nose_triangle[1].y);
            snapshotCtx.lineTo(g.nose_triangle[2].x, g.nose_triangle[2].y);
            snapshotCtx.closePath();
            snapshotCtx.strokeStyle = 'rgba(16, 185, 129, 0.85)';
            snapshotCtx.lineWidth = 1.8;
            snapshotCtx.stroke();
          }
        }

        // Vẽ các điểm mốc ngũ quan
        const reportLandmarks = snapshotPoints;
        if (chkModalShowPoints.checked && reportLandmarks) {
          snapshotCtx.fillStyle = '#06b6d4';
          const points = [1, 33, 133, 362, 263, 61, 291, 10, 152, 234, 454, 172, 397];
          for (const idx of points) {
            const pt = reportLandmarks[idx];
            if (pt) {
              snapshotCtx.beginPath();
              snapshotCtx.arc(pt.x * img.width, pt.y * img.height, 3.5, 0, 2 * Math.PI);
              snapshotCtx.fill();
            }
          }
        }
      };
      img.src = snapshotUrl;
    }

    function switchModalView(tab) {
      if (!currentAnalysisReport) return;
      if (tab === 'profile' && (!profileCaptureData || !currentAnalysisReport.profile)) return;
      currentModalActiveTab = tab;
      document.getElementById('profileGuideLegend')?.classList.toggle('hidden', tab !== 'profile');

      if (tab === 'frontal') {
        btnTabModalFrontal.className = "px-3 py-1 rounded-lg bg-cyan-500 text-slate-950 font-bold text-[11px] transition";
        btnTabModalProfile.className = "px-3 py-1 rounded-lg bg-surface-900 text-slate-400 hover:text-slate-200 text-[11px] transition";
        if (frontalCaptureData && frontalCaptureData.image) {
          currentSnapshotImage = frontalCaptureData.image;
        }
      } else {
        btnTabModalProfile.className = "px-3 py-1 rounded-lg bg-cyan-500 text-slate-950 font-bold text-[11px] transition";
        btnTabModalFrontal.className = "px-3 py-1 rounded-lg bg-surface-900 text-slate-400 hover:text-slate-200 text-[11px] transition";
        if (profileCaptureData && profileCaptureData.image) {
          currentSnapshotImage = profileCaptureData.image;
        }
      }
      drawReportCanvasOverlay();
    }

    document.getElementById('btnCancelAutoCapture')?.addEventListener('click', cancelProfileAutoCapture);

    if (btnTabModalFrontal) {
      btnTabModalFrontal.addEventListener('click', () => switchModalView('frontal'));
    }
    if (btnTabModalProfile) {
      btnTabModalProfile.addEventListener('click', () => switchModalView('profile'));
    }

    // Gắn sự kiện các nút Quy Trình Chụp 2 Lần
    if (btnCaptureCurrentStep) {
      btnCaptureCurrentStep.addEventListener('click', captureCurrentStepShot);
    }
    if (btnRunMultiViewAnalysis) {
      btnRunMultiViewAnalysis.addEventListener('click', triggerMultiViewAnalysis);
    }
    if (btnResetTwoShot) {
      btnResetTwoShot.addEventListener('click', resetTwoShotCapture);
    }
    if (btnRetakeFrontal) {
      btnRetakeFrontal.addEventListener('click', (e) => {
        e.stopPropagation();
        retakeStepShot(1);
      });
    }
    if (btnRetakeProfile) {
      btnRetakeProfile.addEventListener('click', (e) => {
        e.stopPropagation();
        retakeStepShot(2);
      });
    }

    // Gắn sự kiện các nút Chụp & Modal Báo Cáo
    inputUploadImage.addEventListener('change', handleImageUpload);
    btnCloseReportModal.addEventListener('click', closeAnalysisReport);
    btnFinishReport.addEventListener('click', closeAnalysisReport);
    btnRetakePhoto.addEventListener('click', () => {
      closeAnalysisReport();
      if (!isCameraActive) startCameraStream();
    });

    chkModalShowLines.addEventListener('change', drawReportCanvasOverlay);
    chkModalShowPoints.addEventListener('change', drawReportCanvasOverlay);

    btnExportJson.addEventListener('click', () => {
      if (!currentAnalysisReport) return;
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentAnalysisReport, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `VisionFace_Aesthetic_Report_${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      showToast("Đã tải tệp JSON báo cáo thẩm mỹ!", "success");
    });

    btnPrintReport.addEventListener('click', () => {
      window.print();
    });

    // Khởi chạy ứng dụng khi DOM tải xong (khởi động song song không chặn tiến trình)
    function initApp() {
      syncCanvasResolution();
      applyMirrorSetting();
      loadRegisteredFaces();

      // Khởi chạy song song không chờ đợi chặn lẫn nhau
      setupFaceMeshEngine();
      enumerateVideoDevices();
      checkPythonBackendStatus();

      // Tự động kiểm tra trạng thái Python server định kỳ mỗi 6 giây
      setInterval(async () => {
        if (!isCameraActive || !isBackendFrameInFlight) {
          await checkPythonBackendStatus();
        }
      }, 6000);
    }

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', initApp);
    } else {
      initApp();
    }
  
