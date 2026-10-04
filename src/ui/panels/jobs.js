/**
 * OWNER: career
 * Jobs app. It leads with your job (role, pay, days, workplace hours, next step, Go
 * automatically, Quit) or — with no job yet — the next step towards one, then "How work works"
 * (the rules, folded away), then one scannable card per job: role, pay, days, workplace hours
 * and whether it is open now, key skill, and Apply / Switch.
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

const fact = (emoji, text, tone = '') => `<li class="${tone}"><span aria-hidden="true">${emoji}</span>${esc(text)}</li>`;
/** Is this job's workplace open right now? From the same travel data the map uses; null when it cannot be told. */
function openNow(job, view) {
  const place = view.travel?.destinations?.find((item) => item.label === job.workplace);
  return place ? place.open : null;
}

function mine(career, connected) {
  const lock = connected ? '' : `disabled title="${esc(OFFLINE)}"`;
  const quit = asking === 'quit'
    ? `<div class="jobs-confirm"><p>Quit ${esc(career.label)}? You lose your level and performance in it. You can apply again later and start from the first role.</p><div class="jobs-row"><button class="ui-button jobs-danger" data-action="career.quit" ${career.busy || !connected ? 'disabled' : ''}>Yes, quit</button><button class="ui-button" data-jobs-ask="">Keep my job</button></div>${career.busy ? '<p class="jobs-why">Finish or cancel your current action before quitting.</p>' : ''}</div>`
    : '<button class="jobs-link" data-jobs-ask="quit">Quit this job</button>';
  const auto = career.isTrack
    ? `<button class="jobs-auto" role="switch" aria-checked="${career.auto}" data-action="career.auto" data-payload="${json({ on: !career.auto })}" ${lock}><i aria-hidden="true">${career.auto ? '✓' : ''}</i><span>Go automatically<small>${career.auto ? 'On: once a day you set off for work by yourself when a shift is available and you have the energy and food for it. You can cancel the trip.' : 'Off: you only go to work when you choose to.'}</small></span></button>`
    : '';
  return `<section class="jobs-mine" aria-label="Your job"><p class="jobs-eyebrow">YOUR JOB</p><header class="jobs-head"><span class="jobs-icon" aria-hidden="true">${esc(career.icon)}</span><div><h3>${esc(career.role)}</h3><p>${career.isTrack ? `${esc(career.label)} · level ${esc(career.level)} of ${esc(career.levels)}` : 'Starter job'}</p></div><b class="jobs-pay">${money(career.pay)}<small>per shift</small></b></header>
    <ul class="jobs-facts">${fact('🗓️', career.schedule)}${fact('🕘', career.hours, career.workplace.open ? 'is-open' : 'is-closed')}${career.isTrack ? fact('📈', `Performance ${career.performance}%`) : ''}</ul>
    <p class="jobs-step"><span aria-hidden="true">👉</span> ${esc(career.step.text)}</p>${stepButton(career.step)}${auto}${quit}${connected ? '' : `<p class="jobs-why">${esc(OFFLINE)}</p>`}</section>`;
}

function track(job, career, connected, view) {
  let control;
  if (job.current) control = '<p class="jobs-note">This is your job. Manage it in the card at the top.</p>';
  else if (job.blocked || !connected) control = `<button class="ui-button" disabled>${career.employed ? 'Switch to this job' : 'Apply'}</button><p class="jobs-why">${esc(job.blocked || OFFLINE)}</p>`;
  else if (!career.employed) control = `<button class="ui-button is-primary" data-action="apply-job" data-payload="${json({ id: job.id })}">Apply — free, hired at once</button>`;
  else if (asking === job.id) control = `<div class="jobs-confirm"><p>${esc(job.switchWarning)}</p><div class="jobs-row"><button class="ui-button is-primary" data-action="career.switch" data-payload="${json({ id: job.id })}">Confirm switch</button><button class="ui-button" data-jobs-ask="">Keep current job</button></div></div>`;
  else control = `<button class="ui-button" data-jobs-ask="${esc(job.id)}">Switch to this job</button>`;
  const open = openNow(job, view);
  return `<article class="jobs-track ${job.current ? 'is-current' : ''}"><header class="jobs-head"><span class="jobs-icon" aria-hidden="true">${esc(job.icon)}</span><div><h3>${esc(job.label)}${job.current ? ' <span class="jobs-badge is-mine">Your job</span>' : ''}${job.track ? '' : ' <span class="jobs-badge">Starter</span>'}</h3><p>${job.track ? `Start as ${esc(job.entryRole)}` : 'No ladder · work any day'}</p></div><b class="jobs-pay">${money(job.pay)}<small>per shift</small></b></header>
    <ul class="jobs-facts">${fact('🗓️', job.schedule)}${fact('🕘', job.hours, open === null ? '' : open ? 'is-open' : 'is-closed')}${open === null ? '' : fact(open ? '🟢' : '🌙', open ? 'Open now' : 'Closed now', open ? 'is-open' : 'is-closed')}${job.track ? fact('🎓', `Skill: ${cap(job.skill)}`) : ''}${fact('⏱️', `${job.duration}s shift`)}</ul>
    <p class="jobs-summary">${esc(job.summary)}${job.track ? ` Top role: ${esc(job.topRole)}.` : ''}</p>${control}</article>`;
}

export default {
  id: 'jobs', title: 'Jobs', icon: '💼', placement: 'phone', order: 10,
  render(state, view) {
    const career = view.career, connected = view.connected !== false;
    if (asking && asking !== 'quit' && (asking === career.id || !career.employed)) asking = null;
    if (asking === 'quit' && !career.employed) asking = null;
    // Lead with the player's job, or with the next step towards one. Workplaces that are open now come first.
    const lead = career.employed ? mine(career, connected)
      : `<section class="jobs-mine" aria-label="Your next step"><p class="jobs-eyebrow">NO JOB YET</p><p class="jobs-step"><span aria-hidden="true">👉</span> ${esc(career.step.text)}</p><p class="jobs-note">Jobs whose workplace is open right now are listed first.</p></section>`;
    const rank = (job) => (job.current ? 0 : openNow(job, view) === false ? 2 : 1);
    const jobs = career.jobs.map((job, index) => ({ job, index })).sort((a, b) => rank(a.job) - rank(b.job) || a.index - b.index).map((item) => item.job);
    const rules = `<details class="ui-details"><summary>How work works</summary><ul class="jobs-rules">${career.rules.map((rule) => `<li>${esc(rule)}</li>`).join('')}<li>Shift rules, pay above the first role and work days are original beta values.</li></ul></details>`;
    return `${lead}${rules}<h3 class="jobs-title">${career.employed ? 'Other jobs' : 'Pick a job'}</h3>${jobs.filter((job) => !job.current).map((job) => track(job, career, connected, view)).join('')}`;
  },
  bind(root, api) {
    for (const button of root.querySelectorAll('[data-jobs-ask]')) button.addEventListener('click', () => { asking = button.dataset.jobsAsk || null; api.refresh(); });
    for (const button of root.querySelectorAll('[data-jobs-go]')) {
      button.addEventListener('click', () => { const [venue, spot] = JSON.parse(button.dataset.jobsGo); api.close(); api.goTo(venue, spot); });
    }
  },
};
