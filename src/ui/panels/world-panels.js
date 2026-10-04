/**
 * OWNER: world
 * The world's panels:
 *   'lga'         a local government's page: how many live there, who is online, the directory
 *                 (search by name, 25 a page — never the whole list) and a way onto the map
 *   'house-card'  the card of a house tapped on the map: its address, its look, and its owner —
 *                 unless the owner is hidden from the directory, in which case it is a neighbour's
 *                 house and nothing more
 * and renderMyHouse(), the "your house" section the Houses app shows first: the look (free and
 * priced options), upgrades (paid, built on server time) and moving in.
 * Rules and prices: src/game/systems/estate.js, src/game/content/world.js. Data: server/routes/world.js.
 * The panel contract is at the top of src/ui/shell.js.
 */
import './world.css';
import { esc, json, money, avatar, skeleton } from '../dom.js';
import { linkWords } from '../link.js';
import { HOUSE_STYLE, HOUSE_TIERS, STYLE_FIELDS, addressLabel, lgaOf, unpackStyle } from '../../game/content/world.js';
import { renderLgaCard, bindLgaCard, track } from './lga-card.js';

const count = (value) => Number(value || 0).toLocaleString('en-NG');
const FIELD_NAMES = { shape: 'Roof shape', wall: 'Walls', roof: 'Roof colour', door: 'Door', windows: 'Windows', fence: 'Fence', yard: 'Yard', sign: 'Name sign' };

/** A small drawing of a house from its style — the same few numbers the maps draw from. */
export function houseArt(style, tier = 'starter', { scaffold = false } = {}) {
  const rank = HOUSE_TIERS[tier]?.rank ?? 0, w = 70 + rank * 14, h = 40 + rank * 6 + (rank >= 3 ? 22 : 0), x = 110 - w / 2, y = 112 - h;
  const hex = (field) => HOUSE_STYLE[field][style[field]]?.hex ?? '#888';
  const shape = HOUSE_STYLE.shape[style.shape].id, roof = hex('roof');
  const top = shape === 'flat' ? `<rect x="${x - 4}" y="${y - 8}" width="${w + 8}" height="9" rx="2" fill="${roof}"/>`
    : shape === 'twin' ? `<path d="M${x - 5} ${y}L${x + w * 0.25} ${y - 24}L${x + w * 0.5} ${y}L${x + w * 0.75} ${y - 24}L${x + w + 5} ${y}Z" fill="${roof}"/>`
      : shape === 'hip' ? `<path d="M${x - 6} ${y}L${x + w * 0.25} ${y - 24}H${x + w * 0.75}L${x + w + 6} ${y}Z" fill="${roof}"/>` : `<path d="M${x - 6} ${y}L110 ${y - 30}L${x + w + 6} ${y}Z" fill="${roof}"/>`;
  const fence = style.fence ? `<rect x="14" y="98" width="192" height="14" rx="2" fill="${hex('fence')}" fill-opacity=".9"/>` : '';
  const yard = HOUSE_STYLE.yard[style.yard].id;
  const extra = yard === 'none' ? '' : ['flowers', 'tree', 'palm'].includes(yard) ? `<circle cx="186" cy="${yard === 'flowers' ? 104 : 84}" r="${yard === 'flowers' ? 7 : 14}" fill="${yard === 'flowers' ? '#e86a8a' : '#3f8a57'}"/><rect x="184" y="92" width="4" height="20" fill="#6b4a2b"/>` : `<rect x="174" y="90" width="24" height="22" rx="3" fill="${{ tank: '#2f3b46', gen: '#c9423a', car: '#2b5fa8', kiosk: '#e8a13a' }[yard]}"/>`;
  const windows = [x + 10, x + w - 26].map((wx) => `<rect x="${wx}" y="${y + 12}" width="16" height="14" rx="2" fill="${hex('windows')}"/>`).join('');
  const poles = scaffold ? `<g stroke="#c9a35a" stroke-width="3" fill="none">${[x - 8, x + w / 2, x + w + 8].map((px) => `<path d="M${px} 112V${y - 34}"/>`).join('')}<path d="M${x - 8} ${y + 12}H${x + w + 8}M${x - 8} ${y - 18}H${x + w + 8}"/></g>` : '';
  return `<svg class="world-house" viewBox="0 0 220 120" role="img" aria-label="${esc(HOUSE_TIERS[tier]?.label ?? 'House')}${scaffold ? ', being upgraded' : ''}"><rect width="220" height="120" rx="14" fill="#dff0d6"/><rect y="108" width="220" height="12" fill="#bcd596"/>${extra}<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${hex('wall')}"/>${top}${windows}<rect x="${110 - 8}" y="${112 - 26}" width="16" height="26" rx="2" fill="${hex('door')}"/>${fence}${poles}</svg>`;
}

