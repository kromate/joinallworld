/**
 * OWNER: social
 * Contacts: Mummy (who can always be called), saved contacts — the NPCs you have met and your
 * friends — and Find a player.
 * The panel contract is at the top of src/ui/shell.js. All names are escaped.
 */
import { esc, json, empty } from '../dom.js';
import { PRESENCE, presenceText } from '../../game/social-model.js';
import { S, bindCommon, gate, call } from './social-client.js';

const ui = { find: '', results: null, finding: false };
const venueName = (view, id) => view.venues.find((venue) => venue.id === id)?.label ?? id;

/** A call button with its reason when it cannot be pressed. Shared with the Family app. */
export function callButton(state, view, member) {
  const why = !view.connected ? 'You are offline. Reconnect to call.' : view.social.calling === member.id ? 'On the phone…' : state.activeAction ? 'Finish or cancel your current action first.' : null;
  return `<button class="social-btn is-primary" data-action="social.call" data-payload="${json({ id: member.id })}" data-then="close" ${why ? 'disabled' : ''} aria-label="Call ${esc(member.name)}">📞 Call</button>${why ? `<span class="social-why">${esc(why)}</span>` : ''}`;
}

export default {
  id: 'contacts', title: 'Contacts', icon: '📇', placement: 'phone', order: 20,
  render(state, view) {
    const social = view.social;
    const mummy = social.family.find((member) => member.contact);
    const met = social.relationships.filter((rel) => rel.npc);
    const blocked = gate(view);
    const friends = blocked ? blocked : S.me.friends.length ? S.me.friends.map((friend) => `<div class="social-row"><span class="social-avatar" aria-hidden="true">🧑🏾<i class="social-dot is-${PRESENCE[friend.status]?.dot ?? 'off'}" title="${esc(PRESENCE[friend.status]?.hint ?? '')}"></i></span><div><strong>${esc(friend.name)}</strong><small class="social-presence is-${esc(PRESENCE[friend.status] ? friend.status : 'offline')}">Friend · ${esc(presenceText(friend, (id) => venueName(view, id), view.now))}</small></div><span class="social-actions"><button class="social-btn is-primary" data-open="messages" data-params="${json({ to: friend.id, name: friend.name })}">Chat</button></span></div>`).join('') : '';
    const results = ui.finding ? '<p class="social-note">Searching…</p>' : ui.results === null ? '' : ui.results.error ? `<p class="social-note is-warn">${esc(ui.results.error)}</p>`
      : ui.results.length ? ui.results.map((player) => `<div class="social-row"><span class="social-avatar" aria-hidden="true">🧑🏾</span><div><strong>${esc(player.name)}</strong><small>Real player${player.friend ? ' · Friend' : ''} · #${esc(player.id.slice(0, 6))}</small></div><span class="social-actions"><button class="social-btn" data-open="person" data-params="${json({ player: player.id, name: player.name })}">View</button></span></div>`).join('')
        : '<p class="social-note">Nobody found with that name.</p>';
    return `<div class="social-row"><span class="social-avatar" aria-hidden="true">${esc(mummy.emoji)}</span><div><strong>${esc(mummy.name)}</strong><small>${esc(mummy.line)}${mummy.calledToday ? ' · checked in today' : ''}</small></div><span class="social-actions">${callButton(state, view, mummy)}</span></div>
      <h3>Find a player</h3><form class="social-form" data-k-find><input name="q" maxlength="36" placeholder="Player name" aria-label="Find a player by name" value="${esc(ui.find)}" autocomplete="off" ${view.connected ? '' : 'disabled'}><button class="social-btn" ${view.connected ? '' : 'disabled'}>Find</button></form>${view.connected ? '' : '<span class="social-why">You are offline. Reconnect to search.</span>'}${results}
      <h3>Saved contacts</h3>${friends}${met.map((rel) => `<div class="social-row"><span class="social-avatar" aria-hidden="true">${esc(rel.emoji)}</span><div><strong>${esc(rel.name)}</strong><small>${esc(rel.role)} · NPC · ${esc(rel.tierLabel)}</small></div><span class="social-actions"><button class="social-btn" data-open="person" data-params="${json({ npc: rel.id })}">View</button></span></div>`).join('')}
      ${!met.length && !(S.me?.friends.length) ? empty('📇', 'No saved contacts yet', 'Meet people around town to save their numbers.', '<button class="ui-button" data-open="map">Open the map</button>') : ''}<p class="preview-note">Names are not unique: check the short code after # when two players share a name.</p>`;
  },
  bind(root, api) {
    bindCommon(root, api);
    const form = root.querySelector('[data-k-find]');
    form?.querySelector('input').addEventListener('input', (event) => { ui.find = event.currentTarget.value; });
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      ui.find = ui.find.trim();
      if (ui.find.length < 2) { ui.results = { error: 'Type at least two letters of their name.' }; api.refresh(); return; }
      ui.finding = true; api.refresh();
      const result = await call(`/api/social/search?q=${encodeURIComponent(ui.find)}`);
      ui.finding = false; ui.results = result.ok ? result.results : { error: result.reason };
      api.refresh();
    });
  },
};
