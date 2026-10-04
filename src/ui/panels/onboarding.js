/**
 * OWNER: character
 * Character creation flow: Look → Personality → Dream → Birth lottery → Home.
 * Open with api.open('onboarding'); the goal chip offers it to a new life. For a life the server
 * marks as required (view.onboarding.required) the shell opens it by itself and it cannot be
 * dismissed until the Sim has moved in; a life that predates character creation never sees it.
 *
 * Every step is confirmed by a server action (see src/game/systems/onboarding.js); this file
 * only keeps the draft being edited. The panel is not live, so a poll never wipes a draft:
 * it redraws itself by re-opening (api.open('onboarding')).
 *
 * The Sim is on screen through the whole flow: the Look step is a character creator (a large 3D
 * preview with Shuffle and Undo, option tabs beside it — under it on a phone, where the preview
 * stays pinned), and the later steps keep a small preview beside their choices. Styles sold only in
 * the Boutique are shown locked. Shuffle is done here, from the same option lists the server validates; the look reaches the server with
 * "Next". The look being edited is also kept in localStorage, so it survives a reload or a spell
 * offline and is saved when the step is confirmed.
 */
import './onboarding.css';
import { esc, money, icon } from '../dom.js';
import { TRAITS, TRAITS_REQUIRED, DREAMS, ONBOARDING_STEPS, RENT_NOTE, LOTTERY_NOTE } from '../../game/content/traits.js';
import { APPEARANCE } from '../../game/content/traits.js';
import { lookStage, lookEditor, chooseLook, lookSummary, lookTabClick, lookFocusBody, mountLookPreview, randomLook, sameLook, starterWardrobe, hairOptions, outfitOptions } from './look-ui.js';

const ID = 'onboarding';
const LAST = ONBOARDING_STEPS.length - 1;
const DRAFT_KEY = 'joinallworld-look-draft';
let draft = null, shown = 0, error = '', pending = '', focusKey = '', owner = null, undo = null;

/** The look kept on this device for `key`, if every part of it is still a valid choice. */
function storedLook(key) {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(DRAFT_KEY) || 'null');
    const look = saved?.owner === key ? saved.look : null;
    if (!look || !APPEARANCE.bodies.some((body) => body.id === look.body)) return null;
    const has = (group, id) => APPEARANCE[group].some((swatch) => swatch.id === id);
    const free = starterWardrobe(), extras = Array.isArray(look.accessories) ? look.accessories : [];
    const valid = hairOptions(look.body).includes(look.hair) && free.hair.includes(look.hair) && outfitOptions(look.body).includes(look.outfit) && free.outfit.includes(look.outfit) && APPEARANCE.fabrics.includes(look.fabric)
      && has('skin', look.skin) && has('hairColours', look.hairColor) && has('outfitColours', look.outfitColor) && has('outfitColours', look.bottomsColor)
      && extras.length <= APPEARANCE.accessoryLimit && extras.every((id) => free.accessories.includes(id)) && new Set(extras.map((id) => APPEARANCE.accessories.find((item) => item.id === id).slot)).size === extras.length;
    return valid ? { body: look.body, hair: look.hair, outfit: look.outfit, fabric: look.fabric, skin: look.skin, hairColor: look.hairColor, outfitColor: look.outfitColor, bottomsColor: look.bottomsColor,
      accessories: [...extras], face: APPEARANCE.faces.includes(look.face) ? look.face : APPEARANCE.faces[0], expression: APPEARANCE.expressions.includes(look.expression) ? look.expression : APPEARANCE.expressions[0] } : null;
  } catch { return null; }
}
function storeLook(look) {
  try { if (look) globalThis.localStorage?.setItem(DRAFT_KEY, JSON.stringify({ owner, look })); else globalThis.localStorage?.removeItem(DRAFT_KEY); } catch { /* storage is off: the draft still lives in memory */ }
}

function sync(state, view) {
  const o = state.onboarding, key = `${view.session?.id ?? 'local'}:${view.cityId}`;
  if (draft && owner === key) return;
  owner = key;
  draft = { look: (o.step === 0 && storedLook(key)) || { ...o.look }, traits: [...o.traits], dream: o.dream, house: o.house };
  shown = Math.min(o.step, LAST);
  error = ''; pending = ''; undo = null;
}

/** The step's one primary action, in a footer that stays at the bottom of the sheet with its own background, so it never sits on top of an option. `why` says what is still missing. */
const primary = (label, { action, disabled = false, why = '' } = {}) => `<div class="ob-foot">${why && !pending ? `<p class="ob-foot-why">${esc(why)}</p>` : ''}<button type="button" class="ui-button is-primary ob-primary" data-ob="${action ?? ''}" data-key="primary" ${disabled || pending ? 'disabled' : ''}>${esc(pending || label)}</button></div>`;

/** The Sim beside a later step: a small preview with the name and what they wear. */
const withSim = (view, body) => `<div class="ob-with-sim"><aside class="ob-sim">${lookStage(draft.look, { variant: 'mini', name: view.name })}<p><strong>${esc(view.name)}</strong><small>${esc(lookSummary(draft.look))}</small></p></aside><div class="ob-step">${body}</div></div>`;

