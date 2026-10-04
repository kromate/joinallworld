/**
 * OWNER: home
 * Groceries app: a grid of ingredients. Each card has a one-tap "Buy 1 pack" (the quick case) and a
 * quantity stepper that fills a basket with one Order button (the weekly shop). Both ways work.
 *
 * "Buy 1 pack" sends one 'home.grocery-buy' { id, packs: 1 } per tap. It shows the price the server
 * will charge, is disabled while not connected or while the balance does not cover it (the pure
 * decision is quickBuy() in ../phone/logic.js), and confirms with the server's own message.
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
import { how, rules as ruleList, bindHow } from '../phone/how.js';
import { quickBuy } from '../phone/logic.js';
import { esc, money, iconFor } from '../dom.js';
import { linkWords } from '../link.js';
import { INGREDIENTS, INGREDIENT_ORDER, RECIPES } from '../../game/content/food.ts';

const USED_BY = Object.fromEntries(INGREDIENT_ORDER.map((id) => [id, Object.values(RECIPES).filter((recipe) => id in recipe.ingredients).map((recipe) => recipe.label)]));
const MAX_PACKS = 9;
/** UI-only state: packs wanted per ingredient, and whether an order is being sent. */
const basket = {};
let ordering = false;
/** The ingredient whose one-tap purchase is on its way to the server, or null. */
let buying = null;

/** The orders a quantity becomes: as many 3-packs as fit, then single packs — the two sizes the server quotes. */
const split = (packs) => [...Array(Math.floor(packs / 3)).fill(3), ...Array(packs % 3).fill(1)];
const quoteOf = (view, id, packs) => view.home?.groceries?.[id]?.[packs] ?? { price: INGREDIENTS[id].price * packs, list: INGREDIENTS[id].price * packs };
const lineTotal = (view, id, packs) => split(packs).reduce((sum, size) => sum + quoteOf(view, id, size).price, 0);

export default {
  id: 'groceries', title: 'Groceries', placement: 'phone', order: 16,
  render(state, view) {
    const offline = view.connected ? '' : `${linkWords(view).short} — ordering needs the server`;
    let total = 0, units = 0;
    const cards = INGREDIENT_ORDER.map((id) => {
      const item = INGREDIENTS[id], have = state.inventory?.[id] ?? 0, packs = Math.min(MAX_PACKS, basket[id] || 0);
      const one = quoteOf(view, id, 1);
      const quick = quickBuy({ quote: one, cash: state.cash, connected: Boolean(view.connected), busy: ordering || buying !== null, label: item.label });
      const short1 = Boolean(view.connected) && one.price > state.cash;
      total += lineTotal(view, id, packs); units += packs * item.pack;
      const uses = USED_BY[id].length ? `For ${USED_BY[id].join(', ')}` : 'Kitchen staple';
      return `<li class="groceries-card${packs ? ' is-picked' : ''}"><span class="groceries-icon" aria-hidden="true">${iconFor('food', item.id, item.icon)}</span><strong>${esc(item.label)}</strong><small title="${esc(uses)}">${esc(uses)}</small>
        <p><b>${one.price < one.list ? `<s>${money(one.list)}</s> ` : ''}${money(one.price)}</b> for ${esc(item.pack)} · have ${esc(have)}</p>
        <button class="groceries-buy" data-groceries-buy="${esc(id)}" aria-label="Buy one pack of ${esc(item.label)} (${esc(item.pack)}) now for ${money(quick.price)}" ${quick.blocked ? `disabled title="${esc(quick.blocked)}"` : ''}>${buying === id ? 'Buying…' : `Buy 1 pack · ${money(quick.price)}`}</button>${short1 ? `<span class="groceries-why">${esc(quick.blocked)}</span>` : ''}
        <div class="groceries-step" role="group" aria-label="${esc(item.label)}: packs in the basket"><button data-groceries-step="${esc(id)}" data-by="-1" aria-label="One pack less of ${esc(item.label)}" ${packs ? '' : 'disabled'}>−</button><output aria-live="polite">${packs * item.pack}</output><button data-groceries-step="${esc(id)}" data-by="1" aria-label="One pack more of ${esc(item.label)}" ${packs >= MAX_PACKS ? 'disabled' : ''}>+</button></div></li>`;
    }).join('');
    const short = total > state.cash ? `Need ${money(total - state.cash)} more` : '';
    const why = !units ? 'Add something with +' : offline || short || (ordering ? 'Ordering…' : buying ? 'Buying…' : '');
    return `<p class="groceries-intro">Balance <b>${money(state.cash)}</b> · delivered to your kitchen at once.</p>${offline ? `<p class="ui-why groceries-offline">${esc(offline)}</p>` : ''}
      ${how('groceries-rules', ruleList(['Buy 1 pack: one tap buys one pack at the price on the button and delivers it at once.', 'Basket: use − and + to choose packs of several things, then Order. The total is exactly what leaves your wallet.', 'An order is sent pack by pack. If the server refuses one (the kitchen is full, the money ran out) ordering stops there and the rest stays in your basket.', 'Ordering works from anywhere. Meals use ingredients only when they are finished — a cancelled cook costs nothing.', 'Grocery prices and pack sizes are original beta values.']), 'How ordering works', true)}
      <ul class="groceries-grid">${cards}</ul>
      <div class="ui-sticky groceries-basket"><div><small>${units ? `Basket · ${units} item${units === 1 ? '' : 's'}` : 'Basket is empty'}</small><b>${money(total)}</b>${units && (offline || short) ? `<span class="ui-why">${esc(offline || short)}</span>` : ''}</div>${units ? '<button class="ui-button is-small" data-groceries-clear>Clear</button>' : ''}<button class="ui-button is-primary" data-groceries-order ${why ? 'disabled' : ''} title="${esc(why)}">${ordering ? 'Ordering…' : 'Order'}</button></div>`;
  },
  bind(root, api) {
    bindHow(root, api);
    for (const button of root.querySelectorAll('[data-groceries-buy]')) {
      button.addEventListener('click', async () => {
        const id = button.dataset.groceriesBuy;
        if (buying || ordering) return;
        buying = id; api.refresh();
        let result = null;
        try { result = await api.command('home.grocery-buy', { id, packs: 1 }); } finally { buying = null; }
        // A refusal was already shown by the host with the server's reason; a purchase confirms itself.
        if (result?.ok) api.toast(api.state().message || `${INGREDIENTS[id].pack} × ${INGREDIENTS[id].label} delivered to your kitchen.`, 'good');
        api.refresh();
        // The grid was redrawn (and this button was disabled meanwhile): keep the keyboard on it unless the player moved on.
        const active = document.activeElement;
        if (!active || active === document.body || active.tagName === 'DIALOG') document.querySelector(`[data-groceries-buy="${CSS.escape(id)}"]:not(:disabled)`)?.focus({ preventScroll: true });
      });
    }
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
      if (ordering || buying) return;
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
