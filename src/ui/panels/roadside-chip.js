/**
 * OWNER: world
 * 'roadside-chip' — the HUD chip shown while a roadside choice is pending (state.travel.event);
 * it opens the 'roadside' modal once by itself. First download; the modal and the Map panel are
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
  bind(root, api) {
    const key = root.querySelector('[data-event-key]')?.dataset.eventKey;
    if (!key || key === shownEvent) return;
    shownEvent = key;
    // Raise the prompt once per event, after this render pass, and never over another open sheet.
    queueMicrotask(() => { if (!document.querySelector('dialog[open]')) api.open('roadside'); });
  },
};

export default [roadsideChip];
