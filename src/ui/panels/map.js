/**
 * OWNER: world
 * Map panel, plus the roadside-event prompt.
 *
 *   'map'            nav panel. The city map (src/map3d — the 3D miniature — or src/city-map.js,
 *                    the flat one) is the screen; this panel is a sheet beside it. Overview: a
 *                    handle (collapsed by default on a phone, so nothing covers the city), the
 *                    filter chips, and — when opened — the layer toggles and the list of every
 *                    place, the keyboard and screen-reader alternative to pointing at a building.
 *                    Once a place is picked on the map or in the list: the venue card with
 *                    hours, mode tiles, the trip line, Go, a copy-link share, and "About"
 *                    (description and things to do) folded away. Whatever stops the trip is said
 *                    ON the card, with the one-tap way out (Reconnect, Cancel, Trek instead).
 *                    WHILE A TRIP IS RUNNING the panel is a slim trip bar — from → to, how, the
 *                    time left and Cancel with the real cancel rule — and the map shows the trip.
 *                    On a wide screen the sheet is docked at the left and the list starts open.
 *                    "Nigeria map" swaps the backdrop to the country map (src/world-map.js).
 *                    Open with a destination: api.open('map', { destination: venueId }); with the
 *                    country map: api.open('map', { layer: 'world' }).
 *   'roadside'       modal with the pending roadside choice (state.travel.event).
 *   The HUD chip shown while a choice is pending ('roadside-chip') is ./roadside-chip.js.
 * This file is fetched the first time the Map (or the roadside prompt) is opened: the map panel group.
 *
 * Everything shown comes from view.travel (src/game/systems/travel.js). The panel talks to the
 * city map through the window event 'jaw:map-ui' { layer?, filter?, selected?, layers?, ads?,
 * neighbours?, gov? }.
 *
 * MAP LAYERS (Moving · Billboards · Sea · Neighbours · Gov). Each toggle draws one civic overlay
 * on the city map from its own server response, loaded through the civic panels' cache
 * (civic-ui.js): GET /api/civic/ads, /neighbours and /gov. The panel only passes the data on; the
 * map draws it. "Moving" has no data: it is street traffic, decorative only.
 * The panel contract is at the top of src/ui/shell.js.
 */
import './map.css';
import { esc, json, icon, mark, iconFor } from '../dom.js';
import { linkWords, linkButton } from '../link.js';
import { VENUE_CATEGORIES } from '../../game/content/venues.js';
import { chosenMode, fareText, fixButton, goBlock, modeIcon, statusClass, tripInfo, tripLine } from './world-ui.js';
import { entry, load } from './civic-ui.js';

const FILTERS = [{ id: 'all', label: 'All' }, { id: 'open', label: 'Open now' }, ...Object.values(VENUE_CATEGORIES)];
const CHIP_LIMIT = 9;

let destination = null, mode = null, seenParams = null, filter = 'all', layer = 'city', lastCity = null, showAll = false;
/** UI-only: is the list of places open (null = not chosen yet: open on a wide screen, a handle on a phone), is "About" open, and the last layout the map was told about. */
let listOpen = null, aboutOpen = false, lastLayout = '';
const layers = { lgas: true, homes: true, moving: false, billboards: false, sea: false, gov: false };
const LAYERS = [
  // The world layer: on from the start. The maps load only what is in view (src/map3d/world-data.js).
  { id: 'lgas', label: 'LGAs', icon: 'map' },
  { id: 'homes', label: 'Homes', icon: 'houses' },
  { id: 'moving', label: 'Moving', icon: 'bus', note: 'Street traffic — decoration only, it changes nothing in the game.' },
  { id: 'billboards', label: 'Billboards', icon: 'megaphone', key: 'ads', path: 'ads', open: 'ads', params: { tab: 'billboard' }, action: 'Rent a billboard' },
  { id: 'sea', label: 'Sea', icon: 'wave', key: 'ads', path: 'ads', open: 'ads', params: { tab: 'sea' }, action: 'Rent a sea plot' },
  { id: 'gov', label: 'Gov', icon: 'governor', key: 'gov', path: 'gov', open: 'state-house', action: 'Open the State House' },
];
const cacheKey = (item, view) => `${item.key}:${view.cityId}`;
const DATA_LAYERS = LAYERS.filter((item) => item.path);

