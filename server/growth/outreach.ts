/**
 * OWNER: growth
 * Reaching a player outside the game: e-mail (Zoho ZeptoMail) and web push. The only module that
 * sends anything out of the server. Rules and words are pure and tested on their own
 * (src/game/outreach.ts, src/game/digest.ts, ./email/templates.js, ./webpush.js); this file holds
 * consent, storage, the schedule and the record of what went out.
 *
 * NOTHING WITHOUT CONSENT
 *   - A player must first have said they are 18 or older (POST /api/growth/consent). A player who
 *     said they are under 18 is never offered, stored for, or sent anything outside the game.
 *   - E-MAIL: the address is stored only after the player ticks the consent sentence
 *     (EMAIL_CONSENT), and nothing but one confirmation message is sent to it until the player
 *     presses the button on the page the confirmation links to (double opt-in). Changing the
 *     address starts again. Removing it — in the game, by the unsubscribe link, or by a mail
 *     program's one-click unsubscribe (RFC 8058) — deletes the address at once.
 *   - PUSH: a subscription is stored only when the player switches notifications on in the game
 *     and the browser grants permission. Switching off, or a push service answering 404/410,
 *     deletes it.
 *
 * STORED (inside the growth collection; never in a life, a profile, a share or a metric)
 *   contacts  { [publicId]: { email, confirmed, nonce, at, confirmedAt, welcomed, confirms: [ms], sends: [ms],
 *               periods: { away, week }, preview } }      the address is returned to nobody — its owner sees it masked
 *   push      { [publicId]: { subs: [{ endpoint, p256dh, auth, at }], sends: [ms], periods } }   (LIMITS.subs per player)
 *   outreach  { off: { email, push }, log: [{ at, channel, kind, state, status?, error? }], sent: { [lagosDay]: { email, push } },
 *               pushPausedUntil }      the log holds no address, no endpoint and no player id (LIMITS.log lines)
 * COMEBACK MAIL (./comeback.ts, docs/COMEBACK-MAIL.md) is written to the same confirmed address, under its own switches and one
 * shared ledger with the weekly digest. The e-mail "away" message of earlier builds is now its 3, 7 and 28 day steps.
 * Two secrets live outside the data file, in DATA_DIR/keys (mode 0600): the key that signs
 * confirmation and unsubscribe links, and the VAPID key pair.
 *
 * EXACTLY ONCE. Before a scheduled message is attempted, its period is claimed in a saved
 * transaction (`periods.away = <Lagos day>`, `periods.week = <Lagos week>`). A crash, a provider
 * failure or a second run after that can only skip the message, never send it again.
 *
 * DRY-RUN. Without ZEPTOMAIL_AUTH, EMAIL_FROM_ADDRESS and a public origin, e-mail is composed
 * exactly as it would be sent and kept as a preview (the player sees theirs in Stay in touch; the
 * operator sees the last few). The log says 'dry-run'. Nothing leaves the server.
 */
import { viewLife } from '../../src/life.ts';
import { lagosTime } from '../../src/game/clock.ts';
import { upcomingEvents } from '../../src/game/calendar.ts';
import { composeDigest } from '../../src/game/digest.ts';
import { cityRules } from '../../src/game/cities/index.ts';
import { OUTREACH, channelUrl, checkEmail, inQuietHours, maskEmail, planMessage } from '../../src/game/outreach.ts';
import { characterCity } from '../character.ts';
import { UUID_PATTERN } from '../protocol.ts';
import { COMEBACK_TYPES } from '../../src/game/comeback.ts';
import type { ComebackType } from '../../src/game/comeback.ts';
import { growthOf, keyed, playerOf } from './data.ts';
import { count } from './metrics.ts';
import { comebackService } from './comeback.ts';
import { pingMailService } from './ping-mail.ts';
import { messagePushService } from './message-push.ts';
import { mailConfig, sendMail } from './email/zeptomail.ts';
import { awayMail, confirmMail, welcomeMail, weekMail } from './email/templates.ts';
import { b64u, cleanSubscription, sendPush, vapidKeys } from './webpush.ts';
import type { PushResult } from './webpush.ts';
import type { MailMessage } from './email/zeptomail.ts';
import type { Digest, OutreachMine, OutreachOperatorResponse } from '../../src/types/growth.ts';
import type { CityId } from '../../src/types/protocol.ts';
import type { LifeState } from '../../src/types/life.ts';
import type { Db, OutreachPeriods, EmailContactRecord, GrowthCollection, PushContactRecord, OutreachRecord, RouteContext, RouteRequest, SessionRecord } from '../types.ts';

