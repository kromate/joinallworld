/**
 * OWNER: career
 * Jobs app: your-job card (role, pay, next step, Go automatically, Quit) and the list of
 * career tracks with Apply / Switch.
 *
 * Everything shown comes from view.career (systems/career.js), so this file holds no rules.
 * Actions: 'apply-job' { id }, 'career.switch' { id }, 'career.quit' and 'career.auto' { on }.
 * Switching and quitting ask first, in place.
 * The panel contract is at the top of src/ui/shell.js.
 */
import './jobs.css';
import { esc, money, json, cap } from '../dom.js';

/** UI-only state: the job id whose switch is being confirmed, or 'quit'. */
let asking = null;

const OFFLINE = 'Offline: read-only until you reconnect.';

function stepButton(step) {
  if (step.kind === 'go') return `<button class="ui-button is-primary" data-jobs-go="${json([step.venue, step.spot])}">Go to work</button>`;
  if (step.kind === 'home') return `<button class="ui-button is-primary" data-jobs-go="${json(['home'])}">Go home to eat and rest</button>`;
  if (step.kind === 'start') return '<button class="ui-button is-primary" data-close>Close and start shift</button>';
  return '';
}

function mine(career, connected) {
  const lock = connected ? '' : `disabled title="${esc(OFFLINE)}"`;
  const quit = asking === 'quit'
    ? `<div class="jobs-confirm"><p>Quit ${esc(career.label)}? You lose your level and performance in it. You can apply again later and start from the first role.</p><div class="jobs-row"><button class="ui-button jobs-danger" data-action="career.quit" ${career.busy || !connected ? 'disabled' : ''}>Yes, quit</button><button class="ui-button" data-jobs-ask="">Keep my job</button></div>${career.busy ? '<p class="jobs-why">Finish or cancel your current action before quitting.</p>' : ''}</div>`
    : '<button class="ui-button" data-jobs-ask="quit">Quit job</button>';
  const auto = career.isTrack
    ? `<button class="jobs-auto" role="switch" aria-checked="${career.auto}" data-action="career.auto" data-payload="${json({ on: !career.auto })}" ${lock}><i aria-hidden="true">${career.auto ? '✓' : ''}</i><span>Go automatically</span></button><p class="jobs-note">${career.auto ? 'On: when a shift is available and you have the energy and food for it, you set off for work by yourself, once a day. You can cancel the trip.' : 'Off: you only go to work when you choose to.'}</p>`
    : '';
  return `<section class="jobs-mine" aria-label="Your job"><p class="jobs-eyebrow">YOUR JOB</p><h3>${esc(career.icon)} ${esc(career.role)}${career.isTrack ? ` · ${esc(career.label)}` : ''}</h3><p><strong>${money(career.pay)} per shift</strong>${career.isTrack ? ` · level ${esc(career.level)} of ${esc(career.levels)} · performance ${esc(career.performance)}%` : ''} · at ${esc(career.workplace.label)}</p><p class="jobs-schedule">${esc(career.schedule)}</p><p class="jobs-step">${esc(career.step.text)}</p>${stepButton(career.step)}${auto}${quit}${connected ? '' : `<p class="jobs-why">${esc(OFFLINE)}</p>`}</section>`;
}

function track(job, career, connected) {
  let control;
  if (job.current) control = '<p class="jobs-note">This is your job. Manage it in the card at the top.</p>';
  else if (job.blocked || !connected) control = `<button class="ui-button" disabled>${career.employed ? 'Switch to this job' : 'Apply'}</button><p class="jobs-why">${esc(job.blocked || OFFLINE)}</p>`;
  else if (!career.employed) control = `<button class="ui-button is-primary" data-action="apply-job" data-payload="${json({ id: job.id })}">Apply — free, hired at once</button>`;
  else if (asking === job.id) control = `<div class="jobs-confirm"><p>${esc(job.switchWarning)}</p><div class="jobs-row"><button class="ui-button is-primary" data-action="career.switch" data-payload="${json({ id: job.id })}">Confirm switch</button><button class="ui-button" data-jobs-ask="">Keep current job</button></div></div>`;
  else control = `<button class="ui-button" data-jobs-ask="${esc(job.id)}">Switch to this job</button>`;
  return `<article class="jobs-track ${job.current ? 'is-current' : ''}"><header><span class="jobs-icon" aria-hidden="true">${esc(job.icon)}</span><div><h3>${esc(job.label)} ${job.current ? '<span class="jobs-badge">Your job</span>' : ''}${job.track ? '' : '<span class="jobs-badge">Starter</span>'}</h3><p>${job.track ? `Starts as ${esc(job.entryRole)} · ` : ''}<strong>${money(job.pay)} per shift</strong></p></div></header><p>${esc(job.summary)}</p><p class="jobs-schedule">${esc(job.schedule)}</p><p class="jobs-note">${esc(job.duration)}-second shift at ${esc(job.workplace)}${job.track ? ` · promotions need ${esc(cap(job.skill))} · top role ${esc(job.topRole)}` : ' · no promotions'}</p>${control}</article>`;
}

export default {
  id: 'jobs', title: 'Jobs', icon: '💼', placement: 'phone', order: 10,
  render(state, view) {
    const career = view.career, connected = view.connected !== false;
    if (asking && asking !== 'quit' && (asking === career.id || !career.employed)) asking = null;
    if (asking === 'quit' && !career.employed) asking = null;
    const intro = career.employed ? '' : `<section class="jobs-mine" aria-label="Your job"><p class="jobs-eyebrow">NO JOB YET</p><p class="jobs-step">${esc(career.step.text)}</p></section>`;
    return `${career.employed ? mine(career, connected) : intro}<h3>Career tracks</h3><ul class="jobs-rules">${career.rules.map((rule) => `<li>${esc(rule)}</li>`).join('')}<li>Shift rules, pay above the first role and work days are original beta values.</li></ul>${career.jobs.map((job) => track(job, career, connected)).join('')}`;
  },
  bind(root, api) {
    for (const button of root.querySelectorAll('[data-jobs-ask]')) button.addEventListener('click', () => { asking = button.dataset.jobsAsk || null; api.refresh(); });
    for (const button of root.querySelectorAll('[data-jobs-go]')) {
      button.addEventListener('click', () => { const [venue, spot] = JSON.parse(button.dataset.jobsGo); api.close(); api.goTo(venue, spot); });
    }
  },
};
