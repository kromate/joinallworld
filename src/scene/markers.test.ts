import test from 'node:test';
import assert from 'node:assert/strict';
import { annulus, pulse, rippleStep, RIPPLE_MS } from './markers.ts';

test('an annulus lies flat, faces up and indexes only its own vertices', () => {
  const g = annulus(0.5, 1, 16, 0, Math.PI * 2, 0.1);
  assert.equal(g.pos.length / 3, g.nor.length / 3);
  assert.ok(Array.from(g.idx).every((i) => i < g.pos.length / 3));
  for (let i = 1; i < g.pos.length; i += 3) assert.equal(g.pos[i]!.toFixed(2), '0.10');
  for (let i = 0; i < g.nor.length; i += 3) assert.deepEqual([g.nor[i], g.nor[i + 1], g.nor[i + 2]], [0, 1, 0]);
});
test('the pulse is still when motion is reduced', () => {
  assert.equal(pulse(3.3, true), 1);
  assert.ok(Math.abs(pulse(3.3, false) - 1) <= 0.04);
});
test('a ripple grows and fades, and ends', () => {
  const a = rippleStep(0, false), b = rippleStep(RIPPLE_MS / 2, false), c = rippleStep(RIPPLE_MS, false);
  assert.ok(b.scale > a.scale && b.opacity < a.opacity);
  assert.equal(c.done, true); assert.equal(c.opacity, 0);
  assert.equal(rippleStep(100, true).scale, 1);
});
