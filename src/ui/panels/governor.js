/**
 * OWNER: civic
 * Governor: the election app (phase, countdown, candidates, live tally, run, vote, announce)
 * and the State House sheet (who governs, their announcements, civic updates).
 * Data: GET /api/civic/gov, which also says exactly why this player can or cannot run, vote
 * and announce — every disabled control here shows that reason. The app is a form (`live: false`).
 * The weekly cycle and all eligibility rules are original beta design.
 */
import { esc, money } from '../dom.js';
import { ELECTION, STATE_HOUSE_TEXT } from '../../game/content/civic.js';
import { button, busy, dateTime, count, entry, load, put, send, stale, status, until } from './civic-ui.js';

const PANEL = 'governor';
const draft = { slogan: '', announcement: '' };
const key = (view) => `gov:${view.cityId}`;
const path = (view) => `/api/civic/gov?city=${view.cityId}`;
const PHASES = { nominations: 'Nominations are open', voting: 'Polls are open', results: 'Results day' };
const NEXT = { nominations: 'voting opens', voting: 'polls close', results: 'nominations open' };

/** The State House block: the sitting Governor, or the empty state. */
function seat(data, view) {
  const lagos = view.cityId === 'lagos';
  const title = lagos ? STATE_HOUSE_TEXT.title : `${view.city.name} State House`;
  if (!data.governor) return `<div class="governor-seat"><h3>🏛️ ${esc(title)}</h3><p>${esc(lagos ? STATE_HOUSE_TEXT.empty : `${view.city.name} has no Governor yet. Sign up to vote, or run for office yourself.`)}</p></div>`;
  const governor = data.governor;
  return `<div class="governor-seat"><h3>🏛️ ${esc(title)}</h3><p>Governor <strong>${esc(governor.name)}</strong>${governor.id === view.session?.id ? ' (you)' : ''}</p><p><q>${esc(governor.slogan)}</q></p><small>Elected with ${count(governor.votes)} vote${governor.votes === 1 ? '' : 's'} · term ends ${esc(dateTime(governor.termEndsAt))} (in ${esc(until(governor.termEndsAt, view.now))})</small></div>`;
}

function announcements(data) {
  if (!data.announcements.length) return '<p class="civic-note">No announcements from the Governor yet.</p>';
  return `<ul class="civic-list">${data.announcements.map((item) => `<li><span>${esc(item.text)}<small>Governor ${esc(item.by.name)} · ${esc(dateTime(item.at))}</small></span></li>`).join('')}</ul>`;
}

function updates(view) {
  const notices = entry(`pulse:${view.cityId}`).data?.notices ?? [];
  if (!notices.length) return '<p class="civic-note">No civic updates this week.</p>';
  return `<ul class="civic-list">${notices.map((item) => `<li><span><strong>${esc(item.title)}</strong><small>${esc(item.text)} · ${esc(dateTime(item.at))}</small></span></li>`).join('')}</ul>`;
}

const checks = (list) => `<ul class="civic-checks">${list.map((item) => `<li class="${item.met ? 'is-met' : 'is-unmet'}">${item.met ? '✓' : '✗'} ${esc(item.label)} — ${esc(item.detail)}</li>`).join('')}</ul>`;

function ballot(data, view, state) {
  const you = data.you, election = data.election, voting = data.phase === 'voting';
  if (!election.candidates.length) return `<p class="civic-note">${data.phase === 'nominations' ? 'Nobody has declared yet. Be the first.' : 'Nobody stood in this election.'}</p>`;
  const top = Math.max(1, ...election.candidates.map((item) => item.votes));
  const elsewhere = you?.vote.code === 'wrong_place';
  const rows = election.candidates.map((item) => {
    const chosen = election.yourVote === item.id;
    const why = !view.connected ? 'Offline: reconnect to vote.' : !you ? 'Connect to vote.' : you.vote.ok ? '' : you.vote.reason;
    const control = chosen ? '<small class="civic-note">✓ Your vote</small>'
      : election.yourVote || data.phase === 'results' ? ''
        : button(`Vote for ${item.name}`, `data-gov-vote="${esc(item.id)}"`, { primary: voting, working: busy(`vote:${item.id}`), reason: why });
    return `<div class="governor-candidate"><div class="governor-phase"><strong>${esc(item.name)}${item.you ? ' (you)' : ''}</strong>${data.phase === 'nominations' ? '' : `<span>${count(item.votes)} vote${item.votes === 1 ? '' : 's'}</span>`}</div><q>${esc(item.slogan)}</q>${data.phase === 'nominations' ? '' : `<div class="governor-bar" aria-hidden="true"><i style="width:${Math.round((item.votes / top) * 100)}%"></i></div>`}${control}</div>`;
  }).join('');
  const go = elsewhere && voting ? button('Go to the Polling Unit', `data-gov-go="${esc(data.rules.pollingVenue)}"`, { reason: state.activeAction ? 'Finish your current action first.' : '' }) : '';
  return `${rows}${go}${voting ? `<p class="civic-note">${count(election.totalVotes)} vote${election.totalVotes === 1 ? '' : 's'} cast so far. One vote per player; it cannot be changed.</p>` : ''}`;
}

