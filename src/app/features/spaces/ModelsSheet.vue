<script setup lang="ts">
// My 3D models (docs/SPACES-3D.md, phase 1): pick a .glb, see it in 3D before it goes anywhere, name it, upload it. The same check
// the server runs (src/spaces/glb.ts) runs here first, so a file that would be refused is refused at once, with what to change.
// Lazy: opened from Houses.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import '../../../ui/controls.css'
import { useApp } from '../../state/app.ts'
import BaseSheet from '../../ui/BaseSheet.vue'
import { checkGlb, GLB_LIMITS, type GlbInfo } from '../../../spaces/glb.ts'
import { modelBytes, modelDelete, modelFileUrl, modelRename, modelUpload, modelsMine, type ModelView, type ModelsMine } from './spacesClient.ts'
import { lazyComponent } from '../../state/lazy.ts'

const ModelPreview = lazyComponent(() => import('./ModelPreview.vue'))
/** `place`: the player wants this model in their house now; the Houses app opens the 3D screen with it in hand. */
const emit = defineEmits<{ close: []; place: [model: ModelView] }>()
const { game } = useApp()

const loading = ref(true)
const state = ref<ModelsMine | null>(null)
const error = ref('')
const note = ref('')
const busy = ref(false)
/** A file picked and checked here, not yet uploaded. */
const picked = ref<{ file: File; bytes: ArrayBuffer; info: GlbInfo } | null>(null)
const name = ref('')
/** The model shown in 3D: one just picked, or one of mine. */
const shown = ref<ArrayBuffer | null>(null)
const shownId = ref('')
const renaming = ref('')
const newName = ref('')
let gone = false

