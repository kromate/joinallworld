<script setup lang="ts">
// Market haggle (docs/MINI-GAMES.md): the city's main market (Lagos: Balogun Market and the Computer Village corner) and its AI traders. Pick a thing,
// make offers, and the trader answers: the server holds the floor price and decides every verdict, the trader remembers you from one visit to the next
// ("You again? Last price."), and an agreed price becomes a real purchase in the game's money. The best haggle becomes a card and a replay clip for Capture.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useApp } from '../../state/app.ts'
import SectionTitle from '../../ui/SectionTitle.vue'
import type { HaggleStalls, HaggleTalkView, HaggleTraderView } from '../../../types/minigames.ts'
import { minigamesApi } from './minigamesApi.ts'
import { GRADE_WORDS, MEMORY_WORDS, clock, naira, nextStep, offerChoices, readTyped, savedLine, secondsLeft } from './haggleModel.ts'
import { track } from '../world/worldModel.ts'

const { game, shell } = useApp()
const api = minigamesApi(game.fetchJson)
const city = computed(() => game.view.value.cityId)
const stalls = shallowRef<HaggleStalls | null>(null)
const error = ref('')
const note = ref('')
const busy = ref(false)
const picked = ref<{ trader: string; item: string } | null>(null)
const typed = ref('')
const now = ref(0)
let timer: ReturnType<typeof setInterval> | undefined, tick: ReturnType<typeof setInterval> | undefined

const traderOf = (key: string): HaggleTraderView | undefined => stalls.value?.traders.find((trader) => trader.key === key)
const talkOf = (trader: HaggleTraderView, item: string): HaggleTalkView | undefined => trader.talks.find((talk) => talk.item === item)
const active = computed(() => {
  const trader = picked.value ? traderOf(picked.value.trader) : undefined
  return trader && picked.value ? { trader, talk: talkOf(trader, picked.value.item), item: trader.items.find((item) => item.id === picked.value!.item) } : null
})
const step = computed(() => nextStep(active.value?.talk))
const chips = computed(() => (active.value?.talk ? offerChoices(active.value.talk.list, active.value.talk.ask) : []))
const left = computed(() => secondsLeft(active.value?.talk?.dealUntil ?? null, now.value))
const dayLeft = computed(() => (stalls.value ? stalls.value.today.cap - stalls.value.today.bought : 0))

function replace(trader: HaggleTraderView): void {
  if (!stalls.value) return
  stalls.value = { ...stalls.value, traders: stalls.value.traders.map((entry) => (entry.key === trader.key ? trader : entry)) }
}
async function load(): Promise<void> {
  const answer = await api.stalls(city.value)
  if (answer.ok) { stalls.value = answer.stalls; error.value = '' } else error.value = answer.reason
}
async function open(trader: HaggleTraderView, item: string): Promise<void> {
  if (busy.value || !stalls.value?.here) return
  busy.value = true; note.value = ''
  const answer = await api.open(city.value, trader.key, item)
  busy.value = false
  if (!answer.ok) { note.value = answer.reason; return }
  picked.value = { trader: trader.key, item }; typed.value = ''
  replace(answer.trader)
  track('haggle_talk', { action: 'open', grade: '' })
}
async function offer(value: number): Promise<void> {
  const current = active.value
  if (busy.value || !current || !Number.isFinite(value)) return
  busy.value = true; note.value = ''
  const answer = await api.offer(city.value, current.trader.key, current.talk?.item ?? '', value, game.newId())
  busy.value = false
  if (!answer.ok) { note.value = answer.reason; return }
  replace(answer.trader); typed.value = ''
  const talk = talkOf(answer.trader, current.talk?.item ?? '')
  if (talk?.state === 'deal') track('haggle_talk', { action: 'deal', grade: talk.grade ?? '' })
}
const sendTyped = (): void => { const value = readTyped(typed.value); if (value === null) { note.value = 'Type an amount in naira, for example 1700.'; return } void offer(value) }
async function buy(): Promise<void> {
  const current = active.value
  if (busy.value || !current?.talk) return
  busy.value = true; note.value = ''
  const answer = await api.buy(city.value, current.trader.key, current.talk.item, game.newId())
  busy.value = false
  if (!answer.ok) { note.value = answer.reason; await load(); return }
  replace(answer.trader)
  if (stalls.value) stalls.value = { ...stalls.value, best: answer.best, today: { ...stalls.value.today, bought: stalls.value.today.bought + 1 } }
  note.value = `Bought for ${naira(answer.paid)}. It is in your bag.`
  track('haggle_talk', { action: 'buy', grade: current.talk.grade ?? '' })
  void game.refresh()
}

async function walk(): Promise<void> {
  if (!stalls.value || busy.value) return
  busy.value = true
  const result = await game.command('travel', { id: stalls.value.marketVenue, mode: 'trek' })
  busy.value = false
  note.value = result.ok ? `On your way to ${stalls.value.marketName}. Come back here when you arrive.` : 'You cannot set off right now. Open the map to pick a way.'
}

