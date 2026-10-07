// OWNER: politics — the assemblies: who sits, how a bill is proposed, voted on, signed or vetoed, and when it becomes law. Pure over the stored
// record: every function takes a time, nothing reads a clock. Design: docs/POLITICS.md section 3.
import { ASSEMBLY, LEVERS, QUORUM } from '../../src/game/content/politics.ts';
import type { BillRecord, LeverId, TierId } from '../../src/types/politics.ts';
import type { PlayerRef } from '../../src/types/protocol.ts';
import { governorAt, tally, timeline, winnerOf } from '../civic/elections.ts';
import type { GovScope, PoliticsScopeRecord } from '../types.ts';
import { termOf } from './rules.ts';

type Block = { code: string; reason: string };
const no = (code: string, reason: string): Block => ({ code, reason });

export interface Assembly {
  week: number
  /** The seat's officeholder, or null when removed or the election did not count. */
  executive: PlayerRef | null
  members: PlayerRef[]
}

/**
 * The assembly of the term `now` falls in: the runners-up of the seat's election, best first, each with at least one vote, up to the seat's
 * size. None until the polls have closed, none when the election did not reach its quorum. It stands for the whole term, even if the
 * officeholder is removed.
 */
export function assemblyOf(gov: GovScope, now: number, tier: TierId): Assembly {
  const week = termOf(now), election = gov.gov.elections[week], times = timeline(week);
  const none: Assembly = { week, executive: null, members: [] };
  if (!election || now < times.closesAt || now >= times.termEndsAt) return none;
  const winner = winnerOf(election, QUORUM[tier]);
  if (!winner) return none;
  const sitting = governorAt(gov, now, QUORUM[tier]);
  return { week, executive: sitting ? { id: sitting.id, name: sitting.name } : null,
    members: tally(election).filter((standing) => standing.id !== winner.id && standing.votes >= 1).slice(0, ASSEMBLY.seats[tier]).map((standing) => ({ id: standing.id, name: standing.name })) };
}

/** Votes a bill needs to pass by a majority of the whole assembly. */
export const majority = (size: number): number => Math.floor(size / 2) + 1;
/** Votes that pass a member's bill with no signature: two thirds of the assembly, and never fewer than two members. */
export const supermajority = (size: number): number => Math.max(ASSEMBLY.minSupermajority, Math.ceil(size * ASSEMBLY.supermajority));

export const count = (bill: Pick<BillRecord, 'votes'>): { yes: number; no: number } => {
  const votes = Object.values(bill.votes);
  return { yes: votes.filter(Boolean).length, no: votes.filter((vote) => !vote).length };
};
/** Votes the bill needs now, by the road it is on. */
export const needed = (bill: Pick<BillRecord, 'byOffice' | 'signed'>, size: number): number => (bill.byOffice || bill.signed ? majority(size) : supermajority(size));

/** The bills of the term in progress (a new term has none). */
export const billsOf = (scope: PoliticsScopeRecord, now: number): BillRecord[] => (scope.bills?.week === termOf(now) ? scope.bills.items : []);

/** Why `playerId` cannot propose this change now, or null. Whether the lever is in range is `leverBlock`. */
export function proposeBlock(scope: PoliticsScopeRecord, assembly: Assembly, now: number, playerId: string): Block | null {
  if (!assembly.members.length) return no('no_assembly', 'This seat has no assembly this term, so its officeholder decrees directly.');
  if (assembly.executive?.id !== playerId && !assembly.members.some((member) => member.id === playerId)) return no('not_a_legislator', 'Only the officeholder or a member of the assembly can propose a bill.');
  const bills = billsOf(scope, now);
  if (bills.length >= ASSEMBLY.billsPerTerm) return no('bill_limit', `A term allows ${ASSEMBLY.billsPerTerm} bills.`);
  return null;
}

/** Why `value` is not a value `lever` can take at this seat, or null. */
export function leverBlock(tier: TierId, lever: unknown, value: unknown): Block | null {
  const rules = typeof lever === 'string' && Object.hasOwn(LEVERS, lever) ? LEVERS[lever as LeverId] : null;
  if (!rules || rules.tier !== tier) return no('unknown_lever', 'That lever does not belong to this office.');
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < rules.min || value > rules.max) return no('out_of_range', `${rules.label} can be set from ${rules.min} to ${rules.max}${rules.unit === '%' ? '%' : rules.unit === 'min' ? ' minutes' : ' naira'}.`);
  return null;
}

