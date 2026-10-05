<script setup lang="ts">
// "MAKE THIS LIFE YOURS" — settling in: Personality → Dream → Birth lottery → Home, as short cards.
// It is OFFERED, never forced: a guest of the quick start (QuickStartApp.vue) is already playing, and
// this sheet opens after their first reward, from the "Settle in" goal, and when they tap Home or Buy
// (the shell opens it with params.why). Every card has "Not now": the sheet closes, play goes on, and
// it resumes at the same card next time because each step is saved by the server. Nothing earned
// before settling in is lost; moving in is what creates the home, the rent and the start cash.
// params: { nudge?: 'first-reward' | 'third-activity' | 'next-day', why?: 'home' | 'buy' }.
//
// A life that never was a guest and has no character yet (onboarding.guest false, done false) gets the
// same sheet with the Look step in front. A life that predates character creation never sees it.
//
// THE HOME A NEW LIFE GETS is its own: the free starter house on a plot in the local government it
// chooses here (HomeLgaPick.vue) — no weekly rent — with the start cash of its birth lottery. The
// rule is 'onboarding.home' { lga, via }. The existing sheet's HOME_EXTRAS list (other owners adding
// a section to the Home card) has one member, the local-government choice, and is that component.
//
// Every step is confirmed by a server action; this file only keeps the draft being edited
// (onboardingState.ts, so closing the sheet keeps it). The Sim is on screen through the whole flow:
// the Look step is a character creator (a large 3D preview with Shuffle and Undo, option tabs beside
// it — under it on a phone, where the preview stays pinned), and the later steps keep a small
// preview beside their choices. Styles sold only in the Boutique are shown locked. The look being
// edited is also kept on the device, so it survives a reload or a spell offline and is saved when the
// step is confirmed.
import '../../../ui/panels/onboarding.css'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { dreamsFor } from '../../../game/cities/characterContent.ts'
import { DREAM_REWARD, LOTTERY_NOTE, ONBOARDING_STEPS, TRAITS, TRAITS_REQUIRED } from '../../../game/content/traits.ts'
import type { DreamId, TraitId } from '../../../types/life.ts'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { money } from '../../ui/format.ts'
import { track as worldTrack, worldChanged } from '../world/worldModel.ts'
import HomeLgaPick from './HomeLgaPick.vue'
import LinkAction from './LinkAction.vue'
import LookEditor from './LookEditor.vue'
import LookStage from './LookStage.vue'
import StepWithSim from './StepWithSim.vue'
import { chooseLook, lookFocusBody, lookSummary, randomLook, sameLook, starterWardrobe } from './lookModel.ts'
import type { LookField } from './lookModel.ts'
import { LAST_STEP, dreamFoot, dreamLead, failureText, firstStep, homeFoot, homeMissing, homePayload, introFor, keptCash, lookFoot, lotteryFoot, toggleTrait, traitsFoot, triggerOf } from './onboardingModel.ts'
import type { Foot } from './onboardingModel.ts'
import { focus, ob, storeLook, sync } from './onboardingState.ts'
import { track } from './startBoundary.ts'

const props = defineProps<{ params?: unknown }>()
const { game, shell, command } = useApp()
const state = game.state
const view = game.view
const root = ref<HTMLElement | null>(null)

const o = computed(() => view.value.onboarding)
const name = computed(() => view.value.name)
const first = computed(() => firstStep(o.value.guest))
const count = computed(() => ONBOARDING_STEPS.length - first.value)
const shown = computed(() => Math.max(first.value, ob.shown))
const words = computed(() => linkWords(view.value))
const intro = computed(() => introFor(props.params, { guest: o.value.guest, name: name.value, cash: state.value.cash, stars: view.value.goals?.stars ?? 0 }))
const steps = computed(() => ONBOARDING_STEPS.map((step, index) => ({ step, index })).filter((item) => item.index >= first.value))
const traits = Object.values(TRAITS)
const dreams = computed(() => dreamsFor(state.value.estate.city))
const rentalDistricts = computed(() => o.value.homes.map(home => home.district))
const rentalNames = computed(() => rentalDistricts.value.length > 1 ? `${rentalDistricts.value.slice(0, -1).join(', ')} and ${rentalDistricts.value.at(-1)}` : rentalDistricts.value[0])
const wardrobe = starterWardrobe()

