/**
 * OWNER: growth
 * Web Push without a library: VAPID (RFC 8292, ES256) and message encryption (RFC 8291,
 * aes128gcm), on WebCrypto only — the same code runs on Node and on a Worker.
 *
 * WHY IT IS TESTED AGAINST THE RFC'S OWN VECTOR. A push service accepts a wrongly encrypted
 * message with 201 and the browser then drops it without a sound, so "the request succeeded"
 * proves nothing. server/outreach.test.ts encrypts the example of RFC 8291 §5 with the RFC's keys
 * and salt and compares every byte.
 *
 * KEYS. The server's VAPID key pair comes from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (base64url:
 * the 65-byte uncompressed public point and the 32-byte private scalar) or, when those are unset,
 * is made once and kept in DATA_DIR/keys/vapid.json with mode 0600 (ctx.keyFile). The private key
 * is never sent, logged or stored in the data file.
 *
 * WHERE A MESSAGE MAY GO. A subscription's endpoint comes from a browser, so the server would
 * otherwise POST to any URL a client names. Only https endpoints on the push services of the
 * browsers themselves are accepted (PUSH_HOSTS).
 */
import type { webcrypto } from 'node:crypto';
import type { OutboundResponse, RouteContext } from '../types.ts';
import { outboundResponse } from './data.ts';

const subtle = () => globalThis.crypto.subtle;
const text = new TextEncoder();

