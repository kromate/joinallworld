/**
 * OWNER: civic
 * Daily gem hunt: the sheet (a Phone app) that the HUD chip (./hunt-chip.js) opens.
 * How the hunt works is original; the chip wording and the prize follow the reference game.
 */
import { esc, money, mark } from '../dom.js';
import { count, entry, load, stale } from './civic-ui.js';
import { isDeparting } from '../../game/registry.js';
import { how, rules as ruleList, bindHow } from '../phone/how.js';
import { linkWords } from '../link.js';

const travelling = (state) => isDeparting(state); // a trip or the commute: in no venue

const sheet = {
  id: 'hunt-sheet', title: 'Gem hunt', placement: 'phone', order: 45, group: 'city',
  /** All gems found and the prize not collected yet. */
  badge: (state, view) => (view.civic?.hunt?.canClaim ? 1 : 0),
  render(state, view) {
    const hunt = view.civic?.hunt;
    if (!hunt) return '<p>The gem hunt is not available right now.</p>';
    const item = entry(`pulse:${view.cityId}`), pulse = item.data;
    const here = view.venues.find((venue) => venue.id === state.location)?.label ?? 'here';
    const searchWhy = !view.connected ? linkWords(view).cannot('search') : travelling(state) ? 'You are on the road. Arrive first.' : hunt.found === hunt.total ? 'You have found every gem today.' : '';
    const claimWhy = !view.connected ? linkWords(view).cannot('claim') : hunt.claimed ? 'Already claimed today. New gems at midnight, Lagos time.' : hunt.found < hunt.total ? `Find all ${hunt.total} gems first (${hunt.found} so far).` : '';
    const gems = hunt.gems.map((gem) => `<li class="ui-row${gem.found ? ' is-found' : ''}"><span class="ui-row-icon" aria-hidden="true">${mark(gem.found ? 'good' : 'hunt')}</span><span class="ui-row-body"><b>${esc(gem.label)}</b><small>${esc(gem.clue)}</small></span>${gem.found ? '<span class="ui-row-end"><span class="ui-chip is-good">Found</span></span>' : ''}</li>`).join('');
    const stats = pulse ? `<ul class="ui-stats"><li><b>${count(pulse.hunt.found)}</b>gems found in ${esc(view.city.name)}</li><li><b>${count(pulse.hunt.today)}</b>counted today</li><li><b>${count(pulse.hunt.claims)}</b>prizes claimed</li></ul>`
      : `<p class="civic-note">${view.connected ? 'Loading the city counter…' : `${esc(linkWords(view).why)} The city counter is not available.`}</p>`;
    const dots = hunt.gems.map((gem) => `<i class="${gem.found ? 'is-found' : ''}"></i>`).join('');
    return `<section class="ui-hero hunt-hero"><small>Daily gem hunt</small><strong>${esc(hunt.found)} of ${esc(hunt.total)} found</strong><div class="hunt-dots" aria-hidden="true">${dots}</div><p>${hunt.claimed ? 'Prize claimed. New gems at midnight, Lagos time.' : `Find them all to win ${money(hunt.prize)}.`}</p></section>${stats}${stale(item)}
      <ul class="ui-rows hunt-gems">${gems}</ul>
      <div class="civic-actions is-stack"><span class="civic-action"><button class="ui-button is-primary is-block" data-hunt-search ${searchWhy ? 'disabled' : ''}>Search ${esc(here)}</button>${searchWhy ? `<small class="civic-why">${esc(searchWhy)}</small>` : ''}</span>
      <span class="civic-action"><button class="ui-button is-block${hunt.canClaim ? ' hunt-claim' : ''}" data-hunt-claim ${claimWhy ? 'disabled' : ''}>Claim ${money(hunt.prize)}</button>${claimWhy ? `<small class="civic-why">${esc(claimWhy)}</small>` : ''}</span></div>
      <p class="civic-note">Resets at midnight, Lagos time — an unclaimed prize does not carry over.</p>
      ${how('hunt-rules', ruleList(['Travel to a place in the clues, stand at a spot and search.', 'Some gems only come loose when you finish an activity there.', 'Find them all, then claim the prize here. Gems and the prize reset at midnight, Lagos time; an unclaimed prize does not carry over.', `Beta: the chip wording and the ${money(hunt.prize)} prize follow the reference game; how gems are hidden and found is an original beta mechanic. The prize is in-game naira.`]), 'How the hunt works', true)}`;
  },
  bind(root, api) {
    const view = api.view();
    bindHow(root, api);
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

export default [sheet];