// The draft belongs to a life: it starts from the saved state, and starts again when the session or the city changes.
watch([() => o.value.done, () => view.value.session?.id, () => view.value.cityId], () => {
  if (o.value.done) ob.draft = null
  else sync(state.value, view.value)
}, { immediate: true })
const draft = computed(() => ob.draft)

const area = computed(() => draft.value?.extra.area)
const missing = computed(() => homeMissing(area.value))
const areaName = computed(() => view.value.estate?.lgas?.find((item) => item.id === area.value?.lga)?.name ?? '')
const kept = computed(() => keptCash({ guest: o.value.guest, cash: state.value.cash, seed: state.value.onboarding.seed, start: o.value.own?.startCash ?? null }))
const foot = computed<Foot>(() => {
  const d = draft.value
  if (shown.value === 0) return lookFoot(view.value.connected, words.value?.short ?? '')
  if (shown.value === 1) return traitsFoot(d?.traits.length ?? 0)
  if (shown.value === 2) return dreamFoot(d?.dream ?? null)
  if (shown.value === 3) return lotteryFoot(Boolean(o.value.lottery))
  return homeFoot(missing.value, areaName.value)
})
/** "Move in, but stay here for now": offered to a guest who is somewhere else than home. */
const canStay = computed(() => shown.value === LAST_STEP && !missing.value && o.value.guest && state.value.location !== 'home')
const pendingLabel = computed(() => ob.pending)

/** After a tap the keyboard goes back to what was tapped. */
function refocus(): void {
  if (!focus.key) return
  void nextTick(() => root.value?.querySelector<HTMLElement>(`[data-key="${CSS.escape(focus.key)}"]`)?.focus({ preventScroll: true }))
}

onMounted(() => {
  // One funnel event per time the sheet is put in front of a guest (a redraw of the same opening is not another offer).
  if (o.value.guest && !ob.offered && ob.draft) {
    ob.offered = true
    track('save_character_offered', { trigger: triggerOf(props.params), step: o.value.step })
  }
  refocus()
})
// The sheet is closed: the next opening is another offer.
onBeforeUnmount(() => { ob.offered = false })

async function send(label: string, run: () => Promise<{ ok: boolean; code: string; reason?: string | undefined }>, then?: () => void): Promise<{ ok: boolean }> {
  ob.pending = label
  ob.error = ''
  const result = await run()
  ob.pending = ''
  if (result.ok) then?.()
  else ob.error = failureText(result, view.value.connected, linkWords(view.value)?.why)
  return result
}

function choose(field: LookField, value: string): void {
  const d = ob.draft
  if (!d) return
  focus.key = `${field}:${value}`
  d.look = chooseLook(d.look, field, value, wardrobe)
  storeLook(d.look)
  refocus()
}
function onEditorTap(event: MouseEvent): void {
  const tab = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-look-tab]') : null
  if (tab) { focus.key = tab.dataset.key ?? ''; refocus() }
}
function shuffle(): void {
  const d = ob.draft
  if (!d) return
  focus.key = 'shuffle'
  // Picked here, from the lists the server validates; never the same look twice in a row.
  let next = randomLook()
  for (let tries = 0; tries < 4 && sameLook(next, d.look); tries++) next = randomLook()
  ob.undo = d.look
  d.look = next
  storeLook(next)
  lookFocusBody()
  refocus()
}
function undo(): void {
  const d = ob.draft
  if (!d || !ob.undo) return
  d.look = ob.undo
  ob.undo = null
  storeLook(d.look)
  lookFocusBody()
  focus.key = 'shuffle'
  refocus()
}
function pickTrait(id: TraitId): void { const d = ob.draft; if (!d) return; focus.key = `trait:${id}`; d.traits = toggleTrait(d.traits, id); refocus() }
function pickDream(id: DreamId): void { const d = ob.draft; if (!d) return; focus.key = `dream:${id}`; d.dream = id; refocus() }
function back(): void { focus.key = 'back'; ob.shown = Math.max(first.value, shown.value - 1); ob.error = '' }

