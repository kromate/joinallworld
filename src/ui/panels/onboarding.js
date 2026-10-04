/**
 * OWNER: character
 * Character creation flow: Look → Personality → Dream → Birth lottery → Home.
 * Open with api.open('onboarding'); the goal chip offers it to a new life.
 *
 * Every step is confirmed by a server action (see src/game/systems/onboarding.js); this file
 * only keeps the draft being edited. The panel is not live, so a poll never wipes a draft:
 * it redraws itself by re-opening (api.open('onboarding')).
 */
import './onboarding.css';
import { esc, money, icon } from '../dom.js';
import { TRAITS, TRAITS_REQUIRED, DREAMS, ONBOARDING_STEPS, RENT_NOTE, LOTTERY_NOTE } from '../../game/content/traits.js';
import { avatarSvg, lookEditor, chooseLook } from './look-ui.js';

const ID = 'onboarding';
const LAST = ONBOARDING_STEPS.length - 1;
let draft = null, shown = 0, error = '', pending = '', focusKey = '', owner = null;

function sync(state, view) {
  const o = state.onboarding, key = `${view.session?.id ?? 'local'}:${view.cityId}`;
  if (draft && owner === key) return;
  owner = key;
  draft = { look: { ...o.look }, traits: [...o.traits], dream: o.dream, house: o.house };
  shown = Math.min(o.step, LAST);
  error = ''; pending = '';
}

const primary = (label, { action, disabled = false } = {}) => `<button type="button" class="ui-button is-primary ob-primary" data-ob="${action ?? ''}" data-key="primary" ${disabled || pending ? 'disabled' : ''}>${esc(pending || label)}</button>`;

function stepBody(state, view) {
  const o = view.onboarding, name = view.name;
  if (shown === 0) {
    return `<div class="ob-split"><div class="look-stage">${avatarSvg(draft.look, { size: 150 })}</div><div>${lookEditor(draft.look)}</div></div>
      ${primary('Next', { action: 'look' })}`;
  }
  if (shown === 1) {
    const left = TRAITS_REQUIRED - draft.traits.length;
    return `<p class="ob-lead">Choose ${TRAITS_REQUIRED} traits. Each one changes how ${esc(name)} plays.</p>
      <div class="ob-grid">${Object.values(TRAITS).map((trait) => `<button type="button" class="ob-card" data-trait="${esc(trait.id)}" data-key="trait:${esc(trait.id)}" aria-pressed="${draft.traits.includes(trait.id)}"><span class="ob-card-icon" aria-hidden="true">${trait.icon}</span><strong>${esc(trait.label)}</strong><small>${esc(trait.blurb)}</small><ul>${trait.effects.map((line) => `<li>${esc(line)}</li>`).join('')}</ul></button>`).join('')}</div>
      <p class="preview-note">Trait strengths are original beta values. Picking a third trait swaps out your first pick.</p>
      ${primary(left > 0 ? `Choose ${left} more` : 'Continue', { action: 'traits', disabled: left > 0 })}`;
  }
  if (shown === 2) {
    return `<p class="ob-lead">What is ${esc(name)}’s big dream?</p>
      <div class="ob-list">${Object.values(DREAMS).map((dream) => `<button type="button" class="ob-card is-row" data-dream="${esc(dream.id)}" data-key="dream:${esc(dream.id)}" aria-pressed="${draft.dream === dream.id}"><span class="ob-card-icon" aria-hidden="true">${dream.icon}</span><span><strong>${esc(dream.label)}</strong><small>${esc(dream.goal)}</small><small class="ob-faint">${esc(dream.measure)}</small></span></button>`).join('')}</div>
      ${primary(draft.dream ? 'Continue' : 'Choose a dream', { action: 'dream', disabled: !draft.dream })}`;
  }
  if (shown === 3) {
    const outcome = o.lottery;
    if (!outcome) {
      return `<p class="ob-lead">Everyone in this city is born into something. Roll once to find out what ${esc(name)} starts with.</p>
        <div class="ob-lottery is-waiting" aria-hidden="true">🎲</div><p class="preview-note">${esc(LOTTERY_NOTE)}</p>${primary('Roll the birth lottery', { action: 'lottery' })}`;
    }
    return `<div class="ob-lottery"><span class="ob-card-icon" aria-hidden="true">${outcome.icon}</span><h3>${esc(outcome.label)}</h3><p>${esc(outcome.tagline)}</p><ul>${outcome.bullets.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>${outcome.beta ? '<p class="preview-note">Original beta outcome.</p>' : ''}</div>
      <p class="preview-note">${esc(LOTTERY_NOTE)}</p>${primary('Choose where to live', { action: 'to-home' })}`;
  }
  const chosen = o.homes.find((home) => home.id === draft.house && !home.locked);
  return `<p class="ob-lead">Where will ${esc(name)} live? ${esc(RENT_NOTE)}</p>
    <div class="ob-list">${o.homes.map((home) => `<button type="button" class="ob-card is-row ob-home" data-house="${esc(home.id)}" data-key="house:${esc(home.id)}" aria-pressed="${draft.house === home.id && !home.locked}" ${home.locked ? 'disabled' : ''}><span class="ob-card-icon" aria-hidden="true">${home.icon}</span><span><em class="ob-tag">${esc(home.tag)}</em><strong>${esc(home.label)} · ${esc(home.district)}</strong><small>${esc(home.blurb)}</small>${home.locked
    ? `<small class="ob-locked">🔒 ${esc(home.locked)}</small>`
    : `<small class="ob-money">Start with ${money(home.startCash)} · rent ${money(home.rent)} a week</small>`}</span></button>`).join('')}</div>
    ${primary(chosen ? 'Move in' : 'Choose a home', { action: 'home', disabled: !chosen })}`;
}

