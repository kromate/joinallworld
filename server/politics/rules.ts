// OWNER: politics — decrees, treasuries and parties. Pure over the stored record: every function takes a time, nothing reads a clock.
// Design: docs/POLITICS.md. The limits are the constitution, src/game/content/politics.ts.
import { LEDGER_KEEP, LEVERS, PARTY, QUORUM, SALARY_SHARE, SEATS } from '../../src/game/content/politics.ts';
import type { LeverId, LedgerLine, TierId } from '../../src/types/politics.ts';
import type { PlayerRef } from '../../src/types/protocol.ts';
import type { GovScope, PoliticsCollection, PoliticsScopeRecord } from '../types.ts';
import { governorAt } from '../civic/elections.ts';

type Block = { code: string; reason: string };
const no = (code: string, reason: string): Block => ({ code, reason });

// ---- decrees ----------------------------------------------------------------------------------------

/** The value of a lever now: the sitting officeholder's decree, else the base. A decree lapses with the term it was made in. */
export function leverValue(scope: PoliticsScopeRecord, gov: GovScope, now: number, id: LeverId): number {
  const sitting = governorAt(gov, now, QUORUM[LEVERS[id].tier]), decree = scope.decree;
  const value = decree?.values[id];
  return sitting && decree && decree.week === sitting.week && decree.by.id === sitting.id && value !== undefined ? value : LEVERS[id].base;
}

/** Why `playerId` cannot set this lever to this value now, or null. */
export function decreeBlock(gov: GovScope, now: number, tier: TierId, playerId: string, lever: unknown, value: unknown): Block | null {
  const sitting = governorAt(gov, now, QUORUM[tier]);
  if (!sitting || sitting.id !== playerId) return no('not_in_office', 'Only the sitting officeholder can issue a decree. Win this week’s election first.');
  const rules = typeof lever === 'string' && Object.hasOwn(LEVERS, lever) ? LEVERS[lever as LeverId] : null;
  if (!rules || rules.tier !== tier) return no('unknown_lever', 'That lever does not belong to this office.');
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < rules.min || value > rules.max) return no('out_of_range', `${rules.label} can be set from ${rules.min} to ${rules.max}${rules.unit}.`);
  return null;
}

/** Record the decree. A new officeholder starts from a clean sheet: levers set in an earlier term are gone. */
export function setDecree(scope: PoliticsScopeRecord, gov: GovScope, now: number, who: PlayerRef, lever: LeverId, value: number): void {
  const sitting = governorAt(gov, now, QUORUM[LEVERS[lever].tier]);
  if (!sitting) throw new Error('not_in_office');
  const current = scope.decree;
  const values = current && current.week === sitting.week && current.by.id === sitting.id ? { ...current.values } : {};
  values[lever] = value;
  scope.decree = { week: sitting.week, by: { id: who.id, name: who.name }, at: now, values };
}

// ---- treasury ---------------------------------------------------------------------------------------

const note = (scope: PoliticsScopeRecord, line: LedgerLine): void => {
  scope.treasury.ledger.push(line);
  if (scope.treasury.ledger.length > LEDGER_KEEP) scope.treasury.ledger.splice(0, scope.treasury.ledger.length - LEDGER_KEEP);
};

/** Money into a treasury. Whole naira only: anything else is ignored. */
export function credit(scope: PoliticsScopeRecord, now: number, kind: LedgerLine['kind'], amount: number, text: string): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) return;
  scope.treasury.balance = Math.min(Number.MAX_SAFE_INTEGER, scope.treasury.balance + amount);
  note(scope, { at: now, kind, amount, note: text });
}

/** The salary the sitting officeholder may draw now: a share of the treasury, capped, once per term. 0 when none. */
export function salaryDue(scope: PoliticsScopeRecord, gov: GovScope, now: number, tier: TierId, playerId: string): number {
  const sitting = governorAt(gov, now, QUORUM[tier]);
  if (!sitting || sitting.id !== playerId || scope.drawn === sitting.week) return 0;
  return Math.min(Math.floor(scope.treasury.balance * SALARY_SHARE), SEATS[tier].salaryCap);
}

