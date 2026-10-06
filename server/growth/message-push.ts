/**
 * OWNER: growth
 * A MESSAGE, ON THE PHONE: the web push a new direct message, a mention, a reply, a gift or (if asked for) a group message may
 * cause. Messages between players are expected, so they have caps of their own and do not use up the day's push total
 * (PUSH_DAILY_CAP) that marketing-style notifications share. Reactions never notify the phone; neither does a message that is
 * being read.
 *
 * HOW IT IS DECIDED. server/social/service.ts raises 'chat-notice' for each message that reaches a player. Nothing is sent at once:
 * after UNSEEN_MS the stored conversation is read, and the push goes only if the message is STILL unread. A player who has the
 * conversation open reads it on the spot (the page marks it read, on every device: social-read), so an active chat never buzzes
 * the phone; the service worker also stays silent while a visible window of the game is open (public/sw.js).
 *
 * WHO IS NOTIFIED OF WHAT
 *   direct message, gift, reply, mention   the recipient, unless paused, or muted-group-with-mentions-off
 *   group message that is none of those    only a player who chose "all group messages", never in a group they muted, and not in
 *                                          the quiet hours of the device (22:00–07:00 by the clock the browser reported, when it did)
 *   never                                  a blocked or muted sender, a sender the recipient cannot be reached by, a conversation read meanwhile
 * COURTESY. At most one push per recipient per conversation each PER_CONV_MS (the ones in between are folded into one that follows
 * the window, with the count), at most PER_DAY a day per recipient, one notification per conversation on the phone (the tag) that
 * updates in place. The words: the sender (or the group) as the title, the first 80 characters as the body — or "New message from
 * Joy" for a player who switched the text off. A picture is never sent in a notification, only the word "Picture".
 *
 * STORED (additive): social.players[id].notify { hide?, all?, until?, quietDm?, noQuiet? }; growth.push[id].subs[].tz (the device's
 * offset from UTC in minutes, from the browser). A push writes nothing unless the push service says the subscription is gone.
 */
import { clip } from '../social/clip.ts';
import { friendsIn } from '../social/founder.ts';
import { growthOf } from './data.ts';
import type { PushResult } from './webpush.ts';
import type { Db, GrowthCollection, RouteContext, SocialCollection } from '../types.ts';

export const MESSAGE_PUSH = Object.freeze({ unseenMs: 5000, perConvMs: 20000, perDay: 150, textChars: 80, quietFrom: 22, quietTo: 7, ttl: 3600 });
export interface Sub { endpoint: string; p256dh: string; auth: string; at: number; tz?: number }
export interface ChatNotice { to: string; from: string | null; conv: string; seq: number; kind: 'message' | 'group' | 'mention' | 'reply' | 'gift' }
export interface ChatPushPayload { title: string; body: string; url: string; tag: string; kind: 'chat'; conv: string; count: number; badge: number }
export interface ChatPushJob { id: string; subs: Sub[]; payload: ChatPushPayload }
export interface MessageMailing {
  /** The browsers this player subscribed and allowed, or none. */
  pushSubs(g: GrowthCollection, id: string): Sub[]
  /** Send one payload to those browsers; a subscription the push service has dropped is forgotten. */
  deliver(id: string, subs: Sub[], payload: ChatPushPayload | { title: string; body: string; url: string; tag: string; kind: 'test' }, topic: string): Promise<PushResult[]>
}

/** Is this local hour of the device inside the quiet hours? */
export const quietHour = (hour: number): boolean => hour >= MESSAGE_PUSH.quietFrom || hour < MESSAGE_PUSH.quietTo;
/** The hour on a device whose clock is `tz` minutes from UTC, at server time `at`. */
export const hourOn = (at: number, tz: number): number => Math.floor((((at + tz * 60000) % 86400000) + 86400000) % 86400000 / 3600000);
/** A short tag for a conversation: one notification on the phone per conversation. */
export function tagOf(conv: string): string {
  let hash = 5381;
  for (let i = 0; i < conv.length; i += 1) hash = ((hash * 33) ^ conv.charCodeAt(i)) >>> 0;
  return `c${hash.toString(36)}`;
}

/** A setting in whole milliseconds, or the default (CHAT_PUSH_UNSEEN_MS and CHAT_PUSH_WINDOW_MS exist so a test and an operator can change the two waits). */
const setting = (ctx: RouteContext, name: string): string => (typeof ctx.env === 'function' ? ctx.env(name) : '');
const wait = (ctx: RouteContext, name: string, fallback: number): number => { const value = Number(setting(ctx, name)); return setting(ctx, name) !== '' && Number.isFinite(value) && value >= 0 ? Math.min(value, 600000) : fallback; };

/** A timer that does not keep a Node process alive (on the Worker the handle is a number and there is nothing to do). */
function later(run: () => void, ms: number): void { const handle: unknown = setTimeout(run, ms); if (typeof handle === 'object' && handle !== null && 'unref' in handle && typeof handle.unref === 'function') handle.unref(); }

