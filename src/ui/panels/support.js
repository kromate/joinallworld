/**
 * OWNER: trust
 * Report a problem — from inside the game, with no other account.
 *
 * A short form (what kind of problem, what happened) filed with POST /api/support/reports. The
 * server attaches the context by itself — build, city, where the life is, the last ten actions
 * with their results, the last refusal and the last ten wallet lines — so the player never has
 * to describe their own state, and it answers with a receipt number. Every receipt this device
 * has filed is listed below the form with its status and any note from a moderator
 * (GET /api/support/reports), and is still there after a reload.
 * The form is not re-rendered by state updates (live: false) so typing is never interrupted.
 * The panel contract is at the top of src/ui/shell.js.
 */
import './support.css';
import { esc, uuid } from '../dom.js';
import { formatClock } from '../../game/clock.js';

const LABELS = { money: 'Money or balance', stuck: 'I am stuck', messages: 'Messages or invites', people: 'Another player', bug: 'Something is broken', other: 'Something else' };
const STATUS = { received: 'Received — waiting for a moderator', reviewing: 'Being looked at', resolved: 'Resolved', dismissed: 'Closed without action' };
let draft = { category: 'bug', text: '', clientId: null };
let list = null;        // { reports, limits } | null
let loading = false, sending = false, notice = null; // notice: { kind: 'good' | 'error', text }

async function load(api) {
  if (loading) return;
  loading = true;
  try { list = await api.fetchJson('/api/support/reports'); } catch { list = list ?? { reports: [], limits: { text: 600, open: 5 }, failed: true }; }
  loading = false; api.refresh();
}

export default {
  id: 'support', title: 'Report a problem', icon: '🛟', placement: 'phone', order: 96, live: false,
  render(state, view) {
    const offline = view.connected === false;
    const max = list?.limits?.text ?? 600;
    const options = Object.entries(LABELS).map(([id, label]) => `<option value="${esc(id)}" ${draft.category === id ? 'selected' : ''}>${esc(label)}</option>`).join('');
    const receipts = !list ? '<p class="support-note">Loading your reports…</p>'
      : list.failed ? '<p class="support-note">Your earlier reports could not be loaded just now. They are kept on the server; open this page again to see them.</p>'
      : list.reports.length ? `<ul class="support-list">${list.reports.map((report) => `<li class="is-${esc(report.status)}"><div><strong>${esc(report.id)}</strong><span>${esc(STATUS[report.status] ?? report.status)}</span></div>
          <p>${esc(report.text)}</p><small>${esc(LABELS[report.category] ?? report.category)} · filed ${esc(formatClock(report.at))}${report.updatedAt > report.at ? ` · updated ${esc(formatClock(report.updatedAt))}` : ''}</small>
          ${report.note ? `<p class="support-reply"><b>Moderator:</b> ${esc(report.note)}</p>` : ''}</li>`).join('')}</ul>`
      : '<p class="support-note">You have not reported anything yet.</p>';
    return `<p class="support-lead">Tell us what went wrong. Your report is filed on this server and you get a receipt number at once — no e-mail or other account is needed.</p>
      <form class="support-form" data-support-form>
        <label>What kind of problem?<select name="category" ${offline ? 'disabled' : ''}>${options}</select></label>
        <label>What happened?<textarea name="text" rows="5" maxlength="${esc(max)}" placeholder="What you did, what you expected, what you saw instead." ${offline ? 'disabled' : ''}>${esc(draft.text)}</textarea></label>
        <p class="support-note">Sent with your report automatically: the game build, your city and where you are, your last 10 actions and their results, the last thing that was refused, and your last 10 wallet lines. Your device’s secret is never included.</p>
        <span class="support-send"><button class="ui-button is-primary" type="submit" ${offline || sending ? 'disabled' : ''}>${sending ? 'Sending…' : 'Send report'}</button>${offline ? '<small>Offline: reconnect to send. What you typed is kept.</small>' : ''}</span>
        ${notice ? `<p class="support-${esc(notice.kind)}" role="${notice.kind === 'error' ? 'alert' : 'status'}">${esc(notice.text)}</p>` : ''}
      </form>
      <h3>Your reports</h3>${receipts}`;
  },
  bind(root, api, params) {
    if (params?.category && LABELS[params.category] && !draft.text) draft.category = params.category;
    if (!list && !loading) load(api);
    const form = root.querySelector('[data-support-form]');
    if (!form) return;
    form.elements.category.value = draft.category;
    form.elements.category.addEventListener('change', (event) => { draft.category = event.target.value; });
    form.elements.text.addEventListener('input', (event) => { draft.text = event.target.value; });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = draft.text.trim();
      if (text.length < 3) { notice = { kind: 'error', text: 'Write a few words about what happened, then send.' }; api.refresh(); return; }
      // One id per report, reused if the send has to be retried, so a retry can never file it twice.
      draft.clientId ||= `support-${uuid()}`;
      sending = true; notice = null; api.refresh();
      try {
        const reply = await api.fetchJson('/api/support/reports', { method: 'POST', body: { cityId: api.view().cityId, category: draft.category, text, clientId: draft.clientId } });
        if (reply.ok) {
          notice = { kind: 'good', text: `Report ${reply.receipt.id} was received. Its status will appear below; you can close this page.` };
          draft = { category: draft.category, text: '', clientId: null };
          list = null; load(api);
        } else notice = { kind: 'error', text: reply.reason || 'The report was not filed. Nothing was sent; try again.' };
      } catch (error) {
        notice = { kind: 'error', text: error?.status === 429 ? 'Too many requests just now. Your text is kept; try again in a minute.' : 'The report could not be sent. Your text is kept; press Send report to try again — it will not be filed twice.' };
      }
      sending = false; api.refresh();
    });
  },
};
