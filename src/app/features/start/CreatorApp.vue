<script setup lang="ts">
// THE CHARACTER CREATOR — the whole screen, for the first time on a device and for settling in later.
//
//   'new'     the landing of a device with no life: Who are you → Look → Spirit → Home → Ready. "Play now" is
//             on every step: it sends 'jaw:quick-start' { name, look } exactly as the landing's Play did (App.vue),
//             and the player is in a public venue as a guest within seconds. "Start your life" on the last step
//             does the same, keeps this screen open, and — once the life exists — sends the rest of the choices
//             with the existing onboarding actions (look if changed, traits, dream, the birth lottery, home), so
//             'life.started' fires once, at the move-in, as always.
//   'settle'  a guest (or a life that never had a character) finishing it: the same steps without the name, opened
//             at the first thing the server still waits for. "Not now" closes it; play goes on.
//
// The stage (CreatorStage.vue) is the one 3D preview, large; the panel holds the steps. The look is kept on the
// device as it is edited (the landing's draft, or the look draft of settling in), so a reload loses nothing.
// Every server rule is the engine's: this file chooses what to show and in which order to send.
import '../../../ui/panels/quick-start.css'
import '../../../ui/panels/creator.css'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { APPEARANCE, TRAITS_REQUIRED } from '../../../game/content/traits.ts'
import type { PreviewFocus } from '../../../scene/avatar-preview.ts'
import type { DreamId, Look, TraitId } from '../../../types/life.ts'
import { linkWords } from '../../../ui/link.ts'
import { keepPlay, play } from '../../../quick-start/entry.ts'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { track as worldTrack, worldChanged } from '../world/worldModel.ts'
import { useAccountEntry } from './accountEntry.ts'
import { signupShown } from '../account/shownOnce.ts'
import AvatarFigure from './AvatarFigure.vue'
import CreatorStage from './CreatorStage.vue'
import LinkAction from './LinkAction.vue'
import StepHome from './StepHome.vue'
import StepLook from './StepLook.vue'
import StepReady from './StepReady.vue'
import StepSpirit from './StepSpirit.vue'
import StepWho from './StepWho.vue'
import { FOCUS_CHOICES, defaultSpirit, focusForField, focusForTab, nextLabel, nextStep, previousStep, progressOf, pushHistory, settlePlan, startStep, stepBlocked, stepDef, stepsFor } from './creatorModel.ts'
import type { CreatorMode, StepId } from './creatorModel.ts'
import { cr, ownerOf } from './creatorState.ts'
import type { CreatorDraft } from './creatorState.ts'
import { chooseLook, lookAlt, lookSummary, lookUi, openLookTab, randomLook, sameLook, starterWardrobe } from './lookModel.ts'
import type { LookField } from './lookModel.ts'
import { failureText, introFor, keepLook, storedLook, toggleTrait, triggerOf } from './onboardingModel.ts'
import { fallbackPreset, planPlay, problemOf, refusedNameToKeep, showsLinkNote, shownError } from './quickStartModel.ts'
import { currentDraft, draft as quickDraftRef, qs } from './quickStartState.ts'
import { invitedWords, inviterName } from '../growth/inviterLookup.ts'
import { firstLanding, joinTarget, keepDraft, nameProblem, pendingRef, presetLook, shuffleLook, suggestName, track, withBody } from './startBoundary.ts'
import type { QuickDraft } from './startBoundary.ts'

const props = defineProps<{ mode: CreatorMode; params?: unknown }>()
const { game, shell, command } = useApp()
const state = game.state
const view = game.view
const account = useAccountEntry()
const root = ref<HTMLElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
const heading = ref<HTMLElement | null>(null)
const wardrobe = starterWardrobe()
const isNew = props.mode === 'new'

const o = computed(() => view.value.onboarding)
const steps = computed(() => stepsFor(props.mode))
const problem = computed(() => problemOf(props.params))
const words = computed(() => linkWords(view.value))
const invited = (): boolean => Boolean(joinTarget() || pendingRef())
const inviter = ref<string | null>(null)
const invitedNote = computed(() => invitedWords(inviter.value))

// ---- the draft ----------------------------------------------------------------------------------
type Sender = (type: string, payload: unknown) => Promise<{ ok: boolean; code: string; reason?: string | undefined }>
const send = command as unknown as Sender

