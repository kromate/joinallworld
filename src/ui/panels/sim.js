/**
 * OWNER: character
 * Sim sheet tabs: Profile, Needs and Skills (and appearance, inside Profile).
 * This file exports several 'sim-tab' panels; `order` fixes the tab order.
 *
 * Starter content (extend freely): name and mood, the six need meters with current feelings,
 * and the nine skills with level and progress.
 * The panel contract is at the top of src/ui/shell.js. Styles: create ./sim.css and import it here.
 */
import { esc, cap, meter } from '../dom.js';

export default [
  {
    id: 'profile', title: 'Profile', icon: '👤', placement: 'sim-tab', order: 10,
    render(state, view) { return `<p><strong>${esc(view.name)}</strong> · ${esc(view.city.name)}</p><p>Mood: ${esc(view.needs.mood.icon)} ${esc(view.needs.mood.label)} (${esc(view.needs.mood.score)})</p>`; },
  },
  {
    id: 'needs', title: 'Needs', icon: '❤️', placement: 'sim-tab', order: 20,
    render(state, view) {
      const feelings = view.needs.feelings.map((feeling) => `<li>${esc(feeling.label)} <b>${feeling.value > 0 ? '+' : '−'}${Math.abs(feeling.value)}</b></li>`).join('');
      return `${view.needs.order.map((need) => meter(cap(need), state.needs[need])).join('')}${feelings ? `<h3>Feelings</h3><ul class="ui-list">${feelings}</ul>` : ''}<p class="preview-note">Needs fall slowly over real time, never below 10 on their own. Mood thresholds are provisional beta settings.</p>`;
    },
  },
  {
    id: 'skills', title: 'Skills', icon: '🎓', placement: 'sim-tab', order: 40,
    render(state, view) { return Object.entries(view.skills).map(([skill, info]) => meter(`${cap(skill)} · level ${info.level}`, info.progress * 100, -1)).join(''); },
  },
];
