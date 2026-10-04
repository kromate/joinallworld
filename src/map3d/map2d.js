/**
 * OWNER: world
 * The flat ("Simple") city map: the SAME city as the 3D map, seen from straight above.
 * It is generated from the city pack (src/map3d/flat.js) — land, water, roads, bridges, local
 * governments, venues, homes and estates are the pack's, at the pack's coordinates — and it uses
 * the 3D map's own label, name-plate, chip and button styles (src/map3d/map3d.css), so switching
 * between the two is tilting one map. It is also the fallback where WebGL is missing or lost.
 *
 * Same contract as the 3D map (src/map3d/map3d.js):
 *   createMap2D(container, { pack, cityId, world, onSelectVenue, onSelectGov, onSelectLga, onSelectHouse })
 *     → { kind: '2d', ready, setState, setPlayer, resize, worldChanged, setFriends, focusEstate, focusPlot, focusLga, view, diagnostics, destroy }
 *
 * HOUSES are drawn on one <canvas> for the part of the city in view — density per estate when
 * zoomed out, plots and houses (wall, roof, the green light of an owner who is online) when an
 * estate is big enough on screen. No DOM node per house, at any population.
 *
 * NO FRAME LOOP, NO TIMERS: the DOM is built once; a redraw is the direct result of one input
 * event, one state or one piece of data arriving. A trip is a line along the real route and a dot
 * placed from the server's own `remaining ÷ duration` each time a state arrives.
 * Player text (ads) is written with textContent only and is never a link or a button.
 */
import { VENUES, COMING_SOON, venueLabel, venueDistrict } from '../game/content/venues.js';
import { openingInfo } from '../game/clock.js';
import { isDeparting } from '../game/registry.js';
import { ESTATE, PLOTS_PER_ESTATE, HOUSE_STYLE, unpackStyle } from '../game/content/world.js';
import { iconFor } from '../ui/icon-map.js';
import { buildNetwork, pointAt } from './roads.js';
import { flatModel, flatSvg } from './flat.js';
import { estateLayout, plotAt } from './estates.js';
import { lgaAt } from './lga.js';

const DRAG_START = 6, MAX_SCALE = 150, HOUSE_PIXELS = 6, MAX_DETAILED = 12;
const ICON = (path) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
let hintSeen = false;

