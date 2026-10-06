/**
 * OWNER: admin
 * ANNOUNCEMENTS: a short message from the people who run the game, to everyone, to one city, or to whoever is online now.
 *
 * STORED ONCE (collection adminAnnounce, the last ANNOUNCE_KEEP): title (up to TITLE_MAX characters), text (up to BODY_MAX), an
 * optional button that opens one in-game panel from a FIXED list (map, missions, business, invite; never an address), the audience,
 * when it goes out, when it stops being shown, and its reach. Nothing is written per player.
 *
 * DELIVERY
 *   in the game   a socket frame `announce` (src/types/announce.ts) to every open socket the moment it goes out, and to every socket
 *                 that opens while it is running (ws/admin.ts). The page keeps what it has SEEN in that browser only, shows a banner
 *                 and adds an entry to Messages → Updates. An audience of "online now" is sent to the sockets open at that moment and
 *                 never again. A page for another city ignores a city announcement.
 *   push, e-mail  optional; under the same rules as every other message (server/growth/announce-mail.ts). The recipient count is
 *                 shown first; above ADMIN_MAIL_CONFIRM_ABOVE recipients the admin must type the confirmation.
 * SCHEDULING   `at` in the future: it goes out on the first heartbeat after that time. Cancelling ends it (and stops any mail not yet sent).
 * REACH        `reach.sockets`: distinct players with a connection when it went out (for a city: those in that city's rooms, or not yet in one).
 *
 * WORKER COST: creating or cancelling one announcement writes the adminAnnounce collection (1 row); going out writes it once more.
 * A socket that opens reads nothing from storage: the running announcements are held in memory (loaded at start-up).
 */
import { screenText } from '../moderation/text.ts';
import { outreachService } from '../growth/outreach.ts';
import { ANNOUNCE_ACTIONS } from '../../src/types/announce.ts';
import type { AnnounceFrame, AnnounceItem } from '../../src/types/announce.ts';
import { ANNOUNCE_KEEP, collectionOf, peek } from './store.ts';
import type { AnnounceAudience, AnnounceAction, AnnouncementRecord } from './store.ts';
import { limitsOf } from './config.ts';
import type { Admin } from './gate.ts';
import type { Db, RouteContext, WsConnection } from '../types.ts';

export const TITLE_MAX = 60, BODY_MAX = 240, LONGEST_MS = 30 * 86400000, DEFAULT_SHOWN_MS = 7 * 86400000, SOON_MS = 60000;
const services = new WeakMap<RouteContext, ReturnType<typeof build>>();
export function announceOf(ctx: RouteContext) {
  let found = services.get(ctx);
  if (!found) services.set(ctx, found = build(ctx));
  return found;
}
const itemOf = (record: AnnouncementRecord): AnnounceItem => ({ id: record.id, title: record.title, body: record.body, action: record.action, city: record.city, at: record.sentAt || record.at, expiresAt: record.expiresAt });