type Channel = 'email' | 'push'
/** What deliverMail did: sent (or failed), composed only (dry-run), or stopped by the operator's switch. */
interface DeliveryResult { ok: boolean; off?: true; dryRun?: true; status?: number; attempts?: number; error?: string }
/** One message due, claimed in the schedule's transaction and sent after it. */
type Job =
  | { channel: 'email'; kind: string; id: string; to: string; nonce: string; digest: Digest }
  | { channel: 'push'; kind: string; id: string; subs: { endpoint: string; p256dh: string; auth: string; at: number }[]; digest: Digest }
type PushSub = { endpoint: string; p256dh: string; auth: string; at: number; tz?: number }
/** The stored life a message is about. */
export interface MessageLife { name: string; cityId: CityId; state: LifeState }

/** Select the character's city; latest-played is only a compatibility fallback for old sessions. */
export function messageLifeOf(session: SessionRecord | null | undefined, cityIds: readonly CityId[], now: number): MessageLife | null {
  if (!session || session.expiresAt <= now) return null;
  const cities = cityIds.filter((cityId) => session.cities?.[cityId]?.state).sort((a, b) => (session.cities[b]?.updatedAt ?? 0) - (session.cities[a]?.updatedAt ?? 0));
  const pinned = characterCity(session), active = cities.find((cityId) => cityId === pinned) ?? cities[0];
  const record = active === undefined ? undefined : session.cities[active];
  return active !== undefined && record ? { name: session.name, cityId: active, state: record.state } : null;
}

export function digestForLife(life: MessageLife, now: number) {
  const view = viewLife(life.state, { now, cityId: life.cityId });
  return { view, digest: composeDigest({ name: life.name, city: cityRules(life.state.estate.city)?.name ?? life.state.estate.city, missions: view.missions, events: upcomingEvents(now, 2, life.state.estate.city).slice(0, 3),
    lines: (life.state.social?.notices ?? []).slice(-6).map((notice) => ({ text: notice.text, at: notice.at, group: 'sim' })) }) };
}

export const LIMITS = Object.freeze({ subs: 3, log: 200, previews: 10, batch: 100, tickMs: 60000, emailPerDay: 500, pushPerDay: 5000, unsubscribeDays: 400 });
const HOUR = 3600000, DAY = 86400000;
const text = new TextEncoder();
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const no = <Code extends string>(code: Code, reason: string): { ok: false; code: Code; reason: string } => ({ ok: false, code, reason });
const messageOf = (error: unknown): unknown => (typeof error === 'object' && error !== null && 'message' in error ? error.message : undefined);
const services = new WeakMap<object, ReturnType<typeof buildService>>();

export function outreachService(ctx: RouteContext) {
  const cached = services.get(ctx);
  if (cached) return cached;
  const service = buildService(ctx);
  services.set(ctx, service);
  return service;
}