// The best haggle: a card and a replay, handed to Capture, which adds the @handle mark and opens the share sheet.
async function share(kind: 'card' | 'clip'): Promise<void> {
  const best = stalls.value?.best
  if (!best || busy.value) return
  busy.value = true; note.value = kind === 'clip' ? 'Making your clip…' : ''
  try {
    const { haggleCardPhoto, haggleClip } = await import('./haggleCard.ts')
    const { adoptCapture } = await import('../capture/captureSession.ts')
    const photo = await haggleCardPhoto(best)
    let video: Blob | null = null, ms = 0
    if (kind === 'clip') { try { const made = await haggleClip(best); video = made.blob; ms = made.ms } catch { note.value = 'This browser cannot record a clip; your card is ready to share.' } }
    if (!adoptCapture({ photo, video, videoMs: ms })) { note.value = 'Capture is busy. Try again in a moment.'; return }
    track('haggle_talk', { action: video ? 'clip' : 'card', grade: best.grade })
    shell.open('capture')
  } catch { note.value = 'The card could not be made on this device.' } finally { busy.value = false }
}

onMounted(() => {
  now.value = game.serverNow()
  void load()
  timer = setInterval(() => { void load() }, 8000)
  tick = setInterval(() => { now.value = game.serverNow() }, 1000)
})
onBeforeUnmount(() => { if (timer !== undefined) clearInterval(timer); if (tick !== undefined) clearInterval(tick) })
</script>

<template>
  <section class="hg-app" aria-labelledby="hg-title" data-haggle="app">
    <header class="hg-head">
      <span class="hg-badge" aria-hidden="true">🤝</span>
      <div>
        <h2 id="hg-title">Market haggle</h2>
        <p>{{ stalls ? stalls.marketName : 'The market' }}<template v-if="stalls"> · {{ dayLeft }} of {{ stalls.today.cap }} buys left today</template></p>
      </div>
    </header>
    <p class="social-note">Haggle with the market's traders. They are AI-played characters who remember you, so come back and be a regular. Win a better price on something you really buy. Game naira only.</p>
    <p v-if="error" class="ui-error" role="alert">{{ error }} <button type="button" class="social-btn" @click="load">Try again</button></p>
    <p v-else-if="!stalls" class="ui-note" role="status">Opening the market…</p>
    <template v-else>
      <p v-if="!stalls.open" class="ui-note" role="status">The market is closed for now. Come back later.</p>
      <div v-if="stalls.open && !stalls.here" class="hg-card" data-haggle="away">
        <strong>You are not at {{ stalls.marketName }}</strong>
        <p>A haggle needs you at the stall.</p>
        <div class="hg-actions">
          <button type="button" class="ui-button is-primary" :disabled="busy" @click="walk">Walk there</button>
          <button type="button" class="ui-button" @click="shell.open('map')">Open the map</button>
        </div>
      </div>
      <p v-if="note" class="ui-note" role="status" data-haggle="note">{{ note }}</p>

      <ul class="hg-traders">
        <li v-for="trader in stalls.traders" :key="trader.key" class="hg-trader" :data-trader="trader.key">
          <div class="hg-trader-head">
            <strong>{{ trader.name }}</strong><span class="hg-ai">AI-played</span>
            <small>{{ trader.stall }} · {{ MEMORY_WORDS[trader.memory] }}</small>
            <small>{{ trader.blurb }}</small>
            <em>“{{ trader.greeting }}”</em>
          </div>
          <ul class="hg-items">
            <li v-for="item in trader.items" :key="item.id">
              <span aria-hidden="true">{{ item.icon }}</span>
              <span class="hg-item-name">{{ item.label }}<small>{{ naira(item.list) }}</small></span>
              <button type="button" class="social-btn" :disabled="busy || !stalls.open || !stalls.here || (dayLeft < 1 && talkOf(trader, item.id)?.state !== 'deal')" :data-item="item.id" @click="open(trader, item.id)">
                {{ talkOf(trader, item.id)?.state === 'bought' ? 'Bought' : talkOf(trader, item.id) ? 'Continue' : 'Haggle' }}
              </button>
            </li>
          </ul>

          <div v-if="active && active.trader.key === trader.key && active.talk" class="hg-talk" data-haggle="talk">
            <p class="hg-title">{{ active.talk.label }} · asking {{ naira(active.talk.ask) }}</p>
            <ol class="hg-lines" aria-live="polite">
              <li v-for="(line, at) in active.talk.lines" :key="at" :class="line.who === 'you' ? 'is-you' : 'is-trader'">{{ line.text }}</li>
            </ol>
            <template v-if="step === 'offer' || step === 'final'">
              <p class="hg-sub">{{ step === 'final' ? 'That is the last price. Take it, or walk away.' : `${active.talk.roundsLeft} ${active.talk.roundsLeft === 1 ? 'offer' : 'offers'} left` }}</p>
              <div v-if="step === 'offer'" class="hg-chips">
                <button v-for="value in chips" :key="value" type="button" class="social-btn" :disabled="busy" :data-offer="value" @click="offer(value)">{{ naira(value) }}</button>
              </div>
              <form v-if="step === 'offer'" class="hg-form" @submit.prevent="sendTyped">
                <label class="hg-label" for="hg-offer">Your offer in naira</label>
                <input id="hg-offer" v-model="typed" inputmode="numeric" autocomplete="off" maxlength="9" placeholder="1700" class="hg-input">
                <button type="submit" class="ui-button is-primary" :disabled="busy || !typed">Offer</button>
              </form>
              <button v-if="step === 'final'" type="button" class="ui-button is-primary" :disabled="busy" @click="offer(active.talk.ask)">Take it at {{ naira(active.talk.ask) }}</button>
            </template>
            <template v-else-if="step === 'buy'">
              <p class="hg-deal" data-haggle="deal">Deal: {{ naira(active.talk.deal ?? 0) }} for the {{ active.talk.label.toLowerCase() }} (you save {{ naira(active.talk.saved) }}{{ active.talk.grade ? ` · ${GRADE_WORDS[active.talk.grade]}` : '' }})</p>
              <p class="hg-sub">Held for you for {{ clock(left) }}</p>
              <button type="button" class="ui-button is-primary" :disabled="busy" data-haggle="buy" @click="buy">Buy for {{ naira(active.talk.deal ?? 0) }}</button>
            </template>
            <p v-else-if="step === 'done'" class="hg-deal" data-haggle="bought">Bought for {{ naira(active.talk.deal ?? 0) }}. {{ active.talk.saved > 0 ? `You saved ${naira(active.talk.saved)}.` : '' }}</p>
          </div>
        </li>
      </ul>

      <template v-if="stalls.best">
        <SectionTitle>Your best haggle</SectionTitle>
        <div class="hg-card" data-haggle="best">
          <strong>{{ savedLine(stalls.best) }}</strong>
          <p>{{ naira(stalls.best.list) }} down to {{ naira(stalls.best.price) }} at {{ stalls.best.trader }} · {{ GRADE_WORDS[stalls.best.grade] }}</p>
          <div class="hg-actions">
            <button type="button" class="ui-button is-primary" :disabled="busy" @click="share('clip')">Clip it</button>
            <button type="button" class="ui-button" :disabled="busy" @click="share('card')">Share card</button>
          </div>
        </div>
      </template>
      <p class="hg-fine">Game naira only, spent in the game. The traders are AI-played, and their prices are decided by the game, not by anything said in the chat. Never real money.</p>
    </template>
  </section>
