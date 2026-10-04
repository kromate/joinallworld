<script setup lang="ts">
// The Profile tab of the Sim sheet: the 3D preview, display name and appearance.
//
// It is a form with a draft (profileState.ts). The display name is the device-session nickname,
// renamed through POST /api/session; the look is saved with the 'onboarding.set-look' action.
// The preview, the appearance editor and the local-government card are existing pieces drawn by
// other panels (src/ui/panels/look-ui.js, lga-card.js); they are hosted through
// src/app/legacy/parts.ts and redrawn when the draft changes.
import { computed, nextTick, onBeforeUnmount, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { DREAMS, START_HOMES, TRAITS } from '../../legacy/content.ts'
import LegacyPanel from '../../legacy/LegacyPanel.vue'
import { linkWords } from '../../legacy/modules.ts'
import { bindLgaCard, chooseLook, escapeHtml, hosted, lookEditor, lookStage, lookSummary, lookTabClick, mountLookPreview, renderLgaCard, sameLook } from '../../legacy/parts.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { saveFailure, saveState } from './profileModel.ts'
import { draft, form, saved } from './profileState.ts'

defineProps<{ params?: unknown }>()

const { game, shell, legacy, command } = useApp()
const state = game.state
const view = game.view
const traits = TRAITS, dreams = DREAMS, homes = START_HOMES

/** The draft is rebuilt whenever the saved name or look changes underneath it. */
function sync(): void {
  const key = JSON.stringify([state.value.name, state.value.onboarding.look])
  if (draft.value && saved.value === key) return
  saved.value = key
  draft.value = { name: state.value.name, look: { ...state.value.onboarding.look } }
}
sync()
const current = computed(() => draft.value)

const onboarding = computed(() => view.value.onboarding)
const save = computed(() => saveState({
  connected: view.value.connected, short: linkWords(view.value)?.short ?? '', pending: form.pending, done: onboarding.value.done, guest: onboarding.value.guest,
  unchanged: (current.value?.name.trim() ?? '') === state.value.name && sameLook(current.value?.look ?? state.value.onboarding.look, state.value.onboarding.look), name: current.value?.name ?? '',
}))
const home = computed(() => (onboarding.value.house ? homes[onboarding.value.house] : undefined))

// The existing pieces: they read the draft when they are drawn.
const stage = hosted('profile-stage',
  () => (current.value ? lookStage(current.value.look, { variant: 'wide', name: state.value.name, caption: escapeHtml(lookSummary(current.value.look)) }) : ''),
  (root) => { if (current.value) mountLookPreview(root, current.value.look, { name: state.value.name }) })
const editor = hosted('profile-editor', () => (current.value ? lookEditor(current.value.look, { owned: onboarding.value.wardrobe }) : ''))
const lga = hosted('profile-lga', (s, v) => (v.onboarding.done ? renderLgaCard(s, v) : ''), (root, api) => bindLgaCard(root, api, { redraw: () => legacy.api.refresh() }))

let focusKey = ''
/** The editor was redrawn: the keyboard stays where it was. */
function redraw(): void {
  legacy.api.refresh()
  if (focusKey) void nextTick(() => document.querySelector<HTMLElement>(`[data-profile] [data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true }))
}
function onEditorClick(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-look],[data-look-tab]') : null
  if (!target || (target instanceof HTMLButtonElement && target.disabled) || !current.value) return
  focusKey = target.dataset.key ?? ''
  if (lookTabClick(target)) { redraw(); return }
  draft.value = { ...current.value, look: chooseLook(current.value.look, target.dataset.look ?? '', target.dataset.value ?? '', view.value.onboarding.wardrobe) }
  redraw()
}
// A saved change from elsewhere replaces the draft: the pieces draw it again.
watch([() => state.value.name, () => state.value.onboarding.look], () => { sync(); legacy.api.refresh() })
onBeforeUnmount(() => { focusKey = '' })

async function submit(): Promise<void> {
  const mine = current.value
  if (!mine || save.value.disabled) return
  form.pending = true; form.error = ''; focusKey = 'save'
  try {
    const name = mine.name.trim()
    if (name !== state.value.name) await game.fetchJson('/api/session', { method: 'POST', body: { name } })
    // Also sent when only the name changed: any action returns the state with the new name.
    const result = await command('onboarding.set-look', { look: mine.look })
    if (!result.ok) form.error = result.reason || 'Your look could not be saved. Try again.'
    else { draft.value = null; saved.value = ''; sync(); game.toast('Profile saved.', 'good') }
  } catch (problem) { form.error = saveFailure(problem) } finally { form.pending = false }
  redraw()
  void nextTick(() => document.querySelector<HTMLElement>('[data-profile] [data-key="save"]')?.focus({ preventScroll: true }))
}
</script>

<template>
  <form v-if="current" class="sim-profile" data-profile novalidate @submit.prevent="submit()">
    <p v-if="!onboarding.done && onboarding.guest" class="sim-note">You are a guest in the city: no traits, dream or home yet. <button type="button" class="sim-link" @click="shell.open('onboarding')">Make this life yours</button> — everything you have earned is kept.</p>
    <p v-else-if="!onboarding.done" class="sim-note">You have not created your Sim yet. <button type="button" class="sim-link" @click="shell.open('onboarding')">Create your Sim</button></p>
    <LegacyPanel class="sim-stage" :panel="stage" />
    <div class="sim-profile-top">
      <div>
        <label class="sim-field">Display name<input v-model="current.name" name="name" maxlength="24" autocomplete="nickname" data-key="name"></label>
        <p class="sim-hint">{{ view.city.name }} · shown to other players. 3–24 characters.</p>
        <ul class="sim-about">
          <li v-if="onboarding.traits.length"><b>Traits</b> <template v-for="(id, index) in onboarding.traits" :key="id"><template v-if="index"> · </template><GameIcon inline kind="trait" :id="id" :emoji="traits[id]?.icon" /> {{ traits[id]?.label }}</template></li>
          <li v-if="onboarding.dream"><b>Dream</b> <GameIcon inline kind="dream" :id="onboarding.dream" :emoji="dreams[onboarding.dream]?.icon" /> {{ dreams[onboarding.dream]?.label }}</li>
          <li v-if="onboarding.lottery"><b>Born</b> <GameIcon inline kind="lottery" :id="onboarding.lottery.id" :emoji="onboarding.lottery.icon" /> {{ onboarding.lottery.label }}</li>
          <li><b>Home</b> {{ home ? `${home.label}, ${home.district}` : 'Your home' }} · <button type="button" class="sim-link" @click="shell.open('houses')">See houses</button></li>
        </ul>
      </div>
    </div>
    <h3>Appearance</h3>
    <p class="sim-hint">Colours are free. New hairstyles, outfits and fabrics come from Phone → Boutique.</p>
    <div @click="onEditorClick"><LegacyPanel :panel="editor" /></div>
    <LegacyPanel :panel="lga" />
    <p v-if="form.error" class="sim-error" role="alert">{{ form.error }}</p>
    <div class="sim-save-bar"><button type="submit" class="ui-button is-primary sim-save" data-key="save" :disabled="save.disabled">{{ save.label }}</button></div>
  </form>
</template>

<style scoped src="../../../ui/panels/sim.css"></style>
<style scoped>
/* The preview stage stays in view while the editor scrolls (sim.css does this for `.sim-profile > .look-view`, which the hosting wrapper sits above). */
.sim-stage { position: sticky; top: 62px; z-index: 2; background: #fff; box-shadow: 0 0 0 9px #fff, 0 18px 12px -10px #0004; }
</style>
