// OWNER: politics — decrees, treasuries and parties. Pure over the stored record: every function takes a time, nothing reads a clock.
// Design: docs/POLITICS.md. The limits are the constitution, src/game/content/politics.ts.
import { lagosTime } from '../../src/game/clock.ts';
import { AUDIT, GRANTS, IMPEACH, LEDGER_KEEP, LEVERS, PARTY, QUORUM, SALARY_SHARE, SEATS } from '../../src/game/content/politics.ts';
import type { AuditFlag, TermAudit, LeverId, LedgerLine, TermAccounts, TierId } from '../../src/types/politics.ts';
import type { PlayerRef } from '../../src/types/protocol.ts';
import type { GovScope, PoliticsCollection, PoliticsScopeRecord } from '../types.ts';
import { governorAt } from '../civic/elections.ts';

type Block = { code: string; reason: string };
const no = (code: string, reason: string): Block => ({ code, reason });

// ---- decrees ----------------------------------------------------------------------------------------

/** The value of a lever now: the sitting officeholder's decree, else the base. A decree lapses with the term it was made in. */
export function leverValue(scope: PoliticsScopeRecord, gov: GovScope, now: number, id: LeverId): number {
  const law = scope.laws?.week === termOf(now) ? scope.laws.values[id] : undefined; // a law of the assembly holds for its term, whoever sits
  if (law !== undefined) return law;
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

/** The term `now` falls in: the week of the election that seats the officeholder (the same index governorAt uses). */
export const termOf = (now: number): number => Math.floor((lagosTime(now).day - 3) / 7);
/** This term's accounts, started again when a new term begins. */
export function termAccounts(scope: PoliticsScopeRecord, now: number): TermAccounts {
  const week = termOf(now);
  if (!scope.term || scope.term.week !== week) scope.term = { week, income: 0, salary: 0, granted: 0 };
  return scope.term;
}

/** Money into a treasury. Whole naira only: anything else is ignored. */
export function credit(scope: PoliticsScopeRecord, now: number, kind: LedgerLine['kind'], amount: number, text: string): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) return;
  scope.treasury.balance = Math.min(Number.MAX_SAFE_INTEGER, scope.treasury.balance + amount);
  termAccounts(scope, now).income += amount;
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
  termAccounts(scope, now).salary += amount;
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

// ---- grants ------------------------------------------------------------------------------------------

/** The most the officeholder may pay out in one grant now: a share of the treasury, never more than the seat's salary cap. */
export const grantRoom = (scope: PoliticsScopeRecord, tier: TierId): number => Math.min(Math.floor(scope.treasury.balance * GRANTS.maxShare), SEATS[tier].salaryCap);

/** Why the officeholder cannot pay this grant now, or null. Who the recipient is and whether they live here is the route's to check. */
export function grantBlock(scope: PoliticsScopeRecord, gov: GovScope, now: number, tier: TierId, playerId: string, toId: string, amount: unknown): Block | null {
  const sitting = governorAt(gov, now, QUORUM[tier]);
  if (!sitting || sitting.id !== playerId) return no('not_in_office', 'Only the sitting officeholder can pay a grant.');
  if (toId === playerId) return no('self', 'You cannot pay a grant to yourself.');
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1) return no('invalid_amount', 'A grant is a whole number of naira.');
  const given = scope.grants?.week === sitting.week ? scope.grants.items : [];
  if (given.length >= GRANTS.perTerm) return no('grant_limit', `A term allows ${GRANTS.perTerm} grants.`);
  if (given.some((grant) => grant.to.id === toId)) return no('already_granted', 'That player has already had a grant this term.');
  const room = grantRoom(scope, tier);
  if (amount > room) return no('over_limit', room > 0 ? `A grant can be at most ${room.toLocaleString('en-NG')} naira now: ${Math.round(GRANTS.maxShare * 100)}% of the treasury, and never above the seat’s limit.` : 'The treasury has nothing to give.');
  return null;
}

/** Take the grant out of the treasury and put it on the record. */
export function payGrant(scope: PoliticsScopeRecord, gov: GovScope, now: number, tier: TierId, to: PlayerRef, amount: number, purpose: string, party: string | null): void {
  const sitting = governorAt(gov, now, QUORUM[tier]);
  if (!sitting) throw new Error('not_in_office');
  if (scope.grants?.week !== sitting.week) scope.grants = { week: sitting.week, items: [] };
  scope.treasury.balance -= amount;
  termAccounts(scope, now).granted += amount;
  scope.grants.items.push({ to: { id: to.id, name: to.name }, amount, purpose, at: now, party });
  note(scope, { at: now, kind: 'grant', amount: -amount, note: `Grant to ${to.name}: ${purpose}` });
}

