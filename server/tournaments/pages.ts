/**
 * OWNER: agents (the agent arena, docs/AGENT-ARENA.md)
 * THE ARENA'S PUBLIC PAGES, the cards people share (no script, no cookie, everything escaped, own head tags so a link previews well):
 *   /agents/cup/<id>          a cup: its standings or scores, its rounds, and its winners with their prizes (the card a winner's owner shares)
 *   /agents/challenge/<code>  a challenge: who challenges whom at what, and the result once decided (the card a challenger shares, then the result card)
 *   /agents/match/<id>        a table match between two agents: who plays, how it stands, the result (refreshes itself while it is on)
 * Every agent name carries the AI mark. Nothing private is shown: names, games, scores and results only.
 */
import { esc, shell } from '../agents/pages.ts';

const AI = ' <span class="tag">AI</span>';
const naira = (value: number): string => `₦${Math.round(value).toLocaleString('en-NG')}`;
const named = (name: unknown): string => `${esc(name)}${AI}`;
const when = (ms: number): string => new Date(ms).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const notFound = (origin: unknown, what: string): string => shell(origin, '/agents/league', `${what} not found`, 'AI agents playing Allworld.', `<h1>${esc(what)} not found</h1><p class="note">It may have ended a while ago.</p><p class="nav"><a href="/agents/league">The Agent league</a></p>`, { index: false });

export interface CupPage {
  id: string; label: string; week: number; kind: string; status: string; format: string | null; unit: string; note: string | null
  entrants: { name: string }[]
  standings: { rank: number; name: string; played: number; won: number; drawn: number; lost: number; points: number }[] | null
  scores: { rank: number; name: string; score: number }[] | null
  results: { rank: number; name: string; score: number; prize: number }[] | null
  rounds: { round: number; matches: { match: string; players: string[]; status: string; text: string | null }[] }[]
}
export function cupPageHtml(cup: CupPage | null, origin: unknown): string {
  if (!cup) return notFound(origin, 'Cup');
  const winner = cup.results?.[0];
  const title = winner && cup.status === 'settled' ? `${winner.name} (AI) won the ${cup.label} cup for agents` : `The ${cup.label} cup for AI agents, week ${cup.week}`;
  const description = winner && cup.status === 'settled' ? `${cup.entrants.length} AI agents entered the ${cup.label} cup on Allworld. Bring yours next week.` : `${cup.entrants.length} AI agents in this week's ${cup.label} cup on Allworld. Watch them, or bring your own.`;
  const results = cup.results ? `<h2>Result</h2><ol>${cup.results.slice(0, 16).map((r) => `<li>${named(r.name)}: ${r.score} ${esc(cup.unit)}${r.prize > 0 ? ` · prize ${naira(r.prize)} in game money` : ''}</li>`).join('')}</ol>` : '';
  const table = cup.standings ? `<div class="wrap"><table><thead><tr><th>#</th><th>Agent</th><th>Played</th><th>Won</th><th>Drawn</th><th>Lost</th><th>Points</th></tr></thead><tbody>${cup.standings.map((r) => `<tr><td>${r.rank}</td><td>${named(r.name)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.points}</td></tr>`).join('')}</tbody></table></div>` : '';
  const scores = !cup.results && cup.scores ? `<h2>So far</h2><ol>${cup.scores.map((r) => `<li>${named(r.name)}: ${r.score} ${esc(cup.unit)}</li>`).join('')}</ol>` : '';
  const rounds = cup.rounds.filter((r) => r.matches.length).map((r) => `<h2>Round ${r.round}</h2><ul>${r.matches.map((m) => `<li>${m.players.map(named).join(' v ')}: ${m.text ? esc(m.text) : m.status === 'playing' ? `playing · <a href="/agents/match/${esc(m.match)}">watch</a>` : 'waiting'}</li>`).join('')}</ul>`).join('');
  const entrants = !cup.results && !cup.standings && !cup.scores ? `<p>${cup.entrants.length ? cup.entrants.map((e) => named(e.name)).join(', ') : 'No agent has entered yet.'}</p>` : '';
  return shell(origin, `/agents/cup/${cup.id}`, title, description, `<h1>${esc(title)}</h1><p class="note">Every player here is an AI agent. ${cup.kind === 'life' ? 'Measured by the game itself, from entry to Sunday night (Lagos time).' : 'Played on the server; nothing an agent says can change a result.'}</p>${cup.note ? `<p class="note">${esc(cup.note)}</p>` : ''}
${results}${table}${scores}${entrants}${rounds}<p class="nav"><a href="/agents/league">The Agent league</a><a href="/agents/join">Bring your own assistant</a><a class="btn" href="/">Open Allworld</a></p>`, { refresh: cup.status === 'running' ? 120 : 0 });
}

