/**
 * OWNER: admin
 * THE ACTIONS AN ADMIN CAN TAKE ON ONE PLAYER, and the rules that bound them. One entry point, run inside a store transaction
 * and inside the admin's own exactly-once receipt (ctx.once), so a repeated request (a double tap, a retry after a lost answer)
 * is answered with the first result and changes nothing. Every action that runs writes one audit line in the same transaction.
 *
 * MONEY goes through the rules engine's wallet as its own ledger line ("Admin credit: <reason>" / "Admin debit: <reason>"; engine
 * action `wallet.admin`, server-only), so a life's cash always equals what it started with plus its ledger. A credit is a faucet and
 * a debit a sink; both are totalled in the audit store and the dashboard. A credit never counts as earned from work (social.earned is
 * not touched), so it unlocks no gifting and no buying from players. A debit takes at most the balance (never below zero) and reports
 * what it could take. Limits (server/admin/config.ts): per action, per target per Lagos day, per admin per Lagos day.
 *
 * WHO: nobody can act on an admin or the founder except the founder (server/admin/gate.ts mayAct). An expired or archived life, or a
 * life still held for character creation, is not acted on.
 *
 * WORKER COST of one action: the admin's session row (the receipt is a row of its own), the target's session row (money, needs,
 * teleport, rename, sign-out), the audit collection (1 row, a few when it passes the chunk size) and, for a sanction, adminSanctions
 * and moderation (1 row each); a notice to the player is written into the social collection (1 row or its changed parts).
 */
import { characterCity } from '../character.ts';
import { canOccupyVenue, validateName } from '../protocol.ts';
import { NEEDS } from '../../src/game/systems/needs.ts';
import { lagosTime } from '../../src/game/clock.ts';
import { endAllDevices } from '../accounts/service.ts';
import { SESSION_CHANGED } from '../routes/auth.ts';
import { moderationService } from '../moderation/service.ts';
import { socialService } from '../social/service.ts';
import { screenText } from '../moderation/text.ts';
import { sanctionsOf } from './sanctions.ts';
import { limitsOf } from './config.ts';
import { audit, collectionOf, NOTES_PER_PLAYER, NOTES_PLAYERS, peek } from './store.ts';
import { mayAct, shortRef } from './gate.ts';
import type { Admin } from './gate.ts';
import type { AuditLine, SanctionKind } from './store.ts';
import type { LifeState, NeedId } from '../../src/types/life.ts';
import type { CityId } from '../../src/types/protocol.ts';
import type { Db, MuteRecord, RouteContext, SessionRecord } from '../types.ts';

export const PLAYER_ACTIONS = ['credit', 'debit', 'need', 'heal', 'teleport', 'rename', 'mute', 'unmute', 'suspend', 'unsuspend', 'ban', 'unban', 'signout', 'message', 'note'] as const;
export type PlayerAction = (typeof PLAYER_ACTIONS)[number];
/** Actions that need the typed confirmation and the confirmation token of a first request. */
export const DESTRUCTIVE: ReadonlySet<PlayerAction> = new Set<PlayerAction>(['ban', 'signout', 'debit']);
/** Actions that must give a reason (money and sanctions). */
export const NEEDS_REASON: ReadonlySet<PlayerAction> = new Set<PlayerAction>(['credit', 'debit', 'mute', 'suspend', 'ban']);
/** The founder's credits have no configured cap: only this bound, which protects number handling, applies. */
export const HARD_AMOUNT_MAX = 1_000_000_000_000;
/** A single credit above this asks for the typed confirmation: a guard against a typo, not a limit. */
export const CREDIT_CONFIRM_ABOVE = 10_000_000;
/** Does this parsed action ask for the typed confirmation (a confirmation token from a first request)? */
export const needsConfirmation = (parsed: Parsed): boolean => DESTRUCTIVE.has(parsed.action) || (parsed.action === 'credit' && Number(parsed.params.amount) > CREDIT_CONFIRM_ABOVE);
export const MAX_MINUTES = 30 * 24 * 60, MAX_BAN_MINUTES = 365 * 24 * 60, TEXT_MAX = 500, REASON_MAX = 200;

