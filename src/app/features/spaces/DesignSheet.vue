<script setup lang="ts">
// Design a home or a group room with words (Describe) or by pasting a plan (Import). A plan is only a wish: the server checks
// every piece, and Apply buys through the ordinary furniture rules. Lazy: opened from Houses and from a group room's Build tab.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import '../../../ui/controls.css'
import { useApp } from '../../state/app.ts'
import BaseSheet from '../../ui/BaseSheet.vue'
import { plotOf, type Plot } from '../../../game/home-layout.ts'
import { ruledPlot } from '../../../game/home-plan.ts'
import { normalizeSpacePlan, SPACE_LIMITS, type SpacePlanV1, type SpaceProblem } from '../../../spaces/plan.ts'
import PlanPreview from './PlanPreview.vue'
import { aiStatus, apply, check, design } from './spacesClient.ts'
import { useGrowth } from '../growth/useGrowth.ts'
import { startParty } from '../visit/visitStore.ts'

const props = defineProps<{ target: 'home' | 'room'; roomId?: string }>()
/** `walk`: a home was applied and the player pressed Walk in; the Houses app opens the 3D screen. */
const emit = defineEmits<{ close: []; applied: []; walk: [] }>()
const { game } = useApp()
const growth = useGrowth()
const partied = ref(false)

const tab = ref<'describe' | 'import'>('describe')
const ai = ref(true)
const prompt = ref('')
const keep = ref(false)
const pasted = ref('')
const busy = ref<'' | 'design' | 'check' | 'apply'>('')
const error = ref('')
const plan = ref<SpacePlanV1 | null>(null)
const problems = ref<SpaceProblem[]>([])
const cost = ref(0)
const cash = ref<number | null>(null)
const floor = ref(0)
const plot = ref<Plot | null>(null)
const done = ref(false)
let attempt = 0

const where = computed(() => ({ target: props.target, ...(props.roomId ? { roomId: props.roomId } : {}) }))
const isHome = computed(() => props.target === 'home')
const examples = computed(() => (isHome.value ? ['Cosy family bungalow', 'Party house, big sound', 'Quiet study with plants'] : ['Chill spot for the gang', 'Study room', 'Party room']))
const naira = (n: number): string => `₦${Math.round(n).toLocaleString('en-NG')}`
const have = computed(() => cash.value ?? game.state.value.cash)
const short = computed(() => isHome.value && cost.value > have.value)
const floors = computed(() => plot.value?.floors ?? 1)
const canApply = computed(() => Boolean(plan.value) && !busy.value && !short.value)
const costLine = computed(() => (isHome.value ? `${naira(cost.value)} to buy · you have ${naira(have.value)}` : 'Room furniture is free'))
const problemLine = computed(() => `${problems.value.length} ${problems.value.length === 1 ? 'piece was' : 'pieces were'} moved or left out`)

onMounted(async () => {
  const on = await aiStatus(game)
  ai.value = on
  if (!on) tab.value = 'import'
})
onBeforeUnmount(() => { attempt++ })

function show(answer: { plan: SpacePlanV1; problems: SpaceProblem[]; cost: number; cash: number | null; space: { grid: number; owned: boolean } }): void {
  plot.value = ruledPlot(plotOf(answer.space.grid, answer.space.owned))
  plan.value = answer.plan; problems.value = answer.problems ?? []; cost.value = answer.cost ?? 0; cash.value = answer.cash; floor.value = 0
}
async function makeDesign(): Promise<void> {
  const text = prompt.value.trim()
  if (!text || busy.value) return
  error.value = ''; busy.value = 'design'
  const mine = ++attempt
  const answer = await design(game, where.value, text, isHome.value && keep.value)
  if (mine !== attempt) return
  busy.value = ''
  if (!answer.ok) { error.value = answer.reason; return }
  show(answer)
}
function cancel(): void { attempt++; busy.value = '' }
async function checkPasted(): Promise<void> {
  if (busy.value) return
  error.value = ''
  const text = pasted.value.trim()
  if (!text) { error.value = 'Paste a plan first.'; return }
  if (text.length > SPACE_LIMITS.pasted) { error.value = 'That is too long. A plan can be up to 32,000 characters.'; return }
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { error.value = 'That is not JSON. Paste the whole plan, starting with {'; return }
  const dropped: SpaceProblem[] = []
  const found = normalizeSpacePlan(parsed, dropped, props.target)
  if (!found) { error.value = 'That is not an Allworld space plan.'; return }
  busy.value = 'check'
  const mine = ++attempt
  const answer = await check(game, where.value, found)
  if (mine !== attempt) return
  busy.value = ''
  if (!answer.ok) { error.value = answer.reason; return }
  show({ ...answer, problems: [...dropped, ...(answer.problems ?? [])] })
}
async function applyPlan(): Promise<void> {
  const current = plan.value
  if (!current || !canApply.value) return
  error.value = ''; busy.value = 'apply'
  const answer = await apply(game, where.value, current, game.newId())
  busy.value = ''
  if (!answer.ok) { error.value = answer.reason; return }
  done.value = true
  emit('applied')
}
/** After a home is applied: the share card of the designed home (the `space` kind), or an owambe in it named after the plan. */
function sharePlace(): void { void growth.share('space', { surface: 'phone' }) }
async function throwParty(): Promise<void> {
  if (busy.value) return
  error.value = ''; busy.value = 'apply'
  const why = await startParty((plan.value?.title ?? '').slice(0, 40), 'gold')
  busy.value = ''
  if (why) { error.value = why; return }
  partied.value = true
}
function change(): void { plan.value = null; problems.value = []; error.value = '' }
</script>