function makeDraft(): CreatorDraft {
  const saved = state.value.onboarding
  const spirit = defaultSpirit()
  const chosen = saved.traits.length === TRAITS_REQUIRED
  if (isNew) {
    const kept = currentDraft(view.value.name === 'New Lagosian' ? undefined : view.value.name)
    // What this device kept of the later steps comes back after a reload; what the server already holds wins.
    const keptSpirit = !chosen && kept.traits.length === TRAITS_REQUIRED
    return { look: { ...kept.look }, name: kept.name, traits: chosen ? [...saved.traits] : keptSpirit ? [...kept.traits] : spirit.traits, dream: saved.dream ?? kept.dream ?? spirit.dream,
      area: kept.area ? { ...kept.area } : undefined, spiritChosen: chosen || keptSpirit }
  }
  const key = `${view.value.session?.id ?? 'local'}:${view.value.cityId}`
  return { look: (saved.step === 0 && storedLook(key)) || { ...saved.look }, name: view.value.name, traits: chosen ? [...saved.traits] : spirit.traits, dream: saved.dream ?? spirit.dream, area: undefined, spiritChosen: chosen }
}
function ensureDraft(): CreatorDraft {
  const owner = ownerOf(view.value, props.mode)
  if (cr.draft && cr.owner === owner) return cr.draft
  cr.owner = owner
  const made = makeDraft()
  cr.draft = made
  cr.origin = { ...made.look }
  cr.history = []
  cr.step = startStep(props.mode, state.value.onboarding)
  cr.error = ''
  cr.pending = ''
  cr.settling = false
  cr.played = false
  return made
}
const d = (): CreatorDraft => cr.draft ?? ensureDraft()
ensureDraft()
const draft = computed(() => d())
// A new device keeps the later choices too (traits, dream, area), as it keeps the look and the name; the life starting clears them.
if (isNew) watch(() => { const now = d(); return JSON.stringify([now.spiritChosen ? now.traits : [], now.spiritChosen ? now.dream : null, now.area ?? null]) }, () => {
  const now = d()
  quickDraftRef.value = keepDraft(now.spiritChosen ? { traits: [...now.traits], dream: now.dream, area: now.area ? { ...now.area } : null } : { area: now.area ? { ...now.area } : null })
})
if (!steps.value.some((item) => item.id === cr.step)) cr.step = steps.value[0]?.id ?? 'look'
// A refusal the creator was reopened with: the refused name is put back once so it can be corrected.
{
  const refused = refusedNameToKeep(problem.value, d().name)
  if (isNew && refused !== null) { d().name = refused; quickDraftRef.value = keepDraft({ name: refused }) }
  if (isNew && problem.value) cr.step = 'who'
}
openLookTab('body')

const presetId = computed(() => (isNew ? (quickDraftRef.value ?? currentDraft()).preset : null))
const areaName = computed(() => view.value.estate?.lgas?.find((item) => item.id === d().area?.lga)?.name ?? '')
const alt = computed(() => lookAlt(draft.value.look, draft.value.name))
const finished = computed(() => !isNew && o.value.done)
const shown = computed(() => shownError(cr.error, problem.value))
const showNote = computed(() => showsLinkNote(words.value, shown.value, view.value.link))
const intro = computed(() => (isNew ? null : introFor(props.params, { guest: o.value.guest, name: view.value.name, cash: state.value.cash, stars: view.value.goals?.stars ?? 0 })))

/** Change the look: kept on the device, with the one before it to go back to. */
function setLook(next: Look, extra: Partial<QuickDraft> = {}): void {
  const draftNow = d()
  cr.history = pushHistory(cr.history, draftNow.look, next)
  draftNow.look = next
  if (isNew) quickDraftRef.value = keepDraft({ look: next, preset: null, ...extra })
  else keepLook(`${view.value.session?.id ?? 'local'}:${view.value.cityId}`, next)
}
function tap(): void { qs.taps += 1; cr.error = '' }

// ---- the stage ---------------------------------------------------------------------------------
const focus = ref<PreviewFocus>('body')
function setFocus(next: PreviewFocus): void { focus.value = next }
function onTab(id: string): void { focus.value = focusForTab(id) }

