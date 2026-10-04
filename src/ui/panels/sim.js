/**
 * OWNER: character
 * Sim sheet tabs: Profile (the 3D preview, display name and appearance), Needs and Skills.
 * This file exports several 'sim-tab' panels; `order` fixes the tab order.
 *
 * Profile is a form, so it is not live: it keeps a draft and redraws itself by re-opening
 * (api.open('profile')). The display name is the device-session nickname, renamed through
 * POST /api/session; the look is saved with the 'onboarding.set-look' action. Needs and Skills are live.
 */
import './sim.css';
import { esc, cap, money, mark, iconFor } from '../dom.js';
import { linkWords } from '../link.js';
import { TRAITS, DREAMS, START_HOMES } from '../../game/content/traits.js';
import { lookStage, lookEditor, chooseLook, sameLook, lookSummary, lookTabClick, mountLookPreview } from './look-ui.js';

const SEGMENTS = 10;
let draft = null, saved = null, error = '', pending = false, focusKey = '';

/** Draft of the profile form; rebuilt whenever the saved name or look changes underneath it. */
function sync(state) {
  const key = JSON.stringify([state.name, state.onboarding.look]);
  if (draft && saved === key) return;
  saved = key;
  draft = { name: state.name, look: { ...state.onboarding.look } };
}
const nameProblem = (name) => (name.trim().length < 3 ? 'A display name needs at least 3 characters.' : name.trim().length > 24 ? 'A display name can be at most 24 characters.' : '');
function saveState(state, view) {
  if (!view.connected) return { disabled: true, label: `${linkWords(view).short} — cannot save right now` };
  if (pending) return { disabled: true, label: 'Saving…' };
  if (!view.onboarding.done) return { disabled: true, label: 'Finish creating your Sim first' };
  if (draft.name.trim() === state.name && sameLook(draft.look, state.onboarding.look)) return { disabled: true, label: 'No changes yet' };
  const problem = nameProblem(draft.name);
  return problem ? { disabled: true, label: problem } : { disabled: false, label: 'Save changes' };
}

const profile = {
  id: 'profile', title: 'Profile', placement: 'sim-tab', order: 10, live: false,
  render(state, view) {
    sync(state);
    const o = view.onboarding, save = saveState(state, view);
    const home = START_HOMES[o.house];
    const about = [
      o.traits.length ? `<li><b>Traits</b> ${o.traits.map((id) => `${iconFor('trait', id, TRAITS[id].icon)} ${esc(TRAITS[id].label)}`).join(' · ')}</li>` : '',
      o.dream ? `<li><b>Dream</b> ${iconFor('dream', o.dream, DREAMS[o.dream].icon)} ${esc(DREAMS[o.dream].label)}</li>` : '',
      o.lottery ? `<li><b>Born</b> ${iconFor('lottery', o.lottery.id, o.lottery.icon)} ${esc(o.lottery.label)}</li>` : '',
      `<li><b>Home</b> ${home ? `${esc(home.label)}, ${esc(home.district)}` : 'Your home'} · <button type="button" class="sim-link" data-open="houses">See houses</button></li>`,
    ].join('');
    const create = o.done ? '' : '<p class="sim-note">You have not created your Sim yet. <button type="button" class="sim-link" data-open="onboarding">Create your Sim</button></p>';
    return `<form class="sim-profile" data-profile novalidate>${create}${lookStage(draft.look, { variant: 'wide', name: state.name, caption: esc(lookSummary(draft.look)) })}<div class="sim-profile-top"><div><label class="sim-field">Display name<input name="name" maxlength="24" autocomplete="nickname" value="${esc(draft.name)}" data-key="name"></label><p class="sim-hint">${esc(view.city.name)} · shown to other players. 3–24 characters.</p><ul class="sim-about">${about}</ul></div></div>
      <h3>Appearance</h3><p class="sim-hint">Colours are free. New hairstyles, outfits and fabrics come from Phone → Boutique.</p>${lookEditor(draft.look, { owned: o.wardrobe })}
      ${error ? `<p class="sim-error" role="alert">${esc(error)}</p>` : ''}<div class="sim-save-bar"><button class="ui-button is-primary sim-save" data-save data-key="save" ${save.disabled ? 'disabled' : ''}>${esc(save.label)}</button></div></form>`;
  },
  bind(root, api) {
    const form = root.querySelector('[data-profile]');
    if (!form) return;
    const redraw = () => { if (document.querySelector('[data-profile]')) api.open('profile'); };
    if (focusKey && focusKey !== 'name') root.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    mountLookPreview(root, draft.look, { name: api.state().name });
    const button = form.querySelector('[data-save]');
    // Typing must not rebuild the form (the caret would jump), so only the save button is updated.
    form.elements.name.addEventListener('input', (event) => {
      draft.name = event.target.value;
      const save = saveState(api.state(), api.view());
      button.disabled = save.disabled; button.textContent = save.label;
    });
    form.addEventListener('click', (event) => {
      const target = event.target.closest('[data-look],[data-look-tab]');
      if (!target || target.disabled) return;
      focusKey = target.dataset.key;
      if (lookTabClick(target)) { redraw(); return; }
      draft.look = chooseLook(draft.look, target.dataset.look, target.dataset.value, api.view().onboarding.wardrobe);
      redraw();
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const state = api.state();
      if (saveState(state, api.view()).disabled) return;
      pending = true; error = ''; focusKey = 'save'; redraw();
      try {
        const name = draft.name.trim();
        if (name !== state.name) await api.fetchJson('/api/session', { method: 'POST', body: { name } });
        // Also sent when only the name changed: any action returns the state with the new name.
        const result = await api.command('onboarding.set-look', { look: draft.look });
        if (!result.ok) error = result.reason || 'Your look could not be saved. Try again.';
        else { draft = null; api.toast('Profile saved.', 'good'); }
      } catch (problem) {
        // The server's own sentence when it refused the name (wording not allowed, or the player is muted).
        error = problem?.reason ? problem.reason
          : problem?.code === 'invalid_name' ? 'That display name is not allowed. Use 3–24 ordinary characters.'
          : problem?.code === 'name_not_allowed' ? 'That display name is not allowed. Choose another one.'
          : problem?.code === 'muted' ? 'A moderator has muted you, so your display name cannot be changed right now.'
          : `Your name could not be saved: ${problem?.message || 'connection problem'}. Try again.`;
      }
      pending = false;
      redraw();
    });
  },
};

