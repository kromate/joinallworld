/**
 * OWNER: home
 * Buy mode and the home chip.
 *
 * 'buy' (nav panel) — the furniture catalogue with nine category tabs plus Storage, the
 * placement panel (ghost, arrows, rotate, Place, Cancel) and the selected-object panel (Move,
 * Store, Sell). It renders inline above the bottom nav while the home scene stays visible.
 * Shortcuts arrive through keys(action): move-up/down/left/right, rotate, place, sell, catalogue.
 * Esc arrives as keys('cancel'): it cancels a placement first; with nothing being placed the
 * shell handles it and leaves Buy mode.
 *
 * 'home-chip' (HUD chip) — shown at home: which house this is, the room's loading / empty /
 * error state, the object the player tapped, and the shared kitchen inventory with a shortcut
 * to Groceries.
 *
 * The scene and this panel talk through window events (see src/scene/home-scene.js):
 *   this file sends 'jaw:home-ui' { selected, ghost, buy }; the scene sends 'jaw:home-pick'
 *   (a tapped object or floor tile) and 'jaw:home-scene' (ready / empty / error).
 * The server validates every placement again; the ghost's green/red state uses the same pure
 * rules (src/game/home-layout.js) so the player sees the answer before pressing Place.
 */
import './buy.css';
import { esc, money, json } from '../dom.js';
import { CATEGORIES, FURNITURE, KINDS, SELL_REFUND_RATE, STAR_MULTIPLIER } from '../../game/content/furniture.js';
import { HOUSES, DEFAULT_HOUSE } from '../../game/content/housing.js';
import { checkPlacement, findFreeSpot, footprint, nudge, turn } from '../../game/home-layout.js';

const MOVES = { 'move-up': [0, -1], 'move-down': [0, 1], 'move-left': [-1, 0], 'move-right': [1, 0] };
const HINT = 'Arrow keys move · R rotates · Enter places · Esc cancels';

let api = null;            // the shell api, captured the first time a panel renders
let tab = CATEGORIES[0].id;
let ghost = null;          // { source: 'buy' | 'move' | 'storage', itemId, objectId?, x, y, rot }
let selected = null;       // id of the placed object the player tapped
let hidden = false;        // catalogue collapsed
let inBuy = false;
let kitchenOpen = false;
let scene = { status: 'loading', placed: 0 };
let sent = '';

const houseOf = (state) => HOUSES[state.property?.house] ?? HOUSES[DEFAULT_HOUSE];
const itemsOf = (state) => (Array.isArray(state.home?.items) ? state.home.items : []);
const stars = (count) => (count ? '★'.repeat(count) : '');
const size = (def) => (def.wall ? 'wall' : `${def.w}×${def.h}`);
const refund = (def) => Math.floor(def.price * SELL_REFUND_RATE);
const objectOf = (state, id) => itemsOf(state).find((item) => item.id === id);
const whyNot = (state, value = ghost) => checkPlacement(houseOf(state).grid, itemsOf(state), FURNITURE[value.itemId], value.x, value.y, value.rot, value.objectId ?? null);

/** Tell the scene what to draw, then redraw this panel and ask the host for one frame of the scene. */
function show(redraw = true) {
  const state = api?.state();
  if (!state) return;
  const detail = { selected, buy: inBuy, ghost: ghost ? { itemId: ghost.itemId, x: ghost.x, y: ghost.y, rot: ghost.rot, valid: !whyNot(state) } : null };
  const next = JSON.stringify(detail);
  if (next !== sent) { sent = next; window.dispatchEvent(new CustomEvent('jaw:home-ui', { detail })); }
  if (!redraw) return;
  api.refresh();
  api.redrawScene();
}

