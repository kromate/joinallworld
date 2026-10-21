<script setup lang="ts">
// Drive a danfo: the motor park (docs/DANFO.md). The city's lines with this week's best driver on each, the day's earnings against the
// caps, runs leaving now that a player can ride along in (as a passenger or the conductor), the ride-along view, and each line's weekly
// board. Driving itself is full screen (DanfoRun.vue, loaded when a run starts). Game naira only; the server settles every run.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useApp } from '../../state/app.ts'
import { money } from '../../ui/format.ts'
import SectionTitle from '../../ui/SectionTitle.vue'
import { routeById, VEHICLE_WORDS } from '../../../danfo/routes.ts'
import type { DanfoPark, DanfoRole, DanfoRunView } from '../../../types/danfo.ts'
import { danfoApi } from './danfoApi.ts'
import type { BoardAnswerRow } from './danfoApi.ts'
import { voidWords } from './runModel.ts'
import { track } from '../world/worldModel.ts'

const DanfoRun = defineAsyncComponent(() => import('./DanfoRun.vue'))
const { game } = useApp()
const api = danfoApi(game.fetchJson)
const city = computed(() => game.view.value.cityId)
const park = shallowRef<DanfoPark | null>(null)
const error = ref('')
const busy = ref(false)
const driving = shallowRef<DanfoRunView | null>(null)
const board = shallowRef<{ route: string; rows: BoardAnswerRow[]; you: number } | null>(null)
const note = ref('')
let timer: ReturnType<typeof setInterval> | undefined

const minutes = (ms: number): string => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
const lineName = (id: string): string => routeById(id)?.name ?? id
const trafficWord = computed(() => { const t = park.value?.traffic ?? 0; return t >= 0.7 ? 'heavy go-slow' : t >= 0.45 ? 'busy' : 'light' })
const riding = computed(() => park.value?.riding ?? null)
const ridingLine = computed(() => (riding.value ? routeById(riding.value.routeId) : undefined))

async function load(): Promise<void> {
  const answer = await api.park(city.value)
  if (answer.ok) { park.value = answer; error.value = '' } else error.value = answer.reason
}
async function drive(routeId: string): Promise<void> {
  if (busy.value) return
  busy.value = true; note.value = ''
  const answer = await api.start(city.value, routeId, game.newId())
  busy.value = false
  if (!answer.ok) { note.value = answer.reason; return }
  board.value = null
  driving.value = answer.run
}
function resume(run: DanfoRunView): void { driving.value = run }
async function leaveMine(run: DanfoRunView): Promise<void> { await api.abandon(run.id); await load() }
function closed(): void { driving.value = null; void load() }
async function again(routeId: string): Promise<void> { driving.value = null; await load(); await drive(routeId) }

async function join(runId: string, role: DanfoRole): Promise<void> {
  const answer = await api.join(runId, role)
  if (!answer.ok) { note.value = answer.reason; return }
  track('danfo_crew', { role })
  await load()
}
async function getDown(runId: string): Promise<void> { await api.leave(runId); await load() }
async function shout(runId: string): Promise<void> {
  const answer = await api.shout(runId)
  if (!answer.ok) note.value = answer.reason
  else if (park.value) park.value = { ...park.value, riding: answer.run }
}
async function collect(runId: string): Promise<void> {
  const answer = await api.collect(runId, game.newId())
  if (!answer.ok) { note.value = answer.reason; return }
  note.value = answer.paid ? `Your share: ${money(answer.paid)} in game naira.` : 'Nothing to collect: today\'s limit for danfo work is reached.'
  void game.refresh()
  await load()
}
async function openBoard(route: string): Promise<void> {
  if (board.value?.route === route) { board.value = null; return }
  const answer = await api.board(route)
  if (answer.ok) board.value = { route, rows: answer.rows, you: answer.you }
  else note.value = answer.reason
}

onMounted(() => {
  void load()
  timer = setInterval(() => { if (!driving.value) void load() }, 5000)
})
onBeforeUnmount(() => { if (timer !== undefined) clearInterval(timer) })
</script>

