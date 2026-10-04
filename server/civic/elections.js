// OWNER: civic — governor elections: the weekly cycle, the ballot, the tally and announcements.
// Portable and pure: every function takes the city's civic data and a time; nothing reads a clock.
//
// Original beta cycle (Lagos time; `week` is the Monday-started week index from clock.js):
//   Monday–Wednesday   nominations   candidates declare
//   Thursday–Saturday  voting        one vote per player, live tally
//   Sunday             results       polls closed; the winner's seven-day term begins at 00:00
// The winner is derived from the stored ballot every time, so nothing has to "run" at midnight.
import { lagosTime, lagosDayStart } from '../../src/game/clock.js';
import { ELECTION } from '../../src/game/content/civic.js';

const DAY_MS = 86400000;
const mondayOf = (week) => 7 * week - 3;

/** Key moments of one week's election, in server ms. */
export function timeline(week) {
  const monday = mondayOf(week);
  const closesAt = lagosDayStart(monday + 6);
  return { week, nominationsAt: lagosDayStart(monday), votingAt: lagosDayStart(monday + 3), closesAt, termEndsAt: closesAt + ELECTION.termDays * DAY_MS };
}

/** The phase at `now` and when it ends. */
export function phaseAt(now) {
  const time = lagosTime(now), times = timeline(time.week);
  if (now < times.votingAt) return { week: time.week, phase: 'nominations', endsAt: times.votingAt, ...times };
  if (now < times.closesAt) return { week: time.week, phase: 'voting', endsAt: times.closesAt, ...times };
  return { week: time.week, phase: 'results', endsAt: lagosDayStart(mondayOf(time.week + 1)), ...times };
}

const electionOf = (city, week) => city.gov.elections[week];

/**
 * Candidates with their vote counts, best first. Deterministic order: most votes, then the
 * earlier declaration, then the smaller public id — which is also the tie-break for the winner.
 */
