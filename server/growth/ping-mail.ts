/**
 * OWNER: growth
 * A PING, OUTSIDE THE GAME: the e-mail and the notification a friend's ping may cause (docs/COMEBACK-MAIL.md, "Ping").
 * The ping itself — who may ping whom, where they are, the join — is server/social/ping.ts; this file only answers
 * "does anything leave the server for it?" and sends it. The rules are pure (src/game/ping.ts pingMailDecision) and the
 * words are ./email/ping.ts.
 *
 * STORED (additive)  growth.comeback[to].pings  [{ at, from }]   ping mails sent to this player, a week of them at most.
 *                    Counted apart from `sent` (the automatic mails): see the doc for why.
 *
 * EXACTLY ONCE. claim() runs INSIDE the transaction that records the ping: it decides, and writes the mail into the
 * recipient's ledger there. send() runs after that transaction is saved and after the pinger has been answered. A crash
 * or a provider failure in between can only lose the mail, never send it twice; and nothing about it reaches the pinger.
 *
 * NOTHING WITHOUT CONSENT. Only a recipient comeback mail may write to (./recipient.ts: a confirmed address or an
 * account's verified one, never a minor), with "E-mail me about my character" and the Friends switch on and no pause.
 * A notification goes only to a browser its owner subscribed (./outreach.ts). The operator's switches and the daily
 * totals (EMAIL_DAILY_CAP, PUSH_DAILY_CAP) apply as to every other message.
 */
import { PING, nightAt, pingMailDecision, pingMailNoted } from '../../src/game/ping.ts';
import { pingMail } from './email/ping.ts';
import { growthOf } from './data.ts';
import type { comebackService } from './comeback.ts';
import type { MailMessage } from './email/zeptomail.ts';
import type { Db, GrowthCollection, RouteContext } from '../types.ts';

const DAY = 86400000;
interface PushSub { endpoint: string; p256dh: string; auth: string; at: number }
/** What this file takes from the sender in ./outreach.ts. */
export interface PingMailing {
  contactLine(): string
  origin(): string
  cap(name: string, fallback: number): number
  sentToday(g: GrowthCollection, channel: 'email' | 'push'): number
  token(purpose: string, id: string, nonce: string, expires: number): Promise<string>
  deliverMail(id: string, kind: string, to: string, message: Omit<MailMessage, 'to'>): Promise<{ ok: boolean; off?: true; dryRun?: true }>
  deliverPush(id: string, kind: string, subs: PushSub[], payload: unknown): Promise<unknown>
  /** The browsers this player subscribed, or none (no consent, a minor, switched off by the operator, paused by the push service). */
  pushSubs(g: GrowthCollection, id: string): PushSub[]
}
/** One ping, as the social side hands it over. `link` is the join link as a path (`/j/<token>`). */
export interface PingOut { from: string; fromName: string; to: string; place: string; link: string; /** The recipient is connected, or was a moment ago. */ online: boolean }
export interface PingJob {
  mail?: { id: string; email: string; nonce: string; source: 'contact' | 'account'; fromName: string; place: string; link: string }
  push?: { id: string; subs: PushSub[]; fromName: string; place: string; link: string }
}

export function pingMailService(ctx: RouteContext, mailing: PingMailing, comeback: ReturnType<typeof comebackService>) {
  const now = (): number => ctx.now();

  /** Decide what leaves the server for this ping and claim it. Call INSIDE the ping's transaction. null: nothing does. */
  function claim(db: Db, g: GrowthCollection, out: PingOut): PingJob | null {
    const t = now(), job: PingJob = {};
    const record = comeback.recordFor(g, out.to), recipient = record ? comeback.recipientOf(db, g, out.to) : null;
    if (record && recipient && recipient.welcome !== 'pending' && g.outreach?.off?.email !== true) {
      const why = pingMailDecision({ now: t, from: out.from, prefs: { on: record.on || record.legacy, pausedUntil: record.pausedUntil, friends: record.types.friends }, online: out.online, ledger: record.pings ?? [], lastActive: comeback.lastActiveOf(db, g, out.to) });
      if (why === 'send' && mailing.sentToday(g, 'email') < mailing.cap('EMAIL_DAILY_CAP', 500)) {
        record.pings = pingMailNoted(record.pings ?? [], out.from, t);
        comeback.bump(g, 'ping', 'queued');
        job.mail = { id: out.to, email: recipient.email, nonce: recipient.nonce, source: recipient.source, fromName: out.fromName, place: out.place, link: out.link };
      } else if (why !== 'off' && why !== 'online') comeback.bump(g, 'ping', 'suppressed');
    }
    // A notification: only to a player who is not in the game, never at night, a bounded number a day.
    if (!out.online && !nightAt(t)) {
      const subs = mailing.pushSubs(g, out.to);
      if (subs.length && mailing.sentToday(g, 'push') < mailing.cap('PUSH_DAILY_CAP', 5000) && ctx.allow(`ping:push:${out.to}`, PING.pushPerDay, DAY)) job.push = { id: out.to, subs: subs.map((sub) => ({ ...sub })), fromName: out.fromName, place: out.place, link: out.link };
    }
    return job.mail || job.push ? job : null;
  }

  /** Send what claim() claimed. Call after the transaction is saved; never throws. */
  async function send(job: PingJob): Promise<void> {
    try {
      if (job.push) await mailing.deliverPush(job.push.id, 'ping', job.push.subs, { title: `${job.push.fromName} is waiting for you in Allworld`, body: `${job.push.fromName} is ${job.push.place}. Tap to join them.`, url: job.push.link, tag: 'ping' });
    } catch { /* a push that could not be sent is not retried: the ping is still in the game */ }
    const mail = job.mail;
    if (!mail) return;
    try {
      const origin = mailing.origin(), expires = now() + 400 * DAY;
      const [all, stop] = await Promise.all([mailing.token('unsub', mail.id, mail.nonce, expires), mailing.token('unsub-ping', mail.id, mail.nonce, expires)]);
      const unsubscribeUrl = `${origin}/e/unsub?t=${all}`, stopUrl = `${origin}/e/unsub?t=${stop}`;
      const message = pingMail({ from: mail.fromName, place: mail.place, joinUrl: `${origin}${mail.link}`, links: { origin, stopUrl, unsubscribeUrl }, contact: mailing.contactLine(), source: mail.source });
      const result = await mailing.deliverMail(mail.id, 'comeback-ping', mail.email, { ...message, headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
      await ctx.store.transact((db) => { comeback.bump(growthOf(ctx, db), 'ping', result.off ? 'suppressed' : result.ok ? 'sent' : 'failed'); }, { durable: false });
    } catch (error) {
      ctx.core?.log?.(`A ping mail was not sent: ${String((error as { code?: unknown } | null)?.code ?? 'error').slice(0, 40)}`);
    }
  }

  return { claim, send };
}
