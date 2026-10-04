/**
 * OWNER: world
 * Map panel, plus the roadside-event prompt.
 *
 *   'map'            nav panel. Renders inline above the bottom nav while the city map
 *                    (src/city-map.js) shows behind it: a filter bar and a rail of places, or —
 *                    once a place is picked on the map or the rail — the venue card with
 *                    hours, description, activity chips, mode tiles, Go and a copy-link share.
 *                    "World map" swaps the backdrop to the city picker (src/world-map.js).
 *                    Open with a destination: api.open('map', { destination: venueId }).
 *   'roadside'       modal with the pending roadside choice (state.travel.event).
 *   'roadside-chip'  HUD chip shown while a choice is pending; it opens the modal once by itself.
 *
 * Everything shown comes from view.travel (src/game/systems/travel.js). The panel talks to the
 * city map through the window event 'jaw:map-ui' { layer?, filter?, selected?, layers?, ads?,
 * neighbours?, gov? }.
 *
 * MAP LAYERS (Billboards · Sea · Neighbours · Gov). Each toggle draws one civic overlay on the
 * city map from its own server response, loaded through the civic panels' cache (civic-ui.js):
 * GET /api/civic/ads, /neighbours and /gov. The panel only passes the data on; the map draws it.
 * The panel contract is at the top of src/ui/shell.js.
 */
import './map.css';
import { esc, json, icon } from '../dom.js';
import { VENUE_CATEGORIES } from '../../game/content/venues.js';
import { chosenMode, fareText, goBlock, statusClass, tripLine } from './world-ui.js';
import { entry, load } from './civic-ui.js';

const FILTERS = [{ id: 'all', label: 'All' }, { id: 'open', label: 'Open now' }, ...Object.values(VENUE_CATEGORIES)];
const CHIP_LIMIT = 9;

let destination = null, mode = null, seenParams = null, filter = 'all', layer = 'city', lastCity = null, showAll = false;
let shownEvent = '';
const layers = { billboards: false, sea: false, neighbours: false, gov: false };
const LAYERS = [
  { id: 'billboards', label: '📢 Billboards', key: 'ads', path: 'ads', open: 'ads', params: { tab: 'billboard' }, action: 'Rent a billboard' },
  { id: 'sea', label: '🌊 Sea', key: 'ads', path: 'ads', open: 'ads', params: { tab: 'sea' }, action: 'Rent a sea plot' },
  { id: 'neighbours', label: '🏡 Neighbours', key: 'hood', path: 'neighbours', open: 'neighbours', action: 'Open Neighbours' },
  { id: 'gov', label: '🏛️ Gov', key: 'gov', path: 'gov', open: 'state-house', action: 'Open the State House' },
];
const cacheKey = (item, view) => `${item.key}:${view.cityId}`;

const tell = (detail) => window.dispatchEvent(new CustomEvent('jaw:map-ui', { detail }));
const matches = (item) => item.kind !== 'soon' && (filter === 'all' || (filter === 'open' ? item.open : item.category === filter || item.kind === 'home'));

function overview(state, view) {
  const weather = view.health?.weather;
  const places = view.travel.destinations.filter(matches);
  const top = `<header class="map-top"><div><h1>${esc(view.city?.name || 'City')} map</h1><p>${weather ? `${esc(weather.icon)} ${esc(weather.label)} · ` : ''}Pick a place on the map or below.</p></div><button class="map-chip-button" data-map-layer="world">🌍 World map</button></header>`;
  const filters = `<div class="map-filters" role="group" aria-label="Filter places">${FILTERS.map((item) => `<button data-map-filter="${esc(item.id)}" aria-pressed="${item.id === filter}" class="${item.id === filter ? 'is-selected' : ''}">${esc(item.label)}</button>`).join('')}</div>`;
  // The stamp makes the panel re-bind when a layer's data arrives, which is when the map is told.
  const on = LAYERS.filter((item) => layers[item.id]);
  const stamp = on.map((item) => `${item.id}:${entry(cacheKey(item, view)).at}`).join('|');
  const layerRow = `<div class="map-filters map-layers" role="group" aria-label="Map layers" data-map-stamp="${esc(stamp)}">${LAYERS.map((item) => `<button data-map-layer-toggle="${esc(item.id)}" aria-pressed="${layers[item.id]}" class="${layers[item.id] ? 'is-selected' : ''}">${esc(item.label)}</button>`).join('')}</div>`;
  const layerNotes = on.map((item) => {
    const cached = entry(cacheKey(item, view));
    const status = cached.data ? '' : !view.connected ? 'Offline: reconnect to load this layer.' : cached.error ? `Could not load: ${cached.error}` : 'Loading…';
    const summary = !cached.data ? status : item.id === 'billboards' ? `${cached.data.billboards.slots.filter((slot) => slot.ad).length} of ${cached.data.billboards.slots.length} billboards rented`
      : item.id === 'sea' ? `${cached.data.sea.plots.length} sea plots rented · shown in the water below the city`
        : item.id === 'neighbours' ? `${cached.data.total} home${cached.data.total === 1 ? '' : 's'}, ${cached.data.online} online`
          : cached.data.governor ? `Governor ${cached.data.governor.name}` : 'No Governor yet';
    return `<div class="map-layer-note"><span>${esc(summary)}</span><button class="map-chip-button" data-open="${esc(item.open)}" ${item.params ? `data-params="${json(item.params)}"` : ''}>${esc(item.action)}</button></div>`;
  }).join('');
  const rail = places.length
    ? `<div class="map-rail" role="group" aria-label="Places">${places.map((item) => `<button data-map-pick="${esc(item.id)}" class="${statusClass(item)}${item.here ? ' is-here' : ''}"><span aria-hidden="true">${esc(item.icon)}</span><b>${esc(item.label)}</b><small>${esc(item.here ? 'You are here' : item.open ? item.district : 'Closed')}</small></button>`).join('')}</div>`
    : `<p class="map-empty">Nothing matches this filter right now. Choose “All” to see every place.</p>`;
  return `<div class="map-panel">${top}${filters}${layerRow}${layerNotes}${rail}</div>`;
}

