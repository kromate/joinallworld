/**
 * OWNER: career
 * Career tab of the Sim sheet: track, level, role, pay, the one schedule sentence, performance,
 * the next promotion and what it still needs, weekday chips, today's status and the next step.
 *
 * Everything shown comes from view.career (systems/career.js), so this file holds no rules.
 * The panel contract is at the top of src/ui/shell.js.
 */
import './career.css';
import { esc, money, json, meter, cap } from '../dom.js';

const mark = (met, text) => `<span class="${met ? 'is-met' : 'is-unmet'}">${met ? '✓' : '✗'} ${esc(text)}</span>`;

export default {
  id: 'career', title: 'Career', icon: '📈', placement: 'sim-tab', order: 60,
  render(state, view) {
    const career = view.career;
    if (!career.employed) {
      return `<div class="career-empty"><p>No job yet. Find one in the Jobs app on your phone — applying is free and you can work the same day.</p><button class="ui-button is-primary" data-open="jobs">Open Jobs</button></div>`;
    }
    const next = career.next;
    const promotion = !career.isTrack ? '<p class="career-next">The starter job has no promotions. Pick a career track in Jobs to climb a ladder.</p>'
      : next ? `<p class="career-next">${esc(next.text)}<br>${mark(next.performanceMet, 'Performance 100%')}${mark(next.skillMet, `${cap(next.skill)} level ${next.skillLevel} (yours: ${next.have})`)}</p>`
      : '<p class="career-next">Top of the ladder: there is no higher role in this track.</p>';
    const step = career.step;
    const action = step.kind === 'go' ? `<button class="ui-button is-primary" data-career-go="${json([step.venue, step.spot])}">Go to work</button>`
      : step.kind === 'home' ? `<button class="ui-button is-primary" data-career-go="${json(['home'])}">Go home to eat and rest</button>`
      : step.kind === 'start' ? '<button class="ui-button is-primary" data-close>Close and start shift</button>' : '';
    return `<div class="career-head"><h3>${esc(career.icon)} ${esc(career.label)}${career.isTrack ? ` · Level ${esc(career.level)} · ${esc(career.role)}` : ''}</h3><p><strong>${money(career.pay)} per shift</strong> at ${esc(career.workplace.label)}</p><p class="career-schedule">${esc(career.schedule)}</p></div>${career.isTrack ? meter('Performance', career.performance, 0) : ''}${promotion}<ul class="career-chips" aria-label="Work days">${career.chips.map((chip) => `<li class="${chip.work ? 'is-work' : ''} ${chip.today ? 'is-today' : ''}" title="${esc(chip.name)}: ${chip.work ? 'work day' : 'day off'}${chip.today ? ' (today)' : ''}" aria-label="${esc(chip.name)}: ${chip.work ? 'work day' : 'day off'}${chip.today ? ', today' : ''}">${esc(chip.letter)}</li>`).join('')}</ul><p class="career-legend">Green = work day · ring = today (${esc(career.today.weekday)}, Lagos time)</p><p class="career-status ${career.today.canWork ? 'is-open' : ''}">${esc(career.today.text)}</p><p class="career-step">${esc(step.kind === 'wait' && step.text === career.today.text ? career.nextShift : step.text)}</p><div class="career-actions">${action}<button class="ui-button" data-open="jobs">Jobs: switch or quit</button></div>${view.connected === false ? '<p class="career-why">Offline: read-only until you reconnect.</p>' : ''}<ul class="career-rules">${career.rules.map((rule) => `<li>${esc(rule)}</li>`).join('')}</ul>`;
  },
  bind(root, api) {
    for (const button of root.querySelectorAll('[data-career-go]')) {
      button.addEventListener('click', () => { const [venue, spot] = JSON.parse(button.dataset.careerGo); api.close(); api.goTo(venue, spot); });
    }
  },
};