/** Why the officeholder cannot draw a salary, or null. */
export function salaryBlock(scope: PoliticsScopeRecord, gov: GovScope, now: number, tier: TierId, playerId: string): Block | null {
  const sitting = governorAt(gov, now, QUORUM[tier]);
  if (!sitting || sitting.id !== playerId) return no('not_in_office', 'Only the sitting officeholder draws the salary.');
  if (scope.drawn === sitting.week) return no('already_drawn', 'You have drawn this term’s salary.');
  return salaryDue(scope, gov, now, tier, playerId) > 0 ? null : no('treasury_empty', 'The treasury has nothing to pay a salary from yet.');
}

/** Take the salary out of the treasury and mark the term. Returns the amount. */
export function drawSalary(scope: PoliticsScopeRecord, gov: GovScope, now: number, tier: TierId, who: PlayerRef): number {
  const amount = salaryDue(scope, gov, now, tier, who.id), sitting = governorAt(gov, now, QUORUM[tier]);
  if (!sitting || amount <= 0) throw new Error('no_salary');
  scope.treasury.balance -= amount;
  scope.drawn = sitting.week;
  note(scope, { at: now, kind: 'salary', amount: -amount, note: `Salary drawn by ${who.name}` });
  return amount;
}

// ---- levies -----------------------------------------------------------------------------------------

export interface Levy { scopeId: string; lever: LeverId; percent: number; label: string }
/** What a levy of `percent` takes from `amount`: whole naira, rounded down, so a small price pays nothing. */
export const levyOn = (amount: number, percent: number): number => Math.floor(amount * percent / 100);
export const totalLevy = (amount: number, levies: readonly Levy[]): number => levies.reduce((sum, levy) => sum + levyOn(amount, levy.percent), 0);

// ---- parties ----------------------------------------------------------------------------------------

export const partyOf = (politics: PoliticsCollection, playerId: string): string | null => {
  const id = politics.members[playerId];
  return typeof id === 'string' && Object.hasOwn(politics.parties, id) ? id : null;
};
export const memberCount = (politics: PoliticsCollection, partyId: string): number => Object.values(politics.members).filter((id) => id === partyId).length;

/** Why `who` cannot found a party with this name, or null. The text is checked by the route. */
export function foundBlock(politics: PoliticsCollection, who: PlayerRef, name: string): Block | null {
  const taken = Object.values(politics.parties).some((party) => party.name.toLowerCase() === name.toLowerCase());
  if (taken) return no('name_taken', 'A party already has that name. Pick another.');
  if (Object.values(politics.parties).filter((party) => party.founder.id === who.id).length >= PARTY.perFounder) return no('founder_limit', 'You have already founded a party.');
  return null;
}

export function found(politics: PoliticsCollection, now: number, who: PlayerRef, name: string, motto: string, colour: string): string {
  const id = `p${(politics.seq += 1)}`;
  politics.parties[id] = { id, name, motto, colour, founder: { id: who.id, name: who.name }, at: now };
  politics.members[who.id] = id;
  return id;
}

export function joinBlock(politics: PoliticsCollection, playerId: string, partyId: unknown): Block | null {
  if (typeof partyId !== 'string' || !Object.hasOwn(politics.parties, partyId)) return no('unknown_party', 'That party does not exist.');
  return politics.members[playerId] === partyId ? no('already_member', 'You already belong to that party.') : null;
}
export const join = (politics: PoliticsCollection, playerId: string, partyId: string): void => { politics.members[playerId] = partyId; };
export const leave = (politics: PoliticsCollection, playerId: string): boolean => Object.hasOwn(politics.members, playerId) && delete politics.members[playerId];
