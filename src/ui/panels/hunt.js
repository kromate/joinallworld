/**
 * OWNER: civic
 * Daily gem hunt: the chip in the top-left HUD stack, and the sheet it opens.
 *
 * The chip follows the label observed in the reference game ("Daily gem hunt · N found · next
 * prize ₦3,000"). N is the server's own count of gems found in this city; until it has loaded,
 * no number is shown. The chip also carries the real presence counter and is where civic
 * notices (a new Governor, an announcement) surface as toasts. How the hunt works is original.
 */
import { esc, money } from '../dom.js';
import { count, entry, load, put, stale } from './civic-ui.js';
import { isDeparting } from '../../game/registry.js';

const SEEN_KEY = 'joinallworld-civic-seen';
let lastFound = null;

function unseen(notices) {
  let seen = null;
  try { seen = JSON.parse(window.localStorage.getItem(SEEN_KEY)); } catch {}
  const known = new Set(Array.isArray(seen) ? seen : []);
  const fresh = notices.filter((item) => !known.has(item.id));
  try { window.localStorage.setItem(SEEN_KEY, JSON.stringify(notices.map((item) => item.id).slice(0, 40))); } catch {}
  // First visit on this browser: do not replay a week of old news.
  return Array.isArray(seen) ? fresh : [];
}

const travelling = (state) => isDeparting(state); // a trip or the commute: in no venue

const chip = {
  id: 'hunt', title: 'Daily hunt', icon: '💎', placement: 'hud', order: 20,
  render(state, view) {
    const hunt = view.civic?.hunt;
    if (!hunt) return '';
    const pulse = entry(`pulse:${view.cityId}`).data;
    const found = pulse ? `${count(pulse.hunt.found)} found · ` : '';
    const prize = hunt.claimed ? 'prize claimed today' : `next prize ${money(hunt.prize)}`;
    const people = pulse ? ` · ${count(pulse.counters.online)} online` : '';
    return `<button class="life-job civic-chip ${hunt.canClaim ? 'is-active' : ''}" data-open="hunt-sheet" data-balance="${esc(state.cash)}" data-tick="${Math.floor(view.now / 60000)}" data-live="${view.connected ? 1 : 0}" aria-label="Daily gem hunt, ${esc(hunt.found)} of ${esc(hunt.total)} found today"><span aria-hidden="true">💎</span><div><strong>${hunt.canClaim ? 'Claim your gem prize' : 'Daily gem hunt'}</strong><small>${esc(found)}${esc(prize)}</small><small>You: ${esc(hunt.found)}/${esc(hunt.total)} today${esc(people)}</small></div></button>`;
  },
  bind(root, api) {
    const view = api.view(), hunt = view.civic?.hunt;
    if (hunt) {
      const key = `${view.cityId}:${hunt.day}`;
      if (lastFound?.key === key && hunt.found > lastFound.found) api.toast(hunt.found === hunt.total ? `💎 Gem found — that is all ${hunt.total}. Claim your prize from the gem hunt chip.` : `💎 Gem found: ${hunt.found} of ${hunt.total} today.`, 'good');
      lastFound = { key, found: hunt.found };
    }
    // The chip is rebuilt when the hunt or the balance changes, and at most once a minute as the
    // shell redraws; each rebuild is the check-in that keeps the city counters, the directory
    // and the rich list current. No timer runs here.
    load(api, `pulse:${view.cityId}`, `/api/civic/pulse?city=${view.cityId}`, { maxAge: 60000,
      after(item) {
        if (item.data?.radio) put(`radio:${view.cityId}:${item.data.radio.venue}`, item.data.radio);
        if (item.data && !item.error) for (const notice of unseen(item.data.notices).slice(0, 2).reverse()) api.toast(`🏛️ ${notice.title}${notice.kind === 'announcement' ? `: ${notice.text}` : ''}`);
      } });
  },
};

