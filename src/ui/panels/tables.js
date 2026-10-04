/**
 * OWNER: growth
 * Tables: the Phone app for the game tables. Its first screen lists the tables where you are and
 * elsewhere in the city; opening one shows the table itself — who sits there, the rules the first
 * player chose, the game while it is on (drawn by the game's own board), and the result.
 * Everything shown comes from the server (src/tables/client.js); every button sends a message.
 */
import './tables.css';
import { esc, json, money, mark, empty, section } from '../dom.js';
import { how, rules as ruleList, bindHow } from '../phone/how.js';
import { linkWords } from '../link.js';
import { isDeparting } from '../../game/registry.js';
import { tableById, GAME_LABELS } from '../../tables/places.js';
import { T, start, openTable, closeTable, sit, leave, begin, again, play, setOption, reconnect, refreshList } from '../../tables/client.js';
import { whotBoard, bindWhot, whotRules } from '../../tables/whot-board.js';
import { penaltyBoard, bindPenalty, penaltyRules } from '../../tables/penalty-board.js';
import { G, share } from './growth-client.js';

const ui = { choosing: null, params: null };
const BOARDS = { whot: { draw: whotBoard, bind: bindWhot, rules: whotRules }, penalty: { draw: penaltyBoard, bind: bindPenalty, rules: penaltyRules } };
const here = (state) => (isDeparting(state) ? null : state.location);

function row(table, state) {
  const humans = table.seats.filter((seat) => !seat.bot), mine = table.venue === here(state);
  const who = table.status === 'playing' ? `Game on · ${table.seats.map((seat) => seat.name).join(', ')}` : humans.length ? `${humans.map((seat) => seat.name).join(', ')} waiting for players` : 'Empty: sit down and start';
  return `<li class="ui-row"><span class="ui-row-icon" aria-hidden="true">${mark('tables')}</span><span class="ui-row-body"><b>${esc(table.gameLabel)} · ${esc(table.label)}</b><small>${esc(table.venueLabel)} · ${esc(who)}${table.watching ? ` · ${table.watching} watching` : ''}</small></span>
    <span class="ui-row-end"><button class="ui-button${mine ? ' is-primary' : ''}" data-tb-open="${esc(table.id)}">${table.status === 'playing' ? 'Watch' : mine ? 'Sit' : 'Look'}</button></span></li>`;
}

function listScreen(state, view) {
  if (!T.list) return `<p class="gr-note">${T.socket === 'closed' ? 'Could not reach the tables. <button class="gr-swap" data-tb-retry>Try again</button>' : 'Looking for tables…'}</p>`;
  const at = here(state), mine = T.list.filter((table) => table.venue === at), other = T.list.filter((table) => table.venue !== at);
  const paid = view.growth?.tables;
  return `<section class="ui-hero gr-hero"><small>Game tables</small><strong>${mine.length ? `${mine.length} table${mine.length === 1 ? '' : 's'} where you are` : 'No table where you are'}</strong>
      <p>${paid ? `A win against a real player pays ${money(paid.win)} · ${paid.paidLeft} of ${paid.perDay} paid wins left today` : 'Play with whoever is here, or with a bot.'}</p></section>
    ${mine.length ? `<ul class="ui-rows">${mine.map((table) => row(table, state)).join('')}</ul>` : empty('tables', 'Go where the tables are', 'Whot is played at the buka, the park, the rooftop and the viewing centre; penalties at the viewing centre, the park and the beach.', '', { compact: true })}
    ${other.length ? `${section('Elsewhere in the city')}<ul class="ui-rows">${other.map((table) => row(table, state)).join('')}</ul>` : ''}
    ${Object.entries(T.ratings ?? {}).map(([game, rating]) => `<p class="gr-note">Your ${esc(GAME_LABELS[game] ?? game)} rating: ${rating.rating}${rating.provisional ? ' (provisional)' : ''} · ${rating.won} won of ${rating.played} rated games.</p>`).join('')}
    ${how('tables-rules', ruleList(['Sit at a table in the place where your Sim is. Anyone can watch from anywhere.', 'There are no stakes: nobody can lose money at a table. A win against a real player is paid by the game.',
    'Four paid wins a day. Games against the same player count three times a day; after that they are for fun.', 'Bots fill empty seats when you ask. A game against bots pays nothing.', 'If you leave before everyone has really played, the game is called off and nothing counts.']))}`;
}

