// Shared pure helpers for the rules engine. Anyone may import this file.

export const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
export const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const finite = (value) => typeof value === 'number' && Number.isFinite(value);
export const safeCount = (value) => Number.isSafeInteger(value) && value >= 0;
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const isId = (value) => typeof value === 'string' && ID_PATTERN.test(value);
export const cap = (id) => `${id[0].toUpperCase()}${id.slice(1)}`;
export const naira = (value) => `₦${Math.round(Number(value) || 0).toLocaleString('en-NG')}`;

/** Trimmed text of bounded length with control characters removed, or the fallback. */
export function cleanText(value, max = 80, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  return text || fallback;
}

/** Action results. A failure always carries a human-readable reason and mirrors it in state.message. */
export const ok = (state, code = 'ok') => ({ ok: true, code, state });
export function fail(state, code, reason) {
  if (reason) state.message = reason;
  return reason ? { ok: false, code, reason, state } : { ok: false, code, state };
}

/** Standard guard: most actions are refused while another timed action is running. */
export function busy(state, reason = 'Finish or cancel your current action first.') {
  return state.activeAction ? fail(state, 'busy', reason) : null;
}

function hash(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Deterministic generator: the same seed text always yields the same sequence of floats in [0, 1). */
export function makeRng(seed) {
  let a = hash(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build the ctx every system receives.
 *   now     server time in ms (authoritative clock)
 *   cityId  'lagos' | 'ibadan' | ...
 *   rng     deterministic generator seeded from `seed` (an action ID or a settlement interval)
 */
export function makeContext({ now = 0, cityId = 'lagos', seed = '', ...rest } = {}) {
  return { now, cityId, rng: makeRng(`${cityId}|${seed}`), ...rest };
}
