/**
 * OWNER: character
 * "MAKE THIS LIFE YOURS" — settling in: Personality → Dream → Birth lottery → Home, as short cards.
 * It is OFFERED, never forced: a guest of the quick start (./quick-start.js) is already playing, and
 * this sheet opens after their first reward, from the "Settle in" goal, and when they tap Home or
 * Buy (the shell opens it with params.why). Every card has "Not now": the sheet closes, play goes
 * on, and it resumes at the same card next time because each step is saved by the server. Nothing
 * earned before settling in is lost; moving in is what creates the home, the rent and the start cash.
 * params: { nudge?: 'first-reward' | 'third-activity' | 'next-day', why?: 'home' | 'buy' }.
 *
 * A life that never was a guest and has no character yet (view.onboarding.guest false, done false)
 * gets the same sheet with the Look step in front, as before. A life that predates character
 * creation never sees it.
 *
 * THE HOME CARD HAS A SLOT. `HOME_EXTRAS` (exported below) is a list other owners add a section to —
 * the local-government choice, say — without editing this file's flow:
 *   HOME_EXTRAS.push({
 *     id: 'area',
 *     render(state, view, draft) → html      drawn under the homes; escape everything; use data-extra="<id>"
 *                                            on its buttons and keep its own choice in draft.extra[id]
 *     click(target, draft, { api, redraw }) → boolean   a click inside it; return true when it changed the draft
 *     bind?(root, api, draft, redraw)        after each draw, for anything that is not a click (a <select>)
 *     done?(draft)                           the move-in was accepted with its payload
 *     ready(draft) → null | 'what is missing'   the Move in button stays off, with this sentence, until null
 *     payload(draft) → object                merged into the 'onboarding.home' payload ({ house, stay, … });
 *                                            the server-side rule that reads it is the adding owner's
 *   });
 * Sections are drawn in list order. The local-government choice (./lga-card.js lgaHomeExtra) is registered by the group
 * module (./groups/start.js).
 *
 * THE HOME A NEW LIFE GETS is its own: the free starter house on a plot in the local government it chooses here — no weekly
 * rent — with the start cash of its birth lottery. The rented homes (Mushin, Yaba, Lekki…) are not offered on this card: they
 * are the Houses app's alternative, for after moving in. The rule is 'onboarding.home' { lga, via } (systems/onboarding.js).
 *
 * Every step is confirmed by a server action (see src/game/systems/onboarding.js); this file
 * only keeps the draft being edited. The panel is not live, so a poll never wipes a draft:
 * it redraws itself with api.refresh().
 *
 * The Sim is on screen through the whole flow: the Look step is a character creator (a large 3D
 * preview with Shuffle and Undo, option tabs beside it — under it on a phone, where the preview
 * stays pinned), and the later steps keep a small preview beside their choices. Styles sold only in
 * the Boutique are shown locked. Shuffle is done here, from the same option lists the server validates; the look reaches the server with
 * "Next". The look being edited is also kept in localStorage, so it survives a reload or a spell
 * offline and is saved when the step is confirmed.
 */
import './onboarding.css';
import { esc, money, icon, mark, iconFor } from '../dom.js';
import { linkWords, linkButton } from '../link.js';
import { TRAITS, TRAITS_REQUIRED, DREAMS, DREAM_REWARD, ONBOARDING_STEPS, LOTTERY_NOTE } from '../../game/content/traits.js';
import { APPEARANCE } from '../../game/content/traits.js';
import { track } from '../../quick-start/entry.js';
import { lookStage, lookEditor, chooseLook, lookSummary, lookTabClick, lookFocusBody, mountLookPreview, randomLook, sameLook, starterWardrobe, hairOptions, outfitOptions } from './look-ui.js';

const ID = 'onboarding';
const LAST = ONBOARDING_STEPS.length - 1;
const DRAFT_KEY = 'joinallworld-look-draft';
let draft = null, shown = 0, error = '', pending = '', focusKey = '', owner = null, undo = null, offered = false;
/** Extra sections of the Home card, added by other owners (see the header). */
export const HOME_EXTRAS = [];
/** The first card a life sees: a guest's look is already chosen. */
const firstStep = (view) => (view.onboarding.guest ? 1 : 0);

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
  draft = { look: (o.step === 0 && storedLook(key)) || { ...o.look }, traits: [...o.traits], dream: o.dream, house: o.house, extra: {} };
  shown = Math.max(firstStep(view), Math.min(o.step, LAST));
  error = ''; pending = ''; undo = null;
}