</template>

<style scoped>
.hg-app { display: flex; flex-direction: column; gap: 10px; }
.hg-head { display: flex; gap: 12px; align-items: center; }
.hg-head h2 { margin: 0; font-size: 20px; }
.hg-head p { margin: 2px 0 0; font-size: 14px; opacity: .8; }
.hg-badge { font-size: 30px; width: 48px; height: 48px; display: grid; place-items: center; border-radius: 14px; background: #f59f00; }
.hg-card { border-radius: 14px; padding: 12px; background: rgba(245, 159, 0, .14); border: 1px solid rgba(245, 159, 0, .5); }
.hg-card p { margin: 4px 0; font-size: 14px; }
.hg-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.hg-traders { list-style: none; margin: 0; padding: 0; }
.hg-trader { display: flex; flex-direction: column; gap: 8px; padding: 10px 0; border-bottom: 1px solid rgba(127,127,127,.2); }
.hg-trader-head small, .hg-trader-head em { display: block; font-size: 13px; opacity: .85; margin-top: 2px; }
.hg-ai { margin-left: 8px; font-size: 11px; padding: 1px 6px; border-radius: 8px; background: rgba(127,127,127,.25); }
.hg-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.hg-items li { display: flex; align-items: center; gap: 10px; }
.hg-item-name { flex: 1; font-size: 14px; }
.hg-item-name small { display: block; font-size: 13px; opacity: .8; }
.hg-talk { border-radius: 14px; padding: 10px; background: rgba(127,127,127,.12); display: flex; flex-direction: column; gap: 8px; }
.hg-title { margin: 0; font-weight: 700; font-size: 14px; }
.hg-sub { margin: 0; font-size: 12px; opacity: .75; }
.hg-lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.hg-lines li { max-width: 86%; padding: 6px 10px; border-radius: 14px; font-size: 14px; }
.hg-lines li.is-trader { align-self: flex-start; background: #f1e6d3; color: #241a12; }
.hg-lines li.is-you { align-self: flex-end; background: #2f9e44; color: #fff; }
.hg-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.hg-form { display: flex; gap: 8px; align-items: end; flex-wrap: wrap; }
.hg-label { display: block; font-size: 12px; opacity: .75; flex-basis: 100%; }
.hg-input { flex: 1; min-width: 100px; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(127,127,127,.5); font-size: 16px; }
.hg-deal { margin: 0; font-weight: 700; font-size: 14px; }
.hg-fine { font-size: 13px; opacity: .8; margin: 6px 0 0; }
</style>
