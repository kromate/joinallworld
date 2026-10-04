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

const OFFLINE = 'Offline: read-only until you reconnect.';

export default {
  id: 'invest', title: 'Invest', icon: '📊', placement: 'phone', order: 50,
  render(state, view) {
    const economy = view.economy, savings = economy.savings, offline = view.connected === false ? OFFLINE : null;
    const pick = savings.amounts.find((item) => item.amount === chosen) || savings.amounts[0];
    const blocked = offline || pick.blocked;
    const amounts = savings.amounts.map((item) => `<button aria-pressed="${item.amount === pick.amount}" data-invest-amount="${esc(item.amount)}">${money(item.amount)}</button>`).join('');
    const terms = savings.terms.map((term) => `<button class="ui-button is-primary" data-action="economy.open-deposit" data-payload="${json({ amount: pick.amount, term: term.id })}" ${blocked ? `disabled title="${esc(blocked)}"` : ''}><span>Lock for ${esc(term.label)} · ${esc(term.percent)}%</span><span>get ${money(pick.payouts[term.id])}</span></button>`).join('');
    const open = economy.deposits.map((deposit) => {
      const confirm = closing === deposit.id
        ? `<div class="invest-confirm"><p>Close early? You get your ${money(deposit.amount)} back now and give up the ${money(deposit.interest)} interest.</p><button class="ui-button" data-action="economy.close-deposit" data-payload="${json({ id: deposit.id })}" ${offline ? `disabled title="${esc(offline)}"` : ''}>Yes, close without interest</button><button class="ui-button is-primary" data-invest-close="">Keep it</button></div>`
        : `<button class="ui-button" data-invest-close="${esc(deposit.id)}">Close early (no interest)</button>`;
      return `<section class="invest-card"><div class="invest-row"><h3>${money(deposit.amount)} · ${esc(deposit.termLabel)}</h3><b>+${money(deposit.interest)}</b></div><p>Pays ${money(deposit.payout)} into your balance automatically on ${esc(deposit.maturesLabel)} (${esc(formatClock(deposit.maturesAt))}).</p>${confirm}</section>`;
    }).join('');
    return `<p class="invest-intro"><span class="invest-beta">BETA</span> Fixed deposits: lock some cash, get it back with a small fixed interest when the term ends — even if you are away. No risk and no luck involved.</p><p class="invest-note">Balance ${money(state.cash)} · ${money(savings.locked)} of ${money(savings.cap)} locked · up to ${esc(savings.maxOpen)} deposits at once. Rates and limits are original beta values.</p><section class="invest-card"><h3>Open a deposit</h3><p>How much?</p><div class="invest-amounts" role="group" aria-label="Deposit amount">${amounts}</div><div class="invest-terms">${terms}</div>${blocked ? `<p class="invest-why">${esc(blocked)}</p>` : ''}</section><h3>Your deposits</h3>${open || empty('📊', 'No open deposits', 'Pick an amount and a term above. The money comes back by itself, with interest, when the term ends.', '', { compact: true })}`;
  },
  bind(root, api) {
    for (const button of root.querySelectorAll('[data-invest-amount]')) button.addEventListener('click', () => { chosen = Number(button.dataset.investAmount); api.refresh(); });
    for (const button of root.querySelectorAll('[data-invest-close]')) button.addEventListener('click', () => { closing = button.dataset.investClose || null; api.refresh(); });
  },
};
