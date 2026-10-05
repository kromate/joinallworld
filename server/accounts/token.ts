/**
 * OWNER: accounts
 * ID TOKEN VERIFICATION — the only thing that ever tells this server who a person is.
 *
 * The browser signs in with the provider and hands over an ID token (a signed JWT). Nothing in it is believed until
 * its signature has been checked HERE against the provider's published keys; a uid, an address or a "verified" flag
 * sent beside the token is never read. Portable: Web Crypto and the host's outbound fetch only, so both hosts run it.
 *
 * WHAT IS CHECKED, in this order
 *   shape        three base64url parts, at most 4,096 characters, each in its ONE canonical spelling: no padding, no
 *                whitespace, and trailing bits that are zero. (A forgiving decoder gives one token many spellings that
 *                all verify; a token must have exactly one, or "used once" could be got around by respelling it.)
 *   header       alg is exactly RS256 (never taken from the key or negotiated), kid names a published key
 *   signature    RSASSA-PKCS1-v1_5 / SHA-256 over `header.payload`
 *   aud, iss     the configured project, and the token service's issuer for that project
 *   exp          in the future
 *   iat          not in the future, and at most `maxAgeMs` old (5 minutes): a token is for signing in now
 *   auth_time    not in the future, and at most `maxAuthAgeMs` old (1 hour): the person proved who they are recently
 *   sub          the account's subject id
 *   provider     Google or e-mail and password; anything else (anonymous, custom) is refused, and so is a token of a
 *                tenant of the project (`firebase.tenant`): tenants have their own users, who are not this game's
 *   email        present; `emailVerified` is reported and the caller refuses an unverified address
 * A small clock allowance (`skewMs`, 60 s) applies to the "not in the future" checks only.
 *
 * KEYS are fetched from the provider over HTTPS, kept for the lifetime its Cache-Control gives (between one minute and
 * one day), and fetched again — at most once a minute — when a token names a key that is not known (key rotation).
 * A key set that cannot be fetched is `KeysUnavailable`, which is not a verdict about the token; after a failed fetch
 * the provider is not asked again for 15 seconds, however many tokens arrive.
 *
 * `digest` is what "used once" is keyed on: a SHA-256 over the subject, the issue time and the signature's BYTES — the
 * signed content itself, never the text it arrived as.
 *
 * Nothing here logs, and no error carries the token, a claim or a reply.
 */
import type { AccountProviderId } from '../types.ts';

/** Where the token service publishes the keys its ID tokens are signed with, as a JWK set. */
export const TOKEN_KEYS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
export const tokenIssuer = (projectId: string): string => `https://securetoken.google.com/${projectId}`;

export type TokenRefusal = 'malformed' | 'algorithm' | 'unknown_key' | 'signature' | 'audience' | 'issuer' | 'expired' | 'not_yet_valid' | 'stale' | 'subject' | 'provider' | 'email';
/** The token is not acceptable. `refusal` says why, for tests and the log; a client is only ever told `invalid_token`. */
export class TokenError extends Error {
  readonly refusal: TokenRefusal;
  constructor(refusal: TokenRefusal) { super(`ID token refused: ${refusal}`); this.name = 'TokenError'; this.refusal = refusal; }
}
/** The provider's keys could not be read: nothing can be verified right now. */
export class KeysUnavailable extends Error {
  constructor() { super('The sign-in keys could not be fetched'); this.name = 'KeysUnavailable'; }
}
/** What a verified token proves. Times are server milliseconds. */
export interface VerifiedIdentity { subject: string; email: string; emailVerified: boolean; provider: AccountProviderId; issuedAt: number; authAt: number; expiresAt: number; /** What a used token is remembered by (see above). */ digest: string }

