// Heuristic cấu hình sản phẩm, không phải chuẩn y khoa hay chuẩn khách quan về vẻ đẹp.
export const PROFILE_CONFIG = Object.freeze({
  overallWeights: Object.freeze({ proportions: 24, eyesBrows: 16, nose: 12, lips: 10, jawChin: 18, skin: 10, fullness: 10 }),
  faceShape: Object.freeze({
    round: { minRatio: 1.15, maxRatio: 1.30, jawToCheek: 0.84, foreheadToCheek: 0.94 },
    oval: { minRatio: 1.30, maxRatio: 1.52, jawToCheek: 0.78, foreheadToCheek: 0.90 },
    square: { minRatio: 1.00, maxRatio: 1.34, jawToCheek: 0.91, foreheadToCheek: 0.90 },
    oblong: { minRatio: 1.52, maxRatio: 99, jawToCheek: 0.76, foreheadToCheek: 0.88 },
    heart: { minRatio: 1.18, maxRatio: 1.50, jawToCheek: 0.73, foreheadToCheek: 0.97 },
    diamond: { minRatio: 1.15, maxRatio: 1.52, jawToCheek: 0.75, foreheadToCheek: 0.84 },
  }),
  // Mỗi mục là tâm và độ rộng của dải tham chiếu nội bộ. Tâm không biểu thị "đẹp".
  targets: Object.freeze({
    faceLengthWidth: [1.36, 0.24], topThird: [1 / 3, 0.16], middleThird: [1 / 3, 0.16], bottomThird: [1 / 3, 0.16],
    eyeSpacingFace: [0.46, 0.12], eyeBalance: [0, 0.10],
    noseWidthFace: [0.25, 0.09], noseLengthFace: [0.24, 0.11], noseCenter: [0, 0.06],
    mouthWidthFace: [0.38, 0.14], lipBalance: [0.62, 0.30],
    jawBalance: [0.84, 0.18], chinRatio: [0.20, 0.12],
    skinEvenness: [1, 1], fullnessBalance: [1.08, 0.18],
  }),
  minConfidence: 0.50,
  classification: Object.freeze({ minConfidence: 42, minMargin: 5, featureTolerance: 0.25, chinTarget: 0.20, chinTolerance: 0.20 }),
});
