/**
 * OWNER: world
 * The country map: the level above the city. A tilted 2.5D relief of the country with one marker
 * per city — the city you are in ("You are here") and the ones that are coming soon, each with a
 * short teaser. It is drawn from the region registry (src/map3d/regions.js): a new city or a new
 * country is an entry there, not an edit here.
 *
 * Contract (src/life-main.js):
 *   createWorldMap(container, { onOpenCity(cityId), onEnterCity(cityId), held() → [cityId] })
 *     → { setCity(cityId), resize(), destroy() }
 *   onOpenCity   the player chose the city they are already in: show its city map
 *   onEnterCity  the player chose another city they may enter (see cityAccess in regions.js)
 *   held()       the cities in which this player already has a life — from the server's session
 *                response (session.cities), so it is the same on every device. A city shown as
 *                coming soon is offered only to someone who already lives there, labelled
 *                "Preview". Nobody else gets a way in, and no link or browser setting opens one.
 *
 * No WebGL and no animation loop: it is one SVG tilted with a CSS transform, and markers that are
 * real buttons. The list beside the map says the same thing as the markers, in reading order.
 */
import './world-map.css';
import { COUNTRIES, MORE_REGIONS, citiesOf, cityAccess, cityEntry, projector } from './map3d/regions.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WIDTH = 1000;
const ACCESS = {
  here: { tag: 'You are here', action: (city) => `Open the ${city.name} map` },
  enter: { tag: 'Open', action: (city) => `Go to ${city.name}` },
  preview: { tag: 'Preview', action: (city) => `Preview · open your ${city.name} life` },
  soon: { tag: 'Coming soon', action: null },
};

export function createWorldMap(container, { onOpenCity = () => {}, onEnterCity = () => {}, held = () => [] } = {}) {
  let current = 'lagos', selected = 'lagos', countryId = 'nigeria';
  const access = (id) => cityAccess(id, { current, held: held() || [] });

  const root = document.createElement('section');
  root.className = 'wm';
  root.setAttribute('aria-label', 'Country map');
  container.appendChild(root);

  function draw() {
    const country = COUNTRIES[countryId], cities = citiesOf(countryId), flat = projector(countryId, WIDTH);
    const line = (points) => points.map(([lon, lat], i) => { const [x, y] = flat.point(lon, lat); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join('');
    const outline = `${line(country.outline)}Z`;
    const markers = cities.map((city) => {
      const [x, y] = flat.point(city.lon, city.lat), state = access(city.id);
      return `<button type="button" class="wm-pin is-${state}${city.id === selected ? ' is-selected' : ''}${city.stand ? ` is-${esc(city.stand)}` : ''}" data-wm-city="${esc(city.id)}" tabindex="-1" aria-hidden="true" style="left:${(x / flat.width * 100).toFixed(2)}%;top:${(y / flat.height * 100).toFixed(2)}%">
        <span class="wm-pin-stem"></span><span class="wm-pin-dot"></span><span class="wm-pin-label"><b>${esc(city.name)}</b><small>${esc(ACCESS[state].tag)}</small></span></button>`;
    }).join('');
    const cards = cities.map((city) => {
      const state = access(city.id);
      return `<li><button type="button" class="wm-city is-${state}${city.id === selected ? ' is-selected' : ''}" data-wm-city="${esc(city.id)}" aria-pressed="${city.id === selected}">
        <span class="wm-city-dot" aria-hidden="true"></span><span class="wm-city-text"><b>${esc(city.name)}</b><small>${esc(city.region)}</small></span><em>${esc(ACCESS[state].tag)}</em></button></li>`;
    }).join('');
    const city = cityEntry(selected) || cities[0], state = access(city.id), action = ACCESS[state].action;
    root.innerHTML = `
      <header class="wm-head"><h2>${esc(country.name)}</h2><p>One city is open. More states — and other countries — are on the way.</p></header>
      <div class="wm-stage" aria-hidden="true"><div class="wm-board" style="aspect-ratio:${flat.width}/${flat.height.toFixed(0)}">
        <svg class="wm-svg" viewBox="0 0 ${flat.width} ${flat.height.toFixed(0)}" preserveAspectRatio="xMidYMid meet" focusable="false">
          <defs><linearGradient id="wm-land" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2d6a2"/><stop offset=".42" stop-color="#bcd596"/><stop offset="1" stop-color="#8fc07a"/></linearGradient></defs>
          <path d="${outline}" transform="translate(14 64)" fill="#0b2b3a" opacity=".16"/>
          <path d="${outline}" transform="translate(0 26)" fill="#5d7f55"/><path d="${outline}" transform="translate(0 13)" fill="#78a065"/>
          <path d="${outline}" fill="url(#wm-land)" stroke="#f4f7e6" stroke-width="5" stroke-linejoin="round"/>
          ${country.rivers.map((river) => `<path d="${line(river)}" fill="none" stroke="#6fb9d6" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>`).join('')}
        </svg>
        <div class="wm-pins">${markers}</div></div></div>
      <aside class="wm-side" aria-label="Cities in ${esc(country.name)}">
        <ul class="wm-cities">${cards}</ul>
        <div class="wm-detail is-${state}" aria-live="polite"><h3>${esc(city.name)} <span>${esc(ACCESS[state].tag)}</span></h3><p>${esc(city.teaser)}</p>
          ${action ? `<button type="button" class="wm-go" data-wm-go="${esc(city.id)}">${esc(action(city))}</button>` : `<p class="wm-wait">${esc(city.name)} is not open yet. We will announce it in the game when it is.</p>`}</div>
        <p class="wm-more"><b>Later:</b> ${MORE_REGIONS.map(esc).join(' · ')}</p>
      </aside>`;
  }

  function onClick(event) {
    const go = event.target.closest('[data-wm-go]');
    if (go) {
      const id = go.dataset.wmGo, state = access(id);
      if (state === 'here') onOpenCity(id); else if (state === 'enter' || state === 'preview') onEnterCity(id);
      return;
    }
    const pick = event.target.closest('[data-wm-city]');
    if (!pick) return;
    selected = pick.dataset.wmCity;
    const focusList = pick.classList.contains('wm-city');
    draw();
    if (focusList) root.querySelector(`.wm-city[data-wm-city="${CSS.escape(selected)}"]`)?.focus();
  }
  root.addEventListener('click', onClick);
  draw();

  return {
    setCity(id) { if (!cityEntry(id)) return; current = id; selected = id; countryId = cityEntry(id).country; draw(); },
    /** The list of held cities may have changed (a session arrived): draw again. */
    refresh() { draw(); },
    resize() {},
    destroy() { root.removeEventListener('click', onClick); root.remove(); },
  };
}