export interface TokenVerifierOptions {
  projectId: string
  /** The host's outbound fetch (ctx.fetch): HTTPS only, bounded, no redirects. */
  fetch: (url: string, init?: object) => Promise<unknown>
  now: () => number
  maxAgeMs?: number
  maxAuthAgeMs?: number
  skewMs?: number
}
export const TOKEN_MAX_AGE_MS = 5 * 60000;
export const TOKEN_MAX_AUTH_AGE_MS = 60 * 60000;
const MIN_KEY_LIFE_MS = 60000, MAX_KEY_LIFE_MS = 86400000, REFETCH_AFTER_MS = 60000, KEY_REPLY_LIMIT = 32768, MAX_KEYS = 16;
/** After a key fetch failed, how long the provider is left alone. */
export const KEY_RETRY_AFTER_MS = 15000;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const B64URL = /^[A-Za-z0-9_-]+$/;
const encodeBytes = (bytes: Uint8Array): string => { let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
/**
 * STRICT base64url. The decoded bytes must encode back to exactly the text that was given: that rules out padding,
 * the standard alphabet, whitespace and non-zero trailing bits in one comparison, so every byte string has ONE spelling.
 */
function decodeBytes(part: string): Uint8Array<ArrayBuffer> {
  if (!B64URL.test(part)) throw new TokenError('malformed');
  let text: string;
  try { text = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4)); } catch { throw new TokenError('malformed'); }
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  if (encodeBytes(bytes) !== part) throw new TokenError('malformed');
  return bytes;
}
function decodeJson(part: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeBytes(part))); } catch (error) { if (error instanceof TokenError) throw error; throw new TokenError('malformed'); }
  if (!isRecord(value)) throw new TokenError('malformed');
  return value;
}
const seconds = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value * 1000 : null);
/** An address the page can show back to its owner: bounded, one `@`, no spaces or control characters. */
const isAddress = (value: unknown): value is string => typeof value === 'string' && value.length >= 3 && value.length <= 254 && /^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+$/.test(value);

/** Web Crypto as both hosts have it, named through the global so neither host's type library is assumed. */
type Subtle = typeof globalThis.crypto.subtle;
type VerifyKey = Parameters<Subtle['verify']>[1];

/** The reply of an outbound fetch, read no further than this module needs. */
interface KeyReply { ok?: unknown; status?: unknown; headers?: { get(name: string): string | null }; text?: () => Promise<string> }