function build(ctx: RouteContext) {
  const outreach = outreachService(ctx);
  let items: AnnouncementRecord[] = [];
  let ticking = false;
  const running = (record: AnnouncementRecord, t = ctx.now()): boolean => record.cancelledAt === 0 && record.at <= t && t < record.expiresAt;
  const roomCity = (ws: WsConnection): string | null => (typeof ws.room === 'string' ? ws.room.split(':')[0] ?? null : null);
  const refuse = (code: string, reason: string) => Object.assign(ctx.fail(400, code), { reason });

  /** Send one announcement to the sockets that are open now. Returns its reach. */
  function broadcast(record: AnnouncementRecord): number {
    const frame: AnnounceFrame = { type: 'announce', items: [itemOf(record)], live: true };
    const sockets = ctx.core.sockets().filter((ws) => ws.readyState === 1 && (record.city === null || roomCity(ws) === null || roomCity(ws) === record.city));
    ctx.broadcast?.(sockets, frame);
    return new Set(sockets.map((ws) => ws.session.id)).size;
  }
  const service = {
    sync(list: AnnouncementRecord[]): void { items = list.map((record) => ({ ...record })); },
    load: (): Promise<void> => ctx.store.read((db) => peek(db, 'adminAnnounce').items.filter((record) => record.cancelledAt === 0 && record.expiresAt > ctx.now()).map((record) => ({ ...record }))).then((list) => service.sync(list)),
    /** What a socket that has just opened is told: the running announcements that are not for "online now" only. */
    forSocket(): AnnounceFrame | null {
      const list = items.filter((record) => record.audience !== 'online' && running(record)).map(itemOf);
      return list.length ? { type: 'announce', items: list, live: false } : null;
    },
    broadcast,
    /** The next announcements to go out: due, not yet sent. */
    due: (): AnnouncementRecord[] => items.filter((record) => record.sentAt === 0 && record.cancelledAt === 0 && record.at <= ctx.now() && ctx.now() < record.expiresAt),
    mailPending: (): AnnouncementRecord[] => items.filter((record) => record.cancelledAt === 0 && (record.mail.state === 'queued' || record.mail.state === 'sending')),

    list(db: Db) {
      return peek(db, 'adminAnnounce').items.slice().reverse().map((record) => ({ ...record, by: undefined, status: record.cancelledAt ? 'cancelled' : record.sentAt === 0 ? (record.at > ctx.now() ? 'scheduled' : 'due') : record.expiresAt <= ctx.now() ? 'ended' : 'running' }));
    },
    /** The count the admin sees before anything is sent. Reads only. */
    preview(db: Db, input: { audience: AnnounceAudience; city: string | null }) {
      const g = db.growth;
      const online = input.audience === 'online';
      const base = { city: input.audience === 'city' ? input.city : null, onlineOnly: online };
      const mail = g ? outreach.announcements.audience(db, g, base) : { email: [], push: [] };
      return { email: mail.email.length, push: mail.push.length, confirmAbove: limitsOf(ctx).mailConfirmAbove };
    },

    /** Inside a transaction. Validates and stores one announcement. `send`: it is due now (the caller broadcasts after the commit). */
    create(db: Db, admin: Admin, body: Record<string, unknown>) {
      const t = ctx.now();
      const clip = (value: unknown, max: number, code: string): string => { const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''; if (!text || text.length > max) throw refuse(code, `Use 1 to ${max} characters.`); return text; };
      const title = clip(body.title, TITLE_MAX, 'invalid_title'), text = clip(body.body, BODY_MAX, 'invalid_text');
      for (const [what, value] of [['The title', title], ['The text', text]] as const) { const verdict = screenText(value, { contact: true, what }); if (verdict) throw refuse(verdict.code, verdict.reason); }
      const audience: AnnounceAudience = body.audience === 'city' || body.audience === 'online' ? body.audience : 'everyone';
      const city = audience === 'city' ? ctx.cityIds.find((id) => id === body.city) ?? null : null;
      if (audience === 'city' && !city) throw refuse('invalid_city', 'Choose a city.');
      const action: AnnounceAction | null = body.action === undefined || body.action === null || body.action === '' ? null : ANNOUNCE_ACTIONS.find((item) => item === body.action) ?? null;
      if (body.action !== undefined && body.action !== null && body.action !== '' && !action) throw refuse('invalid_action', 'The button can only open Map, Missions, Business or Invite.');
      const at = body.at === undefined || body.at === null ? t : body.at;
      if (typeof at !== 'number' || !Number.isSafeInteger(at) || at > t + LONGEST_MS) throw refuse('invalid_time', 'Schedule it within the next 30 days.');
      const start = at <= t + SOON_MS ? t : at;
      const expiresAt = body.expiresAt === undefined || body.expiresAt === null ? start + (audience === 'online' ? 3600000 : DEFAULT_SHOWN_MS) : body.expiresAt;
      if (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= start + 60000 || expiresAt > start + LONGEST_MS) throw refuse('invalid_expiry', 'It must stay up for at least a minute and at most 30 days.');
      const wantsPush = body.push === true, wantsEmail = body.email === true;
      const col = collectionOf(ctx, db, 'adminAnnounce');
      const send = start <= t;
      const record: AnnouncementRecord = { id: `a${++col.seq}`, title, body: text, action, audience, city, at: start, sentAt: send ? t : 0, expiresAt, by: admin.accountId, createdAt: t, cancelledAt: 0, reach: { sockets: 0 },
        mail: { wanted: wantsPush || wantsEmail, push: wantsPush, email: wantsEmail, state: wantsPush || wantsEmail ? 'queued' : 'none', total: 0, sent: 0, failed: 0, cursor: '' } };
      if (record.mail.wanted) {
        const counted = service.preview(db, { audience, city });
        record.mail.total = (wantsEmail ? counted.email : 0) + (wantsPush ? counted.push : 0);
        if (record.mail.total > counted.confirmAbove && body.confirmCount !== record.mail.total) throw Object.assign(refuse('confirm_recipients', `This would reach ${record.mail.total} people by e-mail or push. Type the number to confirm.`), { recipients: record.mail.total });
        if (!record.mail.total) record.mail.state = 'none';
      }
      col.items.push(record);
      if (col.items.length > ANNOUNCE_KEEP) col.items.splice(0, col.items.length - ANNOUNCE_KEEP);
      return { record, send, items: col.items.filter((item) => item.cancelledAt === 0 && item.expiresAt > t) };
    },
    cancel(db: Db, id: string) {
      const col = collectionOf(ctx, db, 'adminAnnounce'), record = col.items.find((item) => item.id === id);
      if (!record) throw ctx.fail(404, 'unknown_announcement');
      if (record.cancelledAt) return { record, items: col.items.filter((item) => item.cancelledAt === 0 && item.expiresAt > ctx.now()), changed: false };
      record.cancelledAt = ctx.now();
      if (record.mail.state === 'queued' || record.mail.state === 'sending') record.mail.state = 'done';
      return { record, items: col.items.filter((item) => item.cancelledAt === 0 && item.expiresAt > ctx.now()), changed: true };
    },

    /** After a commit: send it to the open sockets and note its reach. */
    async went(record: AnnouncementRecord): Promise<void> {
      const reach = broadcast(record);
      await ctx.store.transact((db) => { const stored = collectionOf(ctx, db, 'adminAnnounce').items.find((item) => item.id === record.id); if (stored) stored.reach.sockets = reach; }, { durable: false });
    },

    /** The heartbeat: send what is due, and a batch of mail for what is sending. One at a time. */
    async tick(): Promise<void> {
      if (ticking) return;
      const due = service.due(), mail = service.mailPending();
      if (!due.length && !mail.length) return;
      ticking = true;
      try {
        for (const record of due) {
          const claimed = await ctx.store.transact((db) => {
            const stored = collectionOf(ctx, db, 'adminAnnounce').items.find((item) => item.id === record.id);
            if (!stored || stored.sentAt !== 0 || stored.cancelledAt !== 0) return null;
            stored.sentAt = ctx.now();
            return { ...stored, items: collectionOf(ctx, db, 'adminAnnounce').items.filter((item) => item.cancelledAt === 0 && item.expiresAt > ctx.now()) };
          });
          if (!claimed) continue;
          const { items: list, ...sent } = claimed;
          service.sync(list);
          await service.went(sent);
        }
        for (const record of service.mailPending()) await service.mailBatch(record.id);
      } catch (error) { ctx.core?.log?.(`Announcement round failed: ${String((error as { message?: unknown } | null)?.message ?? error).split('\n')[0]?.slice(0, 200)}`); }
      finally { ticking = false; }
    },
    /** One batch of this announcement's mail: claimed in a saved transaction, then sent. */
    async mailBatch(id: string): Promise<void> {
      const claim = await ctx.store.transact((db) => {
        const col = collectionOf(ctx, db, 'adminAnnounce'), record = col.items.find((item) => item.id === id);
        if (!record || record.cancelledAt !== 0 || record.sentAt === 0 || record.expiresAt <= ctx.now() || (record.mail.state !== 'queued' && record.mail.state !== 'sending')) return null;
        const [phase, after = ''] = record.mail.cursor ? record.mail.cursor.split(':') : [record.mail.email ? 'email' : 'push', ''];
        const channel = phase === 'push' ? 'push' : 'email';
        const filter = { city: record.audience === 'city' ? record.city : null, onlineOnly: record.audience === 'online' };
        const picked = outreach.announcements.claim(db, filter, channel, after, 1000);
        if (picked.waiting) return null;
        record.mail.state = 'sending';
        const last = picked.batch.at(-1)?.id;
        if (!picked.done && last) record.mail.cursor = `${channel}:${last}`;
        else if (channel === 'email' && record.mail.push) record.mail.cursor = 'push:';
        else record.mail.state = 'done';
        return { channel: channel as 'email' | 'push', batch: picked.batch, content: { id, title: record.title, body: record.body } };
      });
      if (!claim || !claim.batch.length) return;
      const result = await outreach.announcements.send(claim.channel, claim.batch, claim.content);
      await ctx.store.transact((db) => { const stored = collectionOf(ctx, db, 'adminAnnounce').items.find((item) => item.id === id); if (stored) { stored.mail.sent += result.sent; stored.mail.failed += result.failed; } }, { durable: false });
    },
  };
  ctx.on?.('heartbeat', () => { void service.tick(); });
  return service;
}
