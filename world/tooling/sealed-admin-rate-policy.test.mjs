import test from 'node:test';
import assert from 'node:assert/strict';
import { sealedAdminRateWaitPolicy } from './sealed-admin-rate-policy.mjs';

const rate = Object.freeze({ writePerMinute: 30 });
const nowMs = 1_000_000;
const bucket = Object.freeze({ count: 31, started_at: nowMs - 20_000, expires_at: nowMs + 40_000 });
const base = overrides => ({
  response: { status: 429, code: 'rate_limited' }, bucketRows: [bucket], rate,
  nowMs, remainingMs: 100_000, waitsAlready: 0, ...overrides,
});

test('permits only the exact canonical live admin-w bucket and computes a bounded wait', () => {
  const result = sealedAdminRateWaitPolicy(base({}));
  assert.deepEqual(result, { ok: true, delayMs: 40_050, evidence: {
    status: 429, code: 'rate_limited', bucketCount: 31, windowMs: 60_000, waitNumber: 1, remainingMs: 100_000,
  } });
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.evidence));
  assert.deepEqual(Object.keys(result.evidence).sort(), ['bucketCount', 'code', 'remainingMs', 'status', 'waitNumber', 'windowMs']);
});

test('refuses success, duplicate/missing responses, and other 429 errors', () => {
  for (const response of [
    { status: 200, code: 'ok' }, { status: 200 }, { status: 200, code: 'duplicate' },
    { status: 429, code: 'other' }, { status: 429, error: 'other' }, { status: 429 },
  ]) assert.equal(sealedAdminRateWaitPolicy(base({ response })).ok, false);
});

test('refuses multiple, malformed, wrong-count, wrong-window, or expired buckets', () => {
  const badRows = [
    [], [bucket, bucket], [{ ...bucket, count: 30 }], [{ ...bucket, count: 31.5 }],
    [{ ...bucket, expires_at: bucket.expires_at + 1 }], [{ ...bucket, expires_at: nowMs }],
    [{ ...bucket, started_at: Number.MAX_SAFE_INTEGER + 1 }],
    [{ count: 31, started_at: nowMs + 1, expires_at: nowMs + 60_001 }],
  ];
  for (const bucketRows of badRows) assert.equal(sealedAdminRateWaitPolicy(base({ bucketRows })).ok, false);
});

test('refuses noncanonical or mutable limits, exhausted waits, and invalid timing', () => {
  for (const override of [
    { rate: { writePerMinute: 30 } }, { rate: Object.freeze({ writePerMinute: 31 }) },
    { waitsAlready: 2 }, { waitsAlready: -1 }, { waitsAlready: 1.5 },
    { nowMs: Number.NaN }, { remainingMs: -1 }, { remainingMs: 45_050 },
    { bucketRows: [{ ...bucket, expires_at: nowMs + 60_001 }] },
  ]) assert.equal(sealedAdminRateWaitPolicy(base(override)).ok, false);
  assert.equal(sealedAdminRateWaitPolicy(base({ waitsAlready: 1 })).ok, true);
});
