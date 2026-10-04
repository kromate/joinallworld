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
import { how, rules as ruleList, bindHow } from '../phone/how.js';
import { esc, money, json, cap, chevron, mark, iconFor } from '../dom.js';
import { linkWords } from '../link.js';

/** UI-only state: the job id whose switch is being confirmed, or 'quit'. */
let asking = null;

/** Why nothing can change while the game is not connected, in the words of the real state (src/ui/link.js); set on each render. */
let OFFLINE = '';

function stepButton(step, shift, connected) {
  if (step.kind === 'go') return `<button class="ui-button is-primary" data-jobs-go="${json([step.venue, step.spot])}">Go to work</button>`;
  if (step.kind === 'home') return `<button class="ui-button is-primary" data-jobs-go="${json(['home'])}">Go home to eat and rest</button>`;
  // The button starts the shift itself (it used to only close the sheet, leaving the player to find the activity).
  if (step.kind === 'start' && shift) return `<button class="ui-button is-primary" data-action="activity" data-payload="${json({ id: shift.id })}" data-then="close" ${connected ? '' : 'disabled'}>Start shift</button>`;
  return '';
}

const fact = (icon, text, tone = '') => `<li class="${tone}"><span aria-hidden="true">${mark(icon)}</span>${esc(text)}</li>`;
/** Is this job's workplace open right now? The career view says so itself (`venue` is null while the workplace is not in this build). */
const openNow = (job) => (job.venue ? job.openNow : null);

function mine(career, connected) {
  const lock = connected ? '' : `disabled title="${esc(OFFLINE)}"`;
  const quit = asking === 'quit'
    ? `<div class="ui-confirm"><p>Quit ${esc(career.label)}? You lose your level and performance in it. You can apply again later and start from the first role.</p><div><button class="ui-button is-danger" data-action="career.quit" ${career.busy || !connected ? 'disabled' : ''}>Yes, quit</button><button class="ui-button" data-jobs-ask="">Keep my job</button></div>${career.busy ? '<p class="ui-why">Finish or cancel your current action before quitting.</p>' : ''}</div>`
    : '<button class="jobs-link" data-jobs-ask="quit">Quit this job</button>';
  const auto = career.isTrack
    ? `<button class="jobs-auto" role="switch" aria-checked="${career.auto}" data-action="career.auto" data-payload="${json({ on: !career.auto })}" ${lock}><i class="ui-switch" aria-hidden="true"></i><span>Go automatically<small>${career.auto ? 'On: you leave for work by yourself once a day. You can cancel the trip.' : 'Off: you only go to work when you choose to.'}</small></span></button>`
    : '';
  return `<section class="jobs-mine" aria-label="Your job"><p class="jobs-eyebrow">Your job</p><header class="jobs-head"><span class="jobs-icon" aria-hidden="true">${iconFor('track', career.id, career.icon)}</span><div><h3>${esc(career.role)}</h3><p>${career.isTrack ? `${esc(career.label)} · level ${esc(career.level)} of ${esc(career.levels)}` : 'Starter job'}</p></div><b class="jobs-pay">${money(career.pay)}<small>per shift</small></b></header>
    <ul class="jobs-facts">${fact('calendar', career.schedule)}${fact('clock', career.hours, career.workplace.open ? 'is-open' : 'is-closed')}${career.isTrack ? fact('invest', `Performance ${career.performance}%`) : ''}</ul>
    <p class="jobs-step">${esc(career.step.text)}</p>${stepButton(career.step, career.shift, connected)}${connected ? '' : `<p class="ui-why">${esc(OFFLINE)}</p>`}</section>
    <div class="ui-rows"><button class="ui-row" data-open="career"><span class="ui-row-icon" aria-hidden="true">${mark('career')}</span><span class="ui-row-body"><b>Career progress</b><small>${career.isTrack ? `Performance ${esc(career.performance)}% · work days and promotion` : 'Work days and today’s shift'}</small></span><span class="ui-row-end">${chevron()}</span></button>${auto ? `<div class="ui-row jobs-auto-row">${auto}</div>` : ''}</div>${quit}`;
}

