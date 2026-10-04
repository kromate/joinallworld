/**
 * OWNER: home
 * The home chip, and the state Buy mode shares with it. First download.
 *
 * 'home-chip' (HUD chip) — shown at home: which house this is, the room's loading / empty /
 * error state, the object the player tapped, and the shared kitchen inventory with a shortcut
 * to Groceries.
 *
 * Buy mode itself — the catalogue, the placement panel and the selected-object panel — is
 * ./buy.js, fetched with the home panel group the first time Buy is opened. What the two have in
 * common lives here, in `H`: the object the player tapped (`selected`), the piece being placed
 * (`ghost`) and whether Buy mode is on, because the scene must hear about them (and a tap on an
 * object must work) before Buy mode's code has ever been downloaded.
 *
 * The scene and these panels talk through window events (see src/scene/home-scene.js):
 *   this file sends 'jaw:home-ui' { selected, ghost, buy }; the scene sends 'jaw:home-pick'
 *   (a tapped object or floor tile) and 'jaw:home-scene' (ready / empty / error).
 */
import './buy.css';
import { esc, mark, iconFor } from '../dom.js';
import { linkWords } from '../link.js';
import { FURNITURE, KINDS } from '../../game/content/furniture.js';
import { homeOf } from '../../game/content/housing.js';
import { HOUSE_TIERS } from '../../game/content/world.js';
import { checkPlacement, nudge } from '../../game/home-layout.js';
import { isDeparting } from '../../game/registry.js';

/**
 * Shared with ./buy.js.
 *   api       the shell api, captured the first time a panel renders
 *   ghost     { source: 'buy' | 'move' | 'storage', itemId, objectId?, x, y, rot } | null — the piece being placed
 *   selected  id of the placed object the player tapped
 *   hidden    the catalogue is collapsed
 *   inBuy     Buy mode is the nav panel in front
 */
export const H = { api: null, ghost: null, selected: null, hidden: false, inBuy: false };
let kitchenOpen = false;
let scene = { status: 'loading', placed: 0 };
let sent = '';

/** The house the room is laid out for: the rented tier, or the player's own house while they live in it. */
export const houseOf = (state) => homeOf(state, HOUSE_TIERS);
export const itemsOf = (state) => (Array.isArray(state.home?.items) ? state.home.items : []);
/** A star rating drawn with the star glyph: `count` filled stars, or ''. */
export const stars = (count) => (count ? `<span class="buy-star" role="img" aria-label="${count} star${count === 1 ? '' : 's'}">${mark('star').repeat(count)}</span>` : '');
export const objectOf = (state, id) => itemsOf(state).find((item) => item.id === id);
export const whyNot = (state, value = H.ghost) => checkPlacement(houseOf(state).grid, itemsOf(state), FURNITURE[value.itemId], value.x, value.y, value.rot, value.objectId ?? null);

/** Tell the scene what to draw, then redraw the panels and ask the host for one frame of the scene. */
export function show(redraw = true) {
  const state = H.api?.state();
  if (!state) return;
  const detail = { selected: H.selected, buy: H.inBuy, ghost: H.ghost ? { itemId: H.ghost.itemId, x: H.ghost.x, y: H.ghost.y, rot: H.ghost.rot, valid: !whyNot(state) } : null };
  const next = JSON.stringify(detail);
  if (next !== sent) { sent = next; window.dispatchEvent(new CustomEvent('jaw:home-ui', { detail })); }
  if (!redraw) return;
  H.api.refresh();
  H.api.redrawScene();
}

function onPick(event) {
  const api = H.api, state = api?.state();
  if (!state || state.location !== 'home') return;
  const { id, cell } = event.detail || {};
  if (H.inBuy) {
    if (H.ghost) {
      const def = FURNITURE[H.ghost.itemId];
      if (cell && !def.wall) { Object.assign(H.ghost, nudge(houseOf(state).grid, def, { ...H.ghost, x: cell.x, y: cell.y }, 0, 0)); show(); }
      return;
    }
    if ((id || null) !== H.selected) { H.selected = id || null; show(); }
    return;
  }
  const def = FURNITURE[objectOf(state, id)?.itemId];
  if (!def) return;
  H.selected = id;
  show(false);
  const spot = KINDS[def.kind]?.spot;
  // Selecting the spot goes through the server; the accepted state redraws the scene with the marker.
  if (spot) api.goTo('home', spot);
  else { api.toast(`${def.label} — ${def.blurb}`); if (state.spot) api.command('spot', { id: state.spot }); }
}

