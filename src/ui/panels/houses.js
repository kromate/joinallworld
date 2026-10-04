/**
 * OWNER: home
 * Houses app: the five house tiers, their weekly rent and move-in cost, and moving.
 * Moving pays the landlord and the agent (three weeks of rent) with the 'property.house-move'
 * action; furniture moves with the player and anything that does not fit goes to storage.
 * Every disabled Move button says what is missing (view.property.houses[].blocked).
 */
import { renderMyHouse, bindMyHouse } from './world-panels.js';
import './houses.css';
import { how, rules as ruleList, bindHow } from '../phone/how.js';
import { esc, money, json } from '../dom.js';
import { linkWords } from '../link.js';
import { MOVE_IN_WEEKS } from '../../game/content/housing.ts';

/**
 * A drawn picture of a house tier: the higher the tier, the wider and taller the building and the
 * later the sky. Original, procedural SVG — no photos. `tier` is 0-based.
 */
const SKIES = [['#f7c98b', '#e98f6a'], ['#9fd8f0', '#5aa9dd'], ['#8fd3c8', '#3f9f9a'], ['#b7a4f0', '#6a5acd'], ['#27336b', '#0f1a3d']];
function houseArt(tier, grid) {
  const [top, bottom] = SKIES[Math.min(tier, SKIES.length - 1)];
  const floors = 1 + Math.min(3, tier), width = 62 + tier * 18, x = 160 - width / 2, floor = 20;
  const height = floors * floor, y = 92 - height;
  const cols = 2 + Math.min(4, tier);
  let windows = '';
  for (let row = 0; row < floors; row++) for (let col = 0; col < cols; col++) {
    const wx = x + 8 + col * ((width - 16) / cols) + ((width - 16) / cols - 9) / 2, wy = y + 5 + row * floor;
    if (row === floors - 1 && col === Math.floor(cols / 2)) windows += `<rect x="${wx.toFixed(1)}" y="${(wy + 1).toFixed(1)}" width="9" height="14" rx="1.5" fill="#5b3a26"/>`;
    else windows += `<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="9" height="9" rx="1.5" fill="${tier >= 4 ? '#ffe9a6' : '#fff'}" fill-opacity=".9"/>`;
  }
  const roof = tier < 2 ? `<path d="M${x - 6} ${y}L160 ${y - 18}L${x + width + 6} ${y}Z" fill="#b5533a"/>` : `<rect x="${x - 4}" y="${y - 5}" width="${width + 8}" height="6" rx="2" fill="#e9eef2"/>`;
  const palm = (px) => `<path d="M${px} 92V66" stroke="#6b4a2b" stroke-width="3" stroke-linecap="round"/><path d="M${px} 66c-10-8-18-4-20 2 8-4 14-2 20-2Zm0 0c10-8 18-4 20 2-8-4-14-2-20-2Zm0 0c-2-12 6-16 12-14-6 4-9 8-12 14Zm0 0c2-12-6-16-12-14 6 4 9 8 12 14Z" fill="#2f8f55"/>`;
  return `<svg class="houses-art" viewBox="0 0 320 104" preserveAspectRatio="xMidYMid slice" role="img" aria-label="A drawing of a ${grid} by ${grid} home"><defs><linearGradient id="houses-sky-${tier}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="320" height="104" fill="url(#houses-sky-${tier})"/><circle cx="262" cy="26" r="13" fill="${tier >= 4 ? '#f4f1d0' : '#fff3c4'}" fill-opacity=".9"/><rect y="92" width="320" height="12" fill="#00000026"/>${tier >= 2 ? palm(52) : ''}${tier >= 3 ? palm(278) : ''}<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="3" fill="${['#e8d2b0', '#f1ede4', '#f6f3ee', '#ffffff', '#f3ecd9'][Math.min(tier, 4)]}"/>${roof}${windows}</svg>`;
}

export default {
  id: 'houses', title: 'Houses', placement: 'phone', order: 30,
  render(state, view) {
    const property = view.property;
    if (!property) return '<p class="ui-error">Houses could not be loaded. Close this app and open it again.</p>';
    const next = property.houses.find((house) => house.id === property.nextHouse);
    const offline = view.connected ? '' : `${linkWords(view).short} — moving needs the server`;
    const cards = property.houses.map((house, tier) => {
      const reason = house.current ? '' : offline || house.blocked || '';
      return `<article class="houses-card ${house.current ? 'is-current' : ''}">${houseArt(tier, house.grid)}<div class="houses-body"><header><h3>${esc(house.label)}<small>${esc(house.district)}</small></h3>${house.current ? '<span class="ui-chip is-good">You live here</span>' : house.tag ? `<span class="ui-chip">${esc(house.tag)}</span>` : ''}</header><p>${esc(house.description)}</p><dl><div><dt>Room</dt><dd>${house.grid} × ${house.grid}</dd></div><div><dt>Rent / week</dt><dd>${money(house.rent)}</dd></div><div><dt>Move in</dt><dd class="${house.current ? '' : house.affordable ? 'is-afford' : 'is-short'}">${money(house.moveIn)}</dd></div></dl>${house.current ? ''
        : `<button class="ui-button is-primary is-block" data-action="property.house-move" data-payload="${json({ id: house.id })}" ${reason ? 'disabled' : ''}>Move in · ${money(house.moveIn)}</button>${reason ? `<p class="ui-why">${esc(reason)}</p>` : ''}`}</div></article>`;
    }).join('');
    const progress = next ? Math.max(0, Math.min(100, Math.round((state.cash / next.moveIn) * 100))) : 100;
    return `${renderMyHouse(state, view)}<h3 class="ui-section">Homes to rent</h3><section class="ui-hero houses-hero"><small>${next ? 'Next step up' : 'Top of the ladder'}</small><strong>${next ? `${esc(next.label)}, ${esc(next.district)}` : 'The grandest house in the city'}</strong>${next ? `<div class="houses-progress" role="meter" aria-label="Saved towards the move" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><i style="width:${progress}%"></i></div><p>${next.affordable ? 'You can afford the move.' : `${money(next.moveIn - state.cash)} to go · you have ${money(state.cash)}`}</p>` : '<p>You live here already.</p>'}</section>
      <p class="ui-note houses-note">Moving in costs ${MOVE_IN_WEEKS} weeks of rent up front. Rent is then due every Saturday.</p>${how('houses-rules', ruleList([`The move-in cost pays the landlord and the agent: ${MOVE_IN_WEEKS} weeks of rent, up front.`, 'Your furniture moves with you. Anything that does not fit the new room waits in Buy → Storage.', 'From then on the new rent is collected every Saturday (see Bank).', 'Rents and move-in costs follow the reference game; the Yaba room size and move-in cost are beta estimates.']), 'How moving works', true)}<div class="houses-list">${cards}</div>`;
  },
  bind(root, api) { bindHow(root, api); bindMyHouse(root); },
};
