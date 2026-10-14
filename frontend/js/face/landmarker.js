const MEDIAPIPE_VERSION = "1.1.0";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let modulePromise;

export async function createLandmarker(runningMode = "VIDEO") {
  modulePromise ||= import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`).catch(error => {
    modulePromise = undefined;
    throw error;
  });
  const vision = await modulePromise;
  const files = await vision.FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`);
  const options = {
    runningMode,
    numFaces: 2,
    minFaceDetectionConfidence: 0.55,
    minFacePresenceConfidence: 0.55,
    minTrackingConfidence: 0.55,
  };

  try {
    return await vision.FaceLandmarker.createFromOptions(files, {
      ...options,
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    });
  } catch {
    return vision.FaceLandmarker.createFromOptions(files, {
      ...options,
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
    });
  }
}
