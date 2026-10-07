/**
 * OWNER: admin
 * The operator's side of government (docs/POLITICS.md "Trust"). What an admin can see of every seat, and the three things they can undo: an
 * officeholder (removed for the rest of the term), a jail sentence (released) and an officer's or judge's post (dismissed).
 *
 * Nothing an operator does here is quiet. Every action needs a reason, is written to the admin audit log by the route, and is ALSO written to
 * the public record as an "operator" entry that names the action, who it was done to and the reason, so the people of the world can read
 * what was done to their government and why. An operator cannot edit a past entry: the record is chained (src/records/chain.ts).
 */
import { civicTitle } from '../../src/game/cities/terminology.ts';
import { cityRules } from '../../src/game/cities/index.ts';
import { JUSTICE, QUORUM, SEAT_TITLES } from '../../src/game/content/politics.ts';
import type { TierId } from '../../src/types/politics.ts';
import { governorAt } from '../civic/elections.ts';
import { govOfId, peekJustice, peekPolitics, peekScope } from '../politics/data.ts';
import { jailOf } from '../politics/justice.ts';
import { signaturesNeeded } from '../politics/rules.ts';
import { append, peekRecords, recordsOf } from '../records/store.ts';
import type { Db, RouteContext } from '../types.ts';

type Failure = { code: string; reason: string };
const tierOf = (scope: string): TierId => (scope.startsWith('city:') ? 'city' : scope.startsWith('state:') ? 'state' : 'nation');
const nameOfScope = (scope: string): string => {
  const [kind = '', id = ''] = scope.split(':');
  return kind === 'city' ? cityRules(id)?.name ?? id : kind === 'state' ? `${id.charAt(0).toUpperCase()}${id.slice(1)} State` : 'Nigeria';
};
const titleOf = (scope: string): string => (tierOf(scope) === 'city' ? civicTitle(scope.slice(5)) : SEAT_TITLES[tierOf(scope) as Exclude<TierId, 'city'>]);

/** Every scope that has a ballot: the cities that held an election, the states and the nation. */
function scopesOf(db: Db): string[] {
  const cities = Object.keys(db.civic?.cities ?? {}).filter((id) => Object.keys(db.civic?.cities?.[id]?.gov?.elections ?? {}).length > 0).map((id) => `city:${id}`);
  return [...cities, ...Object.keys(db.politics?.scopes ?? {}).filter((id) => !id.startsWith('city:') && peekScope(peekPolitics(db), id).gov), ...Object.keys(db.politics?.scopes ?? {}).filter((id) => id.startsWith('city:'))].filter((id, index, all) => all.indexOf(id) === index).slice(0, 400);
}

export function politicsOverview(ctx: Pick<RouteContext, 'now'>, db: Db) {
  const now = ctx.now(), politics = peekPolitics(db), justice = peekJustice(politics), records = peekRecords(db);
  const seats = scopesOf(db).map((scope) => {
    const tier = tierOf(scope), gov = govOfId(db, scope), sitting = governorAt(gov, now, QUORUM[tier]), record = peekScope(politics, scope);
    const petition = sitting && record.petition?.week === sitting.week ? Object.keys(record.petition.signers).length : 0;
    return { scope, tier, title: titleOf(scope), name: nameOfScope(scope), holder: sitting ? { id: sitting.id, name: sitting.name, votes: sitting.votes, termEndsAt: sitting.termEndsAt } : null,
      treasury: record.treasury.balance, officers: Object.values(justice.police).filter((item) => item.scope === scope).length, judges: Object.values(justice.judges).filter((item) => item.scope === scope).length,
      petition: sitting ? { signed: petition, needed: signaturesNeeded(tier, sitting.votes) } : null, flags: sitting && record.audit?.week === sitting.week ? record.audit.flags : [] };
  });
  const jailed = Object.entries(justice.jail).filter(([id]) => jailOf(justice, id, now)).map(([id, sentence]) => ({ id, name: justice.offences[sentence.offence]?.by.name ?? id, until: sentence.until, minutes: sentence.minutes, by: sentence.by.name, tier: sentence.tier })).slice(0, 100);
  const post = (kind: 'police' | 'judges') => Object.entries(justice[kind]).map(([id, item]) => ({ id, name: item.name, scope: item.scope, tier: item.tier, by: item.by.name })).slice(0, 200);
  return { seats: seats.sort((a, b) => Number(!!b.holder) - Number(!!a.holder) || a.name.localeCompare(b.name)), jailed, police: post('police'), judges: post('judges'), openOffences: Object.values(justice.offences).filter((item) => item.status === 'open' && now - item.at <= JUSTICE.offenceMs).length,
    records: { count: records.seq, head: records.head } };
}