/** Returns [the step's content, its footer]. */
function stepBody(state, view) {
  const o = view.onboarding, name = view.name;
  if (shown === 0) {
    const tools = `<button type="button" class="look-tool" data-ob="undo" data-key="undo" ${undo && !pending ? '' : 'disabled'} aria-label="Undo the last shuffle">↶ Undo</button><button type="button" class="look-tool is-main" data-ob="shuffle" data-key="shuffle" ${pending ? 'disabled' : ''}>🎲 Shuffle</button>`;
    return [`<div class="ob-creator"><div class="ob-hero">${lookStage(draft.look, { variant: 'hero', name, tools, caption: esc(lookSummary(draft.look)) })}</div><div class="ob-options">${lookEditor(draft.look, { owned: starterWardrobe() })}</div></div>`,
      primary('Looks good — next: personality', { action: 'look', why: view.connected ? 'Still to choose: 2 traits, a dream, the birth lottery and a home.' : 'Offline: your look is kept on this device and is saved when you reconnect.' })];
  }
  if (shown === 1) {
    const left = TRAITS_REQUIRED - draft.traits.length;
    return [withSim(view, `<p class="ob-lead">Choose ${TRAITS_REQUIRED} traits. Each one changes how ${esc(name)} plays.</p>
      <div class="ob-grid">${Object.values(TRAITS).map((trait) => `<button type="button" class="ob-card" data-trait="${esc(trait.id)}" data-key="trait:${esc(trait.id)}" aria-pressed="${draft.traits.includes(trait.id)}"><span class="ob-card-icon" aria-hidden="true">${trait.icon}</span><strong>${esc(trait.label)}</strong><small>${esc(trait.blurb)}</small><ul>${trait.effects.map((line) => `<li>${esc(line)}</li>`).join('')}</ul></button>`).join('')}</div>
      <p class="preview-note">Trait strengths are original beta values. Picking a third trait swaps out your first pick.</p>`),
      primary(left > 0 ? `Choose ${left} more` : 'Next: your dream', { action: 'traits', disabled: left > 0, why: left > 0 ? `${draft.traits.length} of ${TRAITS_REQUIRED} traits chosen.` : '' })];
  }
  if (shown === 2) {
    return [withSim(view, `<p class="ob-lead">What is ${esc(name)}’s big dream?</p>
      <div class="ob-list">${Object.values(DREAMS).map((dream) => `<button type="button" class="ob-card is-row" data-dream="${esc(dream.id)}" data-key="dream:${esc(dream.id)}" aria-pressed="${draft.dream === dream.id}"><span class="ob-card-icon" aria-hidden="true">${dream.icon}</span><span><strong>${esc(dream.label)}</strong><small>${esc(dream.goal)}</small><small class="ob-faint">${esc(dream.measure)}</small></span></button>`).join('')}</div>`),
      primary(draft.dream ? 'Next: birth lottery' : 'Choose a dream', { action: 'dream', disabled: !draft.dream, why: draft.dream ? '' : 'Tap one of the dreams above to continue.' })];
  }
  if (shown === 3) {
    const outcome = o.lottery;
    if (!outcome) {
      return [withSim(view, `<p class="ob-lead">Everyone in this city is born into something. Roll once to find out what ${esc(name)} starts with.</p>
        <div class="ob-lottery is-waiting" aria-hidden="true">🎲</div><p class="preview-note">${esc(LOTTERY_NOTE)}</p>`), primary('Roll the birth lottery', { action: 'lottery' })];
    }
    return [withSim(view, `<div class="ob-lottery"><span class="ob-card-icon" aria-hidden="true">${outcome.icon}</span><h3>${esc(outcome.label)}</h3><p>${esc(outcome.tagline)}</p><ul>${outcome.bullets.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>${outcome.beta ? '<p class="preview-note">Original beta outcome.</p>' : ''}</div>
      <p class="preview-note">${esc(LOTTERY_NOTE)}</p>`), primary('Choose where to live', { action: 'to-home' })];
  }
  const chosen = o.homes.find((home) => home.id === draft.house && !home.locked);
  return [withSim(view, `<p class="ob-lead">Where will ${esc(name)} live? ${esc(RENT_NOTE)}</p>
    <div class="ob-list">${o.homes.map((home) => `<button type="button" class="ob-card is-row ob-home" data-house="${esc(home.id)}" data-key="house:${esc(home.id)}" aria-pressed="${draft.house === home.id && !home.locked}" ${home.locked ? 'disabled' : ''}><span class="ob-card-icon" aria-hidden="true">${home.icon}</span><span><em class="ob-tag">${esc(home.tag)}</em><strong>${esc(home.label)} · ${esc(home.district)}</strong><small>${esc(home.blurb)}</small>${home.locked
    ? `<small class="ob-locked">🔒 ${esc(home.locked)}</small>`
    : `<small class="ob-money">Start with ${money(home.startCash)} · rent ${money(home.rent)} a week</small>`}</span></button>`).join('')}</div>`),
    primary(chosen ? `Move in to ${chosen.label}` : 'Choose a home', { action: 'home', disabled: !chosen, why: chosen ? '' : 'Tap one of the homes above to continue.' })];
}

