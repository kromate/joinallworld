/**
 * OWNER: home
 * Groceries app: order ingredient packs with the 'home.grocery-buy' action. Orders are
 * delivered to the kitchen at once and work from anywhere. Prices and pack sizes are original
 * beta values (content/food.js). Each row shows what the kitchen already holds and which
 * recipes use the ingredient; a disabled button says what is missing.
 */
import './groceries.css';
import { esc, money, json } from '../dom.js';
import { INGREDIENTS, INGREDIENT_ORDER, RECIPES } from '../../game/content/food.js';

const USED_BY = Object.fromEntries(INGREDIENT_ORDER.map((id) => [id, Object.values(RECIPES).filter((recipe) => id in recipe.ingredients).map((recipe) => recipe.label)]));

export default {
  id: 'groceries', title: 'Groceries', icon: '🛒', placement: 'phone', order: 42,
  render(state, view) {
    const offline = view.connected ? '' : 'Offline — reconnect to order';
    const rows = INGREDIENT_ORDER.map((id) => {
      const item = INGREDIENTS[id], have = state.inventory?.[id] ?? 0;
      const button = (packs) => {
        const price = item.price * packs;
        const why = offline || (price > state.cash ? `Need ${money(price - state.cash)} more` : '');
        return `<button class="groceries-buy" data-action="home.grocery-buy" data-payload="${json({ id, packs })}" ${why ? `disabled title="${esc(why)}"` : ''} aria-label="Buy ${packs * item.pack} ${esc(item.label)} for ${esc(money(price))}${why ? `, ${esc(why)}` : ''}">+${packs * item.pack}<small>${money(price)}</small></button>`;
      };
      const short = offline || (item.price > state.cash ? `Need ${money(item.price - state.cash)} more` : '');
      return `<li class="groceries-row"><span class="groceries-icon" aria-hidden="true">${esc(item.icon)}</span><div><strong>${esc(item.label)}</strong><small>In kitchen: ${have}${USED_BY[id].length ? ` · for ${esc(USED_BY[id].join(', '))}` : ''}</small>${short ? `<small class="groceries-why">${esc(short)}</small>` : ''}</div>${button(1)}${button(3)}</li>`;
    }).join('');
    return `<p class="groceries-intro">Delivered to your kitchen straight away. Balance <strong>${money(state.cash)}</strong>. Meals use ingredients only when they are finished — a cancelled cook costs nothing.</p><ul class="groceries-list">${rows}</ul><p class="preview-note">Grocery prices and pack sizes are original beta values.</p>`;
  },
};