const tell = (detail) => window.dispatchEvent(new CustomEvent('jaw:map-ui', { detail }));
const matches = (item) => item.kind !== 'soon' && (filter === 'all' || (filter === 'open' ? item.open : item.category === filter || item.kind === 'home'));
const wide = () => Boolean(globalThis.matchMedia?.('(min-width: 721px)').matches);
const isListOpen = () => (listOpen === null ? wide() : listOpen);

function overview(state, view) {
  const weather = view.health?.weather;
  const all = view.travel.destinations.filter((item) => item.kind !== 'soon');
  const places = view.travel.destinations.filter(matches);
  const open = isListOpen();
  const trip = state.activeAction?.kind === 'travel' ? view.travel.destinations.find((item) => item.id === state.activeAction.id) : null;
  const line = trip ? `On the way to ${trip.label}…` : `${weather ? `${weather.label} · ` : ''}${all.filter((item) => item.open).length} of ${all.length} places open`;
  const sky = !trip && weather ? `${iconFor('weather', weather.id, weather.icon)} ` : '';
  // The handle is the whole sheet when collapsed: the map behind it stays fully in view.
  const handle = `<button class="map-handle" data-map-sheet aria-expanded="${open}" aria-controls="map-list"><span class="map-grip" aria-hidden="true"></span><span class="map-handle-text"><b>${esc(view.city?.name || 'City')} map</b><small>${sky}${esc(line)}</small></span><span class="map-handle-cta">${icon('list')}<span>${open ? 'Hide list' : 'List'}</span></span></button>`;
  const filters = `<div class="map-filters" role="group" aria-label="Filter places">${FILTERS.map((item) => `<button data-map-filter="${esc(item.id)}" aria-pressed="${item.id === filter}" class="${item.id === filter ? 'is-selected' : ''}">${esc(item.label)}</button>`).join('')}</div>`;
  // The stamp makes the panel re-bind when a layer's data arrives, which is when the map is told.
  const on = LAYERS.filter((item) => layers[item.id]);
  const stamp = on.map((item) => `${item.id}:${item.path ? entry(cacheKey(item, view)).at : ''}`).join('|');
  const layerRow = `<div class="map-filters map-layers" role="group" aria-label="Map layers" data-map-stamp="${esc(stamp)}">${LAYERS.map((item) => `<button data-map-layer-toggle="${esc(item.id)}" aria-pressed="${layers[item.id]}" class="${layers[item.id] ? 'is-selected' : ''}">${mark(item.icon)}<span>${esc(item.label)}</span></button>`).join('')}</div>`;
  const layerNotes = on.map((item) => {
    if (!item.path) return item.note ? `<div class="map-layer-note"><span>${esc(item.note)}</span></div>` : '';
    const cached = entry(cacheKey(item, view));
    const status = cached.data ? '' : !view.connected ? `${linkWords(view).why} This layer cannot be loaded right now.` : cached.error ? `Could not load: ${cached.error}` : 'Loading…';
    if (!cached.data && !view.connected) return `<div class="map-layer-note"><span>${esc(status)}</span>${linkButton(view, 'map-chip-button')}</div>`;
    const summary = !cached.data ? status : item.id === 'billboards' ? `${cached.data.billboards.slots.filter((slot) => slot.ad).length} of ${cached.data.billboards.slots.length} billboards rented`
      : item.id === 'sea' ? `${cached.data.sea.plots.length} sea plot${cached.data.sea.plots.length === 1 ? '' : 's'} rented · shown in the water below the city`
        : cached.data.governor ? `Governor ${cached.data.governor.name}` : 'No Governor yet';
    return `<div class="map-layer-note"><span>${esc(summary)}</span><button class="map-chip-button" data-open="${esc(item.open)}" ${item.params ? `data-params="${json(item.params)}"` : ''}>${esc(item.action)}</button></div>`;
  }).join('');
  // The list is the alternative to the pins: every place, with where it is and whether it is open.
  const list = places.length
    ? `<ul class="map-list" aria-label="Places">${places.map((item) => `<li><button data-map-pick="${esc(item.id)}" class="${statusClass(item)}${item.here ? ' is-here' : ''}"><span aria-hidden="true">${iconFor('venue', item.id, item.icon)}</span><span class="map-list-text"><b>${esc(item.label)}</b><small>${esc(item.district)}</small></span><em>${esc(item.here ? 'You are here' : item.open ? 'Open' : 'Closed')}</em></button></li>`).join('')}</ul>`
    : `<div class="ui-empty"><span aria-hidden="true">${mark('search')}</span><h3>Nothing matches “${esc(FILTERS.find((item) => item.id === filter)?.label || filter)}” right now</h3><p>Closed places open again later in the day.</p><button class="ui-button is-primary" data-map-filter="all">Show every place</button></div>`;
  // What a switched-on layer shows stays readable with the list closed, where the layer itself is in view.
  return `<div class="map-panel map-overview ${open ? 'is-open' : 'is-collapsed'}">${handle}${filters}${open ? '' : layerNotes}<div class="map-more" id="map-list" ${open ? '' : 'hidden'}>${layerRow}${layerNotes}${list}<button class="map-chip-button map-world" data-map-layer="world">${mark('globe')}<span>Nigeria map · more cities soon</span></button></div></div>`;
}