function runForOffice(data, view) {
  const you = data.you;
  if (!you) return '<p class="civic-note">Connect to see whether you can run.</p>';
  if (you.isCandidate) return '<p class="civic-note">✓ You are on this week’s ballot. Voting runs Thursday to Saturday, Lagos time.</p>';
  const why = !view.connected ? 'Offline: reconnect to run.' : !you.run.ok ? you.run.reason : '';
  return `<p class="civic-note">What you need to run, and where you stand:</p>${checks(you.run.checks)}
    <div class="civic-form"><label>Your slogan (${ELECTION.sloganMin}–${ELECTION.sloganMax} characters, no links)<input data-gov-slogan maxlength="${ELECTION.sloganMax}" value="${esc(draft.slogan)}" autocomplete="off"></label></div>
    ${button(`Run for Governor · ${money(data.rules.filingFee)}`, 'data-gov-run', { primary: data.phase === 'nominations', working: busy('run'), reason: why })}`;
}

function office(data, view) {
  const you = data.you;
  if (!you?.isGovernor) return '';
  const why = !view.connected ? 'Offline: reconnect to post.' : !you.announce.ok ? you.announce.reason : '';
  return `<h3>Governor’s desk</h3><div class="civic-form"><label>Announcement to the city (up to ${ELECTION.announcement.max} characters, no links)<textarea data-gov-text maxlength="${ELECTION.announcement.max}" rows="3">${esc(draft.announcement)}</textarea></label></div>
    ${button('Post announcement', 'data-gov-announce', { primary: true, working: busy('announce'), reason: why })}<p class="civic-note">Up to ${esc(data.rules.announcementsPerDay)} a day, at least an hour apart. Everyone sees it in Updates.</p>`;
}

