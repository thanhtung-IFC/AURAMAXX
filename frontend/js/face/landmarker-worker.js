let detector;
self.addEventListener("message", async ({ data }) => {
  try {
    if (data.type === "init") {
      const { createDirectLandmarker } = await import("./landmarker.js");
      detector = await createDirectLandmarker(data.runningMode);
      self.postMessage({ id: data.id, result: true });
    } else if (data.type === "detect") {
      if (!detector) throw new Error("Nhận diện chưa sẵn sàng.");
      const result = data.timestamp === undefined ? detector.detect(data.bitmap) : detector.detectForVideo(data.bitmap, data.timestamp);
      self.postMessage({ id: data.id, result: { faceLandmarks: result.faceLandmarks || [] } });
    }
  } catch {
    self.postMessage({ id: data.id, error: "Chưa xử lý được khung hình. Hãy bật lại camera hoặc tải ảnh khác." });
  } finally { data.bitmap?.close(); }
});
