/**
 * OWNER: civic
 * Rich List: top balances and top earners of the week, plus the real city counters.
 * Everything shown comes from the server (GET /api/civic/richlist); nothing is estimated here.
 */
import { esc, money } from '../dom.js';
import { button, busy, count, entry, load, send, stale, status } from './civic-ui.js';

const key = (view) => `rich:${view.cityId}`;
const path = (view) => `/api/civic/richlist?city=${view.cityId}`;

function board(title, rows, empty) {
  if (!rows.length) return `<h3>${esc(title)}</h3><p class="civic-note">${esc(empty)}</p>`;
  return `<h3>${esc(title)}</h3><ol class="civic-list">${rows.map((row) => `<li class="${row.you ? 'is-you' : ''}"><span><span class="civic-rank">${esc(row.rank)}.</span> ${esc(row.name)}${row.you ? ' (you)' : ''}</span><b>${money(row.amount)}</b></li>`).join('')}</ol>`;
}

export default {
  id: 'richlist', title: 'Rich List', icon: '🏆', placement: 'phone',
  render(state, view) {
    const item = entry(key(view)), data = item.data;
    if (!data) return status(item, view);
    const you = data.you;
    const mine = you ? `<p class="civic-note">${you.listed ? `You: ${money(you.cash)}${you.balanceRank ? ` · rank ${esc(you.balanceRank)}` : ''} · earned ${money(you.earned)} this week.` : 'You are hidden from the Rich List. Your balance is not shown to anyone.'}</p>` : '';
    const toggle = you ? button(you.listed ? 'Hide me from the Rich List' : 'Show me on the Rich List', 'data-rich-toggle', { working: busy('prefs'), reason: view.connected ? '' : 'Offline: reconnect to change this.' }) : '';
    return `<ul class="civic-stats"><li><b>${count(data.counters.players)}</b>players in ${esc(view.city.name)}</li><li><b>${count(data.counters.online)}</b>online now</li><li><b>${count(data.counters.visits)}</b>daily visits</li></ul>${stale(item)}
      ${board('Top balances', data.balances, 'Nobody is listed yet.')}${board('Top earners this week', data.earners, 'Nobody has earned anything this week yet.')}
      ${mine}${toggle} ${button('Refresh', 'data-civic-retry', { working: item.loading })}
      <p class="civic-beta">Beta: balances are each player’s in-game naira at their last check-in; earners count naira received since Monday, Lagos time. Players are counted once they have opened the game since this feature shipped; “online” means a live connection right now.</p>`;
  },
  bind(root, api) {
    const view = api.view();
    load(api, key(view), path(view), { maxAge: 30000 });
    root.querySelector('[data-civic-retry]')?.addEventListener('click', () => load(api, key(api.view()), path(api.view()), { force: true }));
    root.querySelector('[data-rich-toggle]')?.addEventListener('click', async () => {
      const listed = entry(key(api.view())).data?.you?.listed;
      const result = await send(api, 'prefs', '/api/civic/prefs', { richList: !listed }, { success: listed ? 'You are now hidden from the Rich List.' : 'You are back on the Rich List.' });
      if (result.ok) load(api, key(api.view()), path(api.view()), { force: true });
    });
  },
};
