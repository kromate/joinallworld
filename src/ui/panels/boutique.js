/**
 * OWNER: character
 * Boutique (Phone app): buy hairstyles, outfits and fabrics with cash and wear them.
 * Rules and prices: src/game/systems/onboarding.js ('onboarding.boutique-buy', 'onboarding.set-look') and
 * content/traits.js (BOUTIQUE_PRICES — original beta prices). Draws view.onboarding.boutique.
 */
import './boutique.css';
import { esc, money, json } from '../dom.js';
import { avatarSvg } from './look-ui.js';

const SECTIONS = [['hair', 'Hairstyles'], ['outfit', 'Outfits'], ['fabric', 'Fabrics']];

export default {
  id: 'boutique', title: 'Boutique', icon: '👗', placement: 'phone', order: 32,
  render(state, view) {
    const o = view.onboarding, offline = view.connected ? '' : 'Offline — reconnect to shop';
    const card = (item) => {
      const try_ = avatarSvg({ ...o.look, [item.kind]: item.id }, { size: 56, label: `${item.label} preview` });
      let control;
      if (item.wearing) control = '<em class="boutique-state">✓ Wearing</em>';
      else if (item.owned) {
        const why = offline || (o.done ? '' : 'Finish creating your Sim first.');
        control = `<button class="ui-button" data-action="onboarding.set-look" data-payload="${json({ look: { ...o.look, [item.kind]: item.id } })}" ${why ? 'disabled' : ''}>Wear</button>${why ? `<small class="boutique-why">${esc(why)}</small>` : ''}`;
      } else {
        const why = offline || item.blocked || '';
        control = `<button class="ui-button ${why ? '' : 'is-primary'}" data-action="onboarding.boutique-buy" data-payload="${json({ kind: item.kind, id: item.id })}" ${why ? 'disabled' : ''}>Buy · ${money(item.price)}</button>${why ? `<small class="boutique-why">${esc(why)}</small>` : ''}`;
      }
      return `<article class="boutique-item ${item.wearing ? 'is-wearing' : ''}">${try_}<strong>${esc(item.label)}</strong>${item.owned && !item.wearing ? '<small>Owned</small>' : ''}${control}</article>`;
    };
    const sections = SECTIONS.map(([kind, title]) => `<h3>${title}</h3><div class="boutique-grid">${o.boutique.filter((item) => item.kind === kind).map(card).join('')}</div>`).join('');
    return `<div class="boutique-root"><div class="boutique-top"><div class="look-stage">${avatarSvg(o.look, { size: 84 })}</div><p>Wallet <strong>${money(state.cash)}</strong><small>Buying something puts it on straight away and keeps it in your wardrobe. Styles shown fit your current body; colours are free in Sim → Profile.</small></p></div>${sections}<p class="preview-note">Boutique prices are original beta values.</p></div>`;
  },
};
