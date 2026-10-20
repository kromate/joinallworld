<script setup lang="ts">
// Choose an AI host for the home: greets guests, remembers who came back, MCs parties. Lazy: opened from Houses.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import '../../../ui/controls.css'
import { useApp } from '../../state/app.ts'
import BaseSheet from '../../ui/BaseSheet.vue'
import { hostRead, hostWrite, type HostState } from './spacesClient.ts'

/** `saved`: the host chosen (or removed), as the Houses tile should now read. The sheet closes itself after it. */
const emit = defineEmits<{ close: []; saved: [line: string] }>()
const { game } = useApp()

const loading = ref(true)
const ai = ref(true)
const host = ref<HostState | null>(null)
const kind = ref<HostState['kind']>(null)
const persona = ref('')
const busy = ref(false)
const error = ref('')
const saved = ref('')
let gone = false

function take(next: HostState): void {
  host.value = next
  kind.value = next.kind
  persona.value = next.persona
}
/** Saving is switching on; removing is switching off. One less control to understand. */
function finish(line: string): void {
  saved.value = line
  emit('saved', line)
  setTimeout(() => { if (!gone) emit('close') }, 900)
}
onMounted(async () => {
  const answer = await hostRead(game)
  if (gone) return
  loading.value = false
  if (!answer.ok) { error.value = answer.reason; return }
  ai.value = answer.ai
  take(answer.host)
})
onBeforeUnmount(() => { gone = true })

async function save(): Promise<void> {
  if (!kind.value || busy.value) return
  error.value = ''; saved.value = ''; busy.value = true
  const answer = await hostWrite(game, { kind: kind.value, persona: persona.value.trim().slice(0, 160), on: true })
  busy.value = false
  if (gone) return
  if (!answer.ok) { error.value = answer.reason; return }
  take(answer.host)
  finish(`${answer.host.name ?? 'Your host'} · on`)
}
async function remove(): Promise<void> {
  if (busy.value) return
  error.value = ''; saved.value = ''; busy.value = true
  const answer = await hostWrite(game, { kind: null, on: false })
  busy.value = false
  if (gone) return
  if (!answer.ok) { error.value = answer.reason; return }
  take(answer.host)
  finish('Greets guests when you are out')
}
</script>

<template>
  <BaseSheet open label="Your AI host" @close="emit('close')">
    <header class="sp-head"><h2>An AI host for your home</h2><p>Pick one. It greets your guests by name, remembers who came back and MCs your parties. It is an AI and is marked as one.</p></header>
    <div class="sp-body">
      <p v-if="loading" class="sp-note" role="status">Loading…</p>
      <p v-else-if="!ai" class="sp-note">AI hosts are resting today.</p>
      <template v-else>
        <div class="sp-kinds" role="group" aria-label="Host type">
          <button v-for="item in host?.kinds ?? []" :key="item.id" type="button" :class="{ 'is-on': kind === item.id }" :aria-pressed="kind === item.id" :disabled="busy" @click="kind = item.id as HostState['kind']">{{ item.label }} · {{ item.name }}</button>
        </div>
        <label class="sp-label" for="sp-persona">Personality <small>(optional)</small></label>
        <textarea id="sp-persona" v-model="persona" class="sp-text" rows="2" maxlength="160" :disabled="busy" placeholder="Loud, funny, loves Afrobeats" />
        <button type="button" class="ui-button is-primary is-block sp-btn" data-host="save" :disabled="!kind || busy || Boolean(saved)" @click="save">{{ busy ? 'Saving…' : host?.kind && host.on ? 'Save changes' : 'Switch the host on' }}</button>
        <button v-if="host?.kind" type="button" class="ui-button is-block sp-btn" data-host="remove" :disabled="busy || Boolean(saved)" @click="remove">Switch it off</button>
        <p v-if="saved" class="sp-ok" role="status">Done: {{ saved }}.</p>
      </template>
      <p v-if="error" class="sp-error" role="alert">{{ error }}</p>
    </div>
  </BaseSheet>
</template>

<style scoped>
/* The phone hides the corner Close of the main sheet; this sheet opens over the app and needs its own. */
:deep(.base-sheet-close) { display: grid !important; }
.sp-head { padding: 16px 56px 8px 18px; }
.sp-head h2 { margin: 0; font-size: 18px; }
.sp-head p { margin: 2px 0 0; font-size: 13px; color: var(--c-ink-2); }
.sp-body { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 18px 18px; display: flex; flex-direction: column; gap: 10px; }
.sp-kinds { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; }
.sp-kinds button { min-height: 56px; padding: 6px 10px; border: 0; border-radius: 12px; background: var(--c-fill); color: var(--c-ink); font: 600 14px var(--font); cursor: pointer; }
.sp-kinds button.is-on { background: var(--c-ink); color: #fff; }
.sp-label { font-size: 13px; font-weight: 600; }
.sp-text { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--c-line); border-radius: 12px; font: 16px/1.4 var(--font); color: var(--c-ink); resize: vertical; }
.sp-check { display: flex; align-items: center; gap: 8px; min-height: 44px; font-size: 14px; }
.sp-check input { width: 20px; height: 20px; }
.sp-btn { min-height: 44px; }
.sp-note { margin: 0; font-size: 14px; color: var(--c-ink-2); }
.sp-ok { margin: 0; font-size: 14px; font-weight: 600; color: var(--c-good); }
.sp-error { margin: 0; padding: 10px 12px; border-radius: 12px; background: #fdeceb; color: #a1281d; font-size: 14px; }
</style>