function startGhost(state, source, itemId, objectId) {
  const def = FURNITURE[itemId], grid = houseOf(state).grid;
  const placed = objectId ? objectOf(state, objectId) : null;
  const at = placed ? { x: placed.x, y: placed.y, rot: placed.rot }
    : findFreeSpot(grid, itemsOf(state), def) ?? nudge(grid, def, { x: Math.floor(grid / 2), y: Math.floor(grid / 2), rot: 0 }, 0, 0);
  ghost = { source, itemId, ...(objectId ? { objectId } : {}), ...at };
  hidden = false;
}

async function place() {
  const state = api.state();
  if (!ghost || whyNot(state)) return;
  const at = { x: ghost.x, y: ghost.y, rot: ghost.rot };
  const result = ghost.source === 'move' ? await api.command('home.furniture-move', { id: ghost.objectId, ...at })
    : await api.command(ghost.source === 'storage' ? 'home.furniture-place' : 'home.furniture-buy', { item: ghost.itemId, ...at });
  if (!result.ok) return;
  api.toast(api.state().message, 'good');
  ghost = null; selected = null;
  show();
}

async function sell() {
  const state = api.state(), placed = objectOf(state, selected);
  if (!placed || ghost) return;
  const result = await api.command('home.furniture-sell', { id: placed.id });
  if (!result.ok) return;
  api.toast(api.state().message, 'good');
  selected = null;
  show();
}

function move(action) {
  const state = api.state();
  if (!ghost && selected && objectOf(state, selected)) startGhost(state, 'move', objectOf(state, selected).itemId, selected);
  if (!ghost) return;
  const def = FURNITURE[ghost.itemId], grid = houseOf(state).grid;
  Object.assign(ghost, action === 'rotate' ? turn(grid, def, ghost) : nudge(grid, def, ghost, ...MOVES[action]));
  show();
}

function onPick(event) {
  const state = api?.state();
  if (!state || state.location !== 'home') return;
  const { id, cell } = event.detail || {};
  if (inBuy) {
    if (ghost) {
      const def = FURNITURE[ghost.itemId];
      if (cell && !def.wall) { Object.assign(ghost, nudge(houseOf(state).grid, def, { ...ghost, x: cell.x, y: cell.y }, 0, 0)); show(); }
      return;
    }
    if ((id || null) !== selected) { selected = id || null; show(); }
    return;
  }
  const def = FURNITURE[objectOf(state, id)?.itemId];
  if (!def) return;
  selected = id;
  show(false);
  const spot = KINDS[def.kind]?.spot;
  // Selecting the spot goes through the server; the accepted state redraws the scene with the marker.
  if (spot) api.goTo('home', spot);
  else { api.toast(`${def.label} — ${def.blurb}`); if (state.spot) api.command('spot', { id: state.spot }); }
}

if (typeof window !== 'undefined') {
  window.addEventListener('jaw:home-pick', onPick);
  window.addEventListener('jaw:home-scene', (event) => { scene = { status: event.detail?.status ?? 'ready', placed: event.detail?.placed ?? 0 }; api?.refresh(); });
}

// ---- Buy panel ---------------------------------------------------------------------------------

function blockedReason(state, view, price) {
  if (!view.connected) return 'Offline — reconnect to buy';
  if (state.activeAction) return 'Finish your current action first';
  if (price > state.cash) return `Need ${money(price - state.cash)} more`;
  return '';
}

function card(state, view, def) {
  const price = view.home?.prices?.[def.id] ?? def.price;
  const reason = blockedReason(state, view, price);
  const discount = price < def.price ? `<s>${money(def.price)}</s> ` : '';
  return `<button class="buy-card" data-buy-item="${esc(def.id)}" ${reason ? 'disabled' : ''} aria-label="${esc(def.label)}, ${esc(size(def))}, ${def.stars} stars, ${esc(money(price))}${reason ? `, ${esc(reason)}` : ''}"><span class="buy-card-top"><em>${esc(size(def))}</em><em class="buy-stars">${stars(def.stars)}</em></span><span class="buy-emoji" aria-hidden="true">${esc(def.icon)}</span><strong>${esc(def.label)}</strong><b class="${price <= state.cash ? 'is-afford' : ''}">${discount}${money(price)}</b>${reason ? `<small class="buy-need">${esc(reason)}</small>` : ''}</button>`;
}

