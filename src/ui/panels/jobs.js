/**
 * OWNER: career
 * Jobs app: browse jobs, apply, go to work.
 *
 * Ported starter behaviour (extend freely): lists content/jobs.js, applies with the
 * 'apply-job' action, and walks the player to the workplace spot with api.goTo.
 * The panel contract is at the top of src/ui/shell.js. Styles: create ./jobs.css and import it here.
 */
import { esc, money, json, cap } from '../dom.js';
import { JOBS } from '../../game/content/jobs.js';

export default {
  id: 'jobs', title: 'Jobs', icon: '💼', placement: 'phone', order: 10,
  render(state) {
    return Object.values(JOBS).map((job) => {
      const employed = state.job === job.id, shift = job.shift;
      const needs = Object.entries(shift.minimumNeeds || {}).map(([need, minimum]) => `${cap(need)} ${minimum}+`).join(' and ');
      const uses = Object.entries(shift.effects || {}).filter(([, amount]) => amount < 0).map(([need, amount]) => `${-amount} ${cap(need)}`).join(' and ');
      return `<article class="ui-card"><h3>${esc(job.label)}</h3><p>${esc(job.summary || '')} <strong>${esc(shift.duration)} seconds · ${money(shift.reward)} per completed shift.</strong></p>${needs ? `<p>Requirements: ${esc(needs)}.${uses ? ` A completed shift uses ${esc(uses)}.` : ''}</p>` : ''}<p>${employed ? `You’re hired. Completed shifts: ${esc(state.completedShifts)}` : 'No experience required. Apply, then visit your workplace.'}</p>${employed
        ? `<button class="city-primary" data-job-go="${esc(job.id)}">Go to work</button>`
        : `<button class="city-primary" data-action="apply-job" data-payload="${json({ id: job.id })}" ${state.activeAction ? 'disabled' : ''}>Apply for this job</button>`}<p class="preview-note">${job.beta ? 'Starter beta job. ' : ''}Cancelling a shift gives no reward.</p></article>`;
    }).join('') || '<p>No jobs are listed yet.</p>';
  },
  bind(root, api) {
    root.querySelector('[data-job-go]')?.addEventListener('click', (event) => {
      const job = JOBS[event.currentTarget.dataset.jobGo];
      api.close();
      api.goTo(job.workplace.venue, job.workplace.spot);
    });
  },
};
