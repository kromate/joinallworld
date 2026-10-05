import { CITY_MAPS } from './map3d/city-labels.ts';
/**
 * OWNER: world
 * The simple city map: a flat schematic of the city (mainland, island, lagoon, bridges) with one
 * labelled pin per venue, a Home pin and coming-soon pins. It is drawn behind the Map panel
 * (src/ui/panels/map.js), which holds the filter bar and the venue card.
 *
 * WHEN IT IS USED: the 3D miniature (src/map3d) is the city map wherever it can run. This one is
 * the fallback where WebGL is unavailable or its context is lost, the map of a city that has no
 * 3D pack yet, and the player's own choice ("Simple map"). src/map3d/index.ts decides and swaps;
 * both maps answer to the same contract below.
 *
 * A TRIP is shown here too, without any animation loop: a line from where the trip started to
 * where it is going and a dot on it, placed from the server's own `remaining ÷ duration` every
 * time a state arrives (a CSS animation carries it to the end over the seconds left).
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
 * PAN AND ZOOM. When the map opens, the whole city is fitted into the part of the screen the HUD
 * and the Map panel leave free — unless that would make it too small to name its places (a phone),
 * in which case it opens closer, on where the player is, with every name readable; "Whole city"
 * is then one tap away. Drag pans, a pinch or the wheel zooms about the point under
 * the fingers or the cursor, and the + / − / fit / find-me buttons do the same for anyone who
 * cannot. From the keyboard (forwarded by the shell as 'jaw:key'): arrows pan, + and − zoom,
 * 0 fits the city again. Zooming changes the size of the map, never of the pins: a label is
 * always the same readable size, and at a small scale only Home, where you are and the
 * selected place keep their labels (every pin is still a button with its full name). Labels of
 * pins near the left or right edge grow inwards, so none is cut off. The map can be dragged at
 * every zoom, including the whole-city view; most of it always stays on screen, and "whole city"
 * (or zooming all the way out) centres it again. Two fingers pan and zoom together.
 *
 * Static rendering only: the DOM is built once per city; class names change when the state
 * does and the transform changes when the player pans or zooms. No frame loop, no timers —
 * every redraw is the direct result of one input event.
 * Pins are real buttons in west-to-east reading order, so the map is keyboard reachable.
 * A link with ?venue=<id> opens that venue's card once the life has loaded.
 */
import './city-map.css';
import { COMING_SOON } from './game/content/venues.ts';
import { contentFor } from './game/cities/runtime.ts';
import { defaultHouseFor, housingFor } from './game/cities/housingRuntime.ts';
import { isOpen } from './game/clock.ts';
import { isDeparting } from './game/registry.ts';
import { iconFor } from './ui/icon-map.ts';
import type { CityMapNames, MapPoint, VenueDefinition } from './types/index.ts';
import type { AdsData, GovData, MapLayers, MapUiDetail, NeighboursData } from './map3d/map2d.ts';

/** The coming-soon list and compatibility city names, read by id. */
type PinSource = { id: string; label?: string; district?: string; category?: string; icon?: string; map: MapPoint; hours?: VenueDefinition['hours'] };
const SOON_TABLE: Readonly<Record<string, PinSource>> = COMING_SOON as Readonly<Record<string, PinSource>>;
const CITY_TABLE: Readonly<Partial<Record<string, CityMapNames>>> = CITY_MAPS;

export const svgVenueTable = (cityId: string): Readonly<Record<string, PinSource>> => Object.fromEntries(contentFor(cityId).venues.map((venue) => [venue.id, venue.definition]));
export const svgHomeTable = (cityId: string) => Object.fromEntries(housingFor(cityId).map(({ definition, spot }) => [definition.id, spot]));

/** The part of the life state this map reads (a full LifeState fits). */
export interface CityMapState {
  t?: number;
  location?: string;
  activeAction?: { kind: string; id: string; duration: number; remaining: number } | null;
  travel?: { home?: string };
}
export interface CityMapOptions {
  onSelectVenue?: (venueId: string) => void;
  onSelectGov?: () => void;
  onSelectNeighbour?: (neighbour: { id: string; name: string }) => void;
}
/** The overlays' layers: the 2D city map has no moving or LGA layer. */
type CityLayers = Pick<MapLayers, 'billboards' | 'sea' | 'neighbours' | 'gov'>;
export interface CityMapView { scale: number; x: number; y: number; fitted: boolean; closeUp: boolean; compact: boolean }
export interface CityMap {
  readonly ready: boolean;
  setCity(id: string): void;
  setState(next: CityMapState | null): void;
  resize(): void;
  readonly kind: '2d';
  view(): CityMapView;
  destroy(): void;
  // The rest of the 3D and the other flat map's surface (src/map3d/index.ts calls them with `?.`): this legacy map does not have them.
  setPlayer?(player?: unknown): boolean;
  setFriends?(ids?: Iterable<string> | null): void;
  arrive?(done: () => void): void;
  worldChanged?(): void;
  focusEstate?(lga: string, estate: number): void;
  focusPlot?(plot: { lga: string; estate: number; plot: number } | null | undefined): void;
  focusLga?(id: string): void;
  select?(id: string): void;
  ui?(detail: MapUiDetail | null | undefined): void;
}

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]!);

