/**
 * OWNER: character
 * Boutique (Phone app): buy hairstyles, outfits and fabrics with cash and wear them.
 * Rules and prices: src/game/systems/onboarding.js ('onboarding.boutique-buy', 'onboarding.set-look') and
 * content/traits.js (BOUTIQUE_PRICES — original beta prices). Draws view.onboarding.boutique.
 *
 * The 3D preview at the top shows your Sim. "Try on" puts an item on the preview only — nothing
 * is bought or changed until Buy or Wear is pressed.
 */
import './boutique.css';
import { esc, money, json } from '../dom.js';
import { lookStage, lookSummary, mountLookPreview } from './look-ui.js';

const SECTIONS = [['hair', 'Hairstyles'], ['outfit', 'Outfits'], ['fabric', 'Fabrics']];
let trying = null; // { kind, id } being tried on, or null

/** The look on the preview: what is worn, plus the item being tried on while it is still on offer for this body. */
function shownLook(o) {
  const item = trying && o.boutique.find((entry) => entry.kind === trying.kind && entry.id === trying.id && !entry.wearing);
  return item ? { look: { ...o.look, [item.kind]: item.id }, item } : { look: o.look, item: null };
}

export default {
  id: 'boutique', title: 'Boutique', icon: '👗', placement: 'phone', order: 32,
  render(state, view) {
    const o = view.onboarding, offline = view.connected ? '' : 'Offline — reconnect to shop';
    const { look, item: tried } = shownLook(o);
    const card = (item) => {
      const on = tried === item;
      const tryOn = item.wearing ? '' : `<button type="button" class="ui-button boutique-try" data-try="${json({ kind: item.kind, id: item.id })}" data-key="try:${esc(item.kind)}:${esc(item.id)}" aria-pressed="${on}">${on ? '✓ Trying on' : 'Try on'}</button>`;
      let control;
      if (item.wearing) control = '<em class="boutique-state">✓ Wearing</em>';
      else if (item.owned) {
        const why = offline || (o.done ? '' : 'Finish creating your Sim first.');
        control = `<button class="ui-button ${why ? '' : 'is-primary'}" data-action="onboarding.set-look" data-payload="${json({ look: { ...o.look, [item.kind]: item.id } })}" ${why ? 'disabled' : ''}>Wear</button>${why ? `<small class="boutique-why">${esc(why)}</small>` : ''}`;
      } else {
        const why = offline || item.blocked || '';
        control = `<button class="ui-button ${why ? '' : 'is-primary'}" data-action="onboarding.boutique-buy" data-payload="${json({ kind: item.kind, id: item.id })}" ${why ? 'disabled' : ''}>Buy · ${money(item.price)}</button>${why ? `<small class="boutique-why">${esc(why)}</small>` : ''}`;
      }
      return `<article class="boutique-item ${item.wearing ? 'is-wearing' : ''} ${on ? 'is-trying' : ''}"><strong>${esc(item.label)}</strong><small>${item.wearing ? 'On your Sim now' : item.owned ? 'In your wardrobe' : money(item.price)}</small>${tryOn}${control}</article>`;
    };
    const sections = SECTIONS.map(([kind, title]) => `<h3>${title}</h3><div class="boutique-grid">${o.boutique.filter((item) => item.kind === kind).map(card).join('')}</div>`).join('');
    const tools = tried ? '<button type="button" class="look-tool" data-try="null" data-key="try:none">↶ Back to my look</button>' : '';
    const caption = tried ? `Trying on: ${esc(tried.label)}${tried.owned ? '' : ` · ${money(tried.price)}`}` : esc(lookSummary(o.look));
    return `<div class="boutique-root"><div class="boutique-top">${lookStage(look, { variant: 'wide', name: view.name, tools, caption })}<p>Wallet <strong>${money(state.cash)}</strong><small>Try anything on first. Buying puts it on straight away and keeps it in your wardrobe. Styles shown fit your current body; colours are free in Sim → Profile.</small></p></div>${sections}<p class="preview-note">Boutique prices are original beta values.</p></div>`;
  },
  bind(root, api) {
    const o = api.view().onboarding;
    mountLookPreview(root, shownLook(o).look, { name: api.view().name });
    root.addEventListener('click', (event) => {
      const target = event.target.closest('[data-try]');
      if (!target) return;
      let next = null;
      try { next = JSON.parse(target.dataset.try); } catch { next = null; }
      trying = next && trying && trying.kind === next.kind && trying.id === next.id ? null : next;
      api.refresh();
      document.querySelector(`.boutique-root [data-key="${CSS.escape(next ? target.dataset.key : 'try:none')}"]`)?.focus({ preventScroll: true });
    });
  },
};
