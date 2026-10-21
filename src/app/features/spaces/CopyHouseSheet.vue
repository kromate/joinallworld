<script setup lang="ts">
// Copy my real house (docs/HOUSE-FROM-PHOTOS.md). Three ways in, cheapest for Allworld first: the player's own AI follows the house skill
// (photos in, a .glb or a house description out); a house description pasted here, which the game builds; one of their models used as
// the whole house. The house is shown to visitors as it is to them; "Back to the game's house" undoes it.
import { onMounted, ref } from 'vue'
import '../../../ui/controls.css'
import { useApp } from '../../state/app.ts'
import BaseSheet from '../../ui/BaseSheet.vue'
import { checkGlb, HOUSE_GLB_LIMITS } from '../../../spaces/glb.ts'
import { track } from '../world/worldModel.ts'
import { houseSet, modelUpload, modelsMine, worldRead, type ModelView } from './spacesClient.ts'

const emit = defineEmits<{ close: []; walk: [] }>()
const { game, shell } = useApp()
const SKILL = '/skills/allworld-house/SKILL.md'
const models = ref<ModelView[]>([])
const current = ref<'spec' | 'model' | null>(null)
const pasted = ref('')
const busy = ref(false)
const note = ref('')
const error = ref('')
const notes = ref<string[]>([])

onMounted(async () => {
  const [mine, home] = await Promise.all([modelsMine(game), worldRead(game, { target: 'home' })])
  if (mine.ok) models.value = mine.models
  if (home.ok) current.value = home.world.house?.kind ?? null
})

/** What a player pastes into their own AI: where the skill is and what to do. */
const instructions = (): string => `Help me copy my real house into Allworld (a browser life game). Read the skill at ${location.origin}${SKILL} and the files it lists, then follow its steps. I will send you photos of my house, outside and every room inside.`
async function copyInstructions(): Promise<void> {
  try { await navigator.clipboard.writeText(instructions()); note.value = 'Copied. Paste it into your AI (Claude, ChatGPT, Codex…) with your photos.'; track('house_skill_copied', { what: 'prompt' }) }
  catch { note.value = instructions() }
}
async function done(answer: Awaited<ReturnType<typeof houseSet>>, kind: 'spec' | 'model'): Promise<void> {
  busy.value = false
  if (!answer.ok) { error.value = answer.reason; return }
  current.value = kind
  notes.value = answer.notes ?? []
  note.value = kind === 'spec' ? `Built: ${answer.rooms ?? 0} rooms. Walk in to see it.` : 'Your model is now your house. Walk in to see it.'
  track('house_copy_used', { kind })
}
async function buildPasted(): Promise<void> {
  if (busy.value) return
  error.value = ''; note.value = ''; notes.value = []
  let spec: unknown
  try { spec = JSON.parse(pasted.value.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) } catch { error.value = 'That is not the JSON your AI wrote. Copy all of it, from { to }.'; return }
  busy.value = true
  await done(await houseSet(game, { spec }), 'spec')
}
async function useModel(model: ModelView): Promise<void> {
  if (busy.value) return
  busy.value = true; error.value = ''; note.value = ''
  await done(await houseSet(game, { model: model.id }), 'model')
}
async function uploadHouse(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value) return
  error.value = ''; note.value = ''
  if (file.size > HOUSE_GLB_LIMITS.bytes) { error.value = `This file is ${(file.size / 1e6).toFixed(1)} MB. A whole house may be at most ${HOUSE_GLB_LIMITS.bytes / 1e6} MB.`; return }
  const checked = checkGlb(new Uint8Array(await file.arrayBuffer()), HOUSE_GLB_LIMITS)
  if (!checked.ok) { error.value = checked.reason; return }
  busy.value = true; note.value = 'Uploading your house…'
  const sent = await modelUpload(file, file.name.replace(/\.glb$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 40) || 'My house', true)
  if (!sent.ok) { busy.value = false; note.value = ''; error.value = sent.reason; return }
  models.value = [...models.value.filter((m) => m.id !== sent.model.id), sent.model]
  await done(await houseSet(game, { model: sent.model.id }), 'model')
}
async function backToGame(): Promise<void> {
  busy.value = true; error.value = ''
  const answer = await houseSet(game, { clear: true })
  busy.value = false
  if (!answer.ok) { error.value = answer.reason; return }
  current.value = null; note.value = "Back to the game's house."
}
</script>

