/**
 * OWNER: career
 * Bank app: balance, recent transactions, loan and rent payments.
 *
 * Starter content (extend freely): shows the balance and the wallet's transaction log
 * (view.wallet.ledger, newest first) so every balance change is explained.
 * The panel contract is at the top of src/ui/shell.js. Styles: create ./bank.css and import it here.
 */
import { esc, money } from '../dom.js';
import { formatClock } from '../../game/clock.js';

export default {
  id: 'bank', title: 'Bank', icon: '🏦', placement: 'phone', order: 15,
  render(state, view) {
    const rows = view.wallet.ledger.map((entry) => `<li><span>${esc(entry.reason)}<small>${esc(formatClock(entry.at))}</small></span><b class="${entry.amount < 0 ? 'is-out' : 'is-in'}">${entry.amount < 0 ? '−' : '+'}${money(Math.abs(entry.amount))}</b></li>`).join('');
    return `<p class="bank-balance">Balance <strong>${money(state.cash)}</strong></p><h3>Recent transactions</h3>${rows ? `<ul class="ui-ledger">${rows}</ul>` : '<p class="preview-note">No transactions yet. Every fare, purchase and payment will be listed here.</p>'}`;
  },
};
