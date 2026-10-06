/**
 * OWNER: world
 * The flat ("Simple") city map: the SAME city as the 3D map, seen from straight above.
 * It is generated from the city pack (src/map3d/flat.ts) — land, water, roads, bridges, local
 * governments, venues, homes and estates are the pack's, at the pack's coordinates — and it uses
 * the 3D map's own label, name-plate, chip and button styles (src/map3d/map3d.css), so switching
 * between the two is tilting one map. It is also the fallback where WebGL is missing or lost.
 *
 * Same contract as the 3D map (src/map3d/map3d.ts):
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
import { COMING_SOON } from '../game/content/venues.ts';
import { contentFor } from '../game/cities/runtime.ts';
import { dockOf } from './insets.ts';
import { createPinLayer, pinsOf, EMPTY_PEOPLE } from './people.ts';
import type { MapPeople, PeoplePin } from './people.ts';
import { openingInfo } from '../game/clock.ts';
import { isDeparting } from '../game/registry.ts';
import { ESTATE, PLOTS_PER_ESTATE, HOUSE_STYLE, unpackStyle } from '../game/content/world.ts';
import { iconFor } from '../ui/icon-map.ts';
import { buildNetwork, localTripRoute, pointAt } from './roads.ts';
import { flatModel, flatSvg } from './flat.ts';
import { estateLayout, plotAt } from './estates.ts';
import { lgaAt } from './lga.ts';
import { cityUnit } from '../game/cities/terminology.ts';
import { civicTitle } from '../game/cities/terminology.ts';
import { plateFit, plateWidth, spanOf } from './labels.ts';
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX, isDrag, isTap, mapHint, MAP_HINT_KEY } from '../scene/gesture.ts';
import type { CityPack, PackLga } from './types.ts';
import type { Route } from './roads.ts';
import { NAMED_FROM, densityFor, shorten, venueNamesAt } from './geo/density.ts';
import type { HouseStyle, PlotAddress } from '../types/index.ts';

// ---- the contract ---------------------------------------------------------------------------------

/** One house of an estate as /api/world/lga/:lga/estate/:n/houses sends it. `p` plot, `s` packed style, `u` upgrade-done time. */
export interface HouseRecord { p: number; s: number; u: number; id?: string; name?: string; online?: boolean; you?: boolean }
/** What a local government's summary says (server/routes/world.ts): `occ` is the houses in each estate. */
export interface LgaCounts { residents?: number; houses: number; online: number; occ?: ArrayLike<number> }
/** The shared house data of the maps (src/map3d/world-data.ts createWorldData), as far as the maps read it. */
export interface WorldView {
  summary(): Map<string, LgaCounts> | null;
  estate(lga: string, estate: number): { houses: Map<number, HouseRecord> } | null;
  size?(): number;
}
/** What the host is told when a house is tapped. */
export interface HouseCard { lga: string; estate: number; plot: number; id: string | null; name: string | null; online: boolean; you: boolean; style: number; upgrading: boolean }
/** The part of the life state the map reads (a full LifeState fits). */
export interface Map2DState {
  t?: number;
  location?: string;
  activeAction?: { kind: string; id: string; duration: number; remaining: number; mode?: string } | null;
  estate?: { living?: string; plot?: PlotAddress | null; lga?: string | null };
  travel?: { home?: string };
}
export interface Map2DOptions {
  pack: CityPack;
  cityId?: string;
  world?: WorldView | null;
  onSelectVenue?: (id: string) => void;
  onSelectGov?: () => void;
  onSelectLga?: (id: string) => void;
  onSelectHouse?: (house: HouseCard) => void;
  /** A pin of other players was tapped: the friends it stands for, and the venue it stands at (null on the road). */
  onSelectPeople?: (ids: string[], venue: string | null) => void;
  /** A venue to select as soon as the first state arrives (?venue=). */
  deepLink?: string | null;
}
export interface MapLayers { billboards: boolean; sea: boolean; neighbours: boolean; gov: boolean; moving: boolean; lgas: boolean; homes: boolean }
/** The billboards and sea plots the Map panel sends with its `jaw:map-ui` event (/api/civic/ads). */
export interface AdsData {
  palette?: { colours?: { id: string; bg: string; ink: string }[]; icons?: { id: string; icon: string }[] };
  billboards?: { slots: { slot: string; near: string; road: string; ad?: { colour: string; icon?: string; text: string; by: { name: string } } | null }[] };
  sea?: { rows: number; cols: number; shoreRows: number; plots: { slot: string; colour: string; icon?: string; text: string; by: { name: string } }[] };
}
/** The player homes of each district, as /api/civic/neighbours sends them. */
export interface NeighboursData { districts: { id: string; label: string; count: number; online: number; homes: { id: string; name: string; online?: boolean; you?: boolean }[] }[] }
/** The Governor, as /api/civic/gov sends it. */
export interface GovData { governor?: { name: string } | null }
/** The detail of a `jaw:map-ui` event: every field is optional and is checked where it is read. */
export interface MapUiDetail { layer?: unknown; filter?: unknown; selected?: unknown; layers?: unknown; layout?: unknown; ads?: unknown; gov?: unknown; neighbours?: unknown }
export interface Map2DView { scale: number; x: number; y: number; opened: boolean; userMoved: boolean }
export interface Map2DDiagnostics {
  kind: '2d'; renderCount: number; loop: boolean; view: Map2DView; houses: { detailed: number; cached: number }; layers: MapLayers;
  labels: { id: string; text: string | null; note: string | null; hidden: boolean | 'until-found'; compact: boolean }[];
  people: { key: string; kind: string; text: string; hidden: boolean; transform: string }[];
}
/** A floating chip: a billboard, the sea-plots title or the Governor's. */
interface Chip { key: string; kind: string; x: number; z: number; lift?: number; glyph: string; text: string; bg?: string; ink?: string; label: string }
/** Where a place stands on the map; Home also says which district and whether it is the player's own plot. */
interface Spot { x: number; z: number; district?: string; own?: boolean }
export interface Map2D {
  readonly kind: '2d';
  readonly ready: boolean;
  setCity(cityId?: string): void;
  setState(next: Map2DState | null): void;
  setPlayer(player?: unknown): boolean;
  resize(): void;
  arrive(done: () => void): void;
  worldChanged(): void;
  setFriends(ids?: Iterable<string> | null): void;
  /** Other players to draw (src/map3d/people.ts), and the server clock their trips are timed by. */
  setPeople(next: MapPeople | null | undefined, clock?: () => number): void;
  focusEstate(lga: string, estate: number): void;
  focusPlot(plot: PlotAddress | null | undefined): void;
  focusLga(id: string): void;
  select(id: string): void;
  ui(detail: MapUiDetail | null | undefined): void;
  view(): Map2DView;
  restoreView(next: { scale: number; x: number; y: number }): void;
  /** Where a place or a map point is on screen (for tests that compare the two maps). */
  screenOf(id: string): { x: number; y: number } | null;
  readonly model: ReturnType<typeof flatModel>;
  diagnostics(): Map2DDiagnostics;
  destroy(): void;
}

