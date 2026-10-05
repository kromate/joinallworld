// Shared pure helpers for the rules engine. Anyone may import this file.
import type { ActionFailure, ActionSuccess, LifeContext, LifeContextInit, LifeState } from '../types/life.ts'
import { isCityId } from './cities/registry.ts'

export const clamp = (value: number, min = 0, max = 100): number => Math.min(max, Math.max(min, value));
export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const safeCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const isId = (value: unknown): value is string => typeof value === 'string' && ID_PATTERN.test(value);
export const cap = (id: string): string => {
  const first = id[0];
  if (first === undefined) throw new TypeError('cap() needs a non-empty id');
  return `${first.toUpperCase()}${id.slice(1)}`;
};
export const naira = (value: unknown): string => `₦${Math.round(Number(value) || 0).toLocaleString('en-NG')}`;

/** Trimmed text of bounded length with control characters removed, or the fallback. */
export function cleanText(value: unknown, max = 80, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  return text || fallback;
}

/** Action results. A failure always carries a human-readable reason and mirrors it in state.message. */
export function ok(state: LifeState): ActionSuccess<'ok'>;
export function ok<Code extends string>(state: LifeState, code: Code): ActionSuccess<Code>;
export function ok(state: LifeState, code = 'ok'): ActionSuccess {
  return { ok: true, code, state };
}
export function fail<Code extends string>(state: LifeState, code: Code, reason?: string): ActionFailure<Code> {
  if (reason) state.message = reason;
  return reason ? { ok: false, code, reason, state } : { ok: false, code, state };
}

/** Standard guard: most actions are refused while another timed action is running. */
export function busy(state: LifeState, reason = 'Finish or cancel your current action first.'): ActionFailure<'busy'> | null {
  return state.activeAction ? fail(state, 'busy', reason) : null;
}

function hash(text: string): number {
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
export function makeRng(seed: unknown): () => number {
  let a = hash(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- keyed seeds ----------------------------------------------------------------------------
// SHA-256, synchronous and dependency-free (the engine has no I/O and no async), used only to key
// a seed with a server-held secret. The 32-bit string hash above is fine for spreading seeds but
// says too much about its input to protect a secret; a cryptographic hash does not.
const K256 = new Uint32Array(64);
{
  let n = 2, found = 0;
  while (found < 64) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (prime) K256[found++] = (Math.cbrt(n) % 1) * 4294967296;
    n += 1;
  }
}
const word2 = (list: Uint32Array, i: number): number => list[i] ?? 0;
function utf8(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code < 0xdc00 && i + 1 < text.length) code = 0x10000 + ((code - 0xd800) << 10) + (text.charCodeAt(++i) - 0xdc00);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return out;
}
/** SHA-256 of a string (UTF-8) as eight unsigned 32-bit words. */
export function sha256Words(text: unknown): Uint32Array {
  const bytes = utf8(String(text));
  const bits = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let shift = 56; shift >= 0; shift -= 8) bytes.push(shift >= 32 ? Math.floor(bits / 2 ** shift) & 255 : (bits >>> shift) & 255);
  const h = Uint32Array.of(0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19);
  const w = new Uint32Array(64);
  // An index read is `number | undefined` under noUncheckedIndexedAccess; every index below is in range, so `?? 0` never applies.
  const byte = (i: number): number => bytes[i] ?? 0;
  const word = (i: number): number => w[i] ?? 0;
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = (byte(offset + i * 4) << 24) | (byte(offset + i * 4 + 1) << 16) | (byte(offset + i * 4 + 2) << 8) | byte(offset + i * 4 + 3);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(word(i - 15), 7) ^ rotr(word(i - 15), 18) ^ (word(i - 15) >>> 3);
      const s1 = rotr(word(i - 2), 17) ^ rotr(word(i - 2), 19) ^ (word(i - 2) >>> 10);
      w[i] = (word(i - 16) + s0 + word(i - 7) + s1) | 0;
    }
    let [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, k = 0] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + (K256[i] ?? 0) + word(i)) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = word2(h, 0) + a; h[1] = word2(h, 1) + b; h[2] = word2(h, 2) + c; h[3] = word2(h, 3) + d; h[4] = word2(h, 4) + e; h[5] = word2(h, 5) + f; h[6] = word2(h, 6) + g; h[7] = word2(h, 7) + k;
  }
  return h;
}
export const sha256Hex = (text: unknown): string => [...sha256Words(text)].map((word) => word.toString(16).padStart(8, '0')).join('');

/**
 * The seed text for a generator that must not be predictable without `salt`: a digest of the
 * salt and the public seed. Whoever knows the public seed (a client knows its own action ID)
 * learns nothing about the outcome, and outcomes say nothing about the salt.
 */
export const keyedSeed = (salt: string, seed: unknown): string => `k|${sha256Hex(`${salt.length}|${salt}|${seed}`)}`;

/**
 * Build the ctx every system receives.
 *   now     server time in ms (authoritative clock)
 *   cityId  'lagos' | 'ibadan' | ...
 *   rng     deterministic generator seeded from `seed` (an action ID or a settlement interval)
 *   salt    optional secret (a non-empty string) the seed is keyed with. It is consumed here and
 *           is NOT part of the returned context, so no system can read, store or display it.
 */
export function makeContext(input: LifeContextInit & { cityId: string }): LifeContext {
  if (!input || typeof input.cityId !== 'string') throw new TypeError('A registered city context is required');
  const { now = 0, cityId, seed = '', salt, ...rest } = input;
  if (!isCityId(cityId)) throw new TypeError(`Unknown city context: ${cityId}`);
  const text = `${cityId}|${seed}`;
  return { now, cityId, rng: makeRng(typeof salt === 'string' && salt ? keyedSeed(salt, text) : text), ...rest };
}
