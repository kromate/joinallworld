/**
 * OWNER: admin
 * WORLD TOOLS: a small grant to everyone online, or to everyone of a city ("launch bonus").
 *
 * It is the same wallet action as a single credit (`wallet.admin`: one ledger line "Admin credit: <reason>" per life, never counted as earned
 * from work), under limits of its own that are stricter than a single credit's: at most ADMIN_GRANT_EACH_MAX naira each, at most
 * ADMIN_GRANT_TOTAL_DAY naira given out by all grants together per Lagos day, at most GRANT_MAX_PLAYERS players in one grant, and a typed
 * confirmation (with a confirmation token from a first request) when it reaches more than ADMIN_GRANT_CONFIRM_ABOVE players. Players who
 * are banned, still creating their character, or admins are left out; each recipient is told in Updates. One audit line records the grant
 * (count, amount each, total).
 *
 * WORKER COST: one session row per recipient (their cash and ledger), the social collection once (the notices), the audit collection once.
 */
import { characterCity } from '../character.ts';
import { lagosTime } from '../../src/game/clock.ts';
import { eachSession } from './players.ts';
import { limitsOf } from './config.ts';
import { audit, peek } from './store.ts';
import { playerIsAdmin } from './gate.ts';
import { sanctionsOf } from './sanctions.ts';
import { socialService } from '../social/service.ts';
import { formatNaira } from './actions.ts';
import type { Admin } from './gate.ts';
import type { Db, RouteContext, SessionRecord } from '../types.ts';

export const GRANT_MAX_PLAYERS = 1000;
export type GrantAudience = 'online' | 'city';

export function worldService(ctx: RouteContext) {
  const sanctions = sanctionsOf(ctx), social = socialService(ctx);
  const refuse = (status: number, code: string, reason: string) => Object.assign(ctx.fail(status, code), { reason });
  const today = (): number => lagosTime(ctx.now()).day;

  /** Who a grant would reach. Reads only. */
  function recipients(db: Db, audience: GrantAudience, city: string | null): SessionRecord[] {
    const found: SessionRecord[] = [], now = ctx.now();
    eachSession(db, (session) => {
      if (!(session.expiresAt > now)) return;
      const where = characterCity(session), state = where ? session.cities[where]?.state : undefined;
      if (!where || !state || (state.onboarding?.required === true && state.onboarding.done !== true)) return;
      if (audience === 'online' ? !ctx.online(session.publicId) : where !== city) return;
      if (sanctions.banned(session.publicId, session.account) || playerIsAdmin(ctx, db, session)) return;
      found.push(session);
    });
    return found;
  }
  const grantedToday = (db: Db): number => {
    let total = 0;
    const lines = peek(db, 'adminAudit').lines;
    for (let i = lines.length - 1; i >= 0; i--) { const line = lines[i]; if (!line) continue; if (lagosTime(line.at).day < today()) break; if (line.action === 'grant' && typeof line.amount === 'number') total += line.amount; }
    return total;
  };
  return {
    parse(body: Record<string, unknown>) {
      const audience: GrantAudience = body.audience === 'city' ? 'city' : 'online';
      const city = audience === 'city' ? ctx.cityIds.find((id) => id === body.city) ?? null : null;
      if (audience === 'city' && !city) throw refuse(400, 'invalid_city', 'Choose a city.');
      const amount = body.amount;
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1 || amount > limitsOf(ctx).grantEach) throw refuse(400, 'invalid_amount', `Give each player between ₦1 and ${formatNaira(limitsOf(ctx).grantEach)}.`);
      const reason = typeof body.reason === 'string' ? body.reason.replace(/\s+/g, ' ').trim() : '';
      if (reason.length < 3 || reason.length > 60) throw refuse(400, 'reason_required', 'Give a reason of 3 to 60 characters.');
      return { audience, city, amount, reason };
    },
    /** The numbers the admin sees before confirming. */
    preview(db: Db, input: { audience: GrantAudience; city: string | null; amount: number }) {
      const count = recipients(db, input.audience, input.city).length, limits = limitsOf(ctx), given = grantedToday(db);
      return { count, total: count * input.amount, grantedToday: given, leftToday: Math.max(0, limits.grantTotalDay - given), needsConfirmation: count > limits.grantConfirmAbove, confirmAbove: limits.grantConfirmAbove, maxPlayers: GRANT_MAX_PLAYERS };
    },
    /** Inside a transaction, inside ctx.once. */
    run(db: Db, admin: Admin, input: { audience: GrantAudience; city: string | null; amount: number; reason: string }, effects: { push?: unknown[] }) {
      const list = recipients(db, input.audience, input.city), limits = limitsOf(ctx);
      if (!list.length) throw refuse(409, 'nobody', 'Nobody matches right now.');
      if (list.length > GRANT_MAX_PLAYERS) throw refuse(409, 'too_many', `A grant reaches at most ${GRANT_MAX_PLAYERS} players. Narrow it to one city.`);
      const total = list.length * input.amount, given = grantedToday(db);
      if (given + total > limits.grantTotalDay) throw refuse(409, 'over_grant_day_limit', `Grants may give out at most ${formatNaira(limits.grantTotalDay)} a day; ${formatNaira(given)} has gone out today.`);
      let paid = 0;
      for (const found of list) {
        // The scan hands back records as stored; the transaction's own (writable) copy is the one that is changed.
        const session = db.sessions[found.secret];
        if (!session) continue;
        const city = characterCity(session);
        if (!city) continue;
        const life = ctx.settle(session, city), before = life.cash;
        const outcome = ctx.act(life, { type: 'wallet.admin', payload: { op: 'credit', amount: input.amount, reason: input.reason }, cityId: city });
        if (!outcome.ok) continue;
        paid += life.cash - before;
        if (social.modKnows(db, session.publicId)) (effects.push ??= []).push(...social.modNote(db, session.publicId, `A gift of ${formatNaira(input.amount)} was added to your cash: ${input.reason}.`).push);
      }
      const where = input.audience === 'online' ? 'everyone online' : `everyone in ${input.city}`;
      const summary = `Grant of ${formatNaira(input.amount)} each to ${where}: ${list.length} players, ${formatNaira(paid)} in all`;
      const line = audit(ctx, db, { admin: admin.accountId, adminName: admin.name, action: 'grant', target: input.audience === 'city' ? String(input.city) : 'online', targetName: where, params: { audience: input.audience, city: input.city, amount: input.amount, players: list.length }, summary, reason: input.reason, amount: paid });
      return { ok: true as const, code: 'granted', summary, players: list.length, total: paid, line: line.n };
    },
  };
}
