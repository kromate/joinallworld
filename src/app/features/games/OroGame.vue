<script setup lang="ts">
// Oro: the word puzzle. `daily` is the one puzzle everybody gets today, judged by the server (the answer
// is never here until it is over); `practice` is a random word from the answer list in this browser.
// Six rows of five tiles, an on-screen keyboard that also takes the physical one, and a result card.
// Tiles are plain elements with labels for screen readers; the flip is a CSS animation that reduced
// motion switches off.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import BaseButton from '../../ui/BaseButton.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import { loadShareModule } from '../growth/boundary.ts'
import { useGrowth } from '../growth/useGrowth.ts'
import type { OroMark, OroView } from '../../../types/growth.ts'
import {
  KEY_ROWS, MAX_GUESSES, ORO_RULES, WORD_LENGTH, backspace, barWidths, canSubmit, keyOf, keyStates, refusalWords, tileLabel, typeLetter, untilNext, winRate,
} from './oroModel.ts'

const props = defineProps<{ mode: 'daily' | 'practice' }>()
const emit = defineEmits<{ close: []; state: [view: OroView] }>()
const { game } = useApp()
const growth = useGrowth()

type Row = { word: string; marks: OroMark[] }
const rows = ref<Row[]>([])
const draft = ref('')
const status = ref<'loading' | 'playing' | 'won' | 'lost' | 'error'>('loading')
const answer = ref('')
const no = ref(0)
const stats = ref<OroView['stats'] | null>(null)
const shareLine = ref('')
const message = ref('')
const shake = ref(false)
const busy = ref(false)
const hard = ref(false)
const failure = ref('')
const now = ref(Date.now())
let target = ''
let tick: ReturnType<typeof setInterval> | null = null

const HARD_KEY = 'oro-hard'
const done = computed(() => status.value === 'won' || status.value === 'lost')
const states = computed(() => keyStates(rows.value))
const tiles = computed(() => Array.from({ length: MAX_GUESSES }, (_, r) => {
  const row = rows.value[r]
  return Array.from({ length: WORD_LENGTH }, (_, c) => {
    if (row) return { letter: row.word.charAt(c), mark: row.marks[c] ?? null, live: false }
    const live = r === rows.value.length && !done.value
    return { letter: live ? draft.value.charAt(c) : '', mark: null, live }
  })
}))
const solvedIn = computed(() => (status.value === 'won' ? rows.value.length : 0))

