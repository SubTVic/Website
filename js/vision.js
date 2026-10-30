// Colour-based detection: finds connected pixel blobs of a target colour
// inside the calibrated playing field.

import { applyH } from './homography.js';

const FIELD_MARGIN = 0.06; // slightly beyond the edge so balls in front of the goal stay visible

export function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max / 255];
}

// Builds a test function (h, s, v) -> bool for a tapped colour.
// tol: 5 (strict) … 50 (generous)
export function makeMatcher(color, tol) {
  if (color.s < 0.22) {
    // White/light grey: low saturation, high brightness
    const maxS = 0.18 + tol / 250;
    const minV = Math.max(0.45, color.v - 0.12 - tol / 250);
    return (h, s, v) => s < maxS && v > minV;
  }
  const minS = Math.max(0.22, color.s * (0.75 - tol / 100));
  const minV = Math.max(0.18, color.v * (0.75 - tol / 100));
  return (h, s, v) => {
    const dh = Math.abs(h - color.h);
    return Math.min(dh, 360 - dh) < tol && s > minS && v > minV;
  };
}

export class Tracker {
  constructor() {
    this.w = 0;
    this.h = 0;
  }

  // H: video pixels -> field; scale: processing pixels per video pixel
  configure(w, h, H, scale) {
    this.w = w;
    this.h = h;
    this.H = H;
    this.scale = scale;
    const n = w * h;
    this.inField = new Uint8Array(n);
    this.hsv = new Float32Array(n * 3);
    this.masks = [];
    this.stack = new Int32Array(n);
    this.seen = new Uint8Array(n);
    if (!H) return;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [u, v] = applyH(H, (x + 0.5) / scale, (y + 0.5) / scale);
        const inside = u > -FIELD_MARGIN && u < 1 + FIELD_MARGIN && v > -FIELD_MARGIN && v < 1 + FIELD_MARGIN;
        this.inField[y * w + x] = inside ? 1 : 0;
      }
    }
  }

  // specs: [{ match, minArea }] — returns a list of blobs per spec
  process(data, specs) {
    const { w, h, inField, hsv } = this;
    const n = w * h;
    while (this.masks.length < specs.length) this.masks.push(new Uint8Array(n));
    for (let k = 0; k < specs.length; k++) this.masks[k].fill(0);

    for (let i = 0, p = 0; i < n; i++, p += 4) {
      if (!inField[i]) continue;
      const [hh, ss, vv] = rgbToHsv(data[p], data[p + 1], data[p + 2]);
      hsv[i * 3] = hh;
      hsv[i * 3 + 1] = ss;
      hsv[i * 3 + 2] = vv;
      for (let k = 0; k < specs.length; k++) {
        if (specs[k].match(hh, ss, vv)) this.masks[k][i] = 1;
      }
    }
    return specs.map((spec, k) => this.blobs(this.masks[k], spec.minArea));
  }

  mask(k) {
    return this.masks[k];
  }

  blobs(mask, minArea) {
    const { w, h, stack, seen } = this;
    seen.fill(0);
    const out = [];
    for (let start = 0; start < w * h; start++) {
      if (!mask[start] || seen[start]) continue;
      let top = 0;
      stack[top++] = start;
      seen[start] = 1;
      let count = 0, sx = 0, sy = 0;
      let minX = w, maxX = 0, minY = h, maxY = 0;
      while (top > 0) {
        const i = stack[--top];
        const x = i % w;
        const y = (i / w) | 0;
        count++;
        sx += x;
        sy += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
        if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
        if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[top++] = i - w; }
        if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[top++] = i + w; }
      }
      if (count < minArea) continue;
      const px = (sx / count + 0.5) / this.scale;
      const py = (sy / count + 0.5) / this.scale;
      const [u, v] = applyH(this.H, px, py);
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      out.push({
        x: px,
        y: py,
        u,
        v,
        area: count,
        // 1 = round, filled blob; stripes and edges score much lower
        roundness: (count / (bw * bh)) * (Math.min(bw, bh) / Math.max(bw, bh)),
      });
    }
    return out;
  }
}

// Average colour of a small area (for tapping the ball/stickers)
export function sampleColor(data, w, h, cx, cy, radius = 2) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = Math.max(0, cy - radius); y <= Math.min(h - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(w - 1, cx + radius); x++) {
      const p = (y * w + x) * 4;
      r += data[p];
      g += data[p + 1];
      b += data[p + 2];
      n++;
    }
  }
  const [hh, s, v] = rgbToHsv(r / n, g / n, b / n);
  return { h: hh, s, v, css: `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})` };
}