// ---- the steps ---------------------------------------------------------------------------------
const progress = computed(() => progressOf(steps.value, cr.step))
const def = computed(() => stepDef(cr.step))
const title = computed(() => (isNew && cr.step === 'who' ? 'Welcome to Allworld' : def.value.title))
const lead = computed(() => (isNew && cr.step === 'who' ? 'A digital world you can live in, with your friends. Choose who you are to begin; you can play in seconds.' : def.value.lead))
const blocked = computed(() => stepBlocked(cr.step, { nameProblem: nameProblem(draft.value.name.trim()), area: draft.value.area, traits: draft.value.traits.length }))
const last = computed(() => nextStep(steps.value, cr.step) === null)
const previous = computed(() => previousStep(steps.value, cr.step))
/** "Play now" belongs to a device that has not played yet; afterwards the same place says "Not now". */
const playable = computed(() => isNew && !cr.played)
/** The first step on a server with accounts: three ranked ways to begin (play now, sign up, log in). Nothing here slows the guest path. */
const choices = computed(() => playable.value && cr.step === 'who' && account.available && !account.signedIn)
const canStay = computed(() => !isNew && last.value && o.value.guest && state.value.location !== 'home')

watch(choices, (on) => { if (on) signupShown('creator') }, { immediate: true })

function go(step: StepId): void {
  cr.error = ''
  cr.step = step
  void nextTick(() => { if (scroller.value) scroller.value.scrollTop = 0; heading.value?.focus({ preventScroll: true }) })
}
watch(() => cr.step, (step) => {
  if (step === 'look') focus.value = focusForTab(lookUi.section)
  else focus.value = 'body'
})
function back(): void { const step = previous.value; if (step) go(step) }
function next(): void {
  if (cr.pending) return
  if (blocked.value) { cr.error = blocked.value; if (cr.step === 'who') void nextTick(() => root.value?.querySelector<HTMLInputElement>('[data-qs-name]')?.focus()); return }
  const step = nextStep(steps.value, cr.step)
  if (step) go(step); else void finish(false)
}

// ---- who ---------------------------------------------------------------------------------------
function typed(value: string): void { d().name = value; cr.error = ''; if (isNew) quickDraftRef.value = keepDraft({ name: value, nameEdited: true }) }
function dice(): void { tap(); const name = suggestName(Math.random); d().name = name; quickDraftRef.value = keepDraft({ name, nameEdited: false }) }
function preset(id: string): void {
  tap()
  const look = presetLook(id)
  if (!look) return
  const draftNow = d()
  cr.history = pushHistory(cr.history, draftNow.look, look)
  draftNow.look = look
  quickDraftRef.value = keepDraft({ look, preset: id })
  focus.value = 'body'
}
function body(id: string): void { tap(); setLook(withBody(d().look, id)); focus.value = 'body' }
function shuffle(): void {
  tap()
  const current = d().look
  let nextLook = isNew && cr.step === 'who' ? shuffleLook(Math.random) : randomLook()
  for (let tries = 0; tries < 4 && sameLook(nextLook, current); tries++) nextLook = isNew && cr.step === 'who' ? shuffleLook(Math.random) : randomLook()
  setLook(nextLook, { shuffles: (quickDraftRef.value?.shuffles ?? 0) + 1 })
  focus.value = 'body'
}

// ---- look --------------------------------------------------------------------------------------
function choose(field: LookField, value: string): void {
  tap()
  setLook(chooseLook(d().look, field, value, wardrobe))
  const near = focusForField(field)
  if (near) focus.value = near
}
function undo(): void {
  const previousLook = cr.history[cr.history.length - 1]
  if (!previousLook) return
  cr.history = cr.history.slice(0, -1)
  d().look = previousLook
  if (isNew) quickDraftRef.value = keepDraft({ look: previousLook, preset: null }); else keepLook(`${view.value.session?.id ?? 'local'}:${view.value.cityId}`, previousLook)
}
function reset(): void { if (cr.origin) setLook({ ...cr.origin }) }