<template>
  <BaseSheet open label="Design your space with AI" @close="emit('close')">
    <header class="sp-head"><h2>Design your {{ isHome ? 'home' : 'room' }}</h2><p>An AI draws it. You check it, then it is yours.</p></header>
    <div v-if="done" class="sp-body sp-done" role="status">
      <h3>{{ isHome ? 'Your home is ready' : 'Your room is ready' }}</h3>
      <p>{{ isHome ? 'The pieces are in place. Send it to your friends: they can walk in from the link.' : 'Everyone in the group can see the new pieces.' }}</p>
      <button type="button" class="ui-button is-primary is-block sp-btn" data-design="done" @click="isHome ? emit('walk') : emit('close')">{{ isHome ? 'Walk in' : 'Close' }}</button>
      <template v-if="isHome">
        <button type="button" class="ui-button is-block sp-btn" :disabled="growth.state.busy !== null" @click="sharePlace">{{ growth.state.busy === 'space' ? 'Preparing…' : 'Share my place' }}</button>
        <button type="button" class="ui-button is-block sp-btn" :disabled="busy !== '' || partied" @click="throwParty">{{ partied ? 'Party on: invite friends from Houses' : 'Throw a party here' }}</button>
      </template>
      <p v-if="error" class="sp-error" role="alert">{{ error }}</p>
    </div>
    <template v-else>
      <div class="sp-body">
        <template v-if="!plan">
          <template v-if="tab === 'describe'">
            <p v-if="!ai" class="sp-note">AI design is resting today. You can still paste a plan.</p>
            <template v-else>
              <label class="sp-label" for="sp-prompt">What do you want?</label>
              <textarea id="sp-prompt" v-model="prompt" class="sp-text" rows="4" maxlength="500" :disabled="busy === 'design'" placeholder="Tell the designer about your space" />
              <div class="sp-chips"><button v-for="example in examples" :key="example" type="button" :disabled="busy === 'design'" @click="prompt = example">{{ example }}</button></div>
              <label v-if="isHome" class="sp-check"><input v-model="keep" type="checkbox" :disabled="busy === 'design'" /> Keep what I have</label>
              <p v-if="busy === 'design'" class="sp-note" role="status">Drawing your space…</p>
              <button type="button" class="ui-button is-primary is-block sp-btn" :disabled="!prompt.trim() || busy === 'design'" @click="makeDesign">{{ busy === 'design' ? 'Drawing…' : 'Design' }}</button>
              <button v-if="busy === 'design'" type="button" class="ui-button is-block sp-btn" @click="cancel">Cancel</button>
            </template>
            <button type="button" class="sp-link" data-design="import" @click="tab = 'import'; error = ''">Have a plan file? Paste it instead</button>
          </template>
          <template v-else>
            <label class="sp-label" for="sp-paste">Paste a plan</label>
            <textarea id="sp-paste" v-model="pasted" class="sp-text sp-mono" rows="8" spellcheck="false" placeholder="{ &quot;schema&quot;: &quot;allworld-space&quot;, ... }" :disabled="busy === 'check'" />
            <button type="button" class="ui-button is-primary is-block sp-btn" :disabled="!pasted.trim() || busy === 'check'" @click="checkPasted">{{ busy === 'check' ? 'Checking…' : 'Check plan' }}</button>
            <button type="button" class="sp-link" data-design="describe" @click="tab = 'describe'; error = ''">Describe it in words instead</button>
          </template>
        </template>
        <template v-else>
          <h3 v-if="plan.title" class="sp-title">{{ plan.title }}</h3>
          <div v-if="floors > 1" class="sp-floors" role="group" aria-label="Floor">
            <button v-for="n in floors" :key="n" type="button" :class="{ 'is-on': floor === n - 1 }" :aria-pressed="floor === n - 1" @click="floor = n - 1">{{ n === 1 ? 'Ground' : `Floor ${n - 1}` }}</button>
          </div>
          <PlanPreview v-if="plot" :plan="plan" :plot="plot" :floor="floor" />
          <p class="sp-cost" :class="{ 'is-short': short }">{{ costLine }}</p>
          <p v-if="short" class="sp-cost is-short">You need {{ naira(cost - have) }} more</p>
          <details v-if="problems.length" class="sp-problems"><summary>{{ problemLine }}</summary><ul><li v-for="(problem, i) in problems" :key="i">{{ problem.reason }}</li></ul></details>
          <button type="button" class="ui-button is-primary is-block sp-btn" :disabled="!canApply" @click="applyPlan">{{ busy === 'apply' ? 'Applying…' : 'Apply' }}</button>
          <button type="button" class="ui-button is-block sp-btn" :disabled="busy === 'apply'" @click="change">Change</button>
        </template>
        <p v-if="error" class="sp-error" role="alert">{{ error }}</p>
      </div>
    </template>
  </BaseSheet>
