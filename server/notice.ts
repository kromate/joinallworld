/**
 * OWNER: foundation
 * THE "UPDATE IS COMING" NOTICE. The game is deployed while people play; a deploy ends calls and pings that are in progress.
 * The person who deploys can tell players a few minutes ahead, without any secret held by the server: the announcement is
 * SIGNED (Ed25519) by the release announcer's private key and checked here against the PUBLIC key below.
 *
 * WHAT AN ANNOUNCEMENT CAN DO. Only this: show the page's own fixed wording with a number of minutes (1-15). There is no
 * text, no link, no other field. A leaked private key therefore buys a banner and nothing more; the nonce and the five
 * minute window stop a captured request from being sent again.
 *
 * WHAT THE SERVER KEEPS. `{ id, minutes, until }` in memory, and nothing in storage. It ends by itself at `until`. A host
 * that restarts loses it: that is the update it was announcing, or a stray restart, and the banner simply goes.
 *
 * THE SIGNED TEXT (noticeText): "allworld-notice-v1", kind, minutes, issuedAt and nonce, one per line. The signature is
 * base64url of the 64 raw bytes. announce-update.mjs of the release tooling builds the same text.
 * Portable: no Node imports.
 */
import type { NoticeFrame } from '../src/types/notice.ts';
import type { RouteContext } from './types.ts';

/**
 * The public half of the release announcer's key (base64url, 32 raw bytes). The private half is never in this repository.
 * A fork replaces it through the NOTICE_PUBLIC_KEY setting (docs/DEVELOPING.md, "Announcing an update").
 */
export const NOTICE_PUBLIC_KEY = 'AzbcuMgc16DcepBbuHN-nhRrPhehR6nyn8Rwl954Nl8';
/** An announcement is good when its `issuedAt` is within this of the server's clock. */
export const NOTICE_SKEW_MS = 5 * 60000;
export const NOTICE_MINUTES = { min: 1, max: 15 } as const;
/** Refused attempts one address may make before it is turned away for the window. */
const FAILURES = 5;
const FAILURE_WINDOW_MS = 10 * 60000;

const NONCE = /^[A-Za-z0-9_-]{8,64}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const KEY = /^[A-Za-z0-9_-]{43}$/;

/** What is signed. */
export const noticeText = (kind: string, minutes: number, issuedAt: number, nonce: string): string => `allworld-notice-v1\n${kind}\n${minutes}\n${issuedAt}\n${nonce}`;

export function fromBase64Url(text: string): Uint8Array {
  const plain = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(plain + '='.repeat((4 - (plain.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Both names of the algorithm: the standard one, and the one older Workers runtimes know it by. */
const ALGORITHMS: readonly (string | { name: string; namedCurve: string })[] = ['Ed25519', { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }];

/** True only for a valid Ed25519 signature of `text` by the raw public key. Never throws. */
export async function verifySignature(publicKey: string, text: string, signature: string): Promise<boolean> {
  if (!KEY.test(publicKey) || !SIGNATURE.test(signature)) return false;
  const raw = fromBase64Url(publicKey), sig = fromBase64Url(signature), data = new TextEncoder().encode(text);
  for (const algorithm of ALGORITHMS) {
    try {
      const key = await globalThis.crypto.subtle.importKey('raw', raw, algorithm, false, ['verify']);
      return await globalThis.crypto.subtle.verify(algorithm, key, sig, data);
    } catch { /* this runtime does not know the algorithm by that name: try the other */ }
  }
  return false;
}

export interface NoticeService {
  /** The running notice as a frame, or null (it ends by itself). */
  frame(): NoticeFrame | null
  /** Check an announcement and, when good, start it and tell every open socket. Throws an HTTP error otherwise. */
  announce(body: unknown, ip: string): Promise<{ minutes: number; until: number }>
  /** The same notice started from inside the server (the admin section, which has checked who is asking): no signature, no nonce; 1-15 minutes. */
  start(minutes: number): { minutes: number; until: number }
  /** End the running notice now. */
  stop(): void
}
const services = new WeakMap<RouteContext, NoticeService>();
export function noticeOf(ctx: RouteContext): NoticeService {
  const known = services.get(ctx);
  if (known) return known;
  const built = build(ctx);
  services.set(ctx, built);
  return built;
}

const refuse = (ctx: RouteContext, status: number, code: string, reason: string) => Object.assign(ctx.fail(status, code), { reason });

function build(ctx: RouteContext): NoticeService {
  let current: { id: string; minutes: number; until: number } | null = null;
  /** Nonces already used, each until its announcement could no longer pass the clock check. */
  const seen = new Map<string, number>();
  const frame = (): NoticeFrame | null => {
    if (current && ctx.now() >= current.until) current = null;
    return current ? { type: 'notice', kind: 'update', id: current.id, minutes: current.minutes, until: current.until, serverTime: ctx.now(), build: ctx.config.buildId } : null;
  };
  /** Start the notice and tell every open socket. */
  function begin(id: string, minutes: number): { minutes: number; until: number } {
    current = { id, minutes, until: ctx.now() + minutes * 60000 };
    const announced = frame();
    if (announced) {
      const open = ctx.core?.sockets?.() ?? [];
      if (ctx.broadcast) ctx.broadcast(open, announced); else for (const ws of open) ctx.send(ws, announced);
    }
    return { minutes, until: current.until };
  }
  const key = (): string => { const set = ctx.env('NOTICE_PUBLIC_KEY').trim(); return set || NOTICE_PUBLIC_KEY; };
  return {
    frame,
    async announce(body, ip) {
      const bucket = `notice-fail:${ip}`;
      if (ctx.peek && !ctx.peek(bucket, FAILURES)) throw refuse(ctx, 429, 'notice_rate_limited', 'Too many refused announcements. Try again later.');
      const failed = (status: number, code: string): never => { ctx.allow(bucket, FAILURES, FAILURE_WINDOW_MS); throw refuse(ctx, status, code, 'The announcement was refused.'); };
      const fields = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
      const { kind, minutes, issuedAt, nonce, sig } = fields;
      if (kind !== 'update' || typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < NOTICE_MINUTES.min || minutes > NOTICE_MINUTES.max
        || typeof issuedAt !== 'number' || !Number.isSafeInteger(issuedAt) || typeof nonce !== 'string' || !NONCE.test(nonce) || typeof sig !== 'string' || !SIGNATURE.test(sig)) return failed(400, 'invalid_notice');
      if (!await verifySignature(key(), noticeText(kind, minutes, issuedAt, nonce), sig)) return failed(401, 'notice_unverified');
      const now = ctx.now();
      if (Math.abs(now - issuedAt) > NOTICE_SKEW_MS) return failed(400, 'notice_stale');
      for (const [used, expires] of seen) if (expires <= now) seen.delete(used);
      if (seen.has(nonce)) return failed(409, 'notice_replayed');
      seen.set(nonce, issuedAt + NOTICE_SKEW_MS + 1000);
      return begin(nonce, minutes);
    },
    start(minutes) {
      if (!Number.isInteger(minutes) || minutes < NOTICE_MINUTES.min || minutes > NOTICE_MINUTES.max) throw refuse(ctx, 400, 'invalid_notice', 'Use 1 to 15 minutes.');
      return begin(`admin-${ctx.randomId()}`, minutes);
    },
    stop() { current = null; },
  };
}