function storageCard(state, view, def, count) {
  const reason = !view.connected ? 'Offline — reconnect to place' : state.activeAction ? 'Finish your current action first' : '';
  return `<div class="buy-card is-stored"><span class="buy-card-top"><em>${esc(size(def))}</em><em>×${count}</em></span><span class="buy-emoji" aria-hidden="true">${esc(def.icon)}</span><strong>${esc(def.label)}</strong><span class="buy-stored-actions"><button data-buy-stored="${esc(def.id)}" ${reason ? 'disabled' : ''}>Place</button><button data-action="home.furniture-sell" data-payload="${json({ item: def.id })}" ${reason ? 'disabled' : ''}>Sell +${money(refund(def))}</button></span>${reason ? `<small class="buy-need">${esc(reason)}</small>` : ''}</div>`;
}

function placementPanel(state, view) {
  const def = FURNITURE[ghost.itemId];
  const price = view.home?.prices?.[def.id] ?? def.price;
  const why = whyNot(state);
  const paying = ghost.source === 'buy';
  const reason = why?.reason || (!view.connected ? 'Offline — reconnect to place furniture.' : state.activeAction ? 'Finish your current action first.' : paying && price > state.cash ? `Need ${money(price - state.cash)} more.` : '');
  const label = paying ? `Place · ${money(price)}` : 'Place';
  const pad = [['move-left', '↖', 'Move left'], ['move-up', '↗', 'Move back'], ['rotate', '⟳', 'Rotate'], ['move-down', '↙', 'Move forward'], ['move-right', '↘', 'Move right']];
  return `<div class="buy-place"><header><strong>${esc(def.icon)} ${esc(def.label)}</strong><span>${paying ? money(price) : ghost.source === 'move' ? 'Moving · free' : 'From storage · free'}</span></header><p class="buy-hint">${HINT}</p><p class="buy-why ${reason ? 'is-bad' : 'is-good'}" role="status">${esc(reason || (def.wall ? 'Fits on this wall.' : 'Fits here.'))}</p><div class="buy-controls"><div class="buy-pad" role="group" aria-label="Move the ghost">${pad.map(([action, glyph, name]) => `<button data-buy-key="${action}" class="buy-pad-${action}" aria-label="${name}">${glyph}</button>`).join('')}</div><div class="buy-row"><button class="ui-button is-primary" data-buy-place ${reason ? 'disabled' : ''}>${label}</button><button class="ui-button" data-buy-cancel>Cancel</button></div></div></div>`;
}

function selectedPanel(state, view, placed) {
  const def = FURNITURE[placed.itemId];
  const reason = !view.connected ? 'Offline — reconnect to change your room.' : state.activeAction ? 'Finish your current action first.' : '';
  const off = reason ? 'disabled' : '';
  return `<div class="buy-place"><header><strong>${esc(def.icon)} ${esc(def.label)} <em class="buy-stars">${stars(def.stars)}</em></strong><span>${esc(size(def))}</span></header><p class="buy-hint">${esc(def.blurb)}</p>${reason ? `<p class="buy-why is-bad" role="status">${esc(reason)}</p>` : ''}<div class="buy-row"><button class="ui-button is-primary" data-buy-move ${off}>Move</button><button class="ui-button" data-buy-store ${off}>Store</button><button class="ui-button" data-buy-sell ${off}>Sell · +${money(refund(def))}</button><button class="ui-button" data-buy-deselect>Done</button></div><p class="buy-hint">Selling returns ${Math.round(SELL_REFUND_RATE * 100)}% of the list price (Del). Storing is free.</p></div>`;
}