/** The step's one primary action. */
async function primary(stay = false): Promise<void> {
  const d = ob.draft
  if (!d) return
  focus.key = stay ? 'stay' : 'primary'
  const action = foot.value.action
  if (action === 'to-home') ob.shown = LAST_STEP
  else if (action === 'look') await send('Saving…', () => command('onboarding.look', { look: d.look }), () => { ob.shown = 1; ob.undo = null; storeLook(null) })
  else if (action === 'traits') await send('Saving…', () => command('onboarding.traits', { traits: d.traits as [TraitId, TraitId] }), () => { ob.shown = 2 })
  else if (action === 'dream' && d.dream) { const dream = d.dream; await send('Saving…', () => command('onboarding.dream', { dream }), () => { ob.shown = 3 }) }
  else if (action === 'lottery') await send('Rolling…', () => command('onboarding.lottery', {}))
  else if (action === 'home') {
    const extra = homePayload(d.extra.area, stay)
    // The payload is built from the draft (lga, via, stay); the server validates it, as it does for any client.
    const result = await send('Moving in…', () => command('onboarding.home', extra as never))
    // The server's own sentence ("Welcome to …") is the one confirmation: the shell shows it as a toast when the state arrives.
    if (result.ok) {
      if (d.extra.area) { worldTrack('lga_chosen', { method: d.extra.area.via === 'device' ? 'device' : 'manual', lga: d.extra.area.lga }); worldChanged() }
      ob.draft = null
      focus.key = ''
      shell.close()
      return
    }
  }
  refocus()
}
</script>