/** "Your house": mounted first in the Houses app. Plain data-action buttons, so it needs no bind of its own. */
export function renderMyHouse(state, view) {
  const e = view.estate;
  if (!e) return '';
  if (!e.placed) return `<section class="world-card"><h3>Your own house</h3><p class="ui-note">Everyone gets a starter house on their own plot, free — in the local government they choose.</p><button class="ui-button is-primary is-block" data-open="profile">Choose where you live</button></section>`;
  const offline = view.connected ? '' : `${linkWords(view).short} — this needs the server`;
  const up = e.upgrade;
  const styles = STYLE_FIELDS.map((field) => `<div class="world-style"><b>${esc(FIELD_NAMES[field])}</b><div class="world-swatches">${e.styles[field].map((option) => `<button type="button" class="world-swatch${option.chosen ? ' is-chosen' : ''}" aria-pressed="${option.chosen}" data-action="estate.style" data-track="house_styled" data-payload="${json({ style: { [field]: option.index } })}" ${offline || option.chosen || (option.price > state.cash) ? 'disabled' : ''} title="${option.price > state.cash && !option.chosen ? `Costs ${money(option.price)}` : ''}">${option.hex ? `<i style="background:${esc(option.hex)}"></i>` : ''}${esc(option.label)}${option.price ? ` · ${money(option.price)}` : ''}</button>`).join('')}</div></div>`).join('');
  const tiers = e.tiers.filter((tier) => tier.id !== 'starter' || tier.current).map((tier) => `<article class="world-tier"><header><h4>${esc(tier.label)} <small>${tier.grid}×${tier.grid} room</small></h4>${tier.current ? '<span class="ui-chip is-good">Yours</span>' : `<b>${money(tier.cost)}</b>`}</header><p>${esc(tier.blurb)}${tier.groundRent ? ` Ground rent ${money(tier.groundRent)} a week.` : ' No ground rent.'}${tier.current ? '' : ` Takes about ${tier.minutes} minutes to build.`}</p>
      ${tier.current ? '' : `<button class="ui-button is-primary is-block" data-action="estate.upgrade" data-payload="${json({ to: tier.id })}" ${offline || tier.blocked ? 'disabled' : ''}>Upgrade · ${money(tier.cost)}</button>${offline || tier.blocked ? `<p class="ui-why">${esc(offline || tier.blocked)}</p>` : ''}`}</article>`).join('');
  const living = e.living === 'own' ? '<span class="ui-chip is-good">You live here · no weekly rent</span>'
    : `<button class="ui-button is-primary is-block" data-action="estate.move-in" ${offline ? 'disabled' : ''}>Move into your own house · free</button><p class="ui-note">Weekly rent stops. Your furniture comes with you; what does not fit goes to storage.</p>`;
  return `<section class="world-card" data-my-house><h3>Your own house</h3>${houseArt(e.style, e.tier.id, { scaffold: Boolean(up) })}
      <p class="world-now"><b>${esc(e.tier.label)}</b><small>${e.plot ? esc(e.plot.address) : 'Your plot is being set aside…'}</small></p>
      ${up ? `<div role="status"><p class="ui-note">Builders at work on your ${esc(up.label)}: about ${Math.ceil(up.remaining / 60)} minute${Math.ceil(up.remaining / 60) === 1 ? '' : 's'} to go. It finishes even while you are away.</p><div class="world-bar"><i style="width:${Math.round(up.progress * 100)}%"></i></div></div>` : ''}
      ${e.arrears ? `<p class="ui-why">Ground rent owed: ${money(e.arrears)}. It is collected on a Saturday when your balance covers it.</p>` : ''}
      ${living}${e.plot ? `<button class="ui-button is-block" data-show-plot="${json(e.plot)}" data-nav="map">Show it on the map</button>` : ''}
      <h3>Look</h3>${styles}<h3>Bigger houses</h3><div class="world-tiers">${tiers}</div></section>`;
}
/** The Houses app calls this after each render: "show on the map" and the styling analytics. */
export function bindMyHouse(root) {
  root.querySelector('[data-my-house]')?.addEventListener('click', (event) => {
    const show = event.target.closest('[data-show-plot]');
    if (show) { const plot = JSON.parse(show.dataset.showPlot); setTimeout(() => window.dispatchEvent(new CustomEvent('jaw:map-focus', { detail: { plot } })), 400); return; }
    if (event.target.closest('[data-track="house_styled"]:not([disabled])')) { track('house_styled'); window.dispatchEvent(new CustomEvent('jaw:world-changed')); }
  });
}

