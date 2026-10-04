/**
 * OWNER: growth
 * The "table here" chip in the HUD: shown in a venue that has a game table, it opens the Tables
 * app on that table, and is where "invite a friend here" lives for the venue. (A visitor who arrived through a
 * table link is taken to that table by the landing: src/life-main.js landJoin.)
 * First download: it knows only where tables stand (src/tables/places.js, data); no game code.
 */
import { esc, json, mark } from '../dom.js';
import '../phone/icon-tables.js';
import { isDeparting } from '../../game/registry.ts';
import { tablesAt, GAME_LABELS } from '../../tables/places.ts';

const chip = {
  id: 'tables-chip', title: 'Table here', icon: 'tables', placement: 'hud', order: 25,
  render(state, view) {
    if (!view.connected || view.onboarding?.required || isDeparting(state)) return '';
    const here = tablesAt(state.location);
    if (!here.length) return '';
    const games = [...new Set(here.map((table) => GAME_LABELS[table.game] ?? table.game))].join(', ');
    return `<button class="life-job" data-open="tables" data-params="${json({ table: here[0].id })}"><span aria-hidden="true">${mark('tables')}</span><div><strong>${esc(games)} table here</strong><small>Sit down, or invite a friend to play</small></div></button>`;
  },
};

export default [chip];