const sheet = {
  id: 'hunt-sheet', title: 'Gem hunt', icon: '💎', placement: 'phone', order: 45, group: 'city',
  /** All gems found and the prize not collected yet. */
  badge: (state, view) => (view.civic?.hunt?.canClaim ? 1 : 0),
  render(state, view) {
    const hunt = view.civic?.hunt;
    if (!hunt) return '<p>The gem hunt is not available right now.</p>';
    const item = entry(`pulse:${view.cityId}`), pulse = item.data;
    const here = view.venues.find((venue) => venue.id === state.location)?.label ?? 'here';
    const searchWhy = !view.connected ? 'Not connected: you cannot search right now.' : travelling(state) ? 'You are on the road. Arrive first.' : hunt.found === hunt.total ? 'You have found every gem today.' : '';
    const claimWhy = !view.connected ? 'Not connected: you cannot claim right now.' : hunt.claimed ? 'Already claimed today. New gems at midnight, Lagos time.' : hunt.found < hunt.total ? `Find all ${hunt.total} gems first (${hunt.found} so far).` : '';
    const gems = hunt.gems.map((gem) => `<li class="ui-row${gem.found ? ' is-found' : ''}"><span class="ui-row-icon" aria-hidden="true">${gem.found ? '✅' : '💎'}</span><span class="ui-row-body"><b>${esc(gem.label)}</b><small>${esc(gem.clue)}</small></span>${gem.found ? '<span class="ui-row-end"><span class="ui-chip is-good">Found</span></span>' : ''}</li>`).join('');
    const stats = pulse ? `<ul class="ui-stats"><li><b>${count(pulse.hunt.found)}</b>gems found in ${esc(view.city.name)}</li><li><b>${count(pulse.hunt.today)}</b>counted today</li><li><b>${count(pulse.hunt.claims)}</b>prizes claimed</li></ul>`
      : `<p class="civic-note">${view.connected ? 'Loading the city counter…' : 'Not connected: the city counter is not available.'}</p>`;
    const dots = hunt.gems.map((gem) => `<i class="${gem.found ? 'is-found' : ''}"></i>`).join('');
    return `<section class="ui-hero hunt-hero"><small>Daily gem hunt</small><strong>${esc(hunt.found)} of ${esc(hunt.total)} found</strong><div class="hunt-dots" aria-hidden="true">${dots}</div><p>${hunt.claimed ? 'Prize claimed. New gems at midnight, Lagos time.' : `Find them all to win ${money(hunt.prize)}.`}</p></section>${stats}${stale(item)}
      <ul class="ui-rows hunt-gems">${gems}</ul>
      <div class="civic-actions is-stack"><span class="civic-action"><button class="ui-button is-primary is-block" data-hunt-search ${searchWhy ? 'disabled' : ''}>Search ${esc(here)}</button>${searchWhy ? `<small class="civic-why">${esc(searchWhy)}</small>` : ''}</span>
      <span class="civic-action"><button class="ui-button is-block${hunt.canClaim ? ' hunt-claim' : ''}" data-hunt-claim ${claimWhy ? 'disabled' : ''}>Claim ${money(hunt.prize)}</button>${claimWhy ? `<small class="civic-why">${esc(claimWhy)}</small>` : ''}</span></div>
      <p class="civic-note">Travel to a place in the clues, stand at a spot and search. Some gems only come loose when you finish an activity there. Gems and the prize reset at midnight, Lagos time; an unclaimed prize does not carry over.</p>
      <p class="civic-beta">Beta: the chip wording and the ${money(hunt.prize)} prize follow the reference game; how gems are hidden and found is an original beta mechanic. The prize is in-game naira.</p>`;
  },
  bind(root, api) {
    const view = api.view();
    load(api, `pulse:${view.cityId}`, `/api/civic/pulse?city=${view.cityId}`, { maxAge: 60000 });
    root.querySelector('[data-hunt-search]')?.addEventListener('click', async () => {
      const result = await api.command('civic.hunt-search');
      if (result.ok) api.toast(api.state().message || 'You found a gem.', 'good');
    });
    root.querySelector('[data-hunt-claim]')?.addEventListener('click', async () => {
      const result = await api.command('civic.hunt-claim');
      if (result.ok) { api.toast(api.state().message || 'Prize claimed.', 'good'); load(api, `pulse:${api.view().cityId}`, `/api/civic/pulse?city=${api.view().cityId}`, { force: true }); }
    });
  },
};

export default [chip, sheet];