function worldLayer(view) {
  // The atlas (src/map3d/geo/atlas.js) carries its own breadcrumb, list and sheet; the panel only names the screen for assistive technology.
  return `<h1 class="ui-sr">World map. ${esc(view.city?.name || 'Lagos')} is open; everything else is coming soon.</h1>`;
}

function card(state, view, item) {
  const chosen = chosenMode(item, mode, view.travel.defaultMode);
  const block = goBlock(state, view, item, chosen);
  const chips = showAll ? item.preview : item.preview.slice(0, CHIP_LIMIT);
  const more = item.preview.length - chips.length;
  const tiles = item.modes.map((option) => {
    // A tile is dead only when no mode can go there (closed, already here). Being busy or offline is said once, on the card.
    const off = item.blocked;
    return `<button data-map-mode="${esc(option.id)}" aria-pressed="${option === chosen}" class="${option === chosen ? 'is-selected' : ''}${option.blocked && !off ? ' is-short' : ''}" ${off ? `disabled title="${esc(off.reason)}"` : `title="${esc(option.blurb || '')}"`} aria-label="${esc(option.label)}, ${esc(fareText(option))}, ${esc(option.seconds)} seconds"><span aria-hidden="true">${modeIcon(option)}</span><b>${esc(option.label)}</b><small>${esc(fareText(option))}</small><small class="map-mode-time">${esc(option.seconds)}s</small></button>`;
  }).join('');
  const about = item.description || chips.length
    ? `<details class="ui-details map-about" ${aboutOpen ? 'open' : ''}><summary>About${item.preview.length ? ` · ${item.preview.length} things to do` : ''}</summary><p class="map-desc">${esc(item.description || '')}</p>${item.ambient ? `<p class="map-ambient">${esc(item.ambient)}</p>` : ''}${chips.length ? `<div class="map-chips" aria-label="Things to do here">${chips.map((label) => `<span>${esc(label)}</span>`).join('')}${more > 0 ? `<button data-map-more>+${more} more</button>` : ''}</div>` : ''}</details>` : '';
  return `<div class="map-panel map-card" role="region" aria-label="${esc(item.label)}">
    <header class="map-card-head"><button class="life-icon-button" data-map-pick="" aria-label="Back to the map and the list of places">${icon('back')}</button><span class="map-card-icon" aria-hidden="true">${iconFor('venue', item.id, item.icon)}</span><div><h1>${esc(item.label)}</h1><p>${esc(item.district)}${item.band ? ` · ${esc(item.band)}` : ''}</p></div>
      <button class="life-icon-button" data-map-share="${esc(item.id)}" aria-label="Copy a link to ${esc(item.label)}" title="Copy a link to ${esc(item.label)}">${icon('link')}</button></header>
    <p class="map-status ${statusClass(item)}"><b>${esc(item.status)}</b>${item.open && item.hours !== item.status ? ` <span>${esc(item.hours)}</span>` : ''}</p>
    ${item.modes.length ? `<div class="map-modes" role="group" aria-label="How to travel">${tiles}</div>` : ''}
    ${chosen && !item.blocked ? `<p class="map-trip">${esc(tripLine(chosen))}</p>` : ''}
    ${block ? `<div class="map-why is-${esc(block.code)}" role="note"><p>${esc(block.reason)}</p>${fixButton(block)}</div>` : ''}
    <button class="map-go" ${block || !chosen ? `disabled aria-label="Cannot go: ${esc(block?.label || 'unavailable')}"` : `data-action="travel" data-payload="${json({ id: item.id, mode: chosen.id })}"`}>${block ? esc(block.label) : `Go · ${esc(fareText(chosen))} <span aria-hidden="true">→</span>`}</button>
    ${item.id === 'state-house' ? `<button class="map-chip-button" data-open="state-house">${mark('governor')}<span>Who governs? Open the State House</span></button>` : item.id === 'polling-unit' ? `<button class="map-chip-button" data-open="governor">${mark('ballot')}<span>Election: candidates, voting and results</span></button>` : ''}
    ${about}
  </div>`;
}

