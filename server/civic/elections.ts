// OWNER: civic — governor elections: the weekly cycle, the ballot, the tally and announcements.
// Portable and pure: every function takes the city's civic data and a time; nothing reads a clock.
//
// Original beta cycle (Lagos time; `week` is the Monday-started week index from clock.js):
//   Monday–Wednesday   nominations   candidates declare
//   Thursday–Saturday  voting        one vote per player, live tally
//   Sunday             results       polls closed; the winner's seven-day term begins at 00:00
// The winner is derived from the stored ballot every time, so nothing has to "run" at midnight.
import { lagosTime, lagosDayStart } from '../../src/game/clock.ts';
import { ELECTION } from '../../src/game/content/civic.ts';
import { QUORUM } from '../../src/game/content/politics.ts';
import type { Announcement, CivicNotice, ElectionPhase, ElectionResult, Governor } from '../../src/types/civic.ts';
import type { PlayerRef } from '../../src/types/protocol.ts';
import type { ElectionRecord, GovScope } from '../types.ts';

type Block = { code: string; reason: string };
export interface Timeline { week: number; nominationsAt: number; votingAt: number; closesAt: number; termEndsAt: number }
export interface Standing { id: string; name: string; slogan: string; at: number; votes: number; party: string | null }

const DAY_MS = 86400000;
const mondayOf = (week: number): number => 7 * week - 3;

/** Key moments of one week's election, in server ms. */
export function timeline(week: number): Timeline {
  const monday = mondayOf(week);
  const closesAt = lagosDayStart(monday + 6);
  return { week, nominationsAt: lagosDayStart(monday), votingAt: lagosDayStart(monday + 3), closesAt, termEndsAt: closesAt + ELECTION.termDays * DAY_MS };
}

/** The phase at `now` and when it ends. */
export function phaseAt(now: number): Timeline & { phase: ElectionPhase; endsAt: number } {
  const time = lagosTime(now), times = timeline(time.week);
  if (now < times.votingAt) return { phase: 'nominations', endsAt: times.votingAt, ...times };
  if (now < times.closesAt) return { phase: 'voting', endsAt: times.closesAt, ...times };
  return { phase: 'results', endsAt: lagosDayStart(mondayOf(time.week + 1)), ...times };
}

const electionOf = (city: GovScope, week: number): ElectionRecord | undefined => city.gov.elections[week];

/**
 * Candidates with their vote counts, best first. Deterministic order: most votes, then the
 * earlier declaration, then the smaller public id — which is also the tie-break for the winner.
 */