function say(text: string, bad = false): void {
  message.value = text
  if (bad && !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { shake.value = true; setTimeout(() => { shake.value = false }, 450) }
}
const announce = (event: string): void => { try { window.dispatchEvent(new CustomEvent('jaw:table', { detail: { game: 'oro', event } })) } catch { /* no listener is fine */ } }

function take(view: OroView): void {
  rows.value = view.rows.map((row) => ({ word: row.word, marks: row.marks.slice() }))
  no.value = view.no; stats.value = view.stats
  if (view.hard) hard.value = true
  status.value = view.status
  if (view.answer) answer.value = view.answer
  shareLine.value = view.share ?? ''
  emit('state', view)
}

async function loadDaily(): Promise<void> {
  status.value = 'loading'
  const result = await growth.call<OroView>('/api/growth/oro/state', {})
  if (result.ok && 'rows' in result) { take(result); failure.value = ''; return }
  failure.value = refusalWords(undefined, (result as { reason?: string }).reason); status.value = 'error'
}
async function loadPractice(): Promise<void> {
  const words = await import('../../../words/guess.ts')
  target = words.answerAt(Math.floor(Math.random() * words.ANSWER_COUNT))
  rows.value = []; draft.value = ''; answer.value = ''; status.value = 'playing'; no.value = 0; message.value = ''
}

async function submit(): Promise<void> {
  if (busy.value || done.value) return
  if (!canSubmit(draft.value)) { say('Not enough letters.', true); return }
  const word = draft.value
  busy.value = true
  try {
    if (props.mode === 'practice') {
      const [guess, oro] = await Promise.all([import('../../../words/guess.ts'), import('../../../words/oro.ts')])
      if (!guess.isGuess5(word)) { say('That is not in the word list.', true); return }
      if (hard.value) {
        const reason = oro.checkHardMode(rows.value.map((r) => r.word), rows.value.map((r) => r.marks), word)
        if (reason) { say(reason, true); return }
      }
      rows.value = [...rows.value, { word, marks: oro.scoreGuess(word, target) }]
      draft.value = ''; message.value = ''
      if (word === target) { status.value = 'won'; answer.value = target; announce('win') }
      else if (rows.value.length >= MAX_GUESSES) { status.value = 'lost'; answer.value = target; announce('lose') }
      else announce('guess')
      return
    }
    const result = await growth.call<OroView>('/api/growth/oro/guess', { no: no.value, n: rows.value.length, word, hard: hard.value })
    if (result.ok && 'rows' in result) {
      take(result); draft.value = ''; message.value = ''
      announce(result.status === 'won' ? 'win' : result.status === 'lost' ? 'lose' : 'guess')
      return
    }
    const refused = result as { code?: string; reason?: string; state?: OroView }
    if (refused.state) take(refused.state)
    if (refused.code === 'stale_guess' || refused.code === 'wrong_day') { await loadDaily(); draft.value = '' }
    say(refusalWords(refused.code, refused.reason), true)
  } finally { busy.value = false }
}

function press(key: string): void {
  if (done.value || status.value !== 'playing') return
  if (key === 'enter') void submit()
  else if (key === 'back') draft.value = backspace(draft.value)
  else draft.value = typeLetter(draft.value, key)
  if (key !== 'enter') message.value = ''
}
function onKey(event: KeyboardEvent): void {
  const from = event.target as HTMLElement | null
  if (from && (from.tagName === 'INPUT' || from.tagName === 'SELECT' || from.tagName === 'TEXTAREA')) return
  // Enter on a focused button presses that button; the keyboard below is made of buttons.
  if (event.key === 'Enter' && from?.tagName === 'BUTTON') return
  const key = keyOf(event)
  if (key) { event.preventDefault(); press(key) }
}
function toggleHard(): void {
  if (rows.value.length) return
  hard.value = !hard.value
  try { localStorage.setItem(HARD_KEY, hard.value ? '1' : '0') } catch { /* private mode */ }
}
async function share(): Promise<void> {
  const text = shareLine.value
  if (!text) return
  const module = await loadShareModule()
  const outcome = await module.systemShare({ text, link: '', file: null, url: null, whatsapp: '', x: '' })
  if (outcome === 'unavailable') {
    if (await module.copyText(text)) game.toast('Result copied. Paste it into any chat.', 'good')
    else game.toast('Could not copy. Select the squares and copy them by hand.', 'error')
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  try { hard.value = localStorage.getItem(HARD_KEY) === '1' } catch { /* private mode */ }
  tick = setInterval(() => { now.value = Date.now() }, 30000)
  if (props.mode === 'daily') await loadDaily(); else await loadPractice()
})
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); if (tick) clearInterval(tick) })
defineExpose({ press })
</script>

