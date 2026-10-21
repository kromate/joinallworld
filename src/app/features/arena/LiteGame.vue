<script setup lang="ts">
// Lite games: small games players made, all played by one engine (src/arena/lite/rules.ts). This screen is the front door. A new room
// first asks which game (the built-in ones and imported ones, GET /api/spaces/games) and offers "Paste a game" to import one
// (POST /api/spaces/games); a room someone shared goes straight to LiteRoom.vue, which plays it. A lazy chunk of the Games app.
import { onMounted, ref } from 'vue'
import BaseButton from '../../ui/BaseButton.vue'
import type { ArenaScreenProps } from '../../../arena/catalog.ts'
import ArenaStage from './ArenaStage.vue'
import LiteRoom from './LiteRoom.vue'

const props = defineProps<ArenaScreenProps>()
const emit = defineEmits<{ close: [] }>()

interface Entry { id: string; title: string; seats?: { min: number; max: number } | number; win?: string; controls?: string; mine?: boolean }
const chosen = ref<string>(props.intent.kind === 'join' ? '*' : '')
const games = ref<Entry[]>([])
const loading = ref(props.intent.kind !== 'join')
const failed = ref('')
const paste = ref('')
const importing = ref(false)
const problems = ref<string[]>([])
const said = ref('')
const MAX = 8 * 1024

async function load(): Promise<void> {
  loading.value = true; failed.value = ''
  try {
    const answer = await (await fetch('/api/spaces/games', { credentials: 'same-origin' })).json() as { ok?: boolean; games?: Entry[]; reason?: string }
    if (answer.ok && Array.isArray(answer.games)) games.value = answer.games
    else failed.value = answer.reason || 'Could not load the games.'
  } catch { failed.value = 'Could not load the games. Check your connection and try again.' }
  loading.value = false
}
async function importGame(): Promise<void> {
  problems.value = []; said.value = ''
  const text = paste.value.trim()
  if (!text) { problems.value = ['Paste a game first.']; return }
  if (text.length > MAX) { problems.value = [`A game is at most ${MAX} characters.`]; return }
  let def: unknown
  try { def = JSON.parse(text) } catch { problems.value = ['That is not valid JSON.']; return }
  importing.value = true
  try {
    const answer = await (await fetch('/api/spaces/games', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ def }) })).json() as { ok?: boolean; game?: Entry; reason?: string; problems?: string[] }
    if (answer.ok && answer.game) {
      const made = answer.game
      games.value = [made, ...games.value.filter((g) => g.id !== made.id)]
      said.value = `Added "${made.title}". Tap it to play.`; paste.value = ''
    } else problems.value = answer.problems?.length ? answer.problems : [answer.reason || 'That game was not accepted.']
  } catch { problems.value = ['Could not reach the server. Try again.'] }
  importing.value = false
}
onMounted(() => { if (props.intent.kind !== 'join') void load() })
</script>

<template>
  <LiteRoom v-if="chosen" :intent="intent" :game="chosen === '*' ? '' : chosen" @close="emit('close')" />
  <ArenaStage v-else title="Made by players" chip="Pick a game" @leave="emit('close')">
    <div class="lg" data-testid="lite-picker">
      <p v-if="loading" class="lg-small" role="status">Loading games…</p>
      <div v-else-if="failed" class="lg-card"><p>{{ failed }}</p><BaseButton @click="load">Try again</BaseButton></div>
      <ul v-else class="lg-list" aria-label="Games">
        <li v-for="g in games" :key="g.id">
          <button type="button" class="lg-pick" @click="chosen = g.id">
            <b>{{ g.title }}</b>
            <small>{{ g.controls === 'stick' ? 'Move anywhere' : 'Left and right' }}<template v-if="g.win"> · {{ g.win.replace(/-/g, ' ') }}</template><template v-if="g.mine"> · yours</template></small>
          </button>
        </li>
      </ul>
      <section class="lg-card" aria-label="Make a game">
        <h3>Make a game</h3>
        <label for="lite-paste">Paste a game</label>
        <textarea id="lite-paste" v-model="paste" class="lg-text" rows="6" :maxlength="MAX" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="{ &quot;schema&quot;: &quot;allworld-lite&quot;, … }" />
        <small class="lg-small">{{ paste.length }} / {{ MAX }}</small>
        <BaseButton variant="primary" :disabled="importing || !paste.trim()" @click="importGame">{{ importing ? 'Importing…' : 'Import' }}</BaseButton>
        <ul v-if="problems.length" class="lg-problems" role="alert"><li v-for="(p, i) in problems" :key="i">{{ p }}</li></ul>
        <p v-if="said" class="lg-said" role="status">{{ said }}</p>
      </section>
    </div>
  </ArenaStage>
</template>

<style scoped>
.lg { display: grid; gap: 12px; align-content: start; padding: 68px 10px 12px; overflow-y: auto; max-height: 100%; box-sizing: border-box; }
.lg-small { margin: 0; font-size: 12px; color: var(--c-muted); }
.lg-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px; }
.lg-pick { width: 100%; min-height: 56px; display: grid; gap: 2px; text-align: left; padding: 10px 14px; border: 2px solid #2b2233; border-radius: 14px; background: #f3efe8; color: #2b2233; font: inherit; cursor: pointer; touch-action: manipulation; }
.lg-pick b { font-size: 16px; } .lg-pick small { font-size: 12px; color: #5a5160; }
.lg-pick:active { background: #ffd34d; }
.lg-card { display: grid; gap: 8px; width: min(100%, 760px); justify-self: center; box-sizing: border-box; padding: 14px; background: #f3efe8; border-radius: 14px; color: #2b2233; }
.lg-card h3 { margin: 0; font-size: 16px; } .lg-card p, .lg-card label { margin: 0; font-size: 14px; }
.lg-text { width: 100%; box-sizing: border-box; font: 16px ui-monospace, monospace; padding: 8px; border: 2px solid #2b2233; border-radius: 10px; background: #fff; color: #2b2233; resize: vertical; min-height: 120px; }
.lg-problems { margin: 0; padding-left: 20px; font-size: 13px; color: #a33; }
.lg-said { color: #1d6b3a; }
</style>
