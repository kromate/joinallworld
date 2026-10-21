<script setup lang="ts">
// Phone → World event (docs/WORLD-EVENTS.md): this week's event, its bar, how to help, the AI helpers (always marked AI), your badges, the
// result card, and election night's board. Every step is checked by the server; the buttons only ask.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { eventStep, loadEvent, worldEvent } from './eventStore.ts'
import { howWords, untilWords, whenWords } from './eventWords.ts'
import { venueFor } from '../../../game/cities/runtime.ts'
import { shareGist } from '../growth/shareMoment.ts'

const ElectionBoard = defineAsyncComponent(() => import('./ElectionBoard.vue'))
const { game } = useApp()
const clock = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { void loadEvent(true, true); timer = setInterval(() => { clock.value = Date.now(); void loadEvent(false, true) }, 10000) })
onBeforeUnmount(() => { if (timer !== undefined) clearInterval(timer) })
const now = computed(() => { void clock.value; return game.serverNow() })
const event = computed(() => worldEvent.view?.event ?? null)
const mine = computed(() => worldEvent.mine)
const venueName = (city: string, id: string): string => { try { return venueFor(city, id)?.label ?? id } catch { return id.replace(/-/g, ' ') } }
const venues = computed(() => (event.value ? event.value.venues.map((id) => venueName(event.value!.city, id)) : []))
const status = computed(() => {
  const e = event.value
  if (!e) return ''
  if (e.phase === 'announced') return `${whenWords(e.startsAt)} (Lagos time) · starts ${untilWords(e.startsAt - now.value)}`
  if (e.phase === 'warmup') return `Warm-up: the admins are in town. Starts ${untilWords(e.startsAt - now.value)}.`
  if (e.phase === 'live') return `On now · ends ${untilWords(e.endsAt - now.value)}`
  return e.done ? 'Done. The city looks different for a week.' : 'Over for this week.'
})
const answers = ref<Record<string, string>>({})
const problem = ref<string | null>(null)
async function act(op: 'pickup' | 'drop' | 'grab' | 'answer', question?: string): Promise<void> {
  problem.value = await eventStep(op, question ? { question, answer: answers.value[question] ?? '' } : {})
  if (!problem.value) game.toast(op === 'pickup' ? 'You picked up a load. Carry it over.' : op === 'drop' ? 'Delivered! The bar moved.' : op === 'grab' ? 'You grabbed a surprise. It counts for the bar.' : 'Right! The bar moved.', 'good')
}
const changes = computed(() => (worldEvent.view?.changes ?? []).filter((item) => item.until > now.value))
const share = (n: number): void => shareGist(n, () => game.toast('That could not be shared. Try again.', 'error'))
</script>

