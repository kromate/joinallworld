<script setup lang="ts">
// THE LANDING SCREEN — the session gate of a new device ('quick-start', role 'session-gate'): a
// name, a quick character and one Play button. Two taps at most for someone who accepts the
// defaults (Play; a Shuffle if they want one). No traits, dream, lottery or home here: those are
// offered later by "Make this life yours" (OnboardingApp.vue).
//
//   name       prefilled with a friendly suggestion, editable; the dice suggests another. The server
//              decides (POST /api/session: length, its text filter); a refusal comes back here with
//              its sentence and the form as it was.
//   character  the 3D preview with a big Shuffle, five one-tap presets and the body toggle. "More
//              options" opens the full creator below; it is never required.
//   Play       sends 'jaw:quick-start' { name, look } (App.vue), which opens the session and confirms
//              the look with the 'onboarding.quick-start' action — exactly once: the action id is
//              kept on the device until the server has answered (src/quick-start/entry.ts).
//
// The draft is kept on the device as it is edited (startBoundary.ts), so a reload in the middle of
// the form loses nothing. params: { reason: 'new', problem?: { reason, name } } — or none, when the
// shell opened it because the life is still held for its look.
import '../../../ui/panels/quick-start.css'
import { computed, nextTick, onMounted, ref } from 'vue'
import { playableCityIds, cityName } from '../../../game/cities/registry.ts'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import { keepPlay, play } from '../../../quick-start/entry.ts'
import GameIcon from '../../ui/GameIcon.vue'
import AvatarFigure from './AvatarFigure.vue'
import LinkAction from './LinkAction.vue'
import LookEditor from './LookEditor.vue'
import LookStage from './LookStage.vue'
import { chooseLook, lookFocusBody, starterWardrobe } from './lookModel.ts'
import type { LookField } from './lookModel.ts'
import { fallbackPreset, held, planPlay, problemOf, refusedNameToKeep, showsLinkNote, shownError } from './quickStartModel.ts'
import { currentDraft, draft, focus, qs } from './quickStartState.ts'
import { APPEARANCE } from '../../../game/content/traits.ts'
import { PRESETS, firstLanding, joinTarget, keepDraft, pendingRef, presetLook, shuffleLook, suggestName, track, withBody } from './startBoundary.ts'
import type { QuickDraft } from './startBoundary.ts'

const props = defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
const view = game.view
const startCity = ref(game.cityId.value)
const openCities = playableCityIds()
const root = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)

currentDraft(view.value.name === 'New Lagosian' ? undefined : view.value.name)
const current = computed<QuickDraft>(() => draft.value ?? currentDraft())
const problem = computed(() => problemOf(props.params))
const words = computed(() => linkWords(view.value))
const shown = computed(() => shownError(qs.error, problem.value))
const showNote = computed(() => showsLinkNote(words.value, shown.value, view.value.link))
// The refused name is put in the draft once (below); the field always shows the draft, so Shuffle, the dice and the presets are never dead.
const nameShown = computed(() => current.value.name)
const refused = refusedNameToKeep(problem.value, current.value.name)
if (refused !== null) draft.value = keepDraft({ name: refused })
const invited = (): boolean => Boolean(joinTarget() || pendingRef())
const wardrobe = starterWardrobe()

/** Change the draft and keep it on the device. */
function keep(changes: Partial<QuickDraft>): void { draft.value = keepDraft(changes) }
/** After a tap the keyboard goes back to what was tapped (Play when nothing was). */
function focusTapped(): void {
  void nextTick(() => root.value?.querySelector<HTMLElement>(`[data-key="${CSS.escape(focus.key || 'play')}"]`)?.focus({ preventScroll: true }))
}
function tap(key: string): void { qs.taps += 1; qs.error = ''; focus.key = key }

onMounted(() => {
  // Once per device, not once per page load: a reload in the middle of the form is the same landing.
  if (!qs.landed) { qs.landed = true; if (!held(view.value) && firstLanding()) track('landed', { join: invited() }) }
  // Play is where the keyboard starts (Enter plays).
  focusTapped()
})

// Typing never redraws the stage; the draft is kept as it changes.
function typed(): void { if (input.value) keep({ name: input.value.value, nameEdited: true }) }
function go(): void {
  if (play.sending) return // a second tap while the first is on its way
  qs.taps += 1
  const plan = planPlay(input.value?.value ?? current.value.name, current.value.look)
  if (plan.kind === 'name') { qs.error = plan.error; focus.key = ''; void nextTick(() => input.value?.focus()); return }
  if (plan.kind === 'look') { const fallback = fallbackPreset(); keep({ look: presetLook(fallback.id) ?? current.value.look, preset: fallback.id }); qs.error = plan.error; return }
  qs.error = ''
  focus.key = ''
  keep({ name: plan.name })
  // `joining`: a link is waiting, so the server holds back its "Welcome to …" line — the one banner says it instead.
  keepPlay({ look: plan.look, ...(invited() ? { joining: true } : {}) })
  track('named', { edited: current.value.nameEdited, length: plan.name.length })
  track('quick_look_done', { shuffles: current.value.shuffles, preset: current.value.preset, edited: qs.more })
  track('play_tapped', { taps: qs.taps })
  play.sending = true
  shell.close()
  window.dispatchEvent(new CustomEvent('jaw:quick-start', { detail: { name: plan.name, look: plan.look, city: startCity.value } }))
}