<template>
  <section class="danfo-app" aria-labelledby="danfo-title" data-danfo="park">
    <header class="danfo-head">
      <span class="danfo-badge" aria-hidden="true">🚌</span>
      <div>
        <h2 id="danfo-title">Drive a danfo</h2>
        <p>{{ park ? `At ${park.hub}` : 'The motor park' }} · traffic {{ trafficWord }}</p>
      </div>
    </header>
    <p class="social-note">Take a bus down a real line of the city. Stop for people, drop them where they are going, and collect the fares in game naira. Brake hard, crash or pass a stop and it costs you. Friends can ride along or be your conductor.</p>
    <p v-if="error" class="ui-error" role="alert">{{ error }} <button type="button" class="social-btn" @click="load">Try again</button></p>
    <p v-else-if="!park" class="ui-note" role="status">Opening the motor park…</p>
    <template v-else>
      <p v-if="!park.open && park.lines.length" class="ui-note" role="status">The motor park is closed for now. Come back later.</p>
      <p v-if="!park.lines.length" class="ui-note" role="status">No danfo-type line runs from this city's motor park yet. Lines run in Lagos, Abuja, Ibadan, Port Harcourt, Accra, Nairobi, Kampala and Dar es Salaam.</p>
      <p class="danfo-today">Today: {{ money(park.today.earned) }} of {{ money(park.caps.day) }} · {{ park.today.runs }} of {{ park.caps.runs }} paid runs</p>
      <p v-if="note" class="ui-note" role="status">{{ note }}</p>

      <div v-if="park.mine" class="danfo-card" data-danfo="mine">
        <strong>Your {{ lineName(park.mine.routeId) }} run is on the road</strong>
        <p v-if="park.mine.next === 1">You have not reached the first stop yet.</p>
        <p v-else>You were at stop {{ park.mine.next - 1 }}. A run cannot be picked up halfway: leave it and start again.</p>
        <div class="danfo-row-actions">
          <button v-if="park.mine.next === 1" type="button" class="ui-button is-primary" @click="resume(park.mine)">Drive</button>
          <button type="button" class="ui-button" @click="leaveMine(park.mine)">Leave this run</button>
        </div>
      </div>

      <div v-if="riding && ridingLine" class="danfo-card" data-danfo="riding">
        <strong>{{ riding.you === 'conductor' ? 'You are the conductor' : 'You are riding' }} in {{ riding.driver }}'s {{ VEHICLE_WORDS[ridingLine.vehicle] }}</strong>
        <p>{{ ridingLine.name }} · {{ ridingLine.road }}</p>
        <ol class="danfo-stops">
          <li v-for="(stop, i) in ridingLine.stops" :key="stop.name" :class="{ 'is-done': i > 0 && i < riding.next, 'is-next': i === riding.next && riding.status === 'live' }">
            {{ stop.name }}<span v-if="i > 0 && riding.calls[i - 1] === 'passed'"> · passed</span>
          </li>
        </ol>
        <ul v-if="riding.shouts.length" class="danfo-shouts">
          <li v-for="item in riding.shouts.slice(-3)" :key="item.at"><b>{{ item.by }}:</b> {{ item.line }}</li>
        </ul>
        <p v-if="riding.status === 'void' || riding.status === 'closed'">{{ voidWords(riding.reason) }}</p>
        <p v-if="riding.result">The run made {{ money(riding.result.earned) }} in {{ minutes(riding.result.ms) }}.</p>
        <div class="danfo-row-actions">
          <button v-if="riding.you === 'conductor' && riding.status === 'live'" type="button" class="ui-button is-primary" @click="shout(riding.id)">Call the stop</button>
          <button v-if="riding.you === 'conductor' && riding.status === 'settled' && riding.share === null" type="button" class="ui-button is-primary" @click="collect(riding.id)">Collect your share</button>
          <button type="button" class="ui-button" @click="getDown(riding.id)">{{ riding.status === 'live' ? 'Get down' : 'Done' }}</button>
        </div>
      </div>

      <SectionTitle v-if="park.lines.length">Lines from the motor park</SectionTitle>
      <ul class="social-list">
        <li v-for="item in park.lines" :key="item.id" class="danfo-line" :data-danfo-line="item.id">
          <div class="danfo-line-head">
            <div>
              <strong>{{ item.name }}</strong>
              <small>{{ item.road }} · {{ item.stops.length }} stops · {{ item.km }} km · {{ VEHICLE_WORDS[item.vehicle] }}</small>
              <small v-if="item.best">Best this week: {{ item.best.name }}, {{ money(item.best.earned) }} in {{ minutes(item.best.ms) }}</small>
              <small v-else>Nobody has driven it this week. Be the first.</small>
            </div>
          </div>
          <div class="danfo-row-actions">
            <button type="button" class="ui-button is-primary" :disabled="busy || !park.open || Boolean(park.mine)" data-danfo="drive" @click="drive(item.id)">Drive</button>
            <button type="button" class="ui-button" :aria-expanded="board?.route === item.id" @click="openBoard(item.id)">Weekly board</button>
          </div>
          <ol v-if="board?.route === item.id" class="danfo-board" aria-label="This week's best drivers">
            <li v-if="!board.rows.length">No runs yet this week.</li>
            <li v-for="(row, i) in board.rows" :key="i" :class="{ 'is-you': board.you === i + 1 }"><span>{{ i + 1 }}. {{ row.name }}</span><span>{{ money(row.earned) }} · {{ minutes(row.ms) }}</span></li>
          </ol>
        </li>
      </ul>

      <template v-if="park.leaving.length">
        <SectionTitle>Leaving now</SectionTitle>
        <ul class="social-list">
          <li v-for="item in park.leaving" :key="item.id" class="social-row">
            <div><strong>{{ item.driver }} · {{ lineName(item.routeId) }}</strong><small>{{ item.next > 1 ? `Past stop ${item.next - 1}` : 'At the park' }} · {{ item.crew }} riding along{{ item.conductor ? ' · has a conductor' : '' }}</small></div>
            <span class="social-actions">
              <button type="button" class="social-btn" :disabled="Boolean(riding)" @click="join(item.id, 'passenger')">Ride</button>
              <button v-if="!item.conductor" type="button" class="social-btn" :disabled="Boolean(riding)" @click="join(item.id, 'conductor')">Be the conductor</button>
            </span>
          </li>
        </ul>
      </template>
      <p class="danfo-fine">Game naira only, paid by the game into your wallet. At most {{ money(park.caps.run) }} a run and {{ money(park.caps.day) }} a day. Never real money, and nobody can withdraw it for you.</p>
    </template>
    <DanfoRun v-if="driving && park" :run="driving" :view3d="park.view3d" @close="closed" @again="again" />
  </section>