if (typeof window !== 'undefined') {
  window.addEventListener('jaw:home-pick', onPick);
  window.addEventListener('jaw:home-scene', (event) => { scene = { status: event.detail?.status ?? 'ready', placed: event.detail?.placed ?? 0 }; H.api?.refresh(); });
}

function roomStatus(state, view) {
  if (scene.status === 'error') return { text: 'Your room could not be drawn.', retry: true };
  if (!view.connected) return { text: `${linkWords(view).short} — showing the last copy of your room kept on this device.` };
  if (scene.status === 'loading') return { text: 'Loading your room…' };
  const placed = itemsOf(state).length, grid = houseOf(state).grid;
  if (!placed) return { text: 'Your room is empty. Open Buy to furnish it.' };
  return { text: `${grid} × ${grid} room · ${placed} objects · tap one to use it` };
}

const homeChip = {
  id: 'home-chip', title: 'Home', icon: 'home', placement: 'hud', order: 20,
  /** A room that could not be drawn is something to act on (Try again); otherwise the chip is information for the tray. */
  slot: () => (scene.status === 'error' ? 'alert' : 'hud'),
  render(state, view, shellApi) {
    H.api = shellApi;
    const buying = view.mode === 'buy';
    const left = H.inBuy && !buying;
    H.inBuy = buying;
    const chosen = H.selected ? objectOf(state, H.selected) : null;
    // Leaving Buy mode or the house cancels a placement and clears the marker.
    if (left || (state.location !== 'home' && (H.ghost || H.selected)) || (H.selected && !chosen)) { H.ghost = null; H.selected = null; show(false); }
    const house = houseOf(state);
    const heading = isDeparting(state) && state.activeAction.id === 'home';
    if (state.location !== 'home') return heading ? `<div class="home-chip"><strong>${mark('home')} Heading home…</strong><small>${esc(house.label)} · ${esc(house.district)}</small></div>` : '';
    if (buying) return '';
    const status = roomStatus(state, view);
    const def = H.selected ? FURNITURE[objectOf(state, H.selected)?.itemId] : null;
    const spot = def ? KINDS[def.kind]?.spot : null;
    const object = def ? `<span class="home-chip-object">${iconFor('furniture', def.id, def.icon)} ${esc(def.label)} ${stars(def.stars)}${spot && spot === state.spot ? ' · actions are below' : ''}</span>` : '';
    const kitchen = view.home?.kitchen || [];
    const words = linkWords(view);
    const pantry = state.spot === 'kitchen' ? `<div class="home-kitchen"><button class="home-kitchen-toggle" data-home-kitchen aria-expanded="${kitchenOpen}">${mark('groceries')} In your kitchen (${kitchen.length}) <i class="home-kitchen-caret${kitchenOpen ? ' is-open' : ''}" aria-hidden="true">${mark('chevron')}</i></button>${kitchenOpen ? `<div class="home-kitchen-list">${kitchen.map((item) => `<span>${iconFor('food', item.id, item.icon)} ${esc(item.label)} ×${item.count}</span>`).join('') || '<span>Nothing yet</span>'}</div>` : ''}${view.home?.stocked === false ? `<button class="home-chip-button" data-action="home.kitchen-unpack" ${view.connected && !state.activeAction ? '' : `disabled title="${esc(words ? words.cannot('unpack') : 'Finish your current action first')}"`}>Unpack starter food</button>` : ''}<button class="home-chip-button" data-open="groceries">${mark('groceries')} Order groceries</button></div>` : '';
    return `<div class="home-chip"><strong>${mark('home')} ${esc(house.label)} · ${esc(house.district)}</strong><small role="status">${esc(status.text)}</small>${status.retry ? '<button class="home-chip-button" data-home-retry>Try again</button>' : ''}${object}${pantry}</div>`;
  },
  bind(root, shellApi) {
    H.api = shellApi;
    root.querySelector('[data-home-kitchen]')?.addEventListener('click', () => { kitchenOpen = !kitchenOpen; H.api.refresh(); });
    root.querySelector('[data-home-retry]')?.addEventListener('click', () => {
      sent = '';
      scene = { status: 'loading', placed: 0 };
      window.dispatchEvent(new CustomEvent('jaw:home-ui', { detail: { selected: H.selected, buy: H.inBuy, ghost: null, retry: true } }));
      const state = H.api.state();
      if (state.spot) H.api.command('spot', { id: state.spot }); else H.api.refresh();
    });
  },
};

export default [homeChip];
