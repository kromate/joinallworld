/**
 * OWNER: growth
 * Missions: the Phone app. Three daily and three weekly missions with their progress, what each
 * pays, a Go button, the weekly stamp card and the count of days lived. Rules and numbers live in
 * src/game/systems/missions.js and content/missions.js; this file only draws them.
 * The panel contract is at the top of src/ui/shell.js.
 */
import { esc, json, money, mark, section } from '../dom.js';
import { how, rules as ruleList, bindHow } from '../phone/how.js';
import { linkWords } from '../link.js';
import { G, load, share, until, track } from './growth-client.js';

const KIND_ICON = { life: 'home', discovery: 'compass', social: 'people' };

function item(mission, view, scope, rerollsLeft) {
  const why = !view.connected ? linkWords(view).cannot('collect') : '';
  const go = mission.go ? `data-m-go="${json(mission.go)}"` : mission.open ? `data-open="${esc(mission.open)}"` : '';
  const action = mission.claimed ? '<span class="ui-chip is-good">Collected</span>'
    : mission.done ? `<button class="ui-button is-primary" data-m-claim="${esc(mission.id)}" ${why ? 'disabled' : ''}>Collect ${money(mission.cash)}</button>`
      : `${go ? `<button class="ui-button" ${go}>Go</button>` : ''}${scope === 'daily' && rerollsLeft > 0 ? `<button class="gr-swap" data-m-swap="${esc(mission.id)}">Swap</button>` : ''}`;
  const pct = Math.round((mission.n / mission.count) * 100);
  return `<li class="gr-item${mission.done ? ' is-done' : ''}${mission.claimed ? ' is-claimed' : ''}"><span aria-hidden="true">${mark(mission.done ? 'good' : KIND_ICON[mission.kind] || 'star')}</span>
    <div><b>${esc(mission.label)}</b><small>${mission.done ? (mission.claimed ? 'Done' : `Done · ${money(mission.cash)} to collect`) : `${esc(mission.hint)} · ${money(mission.cash)}`}</small>
    ${mission.count > 1 || mission.done ? `<div class="gr-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${mission.count}" aria-valuenow="${mission.n}" aria-label="${esc(mission.label)}"><i style="width:${pct}%"></i></div><small>${mission.n} of ${mission.count}</small>` : ''}</div>
    <div class="gr-acts">${action}</div></li>`;
}

const setLine = (set, word) => (set.total ? `<p class="gr-set">${set.granted ? `All ${set.total} collected · +${set.stars} stars earned` : `Collect all ${set.total} ${word} for +${set.stars} stars`}</p>` : '');

const panel = {
  id: 'missions', title: 'Missions', placement: 'phone', order: 11, group: 'life',
  badge: (state, view) => view.missions?.claimable || 0,
  notifications(state, view) {
    const m = view.missions;
    if (!view.connected || !m?.claimable) return [];
    return [{ id: `missions:${m.day}:${m.claimable}`, at: view.now, fresh: true, app: 'missions', text: `${m.claimable} finished mission${m.claimable === 1 ? '' : 's'} to collect` }];
  },
  render(state, view) {
    const m = view.missions;
    if (!m) return '<p>Missions are not available right now.</p>';
    if (!m.daily.length && !m.weekly.length) return `<p class="gr-note">${view.connected ? 'Today’s missions are being dealt…' : esc(linkWords(view).why)}</p>`;
    const dots = m.daily.map((mission) => `<i class="${mission.done ? 'is-on' : ''}"></i>`).join('');
    const stamps = Array.from({ length: 7 }, (_, index) => `<i class="${index < m.stamps.days ? 'is-on' : index === m.stamps.need - 1 ? 'is-goal' : ''}">${index < m.stamps.days ? mark('good') : ''}</i>`).join('');
    const doneToday = m.dailySet.done;
    return `<section class="ui-hero gr-hero"><small>Today in ${esc(view.city.name)}</small><strong>${doneToday} of ${m.dailySet.total} missions done</strong><div class="gr-dots" aria-hidden="true">${dots}</div>
        <p>New missions in ${esc(until(m.resetAt, view.now))}. Missing a day costs you nothing.</p></section>
      <ul class="gr-list">${m.daily.map((mission) => item(mission, view, 'daily', m.rerollsLeft)).join('')}</ul>${setLine(m.dailySet, 'today')}
      ${doneToday ? `<button class="ui-button is-block" data-m-share="missions" ${G.busy ? 'disabled' : ''}>${G.busy === 'missions' ? 'Preparing…' : 'Share today’s result'}</button>` : ''}
      ${section('This week', `<small>resets in ${esc(until(m.weekResetAt, view.now))}</small>`)}
      <ul class="gr-list">${m.weekly.map((mission) => item(mission, view, 'weekly', 0)).join('')}</ul>${setLine(m.weeklySet, 'this week')}
      ${section('Your week')}
      <div class="gr-card"><h3>${m.stamps.days} of 7 days played</h3><div class="gr-stamps" aria-hidden="true">${stamps}</div>
        <p>${m.stamps.paid ? `Stamp card complete: +${m.stamps.stars} stars earned.` : `Play on any ${m.stamps.need} days this week for +${m.stamps.stars} stars. Which days is up to you.`}</p>
        <p><b>${m.activeDays}</b> day${m.activeDays === 1 ? '' : 's'} in ${esc(view.city.name)}${m.title ? ` · ${esc(m.title)}` : ''}${m.nextTitle ? ` · next title at ${m.nextTitle.days} days: ${esc(m.nextTitle.label)}` : ''}</p>
        <button class="ui-button" data-m-share="week" ${G.busy ? 'disabled' : ''}>${G.busy === 'week' ? 'Preparing…' : 'Share my week'}</button></div>
      ${how('missions-rules', ruleList(['Three missions a day and three a week: one about your life, one about the city, one about people.', `A daily mission pays ${money(m.daily[0]?.cash ?? 250)} and a weekly one ${money(m.weekly[0]?.cash ?? 1000)}, once, when you collect it. All three of a set add stars.`,
    'Unfinished missions are replaced at midnight (weekly ones on Monday), Lagos time. Nothing is taken from you for missing them.', 'You can swap one unfinished daily mission a day.', 'Your count of days only ever goes up. There is no streak to lose.']))}`;
  },
  bind(root, api) {
    bindHow(root, api);
    void load(api);
    const each = (selector, handler) => { for (const node of root.querySelectorAll(selector)) node.addEventListener('click', () => handler(node)); };
    each('[data-m-claim]', async (node) => {
      const result = await api.command('missions.claim', { id: node.dataset.mClaim });
      if (result.ok) { api.toast(api.state().message || 'Mission collected.', 'earn'); track('mission_completed', { kind: api.view().missions?.daily.concat(api.view().missions.weekly).find((item) => item.id === node.dataset.mClaim)?.kind ?? 'unknown' }); }
    });
    each('[data-m-swap]', async (node) => { const result = await api.command('missions.reroll', { id: node.dataset.mSwap }); if (result.ok) api.toast(api.state().message || 'Swapped.', 'info'); });
    each('[data-m-go]', (node) => { const [venue, spot] = JSON.parse(node.dataset.mGo); api.close(); api.goTo(venue, spot); });
    each('[data-m-share]', (node) => share(api, node.dataset.mShare));
  },
};

export default [panel];