</template>

<style scoped>
.danfo-app { display: flex; flex-direction: column; gap: 10px; }
.danfo-head { display: flex; gap: 12px; align-items: center; }
.danfo-head h2 { margin: 0; font-size: 20px; }
.danfo-head p { margin: 2px 0 0; font-size: 14px; opacity: .8; }
.danfo-badge { font-size: 30px; width: 48px; height: 48px; display: grid; place-items: center; border-radius: 14px; background: #f4c20d; }
.danfo-today { margin: 0; font-weight: 600; font-size: 14px; }
.danfo-app .social-list { padding: 0; list-style: none; }
.danfo-app .social-list > .danfo-line { padding: 12px 14px; }
.danfo-app .social-list > .danfo-line:last-child { border-bottom: 0; }
.danfo-card { border-radius: 14px; padding: 12px; background: rgba(244, 194, 13, .14); border: 1px solid rgba(244, 194, 13, .5); }
.danfo-card p { margin: 4px 0; font-size: 14px; }
.danfo-line { display: flex; flex-direction: column; gap: 8px; padding: 10px 0; border-bottom: 1px solid rgba(127,127,127,.2); }
.danfo-line-head small { display: block; font-size: 13px; opacity: .8; margin-top: 2px; }
.danfo-row-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.danfo-stops { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 0; margin: 8px 0; list-style: none; font-size: 12px; }
.danfo-stops li { opacity: .6; }
.danfo-stops li.is-done { opacity: 1; text-decoration: line-through; }
.danfo-stops li.is-next { opacity: 1; font-weight: 700; color: #b8860b; }
.danfo-shouts { margin: 6px 0; padding-left: 16px; font-size: 13px; }
.danfo-board { margin: 0; padding: 0; list-style: none; font-size: 13px; }
.danfo-board li { display: flex; justify-content: space-between; padding: 3px 0; }
.danfo-board li.is-you { font-weight: 700; }
.danfo-fine { font-size: 13px; opacity: .8; margin: 6px 0 0; }
</style>
