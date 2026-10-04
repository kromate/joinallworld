/**
 * OWNER: home
 * Buy mode.
 *
 * 'buy' (nav panel) — the furniture catalogue with nine category tabs plus Storage, the
 * placement panel (ghost, arrows, rotate, Place, Cancel) and the selected-object panel (Move,
 * Store, Sell). It renders inline above the bottom nav while the home scene stays visible.
 * Shortcuts arrive through keys(action): move-up/down/left/right, rotate, place, sell, catalogue.
 * Esc arrives as keys('cancel'): it cancels a placement first; with nothing being placed the
 * shell handles it and leaves Buy mode.
 *
 * This file is fetched the first time Buy is opened (the home panel group). The home chip and
 * the state it shares with Buy mode — the tapped object, the ghost — are in ./home-chip.js,
 * which is in the first download (see there for the window events between panel and scene).
 * The server validates every placement again; the ghost's green/red state uses the same pure
 * rules (src/game/home-layout.js) so the player sees the answer before pressing Place.
 */
import './buy.css';
import { esc, money, json, mark, icon, iconFor } from '../dom.ts';
import { linkWords } from '../link.ts';
import { CATEGORIES, FURNITURE, SELL_REFUND_RATE, STAR_MULTIPLIER } from '../../game/content/furniture.ts';
import { findFreeSpot, nudge, turn } from '../../game/home-layout.ts';
import { H, houseOf, itemsOf, objectOf, whyNot, show, stars } from './home-chip.js';

const MOVES = { 'move-up': [0, -1], 'move-down': [0, 1], 'move-left': [-1, 0], 'move-right': [1, 0] };
const HINT = 'Arrow keys move · R rotates · Enter places · Esc cancels';

let tab = CATEGORIES[0].id;
const size = (def) => (def.wall ? 'wall' : `${def.w}×${def.h}`);
const refund = (def) => Math.floor(def.price * SELL_REFUND_RATE);
/** "No internet — cannot buy": the truthful reason nothing can change, or '' when connected. */
const offWhy = (view, what) => (view.connected ? '' : `${linkWords(view).short} — cannot ${what} right now`);

function startGhost(state, source, itemId, objectId) {
  const def = FURNITURE[itemId], grid = houseOf(state).grid;
  const placed = objectId ? objectOf(state, objectId) : null;
  const at = placed ? { x: placed.x, y: placed.y, rot: placed.rot }
    : findFreeSpot(grid, itemsOf(state), def) ?? nudge(grid, def, { x: Math.floor(grid / 2), y: Math.floor(grid / 2), rot: 0 }, 0, 0);
  H.ghost = { source, itemId, ...(objectId ? { objectId } : {}), ...at };
  H.hidden = false;
}

async function place() {
  const state = H.api.state();
  if (!H.ghost || whyNot(state)) return;
  const at = { x: H.ghost.x, y: H.ghost.y, rot: H.ghost.rot };
  const result = H.ghost.source === 'move' ? await H.api.command('home.furniture-move', { id: H.ghost.objectId, ...at })
    : await H.api.command(H.ghost.source === 'storage' ? 'home.furniture-place' : 'home.furniture-buy', { item: H.ghost.itemId, ...at });
  if (!result.ok) return;
  H.api.toast(H.api.state().message, 'good');
  H.ghost = null; H.selected = null;
  show();
}

async function sell() {
  const state = H.api.state(), placed = objectOf(state, H.selected);
  if (!placed || H.ghost) return;
  const result = await H.api.command('home.furniture-sell', { id: placed.id });
  if (!result.ok) return;
  H.api.toast(H.api.state().message, 'good');
  H.selected = null;
  show();
}

function move(action) {
  const state = H.api.state();
  if (!H.ghost && H.selected && objectOf(state, H.selected)) startGhost(state, 'move', objectOf(state, H.selected).itemId, H.selected);
  if (!H.ghost) return;
  const def = FURNITURE[H.ghost.itemId], grid = houseOf(state).grid;
  Object.assign(H.ghost, action === 'rotate' ? turn(grid, def, H.ghost) : nudge(grid, def, H.ghost, ...MOVES[action]));
  show();
}

// ---- Buy panel ---------------------------------------------------------------------------------

function blockedReason(state, view, price) {
  if (!view.connected) return offWhy(view, 'buy');
  if (state.activeAction) return 'Finish your current action first';
  if (price > state.cash) return `Need ${money(price - state.cash)} more`;
  return '';
}

