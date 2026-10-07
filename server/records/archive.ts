// OWNER: politics — writes each finished term into the public record, once. Nothing runs on a timer: a seat's ballots are read now and then
// (when a player passes through the city's civic pulse, files, votes or does anything in politics), and every term that has ended and is not
// in the record yet is written. The ballots are kept for eight weeks, so a term is always written long before its ballot goes.
import { QUORUM } from '../../src/game/content/politics.ts';
import type { TierId } from '../../src/types/politics.ts';
import { timeline, tally, votesIn, winnerOf } from '../civic/elections.ts';
import type { ElectionRecord, GovScope, PoliticsCollection } from '../types.ts';
import { append } from './store.ts';
import type { RecordsCollection } from './store.ts';

export interface SeatToArchive { tier: TierId; id: string; name: string; title: string; gov: GovScope }

const day = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** What happened in one finished election, as a sentence and as facts. */
function termOf(seat: SeatToArchive, week: number, election: ElectionRecord, politics: PoliticsCollection): { title: string; facts: Record<string, string | number | boolean | null> } {
  const quorum = QUORUM[seat.tier], standings = tally(election), winner = winnerOf(election, quorum), total = votesIn(election);
  const times = timeline(week), removed = typeof election.removedAt === 'number';
  const party = winner ? election.candidates[winner.id]?.party : undefined, partyName = party ? politics.parties[party]?.name ?? null : null;
  const base = { total, candidates: standings.length, quorum };
  if (winner) {
    const days = removed ? Math.max(0, Math.round(((election.removedAt ?? 0) - times.closesAt) / 86400000)) : 7;
    return {
      title: `${seat.title} ${winner.name}${partyName ? ` (${partyName})` : ' (independent)'} held ${seat.name} for the week of ${day(times.closesAt)}, elected with ${winner.votes} of ${total} votes.${removed ? ` Removed by petition after ${days} day${days === 1 ? '' : 's'}.` : ''}`,
      facts: { ...base, winnerId: winner.id, winner: winner.name, votes: winner.votes, party: partyName, void: false, removed },
    };
  }
  return {
    title: total ? `${seat.name} had no ${seat.title} for the week of ${day(times.closesAt)}: ${total} vote${total === 1 ? '' : 's'} cast and ${quorum} needed, so the election did not count.` : `Nobody voted for ${seat.title} of ${seat.name} for the week of ${day(times.closesAt)}.`,
    facts: { ...base, winnerId: null, winner: null, votes: 0, party: null, void: true, removed: false },
  };
}

/** Write every ended term of these seats that is not yet in the record. Returns how many were written. */
export function archiveTerms(records: RecordsCollection, politics: PoliticsCollection, seats: readonly SeatToArchive[], now: number): number {
  let written = 0;
  for (const seat of seats) {
    for (const [key, election] of Object.entries(seat.gov.gov.elections)) {
      const week = Number(key);
      if (!Number.isSafeInteger(week) || !election || (Object.keys(election.candidates ?? {}).length === 0 && votesIn(election) === 0)) continue;
      const index = `${seat.id}|${week}`;
      if (Object.hasOwn(records.terms, index) || now < timeline(week).termEndsAt) continue; // written already, or the term is still running
      const done = termOf(seat, week, election, politics);
      records.terms[index] = append(records, now, { kind: 'term', scope: seat.id, scopeName: seat.name, week, title: done.title, facts: done.facts }).n;
      written += 1;
    }
  }
  return written;
}

/** Whether any ended term of these seats is not in the record yet: a read, so the collection is not made for nothing. */
export function termsPending(records: RecordsCollection, seats: readonly SeatToArchive[], now: number): boolean {
  for (const seat of seats) {
    for (const [key, election] of Object.entries(seat.gov.gov.elections)) {
      const week = Number(key);
      if (!Number.isSafeInteger(week) || !election || (Object.keys(election.candidates ?? {}).length === 0 && votesIn(election) === 0)) continue;
      if (!Object.hasOwn(records.terms, `${seat.id}|${week}`) && now >= timeline(week).termEndsAt) return true;
    }
  }
  return false;
}