export function tally(election: ElectionRecord | undefined): Standing[] {
  const counts: Record<string, number> = {};
  for (const candidate of Object.values(election?.votes ?? {})) counts[candidate] = (counts[candidate] ?? 0) + 1;
  return Object.entries(election?.candidates ?? {})
    .map(([id, candidate]) => ({ id, name: candidate.name, slogan: candidate.slogan, at: candidate.at, votes: counts[id] ?? 0, party: candidate.party ?? null }))
    .sort((a, b) => b.votes - a.votes || a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The votes cast in a ballot. */
export const votesIn = (election: ElectionRecord | undefined): number => Object.keys(election?.votes ?? {}).length;

/**
 * The winner of a finished ballot, or null when nobody stood, nobody voted or fewer than `quorum` voted: such an election is void
 * and the seat stays empty. The city seat's quorum is the default; a state's and the nation's are passed in.
 */
export function winnerOf(election: ElectionRecord | undefined, quorum: number = QUORUM.city): Standing | null {
  const best = tally(election)[0];
  return best && best.votes > 0 && votesIn(election) >= quorum ? best : null;
}

/** Result of the week's election once its polls have closed, else null. */
function resultOf(city: GovScope, week: number, now: number, quorum: number = QUORUM.city): ElectionResult | null {
  const times = timeline(week);
  if (now < times.closesAt) return null;
  const election = electionOf(city, week);
  const standings = tally(election);
  const winner = winnerOf(election, quorum);
  return { week, closedAt: times.closesAt, termEndsAt: times.termEndsAt, candidates: standings.length, totalVotes: standings.reduce((sum, item) => sum + item.votes, 0),
    winner: winner ? { id: winner.id, name: winner.name, slogan: winner.slogan, votes: winner.votes } : null };
}

/** The sitting Governor at `now`, or null (also null once an impeachment has removed them). A term runs from one Sunday 00:00 to the next. */
export function governorAt(city: GovScope, now: number, quorum: number = QUORUM.city): Governor | null {
  const week = Math.floor((lagosTime(now).day - 3) / 7);
  const result = resultOf(city, week, now, quorum), removedAt = electionOf(city, week)?.removedAt;
  if (removedAt !== undefined && now >= removedAt) return null; // impeached
  return result?.winner && now < result.termEndsAt ? { ...result.winner, week, termStartedAt: result.closedAt, termEndsAt: result.termEndsAt } : null;
}

/** Why `who` cannot be added to the ballot right now, or null. Wallet and age are checked by the rules engine. */
export function declareBlock(city: GovScope, now: number, playerId: string): Block | null {
  const phase = phaseAt(now);
  const candidates = electionOf(city, phase.week)?.candidates ?? {};
  if (Object.hasOwn(candidates, playerId)) return { code: 'already_candidate', reason: 'You are already on this week’s ballot.' };
  if (phase.phase !== 'nominations') {
    return { code: 'nominations_closed', reason: phase.phase === 'voting' ? 'Nominations closed when voting opened on Thursday. They reopen on Monday, Nigerian time.'
      : 'It is results day. Nominations for the next election open on Monday, Nigerian time.' };
  }
  if (Object.keys(candidates).length >= ELECTION.maxCandidates) return { code: 'ballot_full', reason: `The ballot is full (${ELECTION.maxCandidates} candidates). Run again next week.` };
  return null;
}

export function declare(city: GovScope, now: number, who: PlayerRef, slogan: string, party: string | null = null): void {
  const week = phaseAt(now).week;
  const election = city.gov.elections[week] ||= { candidates: {}, votes: {} };
  election.candidates[who.id] = { name: who.name, slogan, at: now, ...(party ? { party } : {}) };
  for (const key of Object.keys(city.gov.elections)) if (Number(key) <= week - ELECTION.keepElections) delete city.gov.elections[key];
}

/** Why `playerId` cannot vote for `candidateId` right now, or null. */
export function voteBlock(city: GovScope, now: number, playerId: string, candidateId: unknown): Block | null {
  const phase = phaseAt(now);
  const election = electionOf(city, phase.week);
  if (election && Object.hasOwn(election.votes, playerId)) return { code: 'already_voted', reason: 'You have already voted in this election. Each player has one vote.' };
  if (phase.phase !== 'voting') {
    return { code: 'polls_closed', reason: phase.phase === 'nominations' ? 'Polls are not open yet. Voting runs Thursday to Saturday, Nigerian time.'
      : 'Polls closed at midnight. The next vote opens on Thursday, Nigerian time.' };
  }
  if (typeof candidateId !== 'string' || !election || !Object.hasOwn(election.candidates, candidateId)) return { code: 'unknown_candidate', reason: 'Choose a candidate from this week’s ballot.' };
  return null;
}

/**
 * `addressKey` (optional) is a pseudonymous key for the network address the vote came from; the
 * election keeps a count per key so the route can apply the per-address soft cap. Counts of
 * earlier elections are dropped here, so they live for one election only.
 */
export function vote(city: GovScope, now: number, playerId: string, candidateId: string, addressKey: string | null = null): void {
  const week = phaseAt(now).week, election = electionOf(city, week);
  if (!election) throw new Error('no_election');
  election.votes[playerId] = candidateId;
  for (const [key, other] of Object.entries(city.gov.elections)) if (Number(key) !== week && other) { delete other.addr; delete other.capLogged; }
  if (typeof addressKey === 'string' && addressKey) {
    if (election.addr === null || typeof election.addr !== 'object' || Array.isArray(election.addr)) election.addr = {};
    const previous = election.addr[addressKey];
    election.addr[addressKey] = (previous !== undefined && Number.isSafeInteger(previous) ? previous : 0) + 1;
  }
}

/** Votes already counted from this address key in the current election. */
export function addressVotes(city: GovScope, now: number, addressKey: string): number {
  const count = electionOf(city, phaseAt(now).week)?.addr?.[addressKey];
  return count !== undefined && Number.isSafeInteger(count) && count > 0 ? count : 0;
}

/** True the first time it is asked for this key in the current election (so the audit trail gets one line, not one per attempt). */
export function firstCapNotice(city: GovScope, now: number, addressKey: string): boolean {
  const election = electionOf(city, phaseAt(now).week);
  if (!election) return false;
  if (election.capLogged === null || typeof election.capLogged !== 'object' || Array.isArray(election.capLogged)) election.capLogged = {};
  if (election.capLogged[addressKey]) return false;
  election.capLogged[addressKey] = true;
  return true;
}

/** Operator removal of one announcement. Returns it, or null. */
export function removeAnnouncement(city: GovScope, id: string) {
  const index = city.gov.announcements.findIndex((item) => item.id === id);
  return index < 0 ? null : city.gov.announcements.splice(index, 1)[0] ?? null;
}

/** Why the player cannot post a Governor's announcement right now, or null. */
export function announceBlock(city: GovScope, now: number, playerId: string, title = 'Chairman', quorum: number = QUORUM.city): Block | null {
  const governor = governorAt(city, now, quorum);
  if (governor?.id !== playerId) return { code: 'not_governor', reason: `Only the sitting ${title} can post an announcement. Win this week’s election first.` };
  const rules = ELECTION.announcement, day = lagosTime(now).day;
  const mine = city.gov.announcements.filter((item) => item.by.id === playerId);
  const last = mine.at(-1);
  if (last && now - last.at < rules.cooldownMs) return { code: 'announcement_cooldown', reason: `Wait ${Math.ceil((rules.cooldownMs - (now - last.at)) / 60000)} more minutes before the next announcement.` };
  if (mine.filter((item) => lagosTime(item.at).day === day).length >= rules.perDay) return { code: 'announcement_limit', reason: `A ${title} may post ${rules.perDay} announcements a day. Post again after midnight, Nigerian time.` };
  return null;
}

export function announce(city: GovScope, now: number, who: PlayerRef, text: string, id: string, quorum: number = QUORUM.city): void {
  const governor = governorAt(city, now, quorum);
  if (!governor) throw new Error('not_governor');
  city.gov.announcements.push({ id, by: { id: who.id, name: who.name }, text, at: now, term: governor.week });
  if (city.gov.announcements.length > ELECTION.announcement.keep) city.gov.announcements.splice(0, city.gov.announcements.length - ELECTION.announcement.keep);
}

const publicAnnouncement = (item: GovScope['gov']['announcements'][number]): Announcement => ({ id: item.id, by: { id: item.by.id, name: item.by.name }, text: item.text, at: item.at });

/** Everything the Governor panel and the State House sheet show. `viewerId` may be null. */
export function govView(city: GovScope, now: number, viewerId: string | null = null, quorum: number = QUORUM.city) {
  const phase = phaseAt(now);
  const election = electionOf(city, phase.week);
  const standings = tally(election);
  // During nominations nobody has voted; list candidates in the order they declared.
  const candidates = (phase.phase === 'nominations' ? [...standings].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1)) : standings)
    .map((item) => ({ id: item.id, name: item.name, slogan: item.slogan, votes: item.votes, you: item.id === viewerId }));
  const lastWeek = phase.phase === 'results' ? phase.week : phase.week - 1;
  return {
    phase: phase.phase, phaseEndsAt: phase.endsAt,
    election: { week: phase.week, nominationsAt: phase.nominationsAt, votingAt: phase.votingAt, closesAt: phase.closesAt, candidates,
      totalVotes: standings.reduce((sum, item) => sum + item.votes, 0), yourVote: viewerId ? election?.votes?.[viewerId] ?? null : null },
    governor: governorAt(city, now, quorum),
    lastResult: resultOf(city, lastWeek, now, quorum),
    announcements: city.gov.announcements.slice().reverse().map(publicAnnouncement),
  };
}

