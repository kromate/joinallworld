/**
 * OWNER: growth
 * Reaching a player outside the game: e-mail (Zoho ZeptoMail) and web push. The only module that
 * sends anything out of the server. Rules and words are pure and tested on their own
 * (src/game/outreach.js, src/game/digest.js, ./email/templates.js, ./webpush.js); this file holds
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
import { OUTREACH, channelUrl, checkEmail, inQuietHours, maskEmail, planMessage } from '../../src/game/outreach.ts';
import { UUID_PATTERN } from '../protocol.js';
import { growthOf, playerOf } from './data.js';
import { count } from './metrics.js';
import { mailConfig, sendMail } from './email/zeptomail.js';
import { awayMail, confirmMail, welcomeMail, weekMail } from './email/templates.js';
import { b64u, cleanSubscription, sendPush, vapidKeys } from './webpush.js';

export const LIMITS = Object.freeze({ subs: 3, log: 200, previews: 10, batch: 100, tickMs: 60000, emailPerDay: 500, pushPerDay: 5000, unsubscribeDays: 400 });
const HOUR = 3600000, DAY = 86400000;
const CITY_NAMES = { lagos: 'Lagos', ibadan: 'Ibadan' };
const text = new TextEncoder();
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const no = (code, reason, extra) => ({ ok: false, code, reason, ...extra });
const services = new WeakMap();

export function outreachService(ctx) {
  const cached = services.get(ctx);
  if (cached) return cached;
  const now = () => ctx.now();
  const origin = () => ctx.config?.publicOrigin || '';
  const cap = (name, fallback) => { const raw = ctx.env(name).trim(), value = Number(raw); return /^\d{1,9}$/.test(raw) && Number.isSafeInteger(value) ? value : fallback; };
  const emailReady = () => mailConfig(ctx).configured && Boolean(origin());
  const contactLine = () => ctx.env('EMAIL_CONTACT_LINE').replace(/[\r\n<>]/g, ' ').slice(0, 200);

  function book(g) {
    for (const key of ['contacts', 'push']) if (!isRecord(g[key])) g[key] = {};
    if (!isRecord(g.outreach)) g.outreach = {};
    const o = g.outreach;
    if (!isRecord(o.off)) o.off = {};
    if (!Array.isArray(o.log)) o.log = [];
    if (!isRecord(o.sent)) o.sent = {};
    if (!Array.isArray(o.previews)) o.previews = [];
    return o;
  }
  function note(g, channel, kind, state, extra = {}) {
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
  const sentToday = (g, channel) => book(g).sent[lagosTime(now()).day]?.[channel] ?? 0;

  // ---- signed links -----------------------------------------------------------------------------
  const signingKey = async () => {
    const stored = await ctx.keyFile('growth-signing', () => ({ key: b64u.encode(globalThis.crypto.getRandomValues(new Uint8Array(32))) }));
    return globalThis.crypto.subtle.importKey('raw', b64u.decode(stored.key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  };
  /** A link token: what it is for, whose it is, the contact's nonce and when it stops working — signed, so none of it can be changed. */
  async function token(purpose, id, nonce, expires) {
    const body = b64u.encode(text.encode(`${purpose}.${id}.${nonce}.${expires}`));
    return `${body}.${b64u.encode(await globalThis.crypto.subtle.sign('HMAC', await signingKey(), text.encode(body)))}`;
  }
  async function readToken(value, purpose) {
    if (typeof value !== 'string' || value.length > 400 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return null;
    const [body, signature] = value.split('.');
    try {
      if (!(await globalThis.crypto.subtle.verify('HMAC', await signingKey(), b64u.decode(signature), text.encode(body)))) return null;
      const [what, id, nonce, expires] = new TextDecoder().decode(b64u.decode(body)).split('.');
      if (what !== purpose || !UUID_PATTERN.test(id) || !UUID_PATTERN.test(nonce) || !(Number(expires) > now())) return null;
      return { id, nonce };
    } catch { return null; }
  }
  const links = async (id, nonce) => ({ playUrl: `${origin()}/`, unsubscribeUrl: `${origin()}/e/unsub?t=${await token('unsub', id, nonce, now() + LIMITS.unsubscribeDays * DAY)}` });
  /** RFC 8058: one HTTPS address a mail program may POST to, with no login, to unsubscribe at once. */
  const listHeaders = (unsubscribeUrl) => ({ 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });

  // ---- sending ----------------------------------------------------------------------------------
  /** Send (or, unconfigured, only compose) one e-mail and record what happened. `counts` = it uses up the recipient's allowance. */
  async function deliverMail(id, kind, to, message, { counts = false } = {}) {
    // The operator's switch stops every e-mail, confirmations included.
    if (await ctx.store.read((db) => db.growth?.outreach?.off?.email === true)) {
      await ctx.store.transact((db) => note(growthOf(ctx, db), 'email', kind, 'skipped', { error: 'switched_off' }));
      return { ok: false, off: true };
    }
    const live = emailReady();
    const result = live ? await sendMail(ctx, { to, ...message }) : { ok: true, dryRun: true };
    await ctx.store.transact((db) => {
      const g = growthOf(ctx, db), o = book(g), contact = g.contacts[id];
      note(g, 'email', kind, result.dryRun ? 'dry-run' : result.ok ? 'sent' : 'failed', result);
      if (!result.ok) return;
      if (contact && counts) { contact.sends.push(now()); if (contact.sends.length > 12) contact.sends.shift(); }
      if (result.dryRun) {
        // A preview never keeps a working link: the signature is cut off, so it cannot confirm or unsubscribe anyone.
        const safe = { kind, at: now(), subject: message.subject, text: message.text.replace(/([?&]t=[A-Za-z0-9_-]{6})[A-Za-z0-9_.-]*/g, '$1…') };
        if (contact) contact.preview = safe;
        o.previews.push(safe); if (o.previews.length > LIMITS.previews) o.previews.shift();
      }
    });
    return result;
  }
  async function deliverPush(id, kind, subs, payload) {
    const keys = await vapidKeys(ctx), subject = ctx.env('VAPID_SUBJECT') || (origin() ? origin() : 'mailto:operator@allworld.invalid');
    const results = [];
    for (const sub of subs) results.push([sub.endpoint, await sendPush(ctx, sub, payload, { ttl: 12 * 3600, urgency: 'low', topic: kind, keys, subject })]);
    await ctx.store.transact((db) => {
      const g = growthOf(ctx, db), o = book(g), entry = g.push[id];
      for (const [endpoint, result] of results) {
        note(g, 'push', kind, result.ok ? 'sent' : result.gone ? 'gone' : 'failed', result);
        // The push service says this subscription no longer exists: forget it.
        if (result.gone && entry) entry.subs = entry.subs.filter((sub) => sub.endpoint !== endpoint);
        if (result.retryAfter) o.pushPausedUntil = now() + result.retryAfter * 1000;
      }
      if (entry && results.some(([, result]) => result.ok)) { entry.sends.push(now()); if (entry.sends.length > 12) entry.sends.shift(); }
      if (entry && !entry.subs.length) { delete g.push[id]; const player = playerOf(g, id, { create: false }); if (player?.consent) player.consent.push = false; }
    });
    return results.map(([, result]) => result);
  }

  // ---- e-mail: ask, confirm, remove ------------------------------------------------------------------
  /** Store an address the player consented to and send its confirmation. `address` is the request's, for the limit only. */
  async function requestEmail(request, body) {
    if (body.consent !== true) throw ctx.fail(400, 'consent_required');
    const checked = checkEmail(body.email);
    if (!ctx.allow(`growth:email:${request.ip}`, 10, HOUR)) throw ctx.fail(429, 'rate_limited');
    const saved = await ctx.store.transact((db) => {
      const session = request.requireSession(db, { renew: true });
      if (!ctx.allow(`growth:email:${session.publicId}`, 6, HOUR)) throw ctx.fail(429, 'rate_limited');
      const g = growthOf(ctx, db), player = playerOf(g, session.publicId);
      book(g);
      if (!player?.consent) return no('age_required', 'Answer the age question first.');
      if (player.consent.age !== 'adult') return no('under_18', 'E-mail is only for players who are 18 or older. Everything inside the game still works.');
      if (!checked.ok) return checked;
      const old = g.contacts[session.publicId], t = now();
      const confirms = (old?.confirms ?? []).filter((at) => t - at < DAY);
      if (confirms.length >= OUTREACH.confirmsPerDay) return no('confirm_limit', `You have asked for ${OUTREACH.confirmsPerDay} confirmation e-mails today. Look in your inbox and spam folder, or try again tomorrow.`);
      // A new or changed address is unconfirmed, and nothing but its confirmation may go to it.
      player.consent.email = false;
      const nonce = ctx.randomId();
      g.contacts[session.publicId] = { email: checked.email, confirmed: false, nonce, at: t, confirmedAt: null, welcomed: false, confirms: [...confirms, t], sends: [], periods: {}, preview: null };
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
  async function confirmEmail(value) {
    const claim = await readToken(value, 'confirm');
    if (!claim) return { ok: false };
    const done = await ctx.store.transact((db) => {
      const g = growthOf(ctx, db), contact = (book(g), g.contacts[claim.id]), player = playerOf(g, claim.id, { create: false });
      if (!contact || contact.nonce !== claim.nonce || player?.consent?.age !== 'adult') return { ok: false };
      const first = !contact.confirmed;
      contact.confirmed = true; contact.confirmedAt ||= now(); player.consent.email = true;
      const welcome = first && !contact.welcomed;
      if (welcome) contact.welcomed = true; // claimed here, so the welcome is attempted once
      if (first) count(g, now(), 'email.confirmed');
      const session = ctx.core.sessionByPublicId?.(db, claim.id);
      return { ok: true, welcome, email: contact.email, nonce: contact.nonce, name: session?.name ?? 'Lagosian' };
    });
    if (done.ok && done.welcome) await deliverMail(claim.id, 'welcome', done.email, { ...welcomeMail({ name: done.name, contact: contactLine(), ...(await links(claim.id, done.nonce)) }), headers: listHeaders((await links(claim.id, done.nonce)).unsubscribeUrl) });
    return { ok: done.ok };
  }
  function dropContact(g, id, how) {
    book(g);
    if (!Object.hasOwn(g.contacts, id)) return false;
    delete g.contacts[id];
    const player = playerOf(g, id, { create: false });
    if (player?.consent) player.consent.email = false;
    count(g, now(), `email.${how}`);
    return true;
  }
  /** An unsubscribe link, or a mail program's one-click POST. No login: the signed token is the authority. */
  async function unsubscribe(value) {
    const claim = await readToken(value, 'unsub');
    if (!claim) return { ok: false };
    await ctx.store.transact((db) => { const g = growthOf(ctx, db); if (g.contacts?.[claim.id]?.nonce === claim.nonce) dropContact(g, claim.id, 'unsubscribed'); });
    return { ok: true }; // also when it was already gone: unsubscribing twice is still unsubscribed
  }

  // ---- push: subscribe, unsubscribe ---------------------------------------------------------------------
  function subscribe(g, session, body) {
    if (body.consent !== true) throw ctx.fail(400, 'consent_required');
    const sub = cleanSubscription(body.subscription);
    if (!sub) throw ctx.fail(400, 'invalid_subscription');
    const player = playerOf(g, session.publicId);
    book(g);
    if (!player?.consent) return no('age_required', 'Answer the age question first.');
    if (player.consent.age !== 'adult') return no('under_18', 'Notifications are only for players who are 18 or older. Everything inside the game still works.');
    const entry = (g.push[session.publicId] ||= { subs: [], sends: [], periods: {} });
    entry.subs = [...entry.subs.filter((item) => item.endpoint !== sub.endpoint), { ...sub, at: now() }].slice(-LIMITS.subs);
    if (!player.consent.push) count(g, now(), 'push.optin');
    player.consent.push = true;
    return { ok: true, code: 'subscribed' };
  }
  function unsubscribePush(g, id, endpoint) {
    book(g);
    const entry = g.push[id];
    if (entry) entry.subs = typeof endpoint === 'string' ? entry.subs.filter((sub) => sub.endpoint !== endpoint) : [];
    if (!entry?.subs.length) { if (entry) count(g, now(), 'push.optout'); delete g.push[id]; const player = playerOf(g, id, { create: false }); if (player?.consent) player.consent.push = false; }
    return { ok: true, code: 'unsubscribed' };
  }

  // ---- the schedule -----------------------------------------------------------------------------
  /** The stored life a message is about: the city played most recently. Read-only — nothing is settled. */
  function lifeOf(db, id) {
    const session = ctx.core.sessionByPublicId?.(db, id);
    if (!session || session.expiresAt <= now()) return null;
    const cities = ctx.cityIds.filter((cityId) => session.cities?.[cityId]?.state).sort((a, b) => (session.cities[b].updatedAt ?? 0) - (session.cities[a].updatedAt ?? 0));
    return cities.length ? { name: session.name, cityId: cities[0], state: session.cities[cities[0]].state } : null;
  }
  function digestFor(life) {
    const view = viewLife(life.state, { now: now(), cityId: life.cityId });
    return { view, digest: composeDigest({ name: life.name, city: CITY_NAMES[life.cityId] ?? life.cityId, missions: view.missions, events: upcomingEvents(now(), 2, life.cityId).slice(0, 3),
      lines: (life.state.social?.notices ?? []).slice(-6).map((notice) => ({ text: notice.text, at: notice.at, group: 'sim' })) }) };
  }
  let running = false, lastTick = 0, stopped = false, current = null;
  /**
   * Look at who is due a message and send it. Runs at most once a minute from the server's heartbeat
   * (and when the operator asks). Each due message is claimed in a saved transaction first.
   */
  function tick(options) { if (stopped) return Promise.resolve({ ran: false, reason: 'stopping' }); const run = runTick(options); current = run; ctx.waitUntil?.(run.catch(() => {})); run.then(() => {}, () => {}).then(() => { if (current === run) current = null; }); return run; }
  async function runTick({ force = false } = {}) {
    if (running || (!force && now() - lastTick < LIMITS.tickMs)) return { ran: false };
    running = true; lastTick = now();
    const jobs = [];
    try {
      if (inQuietHours(now())) return { ran: true, jobs: 0, reason: 'quiet_hours' };
      await ctx.store.transact((db) => {
        const g = growthOf(ctx, db), o = book(g), t = now(), week = lagosTime(t).week;
        const due = (id, entry, channel) => {
          const player = playerOf(g, id, { create: false });
          if (player?.consent?.age !== 'adult' || player.consent[channel] !== true) return null;
          const life = lifeOf(db, id);
          if (!life) return null;
          const stamps = life.state.missions?.stamps;
          const plan = planMessage({ now: t, seen: player.seen, sends: entry.sends, periods: entry.periods, playedThisWeek: stamps?.week === week && stamps.days > 0 });
          return plan.kind ? { plan, life } : null;
        };
        if (!o.off.email) for (const [id, contact] of Object.entries(g.contacts)) {
          if (jobs.length >= LIMITS.batch || sentToday(g, 'email') + jobs.filter((job) => job.channel === 'email').length >= cap('EMAIL_DAILY_CAP', LIMITS.emailPerDay)) break;
          if (!contact.confirmed) continue;
          const found = due(id, contact, 'email');
          if (!found) continue;
          contact.periods[found.plan.kind] = found.plan.period; // the claim
          jobs.push({ channel: 'email', kind: found.plan.kind, id, to: contact.email, nonce: contact.nonce, digest: digestFor(found.life).digest });
        }
        if (!o.off.push && !(o.pushPausedUntil > t)) for (const [id, entry] of Object.entries(g.push)) {
          if (jobs.length >= LIMITS.batch || sentToday(g, 'push') + jobs.filter((job) => job.channel === 'push').length >= cap('PUSH_DAILY_CAP', LIMITS.pushPerDay)) break;
          if (!entry.subs.length) continue;
          const found = due(id, entry, 'push');
          if (!found) continue;
          entry.periods[found.plan.kind] = found.plan.period;
          jobs.push({ channel: 'push', kind: found.plan.kind, id, subs: entry.subs.map((sub) => ({ ...sub })), digest: digestFor(found.life).digest });
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
    } catch (error) { ctx.core?.log?.(`Outreach tick failed: ${String(error?.message ?? error).split('\n')[0].slice(0, 200)}`); return { ran: true, jobs: jobs.length, failed: true }; }
    finally { running = false; }
  }
  ctx.on?.('heartbeat', () => { void tick(); });
  // The server is stopping: no new round starts, and a round that is sending is waited for, so what it sent is recorded
  // before the store closes (a claimed message is then never attempted again after a restart).
  ctx.closing?.push(async () => { stopped = true; await current?.catch(() => {}); });

  // ---- what each side may see ---------------------------------------------------------------------
  /** For the player's own Stay in touch screen. */
  function mine(g, id) {
    book(g);
    const contact = g.contacts[id], entry = g.push[id];
    return { channel: channelUrl(ctx.env('WHATSAPP_CHANNEL_URL')),
      email: contact ? { address: maskEmail(contact.email), confirmed: contact.confirmed, preview: contact.preview ? { kind: contact.preview.kind, subject: contact.preview.subject, text: contact.preview.text } : null } : null,
      push: { devices: entry?.subs.length ?? 0 }, live: { email: emailReady() } };
  }
  /** For the operator: totals, switches, the last lines of the log and the last dry-run previews. No address, no endpoint, no player id. */
  function operatorView(g) {
    const o = book(g), contacts = Object.values(g.contacts), config = mailConfig(ctx);
    const recent = (channel) => o.log.filter((line) => line.channel === channel);
    return {
      email: { provider: 'zeptomail', configured: config.configured, origin: Boolean(origin()), live: emailReady() && !o.off.email, off: o.off.email === true, from: config.configured ? config.from : null,
        confirmed: contacts.filter((contact) => contact.confirmed).length, awaitingConfirmation: contacts.filter((contact) => !contact.confirmed).length,
        sentToday: sentToday(g, 'email'), dailyCap: cap('EMAIL_DAILY_CAP', LIMITS.emailPerDay), lastError: recent('email').filter((line) => line.state === 'failed').at(-1) ?? null },
      push: { off: o.off.push === true, subscribers: Object.keys(g.push).length, devices: Object.values(g.push).reduce((sum, entry) => sum + entry.subs.length, 0), sentToday: sentToday(g, 'push'),
        dailyCap: cap('PUSH_DAILY_CAP', LIMITS.pushPerDay), pausedUntil: o.pushPausedUntil > now() ? o.pushPausedUntil : null, lastError: recent('push').filter((line) => line.state === 'failed').at(-1) ?? null },
      whatsapp: { channel: channelUrl(ctx.env('WHATSAPP_CHANNEL_URL')) || null },
      rules: OUTREACH, quietNow: inQuietHours(now()), log: o.log.slice(-100).reverse(), previews: o.previews.slice().reverse(),
    };
  }
  function setSwitch(g, channel, off) {
    if (!['email', 'push'].includes(channel) || typeof off !== 'boolean') throw ctx.fail(400, 'invalid_switch');
    book(g).off[channel] = off;
    note(g, channel, 'switch', off ? 'off' : 'on');
    return { ok: true, channel, off };
  }

  const service = { requestEmail, confirmEmail, unsubscribe, dropContact, subscribe, unsubscribePush, tick, mine, operatorView, setSwitch, publicKey: async () => (await vapidKeys(ctx)).publicKey };
  services.set(ctx, service);
  return service;
}