function buildService(ctx: RouteContext) {
  const now = () => ctx.now();
  const origin = () => ctx.config?.publicOrigin || '';
  const cap = (name: string, fallback: number): number => { const raw = ctx.env(name).trim(), value = Number(raw); return /^\d{1,9}$/.test(raw) && Number.isSafeInteger(value) ? value : fallback; };
  const emailReady = () => mailConfig(ctx).configured && Boolean(origin());
  const contactLine = () => ctx.env('EMAIL_CONTACT_LINE').replace(/[\r\n<>]/g, ' ').slice(0, 200);

  function book(g: GrowthCollection): OutreachRecord {
    if (!isRecord(g.contacts)) g.contacts = {};
    if (!isRecord(g.push)) g.push = {};
    if (!isRecord(g.outreach)) g.outreach = { off: {}, log: [], sent: {}, previews: [] };
    const o = g.outreach;
    if (!isRecord(o.off)) o.off = {};
    if (!Array.isArray(o.log)) o.log = [];
    if (!isRecord(o.sent)) o.sent = {};
    if (!Array.isArray(o.previews)) o.previews = [];
    return o;
  }
  /** The contacts and push subscriptions of the collection, which book() makes sure exist. */
  const contactsOf = (g: GrowthCollection): Record<string, EmailContactRecord> => { book(g); return g.contacts ?? (g.contacts = {}); };
  const pushOf = (g: GrowthCollection): Record<string, PushContactRecord> => { book(g); return g.push ?? (g.push = {}); };
  function note(g: GrowthCollection, channel: Channel, kind: string, state: string, extra: { status?: number; error?: unknown } = {}): void {
    const o = book(g), at = now();
    o.log.push({ at, channel, kind, state, ...(extra.status ? { status: extra.status } : {}), ...(extra.error ? { error: String(extra.error).slice(0, 40) } : {}) });
    if (o.log.length > LIMITS.log) o.log.splice(0, o.log.length - LIMITS.log);
    count(g, at, `${channel}.${state}`);
    if (state === 'sent' || state === 'dry-run') {
      const day = lagosTime(at).day, sent = (o.sent[day] ||= { email: 0, push: 0 });
      sent[channel] = (sent[channel] ?? 0) + 1;
      for (const key of Object.keys(o.sent)) if (day - Number(key) > 14) delete o.sent[key];
    }
  }
  const sentToday = (g: GrowthCollection, channel: Channel): number => book(g).sent[lagosTime(now()).day]?.[channel] ?? 0;

  // ---- signed links -----------------------------------------------------------------------------
  const signingKey = async () => {
    const stored = await ctx.keyFile('growth-signing', () => ({ key: b64u.encode(globalThis.crypto.getRandomValues(new Uint8Array(32))) }));
    return globalThis.crypto.subtle.importKey('raw', b64u.decode(stored.key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  };
  /** A link token: what it is for, whose it is, the contact's nonce and when it stops working — signed, so none of it can be changed. */
  async function token(purpose: string, id: string, nonce: string, expires: number): Promise<string> {
    const body = b64u.encode(text.encode(`${purpose}.${id}.${nonce}.${expires}`));
    return `${body}.${b64u.encode(await globalThis.crypto.subtle.sign('HMAC', await signingKey(), text.encode(body)))}`;
  }
  /** The signed claim of a link token (what it is for, whose it is, the contact's nonce), or null when the signature, the shape or the time is wrong. */
  async function claimOf(value: unknown): Promise<{ purpose: string; id: string; nonce: string } | null> {
    if (typeof value !== 'string' || value.length > 400 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return null;
    const [body, signature] = value.split('.');
    if (body === undefined || signature === undefined) return null;
    try {
      if (!(await globalThis.crypto.subtle.verify('HMAC', await signingKey(), b64u.decode(signature), text.encode(body)))) return null;
      const [what, id, nonce, expires] = new TextDecoder().decode(b64u.decode(body)).split('.');
      if (what === undefined || id === undefined || nonce === undefined || !UUID_PATTERN.test(id) || !UUID_PATTERN.test(nonce) || !(Number(expires) > now())) return null;
      return { purpose: what, id, nonce };
    } catch { return null; }
  }
  async function readToken(value: unknown, purpose: string): Promise<{ id: string; nonce: string } | null> {
    const claim = await claimOf(value);
    return claim && claim.purpose === purpose ? { id: claim.id, nonce: claim.nonce } : null;
  }
  const links = async (id: string, nonce: string) => ({ playUrl: `${origin()}/`, unsubscribeUrl: `${origin()}/e/unsub?t=${await token('unsub', id, nonce, now() + LIMITS.unsubscribeDays * DAY)}` });
  /** RFC 8058: one HTTPS address a mail program may POST to, with no login, to unsubscribe at once. */
  const listHeaders = (unsubscribeUrl: string): Record<string, string> => ({ 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });

  // ---- sending ----------------------------------------------------------------------------------
  /** Send (or, unconfigured, only compose) one e-mail and record what happened. `counts` = it uses up the recipient's allowance. */
  async function deliverMail(id: string, kind: string, to: string, message: Omit<MailMessage, 'to'>, { counts = false }: { counts?: boolean } = {}): Promise<DeliveryResult> {
    // The operator's switch stops every e-mail, confirmations included.
    if (await ctx.store.read((db) => db.growth?.outreach?.off?.email === true)) {
      await ctx.store.transact((db) => note(growthOf(ctx, db), 'email', kind, 'skipped', { error: 'switched_off' }));
      return { ok: false, off: true };
    }
    const live = emailReady();
    const result: DeliveryResult = live ? await sendMail(ctx, { to, ...message }) : { ok: true, dryRun: true };
    await ctx.store.transact((db) => {
      const g = growthOf(ctx, db), o = book(g), contact = contactsOf(g)[id];
      note(g, 'email', kind, result.dryRun ? 'dry-run' : result.ok ? 'sent' : 'failed', result);
      if (!result.ok) return;
      if (contact && counts) { contact.sends.push(now()); if (contact.sends.length > 12) contact.sends.shift(); }
      if (result.dryRun) {
        // A preview never keeps a working link: the signature is cut off, so it cannot confirm or unsubscribe anyone.
        const safe = { kind, at: now(), subject: message.subject, text: message.text.replace(/([?&]t=[A-Za-z0-9_-]{6})[A-Za-z0-9_.-]*/g, '$1…').replace(/(\/j\/[A-Za-z0-9_-]{6})[A-Za-z0-9_-]*/g, '$1…') };
        if (contact) contact.preview = safe;
        o.previews.push(safe); if (o.previews.length > LIMITS.previews) o.previews.shift();
      }
    });
    return result;
  }
  async function deliverPush(id: string, kind: string, subs: PushSub[], payload: unknown): Promise<PushResult[]> {
    const keys = await vapidKeys(ctx), subject = ctx.env('VAPID_SUBJECT') || (origin() ? origin() : 'mailto:operator@allworld.invalid');
    const results: [string, PushResult][] = [];
    for (const sub of subs) results.push([sub.endpoint, await sendPush(ctx, sub, payload, { ttl: 12 * 3600, urgency: 'low', topic: kind, keys, subject })]);
    await ctx.store.transact((db) => {
      const g = growthOf(ctx, db), o = book(g), entry = pushOf(g)[id];
      for (const [endpoint, result] of results) {
        note(g, 'push', kind, result.ok ? 'sent' : result.gone ? 'gone' : 'failed', result);
        // The push service says this subscription no longer exists: forget it.
        if (result.gone && entry) entry.subs = entry.subs.filter((sub) => sub.endpoint !== endpoint);
        if (result.retryAfter) o.pushPausedUntil = now() + result.retryAfter * 1000;
      }
      if (entry && results.some(([, result]) => result.ok)) { entry.sends.push(now()); if (entry.sends.length > 12) entry.sends.shift(); }
      if (entry && !entry.subs.length) { delete pushOf(g)[id]; const player = playerOf(g, id, { create: false }); if (player?.consent) player.consent.push = false; }
    });
    return results.map(([, result]) => result);
  }

  // Comeback mail (./comeback.ts) sends through deliverMail and signs its links with the same key.
  const comeback = comebackService(ctx, {
    emailReady, contactLine, origin, cap, sentToday: (g) => sentToday(g, 'email'),
    lifeOf: (db, id) => lifeOf(db, id),
    token: (purpose, id, nonce, expires) => token(purpose, id, nonce, expires),
    deliver: (id, kind, to, message) => deliverMail(id, kind, to, message),
  });

  // A message on the phone (./message-push.ts): its own caps; it writes only to forget a subscription the push service dropped.
  const pushSubsOf = (g: GrowthCollection, id: string): PushSub[] => {
    const o = book(g), player = playerOf(g, id, { create: false });
    return o.off.push || (o.pushPausedUntil ?? 0) > now() || player?.consent?.age !== 'adult' || player.consent.push !== true ? [] : pushOf(g)[id]?.subs ?? [];
  };
  async function deliverChatPush(id: string, subs: PushSub[], payload: unknown, topic: string): Promise<PushResult[]> {
    const keys = await vapidKeys(ctx), subject = ctx.env('VAPID_SUBJECT') || (origin() ? origin() : 'mailto:operator@allworld.invalid');
    const results: [string, PushResult][] = [];
    for (const sub of subs) results.push([sub.endpoint, await sendPush(ctx, sub, payload, { ttl: 3600, urgency: 'normal', topic, keys, subject })]);
    const gone = results.filter(([, result]) => result.gone).map(([endpoint]) => endpoint);
    if (gone.length) await ctx.store.transact((db) => {
      const g = growthOf(ctx, db), entry = pushOf(g)[id];
      if (entry) entry.subs = entry.subs.filter((sub) => !gone.includes(sub.endpoint));
      if (entry && !entry.subs.length) { delete pushOf(g)[id]; const player = playerOf(g, id, { create: false }); if (player?.consent) player.consent.push = false; }
    });
    return results.map(([, result]) => result);
  }
  const messagePush = messagePushService(ctx, { pushSubs: pushSubsOf, deliver: deliverChatPush });

  // A friend's ping (./ping-mail.ts) leaves through the same sender, under caps of its own.
  const pingMail = pingMailService(ctx, {
    contactLine, origin, cap, sentToday, token: (purpose, id, nonce, expires) => token(purpose, id, nonce, expires),
    deliverMail: (id, kind, to, message) => deliverMail(id, kind, to, message), deliverPush: (id, kind, subs, payload) => deliverPush(id, kind, subs, payload),
    pushSubs(g, id) {
      const o = book(g), player = playerOf(g, id, { create: false });
      return o.off.push || (o.pushPausedUntil ?? 0) > now() || player?.consent?.age !== 'adult' || player.consent.push !== true ? [] : pushOf(g)[id]?.subs ?? [];
    },
  }, comeback);

  // ---- e-mail: ask, confirm, remove ------------------------------------------------------------------
  /** Store an address the player consented to and send its confirmation. `address` is the request's, for the limit only. */
  async function requestEmail(request: RouteRequest, body: Record<string, unknown>) {
    if (body.consent !== true) throw ctx.fail(400, 'consent_required');
    const checked = checkEmail(body.email);
    const saved = await ctx.store.transact((db) => {
      const session = request.requireSession(db, { renew: true });
      // Counted only once there is a session: a request without one makes no hour-long row.
      if (!ctx.allow(`growth:email:${request.ip}`, 10, HOUR)) throw ctx.fail(429, 'rate_limited');
      if (!ctx.allow(`growth:email:${session.publicId}`, 6, HOUR)) throw ctx.fail(429, 'rate_limited');
      const g = growthOf(ctx, db), player = playerOf(g, session.publicId);
      book(g);
      if (!player?.consent) return no('age_required', 'Answer the age question first.');
      if (player.consent.age !== 'adult') return no('under_18', 'E-mail is only for players who are 18 or older. Everything inside the game still works.');
      if (!checked.ok) return checked;
      const old = contactsOf(g)[session.publicId], t = now();
      const confirms = (old?.confirms ?? []).filter((at) => t - at < DAY);
      if (confirms.length >= OUTREACH.confirmsPerDay) return no('confirm_limit', `You have asked for ${OUTREACH.confirmsPerDay} confirmation e-mails today. Look in your inbox and spam folder, or try again tomorrow.`);
      // AN ADDRESS IS SOMEBODY'S INBOX, and the player asking need not be its owner. Whoever asks, one address is sent
      // OUTREACH.confirmsPerDay confirmations a day (counted under a salted hash, never the address), and confirmations
      // as a whole stay inside the server's daily total and may use at most half of it, so that asking for them can
      // neither fill an inbox nor use up what the mail people confirmed for needs.
      const dailyCap = cap('EMAIL_DAILY_CAP', LIMITS.emailPerDay);
      if (!ctx.allow(`growth:email-to:${keyed(g, `email|${checked.email.toLowerCase()}`)}`, OUTREACH.confirmsPerDay, DAY)) return no('confirm_limit', 'That address has been sent several confirmation e-mails today. Look in its inbox and spam folder, or try again tomorrow.');
      if (sentToday(g, 'email') >= dailyCap || !ctx.allow('growth:email-confirm:all', Math.max(1, Math.floor(dailyCap / 2)), DAY)) return no('try_later', 'No more confirmation e-mails can be sent today. Try again tomorrow.');
      // A new or changed address is unconfirmed, and nothing but its confirmation may go to it.
      player.consent.email = false;
      const nonce = ctx.randomId();
      contactsOf(g)[session.publicId] = { email: checked.email, confirmed: false, nonce, at: t, confirmedAt: null, welcomed: false, confirms: [...confirms, t], sends: [], periods: {}, preview: null };
      count(g, t, 'email.optin-started');
      return { ok: true, id: session.publicId, name: session.name, nonce, email: checked.email };
    });
    if (!saved.ok) return saved;
    const confirmUrl = `${origin()}/e/confirm?t=${await token('confirm', saved.id, saved.nonce, now() + OUTREACH.confirmHours * HOUR)}`;
    const result = await deliverMail(saved.id, 'confirm', saved.email, confirmMail({ name: saved.name, confirmUrl, hours: OUTREACH.confirmHours, contact: contactLine() }));
    // The same answer whether or not the provider took it: what a player learns here is only about their own request.
    return { ok: true, code: result.dryRun ? 'dry_run' : 'confirm_sent', email: maskEmail(saved.email), dryRun: result.dryRun === true,
      // In dry-run no message exists to carry the link, so the player's own screen gets it instead.
      ...(result.dryRun ? { confirmPath: confirmUrl.slice(origin().length) } : {}) };
  }
  /** The button on the confirmation page was pressed. */
  async function confirmEmail(value: unknown): Promise<{ ok: boolean }> {
    const claim = await readToken(value, 'confirm');
    if (!claim) return { ok: false };
    const done = await ctx.store.transact((db) => {
      const g = growthOf(ctx, db), contact = (book(g), contactsOf(g)[claim.id]), player = playerOf(g, claim.id, { create: false });
      if (!contact || contact.nonce !== claim.nonce || player?.consent?.age !== 'adult') return { ok: false };
      const first = !contact.confirmed;
      contact.confirmed = true; contact.confirmedAt ||= now(); player.consent.email = true;
      const welcome = first && !contact.welcomed;
      if (welcome) contact.welcomed = true; // claimed here, so the welcome is attempted once
      if (first) { count(g, now(), 'email.confirmed'); comeback.onConfirmed(g, claim.id); }
      const session = ctx.core.sessionByPublicId?.(db, claim.id);
      return { ok: true, welcome, email: contact.email, nonce: contact.nonce, name: session?.name ?? 'friend' };
    });
    if (done.ok && done.welcome) await deliverMail(claim.id, 'welcome', done.email, { ...welcomeMail({ name: done.name, contact: contactLine(), ...(await links(claim.id, done.nonce)) }), headers: listHeaders((await links(claim.id, done.nonce)).unsubscribeUrl) });
    return { ok: done.ok };
  }
  function dropContact(g: GrowthCollection, id: string, how: string): boolean {
    book(g);
    if (!Object.hasOwn(contactsOf(g), id)) return false;
    delete contactsOf(g)[id];
    const player = playerOf(g, id, { create: false });
    if (player?.consent) player.consent.email = false;
    count(g, now(), `email.${how}`);
    return true;
  }
  /** What an unsubscribe link is for: everything (the one in the List-Unsubscribe header) or one type of comeback mail. */
  const unsubScope = (purpose: string): ComebackType | 'all' | null => {
    if (purpose === 'unsub') return 'all';
    const type = purpose.startsWith('unsub-') ? purpose.slice(6) : '';
    return COMEBACK_TYPES.find((known) => known === type) ?? null;
  };
  /** Peek at a link without acting on it (for the page a GET shows). */
  async function unsubscribeScope(value: unknown): Promise<ComebackType | 'all' | null> { const claim = await claimOf(value); return claim ? unsubScope(claim.purpose) : null; }
  /** An unsubscribe link, or a mail program's one-click POST. No login: the signed token is the authority. */
  async function unsubscribe(value: unknown): Promise<{ ok: boolean; scope?: ComebackType | 'all' }> {
    const claim = await claimOf(value), scope = claim ? unsubScope(claim.purpose) : null;
    if (!claim || scope === null) return { ok: false };
    await ctx.store.transact((db) => {
      const g = growthOf(ctx, db);
      // The link's nonce must be the current recipient's: a changed or removed address voids it (mailRecipientOf decides who that is).
      const recipient = comeback.recipientOf(db, g, claim.id);
      if (recipient?.nonce !== claim.nonce) return;
      comeback.unsubscribeType(db, g, claim.id, scope);
      // The Stay in touch address is deleted; an account's address is the account's own and stays (its mail is off).
      if (scope === 'all' && recipient.source === 'contact') dropContact(g, claim.id, 'unsubscribed');
    });
    return { ok: true, scope }; // also when it was already gone: unsubscribing twice is still unsubscribed
  }

  // ---- push: subscribe, unsubscribe ---------------------------------------------------------------------
  function subscribe(g: GrowthCollection, session: SessionRecord, body: Record<string, unknown>) {
    if (body.consent !== true) throw ctx.fail(400, 'consent_required');
    const sub = cleanSubscription(body.subscription);
    if (!sub) throw ctx.fail(400, 'invalid_subscription');
    const player = playerOf(g, session.publicId);
    book(g);
    if (!player?.consent) return no('age_required', 'Answer the age question first.');
    if (player.consent.age !== 'adult') return no('under_18', 'Notifications are only for players who are 18 or older. Everything inside the game still works.');
    const entry = (pushOf(g)[session.publicId] ||= { subs: [], sends: [], periods: {} });
    // The device's own offset from UTC in minutes, when the browser said it: quiet hours for messages follow it.
    const tz = typeof body.tz === 'number' && Number.isInteger(body.tz) && Math.abs(body.tz) <= 840 ? body.tz : undefined;
    entry.subs = [...entry.subs.filter((item) => item.endpoint !== sub.endpoint), { ...sub, at: now(), ...(tz !== undefined ? { tz } : {}) }].slice(-LIMITS.subs);
    if (!player.consent.push) count(g, now(), 'push.optin');
    player.consent.push = true;
    return { ok: true, code: 'subscribed' };
  }
  function unsubscribePush(g: GrowthCollection, id: string, endpoint: unknown) {
    book(g);
    const entry = pushOf(g)[id];
    if (entry) entry.subs = typeof endpoint === 'string' ? entry.subs.filter((sub) => sub.endpoint !== endpoint) : [];
    if (!entry?.subs.length) { if (entry) count(g, now(), 'push.optout'); delete pushOf(g)[id]; const player = playerOf(g, id, { create: false }); if (player?.consent) player.consent.push = false; }
    return { ok: true, code: 'unsubscribed' };
  }

  // ---- the schedule -----------------------------------------------------------------------------
  /** The stored life a message is about: the character's actual city. Read-only — nothing is settled. */
  function lifeOf(db: Db, id: string): MessageLife | null {
    const session = ctx.core.sessionByPublicId?.(db, id);
    return messageLifeOf(session, ctx.cityIds, now());
  }
  function digestFor(life: MessageLife) {
    return digestForLife(life, now());
  }
  let running = false, lastTick = 0, stopped = false, current: Promise<unknown> | null = null;
  /**
   * Look at who is due a message and send it. Runs at most once a minute from the server's heartbeat
   * (and when the operator asks). Each due message is claimed in a saved transaction first.
   */
  function tick(options?: { force?: boolean }): Promise<{ ran: boolean; jobs?: number; reason?: 'quiet_hours' | 'stopping'; failed?: true }> { if (stopped) return Promise.resolve({ ran: false, reason: 'stopping' }); const run = runTick(options); current = run; ctx.waitUntil?.(run.catch(() => {})); run.then(() => {}, () => {}).then(() => { if (current === run) current = null; }); return run; }
  async function runTick({ force = false }: { force?: boolean } = {}): Promise<{ ran: boolean; jobs?: number; reason?: 'quiet_hours' | 'stopping'; failed?: true }> {
    if (running || (!force && now() - lastTick < LIMITS.tickMs)) return { ran: false };
    running = true; lastTick = now();
    const jobs: Job[] = [];
    try {
      if (inQuietHours(now())) return { ran: true, jobs: 0, reason: 'quiet_hours' };
      await ctx.store.transact((db) => {
        const g = growthOf(ctx, db), o = book(g), t = now(), week = lagosTime(t).week;
        const due = (id: string, entry: { sends: number[]; periods: OutreachPeriods }, channel: Channel) => {
          const player = playerOf(g, id, { create: false });
          if (player?.consent?.age !== 'adult' || player.consent[channel] !== true) return null;
          const life = lifeOf(db, id);
          if (!life) return null;
          const stamps = life.state.missions?.stamps;
          // E-mail shares one ledger with comeback mail: the digest counts as one of the player's mails, and comeback mail owns the "away" kind.
          const sends = channel === 'email' ? comeback.sendsFor(g, id, entry.sends) : entry.sends;
          const plan = planMessage({ now: t, seen: player.seen, sends, periods: entry.periods, playedThisWeek: stamps?.week === week && stamps.days > 0 });
          if (channel === 'email' && (plan.kind === 'away' || (plan.kind === 'week' && !comeback.weekAllowed(g, id, t)))) return null;
          return plan.kind ? { kind: plan.kind, period: plan.period, life } : null;
        };
        if (!o.off.email) for (const [id, contact] of Object.entries(contactsOf(g))) {
          if (jobs.length >= LIMITS.batch || sentToday(g, 'email') + jobs.filter((job) => job.channel === 'email').length >= cap('EMAIL_DAILY_CAP', LIMITS.emailPerDay)) break;
          if (!contact.confirmed) continue;
          const found = due(id, contact, 'email');
          if (!found) continue;
          contact.periods[found.kind] = found.period; // the claim
          if (found.kind === 'week') comeback.noteDigest(g, id, t);
          jobs.push({ channel: 'email', kind: found.kind, id, to: contact.email, nonce: contact.nonce, digest: digestFor(found.life).digest });
        }
        if (!o.off.push && !((o.pushPausedUntil ?? 0) > t)) for (const [id, entry] of Object.entries(pushOf(g))) {
          if (jobs.length >= LIMITS.batch || sentToday(g, 'push') + jobs.filter((job) => job.channel === 'push').length >= cap('PUSH_DAILY_CAP', LIMITS.pushPerDay)) break;
          if (!entry.subs.length) continue;
          const found = due(id, entry, 'push');
          if (!found) continue;
          entry.periods[found.kind] = found.period;
          jobs.push({ channel: 'push', kind: found.kind, id, subs: entry.subs.map((sub) => ({ ...sub })), digest: digestFor(found.life).digest });
        }
      }, { durable: () => jobs.length > 0 });
      for (const job of jobs) {
        if (job.channel === 'email') {
          const urls = await links(job.id, job.nonce);
          const message = (job.kind === 'week' ? weekMail : awayMail)({ digest: job.digest, contact: contactLine(), ...urls });
          await deliverMail(job.id, job.kind, job.to, { ...message, headers: listHeaders(urls.unsubscribeUrl) }, { counts: true });
        } else {
          const body = job.digest.lines[0] ?? job.digest.tasks[0]?.text ?? 'See what is waiting in the city.';
          await deliverPush(job.id, job.kind, job.subs, { title: job.kind === 'week' ? job.digest.subject : 'While you were away', body, url: '/', tag: job.kind });
        }
      }
      return { ran: true, jobs: jobs.length };
    } catch (error) { ctx.core?.log?.(`Outreach tick failed: ${String(messageOf(error) ?? error).split('\n')[0]?.slice(0, 200)}`); return { ran: true, jobs: jobs.length, failed: true }; }
    finally { running = false; }
  }
  ctx.on?.('heartbeat', () => { void tick(); });
  // The server is stopping: no new round starts, and a round that is sending is waited for, so what it sent is recorded
  // before the store closes (a claimed message is then never attempted again after a restart).
  ctx.closing?.push(async () => { stopped = true; await current?.catch(() => {}); });

  // ---- what each side may see ---------------------------------------------------------------------
  /** For the player's own Stay in touch screen. */
  function mine(db: Db, g: GrowthCollection, id: string, session?: SessionRecord): OutreachMine {
    book(g);
    const contact = contactsOf(g)[id], entry = pushOf(g)[id];
    return { channel: channelUrl(ctx.env('WHATSAPP_CHANNEL_URL')),
      email: contact ? { address: maskEmail(contact.email), confirmed: contact.confirmed, preview: contact.preview ? { kind: contact.preview.kind, subject: contact.preview.subject, text: contact.preview.text } : null } : null,
      push: { devices: entry?.subs.length ?? 0 }, live: { email: emailReady() }, comeback: comeback.viewOf(db, g, id, session) };
  }
  /** For the operator: totals, switches, the last lines of the log and the last dry-run previews. No address, no endpoint, no player id. */
  function operatorView(g: GrowthCollection): Omit<OutreachOperatorResponse, never> {
    const o = book(g), contacts = Object.values(contactsOf(g)), config = mailConfig(ctx);
    const recent = (channel: Channel) => o.log.filter((line) => line.channel === channel);
    return {
      email: { provider: 'zeptomail', configured: config.configured, origin: Boolean(origin()), live: emailReady() && !o.off.email, off: o.off.email === true, from: config.configured ? config.from : null,
        confirmed: contacts.filter((contact) => contact.confirmed).length, awaitingConfirmation: contacts.filter((contact) => !contact.confirmed).length,
        sentToday: sentToday(g, 'email'), dailyCap: cap('EMAIL_DAILY_CAP', LIMITS.emailPerDay), lastError: recent('email').filter((line) => line.state === 'failed').at(-1) ?? null },
      push: { off: o.off.push === true, subscribers: Object.keys(pushOf(g)).length, devices: Object.values(pushOf(g)).reduce((sum, entry) => sum + entry.subs.length, 0), sentToday: sentToday(g, 'push'),
        dailyCap: cap('PUSH_DAILY_CAP', LIMITS.pushPerDay), pausedUntil: o.pushPausedUntil !== undefined && o.pushPausedUntil > now() ? o.pushPausedUntil : null, lastError: recent('push').filter((line) => line.state === 'failed').at(-1) ?? null },
      comeback: comeback.operatorView(g),
      whatsapp: { channel: channelUrl(ctx.env('WHATSAPP_CHANNEL_URL')) || null },
      rules: OUTREACH, quietNow: inQuietHours(now()), log: o.log.slice(-100).reverse(), previews: o.previews.slice().reverse(),
    };
  }
  function setSwitch(g: GrowthCollection, channel: unknown, off: unknown) {
    if ((channel !== 'email' && channel !== 'push') || typeof off !== 'boolean') throw ctx.fail(400, 'invalid_switch');
    book(g).off[channel] = off;
    note(g, channel, 'switch', off ? 'off' : 'on');
    return { ok: true, channel, off };
  }

  return { requestEmail, confirmEmail, unsubscribe, unsubscribeScope, comeback, pingMail, messagePush, pushSubsOf, deliverChatPush, dropContact, subscribe, unsubscribePush, tick, mine, operatorView, setSwitch, publicKey: async () => (await vapidKeys(ctx)).publicKey };
}
