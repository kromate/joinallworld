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
 * { layer?: 'city' | 'world', filter?: string, selected?: venueId | null }.
 *
 * Static rendering only: the DOM is built once per city and class names change when the
 * state does. No requestAnimationFrame loop, no timers.
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

export function createCityMap(container, { onSelectVenue = () => {} } = {}) {
  let cityId = 'lagos', state = null, layer = 'city', filter = 'all', selected = null, signature = '', centred = '', built = false;
  let deepLink = null;
  try { deepLink = new URLSearchParams(window.location.search).get('venue'); } catch { deepLink = null; }
  const root = document.createElement('div');
  root.className = 'cmap';
  container.appendChild(root);

  const homeSpot = () => HOME_SPOTS[Object.hasOwn(HOME_SPOTS, state?.travel?.home) ? state.travel.home : DEFAULT_HOME];
  const places = () => [
    ...Object.values(VENUES).map((venue) => (venue.id === 'home' ? { ...venue, map: homeSpot().map, district: homeSpot().district, kind: 'home' } : { ...venue, kind: 'venue' })),
    ...Object.values(COMING_SOON).map((place) => ({ ...place, kind: 'soon' })),
  ].sort((a, b) => a.map.x - b.map.x || a.map.y - b.map.y);

  function build() {
    const names = CITY_MAPS[cityId] || CITY_MAPS.lagos;
    root.innerHTML = `<div class="cmap-scroll"><div class="cmap-canvas" role="group" aria-label="Map of the city. Choose a place to see it and travel there.">${backdrop(names)}${places().map((place) =>
      `<button type="button" class="cmap-pin is-${place.kind}" data-venue="${esc(place.id)}" data-category="${esc(place.category || place.kind)}"><span class="cmap-pin-icon" aria-hidden="true">${esc(place.icon)}</span><span class="cmap-pin-name">${esc(place.kind === 'home' ? 'Home' : venueLabel(place.id, cityId))}</span><span class="cmap-pin-note"></span></button>`).join('')}</div></div>`;
    built = true; signature = '';
    update();
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
      if (id === 'home') { pin.style.left = `${home.map.x}%`; pin.style.top = `${home.map.y}%`; }
      else { const place = venue || COMING_SOON[id]; pin.style.left = `${place.map.x}%`; pin.style.top = `${place.map.y}%`; }
      const dimmed = filter === 'open' ? !open : filter !== 'all' && pin.dataset.category !== filter && id !== 'home';
      pin.classList.toggle('is-here', here);
      pin.classList.toggle('is-going', going === id);
      pin.classList.toggle('is-closed', !soon && !open);
      pin.classList.toggle('is-dimmed', dimmed && !here);
      pin.classList.toggle('is-selected', selected === id);
      const note = soon ? 'Coming soon' : here ? 'You are here' : going === id ? 'On the way' : open ? '' : 'Closed';
      pin.querySelector('.cmap-pin-note').textContent = note;
      const district = id === 'home' ? home.district : venueDistrict(id, cityId);
      pin.setAttribute('aria-label', `${id === 'home' ? 'Home' : venueLabel(id, cityId)}, ${district}${note ? `, ${note.toLowerCase()}` : ', open now'}`);
      if (here) pin.setAttribute('aria-current', 'location'); else pin.removeAttribute('aria-current');
    }
  }

  function centre(id, force = false) {
    if (!built || container.hidden || (!force && centred === id)) return;
    const pin = root.querySelector(`.cmap-pin[data-venue="${CSS.escape(id)}"]`), scroller = root.querySelector('.cmap-scroll');
    if (!pin || !scroller || !scroller.clientWidth) return;
    centred = id;
    scroller.scrollLeft = pin.offsetLeft - scroller.clientWidth / 2;
    scroller.scrollTop = pin.offsetTop - scroller.clientHeight * 0.4; // the Map panel covers the lower part of the screen
  }

  function onClick(event) {
    const pin = event.target.closest('.cmap-pin');
    if (!pin) return;
    selected = pin.dataset.venue;
    update();
    onSelectVenue(pin.dataset.venue);
  }
  function onUi(event) {
    const detail = event.detail || {};
    if (detail.layer === 'city' || detail.layer === 'world') layer = detail.layer;
    if (typeof detail.filter === 'string') filter = detail.filter;
    if ('selected' in detail) { selected = detail.selected || null; if (selected) centre(selected, true); }
    update();
  }
  root.addEventListener('click', onClick);
  window.addEventListener('jaw:map-ui', onUi);
  build();

  return {
    get ready() { return layer === 'city'; },
    setCity(id) { if (id !== cityId || !built) { cityId = id; build(); } layer = 'city'; centred = ''; },
    setState(next) {
      state = next;
      update();
      // A shared link opens its venue card once, after the life has loaded.
      if (deepLink) {
        const id = deepLink; deepLink = null;
        if (Object.hasOwn(VENUES, id) || Object.hasOwn(COMING_SOON, id)) { selected = id; update(); onSelectVenue(id); }
      }
    },
    resize() { if (state) centre(selected || state.location); },
    destroy() { root.removeEventListener('click', onClick); window.removeEventListener('jaw:map-ui', onUi); root.remove(); },
  };
}