export function messagePushService(ctx: RouteContext, mailing: MessageMailing) {
  const now = (): number => ctx.now();
  const unseenMs = (): number => wait(ctx, 'CHAT_PUSH_UNSEEN_MS', MESSAGE_PUSH.unseenMs), windowMs = (): number => wait(ctx, 'CHAT_PUSH_WINDOW_MS', MESSAGE_PUSH.perConvMs);
  /** conversation+player → the newest notice that arrived while its window was closed (one follow-up per window). */
  const waiting = new Map<string, ChatNotice>();

  /** Decide, from the stored state, what to send for this notice. null: nothing. Reads only. */
  function decide(db: Db, n: ChatNotice): ChatPushJob | null {
    const s: SocialCollection | undefined = db.social;
    const me = s?.players[n.to], conv = s?.convs[n.conv], entry = me?.convs[n.conv];
    if (!s || !me || !conv || !entry || !conv.members.includes(n.to) || conv.kind === 'house') return null;
    const line = conv.messages.find((item) => item.seq === n.seq);
    if (!line || entry.read >= n.seq) return null;
    if (n.from && (me.blocked[n.from] || s.players[n.from]?.blocked[n.to] || ctx.checks?.muted?.(n.from))) return null;
    const prefs = me.notify ?? {};
    if ((prefs.until ?? 0) > now()) return null;
    const muted = entry.mute === true;
    if (n.kind === 'group' && (muted || !prefs.all)) return null;
    if ((n.kind === 'mention' || n.kind === 'reply') && muted && me.mentions === 'off') return null;
    // A mention reaches the phone only where it reached Updates (the service decides who a mention reaches).
    if (n.kind === 'mention' && !me.updates.some((update) => update.kind === 'mention' && update.data?.conv === n.conv && update.data.from === n.from && !update.read)) return null;
    if (n.kind === 'message' && conv.kind === 'dm' && n.from && !friendsIn(s.players, n.to, n.from) && !conv.messages.some((item) => item.from === n.to)) return null;
    const g = growthOf(ctx, db), t = now();
    const all = mailing.pushSubs(g, n.to);
    // Quiet hours are the device's own: a group message is held back at night, a direct one only if the player asked.
    const subs = all.filter((sub) => {
      if (sub.tz === undefined) return true;
      const quiet = quietHour(hourOn(t, sub.tz));
      return !quiet || n.kind === 'mention' || n.kind === 'reply' || n.kind === 'gift' || (n.kind === 'message' ? prefs.quietDm !== true : prefs.noQuiet === true);
    });
    if (!subs.length) return null;
    const sender = n.from ? s.players[n.from]?.name ?? 'Someone' : 'Allworld';
    const where = conv.kind === 'group' ? conv.name ?? 'a group' : sender;
    const unseen = conv.messages.filter((item) => item.seq > entry.read && item.from && item.from !== n.to && !item.sys && !(s.players[n.to]?.blocked[item.from!])).length;
    const picture = line.img && !line.img.gone ? 'Picture' : '';
    const said = line.gift ? `sent you ₦${Math.round(line.gift.n).toLocaleString('en-NG')}` : clip(line.auto ? '' : line.body, MESSAGE_PUSH.textChars) || picture;
    const body = prefs.hide === true ? (conv.kind === 'group' ? `New message in ${where}` : `New message from ${sender}`)
      : line.gift ? `${sender} ${said}` : conv.kind === 'group' ? `${sender}: ${said}` : said;
    const badge = Object.entries(me.convs).reduce((sum, [key, kept]) => sum + (kept.mute ? 0 : (s.convs[key]?.messages.filter((item) => item.seq > kept.read && item.from && item.from !== n.to && !item.sys).length ?? 0)), 0);
    return { id: n.to, subs: subs.map((sub) => ({ ...sub })), payload: { title: where, body: unseen > 1 ? `${unseen} new messages · ${body}`.slice(0, 160) : body, url: `/?chat=${encodeURIComponent(n.conv)}`, tag: tagOf(n.conv), kind: 'chat', conv: n.conv, count: unseen, badge } };
  }

  async function run(n: ChatNotice, followUp = false): Promise<void> {
    const key = `${n.to}|${n.conv}`;
    const job = await ctx.store.read((db) => decide(db, n));
    if (!job) return;
    // One push per conversation per window; a message that arrives inside it is folded into one that follows the window.
    if (!ctx.allow(`msgpush:${key}`, 1, windowMs())) {
      // The follow-up is made once: if the window is somehow still closed it is dropped, never retried without end.
      if (followUp) return;
      if (!waiting.has(key)) {
        const wait = (ctx.retryIn?.(`msgpush:${key}`) ?? windowMs()) + 50;
        ctx.waitUntil?.(new Promise<void>((done) => { later(() => { const latest = waiting.get(key); waiting.delete(key); void (latest ? run(latest, true) : Promise.resolve()).finally(done); }, wait); }));
      }
      waiting.set(key, n);
      return;
    }
    if (!ctx.allow(`msgpush-day:${n.to}`, MESSAGE_PUSH.perDay, 86400000)) return;
    await mailing.deliver(job.id, job.subs, job.payload, job.payload.tag);
  }

  // The listener is on unless an operator sets CHAT_PUSH=off.
  if (setting(ctx, 'CHAT_PUSH') !== 'off') ctx.on?.('chat-notice', (notice) => {
    const work = new Promise<void>((done) => {
      later(() => { run(notice).catch((error) => ctx.core?.log?.(`A message notification failed: ${String((error as { code?: unknown } | null)?.code ?? 'error').slice(0, 40)}`)).finally(done); }, unseenMs());
    });
    ctx.waitUntil?.(work);
  });
  return { decide, run };
}
