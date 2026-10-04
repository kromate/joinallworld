/**
 * OWNER: home
 * Houses app: the five house tiers, their weekly rent and move-in cost, and moving.
 * Moving pays the landlord and the agent (three weeks of rent) with the 'property.house-move'
 * action; furniture moves with the player and anything that does not fit goes to storage.
 * Every disabled Move button says what is missing (view.property.houses[].blocked).
 */
import './houses.css';
import { esc, money, json } from '../dom.js';
import { MOVE_IN_WEEKS } from '../../game/content/housing.js';

export default {
  id: 'houses', title: 'Houses', icon: '🏘️', placement: 'phone', order: 40,
  render(state, view) {
    const property = view.property;
    if (!property) return '<p class="ui-error">Houses could not be loaded. Close this app and open it again.</p>';
    const next = property.houses.find((house) => house.id === property.nextHouse);
    const offline = view.connected ? '' : 'Offline — reconnect to move';
    const cards = property.houses.map((house) => {
      const reason = house.current ? '' : offline || house.blocked || '';
      return `<article class="ui-card houses-card ${house.current ? 'is-current' : ''}"><header><h3>${esc(house.label)} <span>· ${esc(house.district)}</span></h3>${house.tag ? `<em>${esc(house.tag)}</em>` : ''}</header><p>${esc(house.description)}</p><dl><div><dt>Room</dt><dd>${house.grid} × ${house.grid} tiles</dd></div><div><dt>Rent</dt><dd>${money(house.rent)} / week</dd></div><div><dt>Move in</dt><dd class="${house.affordable ? 'is-afford' : ''}">${money(house.moveIn)}</dd></div></dl>${house.current
        ? '<p class="houses-here">🏠 You live here</p>'
        : `<button class="ui-button is-primary" data-action="property.house-move" data-payload="${json({ id: house.id })}" ${reason ? 'disabled' : ''}>Move in · ${money(house.moveIn)}</button>${reason ? `<p class="houses-why">${esc(reason)}</p>` : ''}`}</article>`;
    }).join('');
    return `<p class="houses-intro">Pay the landlord and the agent — ${MOVE_IN_WEEKS} weeks of rent up front — and your furniture moves with you. Anything that does not fit the new room waits in Buy → Storage.</p>${next ? `<p class="houses-next">Next step up: <strong>${esc(next.label)}, ${esc(next.district)}</strong> — ${next.affordable ? 'you can afford the move.' : `${money(next.moveIn - state.cash)} to go.`}</p>` : '<p class="houses-next">You live in the grandest house in the city.</p>'}${cards}<p class="preview-note">Rents and move-in costs follow the reference game; the Yaba room size and move-in cost are beta estimates.</p>`;
  },
};