const MAX_SCALE = 150, WHOLE_SCALE = 1.9, HOUSE_PIXELS = 6, MAX_DETAILED = 12;
const ICON = (path: string) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
/** The how-to line shows until the player first moves the map, picks a place or travels: once on each device. */
let hintSeen = false;
const hintKnown = (): boolean => { if (hintSeen) return true; try { hintSeen = globalThis.localStorage?.getItem(MAP_HINT_KEY) === '1'; } catch { /* shown again next visit */ } return hintSeen; };
/** The coming-soon list, read by id. */
const SOON_TABLE = COMING_SOON as Readonly<Record<string, { icon?: string }>>;

/** Pure flat model for one loaded city catalogue. */
export function cityFlatModel(pack: CityPack, cityId = pack.id, network = buildNetwork(pack)) {
  const venues = Object.fromEntries(contentFor(cityId).venues.map((venue) => [venue.id, venue.definition]));
  return flatModel(pack, network, { venues, soon: COMING_SOON });
}

export function createMap2D(container: HTMLElement, { pack, cityId = pack.id, world = null, onSelectVenue = () => {}, onSelectGov = () => {}, onSelectLga = () => {}, onSelectHouse = () => {}, onSelectPeople = () => {}, deepLink = null }: Map2DOptions = {} as Map2DOptions): Map2D {
  const content = contentFor(cityId), venueTable = Object.fromEntries(content.venues.map((venue) => [venue.id, venue.definition]));
  const stateHouseId = content.venues.find((venue) => venue.kind === 'statehouse')?.id ?? null;
  const govVenueIds = new Set(content.venues.filter((venue) => venue.kind === 'statehouse' || venue.kind === 'polling').map((venue) => venue.id));
  const network = buildNetwork(pack), model = cityFlatModel(pack, cityId, network);
  const { box } = model, fit = pack.bounds.fit || { minX: box.x, maxX: box.x + box.width, minZ: box.z, maxZ: box.z + box.height };
  let state: Map2DState | null = null, layer: 'city' | 'world' = 'city', filter = 'all', selected: string | null = null, friends = new Set<string>(), destroyed = false;
  let layers: MapLayers = { billboards: false, sea: false, neighbours: false, gov: false, moving: false, lgas: true, homes: true }, data: { ads: AdsData | null, gov: GovData | null } = { ads: null, gov: null };
  let scale = 0, ox = 0, oy = 0, opened = false, userMoved = false, size = { width: 0, height: 0 }, insets = { left: 8, top: 60, right: 8, bottom: 80 }, labelKey = '', chipKey = '', drawn: { lga: string, estate: number }[] = [];
  let homeAt: Spot | null = null;

  const root = document.createElement('div');
  root.className = `m3 m3-flat${model.inland ? ' is-inland' : ''}`;
  root.innerHTML = `<div class="m3-flat-world">${flatSvg(model)}<svg class="m3-flat-trip" viewBox="${box.x} ${box.z} ${box.width} ${box.height}" preserveAspectRatio="none" aria-hidden="true"><path data-trip fill="none" stroke="#14532d" stroke-linecap="round" stroke-linejoin="round"/><path data-trip-top fill="none" stroke="#ffd166" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <canvas class="m3-flat-houses" aria-hidden="true"></canvas>
    <div class="m3-labels" role="group" aria-label="Places in ${pack.name}. Choose one to see it and travel there. The list of places in the Map panel is the same thing as a list."></div>
    <div class="m3-controls" role="group" aria-label="Map view"><div class="m3-zoom"><button type="button" data-m3="in" aria-label="Zoom in" title="Zoom in">${ICON('<path d="M12 5v14M5 12h14"/>')}</button><button type="button" data-m3="out" aria-label="Zoom out" title="Zoom out">${ICON('<path d="M5 12h14"/>')}</button></div><div class="m3-go"><button type="button" class="m3-pill" data-m3="fit" aria-label="Show the whole ${model.extent}" title="Show the whole ${model.extent}">${ICON('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')}<span>${model.extent === 'state' ? 'Whole state' : 'Whole city'}</span></button><button type="button" class="m3-pill m3-me" data-m3="me" aria-label="Show where you are" title="Show where you are">${ICON('<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>')}<span>Find me</span></button></div></div>
    <p class="m3-hint" data-m3-hint ${hintKnown() ? 'hidden' : ''}>${mapHint(Boolean(globalThis.matchMedia?.('(pointer: coarse)').matches), true)}</p>`;
  container.appendChild(root);
  const worldNode = root.querySelector<HTMLElement>('.m3-flat-world')!, canvas = root.querySelector('canvas')!, labelLayer = root.querySelector<HTMLElement>('.m3-labels')!, hint = root.querySelector<HTMLElement>('[data-m3-hint]')!;
  const lgaArt = root.querySelector<SVGGElement>('.m3-flat-lgas')!, tripPaths = [root.querySelector('[data-trip]')!, root.querySelector('[data-trip-top]')!];
  const paint = canvas.getContext('2d')!;

  // ---- places, plates and tags: the 3D map's own markup, so the styles are literally shared -------
  const homeSpot = (): Spot => { const e = state?.estate; if (e?.living === 'own' && e.plot && pack.lgas?.some((lga) => lga.id === e.plot!.lga)) return { ...estateLayout(pack, e.plot.lga)!.plot(e.plot.estate, e.plot.plot), district: pack.lgas.find((lga) => lga.id === e.plot!.lga)!.name, own: true }; return model.homes[state?.travel?.home as string] ?? Object.values(model.homes)[0]!; };
  const places = [...model.places, { id: 'home', kind: 'home', x: 0, z: 0 }].sort((a, b) => a.x - b.x || a.z - b.z);
  const notable = new Set(pack.notable ?? []);
  const labels = new Map<string, { node: HTMLButtonElement, name: HTMLElement, note: HTMLElement, place: { id: string, kind: string, x: number, z: number }, width: number, height: number, priority: number }>(), plates = new Map<string, { node: HTMLButtonElement, note: HTMLElement, lga: PackLga, span: ReturnType<typeof spanOf>, scale: number }>(), tags: HTMLDivElement[] = [], chips = new Map<string, { node: HTMLDivElement, chip: Chip }>();
  for (const place of places) {
    const source = venueTable[place.id] || SOON_TABLE[place.id];
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
    plates.set(lga.id, { node, note, lga, span: spanOf(lga.polygon), scale: 1 });
  }
  for (let i = 0; i < 14; i++) { const node = document.createElement('div'); node.className = 'm3-tag'; node.hidden = true; node.setAttribute('aria-hidden', 'true'); labelLayer.append(node); tags.push(node); }
  const you = document.createElement('div');
  you.className = 'm3-you'; you.hidden = true; you.setAttribute('aria-hidden', 'true'); you.textContent = 'You';
  labelLayer.append(you);
  // Other players: friends where they stand or travel, and counts. A travelling pin is moved by the browser (one animation per trip), not by a loop here.
  const pinLayer = createPinLayer(labelLayer, document), routes = new Map<string, Route | null>();
  let people: MapPeople = EMPTY_PEOPLE, peopleNow: () => number = () => Date.now();

  const project = (x: number, z: number) => ({ x: ox + (x - box.x) * scale, y: oy + (z - box.z) * scale });
  const ground = (px: number, py: number) => ({ x: box.x + (px - ox) / scale, z: box.z + (py - oy) / scale });
  const spotOf = (id: string | undefined): Spot | null => (id === 'home' ? homeAt : labels.get(id as string)?.place) || null;
  const nameOf = (id: string) => (id === 'home' ? 'Home' : venueTable[id]?.label ?? id);
  const ownPlot = (): PlotAddress | null => { const plot = state?.estate?.plot; return plot && pack.lgas?.some((lga) => lga.id === plot.lga) ? plot : null; };

  function updateLabels() {
    const at = state?.t ?? 0, going = isDeparting(state) && state!.activeAction!.id !== state!.location ? state!.activeAction!.id : null;
    homeAt = homeSpot();
    const next = JSON.stringify([densityFor(size.width).venueChars, state?.location, going, homeAt.x, homeAt.z, filter, selected, layers.gov, Object.values(venueTable).map((venue) => openingInfo(venue.hours, at).status)]);
    if (next === labelKey) return;
    labelKey = next;
    for (const [id, label] of labels) {
      const venue = venueTable[id], soon = label.place.kind === 'soon';
      const opening = venue ? openingInfo(venue.hours, at) : null, open = Boolean(opening?.open), here = state?.location === id;
      const status = soon ? 'Coming soon' : here ? (going ? 'Leaving from here' : 'You are here') : going === id ? 'On the way' : open ? '' : opening?.opensAt ? `opens ${opening.opensAt}` : 'Closed';
      const dimmed = soon ? filter !== 'all' : filter === 'open' ? !open : filter !== 'all' && venue!.category !== filter && id !== 'home';
      const district = id === 'home' ? homeAt.district : venue?.district ?? '';
      label.name.textContent = shorten(nameOf(id), densityFor(size.width).venueChars); label.note.textContent = status;
      label.node.className = `m3-label is-${label.place.kind}${here ? ' is-here' : ''}${going === id ? ' is-going' : ''}${!soon && !open ? ' is-closed' : ''}${dimmed && !here ? ' is-dimmed' : ''}${selected === id ? ' is-selected' : ''}${layers.gov && govVenueIds.has(id) ? ' is-gov' : ''}`;
      label.node.setAttribute('aria-label', `${nameOf(id)}, ${district}${status ? `, ${status.toLowerCase()}` : ', open now'}`);
      label.node.title = `${nameOf(id)}${status ? ` · ${status}` : ''}`;
      if (here) label.node.setAttribute('aria-current', 'location'); else label.node.removeAttribute('aria-current');
      label.priority = (notable.has(id) ? 25 : 0) + (here ? 100 : 0) + (selected === id ? 90 : 0) + (going === id ? 80 : 0) + (id === 'home' ? 40 : 0) + (soon ? 5 : open ? 20 : 10) - (dimmed ? 30 : 0);
      label.width = label.node.offsetWidth || 90; label.height = label.node.offsetHeight || 30;
    }
  }
  function updatePlates() {
    const summary = world?.summary() ?? null, own = state?.estate?.lga ?? null;
    for (const [id, plate] of plates) {
      const counts = summary?.get(id);
      plate.note.textContent = counts ? `${counts.houses.toLocaleString('en-NG')} home${counts.houses === 1 ? '' : 's'}${counts.online ? ` · ${counts.online.toLocaleString('en-NG')} online` : ''}` : '';
      plate.node.classList.toggle('is-own', id === own);
      plate.node.setAttribute('aria-label', `${plate.lga.name} ${cityUnit(cityId)}${id === own ? ', yours' : ''}${counts ? `, ${counts.houses} homes, ${counts.online} online` : ''}. Open its page.`);
    }
    for (const node of lgaArt.querySelectorAll<SVGElement>('[data-lga]')) { const mine = node.dataset.lga === own; node.setAttribute('fill-opacity', mine ? '.58' : '.34'); node.setAttribute('stroke-width', mine ? '1.1' : '.5'); node.setAttribute('stroke', mine ? '#14532d' : '#46544a'); }
  }
  function syncChips() {
    const list: Chip[] = [], ads = data.ads;
    const colourOf = (id: string) => ads?.palette?.colours?.find((item) => item.id === id) || { bg: '#256b45', ink: '#ffffff' };
    if (layers.billboards && ads?.billboards) for (const slot of ads.billboards.slots) {
      const at = spotOf(slot.near);
      if (!at) continue;
      const colour = slot.ad ? colourOf(slot.ad.colour) : null;
      list.push({ key: `board:${slot.slot}`, kind: slot.ad ? 'board' : 'board-free', x: at.x + 5.2, z: at.z - 3.2, glyph: iconFor('ad', slot.ad?.icon ?? 'megaphone', '📢'), text: slot.ad ? slot.ad.text : '', bg: colour?.bg, ink: colour?.ink, label: slot.ad ? `Billboard on ${slot.road}: ${slot.ad.text}, by ${slot.ad.by.name}` : `Billboard on ${slot.road}: for rent` });
    }
    if (layers.sea && ads?.sea && model.sea) list.push({ key: 'sea-title', kind: 'title', x: (model.sea.x0 + model.sea.x1) / 2, z: model.sea.z0 - 2.5, glyph: iconFor('ad', 'sea', '🌊'), text: `Sea plots · ${ads.sea.plots.length} of ${ads.sea.rows * ads.sea.cols} rented`, label: `Sea plots: ${ads.sea.plots.length} of ${ads.sea.rows * ads.sea.cols} rented` });
    if (layers.gov && data.gov && stateHouseId) { const seat = spotOf(stateHouseId), title = civicTitle(cityId); if (seat) list.push({ key: 'gov', kind: 'gov', lift: 40, x: seat.x, z: seat.z, glyph: iconFor('panel', 'governor', '🏛️'), text: data.gov.governor ? `${title} ${data.gov.governor.name}` : `No ${title} yet`, label: data.gov.governor ? `The ${title} is ${data.gov.governor.name}` : `There is no ${title} yet` }); }
    const next = JSON.stringify(list.map((chip) => [chip.key, chip.text, chip.bg]));
    if (next === chipKey) return;
    chipKey = next;
    for (const { node } of chips.values()) node.remove();
    chips.clear();
    for (const chip of list) {
      const node = document.createElement('div');
      node.className = `m3-chip is-${chip.kind}`; node.setAttribute('role', 'img'); node.setAttribute('aria-label', chip.label);
      if (chip.bg) { node.style.background = chip.bg; node.style.color = chip.ink!; }
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
        const layout = estateLayout(pack, lga.id)!, occ = summary?.get(lga.id)?.occ;
        for (let i = 0; i < ESTATE.estates; i++) {
          const cell = layout.cells[i]!, half = cell.size / 2;
          if (cell.x + half < a.x || cell.x - half > b.x || cell.z + half < a.z || cell.z - half > b.z) continue;
          const houses = occ?.[i] ?? 0, big = layout.pitch(i) * scale >= HOUSE_PIXELS;
          if (big) { detail.push({ lga: lga.id, estate: i, cell, layout, far: Math.hypot(cell.x - centre.x, cell.z - centre.z), houses }); continue; }
          // An empty estate is only drawn once it is big enough to read as a plot of ground (the growing edge), not as graph paper.
          if (!houses && cell.size * scale < 14) continue;
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
          const style = unpackStyle(house.s).style as HouseStyle, w = pitch * 0.56;
          paint.fillStyle = HOUSE_STYLE.wall[style.wall]!.hex!; paint.fillRect(at.x - w / 2, at.y - w / 2, w, w);
          paint.fillStyle = HOUSE_STYLE.roof[style.roof]!.hex!; paint.fillRect(at.x - w / 2, at.y - w / 2, w, w * 0.62);
          if (style.fence) { paint.strokeStyle = HOUSE_STYLE.fence[style.fence]!.hex!; paint.lineWidth = Math.max(1, pitch * 0.05); paint.strokeRect(at.x - pitch * 0.42, at.y - pitch * 0.42, pitch * 0.84, pitch * 0.84); }
          if (house.u > now) { paint.strokeStyle = '#c9a35a'; paint.lineWidth = Math.max(1, pitch * 0.06); paint.strokeRect(at.x - w * 0.6, at.y - w * 0.6, w * 1.2, w * 1.2); }
          if (house.online) { paint.fillStyle = '#33d17a'; paint.beginPath(); paint.arc(at.x + w * 0.42, at.y - w * 0.42, Math.max(2, pitch * 0.13), 0, Math.PI * 2); paint.fill(); }
        }
      }
      if (own) { const spot = estateLayout(pack, own.lga)!.plot(own.estate, own.plot), at = project(spot.x, spot.z), r = Math.max(9, estateLayout(pack, own.lga)!.pitch(own.estate) * scale * 0.7); paint.strokeStyle = '#e8a643'; paint.lineWidth = 3; paint.beginPath(); paint.arc(at.x, at.y, r, 0, Math.PI * 2); paint.stroke(); }
    }
  }

  // ---- the view --------------------------------------------------------------------------------
  function measure() {
    const page = container.getBoundingClientRect();
    const rect = (selector: string) => { const found = document.querySelector(selector)?.getBoundingClientRect(); return found && found.height ? found : null; };
    const bar = rect('.life-status'), nav = rect('.life-nav'), panel = rect('.map-panel'), wide = page.width > 720;
    let left = 8, right = wide ? 64 : 8, top = (bar ? bar.bottom - page.top : 56) + 8, bottom = (nav ? page.bottom - nav.top : 70) + 10;
    const dock = panel ? dockOf(panel, page, wide) : null;
    if (dock?.side === 'left') left = Math.max(left, dock.amount); else if (dock?.side === 'bottom') bottom = Math.max(bottom, dock.amount);
    size = { width: page.width, height: page.height }; insets = { left, top, right, bottom };
    container.style?.setProperty('--map-dock', `${Math.round(bottom)}px`);
    root.style.setProperty('--m3-dock', `${Math.round(bottom)}px`); root.style.setProperty('--m3-left', `${Math.round(left)}px`); root.style.setProperty('--m3-top', `${Math.round(top)}px`);
    return page.width > 0 && page.height > 0 && !container.hidden;
  }
  const free = () => ({ width: Math.max(80, size.width - insets.left - insets.right), height: Math.max(80, size.height - insets.top - insets.bottom) });
  const fitScale = () => Math.min(free().width / (fit.maxX - fit.minX), free().height / (fit.maxZ - fit.minZ));
  function centreOn(x: number, z: number) { const area = free(); ox = insets.left + area.width / 2 - (x - box.x) * scale; oy = insets.top + area.height / 2 - (z - box.z) * scale; }
  /** Which view a resize returns to while the player has not moved the map: the core (the opening view) until "Whole city" is pressed. */
  let home: 'core' | 'whole' = 'core';
  const homeView = () => (home === 'whole' ? whole() : core());
  function whole() { home = 'whole'; scale = fitScale(); centreOn((fit.minX + fit.maxX) / 2, (fit.minZ + fit.maxZ) / 2 - (model.context && !model.inland ? (free().height * 0.3) / scale : 0)); userMoved = false; }
  /** The opening view of a wide screen: the metropolitan core, where the venues are (the whole city when the pack names no core). */
  function core() {
    const area = pack.core;
    home = 'core';
    if (!area) { whole(); return; }
    const next = Math.min(free().width / (area.maxX - area.minX), free().height / (area.maxZ - area.minZ));
    if (next <= fitScale()) { whole(); return; }
    scale = next; centreOn((area.minX + area.maxX) / 2, (area.minZ + area.maxZ) / 2); userMoved = false;
  }
  function near(at: { x: number, z: number }) { scale = Math.max(fitScale(), free().width / 58); centreOn(at.x, at.z); }
  /** A view kept before a reload, applied when the map first opens. */
  let pendingView: { scale: number; x: number; y: number } | null = null;
  function open() { opened = true; userMoved = false; if (pendingView) { scale = pendingView.scale; ox = pendingView.x; oy = pendingView.y; pendingView = null; userMoved = true; return; } if (size.width > 720) core(); else near(spotOf(state?.location) || homeSpot()); }
  function apply() {
    if (!scale) return;
    scale = clamp(scale, fitScale() * 0.8, MAX_SCALE);
    // Most of the city always stays in reach.
    const area = free(), keepX = area.width * 0.4, keepY = area.height * 0.4;
    ox = clamp(ox, insets.left + keepX - (fit.maxX - box.x) * scale, insets.left + area.width - keepX - (fit.minX - box.x) * scale);
    oy = clamp(oy, insets.top + keepY - (Math.max(fit.maxZ, model.sea ? model.sea.z1 : fit.maxZ) - box.z) * scale, insets.top + area.height - keepY - (fit.minZ - box.z) * scale);
    worldNode.style.width = `${box.width * scale}px`; worldNode.style.height = `${box.height * scale}px`;
    worldNode.style.transform = `translate(${Math.round(ox)}px,${Math.round(oy)}px)`;
    const far = scale < 3.2, wholeView = scale < fitScale() * WHOLE_SCALE;
    root.classList.toggle('is-far', far); root.classList.toggle('is-whole', wholeView);
    lgaArt.style.display = layers.lgas ? '' : 'none';
    placeLabels(far, wholeView);
    drawHouses();
  }
  function placeLabels(far: boolean, wholeView: boolean) {
    const entries = [...labels.values()].map((label) => { const spot = spotOf(label.place.id)!; const at = project(spot.x, spot.z - (label.place.id === 'home' && homeAt!.own ? 0 : 2.2)); return { label, at, visible: at.x > -60 && at.x < size.width + 60 && at.y > -20 && at.y < size.height + 80 && !(wholeView && label.priority < 70) }; });
    entries.sort((p, q) => q.label.priority - p.label.priority || q.at.y - p.at.y);
    const taken: { l: number, r: number, t: number, b: number }[] = [], hits = (rect: { l: number, r: number, t: number, b: number }) => taken.some((other) => rect.l < other.r && rect.r > other.l && rect.t < other.b && rect.b > other.t);
    const allowed = venueNamesAt(densityFor(size.width), scale / fitScale());
    let named = 0;
    for (const { label, at, visible } of entries) {
      const node = label.node;
      if (node.hidden === visible) node.hidden = !visible;
      if (!visible) continue;
      const full = { l: at.x - label.width / 2 - 3, r: at.x + label.width / 2 + 3, t: at.y - label.height - 2, b: at.y + 2 }, compact = (label.priority < NAMED_FROM && named >= allowed) || hits(full);
      const used = compact ? { l: at.x - 17, r: at.x + 17, t: at.y - 32, b: at.y + 2 } : full;
      // Level of detail: an icon that would still sit on a more important label or icon is left out until the view is closer.
      if (compact && label.priority < 70 && hits(used)) { if (!node.hidden) node.hidden = true; continue; }
      if (node.hidden) node.hidden = false;
      taken.push(used);
      if (!compact && label.priority < NAMED_FROM) named += 1;
      node.classList.toggle('is-compact', compact);
      node.style.transform = `translate(${Math.round(at.x)}px,${Math.round(at.y)}px) translate(-50%,-100%)`;
    }
    // Level of detail: a whole-state view names the local governments by their size; nearer, the usual small plates, out of the way of the place names.
    const platesAt: { l: number, r: number, t: number, b: number }[] = [];
    for (const plate of [...plates.values()].sort((p, q) => (q.span.maxX - q.span.minX) - (p.span.maxX - p.span.minX))) {
      const { node, lga } = plate, at = project(lga.plate[0], lga.plate[1]), distance = wholeView ? 1000 : 0;
      const fit = plateFit(lga.name, (plate.span.maxX - plate.span.minX) * scale, distance);
      const w = plateWidth(lga.name) * fit.scale * 0.6, h = 24 * fit.scale, rect = { l: at.x - w, r: at.x + w, t: at.y - h / 2, b: at.y + h / 2 };
      const visible = layers.lgas && fit.show && at.x > -80 && at.x < size.width + 80 && at.y > insets.top - 10 && at.y < size.height + 30 && scale < 26 && !platesAt.some((other) => rect.l < other.r && rect.r > other.l && rect.t < other.b && rect.b > other.t) && !(!wholeView && hits(rect));
      if (node.hidden === visible) node.hidden = !visible;
      if (!visible) continue;
      platesAt.push(rect);
      if (fit.scale !== plate.scale) { plate.scale = fit.scale; node.style.fontSize = fit.scale > 1 ? `${(11 * fit.scale).toFixed(1)}px` : ''; node.classList.toggle('is-sized', fit.scale > 1); }
      node.style.transform = `translate(${Math.round(at.x)}px,${Math.round(at.y)}px) translate(-50%,-50%)`;
    }
    for (const { node, chip } of chips.values()) {
      const at = project(chip.x, chip.z), visible = at.x > -40 && at.x < size.width + 40 && at.y > 0 && at.y < size.height + 40 && !(far && chip.kind === 'board-free');
      if (node.hidden === visible) node.hidden = !visible;
      if (visible) node.style.transform = `translate(${Math.round(at.x)}px,${Math.round(at.y - (chip.lift || 0))}px) translate(-50%,-100%)`;
    }
    // House tags: yours, and friends' in the estates drawn as houses.
    const wanted: { lga: string, estate: number, plot: number, text: string, kind: string }[] = [], own = layers.homes ? ownPlot() : null;
    if (own && !homeAt?.own) wanted.push({ ...own, text: 'Your house', kind: 'own' });
    if (layers.homes && friends.size) for (const item of drawn) for (const house of world?.estate(item.lga, item.estate)?.houses.values() ?? []) if (house.id && friends.has(house.id) && wanted.length < tags.length) wanted.push({ lga: item.lga, estate: item.estate, plot: house.p, text: house.name!, kind: house.online ? 'friend is-online' : 'friend' });
    tags.forEach((node, i) => {
      const item = wanted[i], spot = item ? estateLayout(pack, item.lga)!.plot(item.estate, item.plot) : null, at = spot ? project(spot.x, spot.z) : null;
      const visible = Boolean(at) && at!.x > 0 && at!.x < size.width && at!.y > insets.top && at!.y < size.height;
      if (node.hidden === visible) node.hidden = !visible;
      if (!visible) return;
      if (node.textContent !== item!.text) node.textContent = item!.text;
      node.className = `m3-tag is-${item!.kind}`;
      node.style.transform = `translate(${Math.round(at!.x)}px,${Math.round(at!.y)}px) translate(-50%,-100%)`;
    });
    placeTrip();
    placePeople();
  }
  const pinWorld = {
    place(id: string) { const spot = id === 'home' ? null : labels.get(id)?.place; return spot ? { x: spot.x, z: spot.z } : null; },
    route(from: string, to: string) { const key = `${from}>${to}`; if (!routes.has(key)) { if (routes.size > 64) routes.clear(); routes.set(key, network.route(from, to)); } return routes.get(key) ?? null; },
    name: nameOf,
  };
  const pinAt = (pin: PeoplePin) => { const at = project(pin.x, pin.z); return { x: at.x, y: at.y, visible: at.x > -40 && at.x < size.width + 40 && at.y > insets.top - 10 && at.y < size.height + 30 }; };
  /** Place the pins for this instant; a travelling one is handed the rest of its trip, and placed again when that has ended. */
  function placePeople() {
    if (!scale || destroyed) return;
    const at = peopleNow(), next = people.people.length || Object.keys(people.counts).length ? pinsOf(people, at, pinWorld) : { pins: [], moving: false };
    pinLayer.render(next.pins, pinAt, undefined, { now: at, project, done: placePeople });
  }
  /** The trip: the real route as a line, and the traveller placed from the server's own progress. No script moves it. */
  let tripKey = '', tripRoute: Pick<Route, 'points' | 'lengths' | 'length'> | null = null;
  function placeTrip() {
    const active = isDeparting(state) && (state!.activeAction!.kind === 'travel' || state!.activeAction!.kind === 'commute') ? state!.activeAction! : null;
    const key = (id: string) => (id === 'home' ? (homeAt?.own ? 'home:own' : `home:${state?.travel?.home}`) : id);
    const next = active ? `${state!.location}>${active.id}:${active.mode}` : '';
    if (next !== tripKey) {
      tripKey = next;
      if (active && homeAt?.own) network.attachPlace('home:own', { x: homeAt.x, z: homeAt.z });
      tripRoute = active ? localTripRoute(pack, state!.location!, active.id, active.mode) || (active.mode === 'boat' ? null : network.route(key(state!.location!), key(active.id))) : null;
      const from = active ? spotOf(state!.location) : null, to = active ? spotOf(active.id) : null;
      if (active && active.mode !== 'boat' && !tripRoute && from && to) { const length = Math.hypot(to.x - from.x, to.z - from.z) || 1; tripRoute = { points: [{ x: from.x, y: 0, z: from.z, bridge: null }, { x: to.x, y: 0, z: to.z, bridge: null }], lengths: [0, length], length }; }
      const d = tripRoute ? tripRoute.points.map((point, i) => `${i ? 'L' : 'M'}${point.x.toFixed(2)} ${point.z.toFixed(2)}`).join('') : '';
      for (const node of tripPaths) node.setAttribute('d', d);
    }
    you.hidden = !tripRoute;
    if (!tripRoute) return;
    const done = clamp(1 - active!.remaining / (active!.duration || 1), 0, 1), spot = pointAt(tripRoute, tripRoute.length * done), at = project(spot.x, spot.z);
    you.style.transform = `translate(${Math.round(at.x)}px,${Math.round(at.y)}px) translate(-50%,-100%)`;
  }
  function layout() { if (!measure()) return false; if (!opened) open(); else if (!userMoved && size.width > 720 && !isDeparting(state)) homeView(); apply(); return true; }
  function zoomAt(factor: number, px: number, py: number) {
    const before = ground(px, py);
    scale = clamp(scale * factor, fitScale() * 0.8, MAX_SCALE);
    ox = px - (before.x - box.x) * scale; oy = py - (before.z - box.z) * scale;
    userMoved = true; apply();
  }
  const middle = () => ({ x: insets.left + free().width / 2, y: insets.top + free().height / 2 });
  function dismissHint() { if (!hintSeen) { hintSeen = true; try { globalThis.localStorage?.setItem(MAP_HINT_KEY, '1'); } catch { /* shown again next visit */ } } if (!hint.hidden) hint.hidden = true; }

  // ---- input -------------------------------------------------------------------------------------
  const pointers = new Map<number, { x: number, y: number }>();
  let lastTap = { at: 0, x: 0, y: 0, opened: false };
  let drag: { id: number, from: { x: number, y: number }, ox: number, oy: number, moved: boolean, down: number, type: string, onControl?: boolean } | null = null, pinch: { distance: number, mid: { x: number, y: number } } | null = null, suppressClick = false;
  const local = (event: { clientX: number, clientY: number }) => { const page = container.getBoundingClientRect(); return { x: event.clientX - page.left, y: event.clientY - page.top }; };
  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as Element).closest('[data-m3]')) return;
    if (event.isPrimary) pointers.clear();
    pointers.set(event.pointerId, local(event));
    if (pointers.size === 1) { suppressClick = false; drag = { id: event.pointerId, from: local(event), ox, oy, moved: false, down: performance.now(), type: event.pointerType, onControl: Boolean((event.target as Element).closest('.m3-label,.m3-lga,.m3-person')) }; pinch = null; }
    else if (pointers.size === 2) { const [p, q] = [...pointers.values()] as [{ x: number, y: number }, { x: number, y: number }]; pinch = { distance: Math.hypot(p.x - q.x, p.y - q.y) || 1, mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } }; drag = null; suppressClick = true; }
  }
  function onPointerMove(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    const at = local(event);
    pointers.set(event.pointerId, at);
    if (pinch && pointers.size >= 2) {
      const [p, q] = [...pointers.values()] as [{ x: number, y: number }, { x: number, y: number }], distance = Math.hypot(p.x - q.x, p.y - q.y) || 1, mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      ox += mid.x - pinch.mid.x; oy += mid.y - pinch.mid.y;
      zoomAt(distance / pinch.distance, mid.x, mid.y);
      pinch.distance = distance; pinch.mid = mid; dismissHint();
      return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    const dx = at.x - drag.from.x, dy = at.y - drag.from.y;
    if (!drag.moved && !isDrag(Math.hypot(dx, dy), drag.type)) return;
    if (!drag.moved) { drag.moved = true; suppressClick = true; root.classList.add('is-dragging'); dismissHint(); try { root.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ } }
    ox = drag.ox + dx; oy = drag.oy + dy; userMoved = true;
    apply();
  }
  function onPointerUp(event: PointerEvent) {
    if (!pointers.delete(event.pointerId)) return;
    if (drag?.id === event.pointerId) {
      if (drag.moved || event.type === 'pointercancel') { /* a drag, or a press that was taken away: not a tap */ }
      else if (!isTap(0, performance.now() - drag.down, drag.type)) suppressClick = true;   // held too long: neither a tap nor a click
      else if (!drag.onControl) tap(event);
      drag = null;
    }
    if (pinch && pointers.size < 2) { pinch = null; const [rest] = [...pointers.entries()]; if (rest) drag = { id: rest[0], from: rest[1], ox, oy, moved: true, down: performance.now(), type: 'touch' }; }
    if (!pointers.size) root.classList.remove('is-dragging');
  }
  /** A tap on the ground: a house opens its owner's card, an estate is zoomed into, a local government opens its page. */
  function tap(event: PointerEvent) {
    const at = local(event), time = performance.now();
    // A second tap close to the first zooms in on that spot (unless the first one already opened something).
    if (!lastTap.opened && time - lastTap.at < DOUBLE_TAP_MS && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < DOUBLE_TAP_PX) { lastTap = { at: 0, x: 0, y: 0, opened: false }; dismissHint(); zoomAt(2, at.x, at.y); return; }
    lastTap = { at: time, x: event.clientX, y: event.clientY, opened: false };
    if (openAt(at)) lastTap.opened = true;
  }
  function openAt(at: { x: number, y: number }): boolean {
    if (!pack.lgas?.length) return false;
    const point = ground(at.x, at.y), lga = lgaAt(pack, point.x, point.z);
    if (!lga) return false;
    dismissHint();
    const layout = estateLayout(pack, lga)!, hit = layers.homes ? plotAt(layout, point.x, point.z) : null;
    if (hit && hit.plot >= 0 && drawn.some((item) => item.lga === lga && item.estate === hit.estate)) {
      const house = world?.estate(lga, hit.estate)?.houses.get(hit.plot);
      if (house) { onSelectHouse({ lga, estate: hit.estate, plot: hit.plot, id: house.id ?? null, name: house.name ?? null, online: Boolean(house.online), you: Boolean(house.you), style: house.s, upgrading: house.u > (state?.t ?? 0) }); return true; }
    }
    const occupied = hit && ((world?.summary()?.get(lga)?.occ?.[hit.estate] ?? 0) > 0 || hit.estate === 0);
    if (occupied && layout.pitch(hit.estate) * scale < HOUSE_PIXELS) { api.focusEstate(lga, hit.estate); return true; }
    if (layers.lgas) { onSelectLga(lga); return true; }
    return false;
  }
  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const at = local(event), delta = event.deltaY * (event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? 320 : 1);
    dismissHint();
    zoomAt(Math.exp(-clamp(delta, -240, 240) * (event.ctrlKey ? 0.01 : 0.0018)), at.x, at.y);
  }
  function choose(id: string) {
    selected = id; labelKey = ''; dismissHint(); updateLabels(); apply();
    if (layers.gov && id === stateHouseId) onSelectGov(); else onSelectVenue(id);
  }
  function onClick(event: MouseEvent) {
    const target = event.target as Element;
    const control = target.closest<HTMLElement>('[data-m3]');
    if (control) { onControl(control.dataset.m3!); return; }
    if (suppressClick) { suppressClick = false; if (event.detail !== 0) return; }
    const plate = target.closest<HTMLElement>('.m3-lga');
    if (plate) { onSelectLga(plate.dataset.lga!); return; }
    const pin = pinLayer.hit(target);
    if (pin) { if (pin.ids.length) onSelectPeople(pin.ids, pin.venue); return; }
    const label = target.closest<HTMLElement>('.m3-label');
    if (label) choose(label.dataset.venue!);
  }
  function onControl(name: string | undefined) {
    const at = middle();
    if (name === 'in') zoomAt(1.5, at.x, at.y); else if (name === 'out') zoomAt(1 / 1.5, at.x, at.y);
    else if (name === 'fit') { whole(); apply(); }
    else if (name === 'me') { near(spotOf(state?.location) || homeSpot()); userMoved = true; apply(); }
  }
  function onKey(event: Event) {
    const { action, mode }: { action?: unknown, mode?: unknown } = (event as CustomEvent<{ action?: unknown, mode?: unknown } | null>).detail || {};
    if (mode !== 'map' || container.hidden || layer !== 'city') return;
    if (action === 'move-left') ox += 90; else if (action === 'move-right') ox -= 90; else if (action === 'move-up') oy += 90; else if (action === 'move-down') oy -= 90;
    else if (action === 'zoom-in') { onControl('in'); return; } else if (action === 'zoom-out') { onControl('out'); return; } else if (action === 'zoom-fit') { onControl('fit'); return; } else return;
    userMoved = true; apply();
  }
  function onUi(event: Event) { applyUi((event as CustomEvent<MapUiDetail | null>).detail); }
  function applyUi(raw: MapUiDetail | null | undefined) {
    const detail: MapUiDetail = raw || {};
    if (detail.layer === 'city' || detail.layer === 'world') layer = detail.layer;
    if (typeof detail.filter === 'string') { filter = detail.filter; labelKey = ''; }
    const picked = 'selected' in detail && detail.selected && detail.selected !== selected;
    if ('selected' in detail) { selected = typeof detail.selected === 'string' && labels.has(detail.selected) ? detail.selected : null; labelKey = ''; }
    const seaWasOff = !layers.sea;
    if (detail.layers && typeof detail.layers === 'object') { const given = detail.layers as Partial<Record<keyof MapLayers, unknown>>; layers = { billboards: given.billboards === true, sea: given.sea === true, neighbours: false, gov: given.gov === true, moving: false, lgas: given.lgas !== false, homes: given.homes !== false }; }
    for (const key of ['ads', 'gov'] as const) if (key in detail) (data as Record<string, unknown>)[key] = detail[key] && typeof detail[key] === 'object' ? detail[key] : null;
    updateLabels(); syncChips();
    if (!measure()) return;
    if (!opened) open();
    else if (detail.layout && !userMoved && size.width > 720) homeView();
    if (selected && (picked || detail.layout)) { const spot = spotOf(selected)!, at = project(spot.x, spot.z); if (at.x < insets.left + 60 || at.x > size.width - insets.right - 60 || at.y < insets.top + 70 || at.y > size.height - insets.bottom - 40) centreOn(spot.x, spot.z); }
    if (layers.sea && seaWasOff && model.sea) { scale = Math.max(scale, free().width / (model.sea.x1 - model.sea.x0 + 20)); centreOn((model.sea.x0 + model.sea.x1) / 2, (model.sea.z0 + model.sea.z1) / 2 - 6); userMoved = true; }
    apply();
  }
  root.addEventListener('pointerdown', onPointerDown); root.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp); window.addEventListener('pointercancel', onPointerUp);
  root.addEventListener('wheel', onWheel, { passive: false }); root.addEventListener('click', onClick);
  root.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('jaw:map-ui', onUi); window.addEventListener('jaw:key', onKey);

  const api: Map2D = {
    kind: '2d',
    get ready() { return layer === 'city'; },
    setCity() { layer = 'city'; },
    setState(next: Map2DState | null) {
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
    arrive(done: () => void) { done(); },
    worldChanged() { updatePlates(); if (scale) apply(); },
    setFriends(ids?: Iterable<string> | null) { friends = new Set(ids || []); if (scale) apply(); },
    setPeople(next: MapPeople | null | undefined, clock?: () => number) { people = next ?? EMPTY_PEOPLE; if (clock) peopleNow = clock; placePeople(); },
    focusEstate(lga: string, estate: number) { const cell = estateLayout(pack, lga)?.cells[estate]; if (!cell || !measure()) return; scale = clamp(Math.min(free().width, free().height) / (cell.size * 1.15), fitScale(), MAX_SCALE); centreOn(cell.x, cell.z); userMoved = true; apply(); },
    focusPlot(plot: PlotAddress | null | undefined) { if (!plot || !pack.lgas?.some((lga) => lga.id === plot.lga) || !measure()) return; const layoutOf = estateLayout(pack, plot.lga)!, cell = layoutOf.cells[plot.estate]!, at = layoutOf.plot(plot.estate, plot.plot); scale = clamp(free().width / (cell.size * 0.9), fitScale(), MAX_SCALE); centreOn(at.x, at.z); userMoved = true; apply(); },
    focusLga(id: string) { const lga = pack.lgas?.find((item) => item.id === id); if (!lga || !measure()) return; const xs = lga.polygon.map((point) => clamp(point[0], fit.minX, fit.maxX)), zs = lga.polygon.map((point) => clamp(point[1], fit.minZ, fit.maxZ)); scale = Math.min(free().width / (Math.max(...xs) - Math.min(...xs) + 6), free().height / (Math.max(...zs) - Math.min(...zs) + 6)); centreOn((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2); userMoved = true; apply(); },
    select(id: string) { choose(id); },
    ui(detail: MapUiDetail | null | undefined) { applyUi(detail); },
    view: () => ({ scale, x: ox, y: oy, opened, userMoved }),
    restoreView(next: { scale: number; x: number; y: number }) { if (opened && measure()) { scale = next.scale; ox = next.x; oy = next.y; userMoved = true; apply(); } else pendingView = next; },
    /** Where a place or a map point is on screen (for tests that compare the two maps). */
    screenOf(id: string) { const spot = spotOf(id); if (!spot) return null; const page = container.getBoundingClientRect(), at = project(spot.x, spot.z); return { x: at.x + page.left, y: at.y + page.top }; },
    model,
    diagnostics() { return { kind: '2d', renderCount: 0, loop: false, view: api.view(), houses: { detailed: drawn.length, cached: world?.size?.() ?? 0 }, layers: { ...layers }, people: pinLayer.shown(), labels: [...labels].map(([id, label]) => ({ id, text: label.name.textContent, note: label.note.textContent, hidden: label.node.hidden, compact: label.node.classList.contains('is-compact') })) }; },
    destroy() { destroyed = true; pinLayer.destroy(); window.removeEventListener('pointerup', onPointerUp); window.removeEventListener('pointercancel', onPointerUp); window.removeEventListener('jaw:map-ui', onUi); window.removeEventListener('jaw:key', onKey); root.remove(); },
  };
  updateLabels(); updatePlates();
  return api;
}