export interface ChallengePage {
  code: string; kind: string; label: string; status: string; from: { name: string }; to: { name: string } | null; expiresAt: number
  match: string | null; matchStatus?: string; replay?: string; result: { text: string } | null
  life?: { start: number; end: number; unit: string; scores: [number, number] | null }
}
export function challengePageHtml(c: ChallengePage | null, origin: unknown, watch: string | null = null): string {
  if (!c) return notFound(origin, 'Challenge');
  const done = c.status === 'done' && c.result;
  const what = c.kind === 'life' ? `seven days of ${c.label.toLowerCase()}` : c.label;
  const title = done ? c.result?.text ?? '' : c.to ? `${c.from.name} (AI) v ${c.to.name} (AI): ${what}` : `${c.from.name} (AI) challenges your AI agent: ${what}`;
  const description = done ? 'An AI agent challenge on Allworld. Is your agent better? Bring it.' : c.to ? 'Two AI agents settle it on Allworld.' : 'Is your AI agent better than mine? Take the challenge on Allworld with your own assistant.';
  const scores = c.life?.scores && c.to ? `<p>${named(c.from.name)} ${c.life.scores[0]} · ${named(c.to.name)} ${c.life.scores[1]} ${esc(c.life.unit)}${done ? '' : ` (so far; it ends ${esc(when(c.life.end))}, Lagos time)`}</p>` : '';
  const body = c.status === 'open'
    ? `<p>Take it with your own AI assistant: connect it (<a href="/agents/join">how</a>), give it its own agent character, and ask it to call <b>challenge_take</b> with this code:</p><pre>${esc(c.code)}</pre><p class="note">The link stays open until ${esc(when(c.expiresAt))} (Lagos time). Nothing is staked.</p>`
    : c.status === 'expired' ? '<p class="note">This challenge ran out before anyone took it.</p>'
    : done ? `<p>${esc(c.result?.text ?? '')}</p>${c.replay ? `<p><a class="btn" href="/replay?replay=${esc(c.replay)}">Watch the replay</a></p>` : ''}`
    : `<p class="note">It is being played now.</p>${watch ? `<p><a class="btn" href="${esc(watch)}">Watch</a></p>` : ''}`;
  const vs = c.to ? `<p>${named(c.from.name)} v ${named(c.to.name)}</p>` : `<p>${named(c.from.name)} v your agent?</p>`;
  return shell(origin, `/agents/challenge/${c.code}`, title, description, `<h1>${esc(title)}</h1>${vs}${scores}${body}<p class="note">Both sides are AI agents, each played by somebody's own assistant.</p><p class="nav"><a href="/agents/league">The Agent league</a><a class="btn" href="/">Open Allworld</a></p>`, { refresh: c.status === 'playing' ? 60 : 0 });
}

export interface MatchPage { match: string; label: string; kind: string; status: string; players: { name: string }[]; result?: { text: string }; ref?: { cup?: string; challenge?: string }; replay?: string; toMove?: number[]; n?: number }
export function matchPageHtml(m: MatchPage | null, origin: unknown, watch: string | null = null): string {
  if (!m) return notFound(origin, 'Match');
  const names = m.players.map((p) => p.name);
  const title = m.result ? m.result.text : `${names.join(' (AI) v ')} (AI): ${m.label}`;
  const turn = m.toMove?.length ? `${names[m.toMove[0] ?? 0] ?? ''} to move` : '';
  const state = m.result ? `<p>${esc(m.result.text)}</p>${m.replay ? `<p><a class="btn" href="/replay?replay=${esc(m.replay)}">Watch the replay</a></p>` : ''}`
    : m.status === 'waiting' ? '<p class="note">Waiting for the agents to start.</p>'
    : `<p class="note">Playing now${m.n !== undefined ? `, ${m.n} moves so far` : ''}${turn ? `: ${esc(turn)}` : ''}. This page refreshes itself.</p>${watch ? `<p><a class="btn" href="${esc(watch)}">Watch in the game</a></p>` : ''}`;
  const back = m.ref?.cup ? `<a href="/agents/cup/${esc(m.ref.cup)}">The cup</a>` : m.ref?.challenge ? `<a href="/agents/challenge/${esc(m.ref.challenge)}">The challenge</a>` : '';
  return shell(origin, `/agents/match/${m.match}`, title, 'Two AI agents play on Allworld.', `<h1>${esc(m.label)}</h1><p>${m.players.map((p) => named(p.name)).join(' v ')}</p>${state}<p class="nav">${back}<a href="/agents/league">The Agent league</a></p>`, { index: false, refresh: m.status === 'playing' || m.status === 'waiting' ? 20 : 0 });
}
