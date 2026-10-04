/**
 * OWNER: character
 * The goal chip in the HUD: the current starter goal (title + how-to hint) and, once the chain is
 * done, a rolling next step. It also toasts each new entry of view.goals.feed once ("Goal complete:
 * Freshen up · +₦500 +1 star") and offers character creation to a new life when it first connects.
 * First download; the Goals tab of the Sim sheet is ./goals.js (fetched with the sim panel group).
 * All rules live in src/game/systems/goals.js; this draws view.goals.
 */
import './goals.css';
import { esc, json, iconFor, withGlyphs } from '../dom.js';

let lastSeq = null, offeredTo = null;

function chip(state, view) {
  const step = view.goals.chip;
  const attrs = step.open ? `data-open="${esc(step.open)}"${step.params ? ` data-params="${json(step.params)}"` : ''}` : step.go ? `data-goal-go="${json(step.go)}"` : 'data-community';
  const count = step.kind === 'goal' ? `<em>Goal ${step.step}/${step.of} · ${withGlyphs(step.reward)}</em>` : '';
  return `<button class="life-job goal-chip is-${esc(step.kind)}" ${attrs} data-seq="${view.goals.seq}" data-live="${view.connected ? 1 : 0}" aria-label="${step.kind === 'goal' ? 'Current goal' : 'Next step'}: ${esc(step.title)}. ${esc(step.hint)}"><span aria-hidden="true">${iconFor('goal', step.id, step.icon)}</span><div><strong>${esc(step.title)}</strong><small>${withGlyphs(step.hint)}</small>${count}</div></button>`;
}

export default [
  {
    id: 'goal-chip', title: 'Current goal', icon: 'goals', placement: 'hud', slot: 'goal', order: 10,
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
];