export function createMap2D(container, { pack, cityId = pack.id, world = null, onSelectVenue = () => {}, onSelectGov = () => {}, onSelectLga = () => {}, onSelectHouse = () => {}, deepLink = null } = {}) {
  const network = buildNetwork(pack), model = flatModel(pack, network, { venues: VENUES, soon: COMING_SOON });
  const { box } = model, fit = pack.bounds.fit || { minX: box.x, maxX: box.x + box.width, minZ: box.z, maxZ: box.z + box.height };
  let state = null, layer = 'city', filter = 'all', selected = null, friends = new Set(), destroyed = false;
  let layers = { billboards: false, sea: false, neighbours: false, gov: false, moving: false, lgas: true, homes: true }, data = { ads: null, gov: null };
  let scale = 0, ox = 0, oy = 0, opened = false, userMoved = false, size = { width: 0, height: 0 }, insets = { left: 8, top: 60, right: 8, bottom: 80 }, labelKey = '', chipKey = '', drawn = [];
  let homeAt = null;

  const root = document.createElement('div');
  root.className = 'm3 m3-flat';
  root.innerHTML = `<div class="m3-flat-world">${flatSvg(model)}<svg class="m3-flat-trip" viewBox="${box.x} ${box.z} ${box.width} ${box.height}" preserveAspectRatio="none" aria-hidden="true"><path data-trip fill="none" stroke="#14532d" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path data-trip-top fill="none" stroke="#ffd166" stroke-width=".7" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <canvas class="m3-flat-houses" aria-hidden="true"></canvas>
    <div class="m3-labels" role="group" aria-label="Places in ${pack.name}. Choose one to see it and travel there. The list of places in the Map panel is the same thing as a list."></div>
    <div class="m3-controls" role="group" aria-label="Map view"><div class="m3-zoom"><button type="button" data-m3="in" aria-label="Zoom in" title="Zoom in">${ICON('<path d="M12 5v14M5 12h14"/>')}</button><button type="button" data-m3="out" aria-label="Zoom out" title="Zoom out">${ICON('<path d="M5 12h14"/>')}</button></div><div class="m3-go"><button type="button" class="m3-pill" data-m3="fit" aria-label="Show the whole city" title="Show the whole city">${ICON('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')}<span>Whole city</span></button><button type="button" class="m3-pill m3-me" data-m3="me" aria-label="Show where you are" title="Show where you are">${ICON('<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>')}<span>Find me</span></button></div></div>
    <p class="m3-hint" data-m3-hint ${hintSeen ? 'hidden' : ''}>Drag to move the map · pinch or scroll to zoom. Tap a place to go there.</p>`;
  container.appendChild(root);
  const worldNode = root.querySelector('.m3-flat-world'), canvas = root.querySelector('canvas'), labelLayer = root.querySelector('.m3-labels'), hint = root.querySelector('[data-m3-hint]');
  const lgaArt = root.querySelector('.m3-flat-lgas'), tripPaths = [root.querySelector('[data-trip]'), root.querySelector('[data-trip-top]')];
  const paint = canvas.getContext('2d');

  // ---- places, plates and tags: the 3D map's own markup, so the styles are literally shared -------
  const homeSpot = () => { const e = state?.estate; if (e?.living === 'own' && e.plot && pack.lgas?.some((lga) => lga.id === e.plot.lga)) return { ...estateLayout(pack, e.plot.lga).plot(e.plot.estate, e.plot.plot), district: pack.lgas.find((lga) => lga.id === e.plot.lga).name, own: true }; return model.homes[state?.travel?.home] ?? Object.values(model.homes)[0]; };
  const places = [...model.places, { id: 'home', kind: 'home', x: 0, z: 0 }].sort((a, b) => a.x - b.x || a.z - b.z);
  const labels = new Map(), plates = new Map(), tags = [], chips = new Map();
  for (const place of places) {
    const source = VENUES[place.id] || COMING_SOON[place.id];
    const node = document.createElement('button');
    node.type = 'button'; node.className = `m3-label is-${place.kind}`; node.dataset.venue = place.id;
    const icon = document.createElement('span'); icon.className = 'm3-label-icon'; icon.setAttribute('aria-hidden', 'true'); icon.innerHTML = iconFor('venue', place.id, source?.icon);
    const text = document.createElement('span'); text.className = 'm3-label-text';
    const name = document.createElement('b'), note = document.createElement('small');
    text.append(name, note); node.append(icon, text); labelLayer.append(node);
    labels.set(place.id, { node, name, note, place, width: 90, height: 30, priority: 0 });
  }
  for (const lga of pack.lgas || []) {
    const node = document.createElement('button');
    node.type = 'button'; node.className = 'm3-lga'; node.dataset.lga = lga.id;
    const name = document.createElement('b'), note = document.createElement('small');
    name.textContent = lga.name; node.append(name, note); labelLayer.append(node);
    plates.set(lga.id, { node, note, lga });
  }
  for (let i = 0; i < 14; i++) { const node = document.createElement('div'); node.className = 'm3-tag'; node.hidden = true; node.setAttribute('aria-hidden', 'true'); labelLayer.append(node); tags.push(node); }
  const you = document.createElement('div');
  you.className = 'm3-you'; you.hidden = true; you.setAttribute('aria-hidden', 'true'); you.textContent = 'You';
  labelLayer.append(you);

  const project = (x, z) => ({ x: ox + (x - box.x) * scale, y: oy + (z - box.z) * scale });
  const ground = (px, py) => ({ x: box.x + (px - ox) / scale, z: box.z + (py - oy) / scale });
  const spotOf = (id) => (id === 'home' ? homeAt : labels.get(id)?.place) || null;
  const nameOf = (id) => (id === 'home' ? 'Home' : venueLabel(id, cityId));
  const ownPlot = () => { const plot = state?.estate?.plot; return plot && pack.lgas?.some((lga) => lga.id === plot.lga) ? plot : null; };

  function updateLabels() {
    const at = state?.t ?? 0, going = isDeparting(state) && state.activeAction.id !== state.location ? state.activeAction.id : null;
    homeAt = homeSpot();
    const next = JSON.stringify([state?.location, going, homeAt.x, homeAt.z, filter, selected, layers.gov, Object.values(VENUES).map((venue) => openingInfo(venue.hours, at).status)]);
    if (next === labelKey) return;
    labelKey = next;
    for (const [id, label] of labels) {
      const venue = VENUES[id], soon = label.place.kind === 'soon';
      const opening = venue ? openingInfo(venue.hours, at) : null, open = Boolean(opening?.open), here = state?.location === id;
      const status = soon ? 'Coming soon' : here ? (going ? 'Leaving from here' : 'You are here') : going === id ? 'On the way' : open ? '' : opening?.opensAt ? `opens ${opening.opensAt}` : 'Closed';
      const dimmed = soon ? filter !== 'all' : filter === 'open' ? !open : filter !== 'all' && venue.category !== filter && id !== 'home';
      const district = id === 'home' ? homeAt.district : venueDistrict(id, cityId);
      label.name.textContent = nameOf(id); label.note.textContent = status;
      label.node.className = `m3-label is-${label.place.kind}${here ? ' is-here' : ''}${going === id ? ' is-going' : ''}${!soon && !open ? ' is-closed' : ''}${dimmed && !here ? ' is-dimmed' : ''}${selected === id ? ' is-selected' : ''}${layers.gov && (id === 'state-house' || id === 'polling-unit') ? ' is-gov' : ''}`;
      label.node.setAttribute('aria-label', `${nameOf(id)}, ${district}${status ? `, ${status.toLowerCase()}` : ', open now'}`);
      label.node.title = `${nameOf(id)}${status ? ` · ${status}` : ''}`;
      if (here) label.node.setAttribute('aria-current', 'location'); else label.node.removeAttribute('aria-current');
      label.priority = (here ? 100 : 0) + (selected === id ? 90 : 0) + (going === id ? 80 : 0) + (id === 'home' ? 40 : 0) + (soon ? 5 : open ? 20 : 10) - (dimmed ? 30 : 0);
      label.width = label.node.offsetWidth || 90; label.height = label.node.offsetHeight || 30;
    }
  }
  function updatePlates() {
    const summary = world?.summary() ?? null, own = state?.estate?.lga ?? null;
    for (const [id, plate] of plates) {
      const counts = summary?.get(id);
      plate.note.textContent = counts ? `${counts.houses.toLocaleString('en-NG')} home${counts.houses === 1 ? '' : 's'}${counts.online ? ` · ${counts.online.toLocaleString('en-NG')} online` : ''}` : '';
      plate.node.classList.toggle('is-own', id === own);
      plate.node.setAttribute('aria-label', `${plate.lga.name} local government${id === own ? ', yours' : ''}${counts ? `, ${counts.houses} homes, ${counts.online} online` : ''}. Open its page.`);
    }
    for (const node of lgaArt.querySelectorAll('[data-lga]')) { const mine = node.dataset.lga === own; node.setAttribute('fill-opacity', mine ? '.58' : '.34'); node.setAttribute('stroke-width', mine ? '1.1' : '.5'); node.setAttribute('stroke', mine ? '#14532d' : '#46544a'); }
  }
  function syncChips() {
    const list = [], ads = data.ads;
    const colourOf = (id) => ads?.palette?.colours?.find((item) => item.id === id) || { bg: '#256b45', ink: '#ffffff' };
    if (layers.billboards && ads?.billboards) for (const slot of ads.billboards.slots) {
      const at = spotOf(slot.near);
      if (!at) continue;
      const colour = slot.ad ? colourOf(slot.ad.colour) : null;
      list.push({ key: `board:${slot.slot}`, kind: slot.ad ? 'board' : 'board-free', x: at.x + 5.2, z: at.z - 3.2, glyph: iconFor('ad', slot.ad?.icon ?? 'megaphone', '📢'), text: slot.ad ? slot.ad.text : '', bg: colour?.bg, ink: colour?.ink, label: slot.ad ? `Billboard on ${slot.road}: ${slot.ad.text}, by ${slot.ad.by.name}` : `Billboard on ${slot.road}: for rent` });
    }
    if (layers.sea && ads?.sea && model.sea) list.push({ key: 'sea-title', kind: 'title', x: (model.sea.x0 + model.sea.x1) / 2, z: model.sea.z0 - 2.5, glyph: iconFor('ad', 'sea', '🌊'), text: `Sea plots · ${ads.sea.plots.length} of ${ads.sea.rows * ads.sea.cols} rented`, label: `Sea plots: ${ads.sea.plots.length} of ${ads.sea.rows * ads.sea.cols} rented` });
    if (layers.gov && data.gov) { const seat = spotOf('state-house'); if (seat) list.push({ key: 'gov', kind: 'gov', lift: 40, x: seat.x, z: seat.z, glyph: iconFor('panel', 'governor', '🏛️'), text: data.gov.governor ? `Governor ${data.gov.governor.name}` : 'No Governor yet', label: data.gov.governor ? `The Governor is ${data.gov.governor.name}` : 'There is no Governor yet' }); }
    const next = JSON.stringify(list.map((chip) => [chip.key, chip.text, chip.bg]));
    if (next === chipKey) return;
    chipKey = next;
    for (const { node } of chips.values()) node.remove();
    chips.clear();
    for (const chip of list) {
      const node = document.createElement('div');
      node.className = `m3-chip is-${chip.kind}`; node.setAttribute('role', 'img'); node.setAttribute('aria-label', chip.label);
      if (chip.bg) { node.style.background = chip.bg; node.style.color = chip.ink; }
      const icon = document.createElement('span'); icon.className = 'm3-chip-icon'; icon.innerHTML = chip.glyph || ''; node.append(icon);
      if (chip.text) { const text = document.createElement('span'); text.className = 'm3-chip-text'; text.textContent = chip.text; node.append(text); }   // player text: text, never markup
      labelLayer.append(node);
      chips.set(chip.key, { node, chip });
    }
  }

  // ---- the houses, on one canvas ------------------------------------------------------------------
  function drawHouses() {
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(size.width * ratio) || canvas.height !== Math.round(size.height * ratio)) { canvas.width = Math.round(size.width * ratio); canvas.height = Math.round(size.height * ratio); }
    paint.setTransform(ratio, 0, 0, ratio, 0, 0);
    paint.clearRect(0, 0, size.width, size.height);
    drawn = [];
    const summary = world?.summary() ?? null, a = ground(0, 0), b = ground(size.width, size.height), own = ownPlot(), now = state?.t ?? 0;
    if (layers.sea && data.ads?.sea && model.sea) {
      const sea = data.ads.sea, taken = new Map(sea.plots.map((plot) => [plot.slot, plot])), stepX = (model.sea.x1 - model.sea.x0) / sea.cols, stepZ = (model.sea.z1 - model.sea.z0) / sea.rows;
      for (let row = 0; row < sea.rows; row++) for (let col = 0; col < sea.cols; col++) {
        const plot = taken.get(`sea-${row}-${col}`), at = project(model.sea.x0 + col * stepX, model.sea.z0 + row * stepZ);
        paint.fillStyle = plot ? (data.ads.palette?.colours?.find((item) => item.id === plot.colour)?.bg ?? '#256b45') : row < sea.shoreRows ? '#e8f6f8cc' : '#c2e6eecc';
        paint.fillRect(at.x + 1, at.y + 1, stepX * scale - 2, stepZ * scale - 2);
      }
    }
    if (layers.homes && pack.lgas?.length) {
      const centre = ground(insets.left + (size.width - insets.left - insets.right) / 2, insets.top + (size.height - insets.top - insets.bottom) / 2), detail = [];
      for (const lga of pack.lgas) {
        const xs = lga.polygon.map((point) => point[0]), zs = lga.polygon.map((point) => point[1]);
        if (Math.max(...xs) < a.x || Math.min(...xs) > b.x || Math.max(...zs) < a.z || Math.min(...zs) > b.z) continue;
        const layout = estateLayout(pack, lga.id), occ = summary?.get(lga.id)?.occ;
        for (let i = 0; i < ESTATE.estates; i++) {
          const cell = layout.cells[i], half = cell.size / 2;
          if (cell.x + half < a.x || cell.x - half > b.x || cell.z + half < a.z || cell.z - half > b.z) continue;
          const houses = occ?.[i] ?? 0, big = layout.pitch(i) * scale >= HOUSE_PIXELS;
          if (big) { detail.push({ lga: lga.id, estate: i, cell, layout, far: Math.hypot(cell.x - centre.x, cell.z - centre.z), houses }); continue; }
          if (!houses && i !== 0 && cell.size * scale < 5) continue;
          // Density: the estate as one pad, redder the fuller it is.
          const at = project(cell.x - half * 0.92, cell.z - half * 0.92), fill = houses / PLOTS_PER_ESTATE;
          paint.fillStyle = houses ? `rgb(${Math.round(239 - 58 * (0.2 + fill * 0.65))},${Math.round(227 - 138 * (0.2 + fill * 0.65))},${Math.round(198 - 138 * (0.2 + fill * 0.65))})` : '#d3dfb6';
          paint.fillRect(at.x, at.y, cell.size * 0.92 * scale, cell.size * 0.92 * scale);
        }
      }
      detail.sort((p, q) => p.far - q.far);
      for (const item of detail.slice(0, MAX_DETAILED)) {
        const pitch = item.layout.pitch(item.estate) * scale, loaded = world?.estate(item.lga, item.estate);
        drawn.push({ lga: item.lga, estate: item.estate });
        for (let plot = 0; plot < PLOTS_PER_ESTATE; plot++) {
          const spot = item.layout.plot(item.estate, plot), at = project(spot.x, spot.z), house = loaded?.houses.get(plot);
          const mine = own && own.lga === item.lga && own.estate === item.estate && own.plot === plot;
          paint.fillStyle = mine ? '#ffe08a' : house ? '#e9e4d2' : '#cdd9b2';
          paint.fillRect(at.x - pitch * 0.45, at.y - pitch * 0.45, pitch * 0.9, pitch * 0.9);
          if (!house) continue;
          const { style } = unpackStyle(house.s), w = pitch * 0.56;
          paint.fillStyle = HOUSE_STYLE.wall[style.wall].hex; paint.fillRect(at.x - w / 2, at.y - w / 2, w, w);
          paint.fillStyle = HOUSE_STYLE.roof[style.roof].hex; paint.fillRect(at.x - w / 2, at.y - w / 2, w, w * 0.62);
          if (style.fence) { paint.strokeStyle = HOUSE_STYLE.fence[style.fence].hex; paint.lineWidth = Math.max(1, pitch * 0.05); paint.strokeRect(at.x - pitch * 0.42, at.y - pitch * 0.42, pitch * 0.84, pitch * 0.84); }
          if (house.u > now) { paint.strokeStyle = '#c9a35a'; paint.lineWidth = Math.max(1, pitch * 0.06); paint.strokeRect(at.x - w * 0.6, at.y - w * 0.6, w * 1.2, w * 1.2); }
          if (house.online) { paint.fillStyle = '#33d17a'; paint.beginPath(); paint.arc(at.x + w * 0.42, at.y - w * 0.42, Math.max(2, pitch * 0.13), 0, Math.PI * 2); paint.fill(); }
        }
      }
      if (own) { const spot = estateLayout(pack, own.lga).plot(own.estate, own.plot), at = project(spot.x, spot.z), r = Math.max(9, estateLayout(pack, own.lga).pitch(own.estate) * scale * 0.7); paint.strokeStyle = '#e8a643'; paint.lineWidth = 3; paint.beginPath(); paint.arc(at.x, at.y, r, 0, Math.PI * 2); paint.stroke(); }
    }
  }

  // ---- the view --------------------------------------------------------------------------------
  function measure() {
    const page = container.getBoundingClientRect();
    const rect = (selector) => { const found = document.querySelector(selector)?.getBoundingClientRect(); return found && found.height ? found : null; };
    const bar = rect('.life-status'), nav = rect('.life-nav'), panel = rect('.map-panel'), wide = page.width > 720;
    let left = 8, right = wide ? 64 : 8, top = (bar ? bar.bottom - page.top : 56) + 8, bottom = (nav ? page.bottom - nav.top : 70) + 10;
    if (panel) { if (wide) left = Math.max(left, panel.right - page.left + 12); else if (panel.height < page.height * 0.62) bottom = Math.max(bottom, page.bottom - panel.top + 10); }
    size = { width: page.width, height: page.height }; insets = { left, top, right, bottom };
    container.style?.setProperty('--map-dock', `${Math.round(bottom)}px`);
    root.style.setProperty('--m3-dock', `${Math.round(bottom)}px`); root.style.setProperty('--m3-left', `${Math.round(left)}px`); root.style.setProperty('--m3-top', `${Math.round(top)}px`);
    return page.width > 0 && page.height > 0 && !container.hidden;
  }
  const free = () => ({ width: Math.max(80, size.width - insets.left - insets.right), height: Math.max(80, size.height - insets.top - insets.bottom) });
  const fitScale = () => Math.min(free().width / (fit.maxX - fit.minX), free().height / (fit.maxZ - fit.minZ));
  function centreOn(x, z) { const area = free(); ox = insets.left + area.width / 2 - (x - box.x) * scale; oy = insets.top + area.height / 2 - (z - box.z) * scale; }
  function whole() { scale = fitScale(); centreOn((fit.minX + fit.maxX) / 2, (fit.minZ + fit.maxZ) / 2); userMoved = false; }
  function near(at) { scale = Math.max(fitScale(), free().width / 58); centreOn(at.x, at.z); }
  function open() { opened = true; userMoved = false; if (size.width > 720) whole(); else near(spotOf(state?.location) || homeSpot()); }
  function apply() {
    if (!scale) return;
    scale = clamp(scale, fitScale() * 0.8, MAX_SCALE);
    // Most of the city always stays in reach.
    const area = free(), keepX = area.width * 0.4, keepY = area.height * 0.4;
    ox = clamp(ox, insets.left + keepX - (fit.maxX - box.x) * scale, insets.left + area.width - keepX - (fit.minX - box.x) * scale);
    oy = clamp(oy, insets.top + keepY - (Math.max(fit.maxZ, model.sea ? model.sea.z1 : fit.maxZ) - box.z) * scale, insets.top + area.height - keepY - (fit.minZ - box.z) * scale);
    worldNode.style.width = `${box.width * scale}px`; worldNode.style.height = `${box.height * scale}px`;
    worldNode.style.transform = `translate(${Math.round(ox)}px,${Math.round(oy)}px)`;
    const far = scale < 3.2;
    root.classList.toggle('is-far', far);
    lgaArt.style.display = layers.lgas ? '' : 'none';
    placeLabels(far);
    drawHouses();
  }
  function placeLabels(far) {
    const entries = [...labels.values()].map((label) => { const spot = spotOf(label.place.id); const at = project(spot.x, spot.z - (label.place.id === 'home' && homeAt.own ? 0 : 2.2)); return { label, at, visible: at.x > -60 && at.x < size.width + 60 && at.y > -20 && at.y < size.height + 80 }; });
    entries.sort((p, q) => q.label.priority - p.label.priority || q.at.y - p.at.y);
    const taken = [], hits = (rect) => taken.some((other) => rect.l < other.r && rect.r > other.l && rect.t < other.b && rect.b > other.t);
    for (const { label, at, visible } of entries) {
      const node = label.node;
      if (node.hidden === visible) node.hidden = !visible;
      if (!visible) continue;
      const full = { l: at.x - label.width / 2 - 3, r: at.x + label.width / 2 + 3, t: at.y - label.height - 2, b: at.y + 2 }, compact = hits(full);
      taken.push(compact ? { l: at.x - 15, r: at.x + 15, t: at.y - 30, b: at.y } : full);
      node.classList.toggle('is-compact', compact);
      node.style.transform = `translate(${Math.round(at.x)}px,${Math.round(at.y)}px) translate(-50%,-100%)`;
    }
    for (const { node, lga } of plates.values()) {
      const at = project(lga.plate[0], lga.plate[1]), visible = layers.lgas && at.x > -80 && at.x < size.width + 80 && at.y > insets.top - 10 && at.y < size.height + 30 && scale < 26;
      if (node.hidden === visible) node.hidden = !visible;
      if (visible) node.style.transform = `translate(${Math.round(at.x)}px,${Math.round(at.y)}px) translate(-50%,-50%)`;
    }
    for (const { node, chip } of chips.values()) {
      const at = project(chip.x, chip.z), visible = at.x > -40 && at.x < size.width + 40 && at.y > 0 && at.y < size.height + 40 && !(far && chip.kind === 'board-free');
      if (node.hidden === visible) node.hidden = !visible;
      if (visible) node.style.transform = `translate(${Math.round(at.x)}px,${Math.round(at.y - (chip.lift || 0))}px) translate(-50%,-100%)`;
    }
    // House tags: yours, and friends' in the estates drawn as houses.
    const wanted = [], own = layers.homes ? ownPlot() : null;
    if (own && !homeAt?.own) wanted.push({ ...own, text: 'Your house', kind: 'own' });
    if (layers.homes && friends.size) for (const item of drawn) for (const house of world?.estate(item.lga, item.estate)?.houses.values() ?? []) if (house.id && friends.has(house.id) && wanted.length < tags.length) wanted.push({ lga: item.lga, estate: item.estate, plot: house.p, text: house.name, kind: house.online ? 'friend is-online' : 'friend' });
    tags.forEach((node, i) => {
      const item = wanted[i], spot = item ? estateLayout(pack, item.lga).plot(item.estate, item.plot) : null, at = spot ? project(spot.x, spot.z) : null;
      const visible = Boolean(at) && at.x > 0 && at.x < size.width && at.y > insets.top && at.y < size.height;
      if (node.hidden === visible) node.hidden = !visible;
      if (!visible) return;
      if (node.textContent !== item.text) node.textContent = item.text;
      node.className = `m3-tag is-${item.kind}`;
      node.style.transform = `translate(${Math.round(at.x)}px,${Math.round(at.y)}px) translate(-50%,-100%)`;
    });
    placeTrip();
  }
  /** The trip: the real route as a line, and the traveller placed from the server's own progress. No script moves it. */
  let tripKey = '', tripRoute = null;
  function placeTrip() {
    const active = isDeparting(state) && (state.activeAction.kind === 'travel' || state.activeAction.kind === 'commute') ? state.activeAction : null;
    const key = (id) => (id === 'home' ? (homeAt?.own ? 'home:own' : `home:${state?.travel?.home}`) : id);
    const next = active ? `${state.location}>${active.id}` : '';
    if (next !== tripKey) {
      tripKey = next;
      if (active && homeAt?.own) network.attachPlace('home:own', { x: homeAt.x, z: homeAt.z });
      tripRoute = active ? network.route(key(state.location), key(active.id)) : null;
      const from = active ? spotOf(state.location) : null, to = active ? spotOf(active.id) : null;
      if (active && !tripRoute && from && to) { const length = Math.hypot(to.x - from.x, to.z - from.z) || 1; tripRoute = { points: [{ x: from.x, y: 0, z: from.z }, { x: to.x, y: 0, z: to.z }], lengths: [0, length], length }; }
      const d = tripRoute ? tripRoute.points.map((point, i) => `${i ? 'L' : 'M'}${point.x.toFixed(2)} ${point.z.toFixed(2)}`).join('') : '';
      for (const node of tripPaths) node.setAttribute('d', d);
    }
    you.hidden = !tripRoute;
    if (!tripRoute) return;
    const done = clamp(1 - active.remaining / (active.duration || 1), 0, 1), spot = pointAt(tripRoute, tripRoute.length * done), at = project(spot.x, spot.z);
    you.style.transform = `translate(${Math.round(at.x)}px,${Math.round(at.y)}px) translate(-50%,-100%)`;
  }
  function layout() { if (!measure()) return false; if (!opened) open(); else if (!userMoved && size.width > 720 && !isDeparting(state)) whole(); apply(); return true; }
  function zoomAt(factor, px, py) {
    const before = ground(px, py);
    scale = clamp(scale * factor, fitScale() * 0.8, MAX_SCALE);
    ox = px - (before.x - box.x) * scale; oy = py - (before.z - box.z) * scale;
    userMoved = true; apply();
  }
  const middle = () => ({ x: insets.left + free().width / 2, y: insets.top + free().height / 2 });
  function dismissHint() { hintSeen = true; if (!hint.hidden) hint.hidden = true; }

  // ---- input -------------------------------------------------------------------------------------
  const pointers = new Map();
  let drag = null, pinch = null, suppressClick = false;
  const local = (event) => { const page = container.getBoundingClientRect(); return { x: event.clientX - page.left, y: event.clientY - page.top }; };
  function onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.target.closest('[data-m3]')) return;
    if (event.isPrimary) pointers.clear();
    pointers.set(event.pointerId, local(event));
    if (pointers.size === 1) { suppressClick = false; drag = { id: event.pointerId, from: local(event), ox, oy, moved: false, onControl: Boolean(event.target.closest('.m3-label,.m3-lga')) }; pinch = null; }
    else if (pointers.size === 2) { const [p, q] = [...pointers.values()]; pinch = { distance: Math.hypot(p.x - q.x, p.y - q.y) || 1, mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } }; drag = null; suppressClick = true; }
  }
  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    const at = local(event);
    pointers.set(event.pointerId, at);
    if (pinch && pointers.size >= 2) {
      const [p, q] = [...pointers.values()], distance = Math.hypot(p.x - q.x, p.y - q.y) || 1, mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      ox += mid.x - pinch.mid.x; oy += mid.y - pinch.mid.y;
      zoomAt(distance / pinch.distance, mid.x, mid.y);
      pinch.distance = distance; pinch.mid = mid; dismissHint();
      return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    const dx = at.x - drag.from.x, dy = at.y - drag.from.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_START) return;
    if (!drag.moved) { drag.moved = true; suppressClick = true; root.classList.add('is-dragging'); dismissHint(); try { root.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ } }
    ox = drag.ox + dx; oy = drag.oy + dy; userMoved = true;
    apply();
  }
  function onPointerUp(event) {
    if (!pointers.delete(event.pointerId)) return;
    if (drag?.id === event.pointerId) { if (!drag.moved && !drag.onControl && event.type !== 'pointercancel') tap(event); drag = null; }
    if (pinch && pointers.size < 2) { pinch = null; const [rest] = [...pointers.entries()]; if (rest) drag = { id: rest[0], from: rest[1], ox, oy, moved: true }; }
    if (!pointers.size) root.classList.remove('is-dragging');
  }
  /** A tap on the ground: a house opens its owner's card, an estate is zoomed into, a local government opens its page. */
  function tap(event) {
    if (!pack.lgas?.length) return;
    const at = local(event), point = ground(at.x, at.y), lga = lgaAt(pack, point.x, point.z);
    if (!lga) return;
    dismissHint();
    const layout = estateLayout(pack, lga), hit = layers.homes ? plotAt(layout, point.x, point.z) : null;
    if (hit && hit.plot >= 0 && drawn.some((item) => item.lga === lga && item.estate === hit.estate)) {
      const house = world?.estate(lga, hit.estate)?.houses.get(hit.plot);
      if (house) { onSelectHouse({ lga, estate: hit.estate, plot: hit.plot, id: house.id ?? null, name: house.name ?? null, online: Boolean(house.online), you: Boolean(house.you), style: house.s, upgrading: house.u > (state?.t ?? 0) }); return; }
    }
    const occupied = hit && ((world?.summary()?.get(lga)?.occ?.[hit.estate] ?? 0) > 0 || hit.estate === 0);
    if (occupied && layout.pitch(hit.estate) * scale < HOUSE_PIXELS) { api.focusEstate(lga, hit.estate); return; }
    if (layers.lgas) onSelectLga(lga);
  }
  function onWheel(event) {
    event.preventDefault();
    const at = local(event), delta = event.deltaY * (event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? 320 : 1);
    dismissHint();
    zoomAt(Math.exp(-clamp(delta, -240, 240) * (event.ctrlKey ? 0.01 : 0.0018)), at.x, at.y);
  }
  function choose(id) {
    selected = id; labelKey = ''; dismissHint(); updateLabels(); apply();
    if (layers.gov && id === 'state-house') onSelectGov(); else onSelectVenue(id);
  }
  function onClick(event) {
    const control = event.target.closest('[data-m3]');
    if (control) { onControl(control.dataset.m3); return; }
    if (suppressClick) { suppressClick = false; if (event.detail !== 0) return; }
    const plate = event.target.closest('.m3-lga');
    if (plate) { onSelectLga(plate.dataset.lga); return; }
    const label = event.target.closest('.m3-label');
    if (label) choose(label.dataset.venue);
  }
  function onControl(name) {
    const at = middle();
    if (name === 'in') zoomAt(1.5, at.x, at.y); else if (name === 'out') zoomAt(1 / 1.5, at.x, at.y);
    else if (name === 'fit') { whole(); apply(); }
    else if (name === 'me') { near(spotOf(state?.location) || homeSpot()); userMoved = true; apply(); }
  }
  function onKey(event) {
    const { action, mode } = event.detail || {};
    if (mode !== 'map' || container.hidden || layer !== 'city') return;
    if (action === 'move-left') ox += 90; else if (action === 'move-right') ox -= 90; else if (action === 'move-up') oy += 90; else if (action === 'move-down') oy -= 90;
    else if (action === 'zoom-in') { onControl('in'); return; } else if (action === 'zoom-out') { onControl('out'); return; } else if (action === 'zoom-fit') { onControl('fit'); return; } else return;
    userMoved = true; apply();
  }
  function onUi(event) {
    const detail = event.detail || {};
    if (detail.layer === 'city' || detail.layer === 'world') layer = detail.layer;
    if (typeof detail.filter === 'string') { filter = detail.filter; labelKey = ''; }
    const picked = 'selected' in detail && detail.selected && detail.selected !== selected;
    if ('selected' in detail) { selected = detail.selected && labels.has(detail.selected) ? detail.selected : null; labelKey = ''; }
    const seaWasOff = !layers.sea;
    if (detail.layers && typeof detail.layers === 'object') layers = { billboards: detail.layers.billboards === true, sea: detail.layers.sea === true, neighbours: false, gov: detail.layers.gov === true, moving: false, lgas: detail.layers.lgas !== false, homes: detail.layers.homes !== false };
    for (const key of ['ads', 'gov']) if (key in detail) data[key] = detail[key] && typeof detail[key] === 'object' ? detail[key] : null;
    updateLabels(); syncChips();
    if (!measure()) return;
    if (!opened) open();
    else if (detail.layout && !userMoved && size.width > 720) whole();
    if (selected && (picked || detail.layout)) { const spot = spotOf(selected), at = project(spot.x, spot.z); if (at.x < insets.left + 60 || at.x > size.width - insets.right - 60 || at.y < insets.top + 70 || at.y > size.height - insets.bottom - 40) centreOn(spot.x, spot.z); }
    if (layers.sea && seaWasOff && model.sea) { scale = Math.max(scale, free().width / (model.sea.x1 - model.sea.x0 + 20)); centreOn((model.sea.x0 + model.sea.x1) / 2, (model.sea.z0 + model.sea.z1) / 2 - 6); userMoved = true; }
    apply();
  }
  root.addEventListener('pointerdown', onPointerDown); root.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp); window.addEventListener('pointercancel', onPointerUp);
  root.addEventListener('wheel', onWheel, { passive: false }); root.addEventListener('click', onClick);
  root.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('jaw:map-ui', onUi); window.addEventListener('jaw:key', onKey);

  const api = {
    kind: '2d',
    get ready() { return layer === 'city'; },
    setCity() { layer = 'city'; },
    setState(next) {
      const before = spotOf(state?.location);
      state = next;
      updateLabels(); updatePlates();
      const after = spotOf(state?.location);
      if (opened && !userMoved && size.width <= 720 && before && after && (before.x !== after.x || before.z !== after.z)) opened = false;
      if (measure()) { if (!opened) open(); apply(); }
      if (deepLink) { const id = deepLink; deepLink = null; if (labels.has(id)) choose(id); }
    },
    setPlayer() { return false; },
    resize() { if (!destroyed) layout(); },
    arrive(done) { done(); },
    worldChanged() { updatePlates(); if (scale) apply(); },
    setFriends(ids) { friends = new Set(ids || []); if (scale) apply(); },
    focusEstate(lga, estate) { const cell = estateLayout(pack, lga)?.cells[estate]; if (!cell || !measure()) return; scale = clamp(free().width / (cell.size * 1.25), fitScale(), MAX_SCALE); centreOn(cell.x, cell.z); userMoved = true; apply(); },
    focusPlot(plot) { if (!plot || !pack.lgas?.some((lga) => lga.id === plot.lga) || !measure()) return; const layoutOf = estateLayout(pack, plot.lga), cell = layoutOf.cells[plot.estate], at = layoutOf.plot(plot.estate, plot.plot); scale = clamp(free().width / (cell.size * 0.9), fitScale(), MAX_SCALE); centreOn(at.x, at.z); userMoved = true; apply(); },
    focusLga(id) { const lga = pack.lgas?.find((item) => item.id === id); if (!lga || !measure()) return; const xs = lga.polygon.map((point) => clamp(point[0], fit.minX, fit.maxX)), zs = lga.polygon.map((point) => clamp(point[1], fit.minZ, fit.maxZ)); scale = Math.min(free().width / (Math.max(...xs) - Math.min(...xs) + 6), free().height / (Math.max(...zs) - Math.min(...zs) + 6)); centreOn((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2); userMoved = true; apply(); },
    select(id) { choose(id); },
    ui(detail) { onUi({ detail }); },
    view: () => ({ scale, x: ox, y: oy, opened, userMoved }),
    /** Where a place or a map point is on screen (for tests that compare the two maps). */
    screenOf(id) { const spot = spotOf(id); if (!spot) return null; const page = container.getBoundingClientRect(), at = project(spot.x, spot.z); return { x: at.x + page.left, y: at.y + page.top }; },
    model,
    diagnostics() { return { kind: '2d', renderCount: 0, loop: false, view: api.view(), houses: { detailed: drawn.length, cached: world?.size?.() ?? 0 }, layers: { ...layers }, labels: [...labels].map(([id, label]) => ({ id, text: label.name.textContent, note: label.note.textContent, hidden: label.node.hidden, compact: label.node.classList.contains('is-compact') })) }; },
    destroy() { destroyed = true; window.removeEventListener('pointerup', onPointerUp); window.removeEventListener('pointercancel', onPointerUp); window.removeEventListener('jaw:map-ui', onUi); window.removeEventListener('jaw:key', onKey); root.remove(); },
  };
  updateLabels(); updatePlates();
  return api;
}
