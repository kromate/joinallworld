/**
 * OWNER: social
 * Family app (original beta feature): your household and a daily check-in call to each of
 * them. The reference game has a Family app whose content was never observed, so everything
 * here is original and labelled beta.
 * The panel contract is at the top of src/ui/shell.js.
 */
import { esc } from '../dom.js';
import { callButton } from './contacts.js';

export default {
  id: 'family', title: 'Family', icon: '👪', placement: 'phone', order: 36,
  render(state, view) {
    const social = view.social, info = social.familyCall;
    const called = social.family.filter((member) => member.calledToday).length;
    const why = !view.connected ? 'Not connected: calls need the server.' : state.activeAction ? 'Finish or cancel your current action to call.' : '';
    return `<section class="ui-hero family-hero"><small>Your people back home <span class="social-beta">Beta</span></small><strong>${called} of ${social.family.length} checked in today</strong><p>Streak: ${social.streak} day${social.streak === 1 ? '' : 's'} · each first call of the day gives +${info.social} Social and +${info.mood} mood for a few hours</p></section>
      <div class="social-list">${social.family.map((member) => `<div class="social-row"><span class="social-avatar is-big" aria-hidden="true">${esc(member.emoji)}</span><div><strong>${esc(member.name)}${member.calledToday ? ' <span class="ui-chip is-good">Checked in</span>' : ''}</strong><small>${esc(member.relation)} · ${esc(member.line)}</small></div><span class="social-actions">${callButton(state, view, member)}</span></div>`).join('')}</div>${why ? `<p class="ui-why">${esc(why)}</p>` : ''}
      <p class="ui-note">A call takes ${info.duration} seconds and works anywhere. Calling again the same day is only a quick hello.</p>
      <p class="preview-note">Original beta feature and values. The family here is the same for every player for now.</p>`;
  },
};