<template>
  <BaseSheet open label="Copy my real house" @close="emit('close')">
    <header class="sp-head">
      <h2>Copy my real house</h2>
      <p>Photograph your house, let an AI build it, and invite friends over.</p>
    </header>
    <div class="sp-body">
      <section class="ch-card" data-copy="ai">
        <h3>1. With your own AI <small>free</small></h3>
        <p class="sp-note">Claude, ChatGPT, Codex or a local model reads your photos (outside and every room) and builds your house: in Blender when it can, or as a house description you paste below. Your photos stay with your AI; only the house comes here.</p>
        <button type="button" class="ui-button is-primary is-block sp-btn" data-copy="prompt" @click="copyInstructions">Copy the instructions for my AI</button>
        <div class="ch-links">
          <a class="ui-button sp-btn" :href="SKILL" target="_blank" rel="noopener" @click="track('house_skill_copied', { what: 'skill' })">Open the skill</a>
          <button type="button" class="ui-button sp-btn" @click="shell.open('ai-agents')">Make an agent key</button>
        </div>
        <p class="sp-note">With an agent key your AI uploads the house itself. Without one it gives you a file or a description.</p>
      </section>

      <section class="ch-card" data-copy="paste">
        <h3>2. Paste a house description</h3>
        <label class="sp-label" for="ch-spec">The JSON your AI wrote (it starts with {"v": 1)</label>
        <textarea id="ch-spec" v-model="pasted" class="sp-text ch-json" rows="6" spellcheck="false" autocapitalize="off" placeholder='{"v": 1, "storeys": 2, "width": 10, "depth": 8, …}' />
        <button type="button" class="ui-button is-primary is-block sp-btn" data-copy="build" :disabled="busy || !pasted.trim()" @click="buildPasted">{{ busy ? '…' : 'Build my house' }}</button>
      </section>

      <section class="ch-card" data-copy="model">
        <h3>3. A model of the whole house</h3>
        <p class="sp-note">A .glb of your whole house, inside and out, up to {{ HOUSE_GLB_LIMITS.bytes / 1e6 }} MB and {{ HOUSE_GLB_LIMITS.triangles.toLocaleString('en') }} triangles. 1 unit = 1 metre; the front of the house faces the street.</p>
        <label class="ui-button is-block sp-btn sp-file" data-copy="upload">
          {{ busy ? 'Uploading…' : 'Upload a whole house (.glb)' }}
          <input type="file" accept=".glb,model/gltf-binary" :disabled="busy" @change="uploadHouse" />
        </label>
        <ul v-if="models.length" class="sp-models" aria-label="Or use one of my models">
          <li v-for="m in models" :key="m.id">
            <span class="sp-model"><strong>{{ m.name }}</strong><span>{{ m.size.map((n) => n.toFixed(1)).join(' × ') }} m</span></span>
            <button type="button" class="sp-mini" :disabled="busy" @click="useModel(m)">Use as my house</button>
          </li>
        </ul>
      </section>

      <p v-if="note" class="sp-ok" role="status">{{ note }}</p>
      <ul v-if="notes.length" class="ch-notes"><li v-for="n in notes" :key="n">{{ n }}</li></ul>
      <p v-if="error" class="sp-error" role="alert">{{ error }}</p>
      <button v-if="current" type="button" class="ui-button is-primary is-block sp-btn" data-copy="walk" @click="emit('walk')">Walk into my house</button>
      <button v-if="current" type="button" class="ui-button is-block sp-btn" :disabled="busy" data-copy="clear" @click="backToGame">Back to the game's house</button>
    </div>
  </BaseSheet>
</template>

<style scoped>
/* The phone hides the corner Close of the main sheet; this sheet opens over the app and needs its own. */
:deep(.base-sheet-close) { display: grid !important; }
.sp-head { padding: 16px 56px 8px 18px; }
.sp-head h2 { margin: 0; font-size: 18px; }
.sp-head p { margin: 2px 0 0; font-size: 13px; color: var(--c-ink-2); }
.sp-body { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 18px 18px; display: flex; flex-direction: column; gap: 12px; }
.sp-label { font-size: 13px; font-weight: 600; }
.sp-text { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--c-line); border-radius: 12px; font: 16px/1.4 var(--font); color: var(--c-ink); }
.sp-btn { min-height: 44px; }
.sp-file { position: relative; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.sp-file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.sp-note { margin: 0; font-size: 13px; line-height: 1.45; color: var(--c-ink-2); }
.sp-ok { margin: 0; font-size: 14px; font-weight: 600; color: var(--c-good); }
.sp-error { margin: 0; padding: 10px 12px; border-radius: 12px; background: #fdeceb; color: #a1281d; font-size: 14px; }
.sp-models { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.sp-models li { display: flex; align-items: center; gap: 6px; padding: 4px; border-radius: 12px; background: var(--c-fill); }
.sp-model { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 4px 8px; font-size: 14px; }
.sp-model strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-model span { font-size: 12px; color: var(--c-ink-2); }
.sp-mini { flex: 0 0 auto; min-height: 44px; padding: 0 10px; border: 0; border-radius: 10px; background: #fff; color: var(--c-ink); font: 600 13px var(--font); cursor: pointer; }
.ch-card { display: flex; flex-direction: column; gap: 8px; padding: 14px; border: 1px solid var(--c-line); border-radius: 14px; background: #fff; }
.ch-card h3 { margin: 0; font-size: 15px; }
.ch-card h3 small { margin-left: 6px; padding: 2px 8px; border-radius: 10px; background: var(--c-green-soft, #e3f3ea); color: var(--c-green-dark, #1d6b45); font-size: 11px; }
.ch-links { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.ch-links .ui-button { display: flex; align-items: center; justify-content: center; min-width: 0; white-space: normal; text-align: center; line-height: 1.25; padding: 8px 10px; text-decoration: none; }
.ch-json { font: 13px/1.4 ui-monospace, Menlo, monospace; }
.ch-notes { margin: 0; padding-left: 18px; font-size: 13px; color: var(--c-ink-2); }
</style>
