import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemandFrames } from './frame.ts';

test('camera movement settles to no frames, invalidations coalesce, and disposal cancels pending work', () => {
  const queue = new Map<number, () => void>();
  let sequence = 0, drawn = 0, moving = 2;
  const frames = createDemandFrames({ request: callback => { queue.set(++sequence, callback); return sequence; }, cancel: id => { queue.delete(id); }, draw: () => { drawn++; return moving-- > 0; } });
  const pump = () => { const first = queue.entries().next().value; assert.ok(first); queue.delete(first[0]); first[1](); };
  frames.invalidate(); frames.invalidate(); frames.invalidate();
  assert.equal(queue.size, 1);
  pump(); pump(); pump();
  assert.equal(drawn, 3); assert.equal(queue.size, 0);
  frames.invalidate(); pump();
  assert.equal(drawn, 4); assert.equal(queue.size, 0);
  frames.invalidate(); frames.dispose(); frames.invalidate();
  assert.equal(queue.size, 0); assert.equal(drawn, 4);
});

test('a camera change during drawing coalesces with the damping frame', () => {
  const queue = new Map<number, () => void>(); let sequence = 0, drawn = 0;
  const frames = createDemandFrames({ request: callback => { queue.set(++sequence, callback); return sequence; }, cancel: id => { queue.delete(id); }, draw: () => { if (++drawn === 1) { frames.invalidate(); return true; } return false; } });
  frames.invalidate();
  const first = queue.get(1)!; queue.delete(1); first();
  assert.equal(queue.size, 1);
  const next = queue.values().next().value!; queue.clear(); next();
  assert.equal(drawn, 2); assert.equal(queue.size, 0);
});