// ---- the local government's page --------------------------------------------------------------
const pages = new Map(); // lga id → { info, items, next, q, online, loading, error }
const pageOf = (id) => { if (!pages.has(id)) pages.set(id, { info: null, items: null, next: null, q: '', online: false, loading: false, error: '' }); return pages.get(id); };
async function loadPeople(api, id, more = false) {
  const page = pageOf(id), city = api.view().cityId;
  if (page.loading) return;
  page.loading = true; page.error = '';
  try {
    if (!more) page.info = await api.fetchJson(`/api/world/lga/${id}?city=${city}`);
    const query = `${page.q ? `&q=${encodeURIComponent(page.q)}` : ''}${page.online ? '&online=1' : ''}${more && page.next !== null ? `&after=${page.next}` : ''}`;
    const body = await api.fetchJson(`/api/world/lga/${id}/people?city=${city}${query}`);
    page.items = more ? [...(page.items || []), ...body.items] : body.items;
    page.next = body.next; page.short = body.short === true;
  } catch (error) { page.error = error?.reason || 'The list could not be loaded. Try again.'; } finally { page.loading = false; }
  if (document.querySelector('dialog [data-lga-page]')) api.open('lga', { lga: id });
}

const lga = {
  id: 'lga', title: 'Local government', placement: 'modal', live: false,
  render(state, view) {
    const id = view.params?.lga, unit = lgaOf(view.cityId, id);
    if (!unit) return '<p class="ui-error">That local government is not on this map.</p>';
    const page = pageOf(id), e = view.estate, yours = e?.placed && e.lga?.id === id;
    const stats = page.info ? `<ul class="world-stats"><li><b>${count(page.info.residents)}</b><small>residents</small></li><li><b>${count(page.info.houses)}</b><small>houses</small></li><li><b>${count(page.info.online)}</b><small>online now</small></li></ul>` : skeleton(1, 'Loading the counts');
    const people = page.error ? `<p class="ui-error">${esc(page.error)}</p><button class="ui-button" data-lga-reload>Try again</button>`
      : page.items === null ? skeleton(4, 'Loading residents')
        : page.short ? '<p class="ui-note">Type at least two letters to search.</p>'
          : page.items.length ? `<ul class="world-people">${page.items.map((item) => `<li class="ui-row">${avatar(item.name, item.id)}<span class="ui-row-body"><b><i class="world-dot${item.online ? ' is-on' : ''}"></i>${esc(item.name)}${item.you ? ' (you)' : ''}</b><small>${item.plot !== undefined ? esc(addressLabel(view.cityId, id, item.estate, item.plot)) : 'Moving in'}</small></span>${item.you ? '' : `<button class="ui-button is-small" data-lga-person="${esc(item.id)}" data-name="${esc(item.name)}">Say hi</button>`}</li>`).join('')}</ul>${page.next !== null ? `<button class="ui-button is-block" data-lga-more ${page.loading ? 'disabled' : ''}>${page.loading ? 'Loading…' : 'Show more'}</button>` : ''}`
            : `<p class="ui-note">${page.q ? 'Nobody listed by that name here.' : page.online ? 'Nobody listed here is online right now.' : 'Nobody is listed here yet.'}</p>`;
    return `<div data-lga-page="${esc(id)}"><section class="ui-hero"><small>${esc(view.city?.name ?? '')} · local government${yours ? ' · yours' : ''}</small><strong>${esc(unit.name)}</strong><p>${esc(unit.line)}</p></section>${stats}
      <div class="world-row"><button class="ui-button" data-lga-show data-nav="map">Show on the map</button>${yours && e.plot ? `<button class="ui-button" data-lga-home="${json(e.plot)}" data-nav="map">Show my house</button>` : ''}</div>
      ${yours ? '' : renderLgaCard(state, view, { heading: e?.placed ? 'Move here?' : 'Live here?', compact: true })}
      <h3 class="ui-section">Residents</h3>
      <form class="world-row" data-lga-search><label class="world-field" style="flex:2 1 180px">Search by name<input name="q" type="search" maxlength="24" value="${esc(page.q)}" autocomplete="off"></label><button class="ui-button" style="flex:0 0 auto;align-self:end">Search</button></form>
      <div class="world-row"><button class="ui-button is-small" data-lga-online aria-pressed="${page.online}">${page.online ? 'Showing online now' : 'Online now only'}</button></div>
      ${people}<p class="ui-note">Players who hide themselves from the directory are not listed here; their houses stay on the map without a name.</p></div>`;
  },
  bind(root, api, params) {
    const node = root.querySelector('[data-lga-page]');
    if (!node) return;
    const id = node.dataset.lgaPage, page = pageOf(id);
    if (page.items === null && !page.loading && !page.error) { track('estate_viewed', { lga: id }); void loadPeople(api, id); }
    bindLgaCard(root, api, { redraw: () => api.open('lga', { lga: id }), onChosen: () => { page.items = null; } });
    root.querySelector('[data-lga-search]')?.addEventListener('submit', (event) => { event.preventDefault(); page.q = new FormData(event.target).get('q').toString().trim(); page.items = null; void loadPeople(api, id); api.open('lga', { lga: id }); });
    node.addEventListener('click', (event) => {
      const target = event.target.closest('[data-lga-more],[data-lga-online],[data-lga-reload],[data-lga-person],[data-lga-show],[data-lga-home]');
      if (!target) return;
      if (target.hasAttribute('data-lga-more')) void loadPeople(api, id, true);
      else if (target.hasAttribute('data-lga-online')) { page.online = !page.online; page.items = null; void loadPeople(api, id); api.open('lga', { lga: id }); }
      else if (target.hasAttribute('data-lga-reload')) { page.items = null; void loadPeople(api, id); api.open('lga', { lga: id }); }
      else if (target.dataset.lgaPerson) { track('neighbour_card_opened', { from: 'directory' }); api.open('person', { player: target.dataset.lgaPerson, name: target.dataset.name }); }
      else if (target.hasAttribute('data-lga-show')) setTimeout(() => window.dispatchEvent(new CustomEvent('jaw:map-focus', { detail: { lga: id } })), 400);
      else if (target.dataset.lgaHome) { const plot = JSON.parse(target.dataset.lgaHome); setTimeout(() => window.dispatchEvent(new CustomEvent('jaw:map-focus', { detail: { plot } })), 400); }
    });
    void params;
  },
};