// ---- audits ------------------------------------------------------------------------------------------

/** The warnings the numbers of a term give rise to. `ownParty` is the officeholder's party at the time. */
export function auditFlags(accounts: Pick<TermAccounts, 'income' | 'salary' | 'granted'>, grants: readonly { to: { id: string }; amount: number; party: string | null }[], ownParty: string | null): AuditFlag[] {
  const flags: AuditFlag[] = [];
  const total = grants.reduce((sum, grant) => sum + grant.amount, 0);
  if (grants.length >= AUDIT.minGrants && total > 0) {
    if (Math.max(...grants.map((grant) => grant.amount)) / total > AUDIT.concentration) flags.push('concentration');
    if (ownParty && grants.filter((grant) => grant.party === ownParty).reduce((sum, grant) => sum + grant.amount, 0) / total > AUDIT.partyFavour) flags.push('party_favour');
  }
  if (accounts.income >= AUDIT.minIncome && (accounts.salary + accounts.granted) / accounts.income > AUDIT.drained) flags.push('drained');
  return flags;
}

/** Why an audit of this seat cannot be run now, or null. */
export function auditBlock(scope: PoliticsScopeRecord, gov: GovScope, now: number, tier: TierId): Block | null {
  if (!governorAt(gov, now, QUORUM[tier])) return no('empty_seat', 'Nobody holds this seat, so there is nothing to audit.');
  const last = scope.audit?.at;
  return last !== undefined && now - last < AUDIT.cooldownMs ? no('audit_cooldown', `This seat was audited ${Math.max(1, Math.round((now - last) / 60000))} minutes ago. The report below is the latest.`) : null;
}

/** Run the audit of the sitting term and keep it. */
export function runAudit(scope: PoliticsScopeRecord, gov: GovScope, now: number, tier: TierId, by: PlayerRef, ownParty: string | null): TermAudit {
  const sitting = governorAt(gov, now, QUORUM[tier]);
  if (!sitting) throw new Error('empty_seat');
  const accounts = termAccounts(scope, now), grants = scope.grants?.week === sitting.week ? scope.grants.items : [];
  scope.audit = { week: sitting.week, at: now, by: { id: by.id, name: by.name }, income: accounts.income, salary: accounts.salary, granted: accounts.granted, grants: grants.length, flags: auditFlags(accounts, grants, ownParty) };
  return scope.audit;
}

// ---- impeachment -------------------------------------------------------------------------------------

/** Signatures needed to remove the sitting officeholder: more than half of the votes they won, and never fewer than the seat's quorum. */
export const signaturesNeeded = (tier: TierId, votesWon: number): number => Math.max(QUORUM[tier], Math.floor(votesWon / 2) + 1);

/** Why `playerId` cannot sign the petition against the sitting officeholder, or null. Where they live and how long is the route's to check. */
export function impeachBlock(scope: PoliticsScopeRecord, gov: GovScope, now: number, tier: TierId, playerId: string): Block | null {
  const sitting = governorAt(gov, now, QUORUM[tier]);
  if (!sitting) return no('empty_seat', 'Nobody holds this seat.');
  if (sitting.id === playerId) return no('self', 'You cannot petition against yourself.');
  if (scope.audit?.week !== sitting.week || !scope.audit.flags.length) return no('no_grounds', 'An impeachment needs an audit of this term that found something. Ask for an audit first.');
  if (scope.petition?.week === sitting.week && Object.hasOwn(scope.petition.signers, playerId)) return no('already_signed', 'You have already signed.');
  return null;
}

/** Add a signature. Returns how many there are now and how many are needed; when enough, the officeholder is removed and `removed` is true. */
export function signPetition(scope: PoliticsScopeRecord, gov: GovScope, now: number, tier: TierId, playerId: string, week: number): { signed: number; needed: number; removed: boolean } {
  const sitting = governorAt(gov, now, QUORUM[tier]);
  if (!sitting) throw new Error('empty_seat');
  if (scope.petition?.week !== week) scope.petition = { week, signers: {} };
  scope.petition.signers[playerId] = now;
  const signed = Object.keys(scope.petition.signers).length, needed = signaturesNeeded(tier, sitting.votes);
  const election = gov.gov.elections[week];
  const removed = signed >= needed && !!election;
  if (removed && election) election.removedAt = now;
  return { signed, needed, removed };
}

export const impeachRules = IMPEACH;