const app = {
  id: PANEL, title: 'Governor', icon: '🏛️', placement: 'phone', order: 40, live: false,
  render(state, view) {
    const item = entry(key(view)), data = item.data;
    if (!data) return status(item, view);
    const rules = data.rules;
    return `${seat(data, view)}${stale(item)}
      <div class="governor-phase"><h3>${esc(PHASES[data.phase])}</h3><span class="civic-note">${esc(NEXT[data.phase])} in ${esc(until(data.phaseEndsAt, view.now))} · ${esc(dateTime(data.phaseEndsAt))}</span></div>
      <p class="civic-note">Every week: nominations Monday–Wednesday, voting Thursday–Saturday, and on Sunday the winner takes office for seven days (Lagos time).${rules.pollingVenue ? ' Votes are cast at the Polling Unit.' : ' The Polling Unit is not built in this city yet, so for now you vote from this app.'}</p>
      <h3>${data.phase === 'results' ? 'This week’s result' : 'Candidates'}</h3>${ballot(data, view, state)}
      ${data.phase === 'results' && data.lastResult ? `<p class="civic-note">${data.lastResult.winner ? `${esc(data.lastResult.winner.name)} won with ${count(data.lastResult.winner.votes)} of ${count(data.lastResult.totalVotes)} votes.` : data.lastResult.candidates ? 'Nobody voted, so nobody took office.' : 'Nobody stood, so the seat stays empty.'}</p>` : ''}
      ${data.you && data.phase === 'voting' && !data.election.yourVote ? `<p class="civic-note">What you need to vote:</p>${checks(data.you.vote.checks)}` : ''}
      <h3>Run for office</h3>${runForOffice(data, view)}
      ${office(data, view)}
      <h3>Governor’s announcements</h3>${announcements(data)}
      <h3>Updates</h3>${updates(view)}
      ${button('Refresh', 'data-civic-retry', { working: item.loading })}
      <p class="civic-beta">Beta: the election cycle and rules are original to this game — live here ${esc(rules.minDaysToRun)} Lagos days to run and ${esc(rules.minDaysToVote)} to vote, a ${money(rules.filingFee)} in-game filing fee that is not refunded, at most ${esc(rules.maxCandidates)} candidates, ties go to whoever declared first. A device session is not a verified person, so treat results as a game, not a poll. Updates appear in the game only; there are no push notifications.</p>`;
  },
  bind(root, api) {
    const view = api.view(), again = () => api.open(PANEL);
    load(api, key(view), path(view), { maxAge: 20000, panel: PANEL });
    const done = (result) => { if (result.gov) put(key(api.view()), result.gov); if (document.querySelector(`dialog [data-panel="${PANEL}"]`)?.closest('dialog')?.open) again(); if (result.gov) api.refresh(); };
    root.querySelector('[data-civic-retry]')?.addEventListener('click', () => load(api, key(api.view()), path(api.view()), { force: true, panel: PANEL }));
    const slogan = root.querySelector('[data-gov-slogan]'), text = root.querySelector('[data-gov-text]');
    slogan?.addEventListener('input', () => { draft.slogan = slogan.value; });
    text?.addEventListener('input', () => { draft.announcement = text.value; });
    root.querySelector('[data-gov-run]')?.addEventListener('click', async () => {
      if ([...draft.slogan.trim()].length < ELECTION.sloganMin) { api.toast(`Write a slogan first (${ELECTION.sloganMin}–${ELECTION.sloganMax} characters). Nothing was charged.`, 'error'); slogan?.focus(); return; }
      const result = await send(api, 'run', '/api/civic/gov/run', { slogan: draft.slogan }, { panel: PANEL, success: 'You are on the ballot.' });
      if (result.ok) draft.slogan = '';
      done(result);
    });
    for (const node of root.querySelectorAll('[data-gov-vote]')) {
      node.addEventListener('click', async () => done(await send(api, `vote:${node.dataset.govVote}`, '/api/civic/gov/vote', { candidate: node.dataset.govVote }, { panel: PANEL, success: 'Your vote was counted.' })));
    }
    root.querySelector('[data-gov-announce]')?.addEventListener('click', async () => {
      if ([...draft.announcement.trim()].length < ELECTION.announcement.min) { api.toast('Write your announcement first.', 'error'); text?.focus(); return; }
      const result = await send(api, 'announce', '/api/civic/gov/announce', { text: draft.announcement }, { panel: PANEL, success: 'Announcement posted.' });
      if (result.ok) draft.announcement = '';
      done(result);
    });
    root.querySelector('[data-gov-go]')?.addEventListener('click', (event) => { api.close(); api.goTo(event.currentTarget.dataset.govGo); });
  },
};

/** The State House sheet: opened with api.open('state-house'), e.g. from the State House on the map. */
const stateHouse = {
  id: 'state-house', title: 'State House', icon: '🏛️', placement: 'modal',
  render(state, view) {
    const item = entry(key(view)), data = item.data;
    if (!data) return status(item, view);
    return `${seat(data, view)}${stale(item)}<h3>Governor’s announcements</h3>${announcements(data)}<h3>Updates</h3>${updates(view)}
      <p class="civic-note">${esc(PHASES[data.phase])}: ${esc(NEXT[data.phase])} in ${esc(until(data.phaseEndsAt, view.now))}.</p>
      <button class="ui-button is-primary" data-open="${PANEL}">${data.phase === 'voting' ? 'Vote for Governor' : data.phase === 'nominations' ? 'Run for office' : 'See the election'}</button>`;
  },
  bind(root, api) {
    const view = api.view();
    load(api, key(view), path(view), { maxAge: 20000 });
    root.querySelector('[data-civic-retry]')?.addEventListener('click', () => load(api, key(api.view()), path(api.view()), { force: true }));
  },
};

export default [app, stateHouse];
