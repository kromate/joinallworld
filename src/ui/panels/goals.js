/**
 * OWNER: character
 * Goals: the goal chip in the top-left HUD stack, and the Goals tab of the Sim sheet
 * (current starter goal, lifetime dream, wishes, stars and perks).
 *
 * All rules live in src/game/systems/goals.js; these panels draw view.goals.
 * The chip shows the current starter goal (title + how-to hint) and, once the chain is done,
 * a rolling next step. It also toasts each new entry of view.goals.feed once ("Goal complete:
 * Freshen up · +₦500 +1✨") and offers character creation to a new life when it first connects.
 */
import './goals.css';
import { esc, money, json } from '../dom.js';

let lastSeq = null, offeredTo = null;

const offlineWhy = (view) => (view.connected ? '' : 'Offline — reconnect to change anything');

function chip(state, view) {
  const step = view.goals.chip;
  const attrs = step.open ? `data-open="${esc(step.open)}"${step.params ? ` data-params="${json(step.params)}"` : ''}` : step.go ? `data-goal-go="${json(step.go)}"` : 'data-community';
  const count = step.kind === 'goal' ? `<em>Goal ${step.step}/${step.of} · ${esc(step.reward)}</em>` : '';
  return `<button class="life-job goal-chip is-${esc(step.kind)}" ${attrs} data-seq="${view.goals.seq}" data-live="${view.connected ? 1 : 0}" aria-label="${step.kind === 'goal' ? 'Current goal' : 'Next step'}: ${esc(step.title)}. ${esc(step.hint)}"><span aria-hidden="true">${esc(step.icon)}</span><div><strong>${esc(step.title)}</strong><small>${esc(step.hint)}</small>${count}</div></button>`;
}

function dreamCard(view) {
  const dream = view.goals.dream, why = offlineWhy(view);
  if (!dream) {
    return `<section class="goals-dream"><h3>Lifetime dream</h3><p>This life has no dream yet. Choose one — it is picked once.</p><div class="goals-dream-pick">${view.goals.dreams.map((item) => `<button class="ui-button" data-action="goals.set-dream" data-payload="${json({ dream: item.id })}" ${why ? `disabled title="${esc(why)}"` : ''}>${item.icon} ${esc(item.label)}<small>${esc(item.goal)}</small></button>`).join('')}</div>${why ? `<p class="goals-why">${esc(why)}</p>` : ''}</section>`;
  }
  return `<section class="goals-dream"><h3>${dream.icon} ${esc(dream.label)}${dream.done ? ' · achieved' : ''}</h3><p>${esc(dream.goal)}</p>
    <div class="goals-bar" role="meter" aria-label="Dream progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${dream.percent}"><i style="width:${dream.percent}%"></i></div>
    <p class="goals-dream-meta"><b>${dream.percent}%</b> · ${esc(dream.measure)}</p><p class="goals-dream-meta">${dream.done ? 'Reward paid' : 'Reward'}: ${money(dream.reward.cash)} and ${dream.reward.stars}✨ (original beta values).</p></section>`;
}

/** The loan belongs to the economy; this card only shows it and sends the player to the Bank to pay. */
function loanCard(view) {
  const loan = view.economy?.loan;
  if (!loan || typeof loan !== 'object') return '';
  const left = Number(loan.left ?? loan.balance ?? loan.owed), weekly = Number(loan.weekly ?? loan.payment);
  if (!Number.isFinite(left) || left <= 0) return '';
  return `<section class="goals-loan"><h3>🧾 ${esc(loan.label || 'Loan')}</h3><p><b>${money(left)}</b> left${Number.isFinite(weekly) && weekly > 0 ? ` · ${money(weekly)} a week` : ''}</p><button class="ui-button" data-open="bank">Pay in Bank</button></section>`;
}

