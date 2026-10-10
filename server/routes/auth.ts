/**
 * OWNER: accounts
 * Account endpoints under /api/account (design: docs/ACCOUNTS.md; rules: server/accounts/service.ts; who a person is:
 * server/accounts/token.ts).
 *
 * OFF UNLESS CONFIGURED. Without the provider's public configuration (host-context.ts accountsConfig) `GET /api/account`
 * answers `{ enabled: false }` and nothing can be signed in to, verified or fetched. Two things still work then, so that
 * a browser signed in while accounts were on is never stuck: it keeps playing its character, and it can SIGN OUT.
 *
 *   GET  /api/account                       { enabled, provider, csrf, guest, account, character, parked }
 *   POST /api/account/sign-in               { idToken, csrf? } → { outcome, created, character, parked, devices, ended, csrf } + a NEW cookie
 *   POST /api/account/sign-out              { csrf } → { ok } + the cookie removed        this browser only; a binding is enough
 *   POST /api/account/character             { idToken, use, csrf } → { character, parked }   make a set-aside character the active one
 *   POST /api/account/sign-out-everywhere   { idToken, csrf } → { ok, ended }             every other browser
 *   POST /api/account/export                { idToken, csrf } → everything stored about the caller's account
 *   POST /api/account/delete                { idToken, csrf, confirm: 'delete', erase? } → { ok, kept } + a guest cookie or none
 *   POST /api/account/password-reset        { email, csrf? } → { ok: true }, whatever the address is
 *
 * EVERY ROUTE BUT THE FIRST requires, on top of the host's own checks (JSON body, per-address limit):
 *   - an Origin header naming this host (the host lets a request WITHOUT one through; these routes do not), and
 *   - when the browser presented a session cookie, the anti-forgery token `csrf` that GET /api/account issued for that
 *     cookie. It is a digest of the cookie, so it needs no storage and changes whenever the cookie does; a page on
 *     another site can neither read the cookie (HttpOnly) nor that answer (no cross-origin read).
 * WHO IS SIGNING IN comes from a verified ID token only. The server never reads a uid, an address or a "verified" flag
 * from a request, never sees a password, and keeps no token: a used token's digest is remembered for a few minutes so
 * the same token cannot be used twice.
 * A BINDING ALONE plays the character and signs itself out. The four routes that reach further (character,
 * sign-out-everywhere, export, delete) also need a FRESH token for the same account — a stolen cookie cannot read the
 * account's address, end the owner's other sign-ins, swap the character or delete anything.
 * ANSWERS DO NOT DESCRIBE ACCOUNTS. A token that is refused for any reason is `401 invalid_token`; a reset request is
 * answered the same way, at the same speed, whether or not the address has an account.
 * LIMITS (ctx.allow; server/limiter.ts — these keys are a bounded class of their own). A token: 10 a minute per
 * address, counted before it is verified; then, ONLY for a token that verified and whose address is confirmed, 300 a minute in all and 8 per five
 * minutes per account — so junk cannot spend the shared bucket. A reset: the shared 120 a minute is looked at first
 * (ctx.peek, which counts nothing), then 5 per fifteen minutes per address and 3 an hour per address written to, so a
 * request that would be refused anyway leaves no row behind. Sign-out: 30 a minute per address. (Every key here starts
 * `account:sign-in` or `account:reset`.) The shared reset bucket has no reserved slice: docs/ACCOUNTS.md says why.
 */
