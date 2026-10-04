/**
 * OWNER: career
 * Career tab of the Sim sheet: track, level, role, pay, the one schedule sentence, performance,
 * the next promotion and what it still needs, weekday chips, today's status and the next step.
 *
 * Everything shown comes from view.career (systems/career.js), so this file holds no rules.
 * The panel contract is at the top of src/ui/shell.js.
 */
import './career.css';
import { esc, money, json, cap, empty } from '../dom.js';

const mark = (met, text) => `<span class="${met ? 'is-met' : 'is-unmet'}">${met ? '✓' : '✗'} ${esc(text)}</span>`;

export default {
  id: 'career', title: 'Career', icon: '📈', placement: 'sim-tab', order: 60,
  render(state, view) {
    const career = view.career;
    if (!career.employed) {
      return empty('💼', 'No job yet', 'Find one in the Jobs app — applying is free and you can work the same day.', '<button class="ui-button is-primary" data-open="jobs">Open Jobs</button>');
    }
    const next = career.next;
    const promotion = !career.isTrack ? '<p class="career-next">The starter job has no promotions. Pick a career track in Jobs to climb a ladder.</p>'
      : next ? `<p class="career-next">${esc(next.text)}<br>${mark(next.performanceMet, 'Performance 100%')}${mark(next.skillMet, `${cap(next.skill)} level ${next.skillLevel} (yours: ${next.have})`)}</p>`
      : '<p class="career-next">Top of the ladder: there is no higher role in this track.</p>';
    const step = career.step;
    const action = step.kind === 'go' ? `<button class="ui-button is-primary" data-career-go="${json([step.venue, step.spot])}">Go to work</button>`
      : step.kind === 'home' ? `<button class="ui-button is-primary" data-career-go="${json(['home'])}">Go home to eat and rest</button>`
      : step.kind === 'start' ? '<button class="ui-button is-primary" data-close>Close and start shift</button>' : '';
    const promotionCard = career.isTrack ? `<section class="ui-card career-card"><h3>Performance <b>${esc(career.performance)}%</b></h3><div class="ui-bar" role="meter" aria-label="Performance" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(career.performance)}"><i style="width:${Math.max(0, Math.min(100, career.performance))}%"></i></div>${promotion}</section>` : promotion;
    return `<section class="ui-hero career-hero"><small>${esc(career.icon)} ${esc(career.label)}${career.isTrack ? ` · Level ${esc(career.level)}` : ''}</small><strong>${career.isTrack ? esc(career.role) : 'Starter job'}</strong><p><b>${money(career.pay)} per shift</b> at ${esc(career.workplace.label)}</p></section>
      <p class="career-status ${career.today.canWork ? 'is-open' : ''}">${esc(career.today.text)}</p><p class="career-step">${esc(step.kind === 'wait' && step.text === career.today.text ? career.nextShift : step.text)}</p><div class="career-actions">${action}<button class="ui-button" data-open="jobs">Jobs: switch or quit</button></div>${view.connected === false ? '<p class="ui-why">Not connected: read-only until the connection is back.</p>' : ''}
      ${promotionCard}
      <section class="ui-card career-card"><h3>Work days</h3><p class="career-schedule">${esc(career.schedule)}</p><ul class="career-chips" aria-label="Work days">${career.chips.map((chip) => `<li class="${chip.work ? 'is-work' : ''} ${chip.today ? 'is-today' : ''}" title="${esc(chip.name)}: ${chip.work ? 'work day' : 'day off'}${chip.today ? ' (today)' : ''}" aria-label="${esc(chip.name)}: ${chip.work ? 'work day' : 'day off'}${chip.today ? ', today' : ''}">${esc(chip.letter)}</li>`).join('')}</ul><p class="career-legend">Filled = work day · ring = today (${esc(career.today.weekday)}, Lagos time)</p><p class="career-hours">${esc(career.hours)}</p></section>
      <details class="ui-details"><summary>How work works</summary><ul class="career-rules">${career.rules.map((rule) => `<li>${esc(rule)}</li>`).join('')}</ul></details>`;
  },
  bind(root, api) {
    for (const button of root.querySelectorAll('[data-career-go]')) {
      button.addEventListener('click', () => { const [venue, spot] = JSON.parse(button.dataset.careerGo); api.close(); api.goTo(venue, spot); });
    }
  },
};
