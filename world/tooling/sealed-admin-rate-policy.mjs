const CANONICAL_WRITE_LIMIT = 30;
const WINDOW_MS = 60_000;
const MAX_WAIT_MS = 60_050;
const REQUIRED_HEADROOM_MS = 5_000;

const refusal = reason => Object.freeze({ ok: false, reason });
const safeInteger = value => Number.isSafeInteger(value) && Number.isFinite(value);

/** Decide whether one already-observed canonical admin limiter bucket permits a bounded wait. */
export function sealedAdminRateWaitPolicy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return refusal('invalid wait evidence');
  const { response, bucketRows, rate, nowMs, remainingMs, waitsAlready } = input;
  if (!response || typeof response !== 'object' || Array.isArray(response)) return refusal('invalid response evidence');
  if (response.status !== 429 || (response.code !== undefined && response.code !== 'rate_limited') ||
      (response.error !== undefined && response.error !== 'rate_limited') ||
      (response.code === undefined && response.error === undefined)) {
    return refusal('response is not the observed 429 rate_limited case');
  }
  if (!rate || typeof rate !== 'object' || !Object.isFrozen(rate) || rate.writePerMinute !== CANONICAL_WRITE_LIMIT) {
    return refusal('canonical frozen admin write limit is unavailable');
  }
  if (!Array.isArray(bucketRows) || bucketRows.length !== 1) return refusal('expected exactly one admin write bucket');
  const row = bucketRows[0];
  if (!row || typeof row !== 'object' || Array.isArray(row) ||
      !safeInteger(row.count) || row.count !== rate.writePerMinute + 1 ||
      !safeInteger(row.started_at) || !safeInteger(row.expires_at) ||
      row.expires_at - row.started_at !== WINDOW_MS) {
    return refusal('admin write bucket does not match the canonical one-minute limit');
  }
  if (!safeInteger(nowMs) || !safeInteger(remainingMs) || remainingMs < 0 ||
      !safeInteger(waitsAlready) || waitsAlready < 0 || waitsAlready >= 2) {
    return refusal('wait timing or wait count is invalid');
  }
  if (row.started_at > nowMs) return refusal('admin write bucket start is in the future');
  if (row.expires_at <= nowMs) return refusal('admin write bucket has already expired');
  const delayMs = row.expires_at - nowMs + 50;
  if (delayMs > MAX_WAIT_MS) return refusal('required wait exceeds the bounded window');
  if (remainingMs <= delayMs + REQUIRED_HEADROOM_MS) return refusal('insufficient verifier deadline headroom');
  return Object.freeze({
    ok: true,
    delayMs,
    evidence: Object.freeze({ status: 429, code: 'rate_limited', bucketCount: row.count,
      windowMs: WINDOW_MS, waitNumber: waitsAlready + 1, remainingMs }),
  });
}