// ---- spirit ------------------------------------------------------------------------------------
function pickTrait(id: TraitId): void { const draftNow = d(); draftNow.traits = toggleTrait(draftNow.traits, id); draftNow.spiritChosen = true }
function pickDream(id: DreamId): void { const draftNow = d(); draftNow.dream = id; draftNow.spiritChosen = true }
function randomSpirit(): void { const draftNow = d(); const spirit = defaultSpirit(); draftNow.traits = spirit.traits; draftNow.dream = spirit.dream; draftNow.spiritChosen = true }

// ---- play now, and the whole start ---------------------------------------------------------------
/** The landing's Play: a guest in a public venue within seconds. With `settle` this screen stays open for the rest. */
function playNow(settle = false): void {
  if (play.sending) return
  qs.taps += 1
  const plan = planPlay(d().name, d().look)
  if (plan.kind === 'name') { cr.step = 'who'; cr.error = plan.error; void nextTick(() => root.value?.querySelector<HTMLInputElement>('[data-qs-name]')?.focus()); return }
  if (plan.kind === 'look') {
    const fallback = fallbackPreset()
    const look = presetLook(fallback.id)
    if (look) { d().look = look; quickDraftRef.value = keepDraft({ look, preset: fallback.id }) }
    cr.error = plan.error
    return
  }
  cr.error = ''
  const quick = quickDraftRef.value ?? currentDraft()
  quickDraftRef.value = keepDraft({ name: plan.name })
  keepPlay({ look: plan.look, ...(invited() ? { joining: true } : {}) })
  track('named', { edited: quick.nameEdited, length: plan.name.length })
  track('quick_look_done', { shuffles: quick.shuffles, preset: quick.preset, edited: cr.history.length > 0 })
  track('play_tapped', { taps: qs.taps })
  play.sending = true
  play.settling = settle
  cr.settling = settle
  cr.played = true
  if (settle) cr.pending = 'Starting your life…'
  else shell.close()
  window.dispatchEvent(new CustomEvent('jaw:quick-start', { detail: { name: plan.name, look: plan.look } }))
}
/** The life exists (or Play failed): move in with the choices on screen. */
async function runSettle(stay: boolean): Promise<void> {
  const draftNow = d()
  const plan = settlePlan({ saved: state.value.onboarding, draft: { look: draftNow.look, traits: draftNow.traits, dream: draftNow.dream, area: draftNow.area }, stay })
  if (!plan) { cr.error = blocked.value || 'Choose your traits, your dream and where you live first.'; return }
  cr.error = ''
  for (const action of plan) {
    cr.pending = action.label
    const result = await send(action.type, action.payload)
    if (!result.ok) { cr.pending = ''; cr.error = failureText(result, view.value.connected, words.value?.why); return }
  }
  cr.pending = ''
  if (draftNow.area) { worldTrack('lga_chosen', { method: draftNow.area.via === 'device' ? 'device' : 'manual', lga: draftNow.area.lga }); worldChanged() }
  cr.settling = false
  play.settling = false
  shell.close()
}
async function finish(stay: boolean): Promise<void> {
  if (cr.pending) return
  if (isNew && !cr.played) { playNow(true); return }
  await runSettle(isNew ? false : stay) // a new life ends at home; "stay" is only for a guest already in the world
}
/** The shell finished the Play this screen sent: on success the rest is sent, otherwise the reopened screen says why. */
function onStarted(event: Event): void {
  if (!cr.settling) return
  const ok = (event as CustomEvent<{ ok?: boolean }>).detail?.ok === true
  if (ok) { void runSettle(false); return }
  cr.pending = ''
  cr.settling = false
  cr.played = false
  play.settling = false
  if (!cr.error && !problem.value) cr.error = 'Your life could not be started yet. Nothing is lost: tap Start your life to try again.'
}
watch(problem, (now) => {
  if (!isNew || !now) return
  cr.pending = ''
  cr.settling = false
  cr.played = false
  play.settling = false
  cr.step = 'who'
  if (now.name) { d().name = now.name; quickDraftRef.value = keepDraft({ name: now.name }) }
})
function notNow(): void { shell.close() }
function openSignIn(): void { account.openSignIn() }
function openSignUp(): void { account.openSignUp() }
function openSave(): void { account.openSave() }