export type OperatorBody = Record<string, unknown>
export interface Done { summary: string; target: string; targetName: string; reason: string }

/** One undoing. Throws a Failure (`{ code, reason }`) when it cannot be done. Writes the public entry; the route writes the admin audit line. */
export function politicsAct(ctx: Pick<RouteContext, 'now' | 'collection'>, db: Db, body: OperatorBody): Done {
  const now = ctx.now(), reason = typeof body.reason === 'string' ? body.reason.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
  const refuse = (code: string, text: string): never => { throw { code, reason: text } satisfies Failure; };
  if (reason.length < 10) refuse('reason_required', 'Give a reason of at least 10 characters. It is shown to everyone in the public record.');
  const politics = peekPolitics(db), justice = peekJustice(politics);
  const note = (scope: string, scopeName: string, week: number | null, title: string, facts: Record<string, string | number | boolean | null>): void => { append(recordsOf(ctx, db), now, { kind: 'operator', scope, scopeName, week, title: `${title}: ${reason}`, facts: { ...facts, reason } }); };

  if (body.action === 'remove-officeholder') {
    const scope = typeof body.scope === 'string' ? body.scope : '';
    if (!/^(city|state|nation):[a-z0-9-]{1,40}$/.test(scope) || !scopesOf(db).includes(scope)) return refuse('unknown_seat', 'That seat does not exist.');
    const tier = tierOf(scope), gov = govOfId(db, scope), sitting = governorAt(gov, now, QUORUM[tier]);
    if (!sitting) return refuse('empty_seat', 'Nobody holds that seat.');
    if (typeof body.typed !== 'string' || body.typed.trim().toLowerCase() !== sitting.name.toLowerCase()) return refuse('confirmation_required', `Type the officeholder’s name (${sitting.name}) to confirm.`);
    const election = gov.gov.elections[sitting.week];
    if (!election) return refuse('empty_seat', 'Nobody holds that seat.');
    election.removedAt = now;
    note(scope, nameOfScope(scope), sitting.week, `The operator removed ${titleOf(scope)} ${sitting.name} of ${nameOfScope(scope)} for the rest of the term`, { action: 'remove-officeholder', target: sitting.name, targetId: sitting.id });
    return { summary: `Removed ${titleOf(scope)} ${sitting.name} of ${nameOfScope(scope)}`, target: sitting.id, targetName: sitting.name, reason };
  }
  if (body.action === 'release') {
    const id = typeof body.player === 'string' ? body.player : '';
    const sentence = jailOf(justice, id, now);
    if (!sentence || !db.politics?.justice) return refuse('not_jailed', 'That player is not in jail.');
    const name = justice.offences[sentence.offence]?.by.name ?? id;
    delete db.politics.justice.jail[id];
    note('world', 'Nigeria', null, `The operator released ${name} from jail`, { action: 'release', target: name, targetId: id });
    return { summary: `Released ${name} from jail`, target: id, targetName: name, reason };
  }
  if (body.action === 'dismiss') {
    const id = typeof body.player === 'string' ? body.player : '', role = body.role === 'judge' ? 'judge' : 'police';
    const roster = db.politics?.justice?.[role === 'judge' ? 'judges' : 'police'], found = roster?.[id];
    if (!roster || !found) return refuse('not_an_official', `That player is not ${role === 'judge' ? 'a judge' : 'a police officer'}.`);
    delete roster[id];
    note(found.scope, nameOfScope(found.scope), found.week, `The operator dismissed ${found.name} as ${role === 'judge' ? 'a judge' : 'a police officer'} of ${nameOfScope(found.scope)}`, { action: 'dismiss', target: found.name, targetId: id, role });
    return { summary: `Dismissed ${found.name} as ${role === 'judge' ? 'a judge' : 'a police officer'}`, target: id, targetName: found.name, reason };
  }
  return refuse('unknown_action', 'Choose remove-officeholder, release or dismiss.');
}