/** Recent civic news for the notice surface, newest first: results, phase changes and announcements. */
export function notices(city: GovScope, now: number, cityName = 'Lagos', openedAt = 0, title = 'Chairman', idPrefix = '', quorum: number = QUORUM.city): CivicNotice[] {
  const phase = phaseAt(now), items: CivicNotice[] = [];
  for (const week of [phase.week, phase.week - 1]) {
    const before = items.length;
    const times = timeline(week), result = resultOf(city, week, now, quorum);
    if (result) {
      items.push({ id: `${idPrefix}result-${week}`, kind: 'result', at: times.closesAt, title: result.winner ? `${result.winner.name} is the new ${title} of ${cityName}` : `${cityName} has no ${title} this week`,
        text: result.winner ? `Elected with ${result.winner.votes} of ${result.totalVotes} vote${result.totalVotes === 1 ? '' : 's'}.` : result.totalVotes ? `Only ${result.totalVotes} vote${result.totalVotes === 1 ? ' was' : 's were'} cast and the election needs ${quorum}, so it does not count and the seat stays empty.` : result.candidates ? 'Nobody voted, so nobody took office.' : 'Nobody stood for election.' });
    }
    if (now >= times.votingAt) items.push({ id: `${idPrefix}voting-${week}`, kind: 'voting', at: times.votingAt, title: 'Polls are open', text: `Voting for ${title} runs until midnight on Saturday, Nigerian time.` });
    if (now >= times.nominationsAt) items.push({ id: `${idPrefix}nominations-${week}`, kind: 'nominations', at: times.nominationsAt, title: 'Nominations are open', text: `Run for ${title} before Thursday, Nigerian time.` });
    // Nothing is dated before the city opened: a notice of the week in progress starts at the opening, an earlier week's is left out.
    for (let i = items.length - 1; i >= before; i--) if (items[i]!.at < openedAt) { if (week === phase.week) items[i]!.at = openedAt; else items.splice(i, 1); }
  }
  for (const item of city.gov.announcements) items.push({ id: `${idPrefix}announcement-${item.id}`, kind: 'announcement', at: item.at, title: `${title} ${item.by.name} announced`, text: item.text });
  return items.filter((item) => item.at <= now && item.at > now - 8 * DAY_MS).sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1)).slice(0, 12);
}