/** The step's one primary action, in a footer that stays at the bottom of the sheet with its own background, so it never sits on top of an option. `why` says what is still missing. */
const primary = (label, { action, disabled = false, why = '', also = '' } = {}) => `<div class="ob-foot">${why && !pending ? `<p class="ob-foot-why">${esc(why)}</p>` : ''}<button type="button" class="ui-button is-primary ob-primary" data-ob="${action ?? ''}" data-key="primary" ${disabled || pending ? 'disabled' : ''}>${esc(pending || label)}</button>${also}${later}</div>`;
/** "Not now": on every card of a guest's sheet. Set per render. */
let later = '';

/** The Sim beside a later step: a small preview with the name and what they wear. */
const withSim = (view, body) => `<div class="ob-with-sim"><aside class="ob-sim">${lookStage(draft.look, { variant: 'mini', name: view.name })}<p><strong>${esc(view.name)}</strong><small>${esc(lookSummary(draft.look))}</small></p></aside><div class="ob-step">${body}</div></div>`;

/** Returns [the step's content, its footer]. */
function stepBody(state, view) {
  const o = view.onboarding, name = view.name;
  if (shown === 0) {
    const tools = `<button type="button" class="look-tool" data-ob="undo" data-key="undo" ${undo && !pending ? '' : 'disabled'} aria-label="Undo the last shuffle">↶ Undo</button><button type="button" class="look-tool is-main" data-ob="shuffle" data-key="shuffle" ${pending ? 'disabled' : ''}>${mark('game')} Shuffle</button>`;
    return [`<div class="ob-creator"><div class="ob-hero">${lookStage(draft.look, { variant: 'hero', name, tools, caption: esc(lookSummary(draft.look)) })}</div><div class="ob-options">${lookEditor(draft.look, { owned: starterWardrobe() })}</div></div>`,
      primary('Looks good — next: personality', { action: 'look', why: view.connected ? 'Still to choose: 2 traits, a dream, the birth lottery and a home.' : `${linkWords(view)?.short || 'Not connected'}: your look is kept on this device and is saved when you are connected again.` })];
  }
  if (shown === 1) {
    const left = TRAITS_REQUIRED - draft.traits.length;
    return [withSim(view, `<p class="ob-lead"><b>Pick ${TRAITS_REQUIRED} traits — each one is a boost.</b> They change how ${esc(name)} plays from the moment you move in.</p>
      <div class="ob-grid">${Object.values(TRAITS).map((trait) => `<button type="button" class="ob-card" data-trait="${esc(trait.id)}" data-key="trait:${esc(trait.id)}" aria-pressed="${draft.traits.includes(trait.id)}"><span class="ob-card-icon" aria-hidden="true">${iconFor('trait', trait.id, trait.icon)}</span><strong>${esc(trait.label)}</strong><small>${esc(trait.blurb)}</small><ul>${trait.effects.map((line) => `<li>${esc(line)}</li>`).join('')}</ul></button>`).join('')}</div>
      <p class="preview-note">Trait strengths are original beta values. Picking a third trait swaps out your first pick.</p>`),
      primary(left > 0 ? `Choose ${left} more` : 'Next: your dream', { action: 'traits', disabled: left > 0, why: left > 0 ? `${draft.traits.length} of ${TRAITS_REQUIRED} traits chosen.` : '' })];
  }
  if (shown === 2) {
    return [withSim(view, `<p class="ob-lead"><b>Choose a dream — reaching it pays ${money(DREAM_REWARD.cash)} and ${DREAM_REWARD.stars} stars.</b> What is ${esc(name)}’s big dream?</p>
      <div class="ob-list">${Object.values(DREAMS).map((dream) => `<button type="button" class="ob-card is-row" data-dream="${esc(dream.id)}" data-key="dream:${esc(dream.id)}" aria-pressed="${draft.dream === dream.id}"><span class="ob-card-icon" aria-hidden="true">${iconFor('dream', dream.id, dream.icon)}</span><span><strong>${esc(dream.label)}</strong><small>${esc(dream.goal)}</small><small class="ob-faint">${esc(dream.measure)}</small></span></button>`).join('')}</div>`),
      primary(draft.dream ? 'Next: birth lottery' : 'Choose a dream', { action: 'dream', disabled: !draft.dream, why: draft.dream ? '' : 'Tap one of the dreams above to continue.' })];
  }
  if (shown === 3) {
    const outcome = o.lottery;
    if (!outcome) {
      return [withSim(view, `<p class="ob-lead"><b>Roll the birth lottery — it decides your start cash.</b> Everyone in this city is born into something. Roll once to find out what ${esc(name)} starts with.</p>
        <div class="ob-lottery is-waiting" aria-hidden="true">${mark('game')}</div><p class="preview-note">${esc(LOTTERY_NOTE)}</p>`), primary('Roll the birth lottery', { action: 'lottery' })];
    }
    return [withSim(view, `<div class="ob-lottery"><span class="ob-card-icon" aria-hidden="true">${iconFor('lottery', outcome.id, outcome.icon)}</span><h3>${esc(outcome.label)}</h3><p>${esc(outcome.tagline)}</p><ul>${outcome.bullets.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>${outcome.beta ? '<p class="preview-note">Original beta outcome.</p>' : ''}</div>
      <p class="preview-note">${esc(LOTTERY_NOTE)}</p>`), primary('Choose where to live', { action: 'to-home' })];
  }
  const extras = HOME_EXTRAS.map((extra) => `<div class="ob-extra" data-extra-root="${esc(extra.id)}">${extra.render(state, view, draft)}</div>`).join('');
  const missing = HOME_EXTRAS.map((extra) => extra.ready?.(draft)).find((reason) => typeof reason === 'string' && reason) ?? '';
  const seed = state.onboarding.seed, start = o.own?.startCash ?? null;
  const area = view.estate?.lgas?.find((item) => item.id === draft.extra.area?.lga)?.name ?? '';
  const kept = o.guest && state.cash !== seed && start !== null ? ` You keep the ${money(state.cash)} you have now: start cash tops your wallet up to ${money(Math.max(start, seed) + state.cash - seed)}.` : '';
  return [withSim(view, `<p class="ob-lead"><b>Your own house — free, furnished, with your start cash.</b> Everyone in this city gets a starter house on their own plot. Where will ${esc(name)} live?${esc(kept)}</p>
    <div class="ob-list"><div class="ob-card is-row ob-home is-own"><span class="ob-card-icon" aria-hidden="true">${iconFor('home', 'own', '🏠')}</span><span><em class="ob-tag">Yours</em><strong>Starter house${area ? ` · ${esc(area)}` : ''}</strong><small>One good room on your own plot, furnished, with food in the kitchen.</small><small class="ob-money">${start !== null ? `Start with ${money(start)} · ` : ''}no rent</small></span></div></div>${extras}
    <p class="preview-note">Prefer to rent? Homes in Mushin, Yaba and Lekki are in Phone → Houses once you have moved in. You keep your own house either way.</p>`),
    primary(missing ? 'Choose your local government' : `Move in${area ? ` to ${area}` : ''}`, { action: 'home', disabled: Boolean(missing), why: missing,
      also: !missing && o.guest && state.location !== 'home' ? `<button type="button" class="ui-button ob-stay" data-ob="home-stay" data-key="stay" ${pending ? 'disabled' : ''}>Move in, but stay here for now</button>` : '' })];
}