function seatsLine(table) {
  return table.seats.length ? table.seats.map((seat) => `<span class="ui-chip${seat.bot ? '' : ' is-good'}">${esc(seat.name)}${seat.away ? ' · away' : ''}</span>`).join(' ') : '<span class="gr-note">Nobody is sitting yet.</span>';
}

function tableScreen(state, view) {
  const s = T.state, place = tableById(T.tableId);
  if (!s) return `<button class="gr-swap" data-tb-back>‹ All tables</button><p class="gr-note">${T.socket === 'closed' ? 'Not connected to the table. <button class="gr-swap" data-tb-retry>Reconnect</button>' : 'Walking up to the table…'}</p>`;
  const table = s.table, board = BOARDS[table.game], seated = s.you !== null, atVenue = table.venue === here(state);
  const head = `<button class="gr-swap" data-tb-back>‹ All tables</button><h3 class="tb-title">${esc(table.gameLabel)} · ${esc(table.label)}<small>${esc(table.venueLabel)}${table.watching ? ` · ${table.watching} watching` : ''}</small></h3>`;
  const invite = `<button class="ui-button is-block" data-tb-invite ${G.busy ? 'disabled' : ''}>${G.busy === 'table' ? 'Preparing…' : 'Invite a friend to this table'}</button>`;
  const offline = T.socket !== 'open' ? `<p class="ui-error" role="alert">Reconnecting to the table… your seat is kept. <button class="gr-swap" data-tb-retry>Try now</button></p>` : '';
  if (table.status === 'open') {
    const free = table.max - table.seats.length;
    const options = s.optionList.map((option) => `<label class="tb-option">${esc(option.label)}<select data-tb-option="${esc(option.name)}" ${s.host ? '' : 'disabled'}>${option.values.map((value, index) => `<option value="${esc(JSON.stringify(value))}" ${value === option.value ? 'selected' : ''}>${esc(option.names[index])}</option>`).join('')}</select></label>`).join('');
    const startButtons = seated ? `<div class="tb-start">${table.seats.length >= table.min ? `<button class="ui-button is-primary" data-tb-start="0" ${T.pending ? 'disabled' : ''}>Start with ${table.seats.length}</button>` : ''}
      ${free > 0 ? [1, 2, 3].filter((count) => count <= free).map((count) => `<button class="ui-button${table.seats.length < table.min && count === 1 ? ' is-primary' : ''}" data-tb-start="${count}" ${T.pending ? 'disabled' : ''}>+ ${count} bot${count === 1 ? '' : 's'}</button>`).join('') : ''}</div>
      <p class="gr-note">${table.seats.length < table.min ? 'Nobody else here yet? Invite a friend, or play with a bot (a bot game pays nothing).' : 'Everyone seated plays. Add bots to fill the table if you like.'}</p>` : '';
    return `${head}${offline}<div class="gr-card"><h3>At the table</h3><p>${seatsLine(table)}</p>
        ${seated ? `<button class="ui-button" data-tb-leave>Get up</button>` : atVenue ? `<button class="ui-button is-primary" data-tb-sit ${T.pending || !free ? 'disabled' : ''}>${free ? 'Sit down' : 'Table full'}</button>` : `<p>You can watch from here. To sit, go to ${esc(table.venueLabel)}.</p><button class="ui-button is-primary" data-tb-go="${esc(table.venue)}">Go to ${esc(table.venueLabel)}</button>`}</div>
      ${startButtons}${invite}
      <div class="gr-card"><h3>Table rules</h3>${options}<p class="gr-note">${s.host ? 'You sat down first, so you choose.' : 'Whoever sat down first chooses.'}</p></div>
      ${board ? how(`table-rules-${table.game}`, ruleList(board.rules), `How to play ${table.gameLabel}`) : ''}`;
  }
  const over = table.status === 'over', result = s.result;
  const mine = result?.mine;
  const outcome = over && result ? `<div class="gr-card tb-result${mine?.won ? ' is-won' : ''}"><h3>${result.calledOff ? 'Called off' : mine ? (mine.won ? 'You won' : mine.draw ? 'A draw' : 'You lost this one') : 'Game over'}</h3><p>${esc(result.text)}</p>
      ${mine && !result.calledOff ? `<p>${mine.won && mine.human && mine.counted ? (T.claimed?.code === 'paid' ? `+${money(view.growth.tables.win)} paid.` : T.claimed ? 'Counted for your missions. Today’s paid wins are used up.' : 'Collecting your win…')
    : !mine.human ? 'A game against bots pays nothing.' : !mine.counted ? 'You two have played your three counted games today: this one was for fun.' : 'It counts for your missions.'}${mine.change !== undefined ? ` Rating ${mine.rating} (${mine.change >= 0 ? '+' : ''}${mine.change}).` : ''}</p>` : ''}
      <button class="ui-button is-primary" data-tb-again>Play again</button>${mine?.won ? `<button class="ui-button" data-tb-share ${G.busy ? 'disabled' : ''}>Share the win</button>` : ''}<button class="ui-button" data-tb-back>Leave the table</button></div>` : '';
  return `${head}${offline}${outcome}${board ? board.draw(s, ui, view.now) : '<p class="gr-note">This game cannot be shown in this version.</p>'}
    ${!over && seated ? `<button class="gr-swap" data-tb-leave data-confirm="1">Leave the game (you forfeit)</button>` : ''}${over ? '' : invite}`;
}