const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(bytes < 1e6 ? 2 : 1)} MB`
const metres = (size: readonly number[]): string => size.map((v) => (v < 1 ? `${Math.round(v * 100)} cm` : `${v.toFixed(1)} m`)).join(' × ')
const used = computed(() => state.value ? `${state.value.used.count} of ${state.value.limits.count} models · ${mb(state.value.used.bytes)} of ${mb(state.value.limits.bytes)}` : '')

async function load(): Promise<void> {
  const answer = await modelsMine(game)
  if (gone) return
  loading.value = false
  if (!answer.ok) { error.value = answer.reason; return }
  state.value = answer
}
onMounted(load)
onBeforeUnmount(() => { gone = true })

async function pick(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  error.value = ''; note.value = ''; justUploaded.value = null
  if (!file) return
  if (file.size > GLB_LIMITS.bytes) { error.value = `This file is ${mb(file.size)}. A model may be at most ${mb(GLB_LIMITS.bytes)}.`; return }
  const bytes = await file.arrayBuffer()
  const checked = checkGlb(new Uint8Array(bytes))
  if (!checked.ok) { error.value = checked.reason; return }
  picked.value = { file, bytes, info: checked.info }
  name.value = file.name.replace(/\.glb$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 40)
  shown.value = bytes; shownId.value = ''
}
async function upload(): Promise<void> {
  if (!picked.value || busy.value) return
  busy.value = true; error.value = ''
  const answer = await modelUpload(picked.value.file, name.value.trim())
  busy.value = false
  if (gone) return
  if (!answer.ok) { error.value = answer.reason; return }
  note.value = answer.code === 'already' ? 'You already have this model.' : `${answer.model.name} is in your models.`
  picked.value = null
  shownId.value = answer.model.id
  justUploaded.value = answer.model
  await load()
}
/** The model just uploaded: the next step is to put it in the house. */
const justUploaded = ref<ModelView | null>(null)
async function show(model: ModelView): Promise<void> {
  error.value = ''
  picked.value = null
  shownId.value = model.id
  const bytes = await modelBytes(model.hash)
  if (gone || shownId.value !== model.id) return
  if (!bytes) { error.value = 'That model could not be loaded. Try again.'; return }
  shown.value = bytes
}
async function rename(model: ModelView): Promise<void> {
  if (busy.value) return
  busy.value = true; error.value = ''
  const answer = await modelRename(game, model.id, newName.value.trim())
  busy.value = false
  if (gone) return
  if (!answer.ok) { error.value = answer.reason; return }
  renaming.value = ''
  await load()
}
async function remove(model: ModelView): Promise<void> {
  if (busy.value || !globalThis.confirm?.(`Delete ${model.name}? It also leaves every space it is in.`)) return
  busy.value = true; error.value = ''
  const answer = await modelDelete(game, model.id)
  busy.value = false
  if (gone) return
  if (!answer.ok) { error.value = answer.reason; return }
  if (shownId.value === model.id) { shown.value = null; shownId.value = '' }
  await load()
}
</script>

<template>
  <BaseSheet open label="My 3D models" @close="emit('close')">
    <header class="sp-head"><h2>My 3D models</h2><p>Upload a model (.glb from Blender, SketchUp and others), put it in your house and drag it where you want it.</p></header>
    <div class="sp-body">
      <p v-if="loading" class="sp-note" role="status">Loading…</p>
      <template v-else-if="state">
        <p v-if="!state.on" class="sp-note">Uploading 3D models is not switched on yet.</p>
        <template v-else>
          <ModelPreview v-if="shown" :bytes="shown" @failed="(reason: string) => (error = reason)" />
          <template v-if="picked">
            <p class="sp-facts">{{ picked.info.triangles.toLocaleString('en') }} triangles · {{ picked.info.textures }} pictures · {{ metres(picked.info.size) }} · {{ mb(picked.file.size) }}</p>
            <label class="sp-label" for="sp-model-name">Name</label>
            <input id="sp-model-name" v-model="name" class="sp-text" maxlength="40" :disabled="busy" />
            <button type="button" class="ui-button is-primary is-block sp-btn" :disabled="busy || !name.trim()" @click="upload">{{ busy ? 'Uploading…' : 'Upload' }}</button>
            <button type="button" class="ui-button is-block sp-btn" :disabled="busy" @click="picked = null; shown = null">Cancel</button>
          </template>
          <template v-else>
            <button v-if="justUploaded" type="button" class="ui-button is-primary is-block sp-btn" data-models="place" @click="emit('place', justUploaded)">Put {{ justUploaded.name }} in my house</button>
            <label v-if="state.canUpload" class="ui-button is-block sp-btn sp-file" :class="{ 'is-primary': !justUploaded }">
              {{ justUploaded ? 'Upload another' : 'Choose a .glb file' }}
              <input type="file" accept=".glb,model/gltf-binary" @change="pick" />
            </label>
            <p v-else-if="state.why" class="sp-note">{{ state.why }}</p>
            <p class="sp-note">At most {{ mb(state.limits.file) }} and {{ state.limits.triangles.toLocaleString('en') }} triangles a model; pictures inside the file (PNG, JPEG or WebP). 1 unit = 1 metre.</p>
          </template>
          <p v-if="note" class="sp-ok" role="status">{{ note }}</p>
          <p v-if="used" class="sp-note">{{ used }}</p>
          <ul v-if="state.models.length" class="sp-models" aria-label="My models">
            <li v-for="model in state.models" :key="model.id" :class="{ 'is-on': shownId === model.id }">
              <template v-if="renaming === model.id">
                <input v-model="newName" class="sp-text" maxlength="40" :aria-label="`New name for ${model.name}`" @keydown.enter="rename(model)" />
                <button type="button" class="sp-mini" :disabled="busy || !newName.trim()" @click="rename(model)">Save</button>
                <button type="button" class="sp-mini" @click="renaming = ''">Cancel</button>
              </template>
              <template v-else>
                <button type="button" class="sp-model" @click="show(model)">
                  <strong>{{ model.name }}</strong>
                  <span>{{ model.triangles.toLocaleString('en') }} triangles · {{ metres(model.size) }}<template v-if="model.hidden"> · hidden after reports</template></span>
                </button>
                <span class="sp-acts">
                  <button type="button" class="sp-mini" :aria-label="`Put ${model.name} in my house`" @click="emit('place', model)">Place</button>
                  <a class="sp-mini sp-dl" :href="modelFileUrl(model.hash)" :download="`${model.name}.glb`" :aria-label="`Download ${model.name} to open in Blender`">Download</a>
                  <button type="button" class="sp-mini" :aria-label="`Rename ${model.name}`" @click="renaming = model.id; newName = model.name">Rename</button>
                  <button type="button" class="sp-mini" :aria-label="`Delete ${model.name}`" :disabled="busy" @click="remove(model)">Delete</button>
                </span>
              </template>
            </li>
          </ul>
        </template>
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
.sp-label { font-size: 13px; font-weight: 600; }
.sp-text { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--c-line); border-radius: 12px; font: 16px/1.4 var(--font); color: var(--c-ink); }
.sp-btn { min-height: 44px; }
.sp-file { position: relative; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.sp-file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.sp-facts { margin: 0; font-size: 13px; color: var(--c-ink-2); }
.sp-note { margin: 0; font-size: 13px; color: var(--c-ink-2); }
.sp-ok { margin: 0; font-size: 14px; font-weight: 600; color: var(--c-good); }
.sp-error { margin: 0; padding: 10px 12px; border-radius: 12px; background: #fdeceb; color: #a1281d; font-size: 14px; }
.sp-models { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.sp-models li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 4px; border-radius: 12px; background: var(--c-fill); }
.sp-models li.is-on { outline: 2px solid var(--c-ink); }
.sp-model { flex: 1 1 150px; min-width: 0; min-height: 44px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; padding: 4px 8px; border: 0; background: none; color: var(--c-ink); font: 14px var(--font); text-align: left; cursor: pointer; }
.sp-model strong { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-model span { font-size: 12px; color: var(--c-ink-2); }
.sp-acts { display: flex; gap: 6px; margin-left: auto; }
.sp-dl { display: inline-flex; align-items: center; text-decoration: none; }
.sp-mini { flex: 0 0 auto; min-height: 44px; padding: 0 10px; border: 0; border-radius: 10px; background: var(--c-surface, #fff); color: var(--c-ink); font: 600 13px var(--font); cursor: pointer; }
</style>
