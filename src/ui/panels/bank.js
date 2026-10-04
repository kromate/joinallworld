/**
 * OWNER: career
 * Bank app: balance, what is due each Saturday, the rent card, the loan card, savings and the
 * full recent transaction list (view.wallet.ledger, newest first) so every change is explained.
 *
 * Everything shown comes from view.economy (systems/economy.js) and view.career. Payments are the
 * 'economy.pay-loan' { mode } and 'economy.pay-rent' actions.
 * The panel contract is at the top of src/ui/shell.js.
 */
import './bank.css';
import { esc, money, json } from '../dom.js';
import { formatClock } from '../../game/clock.js';

const OFFLINE = 'Offline: read-only until you reconnect.';

function pay(label, action, payload, blocked, primary) {
  return `<button class="ui-button ${primary ? 'is-primary' : ''}" data-action="${esc(action)}" data-payload="${json(payload)}" ${blocked ? `disabled title="${esc(blocked)}"` : ''}>${esc(label)}</button>`;
}

function rentCard(rent, offline) {
  if (!rent) return '<section class="bank-card"><h3>Rent</h3><p class="bank-note">No rent is set up: you have not moved into a rented home yet. Once you do, rent is collected here every Saturday.</p></section>';
  const blocked = offline || rent.payBlocked;
  return `<section class="bank-card ${rent.arrears > 0 ? 'is-warning' : ''}" aria-label="Rent"><h3>Rent · ${esc(rent.label)} <b>${money(rent.amount)}/week</b></h3><p>Next due: <strong>${esc(rent.nextDueLabel)}</strong></p>${rent.warning ? `<p class="bank-warning" role="alert">⚠ ${esc(rent.warning)}</p>` : '<p>You are up to date.</p>'}${rent.arrears > 0 ? `<div class="bank-actions">${pay(`Pay ${money(rent.arrears)} rent now`, 'economy.pay-rent', {}, blocked, true)}</div>${blocked ? `<p class="bank-why">${esc(blocked)}</p>` : ''}` : ''}<p class="bank-note">${esc(rent.rule)} Missed-rent rules are original beta rules.</p></section>`;
}

function loanCard(loan, offline) {
  if (!loan) return '';
  const week = offline || loan.weekBlocked, all = offline || loan.allBlocked;
  const reasons = [...new Set([week, all].filter(Boolean))];
  return `<section class="bank-card" aria-label="Loan"><h3>Starting loan <b>${money(loan.left)} left</b></h3><p>${money(loan.weekly)}/week · ${money(loan.paid)} of ${money(loan.total)} repaid${loan.fees ? ` (includes ${esc(loan.fees)} late fee${loan.fees > 1 ? 's' : ''})` : ''}</p><div class="bank-bar" role="meter" aria-label="Loan repaid" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(loan.progress * 100)}"><i style="width:${Math.round(loan.progress * 100)}%"></i></div><p>${esc(loan.nextCollection)}</p>${loan.cleared ? '' : `<div class="bank-actions">${pay(`Pay ${money(loan.instalment)} now`, 'economy.pay-loan', { mode: 'week' }, week, true)}${pay('Pay it all off', 'economy.pay-loan', { mode: 'all' }, all, false)}</div>${reasons.map((reason) => `<p class="bank-why">${esc(reason)}</p>`).join('')}<p class="bank-note">Paying one instalment now covers the next Saturday collection. ${esc(loan.rule)}</p>`}</section>`;
}

export default {
  id: 'bank', title: 'Bank', icon: '🏦', placement: 'phone', order: 15,
  render(state, view) {
    const economy = view.economy, career = view.career, offline = view.connected === false ? OFFLINE : null;
    const rows = view.wallet.ledger.map((entry) => `<li><span>${esc(entry.reason)}<small>${esc(formatClock(entry.at))} · balance ${money(entry.balance)}</small></span><b class="${entry.amount < 0 ? 'is-out' : 'is-in'}">${entry.amount < 0 ? '−' : '+'}${money(Math.abs(entry.amount))}</b></li>`).join('');
    const bills = economy.weeklyBills > 0
      ? `<p class="bank-summary">Due every Saturday: <strong>${money(economy.weeklyBills)}</strong>. Next collection ${esc(economy.nextDueLabel)}.${career.weeklyPay ? ` Your job pays up to ${money(career.weeklyPay)} a week.` : career.employed ? '' : ' You have no job yet — open Jobs to start earning.'}</p>`
      : '<p class="bank-summary">No weekly bills yet.</p>';
    const locked = economy.savings.locked;
    return `<p class="bank-balance">Balance <strong>${money(state.cash)}</strong></p>${offline ? `<p class="bank-why">${esc(offline)}</p>` : ''}${bills}${rentCard(economy.rent, offline)}${loanCard(economy.loan, offline)}<section class="bank-card"><h3>Savings <b>${money(locked)} locked</b></h3><p class="bank-note">Fixed deposits pay a small, capped interest (beta).</p><button class="ui-button bank-link" data-open="invest">Open Invest</button></section><h3>Recent transactions</h3>${rows ? `<ul class="ui-ledger">${rows}</ul><p class="bank-note">The last ${esc(view.wallet.ledger.length)} changes to your balance, newest first.</p>` : '<p class="bank-note">No transactions yet. Every fare, purchase, wage and payment will be listed here with its reason.</p>'}`;
  },
};
