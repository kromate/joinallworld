/**
 * OWNER: world
 * In-city map: a static schematic of the city (mainland, island, lagoon, bridges) with one
 * labelled pin per venue, a Home pin and coming-soon pins. It is drawn behind the Map panel
 * (src/ui/panels/map.js), which holds the filter bar and the venue card.
 *
 * Contract (src/life-main.js calls exactly this):
 *   createCityMap(container, { onSelectVenue(venueId) }) → { setCity(cityId), setState(state), resize(), destroy(), ready }
 * `ready` is true while the city map should show and false while the Map panel has asked for
 * the world map (the city picker) instead — the host reads it on every render.
 *
 * The Map panel talks to this module through one window event, 'jaw:map-ui', with detail
 * { layer?: 'city' | 'world', filter?: string, selected?: venueId | null, layout?: true (the panel changed size),
 *   layers?: { billboards, sea, neighbours, gov }   which civic overlays to draw
 *   ads?, neighbours?, gov? }                        the server responses they are drawn from
 *
 * CIVIC OVERLAYS (drawn only while their layer is on, and only from server data)
 *   billboards  one board beside the venue each slot is `near`: the renter's colour, a fixed icon
 *               and their one line of text; a free slot shows "For rent".
 *   sea         the 16 x 16 grid of sea plots below the city, each rented plot in its colour with
 *               icon and text.
 *   neighbours  a cluster of player homes at each district, with who is online.
 *   gov         the State House and the Polling Unit are highlighted and the State House names
 *               the Governor; tapping the State House then opens the Governor sheet.
 * Every piece of player text here is set with textContent, never as markup, and no ad is a
 * link or a button: nothing a player typed can be clicked.
 *
 * PAN AND ZOOM. The whole city is fitted into the part of the screen the HUD and the Map panel
 * leave free when the map opens. Drag pans, a pinch or the wheel zooms about the point under
 * the fingers or the cursor, and the + / − / fit / find-me buttons do the same for anyone who
 * cannot. From the keyboard (forwarded by the shell as 'jaw:key'): arrows pan, + and − zoom,
 * 0 fits the city again. Zooming changes the size of the map, never of the pins: a label is
 * always the same readable size, and at a small scale only Home, where you are and the
 * selected place keep their labels (every pin is still a button with its full name). Labels of
 * pins near the left or right edge grow inwards, so none is cut off. Panning is clamped so the
 * city can never be dragged out of view.
 *
 * Static rendering only: the DOM is built once per city; class names change when the state
 * does and the transform changes when the player pans or zooms. No frame loop, no timers —
 * every redraw is the direct result of one input event.
 * Pins are real buttons in west-to-east reading order, so the map is keyboard reachable.
 * A link with ?venue=<id> opens that venue's card once the life has loaded.
 */