const houseCard = {
  id: 'house-card', title: 'House', placement: 'modal',
  render(state, view) {
    const house = view.params?.house;
    if (!house || !lgaOf(view.cityId, house.lga)) return '<p class="ui-error">That house is not on this map.</p>';
    const { tier, style } = unpackStyle(house.style), address = addressLabel(view.cityId, house.lga, house.estate, house.plot);
    const who = house.you ? '<p class="world-now"><b>Your house</b><small>This is where you live.</small></p><button class="ui-button is-primary is-block" data-open="houses">Style or upgrade it</button>'
      : house.id ? `<p class="world-now"><b><i class="world-dot${house.online ? ' is-on' : ''}"></i>${esc(house.name)}</b><small>${house.online ? 'Online now' : 'Not online'}</small></p><button class="ui-button is-primary is-block" data-open="person" data-params="${json({ player: house.id, name: house.name })}" data-house-owner>Open their card · chat, add friend, knock</button>`
        : '<p class="world-now"><b>A neighbour</b><small>This player is not listed in the directory, so their name is not shown.</small></p>';
    return `<div data-house-card>${houseArt(style, tier, { scaffold: house.upgrading })}<p class="ui-note">${esc(HOUSE_TIERS[tier].label)} · ${esc(address)}${house.upgrading ? ' · being upgraded' : ''}</p>${who}<button class="ui-button is-block" data-open="lga" data-params="${json({ lga: house.lga })}">About ${esc(lgaOf(view.cityId, house.lga).name)}</button></div>`;
  },
  bind(root) { root.querySelector('[data-house-owner]')?.addEventListener('click', () => track('neighbour_card_opened', { from: 'map' })); },
};

export default [lga, houseCard];
