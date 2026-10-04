/**
 * OWNER: quick start
 * THE LANDING SCREEN — the session gate of a new device (role 'session-gate', so it replaces the
 * nickname form of ./session.js): a name, a quick character and one Play button. Two taps at most
 * for someone who accepts the defaults (Play; a Shuffle if they want one). No traits, dream,
 * lottery or home here: those are offered later by "Make this life yours" (./onboarding.js).
 *
 *   name       prefilled with a friendly suggestion, editable; the dice suggests another. The server
 *              decides (POST /api/session: length, its text filter); a refusal comes back here with
 *              its sentence and the form as it was.
 *   character  the 3D preview (./look-ui.js) with a big Shuffle, five one-tap presets and the body
 *              toggle. "More options" opens the full creator below; it is never required.
 *   Play       sends 'jaw:quick-start' { name, look } to src/life-main.js, which opens the session and
 *              confirms the look with the 'onboarding.quick-start' action (exactly once: the action id
 *              is kept on the device until the server has answered — src/quick-start/entry.js).
 *
 * The draft is kept on the device as it is edited, so a reload in the middle of the form loses
 * nothing. Reasons it opens with (view.params.reason):
 *   'new'      no session on this device yet
 *   'expired'  the server no longer knows this device's session: ./session.js's own sheet, unchanged
 *   (none)     opened by the shell because the life is still held for its look (view.onboarding.required):
 *              the same screen, for a life whose Play never reached the server — or a life the old
 *              enforced flow left on its first step
 */
import './quick-start.css';
import { esc, mark } from '../dom.js';
import { linkWords, linkButton } from '../link.js';
import session from './session.js';
import { lookStage, lookEditor, chooseLook, lookTabClick, lookFocusBody, mountLookPreview, starterWardrobe, avatarSvg } from './look-ui.js';
import { PRESETS, presetLook, shuffleLook, withBody, nameProblem, suggestName, starterLook } from '../../quick-start/model.js';
import { quickDraft, keepDraft, keepPlay, joinTarget, track, play, firstLanding } from '../../quick-start/entry.js';
import { APPEARANCE } from '../../game/content/traits.js';

const ID = 'quick-start';
let more = false, error = '', taps = 0, landed = false, focusKey = '';

const held = (view) => view.onboarding?.required === true && view.connected;

function landing(state, view) {
  const draft = quickDraft(view.name === 'New Lagosian' ? undefined : view.name);
  const problem = view.params?.problem;
  const words = linkWords(view), invited = Boolean(joinTarget());
  const shown = error || problem?.reason || '';
  const tools = `<button type="button" class="look-tool is-main qs-shuffle" data-qs="shuffle" data-key="shuffle">${mark('game')} Shuffle</button>`;
  const presets = PRESETS.map((preset) => `<button type="button" class="qs-preset" data-qs-preset="${esc(preset.id)}" data-key="preset:${esc(preset.id)}" aria-pressed="${draft.preset === preset.id}" aria-label="${esc(preset.label)} character">${avatarSvg(preset.look, { size: 30, label: '' })}${esc(preset.label)}</button>`).join('');
  const bodies = APPEARANCE.bodies.map((body) => `<button type="button" data-qs-body="${esc(body.id)}" data-key="body:${esc(body.id)}" aria-pressed="${draft.look.body === body.id}">${esc(body.label)}</button>`).join('');
  return `<div class="qs-root" data-qs-root>
    <p class="qs-lead"><b>Jump into a Nigerian world with your friends.</b>Start playing in seconds. Build your life as you go.</p>
    ${invited ? `<p class="qs-join" role="status"><span aria-hidden="true">${mark('invite')}</span><span><strong>A friend invited you.</strong>Tap Play and you land where they are.</span></p>` : ''}
    ${words && !shown && view.link !== 'new' && view.link !== 'connecting' ? `<p class="qs-note" role="status"><span aria-hidden="true">${mark('cloud-off')}</span><span><strong>${esc(words.short)}</strong>${esc(words.why)} Your character is kept on this device.</span>${linkButton(view, 'ui-button is-small')}</p>` : ''}
    ${shown ? `<p class="qs-error" role="alert">${esc(shown)}</p>` : ''}
    ${lookStage(draft.look, { variant: 'hero', name: draft.name, tools })}
    <div class="qs-presets" role="group" aria-label="Quick characters">${presets}</div>
    <div class="qs-row"><div class="qs-body" role="group" aria-label="Body">${bodies}</div><button type="button" class="qs-more" data-qs="more" data-key="more" aria-expanded="${more}">${more ? 'Fewer options' : 'More options'}</button></div>
    ${more ? lookEditor(draft.look, { owned: starterWardrobe() }) : ''}
    <label class="qs-name">Your name<span><input name="name" data-qs-name minlength="3" maxlength="24" autocomplete="nickname" autocapitalize="words" spellcheck="false" enterkeyhint="go" value="${esc(problem?.name ?? draft.name)}"><button type="button" class="qs-dice" data-qs="dice" data-key="dice" aria-label="Suggest another name" title="Suggest another name">${mark('game')}</button></span></label>
    <div class="qs-foot"><button type="button" class="ui-button is-primary qs-play" data-qs="play" data-key="play">Play</button><p>No password, no e-mail. You can change everything later.</p></div></div>`;
}