/**
 * The trip bar: all there is of the panel while a trip runs, so the map — where the trip is
 * happening — stays in view. Cancel is the shell's own data-cancel; the rule beside it is the
 * server's (the fare was charged at departure and is not refunded).
 */
function tripBar(state, view) {
  const trip = tripInfo(state, view), left = Math.ceil(trip.remaining);
  const paid = trip.fare === null ? '' : trip.fare > 0 ? ` · ${fareText({ fare: trip.fare })} paid` : ' · Free';
  return `<div class="map-panel map-trip" role="group" aria-label="Travelling to ${esc(trip.to.label)}">
    <div class="map-trip-row"><span class="map-trip-mode" aria-hidden="true">${modeIcon(trip.mode)}</span>
      <div class="map-trip-text"><b>${esc(trip.from.label)} <span aria-hidden="true">→</span><span class="ui-sr"> to </span> ${esc(trip.to.label)}</b><small>${esc(trip.mode.label)}${esc(paid)} · <strong>${left}s left</strong></small></div>
      <button class="map-trip-cancel" data-cancel aria-label="Cancel the trip and stay at ${esc(trip.from.label)}">Cancel</button></div>
    <div class="map-trip-track" role="progressbar" aria-label="Trip progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(trip.fraction * 100)}"><i style="--from:${(trip.fraction * 100).toFixed(1)}%;animation-duration:${Math.max(0.05, trip.remaining).toFixed(2)}s"></i></div>
    <p class="map-trip-rule">${esc(trip.rule)}</p></div>`;
}

