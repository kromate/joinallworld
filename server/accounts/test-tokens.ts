/**
 * TEST SUPPORT: a stand-in for the sign-in provider, for the account tests on both hosts. It makes RSA keys here, serves
 * them the way the provider serves its own, and signs ID tokens with them — so no test ever talks to a real provider.
 * Nothing in the running game imports this file.
 */
import { TOKEN_KEYS_URL, tokenIssuer } from './token.ts';

type Subtle = typeof globalThis.crypto.subtle;
type SigningKey = Parameters<Subtle['sign']>[1];
export interface TestKey { kid: string; privateKey: SigningKey; jwk: { kty: string; n: string; e: string; kid: string; alg: string; use: string } }
/** The claims of a token; anything given replaces the default, and `undefined` removes it. */
export type TokenClaims = Record<string, unknown>;

const b64url = (bytes: Uint8Array): string => { let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const encode = (value: unknown): string => b64url(new TextEncoder().encode(JSON.stringify(value)));

export async function makeKey(kid: string): Promise<TestKey> {
  const pair = await globalThis.crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const exported = await globalThis.crypto.subtle.exportKey('jwk', pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { kty: 'RSA', n: String(exported.n), e: String(exported.e), kid, alg: 'RS256', use: 'sig' } };
}

/** A signed ID token. `header` replaces header fields (a wrong `alg`, another `kid`); `tamper` changes the payload AFTER signing. */
export async function signToken(key: TestKey, claims: TokenClaims, { header = {}, tamper }: { header?: Record<string, unknown>; tamper?: TokenClaims } = {}): Promise<string> {
  const head = encode({ alg: 'RS256', typ: 'JWT', kid: key.kid, ...header }), body = encode(claims);
  const signature = b64url(new Uint8Array(await globalThis.crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(`${head}.${body}`))));
  return `${head}.${tamper ? encode({ ...claims, ...tamper }) : body}.${signature}`;
}

/** What the provider puts in an ID token for `subject`, issued at `now` (server ms). */
export function claimsFor(projectId: string, now: number, { subject = 'UidOfAda0001', email = 'ada@example.com', verified = true, provider = 'password', ...extra }: { subject?: string; email?: string; verified?: boolean; provider?: string } & TokenClaims = {}): TokenClaims {
  const at = Math.floor(now / 1000);
  return { iss: tokenIssuer(projectId), aud: projectId, sub: subject, user_id: subject, iat: at, auth_time: at, exp: at + 3600, email, email_verified: verified, firebase: { sign_in_provider: provider, identities: { email: [email] } }, ...extra };
}

/**
 * The provider as the server's outbound fetch sees it: the key set at its real address (with the given cache lifetime),
 * and a record of every request made. `keys` may be replaced at any time (a rotation); `down` makes every request fail.
 */
export function fakeProvider(keys: TestKey[], { maxAge = 3600 }: { maxAge?: number } = {}) {
  const provider = {
    keys, maxAge, down: false,
    /** Every URL asked for, without its query string, and the JSON body sent with it. */
    requests: [] as { url: string; body: unknown }[],
    keyFetches: 0,
    fetch: async (url: string, init: { body?: unknown } = {}): Promise<Response> => {
      const address = String(url).split('?')[0] ?? '';
      let body: unknown = null;
      try { body = typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch { body = null; }
      provider.requests.push({ url: address, body });
      if (provider.down) throw new TypeError('fetch failed');
      if (address === TOKEN_KEYS_URL) {
        provider.keyFetches += 1;
        return new Response(JSON.stringify({ keys: provider.keys.map(key => key.jwk) }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${provider.maxAge}, must-revalidate, no-transform` } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  return provider;
}
