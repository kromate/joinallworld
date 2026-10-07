<script lang="ts">
import { reactive } from 'vue'
// Keep the editor while the player arranges furniture in Buy; reset when the actor changes.
const editor = reactive<{ owner: string; id: string | null; title: string; description: string; moments: { title: string; prompt: string }[] }>({ owner: '', id: null, title: '', description: '', moments: [{ title: '', prompt: '' }] })
</script>

<script setup lang="ts">
import '../../../ui/controls.css'
import { computed, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { social } from '../social/useSocial.ts'
import { neighbourhood } from '../neighbourhood/neighbourhoodStore.ts'
import type { StoryScene } from '../../../types/stories.ts'

defineProps<{ params?: unknown }>()
const { game, shell, goTo, command } = useApp()
const pending = ref(''), note = ref(''), failed = ref(false)
const scenes = computed(() => game.state.value.stories.scenes)
const selected = computed(() => scenes.value.find(scene => scene.id === editor.id) ?? null)
const visiting = computed(() => social.me?.visiting ?? null)
const guestStory = computed(() => neighbourhood.home?.host.id === visiting.value?.host.id ? neighbourhood.home?.story ?? null : null)
const atHome = computed(() => game.state.value.location === 'home' && !visiting.value)
const ready = computed(() => atHome.value && game.connected.value && !game.state.value.activeAction && !game.saving.value && !pending.value)
const running = computed(() => game.state.value.stories.running)
const dirty = computed(() => !selected.value || JSON.stringify([editor.title, editor.description, editor.moments]) !== JSON.stringify([selected.value.draft.title, selected.value.draft.description, selected.value.draft.moments]))
const valid = computed(() => Boolean(editor.title.trim()) && editor.title.length <= 60 && editor.description.length <= 240 && editor.moments.length <= 8 && editor.moments.every(moment => moment.title.trim() && moment.title.length <= 60 && moment.prompt.trim() && moment.prompt.length <= 280))

function reset(): void { editor.id = null; editor.title = ''; editor.description = ''; editor.moments = [{ title: '', prompt: '' }]; note.value = ''; failed.value = false }
watch(() => game.session.value?.id ?? '', owner => { if (editor.owner !== owner) { reset(); editor.owner = owner } }, { immediate: true })
function edit(scene: StoryScene): void { editor.id = scene.id; editor.title = scene.draft.title; editor.description = scene.draft.description; editor.moments = scene.draft.moments.map(moment => ({ ...moment })); note.value = ''; failed.value = false }
function reorder(index: number, offset: number): void {
  const next = index + offset
  if (next < 0 || next >= editor.moments.length) return
  const [moment] = editor.moments.splice(index, 1)
  if (moment) editor.moments.splice(next, 0, moment)
}
async function save(): Promise<void> {
  if (!ready.value || !valid.value) return
  pending.value = 'save'; note.value = ''; failed.value = false
  const previous = new Set(scenes.value.map(scene => scene.id))
  try {
    const result = await command('stories.save', { ...(editor.id ? { id: editor.id } : {}), title: editor.title.trim(), description: editor.description.trim(), moments: editor.moments.map(moment => ({ title: moment.title.trim(), prompt: moment.prompt.trim() })) })
    failed.value = !result.ok
    note.value = result.ok ? 'Draft saved with the furniture layout currently in your home.' : result.reason ?? 'The draft could not be saved. Try again.'
    if (result.ok) {
      const scene = editor.id ? scenes.value.find(scene => scene.id === editor.id) : scenes.value.find(scene => !previous.has(scene.id))
      if (scene) edit(scene)
      note.value = 'Draft saved with the furniture layout currently in your home.'
    }
  } finally { pending.value = '' }
}
async function act(action: 'publish' | 'start' | 'remove', scene: StoryScene): Promise<void> {
  if (!ready.value) return
  pending.value = `${action}:${scene.id}`; note.value = ''; failed.value = false
  try {
    const result = action === 'publish' ? await command('stories.publish', { id: scene.id }) : action === 'start' ? await command('stories.start', { id: scene.id }) : await command('stories.remove', { id: scene.id })
    failed.value = !result.ok
    note.value = result.ok ? game.state.value.message : result.reason ?? 'That could not be completed. Try again.'
    if (result.ok && action === 'remove' && editor.id === scene.id) { reset(); note.value = 'Scene removed. Your furniture stays yours.' }
    if (result.ok && action === 'start') shell.close()
  } finally { pending.value = '' }
}
</script>

<template>
  <section class="stories-app" aria-label="Scenes">
    <template v-if="visiting">
      <h2 class="ui-section">{{ guestStory?.title ?? 'Scenes at this home' }}</h2>
      <template v-if="guestStory">
        <p v-if="guestStory.description">{{ guestStory.description }}</p>
        <article class="ui-card"><small>Moment {{ guestStory.step + 1 }} of {{ guestStory.total }}</small><h3>{{ guestStory.moment.title }}</h3><p>{{ guestStory.moment.prompt }}</p></article>
      </template>
      <p class="social-note">{{ visiting.host.name }} directs scenes here. Follow the moments, walk around, and join the house chat.</p>
      <button type="button" class="ui-button" @click="shell.open('invite', { host: visiting.host.id })">Visit details</button>
    </template>
    <template v-else>
      <div class="stories-heading"><h2 class="ui-section">Your scenes</h2><small>{{ scenes.length }}/8</small></div>
      <p>Create a gathering, rehearsal or story with moments you direct. Your furniture stays yours.</p>
      <p v-if="!atHome" class="social-note">Go to your home to save, publish or play a scene. You can draft the words here.</p>
      <button v-if="!atHome" type="button" class="ui-button" @click="goTo('home')">Go home</button>
      <p v-else-if="!game.connected.value" class="ui-error" role="status">Reconnect to save or play. Your draft stays here.</p>
      <p v-else-if="game.state.value.activeAction" class="social-note">Finish or cancel your activity before saving or starting a scene.</p>

      <div v-if="scenes.length" class="stories-list" aria-label="Saved scenes">
        <article v-for="scene in scenes" :key="scene.id" class="ui-card" :class="{ 'is-selected': scene.id === editor.id }">
          <div><strong>{{ scene.draft.title }}</strong><small>{{ scene.publication.kind === 'published' ? `Published version ${scene.publication.revision}` : 'Unpublished draft' }} · {{ scene.draft.moments.length }} moments</small></div>
          <button type="button" class="ui-button" :disabled="!!pending" @click="edit(scene)">Edit<span class="stories-sr"> {{ scene.draft.title }}</span></button>
        </article>
      </div>
      <p v-else class="social-note">Start with a title and one moment. Arrange your home, save the draft, then publish it.</p>
      <button type="button" class="ui-button" :disabled="scenes.length >= 8 || !!pending" @click="reset">New scene</button>
      <p v-if="scenes.length >= 8" class="social-note">All eight scene slots are used. Edit a scene or remove one to make room.</p>

      <form class="stories-editor" :aria-busy="!!pending" @submit.prevent="save"><fieldset class="stories-fields" :disabled="!!pending">
        <h3 class="ui-section">{{ selected ? 'Edit scene' : 'New scene' }}</h3>
        <label>Title<input v-model="editor.title" maxlength="60" required placeholder="e.g. Saturday rehearsal"></label>
        <label>Description<textarea v-model="editor.description" rows="2" maxlength="240" placeholder="What are you inviting people to do?"></textarea></label>
        <div class="stories-heading"><h3 class="ui-section">Moments</h3><small>{{ editor.moments.length }}/8</small></div>
        <fieldset v-for="(moment, index) in editor.moments" :key="index" class="ui-card stories-moment">
          <legend>Moment {{ index + 1 }}</legend>
          <label>Moment title<input v-model="moment.title" maxlength="60" required placeholder="e.g. Welcome everyone"></label>
          <label>Prompt<textarea v-model="moment.prompt" rows="2" maxlength="280" required placeholder="What happens in this moment?"></textarea></label>
          <div class="stories-actions">
            <button type="button" class="ui-button" :disabled="index === 0" :aria-label="`Move moment ${index + 1} earlier`" @click="reorder(index, -1)">Earlier</button>
            <button type="button" class="ui-button" :disabled="index === editor.moments.length - 1" :aria-label="`Move moment ${index + 1} later`" @click="reorder(index, 1)">Later</button>
            <button type="button" class="ui-button" :aria-label="`Remove moment ${index + 1}`" @click="editor.moments.splice(index, 1)">Remove moment</button>
          </div>
        </fieldset>
        <button type="button" class="ui-button" :disabled="editor.moments.length >= 8" @click="editor.moments.push({ title: '', prompt: '' })">Add moment</button>
        <p class="social-note">Save copies the furniture layout currently in your home. Arrange in Buy, return here, then save. Your words stay in this editor while you arrange.</p>
        <button type="button" class="ui-button" :disabled="!ready || !!running" @click="shell.open('buy')">Arrange furniture</button>
        <p v-if="running" class="social-note">End the current scene before arranging furniture or starting another.</p>
        <p v-if="!valid" class="social-note">Add a scene title and fill in each moment’s title and prompt. You can save a draft with no moments.</p>
        <div class="stories-actions">
          <button type="submit" class="ui-button is-primary" :disabled="!ready || !valid || (!selected && scenes.length >= 8)">{{ pending === 'save' ? 'Saving…' : 'Save draft and layout' }}</button>
          <template v-if="selected">
            <button type="button" class="ui-button" :disabled="!ready || dirty || !selected.draft.moments.length || running?.sceneId === selected.id" @click="act('publish', selected)">{{ pending === `publish:${selected.id}` ? 'Publishing…' : 'Publish saved draft' }}</button>
            <button v-if="selected.publication.kind === 'published'" type="button" class="ui-button" :disabled="!ready || !!running" @click="act('start', selected)">{{ pending === `start:${selected.id}` ? 'Starting…' : 'Play published version' }}</button>
            <button type="button" class="ui-button is-danger" :disabled="!ready || running?.sceneId === selected.id" @click="act('remove', selected)">Remove scene</button>
          </template>
        </div>
        <p v-if="selected && dirty" class="social-note">You have unsaved words. Save before publishing the next version.</p>
        <p v-if="note" :class="failed ? 'ui-error' : 'social-note'" role="status">{{ note }}</p>
      </fieldset></form>
    </template>
  </section>
</template>

<style scoped>
.stories-app { display: grid; gap: 12px; }
.stories-app p { margin: 0; }
.stories-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.stories-list, .stories-editor { display: grid; gap: 12px; }
.stories-fields { display: grid; gap: 12px; border: 0; padding: 0; margin: 0; min-width: 0; }
.stories-list article { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.stories-list small { display: block; margin-top: 4px; }
.is-selected { outline: 2px solid var(--c-green); outline-offset: 1px; }
.stories-editor label { display: grid; gap: 6px; font-weight: 600; }
.stories-editor input, .stories-editor textarea { box-sizing: border-box; width: 100%; min-width: 0; }
.stories-editor textarea { resize: vertical; }
.stories-moment { min-width: 0; display: grid; gap: 10px; margin: 0; }
.stories-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.stories-actions .ui-button { min-height: 44px; }
.stories-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