function catalogue(state, view) {
  const storage = Object.entries(state.home?.storage || {}).filter(([id]) => FURNITURE[id]);
  const stored = storage.reduce((sum, [, count]) => sum + count, 0);
  if (tab === 'storage' && !stored) tab = CATEGORIES[0].id;
  const tabs = [...CATEGORIES.map((category) => ({ id: category.id, label: `${category.icon} ${category.label}` })), ...(stored ? [{ id: 'storage', label: `📦 Storage (${stored})` }] : [])];
  const cards = tab === 'storage' ? storage.map(([id, count]) => storageCard(state, view, FURNITURE[id], count)).join('')
    : Object.values(FURNITURE).filter((def) => def.category === tab).sort((a, b) => a.price - b.price).map((def) => card(state, view, def)).join('');
  const multiplier = STAR_MULTIPLIER.map((value, count) => `${count ? '★'.repeat(count) : 'no stars'} ×${value}`).join(' · ');
  return `<div class="buy-catalogue ${hidden ? 'is-hidden' : ''}"><header><span class="buy-chip">🛍️ Buy mode</span><span class="buy-wallet">${money(state.cash)}</span><button data-buy-hide aria-expanded="${!hidden}">${hidden ? 'Show catalogue' : 'Hide'}</button><button class="buy-x" data-close aria-label="Close Buy mode">✕</button></header>${hidden ? '<p class="buy-hint">Tap an object in your room to move, store or sell it. C shows the catalogue.</p>' : `<div class="buy-tabs" role="tablist">${tabs.map((item) => `<button role="tab" aria-selected="${item.id === tab}" class="${item.id === tab ? 'is-selected' : ''}" data-buy-tab="${esc(item.id)}">${esc(item.label)}</button>`).join('')}</div><div class="buy-grid">${cards}</div><p class="buy-hint">Stars improve what an object gives you (${esc(multiplier)}). Tap an object in your room to move, store or sell it.</p>`}</div>`;
}

const buy = {
  id: 'buy', title: 'Buy', icon: '🛍️', placement: 'nav',
  /** Buy is only available at home; elsewhere the nav button is disabled with this reason. */
  enabled(state) { return state.location === 'home' || 'Go home to buy furniture'; },
  render(state, view, shellApi) {
    api = shellApi;
    if (ghost && (!FURNITURE[ghost.itemId] || (ghost.objectId && !objectOf(state, ghost.objectId)))) ghost = null;
    if (ghost) return placementPanel(state, view);
    const placed = selected ? objectOf(state, selected) : null;
    return placed ? selectedPanel(state, view, placed) : catalogue(state, view);
  },
  bind(root, shellApi) {
    api = shellApi;
    root.addEventListener('click', (event) => {
      const target = event.target.closest('[data-buy-tab],[data-buy-item],[data-buy-stored],[data-buy-key],[data-buy-place],[data-buy-cancel],[data-buy-hide],[data-buy-move],[data-buy-store],[data-buy-sell],[data-buy-deselect]');
      if (!target || target.disabled) return;
      const data = target.dataset, state = api.state();
      if ('buyTab' in data) { tab = data.buyTab; api.refresh(); }
      else if ('buyHide' in data) { hidden = !hidden; api.refresh(); }
      else if ('buyItem' in data) { startGhost(state, 'buy', data.buyItem); show(); }
      else if ('buyStored' in data) { startGhost(state, 'storage', data.buyStored); show(); }
      else if ('buyKey' in data) move(data.buyKey);
      else if ('buyPlace' in data) place();
      else if ('buyCancel' in data) { ghost = null; show(); }
      else if ('buyMove' in data) { const placed = objectOf(state, selected); if (placed) { startGhost(state, 'move', placed.itemId, placed.id); show(); } }
      else if ('buyStore' in data) { const id = selected; selected = null; api.command('home.furniture-store', { id }).then(() => show()); }
      else if ('buySell' in data) sell();
      else if ('buyDeselect' in data) { selected = null; show(); }
    });
  },
  keys(action) {
    if (!api) return false;
    if (action === 'cancel') {
      if (!ghost) return false; // nothing being placed: let the shell leave Buy mode
      ghost = null; show();
      return true;
    }
    if (action in MOVES || action === 'rotate') move(action);
    else if (action === 'place') place();
    else if (action === 'sell') sell();
    else if (action === 'catalogue') { ghost = null; hidden = !hidden; show(); }
  },
};