<template>
  <section class="world-event-app" data-world-event="app" aria-label="World event">
    <p v-if="!worldEvent.view" class="social-note">Loading…</p>
    <p v-else-if="!event" class="social-note">There is no world event this week. Look again on Monday.</p>
    <template v-else>
      <header>
        <h2>{{ event.title }}</h2>
        <p class="social-note"><b>{{ event.cityName }}</b> · {{ status }}</p>
        <p class="social-note">{{ event.blurb }}</p>
      </header>
      <div class="world-event-bar" role="progressbar" :aria-valuenow="event.percent" aria-valuemin="0" aria-valuemax="100" :aria-label="`${event.percent}% of the goal`">
        <i :style="{ width: `${event.percent}%` }"></i>
      </div>
      <p class="social-note" data-world-event="count">{{ event.count }} of {{ event.target }} · {{ event.people }} {{ event.people === 1 ? 'person' : 'people' }} helping<template v-if="event.aiSteps"> · {{ event.aiSteps }} by AI</template></p>
      <p v-if="event.helpers.length" class="social-note" data-world-event="helpers">AI helpers: <span v-for="(helper, at) in event.helpers" :key="helper.name">{{ at ? ', ' : '' }}{{ helper.name }} (AI, {{ helper.steps }})</span></p>

      <div v-if="event.drop" class="world-event-part">
        <p class="social-note">A surprise drop has landed in the Square: {{ event.drop.left }} left.</p>
        <button type="button" class="ui-button is-primary" data-world-event="grab" :disabled="worldEvent.busy || !event.drop.left || mine?.grabbed.includes(event.drop.id)" @click="act('grab')">{{ mine?.grabbed.includes(event.drop.id) ? 'You have one' : 'Grab one (in the Square)' }}</button>
      </div>

      <div v-if="event.phase === 'live'" class="world-event-part">
        <p class="social-note">{{ howWords(event, venues) }}</p>
        <template v-if="event.goal === 'deliver'">
          <button v-if="!mine?.carrying" type="button" class="ui-button is-primary" data-world-event="pickup" :disabled="worldEvent.busy" @click="act('pickup')">Pick up a load</button>
          <button v-else type="button" class="ui-button is-primary" data-world-event="drop" :disabled="worldEvent.busy" @click="act('drop')">Put it down here</button>
        </template>
        <div v-else-if="event.goal === 'answer'" class="world-event-questions">
          <form v-for="item in event.questions" :key="item.id" class="world-event-question" @submit.prevent="act('answer', item.id)">
            <label :for="`we-${item.id}`">{{ item.q }}</label>
            <span v-if="mine?.answered.includes(item.id)" class="social-note">Answered.</span>
            <template v-else>
              <input :id="`we-${item.id}`" v-model="answers[item.id]" maxlength="60" autocomplete="off">
              <button type="submit" class="social-btn" :disabled="worldEvent.busy || !answers[item.id]">Answer</button>
            </template>
          </form>
        </div>
      </div>
      <p v-if="problem" class="ui-error" role="alert">{{ problem }}</p>
      <p v-if="mine?.badge" class="social-note" data-world-event="badge">You helped: this event’s badge is yours ({{ mine.steps }} {{ mine.steps === 1 ? 'step' : 'steps' }}).</p>
      <div v-if="event.resultLine" class="world-event-part">
        <p><b>{{ event.resultLine.text }}</b></p>
        <button type="button" class="ui-button" data-world-event="share" @click="share(event.resultLine.n)">Share the card</button>
      </div>
    </template>

    <div v-if="changes.length" class="world-event-part">
      <h3>Looking different this week</h3>
      <p v-for="item in changes" :key="item.city" class="social-note"><span class="world-event-swatch" :style="{ background: `linear-gradient(90deg, ${item.colours[0]}, ${item.colours[1]})` }" aria-hidden="true"></span>{{ item.label }}</p>
    </div>
    <div v-if="mine?.badges.length" class="world-event-part">
      <h3>Your event badges</h3>
      <p v-for="badge in mine.badges" :key="badge.week" class="social-note">🏅 {{ badge.title }}</p>
    </div>
    <ElectionBoard :city="game.cityId.value" />
  </section>
</template>

<style scoped>
.world-event-app { display: grid; gap: 10px; padding: 4px; overflow-wrap: anywhere; }
.world-event-app h2 { margin: 0; font-size: 18px; }
.world-event-app h3 { margin: 4px 0; font-size: 14px; }
.world-event-bar { height: 12px; border-radius: 6px; background: var(--c-fill, #eee); overflow: hidden; }
.world-event-bar i { display: block; height: 100%; background: linear-gradient(90deg, #f0a830, #2a9d8f); transition: width 0.4s; }
.world-event-part { display: grid; gap: 6px; }
.world-event-questions { display: grid; gap: 8px; }
.world-event-question { display: grid; grid-template-columns: 1fr auto; gap: 4px 8px; align-items: center; }
.world-event-question label { grid-column: 1 / -1; font-weight: 600; font-size: 13px; }
.world-event-question input { min-height: 44px; font: 400 16px var(--font, sans-serif); padding: 4px 8px; border: 1px solid var(--c-line, #ccc); border-radius: 8px; }
.world-event-swatch { display: inline-block; width: 22px; height: 10px; margin-right: 6px; border-radius: 3px; vertical-align: middle; }
</style>