function track(job, career, connected, view) {
  let control;
  if (job.current) control = '<p class="jobs-note">This is your job. Manage it in the card at the top.</p>';
  else if (job.blocked || !connected) control = `<button class="ui-button" disabled>${career.employed ? 'Switch to this job' : 'Apply'}</button><p class="ui-why">${esc(job.blocked || OFFLINE)}</p>`;
  else if (!career.employed) control = `<button class="ui-button is-primary" data-action="apply-job" data-payload="${json({ id: job.id })}">Apply — free, hired at once</button>`;
  else if (asking === job.id) control = `<div class="ui-confirm"><p>${esc(job.switchWarning)}</p><div><button class="ui-button is-primary" data-action="career.switch" data-payload="${json({ id: job.id })}">Confirm switch</button><button class="ui-button" data-jobs-ask="">Keep current job</button></div></div>`;
  else control = `<button class="ui-button" data-jobs-ask="${esc(job.id)}">Switch to this job</button>`;
  const open = openNow(job);
  return `<article class="jobs-track ${job.current ? 'is-current' : ''}"><header class="jobs-head"><span class="jobs-icon" aria-hidden="true">${iconFor('track', job.id, job.icon)}</span><div><h3>${esc(job.label)}${job.current ? ' <span class="jobs-badge is-mine">Your job</span>' : ''}${job.track ? '' : ' <span class="jobs-badge">Starter</span>'}</h3><p>${job.track ? `Start as ${esc(job.entryRole)}` : 'No ladder · work any day'}</p></div><b class="jobs-pay">${money(job.pay)}<small>per shift</small></b></header>
    <ul class="jobs-facts">${fact('calendar', job.schedule)}${fact('clock', job.hours, open === null ? '' : open ? 'is-open' : 'is-closed')}${open === null ? '' : fact(open ? 'good' : 'moon', open ? 'Open now' : 'Closed now', open ? 'is-open' : 'is-closed')}${job.track ? fact('book', `Skill: ${cap(job.skill)}`) : ''}${fact('clock', `${job.duration}s shift`)}</ul>
    <p class="jobs-summary">${esc(job.summary)}${job.track ? ` Top role: ${esc(job.topRole)}.` : ''}</p>${control}</article>`;
}

export default {
  id: 'jobs', title: 'Jobs', placement: 'phone', order: 10,
  render(state, view) {
    const career = view.career, connected = view.connected !== false;
    OFFLINE = connected ? '' : `${linkWords(view).why} Read-only until that is resolved.`;
    if (asking && asking !== 'quit' && (asking === career.id || !career.employed)) asking = null;
    if (asking === 'quit' && !career.employed) asking = null;
    // Lead with the player's job, or with the next step towards one. Workplaces that are open now come first.
    const lead = career.employed ? mine(career, connected)
      : `<section class="ui-hero" aria-label="Your next step"><small>No job yet</small><strong>Find work today</strong><p>${esc(career.step.text)}</p></section>`;
    const rank = (job) => (job.current ? 0 : openNow(job) === false ? 2 : 1);
    const jobs = career.jobs.map((job, index) => ({ job, index })).sort((a, b) => rank(a.job) - rank(b.job) || a.index - b.index).map((item) => item.job);
    const rules = how('jobs-rules', ruleList([...career.rules, 'Jobs whose workplace is open right now are listed first.', 'Go automatically (track jobs): once a day you set off for work by yourself when a shift is available and you have the energy and food for it. You can cancel the trip.', 'Shift rules, pay above the first role and work days are original beta values.']), 'How work works', true);
    return `${lead}${rules}<h3 class="ui-section">${career.employed ? 'Other jobs' : 'Pick a job'}</h3><div class="jobs-list">${jobs.filter((job) => !job.current).map((job) => track(job, career, connected, view)).join('')}</div>`;
  },
  bind(root, api) {
    bindHow(root, api);
    for (const button of root.querySelectorAll('[data-jobs-ask]')) button.addEventListener('click', () => { asking = button.dataset.jobsAsk || null; api.refresh(); });
    for (const button of root.querySelectorAll('[data-jobs-go]')) {
      button.addEventListener('click', () => { const [venue, spot] = JSON.parse(button.dataset.jobsGo); api.close(); api.goTo(venue, spot); });
    }
  },
};