/** The backdrop: 1000 × 700 units, the same space venue map positions are given in. */
function backdrop(names: CityMapNames) {
  const palm = (x: number, y: number) => `<g transform="translate(${x} ${y})"><path d="M0 0v-16" stroke="#7b6a4d" stroke-width="2.4"/><path d="M0-16c-9-6-15-3-18 2m18-2c9-6 15-3 18 2m-18-2c-3-9-10-11-15-9m15 9c3-9 10-11 15-9" fill="none" stroke="#3d8a5a" stroke-width="3" stroke-linecap="round"/></g>`;
  return `<svg class="cmap-art" viewBox="0 0 1000 700" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <rect width="1000" height="700" fill="#7cc3dc"/>
    <g fill="none" stroke="#f3e6b8" stroke-width="10" stroke-linejoin="round"><path d="M0 0h1000v262c-60 22-130 8-200 16-90 10-150 34-250 26-110-9-180-40-290-30C170 281 80 300 0 286Z"/><path d="M22 388c50-22 130-18 210-22 110-6 190 10 300 6 100-4 190-22 286-8 14 60 12 190-6 296-90 22-200 14-300 18-150 6-330 10-470-4-34-90-40-200-20-286Z"/><path d="M852 352c44-14 98-10 134 4 12 100 10 220-2 318-42 12-98 12-136 0-12-104-10-226 4-322Z"/></g>
    <path d="M0 0h1000v262c-60 22-130 8-200 16-90 10-150 34-250 26-110-9-180-40-290-30C170 281 80 300 0 286Z" fill="#c3d99e"/>
    <path d="M22 388c50-22 130-18 210-22 110-6 190 10 300 6 100-4 190-22 286-8 14 60 12 190-6 296-90 22-200 14-300 18-150 6-330 10-470-4-34-90-40-200-20-286Z" fill="#cbdfa8"/>
    <path d="M852 352c44-14 98-10 134 4 12 100 10 220-2 318-42 12-98 12-136 0-12-104-10-226 4-322Z" fill="#c6dca2"/>
    <path d="M24 62c30-12 70-10 96 2 6 40 4 76-4 104-30 10-66 8-92-2-8-36-8-72 0-104Z" fill="#f1e2ac" stroke="#d9b24a" stroke-width="2" stroke-dasharray="8 6"/>
    <path d="M18 620c34-10 96-8 124 4 6 22 4 44-4 62-40 8-90 8-122-2-6-22-6-44 2-64Z" fill="#f1e2ac" stroke="#d9b24a" stroke-width="2" stroke-dasharray="8 6"/>
    <g fill="none" stroke="#6a6f78" stroke-linecap="round" stroke-linejoin="round">
      <path d="M40 150c140-40 300 30 470 0s300-50 450-20" stroke-width="9"/>
      <path d="M150 70c20 60 10 140 30 200M440 40c-10 70 20 150 0 250M720 50c10 70-20 150 0 220" stroke-width="6"/>
      <path d="M60 470c160-20 300 30 460 0s200-30 290-10" stroke-width="9"/>
      <path d="M90 600c150 20 330-20 480 10s170 0 240-10" stroke-width="6"/>
      <path d="M250 380c10 90-10 190 10 300M520 380c-10 90 20 200 0 300" stroke-width="6"/>
      <path d="M910 370c-10 100 20 200 0 300" stroke-width="7"/>
    </g>
    <g stroke="#efe9da" stroke-width="15" stroke-linecap="round"><path d="M250 284v100"/><path d="M620 300v74"/><path d="M806 500h52"/></g>
    <g stroke="#6a6f78" stroke-width="8" stroke-linecap="butt"><path d="M250 280v108"/><path d="M620 296v82"/><path d="M802 500h60"/></g>
    ${([[70, 240], [330, 250], [560, 262], [900, 236], [120, 430], [420, 420], [700, 430], [640, 660], [300, 664], [960, 420], [950, 640]] as [number, number][]).map(([x, y]) => palm(x, y)).join('')}
    <g fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"><path d="M90 330q14-8 28 0t28 0M430 344q14-8 28 0t28 0M700 322q14-8 28 0t28 0"/></g>
    <g font-family="DM Sans, Arial, sans-serif" font-weight="800" letter-spacing="5" text-anchor="middle">
      <text x="500" y="226" font-size="24" fill="#4f6a45" fill-opacity=".55">${esc(names.north)}</text>
      <text x="420" y="340" font-size="17" fill="#f1fbff" fill-opacity=".95">${esc(names.water)}</text>
      <text x="420" y="540" font-size="24" fill="#4f6a45" fill-opacity=".55">${esc(names.south)}</text>
      <text x="918" y="470" font-size="15" fill="#4f6a45" fill-opacity=".65" letter-spacing="3">${esc(names.east)}</text>
    </g>
    <g font-family="DM Sans, Arial, sans-serif" font-size="11" font-weight="700" fill="#f1fbff">
      <text x="238" y="322" text-anchor="end">${esc(names.bridges[0])}</text><text x="632" y="344">${esc(names.bridges[1])}</text><text x="832" y="492" text-anchor="middle">${esc(names.bridges[2])}</text>
    </g>
  </svg>`;
}

