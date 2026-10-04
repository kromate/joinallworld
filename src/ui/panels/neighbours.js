/**
 * OWNER: civic
 * Neighbours: the directory of player homes, grouped by district, with truthful presence.
 * Counts and the online flag come from the server (GET /api/civic/neighbours). "Say hi" opens
 * that player's card (the social 'person' panel): chat, add friend, knock at their house.
 */
import { esc, json } from '../dom.js';
import { button, busy, count, entry, load, send, stale, status } from './civic-ui.js';

const key = (view) => `hood:${view.cityId}`;
const path = (view) => `/api/civic/neighbours?city=${view.cityId}`;

export default {
  id: 'neighbours', title: 'Neighbours', icon: '🏡', placement: 'phone', order: 42,
  render(state, view) {
    const item = entry(key(view)), data = item.data;
    if (!data) return status(item, view);
    const groups = data.districts.filter((group) => group.count > 0).map((group) => {
      const homes = group.homes.map((home) => `<li class="${home.you ? 'is-you' : ''}"><span><span class="civic-dot ${home.online ? 'is-on' : ''}" aria-hidden="true"></span>🏠 ${esc(home.name)}${home.you ? ' (you)' : ''}<small>${home.online ? 'Online now' : 'Not online'}</small></span>${home.you ? '' : `<button class="ui-button" data-hood-hi="${json({ id: home.id, name: home.name })}">Say hi</button>`}</li>`).join('');
      const hidden = group.count - group.homes.length;
      return `<h3>${esc(group.label)} · ${count(group.count)} home${group.count === 1 ? '' : 's'}${group.count ? ` · ${count(group.online)} online` : ''}</h3>${homes ? `<ul class="civic-list">${homes}</ul>` : ''}${hidden > 0 ? `<p class="civic-note">${count(hidden)} more not listed (hidden or beyond the list limit).</p>` : ''}`;
    }).join('');
    const unset = data.districts.some((group) => group.id === 'unknown');
    return `<p class="civic-headline">${data.total === 1 ? '1 player has a house here' : `${count(data.total)} ${esc(data.demonym)} have houses`}, ${count(data.online)} online now.</p>${stale(item)}${groups || '<p class="civic-note">Nobody has checked in yet.</p>'}
      ${button(data.hidden ? 'List my home in the directory' : 'Hide my home from the directory', 'data-hood-toggle', { working: busy('prefs'), reason: view.connected ? '' : 'Offline: reconnect to change this.' })} ${button('Refresh', 'data-civic-retry', { working: item.loading })}
      <p class="civic-beta">Beta: these are real counts of players who have opened the game since this feature shipped. “Online now” means a live connection at the moment this list was loaded.${unset ? ' Districts fill in once players choose a house.' : ''} Homes are drawn on the city map behind the Neighbours layer.</p>`;
  },
  bind(root, api) {
    const view = api.view();
    load(api, key(view), path(view), { maxAge: 30000 });
    root.querySelector('[data-civic-retry]')?.addEventListener('click', () => load(api, key(api.view()), path(api.view()), { force: true }));
    root.querySelector('[data-hood-toggle]')?.addEventListener('click', async () => {
      const hidden = entry(key(api.view())).data?.hidden;
      const result = await send(api, 'prefs', '/api/civic/prefs', { directory: Boolean(hidden) }, { success: hidden ? 'Your home is listed again.' : 'Your home is hidden from the directory.' });
      if (result.ok) load(api, key(api.view()), path(api.view()), { force: true });
    });
    for (const node of root.querySelectorAll('[data-hood-hi]')) {
      node.addEventListener('click', () => {
        let player = null;
        try { player = JSON.parse(node.dataset.hoodHi); } catch {}
        if (!player || !api.open('person', { player: player.id, name: player.name })) api.toast('That player’s card could not be opened. Try again from Sim → People.', 'error');
      });
    }
  },
};