export const b64u = {
  encode(bytes: ArrayBuffer | Uint8Array): string { let s = ''; for (const byte of new Uint8Array(bytes)) s += String.fromCharCode(byte); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  decode(value: unknown): Uint8Array<ArrayBuffer> { const s = atob(String(value).replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; },
};
/** The server's VAPID key pair in base64url: the 65-byte uncompressed public point and the 32-byte private scalar. */
export interface VapidKeys { publicKey: string; privateKey: string }
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';
const B64U = /^[A-Za-z0-9_-]+$/;
const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => { const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out; };

/** Push services of the browsers themselves. Anything else is refused as a subscription endpoint. */
export const PUSH_HOSTS = Object.freeze(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com', 'push.services.mozilla.com']);
export function validEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return false;
  let url: URL;
  try { url = new URL(endpoint); } catch { return false; }
  return url.protocol === 'https:' && !url.username && !url.port && PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}
/** A subscription as a browser gives it, reduced to what is needed, or null. */
export interface CleanSubscription { endpoint: string; p256dh: string; auth: string }
export function cleanSubscription(value: unknown): CleanSubscription | null {
  const keys = isObject(value) ? value.keys : undefined;
  const p256dh = isObject(keys) ? keys.p256dh : undefined, auth = isObject(keys) ? keys.auth : undefined;
  const endpoint = isObject(value) ? value.endpoint : undefined;
  if (!validEndpoint(endpoint) || typeof p256dh !== 'string' || typeof auth !== 'string' || !B64U.test(p256dh) || !B64U.test(auth)) return null;
  try { if (b64u.decode(p256dh).length !== 65 || b64u.decode(p256dh)[0] !== 4 || b64u.decode(auth).length !== 16) return null; } catch { return null; }
  return { endpoint, p256dh, auth };
}

const jwkOf = (publicRaw: Uint8Array, d?: string): webcrypto.JsonWebKey => ({ kty: 'EC', crv: 'P-256', x: b64u.encode(publicRaw.slice(1, 33)), y: b64u.encode(publicRaw.slice(33, 65)), ...(d ? { d } : {}), ext: true });

/** A new P-256 key pair as { publicKey, privateKey } in base64url (raw point, private scalar). */
export async function generateKeys(): Promise<VapidKeys> {
  const pair = await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await subtle().exportKey('jwk', pair.privateKey);
  return { publicKey: b64u.encode(concat(Uint8Array.of(4), b64u.decode(jwk.x), b64u.decode(jwk.y))), privateKey: jwk.d ?? '' };
}
const validKeys = (keys: unknown): keys is VapidKeys => isObject(keys) && typeof keys.publicKey === 'string' && typeof keys.privateKey === 'string' && B64U.test(keys.publicKey) && B64U.test(keys.privateKey)
  && b64u.decode(keys.publicKey).length === 65 && b64u.decode(keys.privateKey).length === 32;

/** The server's VAPID keys: from the environment when both are set and well formed, otherwise from its own key file. */
export async function vapidKeys(ctx: Pick<RouteContext, 'env' | 'keyFile'>): Promise<VapidKeys> {
  const fromEnv = { publicKey: ctx.env('VAPID_PUBLIC_KEY'), privateKey: ctx.env('VAPID_PRIVATE_KEY') };
  if (fromEnv.publicKey || fromEnv.privateKey) { if (validKeys(fromEnv)) return fromEnv; throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must both be set, as base64url of 65 and 32 bytes'); }
  const stored = await ctx.keyFile('vapid', generateKeys);
  if (!validKeys(stored)) throw new Error('The stored VAPID key file is not usable');
  return stored;
}

/** The Authorization header value for one push service origin (RFC 8292). Valid for 12 hours. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, nowMs: number): Promise<string> {
  const encode = (value: unknown) => b64u.encode(text.encode(JSON.stringify(value)));
  const unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: subject })}`;
  const key = await subtle().importKey('jwk', jwkOf(b64u.decode(keys.publicKey), keys.privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, text.encode(unsigned));
  return `vapid t=${unsigned}.${b64u.encode(signature)}, k=${keys.publicKey}`;
}

const hkdf = async (salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number): Promise<Uint8Array<ArrayBuffer>> => new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']), bytes * 8));

/**
 * Encrypt `payload` for one subscription (RFC 8291, a single aes128gcm record).
 * `fixed` — { salt, publicKey, privateKey } in base64url — replaces the random salt and the
 * one-time sender key. It exists for the RFC's test vector only; never pass it when sending.
 * @returns {Promise<Uint8Array>} the request body
 */
export async function encrypt(payload: string | Uint8Array<ArrayBuffer>, subscription: { p256dh: string; auth: string }, fixed: { salt: string; publicKey: string; privateKey: string } | null = null): Promise<Uint8Array<ArrayBuffer>> {
  const plain = typeof payload === 'string' ? text.encode(payload) : payload;
  if (plain.length > 3993) throw new Error('A push payload must fit one record');
  const uaPublic = b64u.decode(subscription.p256dh), auth = b64u.decode(subscription.auth);
  const salt = fixed ? b64u.decode(fixed.salt) : globalThis.crypto.getRandomValues(new Uint8Array(16));
  let asPublic: Uint8Array<ArrayBuffer>, asPrivate: webcrypto.CryptoKey;
  if (fixed) {
    asPublic = b64u.decode(fixed.publicKey);
    asPrivate = await subtle().importKey('jwk', jwkOf(asPublic, fixed.privateKey), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const pair = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPublic = new Uint8Array(await subtle().exportKey('raw', pair.publicKey)); asPrivate = pair.privateKey;
  }
  const uaKey = await subtle().importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256));
  const ikm = await hkdf(auth, shared, concat(text.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, text.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, text.encode('Content-Encoding: nonce\0'), 12);
  const key = await subtle().importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // One record: the payload, then the delimiter 0x02 that marks the last record.
  const sealed = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, concat(plain, Uint8Array.of(2))));
  return concat(salt, Uint8Array.of(0, 0, 16, 0), Uint8Array.of(asPublic.length), asPublic, sealed);
}

/**
 * Send one notification. Never throws: resolves
 *   { ok: true } · { ok: false, gone: true } (404/410: delete the subscription)
 *   { ok: false, retryAfter: seconds } (429) · { ok: false, retry: true } (5xx, network) · { ok: false, status } (any other 4xx: do not retry)
 */
export interface PushResult { ok: boolean; gone?: true; retry?: true; retryAfter?: number; status?: number; error?: string }
export async function sendPush(
  ctx: Pick<RouteContext, 'fetch' | 'now'>,
  subscription: CleanSubscription,
  payload: unknown,
  { ttl = 3600, urgency = 'normal', topic = '', keys, subject }: { ttl?: number; urgency?: string; topic?: string; keys: VapidKeys; subject: string },
): Promise<PushResult> {
  try {
    const body = await encrypt(JSON.stringify(payload), subscription);
    const response: OutboundResponse = outboundResponse(await ctx.fetch(subscription.endpoint, { method: 'POST', body, signal: globalThis.AbortSignal?.timeout?.(10000),
      headers: { Authorization: await vapidAuthorization(subscription.endpoint, keys, subject, ctx.now()), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
        TTL: String(ttl), Urgency: urgency, ...(topic ? { Topic: topic } : {}) } }));
    const status = response.status;
    if (status !== undefined && status >= 200 && status < 300) return { ok: true };
    if (status === 404 || status === 410) return { ok: false, gone: true, status };
    if (status === 429) { const wait = Number(response.headers?.get('retry-after')); return { ok: false, status: 429, retryAfter: Number.isFinite(wait) && wait > 0 ? Math.min(wait, 86400) : 60 }; }
    return status !== undefined && status >= 500 ? { ok: false, retry: true, status } : { ok: false, status };
  } catch (error) { return { ok: false, retry: true, status: 0, error: String((error instanceof Error ? error.name : undefined) || 'network') }; }
}
