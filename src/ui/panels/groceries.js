/**
 * OWNER: home
 * Groceries app: a grid of ingredients with quantity steppers, a basket total and one Order button.
 *
 * Ordering sends the same 'home.grocery-buy' { id, packs } action as before, once per line of the
 * basket, in the pack sizes the server quotes (3 packs, then single packs). Every price shown is
 * view.home.groceries — the amount the server will charge after discounts — so the basket total is
 * exactly what leaves the wallet. Orders are delivered to the kitchen at once and work from
 * anywhere. If the server refuses a line (the kitchen is full, the money ran out) ordering stops
 * there, the refusal is shown, and what was not bought stays in the basket.
 * Prices and pack sizes are original beta values (content/food.js).
 */
import './groceries.css';
import { esc, money } from '../dom.js';
import { INGREDIENTS, INGREDIENT_ORDER, RECIPES } from '../../game/content/food.js';

const USED_BY = Object.fromEntries(INGREDIENT_ORDER.map((id) => [id, Object.values(RECIPES).filter((recipe) => id in recipe.ingredients).map((recipe) => recipe.label)]));
const MAX_PACKS = 9;
/** UI-only state: packs wanted per ingredient, and whether an order is being sent. */
const basket = {};
let ordering = false;

/** The orders a quantity becomes: as many 3-packs as fit, then single packs — the two sizes the server quotes. */
const split = (packs) => [...Array(Math.floor(packs / 3)).fill(3), ...Array(packs % 3).fill(1)];
const quoteOf = (view, id, packs) => view.home?.groceries?.[id]?.[packs] ?? { price: INGREDIENTS[id].price * packs, list: INGREDIENTS[id].price * packs };
const lineTotal = (view, id, packs) => split(packs).reduce((sum, size) => sum + quoteOf(view, id, size).price, 0);

export default {
  id: 'groceries', title: 'Groceries', icon: '🛒', placement: 'phone', order: 16,
  render(state, view) {
    const offline = view.connected ? '' : 'Not connected — ordering needs the server';
    let total = 0, units = 0;
    const cards = INGREDIENT_ORDER.map((id) => {
      const item = INGREDIENTS[id], have = state.inventory?.[id] ?? 0, packs = Math.min(MAX_PACKS, basket[id] || 0);
      const one = quoteOf(view, id, 1);
      total += lineTotal(view, id, packs); units += packs * item.pack;
      const uses = USED_BY[id].length ? `For ${USED_BY[id].join(', ')}` : 'Kitchen staple';
      return `<li class="groceries-card${packs ? ' is-picked' : ''}"><span class="groceries-icon" aria-hidden="true">${esc(item.icon)}</span><strong>${esc(item.label)}</strong><small title="${esc(uses)}">${esc(uses)}</small>
        <p><b>${one.price < one.list ? `<s>${money(one.list)}</s> ` : ''}${money(one.price)}</b> for ${esc(item.pack)} · have ${esc(have)}</p>
        <div class="groceries-step" role="group" aria-label="${esc(item.label)} quantity"><button data-groceries-step="${esc(id)}" data-by="-1" aria-label="One pack less of ${esc(item.label)}" ${packs ? '' : 'disabled'}>−</button><output aria-live="polite">${packs * item.pack}</output><button data-groceries-step="${esc(id)}" data-by="1" aria-label="One pack more of ${esc(item.label)}" ${packs >= MAX_PACKS ? 'disabled' : ''}>+</button></div></li>`;
    }).join('');
    const short = total > state.cash ? `Need ${money(total - state.cash)} more` : '';
    const why = !units ? 'Add something with +' : offline || short || (ordering ? 'Ordering…' : '');
    return `<p class="groceries-intro">Delivered to your kitchen straight away. Meals use ingredients only when they are finished — a cancelled cook costs nothing.</p>
      <ul class="groceries-grid">${cards}</ul><p class="ui-fine">Grocery prices and pack sizes are original beta values. Balance ${money(state.cash)}.</p>
      <div class="ui-sticky groceries-basket"><div><small>${units ? `Basket · ${units} item${units === 1 ? '' : 's'}` : 'Basket is empty'}</small><b>${money(total)}</b>${units && (offline || short) ? `<span class="ui-why">${esc(offline || short)}</span>` : ''}</div>${units ? '<button class="ui-button is-small" data-groceries-clear>Clear</button>' : ''}<button class="ui-button is-primary" data-groceries-order ${why ? 'disabled' : ''} title="${esc(why)}">${ordering ? 'Ordering…' : 'Order'}</button></div>`;
  },
  bind(root, api) {
    for (const button of root.querySelectorAll('[data-groceries-step]')) {
      button.addEventListener('click', () => {
        const id = button.dataset.groceriesStep, by = Number(button.dataset.by);
        basket[id] = Math.max(0, Math.min(MAX_PACKS, (basket[id] || 0) + by));
        api.refresh();
        // The grid was redrawn: keep the keyboard on the same stepper button.
        document.querySelector(`[data-groceries-step="${CSS.escape(id)}"][data-by="${by}"]:not(:disabled)`)?.focus();
      });
    }
    root.querySelector('[data-groceries-clear]')?.addEventListener('click', () => { for (const id of Object.keys(basket)) delete basket[id]; api.refresh(); });
    root.querySelector('[data-groceries-order]')?.addEventListener('click', async () => {
      if (ordering) return;
      ordering = true; api.refresh();
      let bought = 0, refused = null;
      try {
        for (const id of INGREDIENT_ORDER) {
          while ((basket[id] || 0) > 0 && !refused) {
            const packs = basket[id] >= 3 ? 3 : 1;
            const result = await api.command('home.grocery-buy', { id, packs });
            if (result.ok) { basket[id] -= packs; bought += packs * INGREDIENTS[id].pack; } else refused = result;
          }
          if (refused) break;
        }
      } finally { ordering = false; }
      // A refusal was already shown by the host with the server's reason; say what did go through.
      if (bought) api.toast(refused ? `${bought} item${bought === 1 ? '' : 's'} delivered. The rest is still in your basket.` : `${bought} item${bought === 1 ? '' : 's'} delivered to your kitchen.`, 'good');
      api.refresh();
    });
  },
};