</template>

<style scoped>
/* The phone hides the corner Close of the main sheet; this sheet opens over the app and needs its own. */
:deep(.base-sheet-close) { display: grid !important; }
.sp-head { padding: 16px 56px 8px 18px; }
.sp-head h2 { margin: 0; font-size: 18px; }
.sp-head p { margin: 2px 0 0; font-size: 13px; color: var(--c-ink-2); }
.sp-tabs { display: flex; gap: 6px; padding: 4px 18px 8px; }
.sp-tabs button, .sp-floors button { flex: 1; min-height: 44px; border: 0; border-radius: 12px; background: var(--c-fill); color: var(--c-ink); font: 600 14px var(--font); cursor: pointer; }
.sp-tabs button.is-on, .sp-floors button.is-on { background: var(--c-ink); color: #fff; }
.sp-body { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 18px 18px; display: flex; flex-direction: column; gap: 10px; }
.sp-label { font-size: 13px; font-weight: 600; }
.sp-text { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--c-line); border-radius: 12px; font: 16px/1.4 var(--font); color: var(--c-ink); resize: vertical; }
.sp-mono { font-family: ui-monospace, Menlo, monospace; }
.sp-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.sp-chips button { min-height: 44px; padding: 0 14px; border: 0; border-radius: 22px; background: var(--c-fill); color: var(--c-ink); font: 600 13px var(--font); cursor: pointer; }
.sp-chips button:hover { background: var(--c-fill-2); }
.sp-check { display: flex; align-items: center; gap: 8px; min-height: 44px; font-size: 14px; }
.sp-check input { width: 20px; height: 20px; }
.sp-btn { min-height: 44px; }
.sp-link { align-self: start; min-height: 44px; padding: 0; border: 0; background: none; font: 600 13px var(--font); color: var(--c-green-dark, #14532d); text-decoration: underline; cursor: pointer; }
.sp-note { margin: 0; font-size: 14px; color: var(--c-ink-2); }
.sp-title { margin: 0; font-size: 16px; }
.sp-floors { display: flex; gap: 6px; }
.sp-cost { margin: 0; font-size: 14px; font-weight: 600; }
.sp-cost.is-short { color: #b4531a; }
.sp-problems { font-size: 13px; color: var(--c-ink-2); }
.sp-problems summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; }
.sp-problems ul { margin: 0; padding-left: 18px; }
.sp-error { margin: 0; padding: 10px 12px; border-radius: 12px; background: #fdeceb; color: #a1281d; font-size: 14px; }
.sp-done { padding-top: 18px; }
.sp-done h3 { margin: 0; font-size: 18px; color: var(--c-good); }
.sp-done p { margin: 0; font-size: 14px; }
</style>