function worldLayer(view) {
  return `<div class="map-panel"><header class="map-top"><div><h1>World map</h1><p>Choose a city on the map to start or continue a life there. Each city has its own life.</p></div><button class="map-chip-button" data-map-layer="city">← ${esc(view.city?.name || 'City')} map</button></header></div>`;
}

function card(state, view, item) {
  const chosen = chosenMode(item, mode, view.travel.defaultMode);
  const block = goBlock(state, view, item, chosen);
  const chips = showAll ? item.preview : item.preview.slice(0, CHIP_LIMIT);
  const more = item.preview.length - chips.length;
  const tiles = item.modes.map((option) => {
    const off = item.blocked;
    return `<button data-map-mode="${esc(option.id)}" aria-pressed="${option === chosen}" class="${option === chosen ? 'is-selected' : ''}${option.blocked && !off ? ' is-short' : ''}" ${off ? `disabled title="${esc(off.reason)}"` : `title="${esc(option.blurb || '')}"`}><span aria-hidden="true">${esc(option.icon)}</span><b>${esc(option.label)}</b><small>${esc(fareText(option))}</small><small class="map-mode-time">${esc(option.seconds)}s</small></button>`;
  }).join('');
  return `<div class="map-panel map-card" role="region" aria-label="${esc(item.label)}">
    <header class="map-card-head"><span class="map-card-icon" aria-hidden="true">${esc(item.icon || '📍')}</span><div><h1>${esc(item.label)}</h1><p>${esc(item.district)}${item.band ? ` · ${esc(item.band)}` : ''}</p></div>
      <button class="life-icon-button" data-map-share="${esc(item.id)}" aria-label="Copy a link to ${esc(item.label)}" title="Copy a link to ${esc(item.label)}">🔗</button>
      <button class="life-icon-button" data-map-pick="" aria-label="Back to the list of places">${icon('close')}</button></header>
    <p class="map-status ${statusClass(item)}"><b>${esc(item.status)}</b>${item.open && item.hours !== item.status ? ` <span>${esc(item.hours)}</span>` : ''}</p>
    <p class="map-desc">${esc(item.description || '')}</p>
    ${item.ambient ? `<p class="map-ambient">${esc(item.ambient)}</p>` : ''}
    ${chips.length ? `<div class="map-chips" aria-label="Things to do here">${chips.map((label) => `<span>${esc(label)}</span>`).join('')}${more > 0 ? `<button data-map-more>+${more} more</button>` : ''}</div>` : ''}
    ${item.modes.length ? `<div class="map-modes" role="group" aria-label="How to travel">${tiles}</div>` : ''}
    ${chosen && !item.blocked ? `<p class="map-trip">${esc(tripLine(chosen))}</p>` : ''}
    ${block ? `<p class="map-why" role="note">${esc(block.reason)}</p>` : ''}
    ${item.id === 'state-house' ? '<button class="map-chip-button" data-open="state-house">🏛️ Who governs? Open the State House</button>' : item.id === 'polling-unit' ? '<button class="map-chip-button" data-open="governor">🗳️ Election: candidates, voting and results</button>' : ''}
    <button class="map-go" ${block || !chosen ? 'disabled' : `data-action="travel" data-payload="${json({ id: item.id, mode: chosen.id })}" data-then="close"`}>${block ? esc(block.label) : `Go · ${esc(fareText(chosen))} <span aria-hidden="true">→</span>`}</button>
  </div>`;
}

