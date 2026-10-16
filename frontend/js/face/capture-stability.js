// Validate the whole settling window so slow drift cannot pass a pairwise check.
export class CaptureStability {
  constructor({ duration = 650, maxGap = 350 } = {}) {
    this.duration = duration;
    this.maxGap = maxGap;
    this.reset();
  }
  reset() { this.samples = []; }
  update(landmarks, yaw, now, ready) {
    if (!ready || !Number.isFinite(yaw) || !Number.isFinite(now)) { this.reset(); return { stable: false, progress: 0 }; }
    const nose = landmarks?.[1], left = landmarks?.[234], right = landmarks?.[454];
    if (!nose || !left || !right) { this.reset(); return { stable: false, progress: 0 }; }
    const width = Math.abs(right.x - left.x);
    if (![nose.x, nose.y, width].every(Number.isFinite) || width < .01) { this.reset(); return { stable: false, progress: 0 }; }
    const sample = { x: nose.x, y: nose.y, width, yaw, time: now };
    const last = this.samples.at(-1);
    if (last && (now <= last.time || now - last.time > this.maxGap)) this.reset();
    this.samples = this.samples.filter(item => now - item.time <= this.duration + this.maxGap);
    this.samples.push(sample);
    const spread = key => Math.max(...this.samples.map(item => item[key])) - Math.min(...this.samples.map(item => item[key]));
    const moving = spread("x") / width > .04 || spread("y") / width > .045 || spread("width") / width > .045 || spread("yaw") > 4;
    if (moving) { this.samples = [sample]; return { stable: false, progress: 0 }; }
    const elapsed = now - this.samples[0].time;
    return { stable: elapsed >= this.duration && this.samples.length >= 4, progress: Math.min(100, elapsed / this.duration * 100) };
  }
}
