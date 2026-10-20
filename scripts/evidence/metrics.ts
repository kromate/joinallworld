// Pixel measurements for "does this picture look flat?", and the scorecard thresholds they are held to (docs/EVIDENCE.md).
// The method is the canvas inspector of majidmanzarpour/threejs-game-skills (MIT): sample a grid of about 160 by 90 points, count
// colours in 4-bit buckets, compare neighbouring brightness. The numbers are advisory: a low one needs an explanation, not a
// higher score, and nothing should be added to a picture only to raise them.
import type { Image } from './png.ts';

export interface Metrics {
  colorBuckets: number;
  /** Bits of colour variety (0 = one colour). */
  colorEntropyBits: number;
  /** Share of sampled points that sit next to a clear brightness step (0 to 1). */
  edgeDensity: number;
  luminance: { mean: number; p5: number; p95: number; contrast: number };
  /** Share of sampled points in the most common colour bucket (0 to 1). */
  dominantColorShare: number;
}

const round = (value: number, digits: number): number => Number(value.toFixed(digits));

export function computeMetrics(image: Image): Metrics {
  const stepX = Math.max(1, Math.floor(image.width / 160)), stepY = Math.max(1, Math.floor(image.height / 90));
  const cols = Math.floor(image.width / stepX), rows = Math.floor(image.height / stepY);
  if (cols < 2 || rows < 2) throw new Error('The picture is too small to measure.');
  const luminance = new Float64Array(cols * rows), buckets = new Map<number, number>();
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const at = (gy * stepY * image.width + gx * stepX) * 4, r = image.data[at]!, g = image.data[at + 1]!, b = image.data[at + 2]!;
      luminance[gy * cols + gx] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  const samples = cols * rows, sorted = Array.from(luminance).sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const p5 = sorted[Math.floor(sorted.length * 0.05)]!, p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  let entropy = 0, dominant = 0;
  for (const count of buckets.values()) { const p = count / samples; entropy -= p * Math.log2(p); dominant = Math.max(dominant, count); }
  let edges = 0, checked = 0;
  for (let gy = 0; gy < rows - 1; gy++) {
    for (let gx = 0; gx < cols - 1; gx++) {
      const i = gy * cols + gx;
      if (Math.max(Math.abs(luminance[i]! - luminance[i + 1]!), Math.abs(luminance[i]! - luminance[i + cols]!)) > 12) edges++;
      checked++;
    }
  }
  return {
    colorBuckets: buckets.size, colorEntropyBits: round(entropy, 2), edgeDensity: round(edges / checked, 3),
    luminance: { mean: round(mean, 1), p5: round(p5, 1), p95: round(p95, 1), contrast: round(p95 - p5, 1) }, dominantColorShare: round(dominant / samples, 3),
  };
}

/** The scorecard's thresholds. */
export const THRESHOLDS = Object.freeze({ minEntropyBits: 3.0, maxDominantShare: 0.6, minEdgeDensity: 0.04, minContrast: 60 });

export interface Finding { code: 'sparse' | 'primitive' | 'compressed'; message: string }

/** Which thresholds a picture misses, each with the category of the scorecard it speaks against. */
export function judge(metrics: Metrics): Finding[] {
  const found: Finding[] = [];
  if (metrics.colorEntropyBits < THRESHOLDS.minEntropyBits || metrics.dominantColorShare > THRESHOLDS.maxDominantShare) {
    found.push({ code: 'sparse', message: `sparse flat scene (entropy ${metrics.colorEntropyBits} bits, dominant colour ${metrics.dominantColorShare}): evidence against World and Materials above 2` });
  }
  if (metrics.edgeDensity < THRESHOLDS.minEdgeDensity) found.push({ code: 'primitive', message: `primitive-dominant or empty framing (edge density ${metrics.edgeDensity}): evidence against World and Hero above 2` });
  if (metrics.luminance.contrast < THRESHOLDS.minContrast) found.push({ code: 'compressed', message: `fog or darkness compression (contrast ${metrics.luminance.contrast}): evidence against Lighting above 2` });
  return found;
}