export default {
  id: ID, title: 'Welcome to Allworld', placement: 'modal', role: 'session-gate', live: false,
  /** A life whose look the server has not confirmed is held here — unless its Play is being sent right now. */
  required(state, view) { return held(view) && !play.sending ? 'Choose your look and tap Play to start.' : null; },
  render(state, view) {
    if (view.params?.reason === 'expired') return session.render(state, view);
    return landing(state, view);
  },
  bind(root, api, params) {
    const view = api.view();
    if (params?.reason === 'expired') { session.bind(root, api); return; }
    const draft = () => quickDraft();
    // Once per device, not once per page load: a reload in the middle of the form is the same landing.
    if (!landed) { landed = true; if (!held(view) && firstLanding()) track('landed', { join: Boolean(joinTarget()) }); }
    mountLookPreview(root, draft().look, { name: draft().name });
    // Play is where the keyboard starts (Enter plays); after a tap the focus goes back to what was tapped.
    root.querySelector(`[data-key="${CSS.escape(focusKey || 'play')}"]`)?.focus({ preventScroll: true });
    const input = root.querySelector('[data-qs-name]');
    // Typing never redraws (the caret stays where it is); the draft is kept as it changes.
    input?.addEventListener('input', () => { keepDraft({ name: input.value, nameEdited: true }); });
    const go = () => {
      if (play.sending) return; // a second tap while the first is on its way
      const name = (input?.value ?? draft().name).trim(), wrong = nameProblem(name);
      taps += 1;
      if (wrong) { error = wrong; focusKey = ''; api.refresh(); root.ownerDocument.querySelector('[data-qs-name]')?.focus(); return; }
      const look = starterLook(draft().look);
      if (!look) { keepDraft({ look: presetLook(PRESETS[0].id), preset: PRESETS[0].id }); error = 'That character could not be used. Here is another — tap Play again.'; api.refresh(); return; }
      error = ''; focusKey = '';
      keepDraft({ name });
      keepPlay({ look });
      track('named', { edited: draft().nameEdited, length: name.length });
      track('quick_look_done', { shuffles: draft().shuffles, preset: draft().preset, edited: more });
      track('play_tapped', { taps });
      play.sending = true;
      api.close();
      window.dispatchEvent(new CustomEvent('jaw:quick-start', { detail: { name, look } }));
    };
    input?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); go(); } });
    root.addEventListener('click', (event) => {
      const target = event.target.closest('[data-qs],[data-qs-preset],[data-qs-body],[data-look],[data-look-tab]');
      if (!target || target.disabled) return;
      const data = target.dataset;
      if (data.qs === 'play') { go(); return; }
      taps += 1; error = '';
      focusKey = data.key || '';
      if (lookTabClick(target)) { api.refresh(); return; }
      if (data.qs === 'shuffle') {
        let next = shuffleLook(Math.random);
        for (let tries = 0; tries < 4 && JSON.stringify(next) === JSON.stringify(draft().look); tries++) next = shuffleLook(Math.random);
        keepDraft({ look: next, preset: null, shuffles: draft().shuffles + 1 }); lookFocusBody();
      } else if (data.qs === 'dice') { keepDraft({ name: suggestName(Math.random), nameEdited: false }); }
      else if (data.qs === 'more') { more = !more; }
      else if ('qsPreset' in data) { const look = presetLook(data.qsPreset); if (look) { keepDraft({ look, preset: data.qsPreset }); lookFocusBody(); } }
      else if ('qsBody' in data) { keepDraft({ look: withBody(draft().look, data.qsBody), preset: null }); lookFocusBody(); }
      else if ('look' in data) { keepDraft({ look: chooseLook(draft().look, data.look, data.value, starterWardrobe()), preset: null }); }
      api.refresh();
    });
  },
};