onMounted(() => {
  // A link that carried a share code names who sent it, as text, before the life starts.
  const code = pendingRef()
  if (code && props.mode === 'new') void inviterName(game.fetchJson, code).then((name) => { inviter.value = name })
  window.addEventListener('jaw:quick-start-done', onStarted)
  // Once per device, not once per page load: a reload in the middle of the form is the same landing.
  if (isNew && !qs.landed) { qs.landed = true; if (!(o.value.required && view.value.connected) && firstLanding()) track('landed', { join: invited() }) }
  // One funnel event per time the creator is put in front of a guest (a redraw of the same opening is not another offer).
  if (!isNew && o.value.guest && !cr.offered) { cr.offered = true; track('save_character_offered', { trigger: triggerOf(props.params), step: o.value.step }) }
  focus.value = cr.step === 'look' ? focusForTab(lookUi.section) : 'body'
})
onBeforeUnmount(() => {
  window.removeEventListener('jaw:quick-start-done', onStarted)
  cr.offered = false
  if (!play.sending) play.settling = false
})
</script>

<template>
  <div ref="root" class="cr-root" :data-step="cr.step" :data-mode="mode" data-cr-root>
    <div class="cr-stage-col">
      <p class="cr-brand"><i aria-hidden="true"><GameIcon name="globe" :size="20" /></i><b>Allworld</b><span>A digital world you can live in</span></p>
      <CreatorStage :look="draft.look" :name="draft.name || 'Your Sim'" :focus="focus" :caption="draft.name" @focus="setFocus" />
    </div>

    <section class="cr-panel" :aria-labelledby="'cr-title'">
      <header class="cr-head">
        <div class="cr-head-row">
          <button v-if="previous && !finished" type="button" class="cr-back" data-key="back" :aria-label="`Back to ${stepDef(previous).label}`" @click="back"><GameIcon name="back" :size="22" /></button>
          <p class="cr-stepline" aria-live="polite"><template v-if="finished">All set</template><template v-else>Step {{ progress.index }} of {{ progress.count }} · <b>{{ progress.label }}</b></template></p>
          <button v-if="!isNew && !finished" type="button" class="cr-close" data-key="close" aria-label="Not now, keep playing" title="Not now, keep playing" :disabled="Boolean(cr.pending)" @click="notNow"><GameIcon name="close" :size="20" /></button>
        </div>
        <ol v-if="!finished" class="cr-progress" aria-label="Progress">
          <li v-for="(item, index) in steps" :key="item.id" :class="{ 'is-done': index + 1 < progress.index, 'is-current': item.id === cr.step }" :aria-current="item.id === cr.step ? 'step' : undefined">
            <button v-if="index + 1 < progress.index && !cr.pending" type="button" :data-key="`goto:${item.id}`" :aria-label="`Go back to ${item.label}`" @click="go(item.id)"><i aria-hidden="true" /><span>{{ item.label }}</span></button>
            <div v-else class="cr-prog-item"><i aria-hidden="true" /><span>{{ item.label }}</span></div>
          </li>
        </ol>
      </header>

      <div ref="scroller" class="cr-scroll">
        <p v-if="intro" class="cr-banner is-info"><span aria-hidden="true"><GameIcon :name="intro.kind === 'why' ? 'home' : 'star'" inline /></span><span><strong>{{ intro.strong }}</strong> {{ intro.text }}</span></p>
        <p v-if="isNew && invited()" class="cr-banner is-good" role="status"><span aria-hidden="true"><GameIcon name="invite" inline /></span><span><strong>{{ invitedNote.title }}</strong> {{ inviter ? `Start your life and you land where ${inviter} is.` : 'Start your life and you land where they are.' }}</span></p>
        <p v-if="showNote && words" class="cr-banner is-warn" role="status"><span aria-hidden="true"><GameIcon name="cloud-off" inline /></span><span><strong>{{ words.short }}.</strong> {{ words.why }} Your character is kept on this device.</span><LinkAction class-name="cr-btn is-small" /></p>
        <p v-if="shown" class="cr-banner is-error" role="alert" data-cr-error>{{ shown }}</p>

        <Transition name="cr-step" mode="out-in">
          <div v-if="finished" key="done" class="cr-body cr-done">
            <h1 id="cr-title" ref="heading" tabindex="-1">{{ view.name }} is ready</h1>
            <p class="cr-lead">{{ o.legacy ? 'This life started before character creation existed, so nothing was changed.' : 'Your Sim has moved in.' }} You can change your look any time in Sim → Profile.</p>
            <p class="cr-note">{{ lookSummary(draft.look) }}</p>
          </div>
          <div v-else :key="cr.step" class="cr-body">
            <h1 id="cr-title" ref="heading" tabindex="-1">{{ title }}</h1>
            <p class="cr-lead">{{ lead }}</p>
            <StepWho v-if="cr.step === 'who'" :look="draft.look" :preset="presetId" :name="draft.name" :error="shown" @preset="preset" @body="body" @shuffle="shuffle" @dice="dice" @name="typed" @submit="next" />
            <StepLook v-else-if="cr.step === 'look'" :look="draft.look" :owned="wardrobe" :can-undo="cr.history.length > 0" :can-reset="cr.origin !== null && !sameLook(cr.origin, draft.look)" @choose="choose" @undo="undo" @reset="reset" @shuffle="shuffle" @tab="onTab" />
            <StepSpirit v-else-if="cr.step === 'spirit'" :traits="draft.traits" :dream="draft.dream" @trait="pickTrait" @dream="pickDream" @random="randomSpirit" />
            <StepHome v-else-if="cr.step === 'home'" v-model="draft.area" />
            <StepReady v-else :name="draft.name" :look="draft.look" :traits="draft.traits" :dream="draft.dream" :area="areaName" @edit="go" />
            <p v-if="canStay" class="cr-stay"><button type="button" class="cr-link" data-key="stay" :disabled="Boolean(cr.pending)" @click="finish(true)">Move in, but stay here for now</button></p>
          </div>
        </Transition>
        <span class="cr-sr" role="status" aria-live="polite">{{ alt }}</span>
      </div>

      <footer class="cr-foot">
        <p v-if="blocked && !cr.pending" class="cr-why" data-cr-why>{{ blocked }}</p>
        <p v-else-if="cr.pending" class="cr-why" role="status">{{ cr.pending }}</p>
        <div class="cr-actions">
          <template v-if="finished">
            <button type="button" class="cr-btn" data-key="later" @click="notNow">Close</button>
            <button type="button" class="cr-btn is-primary" data-key="primary" @click="shell.open('profile')">Edit look</button>
          </template>
          <div v-else-if="choices" class="cr-choices" data-cr-choices>
            <div class="cr-actions">
              <button type="button" class="cr-btn is-primary" data-qs="play" data-key="play-now" @click="playNow(false)">Play now</button>
              <button type="button" class="cr-btn" data-key="next" :disabled="Boolean(blocked) || Boolean(cr.pending)" @click="next">{{ nextLabel(steps, cr.step) }}</button>
            </div>
            <button type="button" class="cr-btn is-signup" data-key="sign-up" @click="openSignUp">Sign up free<span> — keep your character</span></button>
            <button type="button" class="cr-link" data-key="sign-in" @click="openSignIn">I already have an account · Log in</button>
          </div>
          <template v-else>
            <button v-if="playable && !last" type="button" class="cr-btn" data-qs="play" data-key="play-now" @click="playNow(false)">Play now</button>
            <button v-else-if="last && account.available && !account.signedIn" type="button" class="cr-btn" data-key="save-character" @click="openSave">Save your character</button>
            <button v-else-if="!playable && o.guest" type="button" class="cr-btn" data-key="later" :disabled="Boolean(cr.pending)" @click="notNow">Not now</button>
            <button type="button" class="cr-btn is-primary" data-key="primary" :disabled="Boolean(blocked) || Boolean(cr.pending)" @click="next">{{ cr.pending || (last ? 'Start your life' : nextLabel(steps, cr.step)) }}</button>
          </template>
        </div>
        <p v-if="choices" class="cr-fine">Play now needs no password or e-mail. You can sign up any time.</p>
        <p v-else-if="playable && cr.step === 'who'" class="cr-fine">No password, no e-mail. Play now and finish your character later.</p>
        <p v-else-if="!playable && o.guest && !last" class="cr-fine">Not now keeps your game going. Your choices here are kept.</p>
      </footer>
    </section>
  </div>
</template>
