// OWNER: politics — fights, offences, police and jail. Pure over the stored record: every function takes a time, nothing reads a clock.
// Design: docs/POLITICS.md section 5. The limits are the constitution, src/game/content/politics.ts.
import { JUSTICE } from '../../src/game/content/politics.ts';
import type { CaseRecord, JailRecord, JusticeRecord, OffenceRecord, PoliceRecord, TierId, Verdict } from '../../src/types/politics.ts';
import type { PlayerRef } from '../../src/types/protocol.ts';

type Block = { code: string; reason: string };
const no = (code: string, reason: string): Block => ({ code, reason });
const DAY_MS = 86400000;

/** The sentence a player is serving now, or null. */
export const jailOf = (justice: JusticeRecord, playerId: string, now: number): JailRecord | null => {
  const found = justice.jail[playerId];
  return found && found.until > now ? found : null;
};

/** The sentence in words: "12 minutes left". */
export const timeLeft = (until: number, now: number): string => {
  const minutes = Math.max(1, Math.ceil((until - now) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} minute${minutes === 1 ? '' : 's'}`;
};

/** Why `attackerId` may not start a fight with `victimId` now, or null. Where they stand and who they are is the route's to check. */
export function fightBlock(justice: JusticeRecord, now: number, attackerId: string, victimId: string): Block | null {
  if (attackerId === victimId) return no('self', 'You cannot fight yourself.');
  const jail = jailOf(justice, attackerId, now);
  if (jail) return no('jailed', `You are in jail for ${timeLeft(jail.until, now)} more.`);
  if (jailOf(justice, victimId, now)) return no('target_jailed', 'That player is in jail.');
  const last = justice.fights[attackerId];
  if (last !== undefined && now - last < JUSTICE.cooldownMs) return no('fight_cooldown', `You have just fought. Wait ${Math.ceil((JUSTICE.cooldownMs - (now - last)) / 60000)} more minutes.`);
  const pair = justice.pairs[`${attackerId}|${victimId}`];
  if (pair !== undefined && now - pair < JUSTICE.pairCooldownMs) return no('pair_cooldown', 'You have already fought this player. Leave them be for a while.');
  return null;
}

/** Who wins: the fitter side, with luck. `rolls` are two numbers in [0, 1). The attacker wins ties. */
export const attackerWins = (attackerEnergy: number, victimEnergy: number, rolls: readonly [number, number]): boolean => attackerEnergy + rolls[0] * 40 >= victimEnergy + rolls[1] * 40;

/** Put the offence on record and start the cooldowns. Old offences are dropped. */
export function recordFight(justice: JusticeRecord, now: number, id: string, by: PlayerRef, against: PlayerRef, city: string, venue: string, won: boolean): OffenceRecord {
  const offence: OffenceRecord = { id, kind: 'assault', by: { id: by.id, name: by.name }, against: { id: against.id, name: against.name }, city, venue, at: now, won, status: 'open' };
  justice.offences[id] = offence;
  justice.fights[by.id] = now;
  justice.pairs[`${by.id}|${against.id}`] = now;
  const ids = Object.keys(justice.offences);
  for (const key of ids) if (now - (justice.offences[key]?.at ?? 0) > DAY_MS) delete justice.offences[key];
  const kept = Object.values(justice.offences).sort((a, b) => b.at - a.at);
  for (const old of kept.slice(JUSTICE.keepOffences)) delete justice.offences[old.id];
  for (const [key, at] of Object.entries(justice.pairs)) if (now - at > DAY_MS) delete justice.pairs[key];
  for (const [key, at] of Object.entries(justice.fights)) if (now - at > DAY_MS) delete justice.fights[key];
  return offence;
}

/** An officer whose enrolment still holds: the officeholder who enrolled them still sits, in the term they enrolled in. */
export const policeIsValid = (record: PoliceRecord | undefined, sitting: { id: string; week: number } | null): record is PoliceRecord => !!record && !!sitting && sitting.id === record.by.id && sitting.week === record.week;

/** Whether an officer of `tier` and `scope` may act on an offence in `city`: the city's own police in that city, the state's anywhere in the state, the nation's anywhere. */
export const inJurisdiction = (tier: TierId, scope: string, city: string, scopesOfCity: readonly string[]): boolean => tier === 'nation' || (tier === 'city' ? scope === `city:${city}` : scopesOfCity.includes(scope));

export function arrestBlock(justice: JusticeRecord, now: number, officerId: string, offence: OffenceRecord | undefined): Block | null {
  if (!offence || offence.status !== 'open') return no('no_such_offence', 'That offence is not open any more.');
  if (now - offence.at > JUSTICE.offenceMs) return no('offence_old', 'That offence is too old to act on.');
  if (offence.by.id === officerId) return no('self', 'You cannot arrest yourself.');
  if (jailOf(justice, offence.by.id, now)) return no('already_jailed', `${offence.by.name} is already in jail.`);
  return null;
}

/** Jail the offender for `minutes` (never more than the constitution's longest sentence) and close the offence. */
export function jail(justice: JusticeRecord, now: number, offence: OffenceRecord, officer: PlayerRef, tier: TierId, scope: string, minutes: number): JailRecord {
  const served = Math.max(1, Math.min(JUSTICE.sentenceMaxMin, Math.floor(minutes)));
  const record: JailRecord = { until: now + served * 60000, at: now, minutes: served, offence: offence.id, by: { id: officer.id, name: officer.name }, tier, scope };
  justice.jail[offence.by.id] = record;
  offence.status = 'arrested';
  for (const [id, entry] of Object.entries(justice.jail)) if (entry.until <= now - DAY_MS) delete justice.jail[id];
  return record;
}

/** Valid officers of one seat. */
export const officersOf = (justice: JusticeRecord, scope: string, sitting: { id: string; week: number } | null): [string, PoliceRecord][] => Object.entries(justice.police).filter(([, record]) => record.scope === scope && policeIsValid(record, sitting));

// ---- courts ------------------------------------------------------------------------------------------

/** Judges of one seat whose enrolment still holds. */
export const judgesOf = (justice: JusticeRecord, scope: string, sitting: { id: string; week: number } | null): [string, PoliceRecord][] => Object.entries(justice.judges).filter(([, record]) => record.scope === scope && policeIsValid(record, sitting));

/** The court an appeal goes up to: city to state to nation. */
export const nextTier = (tier: TierId): TierId | null => (tier === 'city' ? 'state' : tier === 'state' ? 'nation' : null);

/** Why `playerId` cannot appeal their sentence now, or null. */
export function appealBlock(justice: JusticeRecord, now: number, playerId: string): Block | null {
  const sentence = jailOf(justice, playerId, now);
  if (!sentence) return no('not_jailed', 'You are not in jail. There is nothing to appeal.');
  if (!sentence.scope) return no('no_court', 'That arrest cannot be appealed.');
  if (justice.cases[sentence.offence]) return no('already_appealed', 'You have already appealed this sentence.');
  return null;
}

export function fileAppeal(justice: JusticeRecord, now: number, defendant: PlayerRef, sentence: JailRecord, city: string, statement: string, counsel: PlayerRef | null): CaseRecord {
  const record: CaseRecord = { id: sentence.offence, defendant: { id: defendant.id, name: defendant.name }, officer: sentence.by, city, tier: sentence.tier, scope: sentence.scope ?? '', filedAt: now, statement, appeals: 0, status: 'open',
    ...(counsel ? { counsel: { id: counsel.id, name: counsel.name } } : {}) };
  justice.cases[record.id] = record;
  return record;
}

/** Why the defendant cannot take the case to the next court up, or null. */
export function escalateBlock(justice: JusticeRecord, now: number, playerId: string): Block | null {
  const sentence = jailOf(justice, playerId, now), found = sentence ? justice.cases[sentence.offence] : undefined;
  if (!sentence || !found || found.defendant.id !== playerId) return no('no_case', 'You have no case before a court.');
  if (found.status !== 'decided' || !found.ruling) return no('not_decided', 'The court has not ruled yet.');
  if (found.appeals >= 1) return no('appeal_used', 'You have already taken this case up once. The higher court’s ruling is final.');
  if (!nextTier(found.tier)) return no('top_court', 'The federal court’s ruling is final.');
  return null;
}
export function escalate(found: CaseRecord, scope: string, tier: TierId): void {
  if (found.ruling) found.lower = found.ruling;
  delete found.ruling;
  found.status = 'open'; found.appeals = 1; found.tier = tier; found.scope = scope;
}

/** Why `judgeId` cannot rule on this case, or null. A judge is never a party to the case. */
export function ruleBlock(found: CaseRecord | undefined, judgeId: string, sitting: { id: string; week: number } | null, judge: PoliceRecord | undefined): Block | null {
  if (!found || found.status !== 'open') return no('no_such_case', 'That case is not before a court.');
  if (!judge || judge.scope !== found.scope || !policeIsValid(judge, sitting)) return no('not_judge', 'Only a judge of this court can rule. The officeholder enrols judges for their term.');
  if (judgeId === found.defendant.id || judgeId === found.officer.id || judgeId === found.counsel?.id) return no('conflict', 'A judge cannot rule on a case they are part of.');
  return null;
}

/** Apply a ruling: a quashed arrest frees the defendant; a reduced sentence loses half of what is left; an upheld one stands. */
export function applyRuling(justice: JusticeRecord, now: number, found: CaseRecord, judge: PlayerRef, verdict: Verdict, note: string): void {
  const sentence = justice.jail[found.defendant.id];
  if (sentence && sentence.offence === found.id && sentence.until > now) {
    if (verdict === 'quashed') delete justice.jail[found.defendant.id];
    else if (verdict === 'reduced') sentence.until = now + Math.max(60000, Math.floor((sentence.until - now) / 2));
  }
  found.ruling = { by: { id: judge.id, name: judge.name }, verdict, note, at: now, tier: found.tier };
  found.status = 'decided';
  const decided = Object.values(justice.cases).filter((item) => item.status === 'decided').sort((a, b) => (b.ruling?.at ?? 0) - (a.ruling?.at ?? 0));
  for (const old of decided.slice(JUSTICE.rulingsKept)) delete justice.cases[old.id];
  for (const [id, item] of Object.entries(justice.cases)) if (item.status === 'open' && now - item.filedAt > JUSTICE.offenceMs) delete justice.cases[id];
}

/** The bail a sentence can be bought off for, or 0 when there is none. */
export const bailOf = (value: number): number => (Number.isSafeInteger(value) && value > 0 ? value : 0);