export default {
  id: ID, title: 'Create your Sim', icon: '✨', placement: 'modal', live: false,
  /** A brand-new life must be created before anything else: the shell opens this by itself and keeps it open. */
  required(state, view) { return view.onboarding?.required ? 'Finish creating your Sim to start playing. This cannot be skipped, and nothing else works until you have moved in.' : null; },
  render(state, view) {
    const o = view.onboarding;
    if (o.done) {
      draft = null;
      return `<div class="ob-root ob-done">${lookStage(o.look, { variant: 'wide', name: view.name })}<h3>${esc(view.name)} is ready</h3><p>${o.legacy ? 'This life started before character creation existed, so nothing was changed.' : 'Your Sim has moved in.'} You can change your look any time in Sim → Profile.</p><button type="button" class="ui-button is-primary" data-open="profile">Edit look</button> <button type="button" class="ui-button" data-close>Close</button></div>`;
    }
    sync(state, view);
    // Every step is numbered and named; finished ones are ticked and the current one is spelled out.
    const steps = ONBOARDING_STEPS.map((step, index) => `<li class="${index < o.step ? 'is-done' : ''} ${index === shown ? 'is-current' : ''}" ${index === shown ? 'aria-current="step"' : ''}><i aria-hidden="true">${index < o.step && index !== shown ? '✓' : index + 1}</i><span>${esc(step.label)}</span></li>`).join('');
    const offline = view.connected ? '' : '<p class="ob-note" role="status"><span aria-hidden="true">📴</span><span><strong>You are offline — keep going.</strong> Your choices are kept on this device and are saved as soon as you reconnect.</span></p>';
    const [content, footer] = stepBody(state, view);
    return `<div class="ob-root" data-step="${shown}"><div class="ob-head">${shown > 0 ? `<button type="button" class="sheet-back" data-ob="back" data-key="back" aria-label="Back to ${esc(ONBOARDING_STEPS[shown - 1].label)}">${icon('back')}</button>` : ''}<div class="ob-head-main"><strong>Step ${shown + 1} of ${ONBOARDING_STEPS.length} · ${esc(ONBOARDING_STEPS[shown].label)}</strong><ol class="ob-steps" aria-label="Progress">${steps}</ol></div></div>
      ${offline}${error ? `<p class="ob-error" role="alert">${esc(error)}</p>` : ''}${content}${footer}</div>`;
  },
  bind(root, api) {
    // Each redraw replaces this root, so check the document, not the (possibly detached) root.
    const redraw = () => { if (document.querySelector('.ob-root')) api.open(ID); };
    if (focusKey) root.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    mountLookPreview(root, draft?.look ?? api.view().onboarding.look, { name: api.view().name });
    const send = async (label, type, payload, then) => {
      pending = label; error = ''; redraw();
      const result = await api.command(type, payload);
      pending = '';
      if (result.ok) then?.();
      else error = result.code === 'offline' || !api.view().connected ? 'You are still offline, so this step cannot be saved yet. Nothing is lost — try again when you are back online.' : result.reason || 'That could not be saved. Check your connection and try again.';
      return result;
    };
    root.addEventListener('click', async (event) => {
      const target = event.target.closest('[data-look],[data-look-tab],[data-trait],[data-dream],[data-house],[data-ob]');
      if (!target || target.disabled || !draft) return;
      focusKey = target.dataset.key || '';
      const data = target.dataset;
      if (lookTabClick(target)) { redraw(); return; }
      if ('look' in data) { draft.look = chooseLook(draft.look, data.look, data.value, starterWardrobe()); storeLook(draft.look); }
      else if ('trait' in data) {
        if (draft.traits.includes(data.trait)) draft.traits = draft.traits.filter((id) => id !== data.trait);
        else draft.traits = [...draft.traits, data.trait].slice(-TRAITS_REQUIRED);
      } else if ('dream' in data) draft.dream = data.dream;
      else if ('house' in data) draft.house = data.house;
      else if (data.ob === 'back') { shown = Math.max(0, shown - 1); error = ''; }
      else if (data.ob === 'to-home') shown = LAST;
      else if (data.ob === 'shuffle') {
        // Picked here, from the lists the server validates; never the same look twice in a row.
        let next = randomLook();
        for (let tries = 0; tries < 4 && sameLook(next, draft.look); tries++) next = randomLook();
        undo = draft.look; draft.look = next; storeLook(next); lookFocusBody();
      } else if (data.ob === 'undo') { if (undo) { draft.look = undo; undo = null; storeLook(draft.look); lookFocusBody(); focusKey = 'shuffle'; } }
      else if (data.ob === 'look') await send('Saving…', 'onboarding.look', { look: draft.look }, () => { shown = 1; undo = null; storeLook(null); });
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
