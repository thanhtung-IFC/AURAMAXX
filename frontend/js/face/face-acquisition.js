import { fittedFrame } from "./camera.js";

// Broad anatomical checks supplement model confidence; these are not identity scores.
export function hasFaceGeometry(points, aspectRatio = 4 / 3) {
  if (!Array.isArray(points) || points.length < 468 || !Number.isFinite(aspectRatio) || aspectRatio <= 0) return false;
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z ?? 0)) return false;
  }
  const top = points[10], chin = points[152], left = points[234], right = points[454];
  const eyeL = points[33], eyeR = points[263], nose = points[1];
  const height = chin.y - top.y, width = right.x - left.x;
  if (height < .035 || width < .015) return false;
  const ratio = width * aspectRatio / height;
  const eyeWidth = Math.hypot((eyeR.x - eyeL.x) * aspectRatio, eyeR.y - eyeL.y);
  const eyeY = (eyeL.y + eyeR.y) / 2, mouthY = (points[61].y + points[291].y) / 2;
  if (ratio < .25 || ratio > 1.8 || eyeWidth < width * aspectRatio * .12 || eyeWidth > width * aspectRatio * 1.1) return false;
  if (eyeY <= top.y || mouthY <= eyeY || mouthY >= chin.y || nose.y < eyeY - height * .15 || nose.y > mouthY + height * .15) return false;
  return [eyeL, eyeR, nose, points[61], points[291]].every(point =>
    point.x >= left.x - width * .2 && point.x <= right.x + width * .2 && point.y >= top.y && point.y <= chin.y);
}

// Limit exposure correction so noise and clipped pixels are not amplified without bound.
// Return null for featureless or normally exposed images to avoid redundant inference.
export function exposureLookup(pixels) {
  const histogram = new Uint32Array(256);
  let sum = 0, count = 0;
  for (let index = 0; index < pixels.length; index += 64) {
    const value = Math.round(.2126 * pixels[index] + .7152 * pixels[index + 1] + .0722 * pixels[index + 2]);
    histogram[value]++; sum += value; count++;
  }
  if (!count) return null;
  let low = 0, high = 255, total = 0;
  for (let value = 0; value < 256; value++) {
    total += histogram[value];
    if (total >= count * .05) { low = value; break; }
  }
  total = 0;
  for (let value = 255; value >= 0; value--) {
    total += histogram[value];
    if (total >= count * .05) { high = value; break; }
  }
  const range = high - low, mean = sum / count;
  if (range < 6 || (mean >= 85 && mean <= 190 && range >= 90)) return null;
  const contrast = Math.min(1.5, Math.max(1, 100 / range));
  const gamma = mean < 85 ? Math.max(.65, mean / 85) : mean > 190 ? 1.25 : 1;
  return Uint8ClampedArray.from({ length: 256 }, (_, value) => {
    const adjusted = Math.min(255, Math.max(0, (value - mean) * contrast + mean));
    return Math.round(255 * (adjusted / 255) ** gamma);
  });
}

const makeCanvas = () => document.createElement("canvas");

// All passes use the same full frame: no crop, mirror, or stale landmark fallback.
export class FaceAcquisition {
  constructor({ inferenceCanvas = null, createCanvas = makeCanvas, recoveryInterval = 500 } = {}) {
    this.createCanvas = createCanvas;
    this.inferenceCanvas = inferenceCanvas;
    this.recoveryCanvas = null;
    this.recoveryInterval = recoveryInterval;
    this.lastTimestamp = 0;
    this.reset();
  }
  reset() { this.epoch = (this.epoch || 0) + 1; this.lastRecovery = -Infinity; this.boostUntil = 0; this.correctExposure = false; }
  release() {
    this.reset();
    for (const canvas of [this.inferenceCanvas, this.recoveryCanvas]) if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
  draw(source, canvas, longestEdge, readFrequently = false) {
    const size = fittedFrame(source.width, source.height, longestEdge);
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
    canvas.getContext("2d", { willReadFrequently: readFrequently }).drawImage(source, 0, 0, size.width, size.height);
    return canvas;
  }
  faces(result, source) {
    const faces = result?.faceLandmarks || [];
    // Never discard a second face and accidentally allow a group photo to pass.
    return faces.length === 1 && !hasFaceGeometry(faces[0], source.width / source.height) ? [] : faces;
  }
  enhanced(source, longestEdge) {
    this.recoveryCanvas ||= this.createCanvas();
    const canvas = this.draw(source, this.recoveryCanvas, longestEdge, true);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const lookup = exposureLookup(image.data);
    if (lookup) {
      for (let index = 0; index < image.data.length; index += 4) {
        image.data[index] = lookup[image.data[index]];
        image.data[index + 1] = lookup[image.data[index + 1]];
        image.data[index + 2] = lookup[image.data[index + 2]];
      }
      context.putImageData(image, 0, 0);
    }
    return { canvas, corrected: Boolean(lookup) };
  }
  async detectForVideo(detector, source, timestamp, longestEdge = 640) {
    const epoch = this.epoch;
    this.inferenceCanvas ||= this.createCanvas();
    const recovering = timestamp < this.boostUntil;
    const edge = recovering ? Math.max(960, longestEdge) : longestEdge;
    const correctedInput = recovering && this.correctExposure;
    const input = correctedInput ? this.enhanced(source, edge).canvas : this.draw(source, this.inferenceCanvas, edge);
    const nextTimestamp = () => (this.lastTimestamp = Math.max(timestamp, this.lastTimestamp + 1));
    let faces = this.faces(await detector.detectForVideo(input, nextTimestamp()), source);
    if (epoch !== this.epoch) return { faceLandmarks: [] };
    if (faces.length > 1) { this.boostUntil = 0; this.correctExposure = false; }
    if (faces.length || timestamp - this.lastRecovery < this.recoveryInterval) return { faceLandmarks: faces };
    this.lastRecovery = timestamp;
    const { canvas, corrected } = this.enhanced(source, Math.max(960, longestEdge));
    if (canvas.width <= input.width && canvas.height <= input.height && (!corrected || correctedInput)) return { faceLandmarks: [] };
    faces = this.faces(await detector.detectForVideo(canvas, nextTimestamp()), source);
    if (epoch !== this.epoch) return { faceLandmarks: [] };
    // Keep a recovered face at the higher resolution long enough to settle for capture.
    if (faces.length === 1) { this.boostUntil = timestamp + 1500; this.correctExposure = corrected; }
    return { faceLandmarks: faces };
  }
  async detectImage(detector, source) {
    const epoch = this.epoch;
    let faces = this.faces(await detector.detect(source), source);
    if (epoch !== this.epoch) return { faceLandmarks: [] };
    if (!faces.length) {
      const { canvas, corrected } = this.enhanced(source, Math.max(source.width, source.height));
      if (corrected) faces = this.faces(await detector.detect(canvas), source);
    }
    return { faceLandmarks: epoch === this.epoch ? faces : [] };
  }
}