export function tally(election) {
  const counts = {};
  for (const candidate of Object.values(election?.votes ?? {})) counts[candidate] = (counts[candidate] ?? 0) + 1;
  return Object.entries(election?.candidates ?? {})
    .map(([id, candidate]) => ({ id, name: candidate.name, slogan: candidate.slogan, at: candidate.at, votes: counts[id] ?? 0 }))
    .sort((a, b) => b.votes - a.votes || a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The winner of a finished ballot, or null when nobody stood or nobody voted. */
export function winnerOf(election) {
  const best = tally(election)[0];
  return best && best.votes > 0 ? best : null;
}

/** Result of the week's election once its polls have closed, else null. */
function resultOf(city, week, now) {
  const times = timeline(week);
  if (now < times.closesAt) return null;
  const election = electionOf(city, week);
  const standings = tally(election);
  const winner = winnerOf(election);
  return { week, closedAt: times.closesAt, termEndsAt: times.termEndsAt, candidates: standings.length, totalVotes: standings.reduce((sum, item) => sum + item.votes, 0),
    winner: winner ? { id: winner.id, name: winner.name, slogan: winner.slogan, votes: winner.votes } : null };
}

/** The sitting Governor at `now`, or null. A term runs from one Sunday 00:00 to the next. */
export function governorAt(city, now) {
  const week = Math.floor((lagosTime(now).day - 3) / 7);
  const result = resultOf(city, week, now);
  return result?.winner && now < result.termEndsAt ? { ...result.winner, week, termStartedAt: result.closedAt, termEndsAt: result.termEndsAt } : null;
}

/** Why `who` cannot be added to the ballot right now, or null. Wallet and age are checked by the rules engine. */
export function declareBlock(city, now, playerId) {
  const phase = phaseAt(now);
  const candidates = electionOf(city, phase.week)?.candidates ?? {};
  if (Object.hasOwn(candidates, playerId)) return { code: 'already_candidate', reason: 'You are already on this week’s ballot.' };
  if (phase.phase !== 'nominations') {
    return { code: 'nominations_closed', reason: phase.phase === 'voting' ? 'Nominations closed when voting opened on Thursday. They reopen on Monday, Lagos time.'
      : 'It is results day. Nominations for the next election open on Monday, Lagos time.' };
  }
  if (Object.keys(candidates).length >= ELECTION.maxCandidates) return { code: 'ballot_full', reason: `The ballot is full (${ELECTION.maxCandidates} candidates). Run again next week.` };
  return null;
}

export function declare(city, now, who, slogan) {
  const week = phaseAt(now).week;
  const election = city.gov.elections[week] ||= { candidates: {}, votes: {} };
  election.candidates[who.id] = { name: who.name, slogan, at: now };
  for (const key of Object.keys(city.gov.elections)) if (Number(key) <= week - ELECTION.keepElections) delete city.gov.elections[key];
}

/** Why `playerId` cannot vote for `candidateId` right now, or null. */
export function voteBlock(city, now, playerId, candidateId) {
  const phase = phaseAt(now);
  const election = electionOf(city, phase.week);
  if (election && Object.hasOwn(election.votes, playerId)) return { code: 'already_voted', reason: 'You have already voted in this election. Each player has one vote.' };
  if (phase.phase !== 'voting') {
    return { code: 'polls_closed', reason: phase.phase === 'nominations' ? 'Polls are not open yet. Voting runs Thursday to Saturday, Lagos time.'
      : 'Polls closed at midnight. The next vote opens on Thursday, Lagos time.' };
  }
  if (typeof candidateId !== 'string' || !election || !Object.hasOwn(election.candidates, candidateId)) return { code: 'unknown_candidate', reason: 'Choose a candidate from this week’s ballot.' };
  return null;
}

/**
 * `addressKey` (optional) is a pseudonymous key for the network address the vote came from; the
 * election keeps a count per key so the route can apply the per-address soft cap. Counts of
 * earlier elections are dropped here, so they live for one election only.
 */
export function vote(city, now, playerId, candidateId, addressKey = null) {
  const week = phaseAt(now).week, election = electionOf(city, week);
  election.votes[playerId] = candidateId;
  for (const [key, other] of Object.entries(city.gov.elections)) if (Number(key) !== week && other) { delete other.addr; delete other.capLogged; }
  if (typeof addressKey === 'string' && addressKey) {
    if (election.addr === null || typeof election.addr !== 'object' || Array.isArray(election.addr)) election.addr = {};
    election.addr[addressKey] = (Number.isSafeInteger(election.addr[addressKey]) ? election.addr[addressKey] : 0) + 1;
  }
}

/** Votes already counted from this address key in the current election. */
export function addressVotes(city, now, addressKey) {
  const count = electionOf(city, phaseAt(now).week)?.addr?.[addressKey];
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

/** True the first time it is asked for this key in the current election (so the audit trail gets one line, not one per attempt). */
export function firstCapNotice(city, now, addressKey) {
  const election = electionOf(city, phaseAt(now).week);
  if (!election) return false;
  if (election.capLogged === null || typeof election.capLogged !== 'object' || Array.isArray(election.capLogged)) election.capLogged = {};
  if (election.capLogged[addressKey]) return false;
  election.capLogged[addressKey] = true;
  return true;
}

/** Operator removal of one announcement. Returns it, or null. */
export function removeAnnouncement(city, id) {
  const index = city.gov.announcements.findIndex((item) => item.id === id);
  return index < 0 ? null : city.gov.announcements.splice(index, 1)[0];
}

/** Why the player cannot post a Governor's announcement right now, or null. */
export function announceBlock(city, now, playerId) {
  const governor = governorAt(city, now);
  if (governor?.id !== playerId) return { code: 'not_governor', reason: 'Only the sitting Governor can post an announcement. Win this week’s election first.' };
  const rules = ELECTION.announcement, day = lagosTime(now).day;
  const mine = city.gov.announcements.filter((item) => item.by.id === playerId);
  const last = mine.at(-1);
  if (last && now - last.at < rules.cooldownMs) return { code: 'announcement_cooldown', reason: `Wait ${Math.ceil((rules.cooldownMs - (now - last.at)) / 60000)} more minutes before the next announcement.` };
  if (mine.filter((item) => lagosTime(item.at).day === day).length >= rules.perDay) return { code: 'announcement_limit', reason: `A Governor may post ${rules.perDay} announcements a day. Post again after midnight, Lagos time.` };
  return null;
}

export function announce(city, now, who, text, id) {
  const governor = governorAt(city, now);
  city.gov.announcements.push({ id, by: { id: who.id, name: who.name }, text, at: now, term: governor.week });
  if (city.gov.announcements.length > ELECTION.announcement.keep) city.gov.announcements.splice(0, city.gov.announcements.length - ELECTION.announcement.keep);
}

const publicAnnouncement = (item) => ({ id: item.id, by: { id: item.by.id, name: item.by.name }, text: item.text, at: item.at });

/** Everything the Governor panel and the State House sheet show. `viewerId` may be null. */
export function govView(city, now, viewerId = null) {
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
    governor: governorAt(city, now),
    lastResult: resultOf(city, lastWeek, now),
    announcements: city.gov.announcements.slice().reverse().map(publicAnnouncement),
  };
}

/** Recent civic news for the notice surface, newest first: results, phase changes and announcements. */
export function notices(city, now, cityName = 'Lagos') {
  const phase = phaseAt(now), items = [];
  for (const week of [phase.week, phase.week - 1]) {
    const times = timeline(week), result = resultOf(city, week, now);
    if (result) {
      items.push({ id: `result-${week}`, kind: 'result', at: times.closesAt, title: result.winner ? `${result.winner.name} is the new Governor of ${cityName}` : `${cityName} has no Governor this week`,
        text: result.winner ? `Elected with ${result.winner.votes} of ${result.totalVotes} vote${result.totalVotes === 1 ? '' : 's'}.` : result.candidates ? 'Nobody voted, so nobody took office.' : 'Nobody stood for election.' });
    }
    if (now >= times.votingAt) items.push({ id: `voting-${week}`, kind: 'voting', at: times.votingAt, title: 'Polls are open', text: 'Voting for Governor runs until midnight on Saturday, Lagos time.' });
    if (now >= times.nominationsAt) items.push({ id: `nominations-${week}`, kind: 'nominations', at: times.nominationsAt, title: 'Nominations are open', text: 'Run for Governor before Thursday, Lagos time.' });
  }
  for (const item of city.gov.announcements) items.push({ id: `announcement-${item.id}`, kind: 'announcement', at: item.at, title: `Governor ${item.by.name} announced`, text: item.text });
  return items.filter((item) => item.at <= now && item.at > now - 8 * DAY_MS).sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1)).slice(0, 12);
}