const panel = {
  id: 'tables', title: 'Tables', placement: 'phone', order: 43, group: 'city',
  render(state, view) {
    if (!view.connected) return `<p class="gr-note">${esc(linkWords(view).why)}</p>`;
    return `<div class="tb">${T.tableId ? tableScreen(state, view) : listScreen(state, view)}</div>`;
  },
  bind(root, api, params) {
    bindHow(root, api);
    start(api);
    // Opened on a table (a link, the venue chip): go straight to it, once.
    if (params?.table && params !== ui.params) { ui.params = params; if (tableById(params.table)) openTable(params.table); }
    const each = (selector, handler, event = 'click') => { for (const node of root.querySelectorAll(selector)) node.addEventListener(event, () => handler(node)); };
    each('[data-tb-open]', (node) => { ui.choosing = null; openTable(node.dataset.tbOpen); });
    each('[data-tb-back]', () => { if (T.state?.you !== null && T.state?.table.status !== 'playing') leave(); closeTable(); });
    each('[data-tb-retry]', () => reconnect());
    each('[data-tb-sit]', () => sit());
    each('[data-tb-leave]', (node) => { if (!node.dataset.confirm || window.confirm('Leave the game? You forfeit it.')) leave(); });
    each('[data-tb-start]', (node) => begin(Number(node.dataset.tbStart)));
    each('[data-tb-again]', () => again());
    each('[data-tb-go]', (node) => { api.close(); api.goTo(node.dataset.tbGo); });
    each('[data-tb-invite]', () => share(api, 'table', { table: T.tableId }));
    each('[data-tb-share]', () => share(api, 'table'));
    each('[data-tb-option]', (node) => setOption(node.dataset.tbOption, JSON.parse(node.value)), 'change');
    const board = T.state && T.state.table.status !== 'open' ? BOARDS[T.state.table.game] : null;
    if (board) board.bind(root, T.state, ui, play, () => api.refresh());
    if (!T.tableId && T.list && Date.now() - T.listAt > 20000) refreshList();
  },
};

export default [panel];