import type { AfterChange, AccountDeps, Caller } from '../accounts/service.ts';
import type { VerifiedIdentity } from '../accounts/token.ts';
import type { RouteContext, RouteHandler, RouteKey, RouteRequest } from '../types.ts';
import { accountView, adoptNewSession, deleteAccount, exportAccount, signIn, signOut, signOutEverywhere, switchCharacter } from '../accounts/service.ts';
import { KeysUnavailable, TOKEN_MAX_AGE_MS, TokenError, createTokenVerifier } from '../accounts/token.ts';
import { commerceSecrets } from '../commerce/service.ts';
import { welcomeService } from '../accounts/welcome.ts';
import { bonusService } from '../bonus/service.ts';
import { UUID_PATTERN, hash53 } from '../protocol.ts';

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
  const welcome = config ? welcomeService(ctx) : null;
  const bonus = config ? bonusService(ctx) : null;
  const deps: AccountDeps = { now, ttlMs: ctx.config.sessionTtlMs, tokenMaxAgeMs: TOKEN_MAX_AGE_MS, newId: () => core.newId(), newSecret: () => core.newIdentity().secret, archive: (db, secret, session) => core.archiveSession(db, secret, session), fail,
    welcome: () => welcome?.ready() === true };
  welcome?.bind(deps);
  // A session made for a signed-in browser whose account has no character yet becomes that account's character (routes/core.ts).
  // Registered whether or not accounts are configured now: a binding made while they were on must keep working.
  if (ctx.checks) ctx.checks.adoptSession = (db, binding, session) => adoptNewSession(db, deps, binding, session);

  const uuid = (value: string | undefined): string | undefined => (value && UUID_PATTERN.test(value) ? value : undefined);
  /** Who is asking: the cookie as presented, and the same value only when it may name a device binding (host-context.ts mayBind). */
  const callerOf = (request: RouteRequest): Caller => ({ cookie: uuid(request.cookie), binding: uuid(request.binding) });
  const limited = () => fail(429, 'account_rate_limited');
  /** The checks every state-changing route makes before it reads anything else. `needsConfig: false` for the one route that outlives the configuration. */
  async function guard(request: RouteRequest, body: Record<string, unknown>, needsConfig = true): Promise<void> {
    if (needsConfig && !config) throw fail(404, 'not_found');
    if (request.strictOrigin !== true) throw fail(403, 'origin_required');
    const cookie = uuid(request.cookie);
    if (cookie && !sameText(await csrfOf(cookie), body.csrf)) throw fail(403, 'csrf_rejected');
  }
  /**
   * What the token proves — or one refusal for every way a token can be wrong. The per-address bucket counts every
   * attempt. The shared bucket and the per-account one count only a token that verified AND whose address is confirmed:
   * neither junk nor validly signed tokens of throwaway, unconfirmed sign-ups can spend what real players share.
   */
  async function identityOf(request: RouteRequest, token: unknown): Promise<VerifiedIdentity> {
    if (!allow(`account:sign-in:ip:${request.ip}`, 10)) throw limited();
    if (!verifier || typeof token !== 'string') throw fail(401, 'invalid_token');
    let identity: VerifiedIdentity;
    try { identity = await verifier.verify(token); }
    catch (error) {
      if (error instanceof KeysUnavailable) throw fail(503, 'accounts_unavailable');
      // The reason is for the operator (a wrong project shows up as `audience`); the browser is told nothing about it.
      if (error instanceof TokenError) { core.log?.(`Account token refused: ${error.refusal}`); throw fail(401, 'invalid_token'); }
      throw error;
    }
    // An address nobody has proved they can read links nothing (whoever typed it first would own the character) and proves nothing.
    if (!identity.emailVerified) throw fail(403, 'email_unverified');
    if (!allow('account:sign-in', 300) || !allow(`account:sign-in:id:${hash53(identity.subject)}`, 8, 300000)) throw limited();
    return identity;
  }
  /** Sockets opened under a session that moved or a binding that is gone are closed: they would otherwise keep their old identity. */
  function closeSockets(after: AfterChange): void {
    if (!core.closeSocket || (!after.closeKeys.length && !after.closeDevices.length)) return;
    for (const ws of core.sockets()) if (after.closeKeys.includes(ws.secret) || (ws.device !== undefined && after.closeDevices.includes(ws.device))) core.closeSocket(ws, SESSION_CHANGED, 'Session changed');
  }
  const clearCookie = (request: RouteRequest): string | string[] => core.clearCookieHeader?.(request) ?? '__Host-sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure';

  return {
    'GET /api/account': async (request) => {
      const caller = callerOf(request);
      if (!config) {
        // Accounts were switched off. A browser that signed in before is told so — who it is and how to sign out — and nothing else is offered.
        const view = caller.binding ? await store.read(db => accountView(db, caller.binding, now())) : null;
        return { body: view?.account ? { enabled: false, csrf: caller.cookie ? await csrfOf(caller.cookie) : null, account: view.account, character: view.character } : { enabled: false } };
      }
      const view = await store.read(db => ({ ...accountView(db, caller.binding, now()), guest: Boolean(request.session(db)) }));
      return { body: { enabled: true, provider: { apiKey: config.apiKey, googleClientId: config.googleClientId }, csrf: caller.cookie ? await csrfOf(caller.cookie) : null, ...view } };
    },
    'POST /api/account/sign-in': async (request) => {
      const body = await request.json();
      await guard(request, body);
      const identity = await identityOf(request, body.idToken);
      const result = await store.transact(db => signIn(db, deps, { ...callerOf(request), identity }));
      closeSockets(result);
      // The launch bonus (server/bonus/service.ts): the place is taken, and paid when the account has a character, at this moment. It never delays or fails the sign-in,
      // and it is settled before the welcome message is written so that the message can say so.
      try { await bonus?.run({ binding: result.cookie, ip: request.ip }); } catch (error) { core.log?.(`Launch bonus could not be settled: ${String((error as { code?: unknown } | null)?.code ?? 'error').slice(0, 40)}`); }
      // The welcome message of a NEW account: owed since the transaction above, sent now that it is saved. It never delays or fails the sign-in.
      if (result.welcome && welcome) ctx.waitUntil?.(welcome.send(result.welcome));
      return { body: { outcome: result.outcome, created: result.created, character: result.character, parked: result.parked, devices: result.devices, ended: result.ended, csrf: await csrfOf(result.cookie) }, headers: { 'Set-Cookie': core.cookieHeader(request, result.cookie) } };
    },
    'POST /api/account/sign-out': async (request) => {
      const body = await request.json();
      await guard(request, body, false);
      if (!allow(`account:sign-in:out:${request.ip}`, 30)) throw limited();
      closeSockets(await store.transact(db => signOut(db, deps, callerOf(request))));
      return { body: { ok: true }, headers: { 'Set-Cookie': clearCookie(request) } };
    },
    'POST /api/account/character': async (request) => {
      const body = await request.json();
      await guard(request, body);
      const identity = await identityOf(request, body.idToken);
      const result = await store.transact(db => switchCharacter(db, deps, callerOf(request), identity, body.use));
      closeSockets(result);
      return { body: { character: result.character, parked: result.parked } };
    },
    'POST /api/account/sign-out-everywhere': async (request) => {
      const body = await request.json();
      await guard(request, body);
      const identity = await identityOf(request, body.idToken);
      const result = await store.transact(db => signOutEverywhere(db, deps, callerOf(request), identity));
      closeSockets(result);
      return { body: { ok: true, ended: result.ended } };
    },
    'POST /api/account/export': async (request) => {
      const body = await request.json();
      await guard(request, body);
      const identity = await identityOf(request, body.idToken);
      return { body: await store.transact(db => exportAccount(db, deps, callerOf(request), identity)) };
    },
    'POST /api/account/delete': async (request) => {
      const body = await request.json();
      await guard(request, body);
      if (body.confirm !== 'delete') throw fail(400, 'confirmation_required');
      const identity = await identityOf(request, body.idToken);
      const result = await store.transact(db => deleteAccount(db, deps, { ...callerOf(request), identity, erase: body.erase === true }));
      closeSockets(result);
      if (result.showcasePhotos?.length) await ctx.showcaseImages?.remove(result.showcasePhotos).catch(() => core.log('Deleted account showcase photos could not be removed.'));
      if (result.commerceRevocation && ctx.commerceGateway) {
        const { accountId, secret } = result.commerceRevocation, gateway = ctx.commerceGateway;
        const revocation = commerceSecrets(ctx).open(secret, accountId).then(token => gateway.revoke(token)).catch(() => core.log('Deleted account store grant revocation could not be confirmed.'));
        ctx.waitUntil?.(revocation); await revocation;
      }
      return { body: { ok: true, kept: result.cookie !== null }, headers: { 'Set-Cookie': result.cookie ? core.cookieHeader(request, result.cookie) : clearCookie(request) } };
    },
    'POST /api/account/password-reset': async (request) => {
      const body = await request.json();
      await guard(request, body);
      const email = resetAddress(body.email);
      if (!config || !email) throw fail(400, 'invalid_email');
      // The shared bucket is LOOKED AT first (nothing is counted, no row is made); only then are the keys of this request's
      // own counted — the address it came from, then the address it writes to. A request refused here leaves no new row.
      if (ctx.peek?.('account:reset', 120) === false) throw limited();
      if (!allow(`account:reset:${request.ip}`, 5, 900000)) throw limited();
      if (!allow(`account:reset:to:${hash53(email)}`, 3, 3600000) || !allow('account:reset', 120)) throw limited();
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