export function createTokenVerifier({ projectId, fetch, now, maxAgeMs = TOKEN_MAX_AGE_MS, maxAuthAgeMs = TOKEN_MAX_AUTH_AGE_MS, skewMs = 60000 }: TokenVerifierOptions) {
  const subtle = (): Subtle => globalThis.crypto.subtle;
  let keys = new Map<string, VerifyKey>(), fetchedAt = Number.NEGATIVE_INFINITY, expiresAt = Number.NEGATIVE_INFINITY;
  let loading: Promise<void> | null = null, retryAt = Number.NEGATIVE_INFINITY;

  /** One request at a time, shared by every verification that arrives while it is out. */
  function load(): Promise<void> {
    // A fetch that has just failed is not repeated for every token that arrives meanwhile.
    if (!loading && now() < retryAt && now() >= retryAt - KEY_RETRY_AFTER_MS) return Promise.reject(new KeysUnavailable());
    loading ??= (async () => {
      try {
        let reply: KeyReply;
        try { reply = await fetch(TOKEN_KEYS_URL, { method: 'GET', headers: { accept: 'application/json' } }) as KeyReply; } catch { throw new KeysUnavailable(); }
        if (!reply || reply.status !== 200 || typeof reply.text !== 'function') throw new KeysUnavailable();
        let body: unknown;
        try { const text = await reply.text(); if (text.length > KEY_REPLY_LIMIT) throw new Error('large'); body = JSON.parse(text); } catch { throw new KeysUnavailable(); }
        const list = isRecord(body) && Array.isArray(body.keys) ? body.keys : null;
        if (!list) throw new KeysUnavailable();
        const next = new Map<string, VerifyKey>();
        for (const item of list.slice(0, MAX_KEYS)) {
          if (!isRecord(item) || item.kty !== 'RSA' || typeof item.kid !== 'string' || !item.kid || item.kid.length > 128 || typeof item.n !== 'string' || typeof item.e !== 'string') continue;
          if ((item.alg !== undefined && item.alg !== 'RS256') || (item.use !== undefined && item.use !== 'sig')) continue;
          // The algorithm is fixed here, whatever the key says about itself.
          try { next.set(item.kid, await subtle().importKey('jwk', { kty: 'RSA', n: item.n, e: item.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])); } catch { /* a key that cannot be imported is not a key */ }
        }
        if (!next.size) throw new KeysUnavailable();
        const maxAge = /(?:^|,)\s*max-age=(\d{1,9})/i.exec(reply.headers?.get('cache-control') ?? '');
        const life = Math.min(MAX_KEY_LIFE_MS, Math.max(MIN_KEY_LIFE_MS, maxAge ? Number(maxAge[1]) * 1000 : MIN_KEY_LIFE_MS));
        keys = next; fetchedAt = now(); expiresAt = fetchedAt + life; retryAt = Number.NEGATIVE_INFINITY;
      } catch (error) { retryAt = now() + KEY_RETRY_AFTER_MS; throw error; }
      finally { loading = null; }
    })();
    return loading;
  }
  async function keyFor(kid: string): Promise<VerifyKey> {
    if (now() >= expiresAt || now() < fetchedAt) {
      // Keys past their lifetime are not used: a key the provider withdrew must stop verifying.
      try { await load(); } catch (error) { keys = new Map(); throw error; }
    }
    let key = keys.get(kid);
    if (!key && now() - fetchedAt >= REFETCH_AFTER_MS) { await load(); key = keys.get(kid); }
    if (!key) throw new TokenError('unknown_key');
    return key;
  }

  return {
    /** Resolves what the token proves, or rejects with TokenError (the token) or KeysUnavailable (the provider's keys). */
    async verify(token: unknown): Promise<VerifiedIdentity> {
      if (typeof token !== 'string' || token.length < 64 || token.length > 4096) throw new TokenError('malformed');
      const parts = token.split('.');
      if (parts.length !== 3) throw new TokenError('malformed');
      const [head, body, signature] = parts as [string, string, string];
      const header = decodeJson(head);
      if (header.alg !== 'RS256') throw new TokenError('algorithm');
      if (typeof header.kid !== 'string' || !header.kid || header.kid.length > 128) throw new TokenError('malformed');
      const claims = decodeJson(body), signed = decodeBytes(signature);
      const key = await keyFor(header.kid);
      let valid = false;
      try { valid = await subtle().verify('RSASSA-PKCS1-v1_5', key, signed, new TextEncoder().encode(`${head}.${body}`)); } catch { valid = false; }
      if (!valid) throw new TokenError('signature');
      // Only now is anything in the token believed.
      if (claims.aud !== projectId) throw new TokenError('audience');
      if (claims.iss !== tokenIssuer(projectId)) throw new TokenError('issuer');
      const time = now(), exp = seconds(claims.exp), iat = seconds(claims.iat), auth = seconds(claims.auth_time);
      if (exp === null || iat === null || auth === null) throw new TokenError('malformed');
      if (exp <= time) throw new TokenError('expired');
      if (iat > time + skewMs || auth > time + skewMs) throw new TokenError('not_yet_valid');
      if (time - iat > maxAgeMs || time - auth > maxAuthAgeMs) throw new TokenError('stale');
      if (typeof claims.sub !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(claims.sub)) throw new TokenError('subject');
      if (isRecord(claims.firebase) && claims.firebase.tenant !== undefined) throw new TokenError('provider');
      const via = isRecord(claims.firebase) ? claims.firebase.sign_in_provider : undefined;
      const provider: AccountProviderId | null = via === 'google.com' ? 'google' : via === 'password' ? 'password' : null;
      if (!provider) throw new TokenError('provider');
      if (!isAddress(claims.email)) throw new TokenError('email');
      return { subject: claims.sub, email: claims.email, emailVerified: claims.email_verified === true, provider, issuedAt: iat, authAt: auth, expiresAt: exp, digest: await tokenDigest(claims.sub, iat, signed) };
    },
    /** For tests: how many keys are held and until when. */
    cache: (): { keys: number; expiresAt: number } => ({ keys: keys.size, expiresAt }),
  };
}
export type TokenVerifier = ReturnType<typeof createTokenVerifier>;

/**
 * What a used token is remembered by: SHA-256 over its subject, its issue time and its signature's bytes. Taken from the
 * verified content, so no respelling of the same token can have another digest.
 */
export async function tokenDigest(subject: string, issuedAt: number, signature: Uint8Array): Promise<string> {
  const head = new TextEncoder().encode(`${subject}\n${issuedAt}\n`), all = new Uint8Array(head.length + signature.length);
  all.set(head, 0); all.set(signature, head.length);
  return encodeBytes(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', all)));
}
