// OWNER: politics — what a sentence stops. Called by POST /api/action before an action is applied: a jailed player cannot move or work.
import type { ActionRequest } from '../../src/types/protocol.ts';
import type { Db, RouteContext, SessionRecord } from '../types.ts';
import { peekPolitics, peekJustice } from './data.ts';
import { jailOf, timeLeft } from './justice.ts';

/** Actions a sentence stops: leaving, working and moving about. Everything else (messages, calls, the Phone, the wallet) goes on. */
export const JAIL_STOPS: ReadonlySet<string> = new Set(['travel', 'travel.skip', 'world.roadside', 'property.car-use', 'activity', 'spot', 'apply-job', 'career.switch', 'estate.relocate', 'homeward.accept']);

export function jailGate(ctx: Pick<RouteContext, 'fail' | 'now'>, db: Db, session: SessionRecord, body: Pick<ActionRequest, 'type'>): void {
  if (!JAIL_STOPS.has(body.type) || !db.politics?.justice) return;
  const jail = jailOf(peekJustice(peekPolitics(db)), session.publicId, ctx.now());
  if (jail) throw Object.assign(ctx.fail(403, 'jailed'), { reason: `You are in jail for ${timeLeft(jail.until, ctx.now())} more. You can still message and call people.` });
}
