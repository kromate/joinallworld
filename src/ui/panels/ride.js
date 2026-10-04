/**
 * OWNER: world
 * Ride app: quick travel booking. Pick how to travel once, then tap Go beside any place.
 * It is the same engine as the map card: every fare, trip time and refusal comes from
 * view.travel (src/game/systems/travel.js), and Go sends the same 'travel' action. The trip
 * itself is then shown on the city map, like every other trip (the host switches to it).
 * While something stops every trip at once (offline, already travelling, busy) that is said once
 * at the top, with its one-tap way out, instead of on every row.
 * The panel contract is at the top of src/ui/shell.js.
 */
import './ride.css';
import { how, rules as ruleList, bindHow } from '../phone/how.js';
import { esc, json, mark, iconFor } from '../dom.js';
import { chosenMode, fareText, fixButton, goBlock, modeIcon, statusClass, tripLine } from './world-ui.js';

let wanted = null;

export default {
  id: 'ride', title: 'Ride', placement: 'phone', order: 18,
  render(state, view) {
    const travel = view.travel;
    const here = travel.destinations.find((item) => item.here);
    const places = travel.destinations.filter((item) => item.kind !== 'soon' && !item.here)
      .sort((a, b) => Number(b.kind === 'home') - Number(a.kind === 'home') || Number(b.open) - Number(a.open) || a.label.localeCompare(b.label));
    const modes = places[0]?.modes || [];
    const picked = modes.find((mode) => mode.id === wanted) || modes.find((mode) => mode.id === travel.defaultMode) || modes[0];
    const weather = view.health?.weather;
    const picker = `<div class="ride-modes" role="group" aria-label="How to travel">${modes.map((mode) => `<button data-ride-mode="${esc(mode.id)}" aria-pressed="${mode.id === picked?.id}" class="${mode.id === picked?.id ? 'is-selected' : ''}" title="${esc(mode.blurb || '')}"><span aria-hidden="true">${modeIcon(mode)}</span>${esc(mode.label)}</button>`).join('')}</div>`;
    // What stops every trip alike is said once, above the list.
    const everywhere = ['offline', 'travelling', 'busy'];
    const first = places.map((item) => goBlock(state, view, item, chosenMode(item, picked?.id, travel.defaultMode))).find((block) => block && everywhere.includes(block.code));
    const notice = first ? `<div class="ride-notice" role="note"><p>${esc(first.reason)}</p>${fixButton(first, 'ride-fix')}</div>` : '';
    const rows = places.map((item) => {
      const mode = chosenMode(item, picked?.id, travel.defaultMode);
      const block = goBlock(state, view, item, mode);
      const own = block && !everywhere.includes(block.code);
      return `<li class="ride-row ${statusClass(item)}"><span class="ride-icon" aria-hidden="true">${iconFor('venue', item.id, item.icon)}</span><div class="ride-place"><b>${esc(item.label)}</b><small>${esc(item.district)} · ${esc(item.status)}</small>${own ? `<small class="ride-why">${esc(block.reason)}</small>${block.fix?.kind === 'mode' ? `<button class="ride-fix is-small" data-ride-mode="${esc(block.fix.mode)}">${esc(block.fix.label)}</button>` : ''}` : block ? '' : `<small>${esc(tripLine(mode))}</small>`}</div>
        <button class="ride-go" ${block ? 'disabled' : `data-action="travel" data-payload="${json({ id: item.id, mode: mode.id })}" data-then="close"`} aria-label="${block ? `${esc(item.label)}: ${esc(block.label)}` : `Go to ${esc(item.label)} by ${esc(mode.label)} for ${esc(fareText(mode))}`}">${block ? esc(block.label) : `Go · ${esc(fareText(mode))}`}</button></li>`;
    }).join('');
    return `${notice}<p class="ride-intro">You are at <b>${esc(here?.label ?? 'an unknown place')}</b>. Fares are charged when you set off — no refund if you cancel.${weather?.raining ? ` ${mark('rain')} It is raining: a trek or an okada will soak you.` : ''}</p>${picker}${picked?.blurb ? `<p class="ride-blurb">${esc(picked.blurb)}</p>` : ''}${how('ride-rules', ruleList(['Pick how to travel once, then tap Go beside any place. The fare and the trip time are on each row.', 'The fare is charged when you set off, and a cancelled trip is not refunded.', 'You will see the trip on the city map, like every other trip.', ...modes.filter((mode) => mode.blurb).map((mode) => `${mode.label}: ${mode.blurb}`)]), 'How rides work', true)}<ul class="ride-list">${rows}</ul>`;
  },
  bind(root, api) {
    bindHow(root, api);
    // Bound per button: the root outlives every redraw, so a listener on it would pile up.
    for (const choose of root.querySelectorAll('[data-ride-mode]')) choose.addEventListener('click', () => { wanted = choose.dataset.rideMode; api.refresh(); });
  },
};
