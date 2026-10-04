/**
 * OWNER: growth
 * The "While you were away" card: a HUD alert shown once when a player returns after three hours
 * or more, with at most five lines of what is waiting — a person first, then an invitation, then
 * their Sim, then progress (src/game/digest.js). Each line opens the app it belongs to; the X
 * dismisses the card for good. It states facts; nothing was taken while the player was gone.
 * First download (it is a HUD chip); it draws only from data already loaded and never fetches.
 */
import { esc, json } from '../dom.js';
import { awayCard } from '../../game/digest.js';
import { upcomingEvents } from '../../game/calendar.js';
import { notifications } from './inbox.js';
import { G, load, awayDismissed, dismissAway } from './growth-client.js';

function cardFor(state, view) {
  if (!view.connected || view.onboarding?.required || !G.hello || awayDismissed()) return null;
  const lines = notifications(state, view).filter((line) => line.fresh);
  return awayCard({ hoursAway: G.hello.away.hours, lines, missions: view.missions, events: upcomingEvents(view.now, 1, view.cityId) });
}

const chip = {
  id: 'away', title: 'While you were away', icon: 'bell', placement: 'hud', order: 5,
  slot: (state, view) => (cardFor(state, view) ? 'alert' : 'hud'),
  render(state, view) {
    const card = cardFor(state, view);
    if (!card) return '<span data-away-idle hidden></span>';
    return `<section class="gr-away is-active" aria-label="${esc(card.title)}"><header><div><b>${esc(card.title)}</b><small>${esc(card.sub)}</small></div><button class="gr-x" data-away-close aria-label="Dismiss">×</button></header>
      <ul>${card.lines.map((line) => `<li><button data-open="${esc(line.app || 'messages')}" ${line.params ? `data-params="${json(line.params)}"` : ''}>${esc(line.text)}</button></li>`).join('')}</ul>
      ${card.more ? `<small>and ${card.more} more in Messages</small>` : ''}</section>`;
  },
  bind(root, api) {
    void load(api);
    root.querySelector('[data-away-close]')?.addEventListener('click', () => dismissAway());
    for (const node of root.querySelectorAll('[data-open]')) node.addEventListener('click', () => dismissAway());
  },
};

export default [chip];