const mapPanel = {
  id: 'map', title: 'Map', icon: '🗺️', placement: 'nav',
  render(state, view) {
    if (view.cityId !== lastCity) { lastCity = view.cityId; layer = 'city'; destination = null; }
    if (view.params && view.params !== seenParams) {
      seenParams = view.params;
      if ('destination' in view.params) { destination = view.params.destination ?? null; mode = null; showAll = false; layer = 'city'; }
    }
    if (layer === 'world') return worldLayer(view);
    const item = view.travel.destinations.find((entry) => entry.id === destination);
    return item ? card(state, view, item) : overview(state, view);
  },
  bind(root, api, params) {
    // Opened for a place (the Home tab, a goal chip, "Go to work"): highlight it on the city map too.
    if (params?.destination && params.destination === destination) tell({ selected: destination });
    // Layers: load what is switched on (cached; never from a timer) and hand the map what there is.
    const view = api.view(), detail = { layers: { ...layers } };
    for (const item of LAYERS.filter((option) => layers[option.id])) {
      load(api, cacheKey(item, view), `/api/civic/${item.path}?city=${view.cityId}`, { maxAge: 30000 });
      detail[item.key === 'hood' ? 'neighbours' : item.key] = entry(cacheKey(item, view)).data;
    }
    tell(detail);
    root.addEventListener('click', async (event) => {
      const hit = (name) => event.target.closest(`[data-map-${name}]`);
      const pick = hit('pick'), choose = hit('mode'), chip = hit('filter'), swap = hit('layer'), share = hit('share'), toggle = hit('layer-toggle');
      if (toggle) { const id = toggle.dataset.mapLayerToggle; layers[id] = !layers[id]; tell({ layers: { ...layers } }); api.refresh(); return; }
      // Leaving on a trip clears the selection so the next visit starts from the overview.
      if (event.target.closest('[data-action="travel"]')) { destination = null; tell({ selected: null }); return; }
      if (pick) { destination = pick.dataset.mapPick || null; mode = null; showAll = false; tell({ selected: destination }); api.refresh(); }
      else if (choose && !choose.disabled) { mode = choose.dataset.mapMode; api.refresh(); }
      else if (chip) { filter = chip.dataset.mapFilter; tell({ filter }); api.refresh(); }
      else if (hit('more')) { showAll = true; api.refresh(); }
      else if (swap) { layer = swap.dataset.mapLayer; tell({ layer }); api.open('map', { layer }); } // re-opening makes the host swap the backdrop
      else if (share) {
        const link = `${window.location.origin}${window.location.pathname}?venue=${encodeURIComponent(share.dataset.mapShare)}`;
        try { await navigator.clipboard.writeText(link); api.toast('Link copied. Anyone who opens it lands on this place.', 'good'); }
        catch { api.toast(`Copy this link: ${link}`); }
      }
    });
  },
};

const roadsidePanel = {
  id: 'roadside', title: 'On the road', icon: '🛣️', placement: 'modal',
  render(state, view) {
    const event = view.travel.event;
    if (!event) return `<p>Nothing is waiting for you by the roadside right now.</p><p>${esc(state.message || '')}</p><button class="ui-button is-primary" data-close>Carry on</button>`;
    return `<div class="map-event"><p class="map-event-icon" aria-hidden="true">${esc(event.icon)}</p><h3>${esc(event.title)}</h3><p>${esc(event.text)}</p>
      <div class="map-event-choices">${event.choices.map((choice) => `<button class="ui-button" data-action="world.roadside" data-payload="${json({ choice: choice.id })}" data-then="close" ${choice.blocked || !view.connected ? 'disabled' : ''}>
        <b>${esc(choice.label)}${choice.cost ? ` · ${esc(fareText({ fare: choice.cost }))}` : ''}</b><small>${esc(choice.hint || '')}${choice.chance !== null ? ` · ${esc(choice.chance)}% chance` : ''}</small>${choice.blocked ? `<small class="map-event-why">${esc(choice.blocked.reason)}</small>` : !view.connected ? '<small class="map-event-why">Offline — reconnect to answer.</small>' : ''}</button>`).join('')}</div>
      <p class="preview-note">Not answering is fine: this passes when you travel again${event.expiresIn ? `, or in about ${Math.max(1, Math.ceil(event.expiresIn / 60))} min` : ''}.</p></div>`;
  },
};

const roadsideChip = {
  id: 'roadside-chip', title: 'On the road', placement: 'hud', order: 5,
  render(state, view) {
    const event = view.travel?.event;
    return event ? `<button class="map-event-chip" data-open="roadside" data-event-key="${esc(`${event.id}:${event.at}`)}"><span aria-hidden="true">${esc(event.icon)}</span><span><b>${esc(event.title)}</b><small>Tap to answer</small></span></button>` : '';
  },
  bind(root, api) {
    const key = root.querySelector('[data-event-key]')?.dataset.eventKey;
    if (!key || key === shownEvent) return;
    shownEvent = key;
    // Raise the prompt once per event, after this render pass, and never over another open sheet.
    queueMicrotask(() => { if (!document.querySelector('dialog[open]')) api.open('roadside'); });
  },
};

export default [mapPanel, roadsidePanel, roadsideChip];
