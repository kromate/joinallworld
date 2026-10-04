/**
 * OWNER: civic
 * Rich List: top balances and top earners of the week, plus the real city counters.
 * Everything shown comes from the server (GET /api/civic/richlist); nothing is estimated here.
 */
import { esc, money, empty, avatar } from '../dom.js';
import { linkWords } from '../link.js';
import { button, busy, count, entry, load, send, stale, status } from './civic-ui.js';
import { how, rules as ruleList, bindHow } from '../phone/how.js';

const key = (view) => `rich:${view.cityId}`;
const path = (view) => `/api/civic/richlist?city=${view.cityId}`;

/** The top three on a podium (second, first, third), then everyone else as a ranked list. */
function board(title, rows, none) {
  if (!rows.length) return `<h3 class="ui-section">${esc(title)}</h3>${empty('richlist', 'Nobody yet', none, '', { compact: true })}`;
  const top = rows.slice(0, 3), rest = rows.slice(3);
  const step = (row, place) => (row ? `<li class="is-${place}${row.you ? ' is-you' : ''}">${avatar(row.name, row.name)}<strong>${esc(row.name)}${row.you ? ' (you)' : ''}</strong><b>${money(row.amount)}</b><i aria-label="Rank ${esc(row.rank)}">${esc(row.rank)}</i></li>` : `<li class="is-${place} is-empty" aria-hidden="true"><i>${place}</i></li>`);
  return `<h3 class="ui-section">${esc(title)}</h3><ol class="richlist-podium">${step(top[1], 2)}${step(top[0], 1)}${step(top[2], 3)}</ol>${rest.length ? `<ol class="ui-rows" start="4">${rest.map((row) => `<li class="ui-row${row.you ? ' is-you' : ''}"><span class="richlist-rank">${esc(row.rank)}</span>${avatar(row.name, row.name)}<span class="ui-row-body"><b>${esc(row.name)}${row.you ? ' (you)' : ''}</b></span><span class="ui-row-end">${money(row.amount)}</span></li>`).join('')}</ol>` : ''}`;
}

export default {
  id: 'richlist', title: 'Rich List', placement: 'phone', order: 48,
  render(state, view) {
    const item = entry(key(view)), data = item.data;
    if (!data) return status(item, view);
    const you = data.you;
    const mine = you ? (you.listed ? `<section class="ui-hero richlist-hero"><small>You${you.balanceRank ? ` · rank ${esc(you.balanceRank)}` : ''}</small><strong>${money(you.cash)}</strong><p>Earned ${money(you.earned)} this week</p></section>` : '<section class="ui-hero richlist-hero"><small>You are hidden</small><strong>Not on the list</strong><p>Your balance is not shown to anyone.</p></section>') : '';
    const toggle = you ? button(you.listed ? 'Hide me from the Rich List' : 'Show me on the Rich List', 'data-rich-toggle', { working: busy('prefs'), reason: view.connected ? '' : linkWords(view).cannot('change this') }) : '';
    return `${mine}<ul class="ui-stats"><li><b>${count(data.counters.players)}</b>players in ${esc(view.city.name)}</li><li><b>${count(data.counters.online)}</b>online now</li><li><b>${count(data.counters.visits)}</b>daily visits</li></ul>${stale(item)}
      <div class="richlist-boards"><div>${board('Top balances', data.balances, 'Nobody is listed yet.')}</div><div>${board('Top earners this week', data.earners, 'Nobody has earned anything this week yet.')}</div></div>
      <div class="civic-actions">${toggle}${button('Refresh', 'data-civic-retry', { working: item.loading })}</div>
      ${how('richlist-rules', ruleList(['Balances are each player’s in-game naira at their last check-in.', 'Earners count naira received since Monday, Lagos time.', 'Players are counted once they have opened the game since this feature shipped; “online” means a live connection right now.', 'You can hide yourself from both lists with the button above. This is a beta feature.']), 'How the lists are counted', true)}`;
  },
  bind(root, api) {
    bindHow(root, api);
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