function card(state, view, def) {
  const price = view.home?.prices?.[def.id] ?? def.price;
  const reason = blockedReason(state, view, price);
  const discount = price < def.price ? `<s>${money(def.price)}</s> ` : '';
  return `<button class="buy-card" data-buy-item="${esc(def.id)}" ${reason ? 'disabled' : ''} aria-label="${esc(def.label)}, ${esc(size(def))}, ${def.stars} stars, ${esc(money(price))}${reason ? `, ${esc(reason)}` : ''}"><span class="buy-card-top"><em>${esc(size(def))}</em><em class="buy-stars">${stars(def.stars)}</em></span><span class="buy-emoji" aria-hidden="true">${iconFor('furniture', def.id, def.icon)}</span><strong>${esc(def.label)}</strong><b class="${price <= state.cash ? 'is-afford' : ''}">${discount}${money(price)}</b>${reason ? `<small class="buy-need">${esc(reason)}</small>` : ''}</button>`;
}

function storageCard(state, view, def, count) {
  const reason = offWhy(view, 'place it') || (state.activeAction ? 'Finish your current action first' : '');
  return `<div class="buy-card is-stored"><span class="buy-card-top"><em>${esc(size(def))}</em><em>×${count}</em></span><span class="buy-emoji" aria-hidden="true">${iconFor('furniture', def.id, def.icon)}</span><strong>${esc(def.label)}</strong><span class="buy-stored-actions"><button data-buy-stored="${esc(def.id)}" ${reason ? 'disabled' : ''}>Place</button><button data-action="home.furniture-sell" data-payload="${json({ item: def.id })}" ${reason ? 'disabled' : ''}>Sell +${money(refund(def))}</button></span>${reason ? `<small class="buy-need">${esc(reason)}</small>` : ''}</div>`;
}

function placementPanel(state, view) {
  const def = FURNITURE[H.ghost.itemId];
  const price = view.home?.prices?.[def.id] ?? def.price;
  const why = whyNot(state);
  const paying = H.ghost.source === 'buy';
  const reason = why?.reason || (!view.connected ? `${offWhy(view, 'place furniture')}.` : state.activeAction ? 'Finish your current action first.' : paying && price > state.cash ? `Need ${money(price - state.cash)} more.` : '');
  const label = paying ? `Place · ${money(price)}` : 'Place';
  const pad = [['move-left', '↖', 'Move left'], ['move-up', '↗', 'Move back'], ['rotate', mark('refresh'), 'Rotate'], ['move-down', '↙', 'Move forward'], ['move-right', '↘', 'Move right']];
  // The pad sits under the thumb and everything else beside it, so the panel stays short and the ghost stays in view.
  return `<div class="buy-place is-placing"><div class="buy-pad" role="group" aria-label="Move the ghost">${pad.map(([action, glyph, name]) => `<button data-buy-key="${action}" class="buy-pad-${action}" aria-label="${name}">${glyph}</button>`).join('')}</div><div class="buy-place-main"><header><strong>${iconFor('furniture', def.id, def.icon)} ${esc(def.label)}</strong><span>${paying ? money(price) : H.ghost.source === 'move' ? 'Moving · free' : 'From storage · free'}</span></header><p class="buy-why ${reason ? 'is-bad' : 'is-good'}" role="status">${esc(reason || (def.wall ? 'Fits on this wall.' : 'Fits here. Tap a tile to move it there.'))}</p><div class="buy-row"><button class="ui-button is-primary" data-buy-place ${reason ? 'disabled' : ''}>${label}</button><button class="ui-button" data-buy-cancel>Cancel</button></div><p class="buy-hint buy-keys">${HINT}</p></div></div>`;
}

function selectedPanel(state, view, placed) {
  const def = FURNITURE[placed.itemId];
  const reason = !view.connected ? `${offWhy(view, 'change your room')}.` : state.activeAction ? 'Finish your current action first.' : '';
  const off = reason ? 'disabled' : '';
  return `<div class="buy-place"><header><strong>${iconFor('furniture', def.id, def.icon)} ${esc(def.label)} <em class="buy-stars">${stars(def.stars)}</em></strong><span>${esc(size(def))}</span></header><p class="buy-hint">${esc(def.blurb)}</p>${reason ? `<p class="buy-why is-bad" role="status">${esc(reason)}</p>` : ''}<div class="buy-row"><button class="ui-button is-primary" data-buy-move ${off}>Move</button><button class="ui-button" data-buy-store ${off}>Store</button><button class="ui-button" data-buy-sell ${off}>Sell · +${money(refund(def))}</button><button class="ui-button" data-buy-deselect>Done</button></div><p class="buy-hint">Selling returns ${Math.round(SELL_REFUND_RATE * 100)}% of the list price (Del). Storing is free.</p></div>`;
}

