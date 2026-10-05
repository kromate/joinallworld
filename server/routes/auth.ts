/**
 * OWNER: accounts
 * Account endpoints under /api/account (design: docs/ACCOUNTS.md; rules: server/accounts/service.ts; who a person is:
 * server/accounts/token.ts).
 *
 * OFF UNLESS CONFIGURED. Without the provider's public configuration (host-context.ts accountsConfig) `GET /api/account`
 * answers `{ enabled: false }` and every other route here is a 404 — nothing is stored, verified or fetched.
 *
 *   GET  /api/account                       { enabled, provider, csrf, guest, account, character, parked }
 *   POST /api/account/sign-in               { idToken, csrf? } → { outcome, created, character, parked, csrf } + a NEW cookie
 *   POST /api/account/character             { use, csrf } → { character, parked }        make a set-aside character the active one
 *   POST /api/account/sign-out              { csrf } → { ok } + the cookie removed        this browser only
 *   POST /api/account/sign-out-everywhere   { csrf } → { ok, ended }                      every other browser
 *   POST /api/account/delete                { idToken, csrf, confirm: 'delete', erase? } → { ok, kept } + a guest cookie or none
 *   GET  /api/account/export                everything stored about the caller's account
 *   POST /api/account/password-reset        { email, csrf? } → { ok: true }, whatever the address is
 *
 * EVERY STATE-CHANGING ROUTE requires, on top of the host's own checks (JSON body, per-address limit):
 *   - an Origin header naming this host (the host lets a request WITHOUT one through; these routes do not), and
 *   - when the browser presented a session cookie, the anti-forgery token `csrf` that GET /api/account issued for that
 *     cookie. It is a digest of the cookie, so it needs no storage and changes whenever the cookie does; a page on
 *     another site can neither read the cookie (HttpOnly) nor that answer (no cross-origin read).
 * WHO IS SIGNING IN comes from a verified ID token only. The server never reads a uid, an address or a "verified" flag
 * from a request, never sees a password, and keeps no token: a used token's digest is remembered for a few minutes so
 * the same token cannot be used twice.
 * ANSWERS DO NOT DESCRIBE ACCOUNTS. A token that is refused for any reason is `401 invalid_token`; a reset request is
 * answered the same way, at the same speed, whether or not the address has an account.
 * LIMITS (ctx.allow): sign-in and delete 10 a minute per address and 300 a minute in all, then 8 per five minutes per
 * account; a reset 5 per fifteen minutes per address and 3 an hour per address written to; the rest 30 a minute per address.
 */
import type { AfterChange, AccountDeps } from '../accounts/service.ts';
import type { VerifiedIdentity } from '../accounts/token.ts';
import type { RouteContext, RouteHandler, RouteKey, RouteRequest } from '../types.ts';
import { accountView, adoptNewSession, deleteAccount, exportAccount, signIn, signOut, signOutEverywhere, switchCharacter } from '../accounts/service.ts';
import { KeysUnavailable, TOKEN_MAX_AGE_MS, TokenError, createTokenVerifier, tokenDigest } from '../accounts/token.ts';
import { UUID_PATTERN, hash53, sessionOfCookie } from '../protocol.ts';

/** Where the provider takes a request to send its password-reset e-mail. */
export const RESET_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode';
/** The close code of a socket whose session was signed out, moved or removed. */
export const SESSION_CHANGED = 4401;