<template>
  <div class="oro" :data-mode="mode">
    <p v-if="status === 'loading'" class="oro-note" role="status">Fetching today’s puzzle…</p>
    <template v-else-if="status === 'error'">
      <p class="oro-note" role="alert">{{ failure || 'The puzzle could not be loaded.' }}</p>
      <BaseButton @click="loadDaily">Try again</BaseButton>
    </template>
    <template v-else>
      <header class="oro-head">
        <b>{{ mode === 'daily' ? `Oro #${no}` : 'Oro practice' }}</b>
        <label class="oro-hard" :class="{ 'is-locked': rows.length > 0 }">
          <input type="checkbox" :checked="hard" :disabled="rows.length > 0 || done" @change="toggleHard"> Hard mode
        </label>
      </header>
      <div class="oro-grid" :class="{ 'is-shaking': shake }" role="grid" aria-label="Your guesses">
        <div v-for="(row, r) in tiles" :key="r" class="oro-row" role="row">
          <span v-for="(tile, c) in row" :key="c" class="oro-tile" role="gridcell" :class="[tile.mark ? `is-${tile.mark}` : '', { 'has-letter': tile.letter, 'is-live': tile.live }]" :style="{ '--d': `${c * 120}ms` }" :aria-label="tileLabel(tile.letter, tile.mark)">{{ tile.letter }}</span>
        </div>
      </div>
      <p class="oro-msg" role="status" aria-live="polite">{{ message }}</p>

      <section v-if="done" class="oro-result" :class="{ 'is-won': status === 'won' }" aria-label="Result">
        <h3>{{ status === 'won' ? (solvedIn === 1 ? 'First try!' : `Solved in ${solvedIn}`) : 'Not this time' }}</h3>
        <p v-if="status === 'lost'">The word was <b class="oro-answer">{{ answer.toUpperCase() }}</b>.</p>
        <template v-if="mode === 'daily' && stats">
          <ul class="oro-stats" aria-label="Your numbers">
            <li><b>{{ stats.played }}</b><small>Played</small></li>
            <li><b>{{ winRate(stats) }}%</b><small>Won</small></li>
            <li><b>{{ stats.streak }}</b><small>Streak</small></li>
            <li><b>{{ stats.best }}</b><small>Best</small></li>
          </ul>
          <ol class="oro-dist" aria-label="Solved in how many guesses">
            <li v-for="(w, i) in barWidths(stats.dist)" :key="i"><span>{{ i + 1 }}</span><i :style="{ width: `${w}%` }" :class="{ 'is-this': status === 'won' && solvedIn === i + 1 }">{{ stats.dist[i] || '' }}</i></li>
          </ol>
          <p class="oro-next">Next word in {{ untilNext(now) }}.</p>
          <pre class="oro-share" aria-label="Your result, as it will be shared">{{ shareLine }}</pre>
          <BaseButton variant="primary" @click="share">Share result</BaseButton>
        </template>
        <BaseButton v-if="mode === 'practice'" variant="primary" @click="loadPractice">Another word</BaseButton>
        <BaseButton @click="emit('close')">Back to Games</BaseButton>
      </section>
      <div v-else class="oro-keys" role="group" aria-label="Keyboard">
        <div v-for="(line, i) in KEY_ROWS" :key="line" class="oro-keyrow">
          <button v-if="i === 2" type="button" class="oro-key is-wide" @click="press('enter')">Enter</button>
          <button v-for="letter in line" :key="letter" type="button" class="oro-key" :class="states[letter] ? `is-${states[letter]}` : ''" :aria-label="`${letter}${states[letter] ? `, ${states[letter] === 'c' ? 'in the right place' : states[letter] === 'p' ? 'in the word' : 'not in the word'}` : ''}`" @click="press(letter)">{{ letter }}</button>
          <button v-if="i === 2" type="button" class="oro-key is-wide" aria-label="Delete" @click="press('back')">⌫</button>
        </div>
      </div>
      <HowItWorks id="oro-rules" :rules="ORO_RULES" label="How to play Oro" />
    </template>
  </div>
</template>

