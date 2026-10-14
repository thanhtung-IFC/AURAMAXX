import { classifyFaceShape, measureFaceProfile, scoreFromTarget } from "../frontend/js/face/profile.js";
import { PROFILE_CONFIG } from "../frontend/js/face/profile-config.js";

function assert(condition, message) {
  if (!condition) throw new Error(`Face Profile test failed: ${message}`);
}

function syntheticLandmarks() {
  const width = 1280, height = 720;
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const set = (index, x, y) => { points[index] = { x: x / width, y: y / height }; };
  [
    [10, 640, 165], [152, 640, 555], [234, 430, 350], [454, 850, 350],
    [103, 520, 220], [332, 760, 220], [172, 490, 450], [397, 790, 450],
    [105, 545, 290], [334, 735, 290], [2, 640, 385], [1, 640, 350],
    [168, 640, 295], [6, 640, 300], [197, 640, 305], [195, 640, 310], [5, 640, 315],
    [33, 555, 315], [133, 605, 315], [362, 675, 315], [263, 725, 315],
    [98, 610, 385], [327, 670, 385], [61, 580, 430], [291, 700, 430],
    [0, 640, 424], [13, 640, 435], [17, 640, 450], [14, 640, 440],
    [50, 575, 400], [101, 560, 410], [118, 570, 420], [205, 580, 425], [206, 700, 420], [216, 710, 410], [280, 705, 400], [330, 700, 410], [347, 690, 425],
  ].forEach(([i, x, y]) => set(i, x, y));
  return points;
}

export function runFaceProfileTests() {
  assert(scoreFromTarget(0.5, 0.5, 0.2) === 100, "target center should score 100");
  assert(scoreFromTarget(0.9, 0.5, 0.2) === 0, "outside configured tolerance should score 0");
  assert(scoreFromTarget(Number.NaN, 0.5, 0.2) === null, "missing measurement has no score");
  assert(classifyFaceShape({}).status === "missing", "shape needs all geometry inputs");

  const width = 1280, height = 720;
  const points = syntheticLandmarks();
  const quality = { mean: 125, sharpness: 8, skinEvenness: 0.8, skinConfidence: 100 };
  const complete = measureFaceProfile(points, width, height, quality);
  assert(complete.overall !== null, "complete geometry should produce a weighted score");
  assert(complete.groups.length === 7, "all seven categories should be returned");
  assert(complete.groups.every((group) => group.score === null || (group.score >= 0 && group.score <= 100)), "category scores stay in range");
  assert(Object.values(PROFILE_CONFIG.overallWeights).reduce((a, b) => a + b, 0) === 100, "configured weights sum to 100");

  const partialPoints = [...points];
  [1, 98, 327, 2, 168].forEach((index) => { partialPoints[index] = undefined; });
  const partial = measureFaceProfile(partialPoints, width, height, quality);
  const nose = partial.groups.find((group) => group.id === "nose");
  assert(nose.score === null && nose.status === "missing", "missing nose landmarks are not scored as zero");
  assert(partial.overall !== null && partial.coverage < 100, "overall renormalizes remaining valid categories and reports coverage");
  return "Face Profile checks passed";
}