// ---- Home chip ---------------------------------------------------------------------------------

function roomStatus(state, view) {
  if (scene.status === 'error') return { text: 'Your room could not be drawn.', retry: true };
  if (!view.connected) return { text: 'Offline — showing your last saved room.' };
  if (scene.status === 'loading') return { text: 'Loading your room…' };
  const placed = itemsOf(state).length, grid = houseOf(state).grid;
  if (!placed) return { text: 'Your room is empty. Open Buy to furnish it.' };
  return { text: `${grid} × ${grid} room · ${placed} objects · tap one to use it` };
}

const homeChip = {
  id: 'home-chip', title: 'Home', icon: '🏠', placement: 'hud', order: 20,
  render(state, view, shellApi) {
    api = shellApi;
    const buying = view.mode === 'buy';
    const left = inBuy && !buying;
    inBuy = buying;
    const chosen = selected ? objectOf(state, selected) : null;
    // Leaving Buy mode or the house cancels a placement and clears the marker.
    if (left || (state.location !== 'home' && (ghost || selected)) || (selected && !chosen)) { ghost = null; selected = null; show(false); }
    const house = houseOf(state);
    const heading = state.activeAction?.kind === 'travel' && state.activeAction.id === 'home';
    if (state.location !== 'home') return heading ? `<div class="home-chip"><strong>🏠 Heading home…</strong><small>${esc(house.label)} · ${esc(house.district)}</small></div>` : '';
    if (buying) return '';
    const status = roomStatus(state, view);
    const def = selected ? FURNITURE[objectOf(state, selected)?.itemId] : null;
    const spot = def ? KINDS[def.kind]?.spot : null;
    const object = def ? `<span class="home-chip-object">${esc(def.icon)} ${esc(def.label)} ${stars(def.stars)}${spot && spot === state.spot ? ' · actions are below' : ''}</span>` : '';
    const kitchen = view.home?.kitchen || [];
    const pantry = state.spot === 'kitchen' ? `<div class="home-kitchen"><button class="home-kitchen-toggle" data-home-kitchen aria-expanded="${kitchenOpen}">🧺 In your kitchen (${kitchen.length}) ${kitchenOpen ? '▴' : '▾'}</button>${kitchenOpen ? `<div class="home-kitchen-list">${kitchen.map((item) => `<span>${esc(item.icon)} ${esc(item.label)} ×${item.count}</span>`).join('') || '<span>Nothing yet</span>'}</div>` : ''}${view.home?.stocked === false ? `<button class="home-chip-button" data-action="home.kitchen-unpack" ${view.connected && !state.activeAction ? '' : `disabled title="${view.connected ? 'Finish your current action first' : 'Offline'}"`}>Unpack starter food</button>` : ''}<button class="home-chip-button" data-open="groceries">🛒 Order groceries</button></div>` : '';
    return `<div class="home-chip"><strong>🏠 ${esc(house.label)} · ${esc(house.district)}</strong><small role="status">${esc(status.text)}</small>${status.retry ? '<button class="home-chip-button" data-home-retry>Try again</button>' : ''}${object}${pantry}</div>`;
  },
  bind(root, shellApi) {
    api = shellApi;
    root.querySelector('[data-home-kitchen]')?.addEventListener('click', () => { kitchenOpen = !kitchenOpen; api.refresh(); });
    root.querySelector('[data-home-retry]')?.addEventListener('click', () => {
      sent = '';
      scene = { status: 'loading', placed: 0 };
      window.dispatchEvent(new CustomEvent('jaw:home-ui', { detail: { selected, buy: inBuy, ghost: null, retry: true } }));
      const state = api.state();
      if (state.spot) api.command('spot', { id: state.spot }); else api.refresh();
    });
  },
};

export default [buy, homeChip];