/** The anti-forgery token of a session cookie: a digest of it, so it is new whenever the cookie is. */
export async function csrfOf(cookie: string): Promise<string> {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`allworld-account-csrf\n${cookie}`)));
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** Compare without stopping at the first difference. */
function sameText(a: string, b: unknown): boolean {
  if (typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
/** An address as it is sent to the provider: trimmed, lower-case, bounded, one `@`. Null when it is not one. */
export function resetAddress(value: unknown): string | null {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email.length >= 3 && email.length <= 254 && /^[^\s@\u0000-\u001f\u007f<>"']+@[^\s@\u0000-\u001f\u007f<>"']+$/.test(email) ? email : null;
}

export default function accountRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const { store, now, fail, allow, core } = ctx;
  const config = ctx.config.accounts ?? null;
  const verifier = config ? createTokenVerifier({ projectId: config.projectId, fetch: (url, init) => ctx.fetch(url, init), now }) : null;
  const deps: AccountDeps = { now, ttlMs: ctx.config.sessionTtlMs, newId: () => core.newId(), newSecret: () => core.newIdentity().secret, archive: (db, secret, session) => core.archiveSession(db, secret, session), fail };
  // A session made for a signed-in browser whose account has no character yet becomes that account's character (routes/core.ts).
  if (config && ctx.checks) ctx.checks.adoptSession = (db, cookie, session) => adoptNewSession(db, deps, cookie, session);

  const presented = (request: RouteRequest): string | undefined => (request.cookie && UUID_PATTERN.test(request.cookie) ? request.cookie : undefined);
  const limited = () => fail(429, 'account_rate_limited');
  /** The checks every state-changing route makes before it reads anything else. */
  async function guard(request: RouteRequest, body: Record<string, unknown>): Promise<void> {
    if (!config) throw fail(404, 'not_found');
    if (request.strictOrigin !== true) throw fail(403, 'origin_required');
    const cookie = presented(request);
    if (cookie && !sameText(await csrfOf(cookie), body.csrf)) throw fail(403, 'csrf_rejected');
  }
  /** What the token proves — or one refusal for every way a token can be wrong. */
  async function identityOf(token: unknown): Promise<{ identity: VerifiedIdentity; digest: string }> {
    if (!verifier || typeof token !== 'string') throw fail(401, 'invalid_token');
    try { return { identity: await verifier.verify(token), digest: await tokenDigest(token) }; }
    catch (error) {
      if (error instanceof KeysUnavailable) throw fail(503, 'accounts_unavailable');
      // The reason is for the operator (a wrong project shows up as `audience`); the browser is told nothing about it.
      if (error instanceof TokenError) { core.log?.(`Account token refused: ${error.refusal}`); throw fail(401, 'invalid_token'); }
      throw error;
    }
  }
  /** Sockets opened under a session that moved or a binding that is gone are closed: they would otherwise keep their old identity. */
  function closeSockets(after: AfterChange): void {
    if (!core.closeSocket || (!after.closeKeys.length && !after.closeDevices.length)) return;
    for (const ws of core.sockets()) if (after.closeKeys.includes(ws.secret) || (ws.device !== undefined && after.closeDevices.includes(ws.device))) core.closeSocket(ws, SESSION_CHANGED, 'Session changed');
  }
  const clearCookie = (request: RouteRequest): string => core.clearCookieHeader?.(request) ?? 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure';

  return {
    'GET /api/account': async (request) => {
      if (!config) return { body: { enabled: false } };
      const cookie = presented(request);
      const view = await store.read(db => ({ ...accountView(db, cookie, now()), guest: Boolean(sessionOfCookie(db, cookie, now())) }));
      return { body: { enabled: true, provider: { apiKey: config.apiKey, googleClientId: config.googleClientId }, csrf: cookie ? await csrfOf(cookie) : null, ...view } };
    },
    'POST /api/account/sign-in': async (request) => {
      const body = await request.json();
      await guard(request, body);
      if (!allow(`account:sign-in:${request.ip}`, 10) || !allow('account:sign-in', 300)) throw limited();
      const { identity, digest } = await identityOf(body.idToken);
      if (!allow(`account:id:${hash53(identity.subject)}`, 8, 300000)) throw limited();
      // An address nobody has proved they can read links nothing: whoever typed it first would own the character.
      if (!identity.emailVerified) throw fail(403, 'email_unverified');
      const result = await store.transact(db => signIn(db, deps, { cookie: presented(request), identity, digest, tokenMaxAgeMs: TOKEN_MAX_AGE_MS }));
      closeSockets(result);
      return { body: { outcome: result.outcome, created: result.created, character: result.character, parked: result.parked, csrf: await csrfOf(result.cookie) }, headers: { 'Set-Cookie': core.cookieHeader(request, result.cookie) } };
    },
    'POST /api/account/character': async (request) => {
      const body = await request.json();
      await guard(request, body);
      if (!allow(`account:change:${request.ip}`, 30)) throw limited();
      const result = await store.transact(db => switchCharacter(db, deps, presented(request), body.use));
      closeSockets(result);
      return { body: { character: result.character, parked: result.parked } };
    },
    'POST /api/account/sign-out': async (request) => {
      const body = await request.json();
      await guard(request, body);
      if (!allow(`account:change:${request.ip}`, 30)) throw limited();
      closeSockets(await store.transact(db => signOut(db, deps, presented(request))));
      return { body: { ok: true }, headers: { 'Set-Cookie': clearCookie(request) } };
    },
    'POST /api/account/sign-out-everywhere': async (request) => {
      const body = await request.json();
      await guard(request, body);
      if (!allow(`account:change:${request.ip}`, 30)) throw limited();
      const result = await store.transact(db => signOutEverywhere(db, deps, presented(request)));
      closeSockets(result);
      return { body: { ok: true, ended: result.ended } };
    },
    'POST /api/account/delete': async (request) => {
      const body = await request.json();
      await guard(request, body);
      if (body.confirm !== 'delete') throw fail(400, 'confirmation_required');
      if (!allow(`account:sign-in:${request.ip}`, 10) || !allow('account:sign-in', 300)) throw limited();
      const { identity, digest } = await identityOf(body.idToken);
      if (!allow(`account:id:${hash53(identity.subject)}`, 8, 300000)) throw limited();
      const result = await store.transact(db => deleteAccount(db, deps, { cookie: presented(request), identity, digest, tokenMaxAgeMs: TOKEN_MAX_AGE_MS, erase: body.erase === true }));
      closeSockets(result);
      return { body: { ok: true, kept: result.cookie !== null }, headers: { 'Set-Cookie': result.cookie ? core.cookieHeader(request, result.cookie) : clearCookie(request) } };
    },
    'GET /api/account/export': async (request) => {
      if (!config) throw fail(404, 'not_found');
      if (!allow(`account:export:${request.ip}`, 6)) throw limited();
      return { body: await store.read(db => exportAccount(db, deps, presented(request))) };
    },
    'POST /api/account/password-reset': async (request) => {
      const body = await request.json();
      await guard(request, body);
      const email = resetAddress(body.email);
      if (!config || !email) throw fail(400, 'invalid_email');
      if (!allow(`account:reset:${request.ip}`, 5, 900000) || !allow(`account:reset:to:${hash53(email)}`, 3, 3600000) || !allow('account:reset', 120)) throw limited();
      // The provider is asked in the background and its answer is never relayed: the reply below is the same, and as
      // fast, for an address with an account and one without. Only a failure of the provider itself is logged, without the address.
      const origin = ctx.config.publicOrigin;
      const sent = Promise.resolve().then(() => ctx.fetch(`${RESET_URL}?key=${encodeURIComponent(config.apiKey)}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { referer: `${origin}/` } : {}) }, body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }) }))
        .then(async (reply) => {
          const answer = reply as { status?: unknown; text?: () => Promise<string> } | null;
          try { await answer?.text?.(); } catch { /* nothing to read */ }
          if (typeof answer?.status === 'number' && (answer.status >= 500 || answer.status === 403 || answer.status === 429)) core.log?.(`Password reset could not be requested: provider answered ${answer.status}`);
        })
        .catch(() => { core.log?.('Password reset could not be requested: the provider did not answer'); });
      ctx.waitUntil?.(sent);
      return { body: { ok: true } };
    },
  };
}
