import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodePng, encodePng, type Image } from './png.ts';
import { THRESHOLDS, computeMetrics, judge } from './metrics.ts';
import { expandPaths, inspectFile, table } from './inspect.ts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const make = (width: number, height: number, colour: (x: number, y: number) => [number, number, number]): Image => {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const [r, g, b] = colour(x, y), at = (y * width + x) * 4; data[at] = r; data[at + 1] = g; data[at + 2] = b; data[at + 3] = 255; }
  return { width, height, data };
};

test('one flat colour is sparse, primitive and compressed at once', () => {
  const metrics = computeMetrics(make(320, 180, () => [40, 40, 40]));
  assert.equal(metrics.colorEntropyBits, 0);
  assert.equal(metrics.dominantColorShare, 1);
  assert.equal(metrics.edgeDensity, 0);
  assert.equal(metrics.luminance.contrast, 0);
  assert.deepEqual(judge(metrics).map((f) => f.code), ['sparse', 'primitive', 'compressed']);
});

test('a busy, contrasty picture passes every threshold', () => {
  // Squares of 8 pixels in 64 different colours, dark to bright: many colours, many steps, wide brightness range.
  const metrics = computeMetrics(make(320, 180, (x, y) => { const cell = (Math.floor(x / 2) * 7 + Math.floor(y / 2) * 13) % 64; return [cell * 4, 255 - cell * 4, (cell * 29) % 256]; }));
  assert.ok(metrics.colorEntropyBits >= THRESHOLDS.minEntropyBits, `entropy ${metrics.colorEntropyBits}`);
  assert.ok(metrics.dominantColorShare <= THRESHOLDS.maxDominantShare);
  assert.ok(metrics.edgeDensity >= THRESHOLDS.minEdgeDensity);
  assert.ok(metrics.luminance.contrast >= THRESHOLDS.minContrast);
  assert.deepEqual(judge(metrics), []);
});

test('the thresholds are the scorecard\'s', () => {
  assert.deepEqual({ ...THRESHOLDS }, { minEntropyBits: 3.0, maxDominantShare: 0.6, minEdgeDensity: 0.04, minContrast: 60 });
});

test('half black, half white: two colours, one edge line, full contrast', () => {
  const metrics = computeMetrics(make(320, 180, (x) => x < 160 ? [0, 0, 0] : [255, 255, 255]));
  assert.equal(metrics.colorBuckets, 2);
  assert.equal(metrics.colorEntropyBits, 1);
  assert.equal(metrics.dominantColorShare, 0.5);
  assert.equal(metrics.luminance.contrast, 255);
  assert.ok(metrics.edgeDensity > 0 && metrics.edgeDensity < 0.04, `a single vertical line of steps: ${metrics.edgeDensity}`);
});

test('a picture too small to sample is refused', () => {
  assert.throws(() => computeMetrics(make(1, 1, () => [0, 0, 0])), /too small/);
});

test('inspect reads files and folders and prints a verdict a line', () => {
  const folder = mkdtempSync(join(tmpdir(), 'aw-evidence-test-'));
  try {
    writeFileSync(join(folder, 'flat.png'), encodePng(make(160, 90, () => [9, 9, 9])));
    writeFileSync(join(folder, 'busy.png'), encodePng(make(160, 90, (x, y) => [(x * 5) & 255, (y * 9) & 255, ((x ^ y) * 13) & 255])));
    writeFileSync(join(folder, 'note.txt'), 'not a picture');
    const files = expandPaths([folder]);
    assert.deepEqual(files.map((f) => f.slice(folder.length + 1)), ['busy.png', 'flat.png']);
    const rows = files.map(inspectFile);
    assert.equal(rows[0]!.findings.length, 0, 'busy');
    assert.equal(rows[1]!.findings.length, 3, 'flat');
    const printed = table(rows);
    assert.match(printed, /busy\.png\s+160x90\s+\S+\s+\S+\s+\S+\s+\S+\s+ok/);
    assert.match(printed, /flat\.png.*FAIL sparse,primitive,compressed/);
    assert.equal(decodePng(encodePng(make(2, 2, () => [1, 2, 3]))).width, 2);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