<template>
  <div v-if="o.done" class="ob-root ob-done">
    <LookStage :look="o.look" variant="wide" :name="name" />
    <h3>{{ name }} is ready</h3>
    <p>{{ o.legacy ? 'This life started before character creation existed, so nothing was changed.' : 'Your Sim has moved in.' }} You can change your look any time in Sim → Profile.</p>
    <button type="button" class="ui-button is-primary" @click="shell.open('profile')">Edit look</button> <button type="button" class="ui-button" @click="shell.close()">Close</button>
  </div>
  <div v-else-if="draft" ref="root" class="ob-root" :data-step="shown">
    <p v-if="intro" class="ob-intro" :class="{ 'is-reward': intro.kind === 'reward' }"><span aria-hidden="true"><GameIcon :name="intro.kind === 'why' ? 'home' : 'star'" inline /></span><span><strong>{{ intro.strong }}</strong>{{ intro.text }}</span></p>
    <div class="ob-head">
      <button v-if="shown > first" type="button" class="sheet-back" data-key="back" :aria-label="`Back to ${ONBOARDING_STEPS[shown - 1]?.label ?? ''}`" @click="back"><GameIcon name="back" bare /></button>
      <div class="ob-head-main">
        <strong>Step {{ shown + 1 - first }} of {{ count }} · {{ ONBOARDING_STEPS[shown]?.label }}</strong>
        <ol class="ob-steps" aria-label="Progress">
          <li v-for="item in steps" :key="item.step.id" :class="[{ 'is-done': item.index < o.step }, { 'is-current': item.index === shown }]" :aria-current="item.index === shown ? 'step' : undefined"><i aria-hidden="true">{{ item.index < o.step && item.index !== shown ? '✓' : item.index + 1 - first }}</i><span>{{ item.step.label }}</span></li>
        </ol>
      </div>
    </div>
    <p v-if="words" class="ob-note" role="status"><span aria-hidden="true"><GameIcon name="cloud-off" inline /></span><span><strong>{{ words.short }} — keep going.</strong> {{ words.why }} Your choices are kept on this device and are saved as soon as you are connected again.</span><LinkAction class-name="ui-button is-small ob-note-action" /></p>
    <p v-if="ob.error" class="ob-error" role="alert">{{ ob.error }}</p>

    <div v-if="shown === 0" class="ob-creator">
      <div class="ob-hero">
        <LookStage :look="draft.look" variant="hero" :name="name" :caption="lookSummary(draft.look)">
          <template #tools>
            <button type="button" class="look-tool" data-key="undo" :disabled="!ob.undo || Boolean(ob.pending)" aria-label="Undo the last shuffle" @click="undo">↶ Undo</button><button type="button" class="look-tool is-main" data-key="shuffle" :disabled="Boolean(ob.pending)" @click="shuffle"><GameIcon name="game" inline /> Shuffle</button>
          </template>
        </LookStage>
      </div>
      <div class="ob-options" @click="onEditorTap"><LookEditor :look="draft.look" :owned="wardrobe" @choose="choose" /></div>
    </div>

    <StepWithSim v-else-if="shown === 1" :look="draft.look" :name="name">
      <p class="ob-lead"><b>Pick {{ TRAITS_REQUIRED }} traits — each one is a boost.</b> They change how {{ name }} plays from the moment you move in.</p>
      <div class="ob-grid">
        <button v-for="trait in traits" :key="trait.id" type="button" class="ob-card" :data-trait="trait.id" :data-key="`trait:${trait.id}`" :aria-pressed="draft.traits.includes(trait.id)" @click="pickTrait(trait.id)"><span class="ob-card-icon" aria-hidden="true"><GameIcon kind="trait" :id="trait.id" :emoji="trait.icon" inline /></span><strong>{{ trait.label }}</strong><small>{{ trait.blurb }}</small><ul><li v-for="line in trait.effects" :key="line">{{ line }}</li></ul></button>
      </div>
      <p class="preview-note">Trait strengths are original beta values. Picking a third trait swaps out your first pick.</p>
    </StepWithSim>

    <StepWithSim v-else-if="shown === 2" :look="draft.look" :name="name">
      <p class="ob-lead"><b>{{ dreamLead() }}</b> What is {{ name }}’s big dream?</p>
      <div class="ob-list">
        <button v-for="dream in dreams" :key="dream.id" type="button" class="ob-card is-row" :data-dream="dream.id" :data-key="`dream:${dream.id}`" :aria-pressed="draft.dream === dream.id" @click="pickDream(dream.id)"><span class="ob-card-icon" aria-hidden="true"><GameIcon kind="dream" :id="dream.id" :emoji="dream.icon" inline /></span><span><strong>{{ dream.label }}</strong><small>{{ dream.goal }}</small><small class="ob-faint">{{ dream.measure }}</small></span></button>
      </div>
    </StepWithSim>

    <StepWithSim v-else-if="shown === 3" :look="draft.look" :name="name">
      <template v-if="!o.lottery">
        <p class="ob-lead"><b>Roll the birth lottery — it decides your start cash.</b> Everyone in this city is born into something. Roll once to find out what {{ name }} starts with.</p>
        <div class="ob-lottery is-waiting" aria-hidden="true"><GameIcon name="game" inline /></div>
        <p class="preview-note">{{ LOTTERY_NOTE }}</p>
      </template>
      <template v-else>
        <div class="ob-lottery"><span class="ob-card-icon" aria-hidden="true"><GameIcon kind="lottery" :id="o.lottery.id" :emoji="o.lottery.icon" inline /></span><h3>{{ o.lottery.label }}</h3><p>{{ o.lottery.tagline }}</p><ul><li v-for="line in o.lottery.bullets" :key="line">{{ line }}</li></ul><p v-if="o.lottery.beta" class="preview-note">Original beta outcome.</p></div>
        <p class="preview-note">{{ LOTTERY_NOTE }}</p>
      </template>
    </StepWithSim>

    <StepWithSim v-else :look="draft.look" :name="name">
      <p class="ob-lead"><b>Your own house — free, furnished, with your start cash.</b> Everyone in this city gets a starter house on their own plot. Where will {{ name }} live?{{ kept }}</p>
      <div class="ob-list"><div class="ob-card is-row ob-home is-own"><span class="ob-card-icon" aria-hidden="true"><GameIcon kind="home" id="own" emoji="🏠" inline /></span><span><em class="ob-tag">Yours</em><strong>Starter house<template v-if="areaName"> · {{ areaName }}</template></strong><small>One good room on your own plot, furnished, with food in the kitchen.</small><small class="ob-money"><template v-if="o.own?.startCash != null">Start with {{ money(o.own.startCash) }} · </template>no rent</small></span></div></div>
      <div class="ob-extra" data-extra-root="area"><HomeLgaPick v-model="draft.extra.area" /></div>
      <p class="preview-note">Prefer to rent? <template v-if="rentalNames">Homes in {{ rentalNames }}</template><template v-else>Local rental homes</template> are in Phone → Houses once you have moved in. You keep your own house either way.</p>
    </StepWithSim>

    <div class="ob-foot">
      <p v-if="foot.why && !pendingLabel" class="ob-foot-why">{{ foot.why }}</p>
      <button type="button" class="ui-button is-primary ob-primary" data-key="primary" :disabled="foot.disabled || Boolean(pendingLabel)" @click="primary()">{{ pendingLabel || foot.label }}</button>
      <button v-if="canStay" type="button" class="ui-button ob-stay" data-key="stay" :disabled="Boolean(pendingLabel)" @click="primary(true)">Move in, but stay here for now</button>
      <button v-if="o.guest" type="button" class="ui-button ob-later" data-key="later" @click="shell.close()">Not now — keep playing</button>
    </div>
  </div>
</template>
