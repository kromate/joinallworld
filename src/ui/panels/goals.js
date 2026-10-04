/**
 * OWNER: character
 * The Goals tab of the Sim sheet (also a Phone app): current starter goal, lifetime dream, wishes,
 * stars and perks. The goal chip in the HUD is ./goal-chip.js.
 * All rules live in src/game/systems/goals.js; this panel draws view.goals.
 */
import './goals.css';
import { esc, money, json, mark, iconFor, withGlyphs } from '../dom.ts';
import { linkWords } from '../link.ts';

const STAR = mark('star');

const offlineWhy = (view) => (view.connected ? '' : `${linkWords(view).short} — nothing can change right now`);

function dreamCard(view) {
  const dream = view.goals.dream, why = offlineWhy(view);
  if (!dream) {
    return `<section class="goals-dream"><h3>Lifetime dream</h3><p>This life has no dream yet. Choose one — it is picked once.</p><div class="goals-dream-pick">${view.goals.dreams.map((item) => `<button class="ui-button" data-action="goals.set-dream" data-payload="${json({ dream: item.id })}" ${why ? `disabled title="${esc(why)}"` : ''}>${iconFor('dream', item.id, item.icon)} ${esc(item.label)}<small>${esc(item.goal)}</small></button>`).join('')}</div>${why ? `<p class="goals-why">${esc(why)}</p>` : ''}</section>`;
  }
  return `<section class="goals-dream"><h3>${iconFor('dream', dream.id, dream.icon)} ${esc(dream.label)}${dream.done ? ' · achieved' : ''}</h3><p>${esc(dream.goal)}</p>
    <div class="goals-bar" role="meter" aria-label="Dream progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${dream.percent}"><i style="width:${dream.percent}%"></i></div>
    <p class="goals-dream-meta"><b>${dream.percent}%</b> · ${esc(dream.measure)}</p><p class="goals-dream-meta">${dream.done ? 'Reward paid' : 'Reward'}: ${money(dream.reward.cash)} and ${dream.reward.stars} ${STAR} (original beta values).</p></section>`;
}

/** The loan belongs to the economy; this card only shows it and sends the player to the Bank to pay. */
function loanCard(view) {
  const loan = view.economy?.loan;
  if (!loan || typeof loan !== 'object') return '';
  const left = Number(loan.left ?? loan.balance ?? loan.owed), weekly = Number(loan.weekly ?? loan.payment);
  if (!Number.isFinite(left) || left <= 0) return '';
  return `<section class="goals-loan"><h3>${mark('statement')} ${esc(loan.label || 'Loan')}</h3><p><b>${money(left)}</b> left${Number.isFinite(weekly) && weekly > 0 ? ` · ${money(weekly)} a week` : ''}</p><button class="ui-button" data-open="bank">Pay in Bank</button></section>`;
}

function wishes(view) {
  const { rerolls } = view.goals, why = offlineWhy(view) || rerolls.blocked || '';
  const rows = view.goals.wishes.map((wish) => `<li class="goals-wish"><span class="goals-wish-icon" aria-hidden="true">${iconFor('wish', wish.id, wish.icon)}</span><div><strong>${esc(wish.label)}</strong><small>${esc(wish.hint)}</small>${wish.target > 1 ? `<small class="goals-progress">${wish.money ? `${money(wish.progress)} of ${money(wish.target)}` : `${wish.progress} of ${wish.target}`}</small>` : ''}</div><b>+${wish.stars} ${STAR}</b><button class="goals-reroll" data-action="goals.reroll-wish" data-payload="${json({ slot: wish.slot })}" aria-label="Re-roll wish: ${esc(wish.label)}" ${why ? `disabled title="${esc(why)}"` : 'title="Swap this wish for another"'}>${mark('refresh')}</button></li>`).join('');
  return `<section><h3>Wishes</h3>${rows ? `<ul class="goals-wishes">${rows}</ul>` : '<p class="preview-note">No wishes are available right now. New ones appear as the city grows.</p>'}<p class="goals-why">${esc(why || `Re-rolls left today: ${rerolls.left} of ${rerolls.max}`)}</p></section>`;
}

function perks(view) {
  const why = offlineWhy(view);
  const cards = view.goals.perks.map((perk) => {
    const reason = perk.owned ? '' : why || perk.blocked || '';
    return `<article class="goals-perk ${perk.owned ? 'is-owned' : reason ? 'is-locked' : 'is-ready'}"><span class="goals-perk-icon" aria-hidden="true">${iconFor('perk', perk.id, perk.icon)}</span><strong>${esc(perk.label)}</strong><small>${esc(perk.effect)}${perk.beta ? ' · Original' : ''}</small>${perk.owned
      ? `<em class="goals-owned">${mark('check')} Owned</em>`
      : `<button class="ui-button ${reason ? '' : 'is-primary'}" data-action="goals.buy-perk" data-payload="${json({ id: perk.id })}" ${reason ? 'disabled' : ''}>Unlock · ${perk.cost} ${STAR}</button>${reason ? `<small class="goals-why">${withGlyphs(reason)}</small>` : ''}`}</article>`;
  }).join('');
  return `<section><h3>Perks</h3><div class="goals-perks">${cards}</div><p class="preview-note">Perks last for this whole life. Perks marked Original are beta additions of our own.</p></section>`;
}

export default [
  {
    id: 'goals', title: 'Goals', placement: 'sim-tab', order: 30, phone: true, group: 'life',
    render(state, view) {
      const g = view.goals, goal = g.chain.current;
      const current = goal
        ? `<section class="goals-current"><h3>${iconFor('goal', goal.id, goal.icon)} ${esc(goal.title)}</h3><p>${esc(goal.hint)}</p><p class="goals-dream-meta">Starter goal ${g.chain.index + 1} of ${g.chain.total} · reward ${money(goal.cash)} and ${goal.stars} ${STAR}</p></section>`
        : `<section class="goals-current"><h3>${iconFor('goal', g.chip.id, g.chip.icon)} ${esc(g.chip.title)}</h3><p>${withGlyphs(g.chip.hint)}</p><p class="goals-dream-meta">${g.chain.finished ? 'Starter goals complete. ' : ''}Your next step.</p></section>`;
      return `<div class="goals-root"><p class="goals-stars"><b>${STAR} ${g.stars}</b> ${g.stars === 1 ? 'star' : 'stars'} · goals give +1, wishes +3</p>${current}${dreamCard(view)}${loanCard(view)}${wishes(view)}${perks(view)}</div>`;
    },
  },
];
