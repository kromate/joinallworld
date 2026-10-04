/**
 * OWNER: career
 * Invest app: fixed deposits — an original beta savings product, not from the reference game.
 * Lock cash for 1, 3 or 7 days; principal plus a small fixed interest returns automatically at
 * maturity on server time. Limits and rates come from view.economy.savings (systems/economy.js).
 * No gambling and no random outcome.
 *
 * Actions: 'economy.open-deposit' { amount, term } and 'economy.close-deposit' { id }. The panel contract is at the top of src/ui/shell.js.
 */
import './invest.css';
import { esc, money, json, empty } from '../dom.js';
import { formatClock } from '../../game/clock.js';

/** UI-only state: the chosen amount and the deposit whose early close is being confirmed. */
let chosen = 5000;
let closing = null;

const OFFLINE = 'Not connected: read-only until the connection is back.';

export default {
  id: 'invest', title: 'Invest', icon: '📊', placement: 'phone', order: 50,
  render(state, view) {
    const economy = view.economy, savings = economy.savings, offline = view.connected === false ? OFFLINE : null;
    const pick = savings.amounts.find((item) => item.amount === chosen) || savings.amounts[0];
    const blocked = offline || pick.blocked;
    const amounts = savings.amounts.map((item) => `<button aria-pressed="${item.amount === pick.amount}" data-invest-amount="${esc(item.amount)}">${money(item.amount)}</button>`).join('');
    const terms = savings.terms.map((term) => `<button class="invest-term" data-action="economy.open-deposit" data-payload="${json({ amount: pick.amount, term: term.id })}" ${blocked ? `disabled title="${esc(blocked)}"` : ''}><span><b>Lock for ${esc(term.label)}</b><small>${esc(term.percent)}% fixed interest</small></span><span class="invest-get"><small>you get</small>${money(pick.payouts[term.id])}</span></button>`).join('');
    const open = economy.deposits.map((deposit) => {
      const confirm = closing === deposit.id
        ? `<div class="ui-confirm"><p>Close early? You get your ${money(deposit.amount)} back now and give up the ${money(deposit.interest)} interest.</p><div><button class="ui-button is-danger" data-action="economy.close-deposit" data-payload="${json({ id: deposit.id })}" ${offline ? `disabled title="${esc(offline)}"` : ''}>Close without interest</button><button class="ui-button is-primary" data-invest-close="">Keep it</button></div></div>`
        : `<button class="ui-button is-small" data-invest-close="${esc(deposit.id)}">Close early (no interest)</button>`;
      return `<section class="invest-card"><div class="invest-row"><h3>${money(deposit.amount)}<small>${esc(deposit.termLabel)}</small></h3><b class="ui-chip is-good">+${money(deposit.interest)}</b></div><p>Pays ${money(deposit.payout)} into your balance automatically on ${esc(deposit.maturesLabel)} (${esc(formatClock(deposit.maturesAt))}).</p>${confirm}</section>`;
    }).join('');
    return `<section class="ui-hero invest-hero" aria-label="Locked savings"><small>Locked in deposits <span class="invest-beta">Beta</span></small><strong>${money(savings.locked)}</strong><p>of ${money(savings.cap)} allowed · balance ${money(state.cash)} · up to ${esc(savings.maxOpen)} deposits at once</p></section>
      <section class="invest-card"><h3>Open a deposit</h3><p class="ui-note">Lock some cash and get it back with a small fixed interest when the term ends — even if you are away. No risk and no luck involved.</p><div class="invest-amounts" role="group" aria-label="Deposit amount">${amounts}</div><div class="invest-terms">${terms}</div>${blocked ? `<p class="ui-why">${esc(blocked)}</p>` : ''}</section>
      <h3 class="ui-section">Your deposits</h3>${open || empty('📊', 'No open deposits', 'Pick an amount and a term above. The money comes back by itself, with interest, when the term ends.', '', { compact: true })}<p class="ui-fine">Rates and limits are original beta values.</p>`;
  },
  bind(root, api) {
    for (const button of root.querySelectorAll('[data-invest-amount]')) button.addEventListener('click', () => { chosen = Number(button.dataset.investAmount); api.refresh(); });
    for (const button of root.querySelectorAll('[data-invest-close]')) button.addEventListener('click', () => { closing = button.dataset.investClose || null; api.refresh(); });
  },
};