const HOMES_SHOWN = 12;
const W = 1000, H = 700;          // the map's own units (venue positions are percentages of this)
const LABEL_WIDTH = 720;          // below this many CSS pixels of map width, only the important labels show
const START_WIDTH = 820;          // the map width a small screen opens at, so place names can be read
const MAX_WIDTH = 2200;           // the furthest zoom, as map width in CSS pixels
const KEEP = 0.6;                 // the share of the map (or of the free area, if smaller) that must stay in view
const DRAG_START = 6;             // pixels a pointer must travel before a press becomes a drag
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const ICON = (path: string) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
let hintSeen = false;             // the how-to line is shown until the player first moves the map or picks a place

export function createCityMap(container: HTMLElement, { onSelectVenue = () => {}, onSelectGov = () => {}, onSelectNeighbour = () => {} }: CityMapOptions = {}): CityMap {
  let cityId = 'lagos', state: CityMapState | null = null, layer: 'city' | 'world' = 'city', filter = 'all', selected: string | null = null, signature = '', built = false;
  let layers: CityLayers = { billboards: false, sea: false, neighbours: false, gov: false }, overlay: { ads: AdsData | null, neighbours: NeighboursData | null, gov: GovData | null } = { ads: null, neighbours: null, gov: null }, overlayKey = '', seaPending = false;
  // The view: `scale` is CSS pixels per map unit, (x, y) is where the map's top-left corner sits in the container.
  // `closeUp` is true while the view is the closer opening view of a small screen (see open()).
  let scale = 0, x = 0, y = 0, fitted = false, userMoved = false, closeUp = false, shown = '', dock = '';
  let deepLink: string | null = null, tripKey = '';
  try { deepLink = new URLSearchParams(window.location.search).get('venue'); } catch { deepLink = null; }
  const root = document.createElement('div');
  root.className = 'cmap';
  container.appendChild(root);
  let view: HTMLElement | null = null, worldNode: HTMLElement | null = null, canvas: HTMLElement | null = null, controls: Record<string, HTMLElement | undefined> = {};

  const venueTable = () => svgVenueTable(cityId);
  const homeTable = () => svgHomeTable(cityId);
  const stateHouseId = () => contentFor(cityId).venues.find((venue) => venue.kind === 'statehouse')?.id ?? null;
  const govVenueIds = () => new Set(contentFor(cityId).venues.filter((venue) => venue.kind === 'statehouse' || venue.kind === 'polling').map((venue) => venue.id));
  const homeSpot = () => { const homes = homeTable(); return homes[state?.travel?.home ?? ''] ?? homes[defaultHouseFor(cityId).id]!; };
  const places = () => [
    ...Object.values(venueTable()).map((venue) => (venue.id === 'home' ? { ...venue, map: homeSpot().map, district: homeSpot().district, kind: 'home' } : { ...venue, kind: 'venue' })),
    ...Object.values(SOON_TABLE).map((place) => ({ ...place, kind: 'soon' })),
  ].sort((a, b) => a.map.x - b.map.x || a.map.y - b.map.y);
  const pointOf = (id: string | undefined): MapPoint | undefined => (id === 'home' ? homeSpot().map : (venueTable()[id ?? ''] || SOON_TABLE[id ?? ''])?.map);

  function build() {
    const names = CITY_TABLE[cityId] || CITY_TABLE.lagos!;
    root.innerHTML = `<div class="cmap-view"><div class="cmap-world"><div class="cmap-canvas" role="group" aria-label="Map of the city. Choose a place to see it and travel there. Drag to move the map; plus and minus zoom; zero shows the whole city.">${backdrop(names)}${places().map((place) =>
      `<button type="button" class="cmap-pin is-${place.kind}" data-venue="${esc(place.id)}" data-category="${esc(place.category || place.kind)}"><span class="cmap-pin-icon" aria-hidden="true">${iconFor('venue', place.id, place.icon)}</span><span class="cmap-pin-name">${esc(place.kind === 'home' ? 'Home' : place.label ?? place.id)}</span><span class="cmap-pin-note"></span></button>`).join('')}<div class="cmap-trip" data-trip aria-hidden="true"></div><div class="cmap-overlay" data-overlay></div></div><section class="cmap-sea" data-sea hidden aria-label="Sea plots"></section></div></div>
      <div class="cmap-controls" role="group" aria-label="Map view"><button type="button" data-cmap="in" aria-label="Zoom in">${ICON('<path d="M12 5v14M5 12h14"/>')}</button><button type="button" data-cmap="out" aria-label="Zoom out">${ICON('<path d="M5 12h14"/>')}</button><button type="button" class="cmap-fit" data-cmap="fit" aria-label="Show the whole city">${ICON('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')}<span>Whole city</span></button><button type="button" data-cmap="me" aria-label="Show where you are">${ICON('<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>')}</button></div>
      <p class="cmap-hint" data-hint ${hintSeen ? 'hidden' : ''}>Drag to look around. Choose a place to travel there.</p>`;
    view = root.querySelector('.cmap-view'); worldNode = root.querySelector('.cmap-world'); canvas = root.querySelector('.cmap-canvas');
    controls = Object.fromEntries([...root.querySelectorAll<HTMLElement>('[data-cmap]')].map((node) => [node.dataset.cmap, node]));
    built = true; signature = ''; overlayKey = ''; tripKey = ''; fitted = false; userMoved = false; closeUp = false; shown = ''; dock = '';
    pointers.clear(); drag = null; pinch = null; suppressClick = false; root.classList.remove('is-dragging');
    update();
    drawOverlays();
    if (!container.hidden) open();
  }
  function dismissHint() {
    if (hintSeen) return;
    hintSeen = true;
    const hint = root.querySelector<HTMLElement>('[data-hint]');
    if (hint) hint.hidden = true;
  }

  // ---- the view: fit, clamp, pan, zoom -------------------------------------------------------

  /** The part of the container nothing covers: below the top bar, above the nav, clear of the Map panel. */
  function freeRect() {
    const page = container.getBoundingClientRect();
    const box = (selector: string) => { const rect = document.querySelector(selector)?.getBoundingClientRect(); return rect && rect.height ? rect : null; };
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
    // `sheet` is how far the nav and the bottom sheet reach up from the bottom edge; the view buttons of a phone sit just above it.
    return { left, top, width, height, right: left + width, bottom: top + height, sheet: bottom - 34, isWide };
  }
  const fitScale = (free = freeRect()) => Math.min((free.width - 16) / W, (free.height - 16) / H);
  const worldHeight = () => (worldNode ? Math.max(H * scale, worldNode.offsetHeight) : H * scale);

  /** Keep the city in reach: it can be dragged freely, but most of it always stays inside the free area. */
  function clamp(free = freeRect()) {
    const width = W * scale, height = worldHeight();
    const keepX = Math.min(width, free.width) * KEEP, keepY = Math.min(height, free.height) * KEEP;
    x = Math.min(free.right - keepX, Math.max(free.left + keepX - width, x));
    y = Math.min(free.bottom - keepY, Math.max(free.top + keepY - height, y));
  }
  /** Write the view to the DOM. Called from input handlers only. */
  function apply() {
    if (!built) return;
    const free = freeRect(), smallest = fitScale(free);
    // Size first: the clamp below measures the world (city plus sea plots) at its new size.
    const size = `${Math.round(W * scale)}px`;
    if (canvas!.style.width !== size) {
      canvas!.style.width = size;
      canvas!.style.height = `${Math.round(H * scale)}px`;
      worldNode!.style.width = size;
    }
    clamp(free);
    // The furniture around the map follows the free area: the phone's view buttons sit above the sheet, the how-to line under the top bar.
    const place = `${Math.round(free.sheet)}|${Math.round(free.left)}|${Math.round(free.top)}`;
    if (place !== dock) {
      dock = place;
      root.style.setProperty('--cmap-dock', `${Math.round(free.sheet) + 8}px`);
      container.style.setProperty('--map-dock', `${Math.round(free.sheet) + 8}px`);
      root.style.setProperty('--cmap-free-left', `${Math.round(free.left)}px`);
      root.style.setProperty('--cmap-free-top', `${Math.round(free.top)}px`);
    }
    if (userMoved) dismissHint();
    const next = `${scale.toFixed(4)}|${Math.round(x)}|${Math.round(y)}|${userMoved}`;
    if (next === shown) return;
    shown = next;
    worldNode!.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
    root.classList.toggle('is-compact', W * scale < LABEL_WIDTH);
    const atFit = scale <= smallest * 1.01, atMax = W * scale >= MAX_WIDTH - 1;
    setControl(controls.out, atFit, 'Zoom out', 'Already showing the whole city');
    setControl(controls.fit, atFit && !userMoved, 'Show the whole city', 'Already showing the whole city');
    setControl(controls.in, atMax, 'Zoom in', 'Already zoomed in as far as the map goes');
  }
  // A control that cannot do anything right now stays focusable and says why, instead of going dead.
  function setControl(node: HTMLElement | undefined, off: boolean, label: string, why: string) {
    if (!node) return;
    node.setAttribute('aria-disabled', String(off));
    node.title = off ? why : label;
    node.setAttribute('aria-label', off ? `${label}. ${why}` : label);
  }
  function fit() {
    if (!built || container.hidden) return;
    const free = freeRect();
    scale = fitScale(free);
    x = free.left + (free.width - W * scale) / 2;
    // With the sea plots showing, the city sits at the top and the sea is a drag away.
    const sea = root.querySelector<HTMLElement>('[data-sea]');
    y = sea && !sea.hidden ? free.top + 8 : free.top + (free.height - H * scale) / 2;
    fitted = true; userMoved = false; closeUp = false;
    apply();
  }
  /**
   * The view the map opens with. Where the whole city fits with its names readable (a wide screen)
   * that is the whole city. On a small screen it is a closer view on where the player is, filling
   * the free area with the map; "Whole city" then zooms out to everything.
   */
  function open() {
    if (!built || container.hidden) return;
    const free = freeRect();
    if (W * fitScale(free) >= LABEL_WIDTH) { fit(); return; }
    scale = START_WIDTH / W;
    const width = W * scale, height = H * scale;
    const point = pointOf(state?.location) || homeSpot().map;
    x = free.left + free.width / 2 - (point.x / 100) * width;
    y = free.top + free.height / 2 - (point.y / 100) * height;
    // Show map, not open water: keep the city edge to edge wherever it is bigger than the free area.
    x = width >= free.width ? Math.min(free.left, Math.max(free.right - width, x)) : free.left + (free.width - width) / 2;
    y = height >= free.height ? Math.min(free.top, Math.max(free.bottom - height, y)) : free.top + (free.height - height) / 2;
    // Where the player is always wins over filling the screen: its pin and name stay well inside the free area.
    const px = x + (point.x / 100) * width, py = y + (point.y / 100) * height;
    const padX = Math.min(96, free.width / 3), padTop = Math.min(64, free.height / 4), padBottom = Math.min(96, free.height / 3);
    if (px < free.left + padX) x += free.left + padX - px; else if (px > free.right - padX) x += free.right - padX - px;
    if (py < free.top + padTop) y += free.top + padTop - py; else if (py > free.bottom - padBottom) y += free.bottom - padBottom - py;
    fitted = true; userMoved = false; closeUp = true;
    apply();
  }
  /** Zoom by `factor` keeping the map point under (cx, cy) — container pixels — where it is. */
  function zoomAt(factor: number, cx?: number, cy?: number) {
    if (!fitted) open();
    const free = freeRect();
    const smallest = fitScale(free);
    const next = Math.min(MAX_WIDTH / W, Math.max(smallest, scale * factor));
    if (Math.abs(next - scale) < 1e-6) { apply(); return; }
    // Zooming all the way out lands on the centred whole-city view.
    if (next <= smallest * 1.001) { fit(); return; }
    const px = cx ?? free.left + free.width / 2, py = cy ?? free.top + free.height / 2;
    x = px - ((px - x) / scale) * next;
    y = py - ((py - y) / scale) * next;
    scale = next; userMoved = true;
    apply();
  }
  function panBy(dx: number, dy: number) { if (!fitted) open(); x += dx; y += dy; userMoved = true; apply(); }
  /** Bring a place into the free area, moving the map as little as possible. `centre` puts it in the middle instead. */
  function reveal(id: string, centre = false) {
    const point = pointOf(id);
    if (!built || container.hidden || !point) return;
    if (!fitted) open();
    const free = freeRect(), px = x + (point.x / 100) * W * scale, py = y + (point.y / 100) * H * scale;
    const padX = Math.min(90, free.width / 3), padY = Math.min(70, free.height / 3);
    if (centre) { x += free.left + free.width / 2 - px; y += free.top + free.height / 2 - py; }
    else {
      if (px < free.left + padX) x += free.left + padX - px; else if (px > free.right - padX) x += free.right - padX - px;
      if (py < free.top + padY) y += free.top + padY - py; else if (py > free.bottom - padY) y += free.bottom - padY - py;
    }
    apply();
  }

  const pointers = new Map<number, { x: number, y: number }>();
  let drag: { id: number, from: { x: number, y: number }, x: number, y: number, moved: boolean } | null = null, pinch: { distance: number, scale: number, mid: { x: number, y: number } } | null = null, suppressClick = false;
  function local(event: { clientX: number, clientY: number }) { const page = container.getBoundingClientRect(); return { x: event.clientX - page.left, y: event.clientY - page.top }; }
  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as Element).closest('[data-cmap]')) return; // the view buttons are not a place to start a drag
    // A primary pointer means no other finger is down: forget any press whose release was never seen,
    // so a lost pointerup can not leave the map stuck in a one-finger "pinch".
    if (event.isPrimary) pointers.clear();
    pointers.set(event.pointerId, local(event));
    // A fresh press starts clean: only the click that ends a drag or a pinch is swallowed (see onClick).
    if (pointers.size === 1) { suppressClick = false; drag = { id: event.pointerId, from: local(event), x, y, moved: false }; pinch = null; }
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number, y: number }, { x: number, y: number }];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      drag = null; suppressClick = true; root.classList.add('is-dragging');
    }
  }
  function onPointerMove(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    const at = local(event);
    pointers.set(event.pointerId, at);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()] as [{ x: number, y: number }, { x: number, y: number }];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1, mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // Two fingers move the map as well as zoom it.
      x += mid.x - pinch.mid.x; y += mid.y - pinch.mid.y; pinch.mid = mid; userMoved = true;
      zoomAt((pinch.scale * distance / pinch.distance) / scale, mid.x, mid.y);
      return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    const dx = at.x - drag.from.x, dy = at.y - drag.from.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_START) return;
    if (!drag.moved) { drag.moved = true; suppressClick = true; root.classList.add('is-dragging'); try { view!.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ } }
    x = drag.x + dx; y = drag.y + dy; userMoved = true;
    apply();
  }
  function onPointerUp(event: PointerEvent) {
    if (!pointers.delete(event.pointerId)) return;
    if (drag?.id === event.pointerId) drag = null;
    if (pinch && pointers.size < 2) {
      pinch = null;
      // One finger lifted: the one still down carries on as a drag, without a jump.
      const [rest] = [...pointers.entries()];
      if (rest) drag = { id: rest[0], from: rest[1], x, y, moved: true };
    }
    if (!pointers.size) root.classList.remove('is-dragging');
  }
  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const at = local(event);
    // Line and page based wheels (deltaMode 1 and 2) report far smaller numbers than pixel based ones.
    const delta = event.deltaY * (event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? 320 : 1);
    zoomAt(Math.exp(-Math.max(-240, Math.min(240, delta)) * (event.ctrlKey ? 0.01 : 0.0018)), at.x, at.y);
  }
  /** Keyboard, forwarded by the shell: arrows pan, + and − zoom, 0 fits. Only while the map is the screen in front. */
  function onKey(event: Event) {
    const { action, mode }: { action?: unknown, mode?: unknown } = (event as CustomEvent<{ action?: unknown, mode?: unknown } | null>).detail || {};
    if (mode !== 'map' || container.hidden || layer !== 'city') return;
    const step = 90;
    if (action === 'move-left') panBy(step, 0); else if (action === 'move-right') panBy(-step, 0);
    else if (action === 'move-up') panBy(0, step); else if (action === 'move-down') panBy(0, -step);
    else if (action === 'zoom-in') zoomAt(1.3); else if (action === 'zoom-out') zoomAt(1 / 1.3); else if (action === 'zoom-fit') fit();
  }
  function onControl(name: string | undefined) {
    if (name === 'in') zoomAt(1.4); else if (name === 'out') zoomAt(1 / 1.4); else if (name === 'fit') fit();
    else if (name === 'me' && state) { if (W * scale < LABEL_WIDTH) { scale = Math.min(MAX_WIDTH / W, LABEL_WIDTH / W * 1.05); userMoved = true; } reveal(state.location!, true); }
  }

  /** Reflect the state in class names and labels. Touches the DOM only when something changed. */
  function update() {
    if (!built) return;
    const now = state?.t ?? 0, home = homeSpot(), venues = venueTable();
    const going = isDeparting(state) ? state!.activeAction!.id : null; // a trip or the commute
    const openIds = Object.values(venues).filter((venue) => isOpen(venue.hours, now)).map((venue) => venue.id).join(',');
    const next = [state?.location, going, home.map.x, home.map.y, filter, selected, openIds].join('|');
    if (next === signature) return;
    signature = next;
    for (const pin of root.querySelectorAll<HTMLButtonElement>('.cmap-pin')) {
      const id = pin.dataset.venue!, venue = venues[id], soon = !venue;
      const here = state?.location === id, open = venue ? isOpen(venue.hours, now) : false;
      const place = id === 'home' ? home.map : (venue || SOON_TABLE[id])!.map;
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
      const note = pin.querySelector('.cmap-pin-note')!;
      note.textContent = status;
      note.className = `cmap-pin-note${status === 'Closed' ? ' is-quiet' : ''}`;
      const district = id === 'home' ? home.district : venue?.district ?? '';
      pin.setAttribute('aria-label', `${id === 'home' ? 'Home' : venue?.label ?? id}, ${district}${status ? `, ${status.toLowerCase()}` : ', open now'}`);
      pin.title = `${id === 'home' ? 'Home' : venue?.label ?? id}${status ? ` · ${status}` : ''}`;
      if (here) pin.setAttribute('aria-current', 'location'); else pin.removeAttribute('aria-current');
    }
  }

  /** The trip in progress: a line and a dot, placed from the server's remaining ÷ duration. No script moves it. */
  function drawTrip() {
    if (!built) return;
    const host = root.querySelector<HTMLElement>('[data-trip]')!, active = state?.activeAction;
    const trip = active && (active.kind === 'travel' || active.kind === 'commute') ? active : null;
    const from = trip && pointOf(state!.location), to = trip && pointOf(trip.id);
    const next = from && to ? `${state!.location}|${trip!.id}|${trip!.remaining}|${trip!.duration}` : '';
    if (next === tripKey) return;
    tripKey = next;
    if (!next) { host.replaceChildren(); return; }
    const done = Math.max(0, Math.min(1, 1 - trip!.remaining / (trip!.duration || 1)));
    const x = from!.x + (to!.x - from!.x) * done, y = from!.y + (to!.y - from!.y) * done;
    host.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="${from!.x}" y1="${from!.y}" x2="${to!.x}" y2="${to!.y}"/></svg><span class="cmap-trip-dot" style="--x0:${x.toFixed(2)}%;--y0:${y.toFixed(2)}%;--x1:${to!.x}%;--y1:${to!.y}%;animation-duration:${Math.max(0.05, trip!.remaining).toFixed(2)}s"></span>`;
  }

  /** Rebuild the civic overlays when a layer or its data changed. Static: nothing here moves by itself. */
  function drawOverlays() {
    if (!built) return;
    const home = homeSpot();
    const next = JSON.stringify([layers, overlay, home.map]);
    if (next === overlayKey) return;
    overlayKey = next;
    const host = root.querySelector<HTMLElement>('[data-overlay]')!, seaHost = root.querySelector<HTMLElement>('[data-sea]')!;
    const nodes: HTMLElement[] = [];
    const ads = overlay.ads, colourOf = (id: string) => ads?.palette?.colours?.find((item) => item.id === id) || { bg: '#256b45', ink: '#ffffff' };
    const boardIcon = (className: string, id: string | undefined) => { const node = make('span', className); node.innerHTML = iconFor('ad', id, ads?.palette?.icons?.find((item) => item.id === id)?.icon); return node; };
    if (layers.billboards && ads) {
      for (const slot of ads.billboards!.slots) {
        const venue = venueTable()[slot.near];
        if (!venue) continue;
        const place = slot.near === 'home' ? home.map : venue.map;
        const board = make('div', `cmap-board${slot.ad ? '' : ' is-free'}`);
        board.style.left = `${place.x + 4.6}%`; board.style.top = `${place.y - 5.4}%`;
        if (slot.ad) {
          const colour = colourOf(slot.ad.colour);
          board.style.background = colour.bg; board.style.color = colour.ink;
          board.append(boardIcon('cmap-board-icon', slot.ad.icon), make('span', 'cmap-board-text', slot.ad.text));
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
        const spot = homeTable()[group.id];
        if (!spot || !group.count) continue;
        const hood = make('div', 'cmap-hood');
        hood.style.left = `${spot.map.x}%`; hood.style.top = `${spot.map.y + 7.5}%`;
        hood.append(make('span', 'cmap-hood-label', `${group.label} · ${group.count} home${group.count === 1 ? '' : 's'} · ${group.online} online`));
        const row = make('div', 'cmap-hood-homes');
        for (const item of group.homes.slice(0, HOMES_SHOWN)) {
          const house = make(item.you ? 'span' : 'button', `cmap-house${item.online ? ' is-online' : ''}${item.you ? ' is-you' : ''}`); house.innerHTML = iconFor('house', null, 'home');
          house.title = item.you ? `${item.name} (you)` : item.name;
          house.setAttribute('aria-label', `${item.name}${item.you ? ' (you)' : ''}, ${item.online ? 'online now' : 'not online'}`);
          if (!item.you) { (house as HTMLButtonElement).type = 'button'; house.dataset.neighbour = item.id; house.dataset.name = item.name; }
          row.append(house);
        }
        const shown = Math.min(group.homes.length, HOMES_SHOWN);
        if (group.count > shown) row.append(make('span', 'cmap-hood-more', `+${group.count - shown}`));
        hood.append(row);
        nodes.push(hood);
      }
    }
    if (layers.gov && overlay.gov) {
      const seat = stateHouseId() ? venueTable()[stateHouseId()!] : null;
      if (seat) {
        const label = make('div', 'cmap-gov', overlay.gov.governor ? `Governor ${overlay.gov.governor.name}` : 'No Governor yet');
        label.style.left = `${seat.map.x}%`; label.style.top = `${seat.map.y - 7.5}%`;
        nodes.push(label);
      }
    }
    host.replaceChildren(...nodes);
    const civic = govVenueIds();
    for (const pin of root.querySelectorAll<HTMLElement>('.cmap-pin')) pin.classList.toggle('is-gov', layers.gov && civic.has(pin.dataset.venue!));
    // Sea plots: a block of open water below the city.
    seaHost.hidden = !(layers.sea && ads);
    shown = ''; // the world's height changes with the sea plots
    if (layers.sea && ads) {
      const sea = ads.sea!, taken = new Map(sea.plots.map((plot) => [plot.slot, plot]));
      const grid = make('div', 'cmap-sea-grid');
      grid.style.gridTemplateColumns = `repeat(${sea.cols}, 1fr)`;
      for (let row = 0; row < sea.rows; row++) for (let col = 0; col < sea.cols; col++) {
        const plot = taken.get(`sea-${row}-${col}`);
        const cell = make('div', `cmap-plot${plot ? ' is-rented' : ''}${row < sea.shoreRows ? ' is-shore' : ''}`);
        if (plot) {
          const colour = colourOf(plot.colour);
          cell.style.background = colour.bg; cell.style.color = colour.ink;
          cell.append(boardIcon('cmap-plot-icon', plot.icon), make('span', 'cmap-plot-text', plot.text));
          cell.setAttribute('role', 'img'); cell.setAttribute('aria-label', `Sea plot ${row + 1}·${col + 1}: ${plot.text}, by ${plot.by.name}`);
          cell.title = `${plot.text} — ${plot.by.name}`;
        }
        grid.append(cell);
      }
      const names = CITY_TABLE[cityId] || CITY_TABLE.lagos!;
      seaHost.replaceChildren(make('h2', 'cmap-sea-title', `${names.sea} · sea plots (${sea.plots.length} of ${sea.rows * sea.cols} rented)`), grid);
    } else seaHost.replaceChildren();
  }

  function onClick(event: MouseEvent) {
    const target = event.target as Element;
    const control = target.closest<HTMLElement>('[data-cmap]');
    if (control) { if (control.getAttribute('aria-disabled') !== 'true') onControl(control.dataset.cmap); return; }
    // Only the pointer click that ends a drag or pinch is swallowed; a keyboard click (detail 0) always goes through.
    if (suppressClick) { suppressClick = false; if (event.detail !== 0) { event.preventDefault(); return; } }
    const house = target.closest<HTMLElement>('[data-neighbour]');
    if (house) { onSelectNeighbour({ id: house.dataset.neighbour!, name: house.dataset.name! }); return; }
    const pin = target.closest<HTMLElement>('.cmap-pin');
    if (!pin) return;
    selected = pin.dataset.venue!;
    dismissHint();
    update();
    // With the Gov layer on, the State House opens the Governor sheet instead of the travel card.
    if (layers.gov && pin.dataset.venue === stateHouseId()) { onSelectGov(); return; }
    onSelectVenue(pin.dataset.venue!);
  }
  function onUi(event: Event) {
    const detail: MapUiDetail & { neighbours?: unknown } = (event as CustomEvent<(MapUiDetail & { neighbours?: unknown }) | null>).detail || {};
    if (detail.layer === 'city' || detail.layer === 'world') layer = detail.layer;
    if (typeof detail.filter === 'string') filter = detail.filter;
    const picked = 'selected' in detail && detail.selected && detail.selected !== selected;
    if ('selected' in detail) selected = (detail.selected || null) as string | null;
    const seaWasOff = !layers.sea;
    if (detail.layers && typeof detail.layers === 'object') { const given = detail.layers as Partial<Record<keyof CityLayers, unknown>>; layers = { billboards: given.billboards === true, sea: given.sea === true, neighbours: given.neighbours === true, gov: given.gov === true }; }
    for (const key of ['ads', 'neighbours', 'gov'] as const) if (key in detail) (overlay as Record<string, unknown>)[key] = detail[key] && typeof detail[key] === 'object' ? detail[key] : null;
    update();
    drawOverlays();
    if (container.hidden) return;
    // The panel changed size (collapsed, expanded, a card opened): the free area moved with it.
    // The whole-city view is fitted again; a closer view stays where it is and only keeps the selected place in sight.
    if (!fitted) open(); else if (detail.layout && !userMoved && !closeUp) fit(); else apply();
    if (selected && (picked || detail.layout)) reveal(selected);
    // Turning the Sea layer on brings the plots into view once they are drawn.
    const sea = root.querySelector<HTMLElement>('[data-sea]');
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
  // Releases are heard on the window, so one that happens off the map (or after a rebuild) still ends the gesture.
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  root.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('jaw:map-ui', onUi);
  window.addEventListener('jaw:key', onKey);
  build();

  return {
    get ready() { return layer === 'city'; },
    setCity(id: string) { if (id !== cityId || !built) { cityId = id; build(); } layer = 'city'; },
    setState(next: CityMapState | null) {
      // The player went somewhere: an untouched closer view opens on the new place the next time the map shows.
      // The same goes for the saved life arriving after the map opened: the player's home may be in another district.
      const before = pointOf(state?.location) || homeSpot().map;
      state = next;
      const after = pointOf(state?.location) || homeSpot().map;
      if (closeUp && !userMoved && (before.x !== after.x || before.y !== after.y)) fitted = false;
      update();
      drawTrip();
      if (!fitted && built && !container.hidden) open();
      drawOverlays();
      // A shared link opens its venue card once, after the life has loaded.
      if (deepLink) {
        const id = deepLink; deepLink = null;
        if (Object.hasOwn(venueTable(), id) || Object.hasOwn(COMING_SOON, id)) { selected = id; update(); onSelectVenue(id); }
      }
    },
    /** The container was shown or changed size: set the opening view the first time, afterwards only keep it in bounds. */
    resize() {
      if (!built || container.hidden) return;
      if (!fitted) open(); else if (!userMoved && !closeUp) fit(); else apply();
      if (selected) reveal(selected);
    },
    kind: '2d',
    /** For tests and diagnostics: the current view. */
    view: () => ({ scale, x, y, fitted, closeUp, compact: W * scale < LABEL_WIDTH }),
    destroy() { root.removeEventListener('click', onClick); window.removeEventListener('pointerup', onPointerUp); window.removeEventListener('pointercancel', onPointerUp); window.removeEventListener('jaw:map-ui', onUi); window.removeEventListener('jaw:key', onKey); root.remove(); },
  };
}
