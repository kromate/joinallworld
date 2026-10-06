/**
 * OWNER: growth (used by server/admin/announce.ts)
 * AN ANNOUNCEMENT, OUTSIDE THE GAME: the e-mail and the notification an admin may choose to send with an announcement. It reuses
 * the machinery of every other message: the operator's switches, the daily totals (EMAIL_DAILY_CAP, PUSH_DAILY_CAP), quiet hours, the
 * dry-run when no mail provider is configured (nothing leaves the server; the preview is kept), the signed unsubscribe link, and the
 * player's own choices.
 *
 * WHO. E-mail: a player with "E-mail me about my character" on, not paused, with the Events switch on (announcements answer to
 * Events), a confirmed address or an account's verified one, not under 18. Push: a browser the player subscribed, adult, push consent on.
 * The audience (everyone, one city, online now) narrows that list; it never widens it.
 *
 * HOW. audience() lists who would get it, with no side effect: the admin sees the count before anything is sent. A send is made in
 * batches of BATCH by the heartbeat: each batch is CLAIMED (the cursor moves, in a saved transaction) before it is sent, so a
 * crash can lose a batch but never send one twice. The cursor, the counts and the state live in the announcement's own record.
 */
import { inQuietHours } from '../../src/game/outreach.ts';
import { characterCity } from '../character.ts';
import { build, esc } from './email/templates.ts';
import { growthOf } from './data.ts';
import type { comebackService } from './comeback.ts';
import type { PingMailing } from './ping-mail.ts';
import type { Db, GrowthCollection, RouteContext } from '../types.ts';

export const BATCH = 25;
export interface MailAudience { city?: string | null; onlineOnly?: boolean }
interface AnnounceContent { id: string; title: string; body: string }
interface Target { id: string; email?: { to: string; nonce: string }; push?: { subs: { endpoint: string; p256dh: string; auth: string; at: number }[] } }

export function announceMailService(ctx: RouteContext, mailing: PingMailing, comeback: ReturnType<typeof comebackService>) {
  const now = (): number => ctx.now();
  function keep(db: Db, id: string, filter: MailAudience): boolean {
    if (filter.onlineOnly && !ctx.online(id)) return false;
    if (filter.city) { const session = ctx.core.sessionByPublicId?.(db, id); if (!session || characterCity(session) !== filter.city) return false; }
    return true;
  }
  /** Who would get it, sorted by id. Reads only. */
  function audience(db: Db, g: GrowthCollection, filter: MailAudience): { email: Target[]; push: Target[] } {
    const t = now(), email: Target[] = [], push: Target[] = [];
    if (g.outreach?.off?.email !== true) for (const id of Object.keys(g.comeback ?? {}).sort()) {
      const record = comeback.recordFor(g, id), recipient = record ? comeback.recipientOf(db, g, id) : null;
      if (!record || !recipient || recipient.welcome === 'pending' || !(record.on || record.legacy) || record.pausedUntil > t || record.types.events !== true) continue;
      if (keep(db, id, filter)) email.push({ id, email: { to: recipient.email, nonce: recipient.nonce } });
    }
    for (const id of Object.keys(g.push ?? {}).sort()) {
      const subs = mailing.pushSubs(g, id);
      if (subs.length && keep(db, id, filter)) push.push({ id, push: { subs } });
    }
    return { email, push };
  }

  /** Claim the next batch of one channel. Inside a transaction. Returns the targets to send to and whether the channel is finished. */
  function claim(db: Db, filter: MailAudience, channel: 'email' | 'push', after: string, room: number): { batch: Target[]; done: boolean; waiting: boolean } {
    const g = growthOf(ctx, db);
    if (inQuietHours(now())) return { batch: [], done: false, waiting: true };
    const list = audience(db, g, filter)[channel].filter((target) => target.id > after);
    const cap = channel === 'email' ? mailing.cap('EMAIL_DAILY_CAP', 500) : mailing.cap('PUSH_DAILY_CAP', 5000);
    const left = Math.max(0, cap - mailing.sentToday(g, channel));
    if (!left && list.length) return { batch: [], done: false, waiting: true };
    const batch = list.slice(0, Math.min(BATCH, left, room));
    return { batch, done: batch.length === list.length, waiting: false };
  }

  async function send(channel: 'email' | 'push', batch: Target[], content: AnnounceContent): Promise<{ sent: number; failed: number }> {
    let sent = 0, failed = 0;
    for (const target of batch) {
      try {
        if (channel === 'push' && target.push) {
          await mailing.deliverPush(target.id, 'announce', target.push.subs, { title: content.title, body: content.body.slice(0, 120), url: '/', tag: 'announce' });
          sent += 1;
        } else if (target.email) {
          const origin = mailing.origin(), unsub = await mailing.token('unsub', target.id, target.email.nonce, now() + 400 * 86400000), unsubscribeUrl = `${origin}/e/unsub?t=${unsub}`;
          const contact = mailing.contactLine();
          const why = 'You get this because you asked for Allworld e-mails in the game (Events).';
          const mail = build(content.title, { heading: content.title, intro: content.body, button: { label: 'Open Allworld', url: origin || '/' },
            foot: `${esc(why)} <a href="${esc(unsubscribeUrl)}" style="color:#5b6472">Unsubscribe with one tap</a>.${contact ? `<br>${esc(contact)}` : ''}`, footText: `${why}\nUnsubscribe with one tap: ${unsubscribeUrl}${contact ? `\n${contact}` : ''}` });
          const result = await mailing.deliverMail(target.id, 'announce', target.email.to, { ...mail, headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
          if (result.ok) sent += 1; else failed += 1;
        }
      } catch { failed += 1; }
    }
    return { sent, failed };
  }
  return { audience, claim, send };
}