import './city-map.css';
import { VENUES, COMING_SOON, HOME_SPOTS, DEFAULT_HOME, CITY_MAPS, venueLabel, venueDistrict } from './game/content/venues.js';
import { isOpen } from './game/clock.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The backdrop: 1000 × 700 units, the same space venue map positions are given in. */
function backdrop(names) {
  const palm = (x, y) => `<g transform="translate(${x} ${y})"><path d="M0 0v-16" stroke="#7b6a4d" stroke-width="2.4"/><path d="M0-16c-9-6-15-3-18 2m18-2c9-6 15-3 18 2m-18-2c-3-9-10-11-15-9m15 9c3-9 10-11 15-9" fill="none" stroke="#3d8a5a" stroke-width="3" stroke-linecap="round"/></g>`;
  return `<svg class="cmap-art" viewBox="0 0 1000 700" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <rect width="1000" height="700" fill="#9ccfe0"/>
    <path d="M0 0h1000v262c-60 22-130 8-200 16-90 10-150 34-250 26-110-9-180-40-290-30C170 281 80 300 0 286Z" fill="#dfe8c9"/>
    <path d="M22 388c50-22 130-18 210-22 110-6 190 10 300 6 100-4 190-22 286-8 14 60 12 190-6 296-90 22-200 14-300 18-150 6-330 10-470-4-34-90-40-200-20-286Z" fill="#e6ecd2"/>
    <path d="M852 352c44-14 98-10 134 4 12 100 10 220-2 318-42 12-98 12-136 0-12-104-10-226 4-322Z" fill="#e2ead0"/>
    <path d="M24 62c30-12 70-10 96 2 6 40 4 76-4 104-30 10-66 8-92-2-8-36-8-72 0-104Z" fill="#f1e2ac" stroke="#d9b24a" stroke-width="2" stroke-dasharray="8 6"/>
    <path d="M18 620c34-10 96-8 124 4 6 22 4 44-4 62-40 8-90 8-122-2-6-22-6-44 2-64Z" fill="#f1e2ac" stroke="#d9b24a" stroke-width="2" stroke-dasharray="8 6"/>
    <g fill="none" stroke="#fbfaf2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M40 150c140-40 300 30 470 0s300-50 450-20" stroke-width="9"/>
      <path d="M150 70c20 60 10 140 30 200M440 40c-10 70 20 150 0 250M720 50c10 70-20 150 0 220" stroke-width="6"/>
      <path d="M60 470c160-20 300 30 460 0s200-30 290-10" stroke-width="9"/>
      <path d="M90 600c150 20 330-20 480 10s170 0 240-10" stroke-width="6"/>
      <path d="M250 380c10 90-10 190 10 300M520 380c-10 90 20 200 0 300" stroke-width="6"/>
      <path d="M910 370c-10 100 20 200 0 300" stroke-width="7"/>
    </g>
    <g stroke="#f5f1df" stroke-width="12" stroke-linecap="round"><path d="M250 284v100"/><path d="M620 300v74"/><path d="M806 500h52"/></g>
    <g stroke="#b9ad8a" stroke-width="2" stroke-dasharray="3 9" stroke-linecap="round"><path d="M250 284v100"/><path d="M620 300v74"/><path d="M806 500h52"/></g>
    ${[[70, 240], [330, 250], [560, 262], [900, 236], [120, 430], [420, 420], [700, 430], [640, 660], [300, 664], [960, 420], [950, 640]].map(([x, y]) => palm(x, y)).join('')}
    <g fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"><path d="M90 330q14-8 28 0t28 0M430 344q14-8 28 0t28 0M700 322q14-8 28 0t28 0"/></g>
    <g font-family="DM Sans, Arial, sans-serif" font-weight="800" letter-spacing="5" text-anchor="middle">
      <text x="500" y="226" font-size="24" fill="#66785a" fill-opacity=".5">${esc(names.north)}</text>
      <text x="420" y="340" font-size="17" fill="#2f6f86" fill-opacity=".75">${esc(names.water)}</text>
      <text x="420" y="540" font-size="24" fill="#66785a" fill-opacity=".5">${esc(names.south)}</text>
      <text x="918" y="470" font-size="15" fill="#66785a" fill-opacity=".6" letter-spacing="3">${esc(names.east)}</text>
    </g>
    <g font-family="DM Sans, Arial, sans-serif" font-size="11" font-weight="600" fill="#6b6247">
      <text x="238" y="322" text-anchor="end">${esc(names.bridges[0])}</text><text x="632" y="344">${esc(names.bridges[1])}</text><text x="832" y="492" text-anchor="middle">${esc(names.bridges[2])}</text>
    </g>
  </svg>`;
}

const HOMES_SHOWN = 12;
const W = 1000, H = 700;          // the map's own units (venue positions are percentages of this)
const LABEL_WIDTH = 720;          // below this many CSS pixels of map width, only the important labels show
const MAX_WIDTH = 2200;           // the furthest zoom, as map width in CSS pixels
const MARGIN = 28;                // how far past the free area the city may be dragged
const DRAG_START = 6;             // pixels a pointer must travel before a press becomes a drag
const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const ICON = (path) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

