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
    return `<p>Your people back home<span class="social-beta">Beta</span></p>
      <p class="social-note">Call each of them once a day to check in: +${info.social} Social and a “Checked in with family” feeling (+${info.mood} mood for a few hours). A call takes ${info.duration} seconds and works anywhere. Calling again the same day is only a quick hello.</p>
      ${social.family.map((member) => `<div class="social-row"><span class="social-avatar" aria-hidden="true">${esc(member.emoji)}</span><div><strong>${esc(member.name)}</strong><small>${esc(member.relation)} · ${esc(member.line)}${member.calledToday ? ' · ✓ checked in today' : ''}</small></div><span class="social-actions">${callButton(state, view, member)}</span></div>`).join('')}
      <p><strong>${called} of ${social.family.length}</strong> checked in today · streak: <strong>${social.streak} day${social.streak === 1 ? '' : 's'}</strong></p>
      <p class="preview-note">Original beta feature and values. The family here is the same for every player for now.</p>`;
  },
};
