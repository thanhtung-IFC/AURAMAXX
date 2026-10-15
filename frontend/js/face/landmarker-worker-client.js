// One inference at a time. Transfer the bitmap so detection never blocks the UI.
export async function createWorkerLandmarker(runningMode = "VIDEO") {
  // MediaPipe's WASM loader uses importScripts, which requires a classic worker.
  const worker = new Worker(new URL("./landmarker-worker.js", import.meta.url));
  let closed = false, serial = 0, busy = false;
  const pending = new Map();
  const fail = error => {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(error); }
    pending.clear();
  };
  worker.addEventListener("message", ({ data }) => {
    const task = pending.get(data.id);
    if (!task) return;
    pending.delete(data.id); clearTimeout(task.timer);
    data.error ? task.reject(new Error(data.error)) : task.resolve(data.result);
  });
  worker.addEventListener("error", () => {
    closed = true;
    worker.terminate();
    fail(new Error("Không khởi động được nhận diện khuôn mặt."));
  });
  const request = (type, payload = {}, transfer = []) => new Promise((resolve, reject) => {
    if (closed) { reject(new DOMException("Nhận diện đã dừng.", "AbortError")); return; }
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Nhận diện phản hồi quá lâu. Hãy bật lại camera.")); }, type === "init" ? 45000 : 15000);
    pending.set(id, { resolve, reject, timer });
    try { worker.postMessage({ id, type, ...payload }, transfer); }
    catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
  });
  const close = () => {
    if (closed) return;
    closed = true;
    fail(new DOMException("Nhận diện đã dừng.", "AbortError"));
    worker.terminate();
  };
  try { await request("init", { runningMode }); }
  catch (error) { close(); throw error; }
  const detect = async (source, timestamp) => {
    if (closed) throw new DOMException("Nhận diện đã dừng.", "AbortError");
    if (busy) throw new Error("Đang xử lý khung hình trước.");
    busy = true;
    let bitmap;
    try {
      bitmap = await createImageBitmap(source);
      if (closed) throw new DOMException("Nhận diện đã dừng.", "AbortError");
      return await request("detect", { bitmap, timestamp }, [bitmap]);
    } finally { bitmap?.close(); busy = false; }
  };
  return { detect: source => detect(source), detectForVideo: (source, timestamp) => detect(source, timestamp), close, executionMode: "worker" };
}
