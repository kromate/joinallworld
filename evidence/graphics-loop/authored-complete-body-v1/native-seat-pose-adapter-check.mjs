import assert from 'node:assert/strict';
import { solveNativeSeatPose, NativeSeatPoseError } from './native-seat-pose-adapter.ts';

const frame = Object.freeze({ clipName: 'sit', duration: 1.2, landmarks: Object.freeze({}) });
const seatTopWorld = Object.freeze([2.3, 0.55, -4.1]);
let currentHipY = seatTopWorld[1];
const calls = [];
const successful = solveNativeSeatPose({
  frame,
  seatTopWorld,
  floorY: 0.03,
  solver: { applyFrame(actualFrame, support) {
    assert.equal(actualFrame, frame, 'each fixed-point pass uses the exact same source frame');
    assert.equal(support.kind, 'seat-anchor');
    assert.deepEqual(support.hipWorld.slice(0, 1), [seatTopWorld[0]], 'seat x remains fixed');
    assert.equal(support.hipWorld[2], seatTopWorld[2], 'seat z remains fixed');
    assert.equal(support.floorY, 0.03, 'feet are re-solved against the unchanged floor');
    currentHipY = support.hipWorld[1];
    calls.push({ hipWorld: [...support.hipWorld] });
    return { clipName: 'sit', support, supportStatus: 'seat-anchored-contact-unverified', seatFeetStatus: 'supported',
      contactMinY: 0.03, footSoleMinY: { left: 0.03, right: 0.03 }, reach: {} };
  } },
  surface: { sample() {
    return { minY: currentHipY - 0.006 + (currentHipY - seatTopWorld[1]) * 0.2, maxY: currentHipY + 0.1 };
  } },
});
assert.equal(successful.supportStatus, 'seat-anchored-contact-unverified', 'adapter preserves diagnostic seat status');
assert.equal(successful.surfaceAligned, true);
assert.ok(Math.abs(successful.residualY) <= 0.001);
assert.equal(successful.passes.length, 3, 'the sampled floor re-fit needs at most the explicit three attempts');
assert.equal(calls.length, successful.passes.length);
assert.deepEqual(successful.hipWorld, [seatTopWorld[0], successful.passes.at(-1).hipWorldY, seatTopWorld[2]]);

for (const mode of ['feet-unreachable', 'seat-nonconvergent']) {
  let solverPasses = 0;
  let refusal;
  assert.throws(() => solveNativeSeatPose({
    frame, seatTopWorld, floorY: 0.03,
    solver: { applyFrame(actualFrame, support) {
      assert.equal(actualFrame, frame);
      solverPasses++;
      return { clipName: 'sit', support, supportStatus: 'seat-anchored-contact-unverified',
        seatFeetStatus: mode === 'feet-unreachable' ? 'unreachable' : 'supported',
        contactMinY: 0, footSoleMinY: { left: 0, right: 0 }, reach: {} };
    } },
    surface: { sample() {
        return mode === 'feet-unreachable'
          ? { minY: seatTopWorld[1], maxY: seatTopWorld[1] + 0.1 }
        : { minY: seatTopWorld[1] - 0.006, maxY: seatTopWorld[1] + 0.1 };
    } },
  }), (error) => {
    assert.ok(error instanceof NativeSeatPoseError);
    refusal = error;
    return true;
  }, `${mode} must be a hard refusal`);
  assert.equal(refusal.passes.length, 3, `${mode} records all bounded attempts`);
  assert.equal(solverPasses, 3, `${mode} performs exactly the configured maximum attempts`);
  if (mode === 'seat-nonconvergent') {
    assert.ok(refusal.passes.every((pass) => Math.abs(pass.residualY - 0.006) < 1e-12),
      'nonconvergent fixture maintains a fixed 6 mm residual despite hip corrections');
  }
}
assert.throws(() => solveNativeSeatPose({ frame, seatTopWorld: [0, Number.NaN, 0], floorY: 0,
  solver: { applyFrame() { throw new Error('must not reach solver'); } }, surface: { sample() { return { minY: 0, maxY: 0 }; } } }), /finite world-space/);
console.log(JSON.stringify({ status: 'adapter-contract-pass', passes: successful.passes.length,
  residualMm: successful.residualY * 1000, rootMoved: false, seatSupportStillUnverified: true,
  refusals: ['unreachable feet', 'nonconverging seat surface', 'nonfinite coordinates'] }, null, 2));