const needs = {
  id: 'needs', title: 'Needs', placement: 'sim-tab', order: 20,
  render(state, view) {
    const { mood, feelings } = view.onboarding;
    const bars = view.needs.order.map((need) => {
      const value = Math.round(state.needs[need]), level = value >= 60 ? 'high' : value >= 30 ? 'mid' : 'low';
      return `<div class="sim-need-row is-${level}"><span><i aria-hidden="true">${iconFor('need', need)}</i> ${cap(need)}</span><div role="meter" aria-label="${cap(need)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"><i style="width:${value}%"></i></div><b>${value}%</b></div>`;
    }).join('');
    const total = feelings.reduce((sum, feeling) => sum + feeling.value, 0);
    const list = feelings.map((feeling) => `<li><span><strong>${esc(feeling.label)}</strong>${feeling.line ? `<small>${esc(feeling.line)}</small>` : ''}</span><b class="${feeling.value < 0 ? 'is-bad' : 'is-good'}">${feeling.value < 0 ? '−' : '+'}${Math.abs(feeling.value)}</b></li>`).join('');
    return `<div class="sim-needs"><p class="sim-mood is-${esc(mood.tone)}"><span aria-hidden="true">${iconFor('mood', mood.tone, mood.icon)}</span> <strong>${esc(mood.word)}</strong><small>Mood score ${mood.score} of 100</small></p>${bars}
      <h3>Feelings</h3>${list ? `<ul class="sim-feelings">${list}</ul><p class="sim-hint">Feelings add ${total < 0 ? '−' : '+'}${Math.abs(total)} to your mood.</p>` : '<p class="sim-hint">Nothing in particular right now. Low needs and big moments show up here.</p>'}
      <p class="preview-note">Mood is the average of the six needs plus your feelings. The word thresholds (Very Happy 78, Happy 62, Fine 45, Uneasy 25) are original beta values. Needs fall slowly over real time and never below 10 on their own.</p></div>`;
  },
};

const skills = {
  id: 'skills', title: 'Skills', placement: 'sim-tab', order: 40,
  render(state, view) {
    const rows = Object.entries(view.skills).map(([skill, info]) => {
      const segments = Array.from({ length: SEGMENTS }, (_, index) => {
        const fill = index < info.level ? 100 : index === info.level ? Math.round(info.progress * 100) : 0;
        return `<i><b style="width:${fill}%"></b></i>`;
      }).join('');
      const detail = info.next === null ? 'Maxed out' : `${Math.round(info.progress * 100)}% to level ${info.level + 1}`;
      return `<div class="sim-skill"><span><strong>${cap(skill)}</strong><small>Level ${info.level}/${SEGMENTS} · ${detail}</small></span><div class="sim-segments" role="meter" aria-label="${cap(skill)} level" aria-valuemin="0" aria-valuemax="${SEGMENTS}" aria-valuenow="${info.level}" aria-valuetext="Level ${info.level} of ${SEGMENTS}, ${detail}">${segments}</div></div>`;
    }).join('');
    return `<div class="sim-skills">${rows}<p class="preview-note">Skills grow by doing related activities. Traits, your birth lottery outcome and perks change how fast.</p></div>`;
  },
};

export default [profile, needs, skills];