export interface Parsed { action: PlayerAction; reason: string; params: Record<string, string | number> }
const CONTROL = /[\u0000-\u001f\u007f]/;
const bad = (ctx: RouteContext, code: string) => ctx.fail(400, code);
const naira = (n: number): string => `₦${Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
export { naira as formatNaira };

/** Parse and validate a request body into a Parsed action. Pure: reads nothing. */
export function parseAction(ctx: RouteContext, action: unknown, body: Record<string, unknown>): Parsed {
  if (typeof action !== 'string' || !PLAYER_ACTIONS.some((item) => item === action)) throw bad(ctx, 'unknown_action');
  const name = action as PlayerAction;
  const text = (value: unknown, max: number, code: string): string => { const t = typeof value === 'string' ? value.trim() : ''; if (!t || t.length > max || CONTROL.test(t)) throw bad(ctx, code); return t; };
  const whole = (value: unknown, least: number, most: number, code: string): number => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < least || value > most) throw bad(ctx, code); return value; };
  let reason = '';
  if (body.reason !== undefined && body.reason !== '') reason = text(body.reason, REASON_MAX, 'invalid_reason');
  if (NEEDS_REASON.has(name) && reason.length < 3) throw bad(ctx, 'reason_required');
  const params: Parsed['params'] = {};
  switch (name) {
    case 'credit': case 'debit': params.amount = whole(body.amount, 1, HARD_AMOUNT_MAX, 'invalid_amount'); if (name === 'credit' && body.restricted === true) params.restricted = 1; break;
    case 'need': { const need = String(body.need); if (!NEEDS.some((item) => item === need)) throw bad(ctx, 'invalid_need'); params.need = need; params.value = whole(body.value, 0, 100, 'invalid_value'); break; }
    case 'teleport': if (body.to !== 'arrival' && body.to !== 'home') throw bad(ctx, 'invalid_place'); params.to = body.to; break;
    case 'rename': params.name = validateName(body.name); break;
    case 'mute': params.minutes = whole(body.minutes, 1, MAX_MINUTES, 'invalid_minutes'); break;
    case 'suspend': case 'unsuspend': if (body.kind !== 'pictures' && body.kind !== 'calls') throw bad(ctx, 'invalid_kind'); params.kind = body.kind; if (name === 'suspend') params.minutes = whole(body.minutes, 1, MAX_MINUTES, 'invalid_minutes'); break;
    case 'ban': params.minutes = body.minutes === 0 ? 0 : whole(body.minutes, 1, MAX_BAN_MINUTES, 'invalid_minutes'); break;
    case 'message': case 'note': params.text = text(body.text, TEXT_MAX, 'invalid_text'); break;
    default: break;
  }
  return { action: name, reason, params };
}

/** What has to happen once the transaction has committed (nothing here is stored). */
export interface Effects { mutes?: Record<string, MuteRecord>; sanctions?: { players: Parameters<ReturnType<typeof sanctionsOf>['sync']>[0]; accounts: Parameters<ReturnType<typeof sanctionsOf>['sync']>[1] }; closeSockets?: string; closeDevices?: string[]; renamed?: SessionRecord; revalidate?: string; push?: unknown[]; lifeChanged?: boolean }
export interface ActionResult { ok: true; code: string; summary: string; before?: number; after?: number; applied?: number; clamped?: boolean; line: number }

const lifeCity = (ctx: RouteContext, session: SessionRecord): CityId => {
  const city = characterCity(session);
  const state = city ? session.cities[city]?.state : undefined;
  if (!city || !state) throw Object.assign(ctx.fail(409, 'no_life'), { reason: 'This player has no life in a city yet.' });
  if (state.onboarding?.required === true && state.onboarding.done !== true) throw Object.assign(ctx.fail(409, 'life_not_started'), { reason: 'This player is still creating their character.' });
  return city;
};
/** The money admins have moved today (gross, both directions) for one target and for one admin, from the audit lines. */
export function movedToday(ctx: RouteContext, db: Db, by: { target?: string; admin?: string }): number {
  const today = lagosTime(ctx.now()).day;
  let total = 0;
  const lines = peek(db, 'adminAudit').lines;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    if (lagosTime(line.at).day < today) break;
    if ((line.action !== 'credit' && line.action !== 'debit') || typeof line.amount !== 'number') continue;
    if ((by.target === undefined || line.target === by.target) && (by.admin === undefined || line.admin === by.admin)) total += Math.abs(line.amount);
  }
  return total;
}

export function actionsService(ctx: RouteContext) {
  const moderation = moderationService(ctx), social = socialService(ctx), sanctions = sanctionsOf(ctx);
  const refuse = (status: number, code: string, reason: string) => Object.assign(ctx.fail(status, code), { reason });

  function record(db: Db, admin: Admin, line: Pick<AuditLine, 'action' | 'target' | 'targetName' | 'summary' | 'reason'> & { params: Parsed['params']; amount?: number }): number {
    const { amount, ...rest } = line;
    return audit(ctx, db, { admin: admin.accountId, adminName: admin.name, ...rest, ...(amount !== undefined ? { amount } : {}) }).n;
  }
  /** A line in the player's Updates, with the push to their open sockets (sent after the commit). */
  function tell(db: Db, effects: Effects, id: string, text: string): void {
    if (!social.modKnows(db, id)) return;
    (effects.push ??= []).push(...social.modNote(db, id, text).push);
  }

  function money(db: Db, admin: Admin, target: SessionRecord, parsed: Parsed, effects: Effects): ActionResult {
    const city = lifeCity(ctx, target), limits = limitsOf(ctx), amount = Number(parsed.params.amount), credit = parsed.action === 'credit';
    // The founder (the root admin) has no configured cap on money; other admins keep the three caps.
    if (!admin.root) {
      if (amount > limits.maxAmount) throw refuse(409, 'over_action_limit', `One credit or debit may move at most ${naira(limits.maxAmount)}.`);
      const toTarget = movedToday(ctx, db, { target: target.publicId }), byAdmin = movedToday(ctx, db, { admin: admin.accountId });
      if (toTarget + amount > limits.perTargetDay) throw refuse(409, 'over_target_day_limit', `Admins may move at most ${naira(limits.perTargetDay)} on one player per day; ${naira(toTarget)} has moved today.`);
      if (byAdmin + amount > limits.perAdminDay) throw refuse(409, 'over_admin_day_limit', `You may move at most ${naira(limits.perAdminDay)} a day; you have moved ${naira(byAdmin)} today.`);
    }
    const restricted = parsed.params.restricted === 1;
    const life: LifeState = ctx.settle(target, city), before = life.cash;
    const outcome = ctx.act(life, { type: 'wallet.admin', payload: { op: parsed.action as 'credit' | 'debit', amount, reason: parsed.reason, ...(credit && !restricted ? { unrestricted: true } : {}) }, cityId: city });
    if (!outcome.ok) throw refuse(409, outcome.code, outcome.code === 'balance_limit' ? 'That would pass the largest balance a life can hold.' : 'The balance could not be changed.');
    const after = life.cash, applied = Math.abs(after - before), clamped = !credit && applied < amount;
    const summary = `${credit ? 'Credit' : 'Debit'} ${naira(applied)}${credit ? (restricted ? ' (restricted: cannot be gifted)' : ' (unrestricted: can be gifted and spent freely)') : ''}${clamped ? ` (asked ${naira(amount)}; the balance held less)` : ''}: cash ${naira(before)} → ${naira(after)}`;
    const line = record(db, admin, { action: parsed.action, target: target.publicId, targetName: target.name, params: parsed.params, summary, reason: parsed.reason, amount: credit ? applied : -applied });
    tell(db, effects, target.publicId, credit ? `An admin added ${naira(applied)} to your cash: ${parsed.reason}.${restricted ? '' : ' You can spend it or give it to friends freely.'}` : `An admin took ${naira(applied)} from your cash: ${parsed.reason}.`);
    effects.lifeChanged = true;
    return { ok: true, code: credit ? 'credited' : 'debited', summary, before, after, applied, clamped, line };
  }

  function needs(db: Db, admin: Admin, target: SessionRecord, parsed: Parsed): ActionResult {
    const city = lifeCity(ctx, target), life = ctx.settle(target, city), heal = parsed.action === 'heal';
    const before = JSON.stringify(life.needs);
    const need = String(parsed.params.need) as NeedId;
    const was = heal ? 0 : life.needs[need];
    const outcome = ctx.act(life, { type: 'needs.admin', payload: heal ? { op: 'heal' } : { op: 'set', need, value: Number(parsed.params.value) }, cityId: city });
    if (!outcome.ok) throw refuse(409, outcome.code, 'The need could not be set.');
    const summary = heal ? `Healed: every need below 80 lifted to 80 (${before} → ${JSON.stringify(life.needs)})` : `Need ${need}: ${was} → ${life.needs[need]}`;
    const line = record(db, admin, { action: parsed.action, target: target.publicId, targetName: target.name, params: parsed.params, summary, reason: parsed.reason });
    return { ok: true, code: heal ? 'healed' : 'set', summary, line };
  }

  function teleport(db: Db, admin: Admin, target: SessionRecord, parsed: Parsed, effects: Effects): ActionResult {
    const city = lifeCity(ctx, target), life = ctx.settle(target, city), to = parsed.params.to === 'home' ? 'home' : 'arrival';
    if (to === 'home' && !canOccupyVenue(life, 'home')) throw refuse(409, 'no_home_here', 'This player has no home to stand in, in this city.');
    const from = life.location;
    const outcome = ctx.act(life, { type: 'activity.admin', payload: { to }, cityId: city });
    if (!outcome.ok) throw refuse(409, outcome.code, outcome.code === 'travelling' ? 'This player is travelling between cities; wait for the trip to end.' : 'The player could not be moved.');
    effects.revalidate = target.publicId;
    const summary = `Moved within ${city}: ${from} → ${life.location}${life.activeAction ? '' : ' (any stuck action cleared)'}`;
    return { ok: true, code: 'moved', summary, line: record(db, admin, { action: 'teleport', target: target.publicId, targetName: target.name, params: parsed.params, summary, reason: parsed.reason }) };
  }

  function rename(db: Db, admin: Admin, target: SessionRecord, parsed: Parsed, effects: Effects): ActionResult {
    const old = target.name, name = String(parsed.params.name);
    target.name = name;
    for (const entry of Object.values(target.cities)) if (entry?.state) entry.state.name = name;
    effects.renamed = target;
    const summary = `Name “${old}” → “${name}”`;
    tell(db, effects, target.publicId, `An admin changed your name to “${name}”${parsed.reason ? `: ${parsed.reason}` : ''}. You can change it in your profile.`);
    return { ok: true, code: 'renamed', summary, line: record(db, admin, { action: 'rename', target: target.publicId, targetName: name, params: { name }, summary, reason: parsed.reason }) };
  }

  function mute(db: Db, admin: Admin, target: SessionRecord, parsed: Parsed, effects: Effects): ActionResult {
    const lift = parsed.action === 'unmute', minutes = Number(parsed.params.minutes);
    const done = lift ? moderation.lift(db, target.publicId, 'admin') : moderation.mute(db, { id: target.publicId, minutes, reason: parsed.reason }, 'admin');
    effects.mutes = done.mutes;
    const summary = lift ? (('lifted' in done && done.lifted) ? 'Mute lifted' : 'Was not muted') : `Muted for ${minutes} minutes`;
    if (!lift) tell(db, effects, target.publicId, `A moderator has muted you for ${minutes} minutes: ${parsed.reason}. You can keep playing; you cannot post text until it ends. If this is a mistake, use Phone → Report a problem.`);
    return { ok: true, code: lift ? 'unmuted' : 'muted', summary, line: record(db, admin, { action: parsed.action, target: target.publicId, targetName: target.name, params: parsed.params, summary, reason: parsed.reason }) };
  }

  function sanction(db: Db, admin: Admin, target: SessionRecord, parsed: Parsed, effects: Effects): ActionResult {
    const ban = parsed.action === 'ban' || parsed.action === 'unban', lifting = parsed.action === 'unban' || parsed.action === 'unsuspend';
    const kind: SanctionKind = ban ? 'ban' : parsed.params.kind === 'calls' ? 'calls' : 'pictures';
    const minutes = Number(parsed.params.minutes ?? 0), now = ctx.now();
    const after = lifting ? null : { at: now, until: minutes > 0 ? now + minutes * 60000 : 0, reason: parsed.reason, by: shortRef(admin.accountId) };
    const had = peek(db, 'adminSanctions').players[target.publicId]?.[kind];
    effects.sanctions = sanctions.set(db, target.publicId, kind, after, target.account);
    let summary = lifting ? (had ? `${kind === 'ban' ? 'Ban' : `Suspension of ${kind}`} lifted` : 'There was nothing to lift') : `${kind === 'ban' ? 'Banned' : `${kind[0]?.toUpperCase()}${kind.slice(1)} suspended`} ${minutes > 0 ? `for ${minutes} minutes` : 'with no end date'}`;
    if (kind === 'ban' && !lifting) {
      // A banned player is signed out at once, everywhere, so the next thing they see is the plain message.
      effects.closeSockets = target.publicId;
      const account = target.account ? db.accounts?.[target.account] : undefined;
      if (account) effects.closeDevices = endAllDevices(db, { now: ctx.now, newId: () => ctx.core.newId() }, account);
      summary += '; signed out everywhere';
    }
    if (!lifting && kind !== 'ban') tell(db, effects, target.publicId, `${kind === 'pictures' ? 'Sending pictures' : 'Placing calls'} is switched off for you ${minutes > 0 ? `for ${minutes} minutes` : 'until further notice'}: ${parsed.reason}. If this is a mistake, use Phone → Report a problem.`);
    return { ok: true, code: lifting ? 'lifted' : 'applied', summary, line: record(db, admin, { action: parsed.action, target: target.publicId, targetName: target.name, params: parsed.params, summary, reason: parsed.reason }) };
  }

  function signout(db: Db, admin: Admin, target: SessionRecord, parsed: Parsed, effects: Effects): ActionResult {
    const account = target.account ? db.accounts?.[target.account] : undefined;
    let summary: string;
    effects.closeSockets = target.publicId;
    if (account) { effects.closeDevices = endAllDevices(db, { now: ctx.now, newId: () => ctx.core.newId() }, account); summary = `Signed out of ${effects.closeDevices.length} browser${effects.closeDevices.length === 1 ? '' : 's'}`; }
    else { ctx.core.archiveSession(db, target.secret, target); summary = 'Guest session ended (the life is kept in the archive)'; }
    return { ok: true, code: 'signed_out', summary, line: record(db, admin, { action: 'signout', target: target.publicId, targetName: target.name, params: parsed.params, summary, reason: parsed.reason }) };
  }

  function message(db: Db, admin: Admin, target: SessionRecord, parsed: Parsed, effects: Effects): ActionResult {
    const col = db.social;
    const founder = col ? social.kit.founderId(col) : null;
    const session = founder ? ctx.core.sessionByPublicId?.(db, founder) : undefined;
    if (!founder || !session) throw refuse(409, 'no_founder', 'The founder character is not known yet: it is noted the first time the founder plays.');
    const text = String(parsed.params.text), verdict = screenText(text, { contact: true, what: 'The message' });
    if (verdict) throw refuse(400, verdict.code, verdict.reason);
    const sent = social.send(db, session, { to: target.publicId, body: text, clientId: `${ctx.now()}:${ctx.randomId()}` });
    if (sent.ok === false) throw refuse(409, sent.code, 'reason' in sent && typeof sent.reason === 'string' ? sent.reason : 'The message was not sent.');
    (effects.push ??= []).push(...(Array.isArray((sent as { push?: unknown[] }).push) ? (sent as { push: unknown[] }).push : []));
    const summary = `Message sent as the founder character (${text.length} characters)`;
    return { ok: true, code: 'sent', summary, line: record(db, admin, { action: 'message', target: target.publicId, targetName: target.name, params: { length: text.length }, summary, reason: parsed.reason }) };
  }

  function note(db: Db, admin: Admin, target: SessionRecord, parsed: Parsed): ActionResult {
    const col = collectionOf(ctx, db, 'adminNotes');
    if (!col.players[target.publicId] && Object.keys(col.players).length >= NOTES_PLAYERS) throw refuse(409, 'notes_full', 'The notes list is full.');
    const list = (col.players[target.publicId] ??= []);
    list.push({ at: ctx.now(), by: admin.accountId, text: String(parsed.params.text) });
    if (list.length > NOTES_PER_PLAYER) list.splice(0, list.length - NOTES_PER_PLAYER);
    const summary = 'Private note added';
    return { ok: true, code: 'noted', summary, line: record(db, admin, { action: 'note', target: target.publicId, targetName: target.name, params: { length: String(parsed.params.text).length }, summary, reason: '' }) };
  }

  return {
    /** Inside a transaction, inside ctx.once: perform `parsed` on `target`. Throws to refuse (nothing is kept). */
    run(db: Db, admin: Admin, target: SessionRecord, parsed: Parsed, effects: Effects): ActionResult {
      mayAct(ctx, db, admin, target);
      if (!(target.expiresAt > ctx.now())) throw refuse(409, 'player_expired', 'That player’s session has ended.');
      switch (parsed.action) {
        case 'credit': case 'debit': return money(db, admin, target, parsed, effects);
        case 'need': case 'heal': return needs(db, admin, target, parsed);
        case 'teleport': return teleport(db, admin, target, parsed, effects);
        case 'rename': return rename(db, admin, target, parsed, effects);
        case 'mute': case 'unmute': return mute(db, admin, target, parsed, effects);
        case 'suspend': case 'unsuspend': case 'ban': case 'unban': return sanction(db, admin, target, parsed, effects);
        case 'signout': return signout(db, admin, target, parsed, effects);
        case 'message': return message(db, admin, target, parsed, effects);
        case 'note': return note(db, admin, target, parsed);
      }
    },
    /** After the commit: everything the transaction decided but could not do itself. */
    async finish(effects: Effects): Promise<void> {
      if (effects.mutes) moderation.sync(effects.mutes);
      if (effects.sanctions) sanctions.sync(effects.sanctions.players, effects.sanctions.accounts);
      if (effects.closeSockets) for (const ws of ctx.core.sockets()) if (ws.session.id === effects.closeSockets) ctx.core.closeSocket?.(ws, SESSION_CHANGED, 'Session changed');
      if (effects.closeDevices?.length) for (const ws of ctx.core.sockets()) if (ws.device !== undefined && effects.closeDevices.includes(ws.device)) ctx.core.closeSocket?.(ws, SESSION_CHANGED, 'Session changed');
      if (effects.renamed) ctx.core.refreshNames?.(ctx.publicSession(effects.renamed));
      if (effects.push?.length) social.deliver({ push: effects.push as Parameters<typeof social.deliver>[0] extends { push?: infer P } ? P : never });
      if (effects.revalidate) await ctx.core.revalidate(effects.revalidate);
    },
    social,
  };
}
