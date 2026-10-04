/**
 * OWNER: social
 * Contacts: Mummy (who can always be called), saved contacts — the NPCs you have met and your
 * friends — and Find a player.
 * The panel contract is at the top of src/ui/shell.js. All names are escaped.
 */
import { esc, json, empty, avatar } from '../dom.ts';
import { linkWords } from '../link.ts';
import { PRESENCE, presenceText } from '../../game/social-model.ts';
import { S, bindCommon, gate, call } from './social-client.js';

const ui = { find: '', results: null, finding: false };
const venueName = (view, id) => view.venues.find((venue) => venue.id === id)?.label ?? id;

/** A call button with its reason when it cannot be pressed. Shared with the Family app. */
export function callButton(state, view, member) {
  const why = !view.connected ? linkWords(view).cannot('call') : view.social.calling === member.id ? 'On the phone…' : state.activeAction ? 'Finish or cancel your current action first.' : null;
  return `<button class="social-btn is-primary" data-action="social.call" data-payload="${json({ id: member.id })}" data-then="close" ${why ? `disabled title="${esc(why)}"` : ''} aria-label="Call ${esc(member.name)}${why ? `. ${esc(why)}` : ''}">Call</button>`;
}

export default {
  id: 'contacts', title: 'Contacts', placement: 'phone', order: 20,
  render(state, view) {
    const social = view.social;
    const mummy = social.family.find((member) => member.contact);
    const met = social.relationships.filter((rel) => rel.npc);
    const blocked = gate(view);
    const friends = blocked ? '' : S.me.friends.length ? S.me.friends.map((friend) => `<div class="social-row">${avatar(friend.name, friend.id, `<i class="social-dot is-${PRESENCE[friend.status]?.dot ?? 'off'}" title="${esc(PRESENCE[friend.status]?.hint ?? '')}"></i>`)}<div><strong>${esc(friend.name)}</strong><small class="social-presence is-${esc(PRESENCE[friend.status] ? friend.status : 'offline')}">Friend · ${esc(presenceText(friend, (id) => venueName(view, id), view.now))}</small></div><span class="social-actions"><button class="social-btn is-primary" data-open="messages" data-params="${json({ to: friend.id, name: friend.name })}">Chat</button></span></div>`).join('') : '';
    const results = ui.finding ? '<p class="social-note">Searching…</p>' : ui.results === null ? '' : ui.results.error ? `<p class="social-note is-warn">${esc(ui.results.error)}</p>`
      : ui.results.length ? ui.results.map((player) => `<div class="social-row">${avatar(player.name, player.id)}<div><strong>${esc(player.name)}</strong><small>Real player${player.friend ? ' · Friend' : ''} · #${esc(player.id.slice(0, 6))}</small></div><span class="social-actions"><button class="social-btn" data-open="person" data-params="${json({ player: player.id, name: player.name })}">View</button></span></div>`).join('')
        : '<p class="social-note">Nobody found with that name.</p>';
    const callWhy = !view.connected ? linkWords(view).cannot('call') : state.activeAction ? 'Finish or cancel your current action to call.' : '';
    const saved = `${friends}${met.map((rel) => `<div class="social-row"><span class="social-avatar" aria-hidden="true">${avatar(rel.name, rel.id)}</span><div><strong>${esc(rel.name)}</strong><small>${esc(rel.role)} · NPC · ${esc(rel.tierLabel)}</small></div><span class="social-actions"><button class="social-btn" data-open="person" data-params="${json({ npc: rel.id })}">View</button></span></div>`).join('')}`;
    return `<div class="social-list contacts-fav"><div class="social-row"><span class="social-avatar is-big" aria-hidden="true">${avatar(mummy.name, mummy.id)}</span><div><strong>${esc(mummy.name)}</strong><small>${esc(mummy.line)}${mummy.calledToday ? ' · checked in today' : ''}</small></div><span class="social-actions">${callButton(state, view, mummy)}</span></div></div>${callWhy ? `<p class="ui-why">${esc(callWhy)}</p>` : ''}
      <h3 class="ui-section">Find a player</h3><form class="social-form is-search" data-k-find><input name="q" maxlength="36" placeholder="Player name" aria-label="Find a player by name" value="${esc(ui.find)}" autocomplete="off" ${view.connected ? '' : 'disabled'}><button class="social-btn" ${view.connected ? '' : 'disabled'}>Find</button></form>${view.connected ? '' : `<span class="social-why">${esc(linkWords(view).cannot('search'))}</span>`}${results ? `<div class="social-list">${results}</div>` : ''}
      <h3 class="ui-section">Saved contacts</h3>${blocked || ''}${saved ? `<div class="social-list">${saved}</div>` : ''}
      ${!met.length && !(S.me?.friends.length) ? empty('contacts', 'No saved contacts yet', 'Meet people around town to save their numbers.', '<button class="ui-button" data-open="map">Open the map</button>') : ''}<p class="preview-note">Names are not unique: check the short code after # when two players share a name.</p>`;
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