function catalogue(state, view) {
  const storage = Object.entries(state.home?.storage || {}).filter(([id]) => FURNITURE[id]);
  const stored = storage.reduce((sum, [, count]) => sum + count, 0);
  if (tab === 'storage' && !stored) tab = CATEGORIES[0].id;
  const tabs = [...CATEGORIES.map((category) => ({ id: category.id, icon: iconFor('category', category.id, category.icon), label: category.label })), ...(stored ? [{ id: 'storage', icon: iconFor('category', 'storage'), label: `Storage (${stored})` }] : [])];
  const cards = tab === 'storage' ? storage.map(([id, count]) => storageCard(state, view, FURNITURE[id], count)).join('')
    : Object.values(FURNITURE).filter((def) => def.category === tab).sort((a, b) => a.price - b.price).map((def) => card(state, view, def)).join('');
  const multiplier = STAR_MULTIPLIER.map((value, count) => `${count ? `${count} star${count === 1 ? '' : 's'}` : 'no stars'} ×${value}`).join(' · ');
  const empty = tab === 'storage' ? '' : '<div class="ui-empty is-inline"><p>Nothing in this category yet.</p></div>';
  return `<div class="buy-catalogue ${H.hidden ? 'is-hidden' : ''}"><header><span class="buy-chip">${mark('buy')} Buy mode</span><span class="buy-wallet">${money(state.cash)}</span><button data-buy-hide aria-expanded="${!H.hidden}">${H.hidden ? 'Show catalogue' : 'Hide'}</button><button class="buy-x" data-close aria-label="Close Buy mode">${icon('close')}</button></header>${H.hidden ? '<p class="buy-hint">Tap an object in your room to move, store or sell it. C shows the catalogue.</p>' : `<div class="buy-tabs" role="tablist">${tabs.map((item) => `<button role="tab" aria-selected="${item.id === tab}" class="${item.id === tab ? 'is-selected' : ''}" data-buy-tab="${esc(item.id)}">${item.icon}<span>${esc(item.label)}</span></button>`).join('')}</div><div class="buy-grid">${cards || empty}</div><p class="buy-hint">Tap an item to place it, or an object in your room to move, store or sell it. <span class="buy-stars-note">Stars improve what an object gives: ${esc(multiplier)}.</span></p>`}</div>`;
}

const buy = {
  id: 'buy', title: 'Buy', placement: 'nav',
  /** Buy is only available at home; elsewhere the nav button is disabled with this reason. */
  enabled(state) { return state.location === 'home' || 'Go home to buy furniture'; },
  render(state, view, shellApi) {
    H.api = shellApi;
    if (H.ghost && (!FURNITURE[H.ghost.itemId] || (H.ghost.objectId && !objectOf(state, H.ghost.objectId)))) H.ghost = null;
    if (H.ghost) return placementPanel(state, view);
    const placed = H.selected ? objectOf(state, H.selected) : null;
    return placed ? selectedPanel(state, view, placed) : catalogue(state, view);
  },
  bind(root, shellApi) {
    H.api = shellApi;
    root.addEventListener('click', (event) => {
      const target = event.target.closest('[data-buy-tab],[data-buy-item],[data-buy-stored],[data-buy-key],[data-buy-place],[data-buy-cancel],[data-buy-hide],[data-buy-move],[data-buy-store],[data-buy-sell],[data-buy-deselect]');
      if (!target || target.disabled) return;
      const data = target.dataset, state = H.api.state();
      if ('buyTab' in data) { tab = data.buyTab; H.api.refresh(); }
      else if ('buyHide' in data) { H.hidden = !H.hidden; H.api.refresh(); }
      else if ('buyItem' in data) { startGhost(state, 'buy', data.buyItem); show(); }
      else if ('buyStored' in data) { startGhost(state, 'storage', data.buyStored); show(); }
      else if ('buyKey' in data) move(data.buyKey);
      else if ('buyPlace' in data) place();
      else if ('buyCancel' in data) { H.ghost = null; show(); }
      else if ('buyMove' in data) { const placed = objectOf(state, H.selected); if (placed) { startGhost(state, 'move', placed.itemId, placed.id); show(); } }
      else if ('buyStore' in data) { const id = H.selected; H.selected = null; H.api.command('home.furniture-store', { id }).then(() => show()); }
      else if ('buySell' in data) sell();
      else if ('buyDeselect' in data) { H.selected = null; show(); }
    });
  },
  keys(action) {
    if (!H.api) return false;
    if (action === 'cancel') {
      if (!H.ghost) return false; // nothing being placed: let the shell leave Buy mode
      H.ghost = null; show();
      return true;
    }
    if (action in MOVES || action === 'rotate') move(action);
    else if (action === 'place') place();
    else if (action === 'sell') sell();
    else if (action === 'catalogue') { H.ghost = null; H.hidden = !H.hidden; show(); }
  },
};

export default [buy];
