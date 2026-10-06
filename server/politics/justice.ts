// OWNER: politics — fights, offences, police and jail. Pure over the stored record: every function takes a time, nothing reads a clock.
// Design: docs/POLITICS.md section 5. The limits are the constitution, src/game/content/politics.ts.
import { JUSTICE } from '../../src/game/content/politics.ts';
import type { JailRecord, JusticeRecord, OffenceRecord, PoliceRecord, TierId } from '../../src/types/politics.ts';
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
export function jail(justice: JusticeRecord, now: number, offence: OffenceRecord, officer: PlayerRef, tier: TierId, minutes: number): JailRecord {
  const served = Math.max(1, Math.min(JUSTICE.sentenceMaxMin, Math.floor(minutes)));
  const record: JailRecord = { until: now + served * 60000, at: now, minutes: served, offence: offence.id, by: { id: officer.id, name: officer.name }, tier };
  justice.jail[offence.by.id] = record;
  offence.status = 'arrested';
  for (const [id, entry] of Object.entries(justice.jail)) if (entry.until <= now - DAY_MS) delete justice.jail[id];
  return record;
}

/** Valid officers of one seat. */
export const officersOf = (justice: JusticeRecord, scope: string, sitting: { id: string; week: number } | null): [string, PoliceRecord][] => Object.entries(justice.police).filter(([, record]) => record.scope === scope && policeIsValid(record, sitting));
