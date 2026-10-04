/**
 * OWNER: trust
 * Statement: exactly why the balance is what it is.
 *
 * Opening balance, money in and out for each Lagos day (with the reasons that moved the most),
 * every recent change line by line with its reason and time, and the closing balance — with the
 * arithmetic shown. The page is drawn from view.wallet (the life the server sent), and "Check with
 * the server" fetches GET /api/support/statement, the same statement computed from the server's own
 * copy, and says whether the two agree. Nothing here changes anything.
 * The panel contract is at the top of src/ui/shell.js.
 */
import './statement.css';
import { esc, money, json } from '../dom.js';
import { formatClock, lagosDayStart, WEEKDAYS } from '../../game/clock.js';

let checked = null; // { cityId, closing, at, ok, text }
let busy = false;

const signed = (amount) => `${amount < 0 ? '−' : '+'}${money(Math.abs(amount))}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayLabel(day) {
  const local = new Date(lagosDayStart(day) + 3600000);
  return `${WEEKDAYS[local.getUTCDay()].slice(0, 3)} ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]}`;
}

export default {
  id: 'statement', title: 'Statement', icon: '🧾', placement: 'phone', order: 15,
  render(state, view) {
    const wallet = view.wallet, summary = wallet.statement;
    if (!summary) return '<p class="statement-note">The statement is not available for this life yet.</p>';
    const days = wallet.days.map((day) => `<li><div class="statement-day"><strong>${esc(dayLabel(day.day))}</strong><span>${money(day.open)} → ${money(day.close)}</span></div>
      <div class="statement-flow"><span class="is-in">+${money(day.in)}</span><span class="is-out">−${money(day.out)}</span><small>${esc(day.changes)} change${day.changes === 1 ? '' : 's'}</small></div>
      <ul class="statement-groups">${day.groups.map((group) => `<li><span>${esc(group.group)}${group.count > 1 ? ` × ${esc(group.count)}` : ''}</span><b class="${group.net < 0 ? 'is-out' : 'is-in'}">${signed(group.net)}</b></li>`).join('')}</ul></li>`).join('');
    const lines = wallet.ledger.map((line) => `<li><span>${esc(line.reason)}<small>${esc(formatClock(line.at))} · balance ${money(line.balance)}</small></span><b class="${line.amount < 0 ? 'is-out' : 'is-in'}">${signed(line.amount)}</b></li>`).join('');
    const since = summary.opening.day === null ? 'before your first change' : `at the start of ${dayLabel(summary.opening.day)}`;
    const sums = `<dl class="statement-sums"><div><dt>Opening balance <small>${esc(since)}</small></dt><dd>${money(summary.opening.balance)}</dd></div>
      <div><dt>Money in</dt><dd class="is-in">+${money(summary.totals.in)}</dd></div><div><dt>Money out</dt><dd class="is-out">−${money(summary.totals.out)}</dd></div>
      <div class="statement-total"><dt>Closing balance <small>${esc(summary.totals.changes)} change${summary.totals.changes === 1 ? '' : 's'}</small></dt><dd>${money(summary.closing)}</dd></div></dl>`;
    const adds = summary.reconciled
      ? `<p class="statement-ok">✓ ${money(summary.opening.balance)} + ${money(summary.totals.in)} − ${money(summary.totals.out)} = ${money(summary.closing)}. Every naira is accounted for.</p>`
      : `<p class="statement-bad" role="alert">⚠ This statement does not add up: ${esc(summary.problems.join(' '))} Please use Phone → Report a problem; your history is attached automatically.</p>`;
    const verdict = checked && checked.cityId === view.cityId ? `<p class="${checked.ok ? 'statement-ok' : 'statement-bad'}" role="status">${esc(checked.text)}</p>` : '';
    const offline = view.connected === false;
    return `${sums}${adds}
      <span class="statement-check"><button class="ui-button" data-statement-check ${offline || busy ? 'disabled' : ''}>${busy ? 'Checking…' : 'Check with the server'}</button>${offline ? '<small>Offline: reconnect to check.</small>' : ''}</span>${verdict}
      <h3>By day</h3>${days ? `<ul class="statement-days">${days}</ul>` : '<p class="statement-note">No changes yet. Your first fare, meal or wage will appear here.</p>'}
      <h3>Recent changes</h3>${lines ? `<ul class="ui-ledger">${lines}</ul>` : '<p class="statement-note">Nothing yet.</p>'}
      <p class="statement-note">The last ${esc(summary.kept.lines)} changes are kept line by line and the last ${esc(summary.kept.days)} days with activity are kept as daily totals, so older changes stay explained after their lines scroll away. Rent and the loan are collected on Saturdays, Lagos time, even while you are away — they appear here with the date they were due.</p>
      <button class="ui-button" data-open="support" data-params="${json({ category: 'money' })}">Something here looks wrong</button>`;
  },
  bind(root, api) {
    root.querySelector('[data-statement-check]')?.addEventListener('click', async () => {
      const view = api.view();
      busy = true; api.refresh();
      try {
        const reply = await api.fetchJson(`/api/support/statement?city=${encodeURIComponent(view.cityId)}`);
        const server = reply.statement, mine = api.view().wallet.statement;
        const same = server.reconciled && server.closing === api.state().cash && server.opening.balance === mine.opening.balance && server.totals.net === mine.totals.net;
        checked = { cityId: view.cityId, ok: same, text: same ? `✓ The server’s own statement agrees: closing balance ${money(server.closing)}, ${server.totals.changes} changes, reconciled.`
          : `The server’s statement closes at ${money(server.closing)}. If what you see here differs, wait a moment for this screen to catch up and check again.` };
      } catch (error) {
        checked = { cityId: view.cityId, ok: false, text: error?.status === 429 ? 'You have checked several times this minute. Try again shortly.' : 'The server could not be reached. Nothing changed; try again.' };
      }
      busy = false; api.refresh();
    });
  },
};