export default {
  id: ID, title: 'Create your Sim', icon: '✨', placement: 'modal', live: false,
  render(state, view) {
    const o = view.onboarding;
    if (o.done) {
      draft = null;
      return `<div class="ob-root ob-done"><div class="look-stage">${avatarSvg(o.look, { size: 120 })}</div><h3>${esc(view.name)} is ready</h3><p>${o.legacy ? 'This life started before character creation existed, so nothing was changed.' : 'Your Sim has moved in.'} You can change your look any time in Sim → Profile.</p><button type="button" class="ui-button is-primary" data-open="profile">Edit look</button> <button type="button" class="ui-button" data-close>Close</button></div>`;
    }
    sync(state, view);
    const steps = ONBOARDING_STEPS.map((step, index) => `<li class="${index < o.step ? 'is-done' : ''} ${index === shown ? 'is-current' : ''}" ${index === shown ? 'aria-current="step"' : ''}><span>${esc(step.label)}</span></li>`).join('');
    const offline = view.connected ? '' : '<p class="ob-error" role="alert">You are offline. Your choices are kept here, but nothing is saved until you reconnect.</p>';
    return `<div class="ob-root"><div class="ob-head">${shown > 0 ? `<button type="button" class="sheet-back" data-ob="back" data-key="back" aria-label="Back to ${esc(ONBOARDING_STEPS[shown - 1].label)}">${icon('back')}</button>` : '<span class="ob-head-gap"></span>'}<div><strong>Step ${shown + 1} of ${ONBOARDING_STEPS.length} · ${esc(ONBOARDING_STEPS[shown].label)}</strong><ol class="ob-steps" aria-label="Progress">${steps}</ol></div>${shown === 0 ? `<button type="button" class="ui-button ob-shuffle" data-ob="shuffle" data-key="shuffle" ${pending ? `disabled title="${esc(pending)}"` : ''}>🎲 Shuffle</button>` : ''}</div>
      ${offline}${error ? `<p class="ob-error" role="alert">${esc(error)}</p>` : ''}${stepBody(state, view)}</div>`;
  },
  bind(root, api) {
    // Each redraw replaces this root, so check the document, not the (possibly detached) root.
    const redraw = () => { if (document.querySelector('.ob-root')) api.open(ID); };
    if (focusKey) root.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
    const send = async (label, type, payload, then) => {
      pending = label; error = ''; redraw();
      const result = await api.command(type, payload);
      pending = '';
      if (result.ok) then?.(); else error = result.reason || 'That could not be saved. Check your connection and try again.';
      return result;
    };
    root.addEventListener('click', async (event) => {
      const target = event.target.closest('[data-look],[data-trait],[data-dream],[data-house],[data-ob]');
      if (!target || target.disabled || !draft) return;
      focusKey = target.dataset.key || '';
      const data = target.dataset;
      if ('look' in data) draft.look = chooseLook(draft.look, data.look, data.value);
      else if ('trait' in data) {
        if (draft.traits.includes(data.trait)) draft.traits = draft.traits.filter((id) => id !== data.trait);
        else draft.traits = [...draft.traits, data.trait].slice(-TRAITS_REQUIRED);
      } else if ('dream' in data) draft.dream = data.dream;
      else if ('house' in data) draft.house = data.house;
      else if (data.ob === 'back') { shown = Math.max(0, shown - 1); error = ''; }
      else if (data.ob === 'to-home') shown = LAST;
      else if (data.ob === 'shuffle') await send('Shuffling…', 'onboarding.look', { shuffle: true }, () => { draft.look = { ...api.state().onboarding.look }; });
      else if (data.ob === 'look') await send('Saving…', 'onboarding.look', { look: draft.look }, () => { shown = 1; });
      else if (data.ob === 'traits') await send('Saving…', 'onboarding.traits', { traits: draft.traits }, () => { shown = 2; });
      else if (data.ob === 'dream') await send('Saving…', 'onboarding.dream', { dream: draft.dream }, () => { shown = 3; });
      else if (data.ob === 'lottery') await send('Rolling…', 'onboarding.lottery', {});
      else if (data.ob === 'home') {
        const result = await send('Moving in…', 'onboarding.home', { house: draft.house });
        if (result.ok) { draft = null; focusKey = ''; api.close(); api.toast(api.state().message, 'good'); return; }
      }
      redraw();
    });
  },
};