export default {
  id: ID, title: 'Make this life yours', placement: 'modal', live: false,
  render(state, view) {
    const o = view.onboarding;
    if (o.done) {
      draft = null;
      return `<div class="ob-root ob-done">${lookStage(o.look, { variant: 'wide', name: view.name })}<h3>${esc(view.name)} is ready</h3><p>${o.legacy ? 'This life started before character creation existed, so nothing was changed.' : 'Your Sim has moved in.'} You can change your look any time in Sim → Profile.</p><button type="button" class="ui-button is-primary" data-open="profile">Edit look</button> <button type="button" class="ui-button" data-close>Close</button></div>`;
    }
    sync(state, view);
    const first = firstStep(view), count = ONBOARDING_STEPS.length - first;
    shown = Math.max(first, shown);
    later = o.guest ? '<button type="button" class="ui-button ob-later" data-close data-key="later">Not now — keep playing</button>' : '';
    // Why the sheet opened, said once at the top: the reward that was just earned, or the home-only thing that was tapped.
    const why = view.params?.why, nudge = view.params?.nudge;
    const intro = !o.guest ? '' : why ? `<p class="ob-intro"><span aria-hidden="true">${mark('home')}</span><span><strong>Settle in to get your home.</strong>${why === 'buy' ? 'Buy mode furnishes your own room.' : 'You are a guest in the city for now.'} A few quick choices and it is yours — everything you have earned is kept.</span></p>`
      : nudge === 'first-reward' ? `<p class="ob-intro is-reward"><span aria-hidden="true">${mark('star')}</span><span><strong>Nice start, ${esc(view.name)}! You have ${money(state.cash)} and ${view.goals?.stars ?? 0} ${view.goals?.stars === 1 ? 'star' : 'stars'}.</strong>Save this character: a few quick choices give it traits, a dream, start cash and a home. Everything you have earned is kept.</span></p>`
        : nudge ? `<p class="ob-intro"><span aria-hidden="true">${mark('star')}</span><span><strong>Ready to make this life yours?</strong>A few quick choices give ${esc(view.name)} traits, a dream, start cash and a home. Everything you have earned is kept.</span></p>` : '';
    // Every step is numbered and named; finished ones are ticked and the current one is spelled out.
    const steps = ONBOARDING_STEPS.map((step, index) => (index < first ? '' : `<li class="${index < o.step ? 'is-done' : ''} ${index === shown ? 'is-current' : ''}" ${index === shown ? 'aria-current="step"' : ''}><i aria-hidden="true">${index < o.step && index !== shown ? '✓' : index + 1 - first}</i><span>${esc(step.label)}</span></li>`)).join('');
    const words = linkWords(view);
    // The real connection state in its own words ("No internet", "Server unreachable" …), with the action that fixes it.
    const offline = !words ? '' : `<p class="ob-note" role="status"><span aria-hidden="true">${mark('cloud-off')}</span><span><strong>${esc(words.short)} — keep going.</strong> ${esc(words.why)} Your choices are kept on this device and are saved as soon as you are connected again.</span>${linkButton(view, 'ui-button is-small ob-note-action')}</p>`;
    const [content, footer] = stepBody(state, view);
    return `<div class="ob-root" data-step="${shown}">${intro}<div class="ob-head">${shown > first ? `<button type="button" class="sheet-back" data-ob="back" data-key="back" aria-label="Back to ${esc(ONBOARDING_STEPS[shown - 1].label)}">${icon('back')}</button>` : ''}<div class="ob-head-main"><strong>Step ${shown + 1 - first} of ${count} · ${esc(ONBOARDING_STEPS[shown].label)}</strong><ol class="ob-steps" aria-label="Progress">${steps}</ol></div></div>
      ${offline}${error ? `<p class="ob-error" role="alert">${esc(error)}</p>` : ''}${content}${footer}</div>`;
  },
  bind(root, api, params) {
    // Each redraw replaces this root, so check the document, not the (possibly detached) root.
    // A redraw keeps what the sheet was opened with (the reward, or the Home tap that brought the player here).
    const redraw = () => { if (document.querySelector('.ob-root')) api.refresh(); };
    if (focusKey) root.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    mountLookPreview(root, draft?.look ?? api.view().onboarding.look, { name: api.view().name });
    if (draft && shown === LAST) for (const extra of HOME_EXTRAS) extra.bind?.(root, api, draft, redraw);
    // One funnel event per time the sheet is put in front of a guest (a redraw of the same opening is not another offer).
    if (api.view().onboarding.guest && !offered && draft) {
      offered = true;
      track('save_character_offered', { reason: params?.nudge ?? params?.why ?? 'asked', step: api.view().onboarding.step });
      root.closest('dialog')?.addEventListener('close', () => { offered = false; }, { once: true });
    }
    const send = async (label, type, payload, then) => {
      pending = label; error = ''; redraw();
      const result = await api.command(type, payload);
      pending = '';
      if (result.ok) then?.();
      else error = result.code === 'offline' || !api.view().connected ? `${linkWords(api.view())?.why || 'The game server did not answer.'} This step cannot be saved yet. Nothing is lost — try again when you are connected.` : result.reason || 'That could not be saved. Check your connection and try again.';
      return result;
    };
    root.addEventListener('click', async (event) => {
      const target = event.target.closest('[data-look],[data-look-tab],[data-trait],[data-dream],[data-ob],[data-extra]');
      if (!target || target.disabled || !draft) return;
      focusKey = target.dataset.key || '';
      const data = target.dataset;
      if (lookTabClick(target)) { redraw(); return; }
      if ('look' in data) { draft.look = chooseLook(draft.look, data.look, data.value, starterWardrobe()); storeLook(draft.look); }
      else if ('trait' in data) {
        if (draft.traits.includes(data.trait)) draft.traits = draft.traits.filter((id) => id !== data.trait);
        else draft.traits = [...draft.traits, data.trait].slice(-TRAITS_REQUIRED);
      } else if ('dream' in data) draft.dream = data.dream;
      else if ('extra' in data) { HOME_EXTRAS.find((extra) => extra.id === target.closest('[data-extra-root]')?.dataset.extraRoot)?.click?.(target, draft, { api, redraw }); }
      else if (data.ob === 'back') { shown = Math.max(firstStep(api.view()), shown - 1); error = ''; }
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
      else if (data.ob === 'home' || data.ob === 'home-stay') {
        const extra = Object.assign({}, ...HOME_EXTRAS.map((item) => item.payload?.(draft) ?? {}));
        const result = await send('Moving in…', 'onboarding.home', { ...extra, ...(data.ob === 'home-stay' ? { stay: true } : {}) });
        // The server's own sentence ("Welcome to …") is the one confirmation: the shell shows it as a toast when the state arrives.
        if (result.ok) { for (const item of HOME_EXTRAS) item.done?.(draft); draft = null; focusKey = ''; api.close(); return; }
      }
      redraw();
    });
  },
};
