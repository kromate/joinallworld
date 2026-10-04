/**
 * OWNER: world
 * Map panel: pick a destination and a travel mode. A 'nav' panel — it renders inline above the
 * bottom nav while the map scene (src/world-map.js today, src/city-map.js when built) shows behind.
 *
 * Ported starter behaviour (extend freely): list the city's venues, show the five travel modes
 * with fares, Home only by free trek, Go sends the 'travel' action. Open with a preselected
 * destination via api.open('map', { destination: venueId }).
 * The panel contract is at the top of src/ui/shell.js. Styles: create ./map.css and import it here.
 */
import { esc, money, json, icon } from '../dom.js';
import { VENUES } from '../../game/content/venues.js';

let destination = null;
let mode = 'danfo';
let seenParams = null;

export default {
  id: 'map', title: 'Map', icon: '🗺️', placement: 'nav',
  render(state, view) {
    if (view.params && view.params !== seenParams) { seenParams = view.params; destination = view.params.destination ?? null; mode = 'danfo'; }
    const venue = view.venues.find((item) => item.id === destination);
    if (!venue) {
      return `<div class="life-map-hint"><span>🗺️</span><div><h1>Where to?</h1><p>Choose a place to visit.</p></div></div><div class="life-places">${view.venues.map((item) => `<button data-map-pick="${esc(item.id)}" ${item.id === state.location ? 'disabled' : ''}>${esc(item.icon || '')} ${esc(item.label)}${item.id === state.location ? ' · you are here' : ''}</button>`).join('')}</div>`;
    }
    const only = VENUES[venue.id]?.travelMode;
    const modes = view.travel.modes.filter((item) => !only || item.id === only);
    const chosen = modes.find((item) => item.id === mode) || modes[0];
    const here = venue.id === state.location;
    const blocked = here ? 'You are here' : !view.connected ? 'Offline' : state.cash < chosen.fare ? 'Not enough cash' : state.activeAction ? 'Finish your current action first' : '';
    return `<div class="life-destination" aria-label="Travel to ${esc(venue.label)}"><div class="life-destination-preview ${esc(venue.id)}"><span>${esc(venue.icon || '📍')}</span><span class="life-preview-label">Destination</span></div><div class="life-destination-body"><header><div><h1>${esc(venue.label)}</h1><p>${esc(venue.district)}</p></div><button class="life-icon-button" data-map-pick="" aria-label="Close travel sheet">${icon('close')}</button></header><p class="life-destination-description">${esc(venue.description || '')}</p><div class="life-transit" role="group" aria-label="Travel method">${modes.map((item) => `<button data-map-mode="${esc(item.id)}" aria-pressed="${item === chosen}" class="${item === chosen ? 'is-selected' : ''}"><span>${esc(item.icon)}</span>${esc(item.label)}<small>${item.fare ? money(item.fare) : 'Free'}</small></button>`).join('')}</div><button class="life-go" data-action="travel" data-payload="${json({ id: venue.id, mode: chosen.id })}" data-then="close" ${blocked ? 'disabled' : ''}>${blocked || `Go${chosen.fare ? ` · ${money(chosen.fare)}` : ''}`} <span>→</span></button></div></div>`;
  },
  bind(root, api) {
    root.addEventListener('click', (event) => {
      const pick = event.target.closest('[data-map-pick]'), choose = event.target.closest('[data-map-mode]');
      if (pick) { destination = pick.dataset.mapPick || null; api.refresh(); }
      else if (choose) { mode = choose.dataset.mapMode; api.refresh(); }
    });
  },
};
