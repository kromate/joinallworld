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
import { esc, money, json, empty, ledgerRow, chevron } from '../dom.js';
import { formatClock } from '../../game/clock.js';

const OFFLINE = 'Not connected: read-only until the connection is back.';

function pay(label, action, payload, blocked, primary) {
  return `<button class="ui-button ${primary ? 'is-primary' : ''}" data-action="${esc(action)}" data-payload="${json(payload)}" ${blocked ? `disabled title="${esc(blocked)}"` : ''}>${esc(label)}</button>`;
}

function rentCard(rent, offline) {
  if (!rent) return '<section class="bank-card"><h3><span><i aria-hidden="true">🏠</i>Rent</span></h3><p class="bank-note">No rent is set up: you have not moved into a rented home yet. Once you do, rent is collected here every Saturday.</p></section>';
  const blocked = offline || rent.payBlocked;
  return `<section class="bank-card ${rent.arrears > 0 ? 'is-warning' : ''}" aria-label="Rent"><h3><span><i aria-hidden="true">🏠</i>Rent<small>${esc(rent.label)}</small></span><b>${money(rent.amount)}<small>per week</small></b></h3><p class="bank-due"><span class="ui-chip ${rent.arrears > 0 ? 'is-bad' : rent.warning ? 'is-warn' : 'is-good'}">${rent.arrears > 0 ? 'Overdue' : rent.warning ? 'At risk' : 'Up to date'}</span> Next due <strong>${esc(rent.nextDueLabel)}</strong></p>${rent.warning ? `<p class="bank-warning" role="alert">${esc(rent.warning)}</p>` : ''}${rent.arrears > 0 ? `<div class="bank-actions">${pay(`Pay ${money(rent.arrears)} rent now`, 'economy.pay-rent', {}, blocked, true)}</div>${blocked ? `<p class="bank-why">${esc(blocked)}</p>` : ''}` : ''}<p class="bank-note">${esc(rent.rule)} Missed-rent rules are original beta rules.</p></section>`;
}

function loanCard(loan, offline) {
  if (!loan) return '';
  const week = offline || loan.weekBlocked, all = offline || loan.allBlocked;
  const reasons = [...new Set([week, all].filter(Boolean))];
  return `<section class="bank-card" aria-label="Loan"><h3><span><i aria-hidden="true">🤝</i>Starting loan<small>${money(loan.weekly)} per week</small></span><b>${money(loan.left)}<small>left to pay</small></b></h3><p>${money(loan.paid)} of ${money(loan.total)} repaid${loan.fees ? ` (includes ${esc(loan.fees)} late fee${loan.fees > 1 ? 's' : ''})` : ''}</p><div class="ui-bar" role="meter" aria-label="Loan repaid" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(loan.progress * 100)}"><i style="width:${Math.round(loan.progress * 100)}%"></i></div><p>${esc(loan.nextCollection)}</p>${loan.cleared ? '' : `<div class="bank-actions">${pay(`Pay ${money(loan.instalment)} now`, 'economy.pay-loan', { mode: 'week' }, week, true)}${pay('Pay it all off', 'economy.pay-loan', { mode: 'all' }, all, false)}</div>${reasons.map((reason) => `<p class="bank-why">${esc(reason)}</p>`).join('')}<p class="bank-note">Paying one instalment now covers the next Saturday collection. ${esc(loan.rule)}</p>`}</section>`;
}

export default {
  id: 'bank', title: 'Bank', icon: '🏦', placement: 'phone', order: 14,
  render(state, view) {
    const economy = view.economy, career = view.career, offline = view.connected === false ? OFFLINE : null;
    const rows = view.wallet.ledger.map((entry) => ledgerRow(entry.reason, `${formatClock(entry.at)} · balance ${money(entry.balance)}`, entry.amount)).join('');
    const bills = economy.weeklyBills > 0
      ? `<p>Due every Saturday: <b>${money(economy.weeklyBills)}</b> · next ${esc(economy.nextDueLabel)}.${career.weeklyPay ? ` Your job pays up to ${money(career.weeklyPay)} a week.` : career.employed ? '' : ' You have no job yet — open Jobs to start earning.'}</p>`
      : '<p>No weekly bills yet.</p>';
    const locked = economy.savings.locked;
    return `<section class="ui-hero bank-hero" aria-label="Balance"><small>Balance</small><strong>${money(state.cash)}</strong>${bills}</section>${offline ? `<p class="ui-why">${esc(offline)}</p>` : ''}
      <div class="bank-quick"><button class="ui-button" data-open="statement">Statement</button><button class="ui-button" data-open="invest">Invest</button>${career.employed ? '' : '<button class="ui-button" data-open="jobs">Find a job</button>'}</div>
      ${rentCard(economy.rent, offline)}${loanCard(economy.loan, offline)}
      <div class="ui-rows"><button class="ui-row" data-open="invest"><span class="ui-row-icon" aria-hidden="true">🔒</span><span class="ui-row-body"><b>Savings</b><small>Fixed deposits pay a small, capped interest (beta)</small></span><span class="ui-row-end"><span>${money(locked)}<small>locked</small></span>${chevron()}</span></button></div>
      <h3 class="ui-section">Recent transactions<small>${view.wallet.ledger.length ? `last ${esc(view.wallet.ledger.length)}, newest first` : ''}</small></h3>${rows ? `<ul class="ui-rows bank-ledger">${rows}</ul>` : empty('🧾', 'No transactions yet', 'Every fare, purchase, wage and payment will be listed here with its reason.', '', { compact: true })}`;
  },
};