/** Put a bill on the table. The proposer does not vote by proposing: they vote like anyone else. */
export function propose(scope: PoliticsScopeRecord, assembly: Assembly, now: number, who: PlayerRef, lever: LeverId, value: number): BillRecord {
  const week = termOf(now);
  if (scope.bills?.week !== week) scope.bills = { week, seq: 0, items: [] };
  scope.bills.seq += 1;
  const bill: BillRecord = { id: `b${scope.bills.seq}`, lever, value, by: { id: who.id, name: who.name }, byOffice: assembly.executive?.id === who.id, at: now, votes: {}, signed: false, status: 'open' };
  // A newer bill on the same lever replaces an open one: only the latest proposal is voted on.
  for (const other of scope.bills.items) if (other.status === 'open' && other.lever === lever) other.status = 'failed';
  scope.bills.items.push(bill);
  return bill;
}

/** Why `playerId` cannot vote on this bill, or null. */
export function voteBlock(bill: BillRecord | undefined, assembly: Assembly, playerId: string): Block | null {
  if (!bill || bill.status !== 'open') return no('no_such_bill', 'That bill is not before the assembly.');
  if (!assembly.members.some((member) => member.id === playerId)) return no('not_a_member', 'Only a member of the assembly votes on a bill.');
  if (Object.hasOwn(bill.votes, playerId)) return no('already_voted', 'You have already voted on this bill.');
  return null;
}

/** Why `playerId` cannot sign or veto this bill, or null. Only the officeholder, and only a member's bill: their own needs no signature. */
export function signBlock(bill: BillRecord | undefined, assembly: Assembly, playerId: string): Block | null {
  if (!bill || bill.status !== 'open') return no('no_such_bill', 'That bill is not before the assembly.');
  if (assembly.executive?.id !== playerId) return no('not_in_office', 'Only the sitting officeholder can sign or veto a bill.');
  if (bill.byOffice) return no('own_bill', 'You proposed this bill yourself: it needs the assembly’s majority, not your signature.');
  if (bill.signed) return no('already_signed', 'You have already signed this bill.');
  return null;
}

/** Decide where a bill stands. Returns the new status (and how it passed) when it has just been decided, else null. */
export function settle(bill: BillRecord, size: number): { status: 'passed' | 'failed'; via: NonNullable<BillRecord['via']> | null } | null {
  if (bill.status !== 'open') return null;
  const { yes, no: against } = count(bill);
  if (bill.byOffice) {
    if (yes >= majority(size)) return { status: 'passed', via: 'majority' };
  } else {
    if (yes >= supermajority(size)) return { status: 'passed', via: 'supermajority' };
    if (bill.signed && yes >= majority(size)) return { status: 'passed', via: 'signature' };
  }
  // It cannot pass any more once even every vote still to come would not reach a majority.
  return size - against < majority(size) ? { status: 'failed', via: null } : null;
}

/** Record a vote and settle. Returns the bill's new status when this vote decided it. */
export function castVote(bill: BillRecord, size: number, playerId: string, yes: boolean): ReturnType<typeof settle> {
  bill.votes[playerId] = yes;
  return apply(bill, size);
}
/** The officeholder signs (so a majority passes it) or vetoes (it is dead). */
export function signOrVeto(bill: BillRecord, size: number, sign: boolean): ReturnType<typeof settle> {
  if (!sign) { bill.status = 'vetoed'; return { status: 'failed', via: null }; }
  bill.signed = true;
  return apply(bill, size);
}
function apply(bill: BillRecord, size: number): ReturnType<typeof settle> {
  const decided = settle(bill, size);
  if (decided) { bill.status = decided.status; if (decided.via) bill.via = decided.via; }
  return decided;
}

/** A passed bill becomes law for the rest of the term. */
export function enact(scope: PoliticsScopeRecord, now: number, bill: BillRecord): void {
  const week = termOf(now);
  if (scope.laws?.week !== week) scope.laws = { week, values: {} };
  scope.laws.values[bill.lever] = bill.value;
}
