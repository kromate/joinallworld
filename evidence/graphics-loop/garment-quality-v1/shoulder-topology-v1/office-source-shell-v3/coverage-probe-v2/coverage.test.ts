import assert from 'node:assert/strict';
import test from 'node:test';
import { auditFragmentDisjointness, type BarycentricFragment } from './coverage.ts';

const bary = (x: number, y: number): readonly [number, number, number] => [1 - x - y, x, y];
const tri = (a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]): BarycentricFragment => [bary(...a), bary(...b), bary(...c)];

test('source-face fragments touching only along an edge have zero pairwise area', () => {
  const left = tri([0, 0], [0.5, 0], [0, 0.5]);
  const right = tri([0.5, 0], [0.5, 0.5], [0, 0.5]);
  assert.ok(auditFragmentDisjointness([left, right]).maximumPairIntersectionRatio <= 1e-12);
});

test('pairwise overlap catches a duplicated partial face hidden by an aggregate area sum', () => {
  const partial = tri([0, 0], [0.5, 0], [0, 0.5]);
  const adjacent = tri([0.5, 0], [1, 0], [0.5, 0.5]);
  // 0.25 + 0.25 + 0.25 = 0.75, which can look like a plausible clipped area,
  // while the duplicated fragment overlaps by 0.25 and the true union is only 0.5.
  const fragments = [partial, partial, adjacent];
  const aggregateAreaRatio = fragments.reduce((sum, fragment) => {
    const [a, b, c] = fragment.map(point => [point[1], point[2]] as const);
    return sum + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  }, 0);
  assert.equal(aggregateAreaRatio, 0.75);
  const report = auditFragmentDisjointness(fragments);
  assert.equal(report.maximumPairIntersectionRatio, 0.25);
  assert.deepEqual(report.pair, [0, 1]);
});

test('partial nonidentical fragments report their intersection area', () => {
  const first = tri([0, 0], [0.6, 0], [0, 0.6]);
  const second = tri([0.2, 0], [0.8, 0], [0.2, 0.6]);
  const report = auditFragmentDisjointness([first, second]);
  assert.ok(report.maximumPairIntersectionRatio > 0);
  assert.ok(report.maximumPairIntersectionRatio < 0.36);
});
