/**
 * OWNER: moderation
 * Operator mutes and the audit trail. Portable: only the server context from routes/index.js.
 *
 * STORED COLLECTION  ctx.collection(db, 'moderation')
 *   mutes   { [publicId]: { at, until, reason, report? } }      a mute that has run out is deleted on the next write
 *   audit   [{ n, at, action, target, detail, from }]           newest last, at most LIMITS.audit lines
 *   seq     number
 * Only public ids are stored; `from` is the address the operator's request came from.
 *
 * A MUTE stops a player posting text other players can read — venue chat, direct, group and house
 * messages, group names, slogans, announcements, ad text, radio shout-outs and renaming — until it
 * runs out. It changes nothing else: the muted player keeps their session, their life, their money
 * and everything they own, can still play, read, vote and receive messages, and can still file a
 * problem report. There is no ban and nothing here deletes or archives a life.
 *
 * Mutes are also held in memory (loaded before the server takes requests, replaced after every
 * committed change) so the chat path can ask without a store read:
 *   ctx.checks.muted(publicId) → null | { code: 'muted', reason, until }
 */
import type { Db, ModerationCollection, MuteRecord, MuteVerdict, RouteContext } from '../types.ts';

export const LIMITS = Object.freeze({ audit: 1000, reason: 200, maxMinutes: 30 * 24 * 60, mutes: 5000 });
export type ModerationService = ReturnType<typeof buildService>;
const services = new WeakMap<RouteContext, ModerationService>();
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const untilText = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

export function moderationService(ctx: RouteContext): ModerationService {
  const cached = services.get(ctx);
  if (cached) return cached;
  const service = buildService(ctx);
  return service;
}

function buildService(ctx: RouteContext) {
  let live = new Map<string, { until: number; reason: string }>(); // publicId → { until, reason }
  function col(db: Db): ModerationCollection {
    const m = ctx.collection(db, 'moderation');
    if (!isRecord(m.mutes)) m.mutes = {};
    if (!Array.isArray(m.audit)) m.audit = [];
    if (!Number.isSafeInteger(m.seq)) m.seq = 0;
    return m;
  }
  const active = (m: Pick<ModerationCollection, 'mutes'>): Record<string, MuteRecord> => Object.fromEntries(Object.entries(m.mutes).filter(([, mute]) => mute.until > ctx.now()));
  const service = {
    LIMITS,
    /** null, or why this player cannot post text right now. Reads memory only. */
    muted(publicId: string): MuteVerdict | null {
      const mute = live.get(publicId);
      if (!mute || mute.until <= ctx.now()) return null;
      return { code: 'muted', until: mute.until,
        reason: `A moderator has muted you until ${untilText(mute.until)} UTC${mute.reason ? ` (${mute.reason})` : ''}. You can keep playing; you cannot post text until then. If you think this is a mistake, use Phone → Report a problem.` };
    },
    /** Replace the in-memory copy after a committed change (and at start-up). */
    sync(mutes: Record<string, MuteRecord> | null | undefined): void { live = new Map(Object.entries(mutes || {}).map(([id, mute]) => [id, { until: mute.until, reason: mute.reason }])); },
    load: (): Promise<void> => ctx.store.read((db) => active(db.moderation && isRecord(db.moderation.mutes) ? db.moderation : { mutes: {} })).then((mutes) => service.sync(mutes)),
    /** Append one line to the audit trail (inside a transaction). */
    audit(db: Db, action: string, target: unknown, detail: unknown, from: unknown): void {
      const m = col(db);
      m.audit.push({ n: ++m.seq, at: ctx.now(), action, target: String(target ?? '').slice(0, 80), detail: String(detail ?? '').slice(0, 300), from: String(from ?? '').slice(0, 64) });
      if (m.audit.length > LIMITS.audit) m.audit.splice(0, m.audit.length - LIMITS.audit);
    },
    mute(db: Db, { id, minutes, reason, report }: { id: string; minutes: number; reason: string; report?: string | undefined }, from: unknown) {
      const m = col(db);
      for (const [key, mute] of Object.entries(m.mutes)) if (mute.until <= ctx.now()) delete m.mutes[key];
      if (Object.keys(m.mutes).length >= LIMITS.mutes && !m.mutes[id]) throw ctx.fail(409, 'mute_list_full');
      m.mutes[id] = { at: ctx.now(), until: ctx.now() + minutes * 60000, reason, ...(report ? { report } : {}) };
      service.audit(db, 'mute', id, `${minutes} min${reason ? ` · ${reason}` : ''}${report ? ` · report ${report}` : ''}`, from);
      return { mute: { id, ...m.mutes[id] }, mutes: active(m) };
    },
    lift(db: Db, id: string, from: unknown) {
      const m = col(db);
      const had = Boolean(m.mutes[id]);
      delete m.mutes[id];
      if (had) service.audit(db, 'unmute', id, '', from);
      return { lifted: had, mutes: active(m) };
    },
    mutes: (db: Db) => Object.entries(active(col(db))).map(([id, mute]) => ({ id, ...mute })),
    trail: (db: Db, limit = 200) => col(db).audit.slice(-limit).reverse(),
  };
  return service;
}