function wishes(view) {
  const { rerolls } = view.goals, why = offlineWhy(view) || rerolls.blocked || '';
  const rows = view.goals.wishes.map((wish) => `<li class="goals-wish"><span class="goals-wish-icon" aria-hidden="true">${esc(wish.icon)}</span><div><strong>${esc(wish.label)}</strong><small>${esc(wish.hint)}</small>${wish.target > 1 ? `<small class="goals-progress">${wish.money ? `${money(wish.progress)} of ${money(wish.target)}` : `${wish.progress} of ${wish.target}`}</small>` : ''}</div><b>+${wish.stars}✨</b><button class="goals-reroll" data-action="goals.reroll-wish" data-payload="${json({ slot: wish.slot })}" aria-label="Re-roll wish: ${esc(wish.label)}" ${why ? `disabled title="${esc(why)}"` : 'title="Swap this wish for another"'}>↻</button></li>`).join('');
  return `<section><h3>Wishes</h3>${rows ? `<ul class="goals-wishes">${rows}</ul>` : '<p class="preview-note">No wishes are available right now. New ones appear as the city grows.</p>'}<p class="goals-why">${esc(why || `Re-rolls left today: ${rerolls.left} of ${rerolls.max}`)}</p></section>`;
}

function perks(view) {
  const why = offlineWhy(view);
  const cards = view.goals.perks.map((perk) => {
    const reason = perk.owned ? '' : why || perk.blocked || '';
    return `<article class="goals-perk ${perk.owned ? 'is-owned' : reason ? 'is-locked' : 'is-ready'}"><span class="goals-perk-icon" aria-hidden="true">${esc(perk.icon)}</span><strong>${esc(perk.label)}</strong><small>${esc(perk.effect)}${perk.beta ? ' · Original' : ''}</small>${perk.owned
      ? '<em class="goals-owned">✓ Owned</em>'
      : `<button class="ui-button ${reason ? '' : 'is-primary'}" data-action="goals.buy-perk" data-payload="${json({ id: perk.id })}" ${reason ? 'disabled' : ''}>Unlock · ${perk.cost}✨</button>${reason ? `<small class="goals-why">${esc(reason)}</small>` : ''}`}</article>`;
  }).join('');
  return `<section><h3>Perks</h3><div class="goals-perks">${cards}</div><p class="preview-note">Perks last for this whole life. Perks marked Original are beta additions of our own.</p></section>`;
}

export default [
  {
    id: 'goal-chip', title: 'Current goal', icon: '🎯', placement: 'hud', slot: 'goal', order: 10,
    render(state, view) { return chip(state, view); },
    bind(root, api) {
      root.querySelector('[data-goal-go]')?.addEventListener('click', (event) => api.goTo(...JSON.parse(event.currentTarget.dataset.goalGo)));
      const state = api.state(), view = api.view();
      if (!view.connected) return;
      const { seq, feed } = view.goals;
      if (lastSeq === null || seq < lastSeq) lastSeq = seq; // first connected render, or a different life
      for (const item of feed) if (item.n > lastSeq) api.toast(item.text, 'good');
      lastSeq = seq;
      // Offer character creation once per device session; closing it leaves the chip as the way back.
      const who = `${view.session?.id ?? ''}:${view.cityId}`;
      if (!state.onboarding.done && offeredTo !== who) { offeredTo = who; queueMicrotask(() => api.open('onboarding')); }
    },
  },
  {
    id: 'goals', title: 'Goals', icon: '🎯', placement: 'sim-tab', order: 30,
    render(state, view) {
      const g = view.goals, goal = g.chain.current;
      const current = goal
        ? `<section class="goals-current"><h3>${goal.icon} ${esc(goal.title)}</h3><p>${esc(goal.hint)}</p><p class="goals-dream-meta">Starter goal ${g.chain.index + 1} of ${g.chain.total} · reward ${money(goal.cash)} and ${goal.stars}✨</p></section>`
        : `<section class="goals-current"><h3>${esc(g.chip.icon)} ${esc(g.chip.title)}</h3><p>${esc(g.chip.hint)}</p><p class="goals-dream-meta">${g.chain.finished ? 'Starter goals complete. ' : ''}Your next step.</p></section>`;
      return `<div class="goals-root"><p class="goals-stars"><b>✨ ${g.stars}</b> ${g.stars === 1 ? 'star' : 'stars'} · goals give +1, wishes +3</p>${current}${dreamCard(view)}${loanCard(view)}${wishes(view)}${perks(view)}</div>`;
    },
  },
];