function shuffle(): void {
  tap('shuffle')
  let next = shuffleLook(Math.random)
  for (let tries = 0; tries < 4 && JSON.stringify(next) === JSON.stringify(current.value.look); tries++) next = shuffleLook(Math.random)
  keep({ look: next, preset: null, shuffles: current.value.shuffles + 1 }); lookFocusBody()
  focusTapped()
}
function dice(): void { tap('dice'); keep({ name: suggestName(Math.random), nameEdited: false }); focusTapped() }
function more(): void { tap('more'); qs.more = !qs.more; focusTapped() }
function preset(id: string): void {
  tap(`preset:${id}`)
  const look = presetLook(id)
  if (look) { keep({ look, preset: id }); lookFocusBody() }
  focusTapped()
}
function body(id: string): void { tap(`body:${id}`); keep({ look: withBody(current.value.look, id), preset: null }); lookFocusBody(); focusTapped() }
function choose(field: LookField, value: string): void {
  tap(`${field}:${value}`)
  keep({ look: chooseLook(current.value.look, field, value, wardrobe), preset: null })
  focusTapped()
}
/** A tab of the editor counts as a tap, like any other control of the screen. */
function onEditorTap(event: MouseEvent): void {
  const tab = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-look-tab]') : null
  if (tab) { tap(tab.dataset.key ?? ''); focusTapped() }
}
</script>

<template>
  <div ref="root" class="qs-root" data-qs-root>
    <p class="qs-lead"><b>Step into a world to live in, with your friends.</b>Start playing in seconds. Build your life as you go.</p>
    <p v-if="invited()" class="qs-join" role="status"><span aria-hidden="true"><GameIcon name="invite" inline /></span><span><strong>A friend invited you.</strong>Tap Play and you land where they are.</span></p>
    <p v-if="showNote && words" class="qs-note" role="status"><span aria-hidden="true"><GameIcon name="cloud-off" inline /></span><span><strong>{{ words.short }}</strong>{{ words.why }} Your character is kept on this device.</span><LinkAction class-name="ui-button is-small" /></p>
    <p v-if="shown" class="qs-error" role="alert">{{ shown }}</p>
    <LookStage :look="current.look" variant="hero" :name="current.name">
      <template #tools><button type="button" class="look-tool is-main qs-shuffle" data-qs="shuffle" data-key="shuffle" @click="shuffle"><GameIcon name="game" inline /> Shuffle</button></template>
    </LookStage>
    <div class="qs-presets" role="group" aria-label="Quick characters">
      <button v-for="item in PRESETS" :key="item.id" type="button" class="qs-preset" :data-qs-preset="item.id" :data-key="`preset:${item.id}`" :aria-pressed="current.preset === item.id" :aria-label="`${item.label} character`" @click="preset(item.id)"><AvatarFigure :look="item.look" :size="30" label="" />{{ item.label }}</button>
    </div>
    <div class="qs-row">
      <div class="qs-body" role="group" aria-label="Body">
        <button v-for="item in APPEARANCE.bodies" :key="item.id" type="button" :data-qs-body="item.id" :data-key="`body:${item.id}`" :aria-pressed="current.look.body === item.id" @click="body(item.id)">{{ item.label }}</button>
      </div>
      <button type="button" class="qs-more" data-qs="more" data-key="more" :aria-expanded="qs.more" @click="more">{{ qs.more ? 'Fewer options' : 'More options' }}</button>
    </div>
    <div v-if="qs.more" @click="onEditorTap"><LookEditor :look="current.look" :owned="wardrobe" @choose="choose" /></div>
    <label class="qs-name">Your name<span><input ref="input" name="name" data-qs-name minlength="3" maxlength="24" autocomplete="nickname" autocapitalize="words" spellcheck="false" enterkeyhint="go" :value="nameShown" @input="typed" @keydown.enter.prevent="go"><button type="button" class="qs-dice" data-qs="dice" data-key="dice" aria-label="Suggest another name" title="Suggest another name" @click="dice"><GameIcon name="game" inline /></button></span></label>
    <label v-if="openCities.length > 1 && !invited()" class="qs-name">Start in<select v-model="startCity" aria-label="Starting city"><option v-for="city in openCities" :key="city" :value="city">{{ cityName(city) }}</option></select></label>
    <div class="qs-foot"><button type="button" class="ui-button is-primary qs-play" data-qs="play" data-key="play" @click="go">Play</button><p>No password, no e-mail. You can change everything later.</p></div>
  </div>
</template>