const mapPanel = {
  id: 'map', title: 'Map', placement: 'nav',
  render(state, view) {
    if (view.cityId !== lastCity) { lastCity = view.cityId; layer = 'city'; destination = null; }
    if (view.params && view.params !== seenParams) {
      seenParams = view.params;
      if ('destination' in view.params) { destination = view.params.destination ?? null; mode = null; showAll = false; layer = 'city'; }
      if (view.params.layer === 'world' || view.params.layer === 'city') layer = view.params.layer;
    }
    if (layer === 'world') return worldLayer(view);
    const item = view.travel.destinations.find((entry) => entry.id === destination);
    if (item) return card(state, view, item);
    return tripInfo(state, view) ? tripBar(state, view) : overview(state, view);
  },
  bind(root, api, params) {
    // Layers: load what is switched on (cached; never from a timer) and hand the map what there is.
    const view = api.view(), detail = { layers: { ...layers }, layer };
    for (const item of DATA_LAYERS.filter((option) => layers[option.id])) {
      load(api, cacheKey(item, view), `/api/civic/${item.path}?city=${view.cityId}`, { maxAge: 30000 });
      detail[item.key] = entry(cacheKey(item, view)).data;
    }
    // Opened for a place (the Home tab, a goal chip, "Go to work", a pin): highlight it on the city map too.
    if (params?.destination && params.destination === destination) detail.selected = destination;
    // The panel changed shape (list opened or closed, a card came or went): the map re-fits around it.
    const layout = `${layer}|${destination || ''}|${isListOpen()}|${LAYERS.filter((item) => layers[item.id]).length}|${Boolean(tripInfo(api.state(), view))}`;
    if (layout !== lastLayout) { lastLayout = layout; detail.layout = true; }
    tell(detail);
    root.querySelector('.map-about')?.addEventListener('toggle', (event) => { aboutOpen = event.currentTarget.open; });
    root.addEventListener('click', async (event) => {
      const hit = (name) => event.target.closest(`[data-map-${name}]`);
      const pick = hit('pick'), choose = hit('mode'), chip = hit('filter'), swap = hit('layer'), share = hit('share'), toggle = hit('layer-toggle');
      if (hit('sheet')) { listOpen = !isListOpen(); api.refresh(); return; }
      if (toggle) {
        const id = toggle.dataset.mapLayerToggle; layers[id] = !layers[id];
        if (layers[id] && !wide()) listOpen = false; // on a phone the list makes way, so the layer just switched on can be seen
        api.refresh(); tell({ layers: { ...layers } });
        return;
      }
      // Leaving on a trip clears the selection: the card makes way for the trip bar and the map shows the trip.
      // (The shell sends the action; if the server refuses it, its reason is a toast and the place is one tap away.)
      if (event.target.closest('[data-action="travel"]')) { destination = null; tell({ selected: null }); return; }
      const fix = event.target.closest('[data-travel-mode]');
      if (fix) { mode = fix.dataset.travelMode; api.refresh(); return; }
      if (pick) {
        destination = pick.dataset.mapPick || null; mode = null; showAll = false;
        if (destination && !wide()) listOpen = false; // on a phone the card replaces the list; going back shows the map, not the list
        api.refresh();
        tell({ selected: destination, layout: true });
      }
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
  /** Esc with a venue card open goes back to the map; a second Esc leaves the Map. */
  keys(action, api) {
    // On the world map Esc belongs to the atlas first: it closes its sheet, then goes up one level.
    if (action === 'cancel' && layer === 'world') { const offer = new CustomEvent('jaw:atlas-escape', { cancelable: true }); window.dispatchEvent(offer); return offer.defaultPrevented; }
    if (action !== 'cancel' || !destination || layer !== 'city') return false;
    destination = null; api.refresh(); tell({ selected: null, layout: true });
    return true;
  },
};

const roadsidePanel = {
  id: 'roadside', title: 'On the road', placement: 'modal',
  render(state, view) {
    const event = view.travel.event;
    if (!event) return `<p>Nothing is waiting for you by the roadside right now.</p><p>${esc(state.message || '')}</p><button class="ui-button is-primary" data-close>Carry on</button>`;
    return `<div class="map-event"><p class="map-event-icon" aria-hidden="true">${iconFor('event', event.id, event.icon)}</p><h3>${esc(event.title)}</h3><p>${esc(event.text)}</p>
      <div class="map-event-choices">${event.choices.map((choice) => `<button class="ui-button" data-action="world.roadside" data-payload="${json({ choice: choice.id })}" data-then="close" ${choice.blocked || !view.connected ? 'disabled' : ''}>
        <b>${esc(choice.label)}${choice.cost && !choice.label.includes(fareText({ fare: choice.cost })) ? ` · ${esc(fareText({ fare: choice.cost }))}` : ''}</b><small>${esc(choice.hint || '')}${choice.chance !== null ? ` · ${esc(choice.chance)}% chance` : ''}</small>${choice.blocked ? `<small class="map-event-why">${esc(choice.blocked.reason)}</small>` : !view.connected ? `<small class="map-event-why">${esc(linkWords(view).short)} — you cannot answer right now.</small>` : ''}</button>`).join('')}</div>
      <p class="preview-note">Not answering is fine: this passes when you travel again${event.expiresIn ? `, or in about ${Math.max(1, Math.ceil(event.expiresIn / 60))} min` : ''}.</p></div>`;
  },
};

export default [mapPanel, roadsidePanel];