export function createCityMap(container, { onSelectVenue = () => {}, onSelectGov = () => {}, onSelectNeighbour = () => {} } = {}) {
  let cityId = 'lagos', state = null, layer = 'city', filter = 'all', selected = null, signature = '', built = false;
  let layers = { billboards: false, sea: false, neighbours: false, gov: false }, overlay = { ads: null, neighbours: null, gov: null }, overlayKey = '', seaPending = false;
  // The view: `scale` is CSS pixels per map unit, (x, y) is where the map's top-left corner sits in the container.
  let scale = 0, x = 0, y = 0, fitted = false, userMoved = false, shown = '';
  let deepLink = null;
  try { deepLink = new URLSearchParams(window.location.search).get('venue'); } catch { deepLink = null; }
  const root = document.createElement('div');
  root.className = 'cmap';
  container.appendChild(root);
  let view = null, worldNode = null, canvas = null, controls = {};

  const homeSpot = () => HOME_SPOTS[Object.hasOwn(HOME_SPOTS, state?.travel?.home) ? state.travel.home : DEFAULT_HOME];
  const places = () => [
    ...Object.values(VENUES).map((venue) => (venue.id === 'home' ? { ...venue, map: homeSpot().map, district: homeSpot().district, kind: 'home' } : { ...venue, kind: 'venue' })),
    ...Object.values(COMING_SOON).map((place) => ({ ...place, kind: 'soon' })),
  ].sort((a, b) => a.map.x - b.map.x || a.map.y - b.map.y);
  const pointOf = (id) => (id === 'home' ? homeSpot().map : (VENUES[id] || COMING_SOON[id])?.map);

  function build() {
    const names = CITY_MAPS[cityId] || CITY_MAPS.lagos;
    root.innerHTML = `<div class="cmap-view"><div class="cmap-world"><div class="cmap-canvas" role="group" aria-label="Map of the city. Choose a place to see it and travel there. Drag to move the map; plus and minus zoom; zero shows the whole city.">${backdrop(names)}${places().map((place) =>
      `<button type="button" class="cmap-pin is-${place.kind}" data-venue="${esc(place.id)}" data-category="${esc(place.category || place.kind)}"><span class="cmap-pin-icon" aria-hidden="true">${esc(place.icon)}</span><span class="cmap-pin-name">${esc(place.kind === 'home' ? 'Home' : venueLabel(place.id, cityId))}</span><span class="cmap-pin-note"></span></button>`).join('')}<div class="cmap-overlay" data-overlay></div></div><section class="cmap-sea" data-sea hidden aria-label="Sea plots"></section></div></div>
      <div class="cmap-controls" role="group" aria-label="Map view"><button type="button" data-cmap="in" aria-label="Zoom in">${ICON('<path d="M12 5v14M5 12h14"/>')}</button><button type="button" data-cmap="out" aria-label="Zoom out">${ICON('<path d="M5 12h14"/>')}</button><button type="button" data-cmap="fit" aria-label="Show the whole city">${ICON('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')}</button><button type="button" data-cmap="me" aria-label="Show where you are">${ICON('<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>')}</button></div>`;
    view = root.querySelector('.cmap-view'); worldNode = root.querySelector('.cmap-world'); canvas = root.querySelector('.cmap-canvas');
    controls = Object.fromEntries([...root.querySelectorAll('[data-cmap]')].map((node) => [node.dataset.cmap, node]));
    built = true; signature = ''; overlayKey = ''; fitted = false; userMoved = false; shown = '';
    update();
    drawOverlays();
    if (!container.hidden) fit();
  }

  // ---- the view: fit, clamp, pan, zoom -------------------------------------------------------

  /** The part of the container nothing covers: below the top bar, above the nav, clear of the Map panel. */
  function freeRect() {
    const page = container.getBoundingClientRect();
    const box = (selector) => { const rect = document.querySelector(selector)?.getBoundingClientRect(); return rect && rect.height ? rect : null; };
    const bar = box('.life-status'), nav = box('.life-nav'), panel = box('.map-panel');
    const isWide = page.width > 720;
    // Labels hang below their pins, so the bottom keeps room for the lowest one; a wide screen keeps the view controls clear.
    let left = 10, right = isWide ? 66 : 10, top = (bar ? bar.bottom - page.top : 56) + 10, bottom = (nav ? page.bottom - nav.top : 70) + 34;
    if (panel) {
      if (isWide) left = Math.max(left, panel.right - page.left + 14);            // docked at the side on a wide screen
      // A bottom sheet on a phone. A sheet that fills most of the screen (the open list) is in front of the map, not beside it.
      else if (panel.height < page.height * 0.6) bottom = Math.max(bottom, page.bottom - panel.top + 34);
    }
    const width = Math.max(120, page.width - left - right), height = Math.max(120, page.height - top - bottom);
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
  const fitScale = (free = freeRect()) => Math.min((free.width - 16) / W, (free.height - 16) / H);
  const worldHeight = () => (worldNode ? Math.max(H * scale, worldNode.offsetHeight) : H * scale);

  /** Keep the city in the free area: centred while it is smaller than it, otherwise never dragged past its edges. */
  function clamp(free = freeRect()) {
    const width = W * scale, height = worldHeight();
    x = width <= free.width ? free.left + (free.width - width) / 2 : Math.min(free.left + MARGIN, Math.max(free.right - MARGIN - width, x));
    y = height <= free.height ? free.top + (free.height - height) / 2 : Math.min(free.top + MARGIN, Math.max(free.bottom - MARGIN - height, y));
  }
  /** Write the view to the DOM. Called from input handlers only. */
  function apply() {
    if (!built) return;
    const free = freeRect(), smallest = fitScale(free);
    // Size first: the clamp below measures the world (city plus sea plots) at its new size.
    const size = `${Math.round(W * scale)}px`;
    if (canvas.style.width !== size) {
      canvas.style.width = size;
      canvas.style.height = `${Math.round(H * scale)}px`;
      worldNode.style.width = size;
    }
    clamp(free);
    const next = `${scale.toFixed(4)}|${Math.round(x)}|${Math.round(y)}|${userMoved}`;
    if (next === shown) return;
    shown = next;
    worldNode.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
    root.classList.toggle('is-compact', W * scale < LABEL_WIDTH);
    const atFit = scale <= smallest * 1.01, atMax = W * scale >= MAX_WIDTH - 1;
    setControl(controls.out, atFit, 'Zoom out', 'Already showing the whole city');
    setControl(controls.fit, atFit && !userMoved, 'Show the whole city', 'Already showing the whole city');
    setControl(controls.in, atMax, 'Zoom in', 'Already zoomed in as far as the map goes');
  }
  // A control that cannot do anything right now stays focusable and says why, instead of going dead.
  function setControl(node, off, label, why) {
    if (!node) return;
    node.setAttribute('aria-disabled', String(off));
    node.title = off ? why : label;
    node.setAttribute('aria-label', off ? `${label}. ${why}` : label);
  }
  function fit() {
    if (!built || container.hidden) return;
    const free = freeRect();
    scale = fitScale(free); x = 0; y = 0;
    fitted = true; userMoved = false;
    // With the sea plots showing, the city sits at the top and the sea is a drag away.
    apply();
  }
  /** Zoom by `factor` keeping the map point under (cx, cy) — container pixels — where it is. */
  function zoomAt(factor, cx, cy) {
    if (!fitted) fit();
    const free = freeRect();
    const next = Math.min(MAX_WIDTH / W, Math.max(fitScale(free), scale * factor));
    if (Math.abs(next - scale) < 1e-6) return;
    const px = cx ?? free.left + free.width / 2, py = cy ?? free.top + free.height / 2;
    x = px - ((px - x) / scale) * next;
    y = py - ((py - y) / scale) * next;
    scale = next; userMoved = true;
    apply();
  }
  function panBy(dx, dy) { if (!fitted) fit(); x += dx; y += dy; userMoved = true; apply(); }
  /** Bring a place into the free area, moving the map as little as possible. `centre` puts it in the middle instead. */
  function reveal(id, centre = false) {
    const point = pointOf(id);
    if (!built || container.hidden || !point) return;
    if (!fitted) fit();
    const free = freeRect(), px = x + (point.x / 100) * W * scale, py = y + (point.y / 100) * H * scale;
    const padX = Math.min(90, free.width / 3), padY = Math.min(70, free.height / 3);
    if (centre) { x += free.left + free.width / 2 - px; y += free.top + free.height / 2 - py; }
    else {
      if (px < free.left + padX) x += free.left + padX - px; else if (px > free.right - padX) x += free.right - padX - px;
      if (py < free.top + padY) y += free.top + padY - py; else if (py > free.bottom - padY) y += free.bottom - padY - py;
    }
    apply();
  }

  const pointers = new Map();
  let drag = null, pinch = null, suppressClick = false;
  function local(event) { const page = container.getBoundingClientRect(); return { x: event.clientX - page.left, y: event.clientY - page.top }; }
  function onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointers.set(event.pointerId, local(event));
    // A fresh press starts clean: only the click that ends a drag or a pinch is swallowed (see onClick).
    if (pointers.size === 1) { suppressClick = false; drag = { id: event.pointerId, from: local(event), x, y, moved: false }; pinch = null; }
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale };
      drag = null; suppressClick = true;
    }
  }
  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    const at = local(event);
    pointers.set(event.pointerId, at);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoomAt((pinch.scale * distance / pinch.distance) / scale, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    const dx = at.x - drag.from.x, dy = at.y - drag.from.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_START) return;
    if (!drag.moved) { drag.moved = true; suppressClick = true; root.classList.add('is-dragging'); try { view.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ } }
    x = drag.x + dx; y = drag.y + dy; userMoved = true;
    apply();
  }
  function onPointerUp(event) {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag?.id === event.pointerId) { drag = null; root.classList.remove('is-dragging'); }
  }
  function onWheel(event) {
    event.preventDefault();
    const at = local(event);
    zoomAt(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0018)), at.x, at.y);
  }
  /** Keyboard, forwarded by the shell: arrows pan, + and − zoom, 0 fits. Only while the map is the screen in front. */
  function onKey(event) {
    const { action, mode } = event.detail || {};
    if (mode !== 'map' || container.hidden || layer !== 'city') return;
    const step = 90;
    if (action === 'move-left') panBy(step, 0); else if (action === 'move-right') panBy(-step, 0);
    else if (action === 'move-up') panBy(0, step); else if (action === 'move-down') panBy(0, -step);
    else if (action === 'zoom-in') zoomAt(1.3); else if (action === 'zoom-out') zoomAt(1 / 1.3); else if (action === 'zoom-fit') fit();
  }
  function onControl(name) {
    if (name === 'in') zoomAt(1.4); else if (name === 'out') zoomAt(1 / 1.4); else if (name === 'fit') fit();
    else if (name === 'me' && state) { if (W * scale < LABEL_WIDTH) { scale = Math.min(MAX_WIDTH / W, LABEL_WIDTH / W * 1.05); userMoved = true; } reveal(state.location, true); }
  }

  /** Reflect the state in class names and labels. Touches the DOM only when something changed. */
  function update() {
    if (!built) return;
    const now = state?.t ?? 0, home = homeSpot();
    const going = state?.activeAction?.kind === 'travel' ? state.activeAction.id : null;
    const openIds = Object.values(VENUES).filter((venue) => isOpen(venue.hours, now)).map((venue) => venue.id).join(',');
    const next = [state?.location, going, home.map.x, home.map.y, filter, selected, openIds].join('|');
    if (next === signature) return;
    signature = next;
    for (const pin of root.querySelectorAll('.cmap-pin')) {
      const id = pin.dataset.venue, venue = VENUES[id], soon = !venue;
      const here = state?.location === id, open = venue ? isOpen(venue.hours, now) : false;
      const place = id === 'home' ? home.map : (venue || COMING_SOON[id]).map;
      pin.style.left = `${place.x}%`; pin.style.top = `${place.y}%`;
      // A label near the left or right edge grows inwards, so it is never cut off.
      pin.classList.toggle('is-edge-left', place.x < 13);
      pin.classList.toggle('is-edge-right', place.x > 87);
      const dimmed = filter === 'open' ? !open : filter !== 'all' && pin.dataset.category !== filter && id !== 'home';
      pin.classList.toggle('is-here', here);
      pin.classList.toggle('is-going', going === id);
      pin.classList.toggle('is-closed', !soon && !open);
      pin.classList.toggle('is-dimmed', dimmed && !here);
      pin.classList.toggle('is-selected', selected === id);
      const status = soon ? 'Coming soon' : here ? 'You are here' : going === id ? 'On the way' : open ? '' : 'Closed';
      // Closed is shown calmly: a grey pin and one quiet word, not a badge on every door.
      const note = pin.querySelector('.cmap-pin-note');
      note.textContent = status;
      note.className = `cmap-pin-note${status === 'Closed' ? ' is-quiet' : ''}`;
      const district = id === 'home' ? home.district : venueDistrict(id, cityId);
      pin.setAttribute('aria-label', `${id === 'home' ? 'Home' : venueLabel(id, cityId)}, ${district}${status ? `, ${status.toLowerCase()}` : ', open now'}`);
      pin.title = `${id === 'home' ? 'Home' : venueLabel(id, cityId)}${status ? ` · ${status}` : ''}`;
      if (here) pin.setAttribute('aria-current', 'location'); else pin.removeAttribute('aria-current');
    }
  }

  /** Rebuild the civic overlays when a layer or its data changed. Static: nothing here moves by itself. */
  function drawOverlays() {
    if (!built) return;
    const home = homeSpot();
    const next = JSON.stringify([layers, overlay, home.map]);
    if (next === overlayKey) return;
    overlayKey = next;
    const host = root.querySelector('[data-overlay]'), seaHost = root.querySelector('[data-sea]');
    const nodes = [];
    const ads = overlay.ads, colourOf = (id) => ads?.palette?.colours?.find((item) => item.id === id) || { bg: '#256b45', ink: '#ffffff' };
    const iconOf = (id) => ads?.palette?.icons?.find((item) => item.id === id)?.icon || '⭐';
    if (layers.billboards && ads) {
      for (const slot of ads.billboards.slots) {
        const venue = VENUES[slot.near];
        if (!venue) continue;
        const place = slot.near === 'home' ? home.map : venue.map;
        const board = make('div', `cmap-board${slot.ad ? '' : ' is-free'}`);
        board.style.left = `${place.x + 4.6}%`; board.style.top = `${place.y - 5.4}%`;
        if (slot.ad) {
          const colour = colourOf(slot.ad.colour);
          board.style.background = colour.bg; board.style.color = colour.ink;
          board.append(make('span', 'cmap-board-icon', iconOf(slot.ad.icon)), make('span', 'cmap-board-text', slot.ad.text));
          board.setAttribute('aria-label', `Billboard on ${slot.road}: ${slot.ad.text}, by ${slot.ad.by.name}`);
        } else {
          board.append(make('span', 'cmap-board-text', 'Billboard for rent'));
          board.setAttribute('aria-label', `Billboard on ${slot.road}: for rent`);
        }
        board.setAttribute('role', 'img');
        nodes.push(board);
      }
    }
    if (layers.neighbours && overlay.neighbours) {
      for (const group of overlay.neighbours.districts) {
        const spot = HOME_SPOTS[group.id];
        if (!spot || !group.count) continue;
        const hood = make('div', 'cmap-hood');
        hood.style.left = `${spot.map.x}%`; hood.style.top = `${spot.map.y + 7.5}%`;
        hood.append(make('span', 'cmap-hood-label', `${group.label} · ${group.count} home${group.count === 1 ? '' : 's'} · ${group.online} online`));
        const row = make('div', 'cmap-hood-homes');
        for (const item of group.homes.slice(0, HOMES_SHOWN)) {
          const house = make(item.you ? 'span' : 'button', `cmap-house${item.online ? ' is-online' : ''}${item.you ? ' is-you' : ''}`, '🏠');
          house.title = item.you ? `${item.name} (you)` : item.name;
          house.setAttribute('aria-label', `${item.name}${item.you ? ' (you)' : ''}, ${item.online ? 'online now' : 'not online'}`);
          if (!item.you) { house.type = 'button'; house.dataset.neighbour = item.id; house.dataset.name = item.name; }
          row.append(house);
        }
        const shown = Math.min(group.homes.length, HOMES_SHOWN);
        if (group.count > shown) row.append(make('span', 'cmap-hood-more', `+${group.count - shown}`));
        hood.append(row);
        nodes.push(hood);
      }
    }
    if (layers.gov && overlay.gov) {
      const seat = VENUES['state-house'];
      if (seat) {
        const label = make('div', 'cmap-gov', overlay.gov.governor ? `Governor ${overlay.gov.governor.name}` : 'No Governor yet');
        label.style.left = `${seat.map.x}%`; label.style.top = `${seat.map.y - 7.5}%`;
        nodes.push(label);
      }
    }
    host.replaceChildren(...nodes);
    for (const pin of root.querySelectorAll('.cmap-pin')) pin.classList.toggle('is-gov', layers.gov && ['state-house', 'polling-unit'].includes(pin.dataset.venue));
    // Sea plots: a block of open water below the city.
    seaHost.hidden = !(layers.sea && ads);
    shown = ''; // the world's height changes with the sea plots
    if (layers.sea && ads) {
      const sea = ads.sea, taken = new Map(sea.plots.map((plot) => [plot.slot, plot]));
      const grid = make('div', 'cmap-sea-grid');
      grid.style.gridTemplateColumns = `repeat(${sea.cols}, 1fr)`;
      for (let row = 0; row < sea.rows; row++) for (let col = 0; col < sea.cols; col++) {
        const plot = taken.get(`sea-${row}-${col}`);
        const cell = make('div', `cmap-plot${plot ? ' is-rented' : ''}${row < sea.shoreRows ? ' is-shore' : ''}`);
        if (plot) {
          const colour = colourOf(plot.colour);
          cell.style.background = colour.bg; cell.style.color = colour.ink;
          cell.append(make('span', 'cmap-plot-icon', iconOf(plot.icon)), make('span', 'cmap-plot-text', plot.text));
          cell.setAttribute('role', 'img'); cell.setAttribute('aria-label', `Sea plot ${row + 1}·${col + 1}: ${plot.text}, by ${plot.by.name}`);
          cell.title = `${plot.text} — ${plot.by.name}`;
        }
        grid.append(cell);
      }
      const names = CITY_MAPS[cityId] || CITY_MAPS.lagos;
      seaHost.replaceChildren(make('h2', 'cmap-sea-title', `${names.sea} · sea plots (${sea.plots.length} of ${sea.rows * sea.cols} rented)`), grid);
    } else seaHost.replaceChildren();
  }

  function onClick(event) {
    const control = event.target.closest('[data-cmap]');
    if (control) { if (control.getAttribute('aria-disabled') !== 'true') onControl(control.dataset.cmap); return; }
    if (suppressClick) { suppressClick = false; event.preventDefault(); return; }
    const house = event.target.closest('[data-neighbour]');
    if (house) { onSelectNeighbour({ id: house.dataset.neighbour, name: house.dataset.name }); return; }
    const pin = event.target.closest('.cmap-pin');
    if (!pin) return;
    selected = pin.dataset.venue;
    update();
    // With the Gov layer on, the State House opens the Governor sheet instead of the travel card.
    if (layers.gov && pin.dataset.venue === 'state-house') { onSelectGov(); return; }
    onSelectVenue(pin.dataset.venue);
  }
  function onUi(event) {
    const detail = event.detail || {};
    if (detail.layer === 'city' || detail.layer === 'world') layer = detail.layer;
    if (typeof detail.filter === 'string') filter = detail.filter;
    const picked = 'selected' in detail && detail.selected && detail.selected !== selected;
    if ('selected' in detail) selected = detail.selected || null;
    const seaWasOff = !layers.sea;
    if (detail.layers && typeof detail.layers === 'object') layers = { billboards: detail.layers.billboards === true, sea: detail.layers.sea === true, neighbours: detail.layers.neighbours === true, gov: detail.layers.gov === true };
    for (const key of ['ads', 'neighbours', 'gov']) if (key in detail) overlay[key] = detail[key] && typeof detail[key] === 'object' ? detail[key] : null;
    update();
    drawOverlays();
    if (container.hidden) return;
    // The panel changed size (collapsed, expanded, a card opened): the free area moved with it.
    if (!fitted || (detail.layout && !userMoved)) fit(); else apply();
    if (selected && (picked || detail.layout)) reveal(selected);
    // Turning the Sea layer on brings the plots into view once they are drawn.
    const sea = root.querySelector('[data-sea]');
    if (layers.sea && sea && !sea.hidden && (seaWasOff || seaPending)) {
      seaPending = false;
      if (W * scale < 640) scale = 640 / W;
      const free = freeRect();
      y = free.top + 40 - sea.offsetTop; userMoved = true;
      apply();
    } else if (layers.sea && seaWasOff) seaPending = true;
    if (!layers.sea) seaPending = false;
  }
  root.addEventListener('click', onClick);
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerUp);
  root.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('jaw:map-ui', onUi);
  window.addEventListener('jaw:key', onKey);
  build();

  return {
    get ready() { return layer === 'city'; },
    setCity(id) { if (id !== cityId || !built) { cityId = id; build(); } layer = 'city'; },
    setState(next) {
      state = next;
      update();
      drawOverlays();
      // A shared link opens its venue card once, after the life has loaded.
      if (deepLink) {
        const id = deepLink; deepLink = null;
        if (Object.hasOwn(VENUES, id) || Object.hasOwn(COMING_SOON, id)) { selected = id; update(); onSelectVenue(id); }
      }
    },
    /** The container was shown or changed size: fit the city the first time, afterwards only keep it in bounds. */
    resize() {
      if (!built || container.hidden) return;
      if (!fitted || !userMoved) fit(); else apply();
      if (selected) reveal(selected);
    },
    /** For tests and diagnostics: the current view. */
    view: () => ({ scale, x, y, fitted, compact: W * scale < LABEL_WIDTH }),
    destroy() { root.removeEventListener('click', onClick); window.removeEventListener('jaw:map-ui', onUi); window.removeEventListener('jaw:key', onKey); root.remove(); },
  };
}