<style scoped>
.oro { display: grid; gap: 10px; justify-items: center; }
.oro > * { max-width: 100%; }
.oro-note { font-size: 13px; color: var(--c-muted); text-align: center; }
.oro-head { display: flex; width: min(100%, 340px); justify-content: space-between; align-items: center; font-size: 15px; }
.oro-hard { font-size: 12px; color: var(--c-muted); display: inline-flex; gap: 6px; align-items: center; min-height: 32px; }
.oro-hard.is-locked { opacity: .6; }
.oro-grid { display: grid; gap: 5px; width: min(100%, 300px); }
.oro-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; }
.oro-tile { aspect-ratio: 1; display: grid; place-items: center; border: 2px solid #c9ccd4; border-radius: 6px; font-size: clamp(22px, 8vw, 30px); font-weight: 800; text-transform: uppercase; background: #fff; color: #20232c; }
.oro-tile.has-letter { border-color: #7d828f; }
.oro-tile.is-live.has-letter { animation: oro-pop 120ms ease-out; }
.oro-tile.is-c { background: #3d9a5d; border-color: #3d9a5d; color: #fff; animation: oro-flip 420ms ease both; animation-delay: var(--d); }
.oro-tile.is-p { background: #d7a62b; border-color: #d7a62b; color: #fff; animation: oro-flip 420ms ease both; animation-delay: var(--d); }
.oro-tile.is-a { background: #6f7480; border-color: #6f7480; color: #fff; animation: oro-flip 420ms ease both; animation-delay: var(--d); }
.oro-grid.is-shaking { animation: oro-shake 400ms; }
.oro-msg { min-height: 20px; margin: 0; font-size: 13px; font-weight: 700; text-align: center; color: #9a3b2c; }
.oro-keys { display: grid; gap: 6px; width: min(100%, 420px); }
.oro-keyrow { display: flex; justify-content: center; gap: 5px; }
.oro-key { flex: 1 1 0; min-width: 0; height: 52px; border: 0; border-radius: 7px; background: #d9dce3; color: #20232c; font: inherit; font-weight: 700; font-size: 15px; text-transform: uppercase; cursor: pointer; padding: 0; }
.oro-key.is-wide { flex: 1.6 1 0; font-size: 12px; }
.oro-key:focus-visible { outline: 3px solid #1f6feb; outline-offset: 1px; }
.oro-key.is-c { background: #3d9a5d; color: #fff; }
.oro-key.is-p { background: #d7a62b; color: #fff; }
.oro-key.is-a { background: #6f7480; color: #fff; }
.oro-result { width: min(100%, 340px); background: #fff; border-radius: 16px; box-shadow: var(--e-1), var(--ring); padding: 14px; display: grid; gap: 8px; }
.oro-result.is-won { background: var(--c-green-soft); }
.oro-result h3 { margin: 0; font-size: 17px; }
.oro-result p { margin: 0; font-size: 13px; }
.oro-answer { letter-spacing: 2px; }
.oro-stats { list-style: none; display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin: 0; padding: 0; text-align: center; }
.oro-stats b { display: block; font-size: 20px; }
.oro-stats small { font-size: 11px; color: var(--c-muted); }
.oro-dist { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }
.oro-dist li { display: grid; grid-template-columns: 14px 1fr; gap: 6px; align-items: center; font-size: 12px; }
.oro-dist i { display: block; min-width: 18px; background: #6f7480; color: #fff; font-style: normal; text-align: right; padding: 1px 6px; border-radius: 3px; }
.oro-dist i.is-this { background: #3d9a5d; }
.oro-next { color: var(--c-muted); }
.oro-share { margin: 0; font: inherit; font-size: 18px; line-height: 1.25; white-space: pre-wrap; text-align: center; }
@keyframes oro-pop { from { transform: scale(.88); } to { transform: scale(1); } }
@keyframes oro-flip { 0% { transform: rotateX(0); } 50% { transform: rotateX(90deg); } 100% { transform: rotateX(0); } }
@keyframes oro-shake { 0%, 100% { transform: translateX(0); } 20%, 60% { transform: translateX(-6px); } 40%, 80% { transform: translateX(6px); } }
@media (prefers-reduced-motion: reduce) { .oro-tile, .oro-grid.is-shaking, .oro-tile.is-live.has-letter { animation: none !important; } }
</style>
