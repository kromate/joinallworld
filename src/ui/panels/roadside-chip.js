/**
 * OWNER: world
 * 'roadside-chip' — the HUD chip shown while a roadside choice is pending (state.travel.event);
 * tapping it opens the 'roadside' modal (it never opens by itself: nothing covers a place the player has
 * just arrived at). First download; the modal and the Map panel are
 * ./map.js (fetched with the map panel group).
 */
import './map.css';
import { esc, iconFor } from '../dom.js';

let shownEvent = '';

const roadsideChip = {
  id: 'roadside-chip', title: 'On the road', placement: 'hud', slot: 'alert', order: 5,
  render(state, view) {
    const event = view.travel?.event;
    return event ? `<button class="map-event-chip" data-open="roadside" data-event-key="${esc(`${event.id}:${event.at}`)}"><span aria-hidden="true">${iconFor('event', event.id, event.icon)}</span><span><b>${esc(event.title)}</b><small>Tap to answer</small></span></button>` : '';
  },
  bind(root) {
    // A roadside event never interrupts: arriving somewhere shows the place first. The chip is the way in — it
    // draws the eye once when the event is new (a one-shot CSS pulse) and waits to be tapped.
    const chip = root.querySelector('[data-event-key]'), key = chip?.dataset.eventKey;
    if (!key || key === shownEvent) return;
    shownEvent = key;
    chip.classList.add('is-new');
  },
};

export default [roadsideChip];
