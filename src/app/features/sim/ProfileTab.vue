<script setup lang="ts">
// The Profile tab of the Sim sheet: the 3D preview, display name and appearance.
//
// It is a form with a draft (profileState.ts). The display name is the device-session nickname,
// renamed through POST /api/session; the look is saved with the 'onboarding.set-look' action.
// The preview and the appearance editor are the look components of the start feature
// (LookStage, LookEditor); the local-government card is
// the world feature's LgaCard.
import { computed, nextTick, onBeforeUnmount, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { dreamFor } from '../../../game/cities/characterContent.ts'
import { START_HOMES, TRAITS } from '../../../game/content/traits.ts'
import { linkWords } from '../../../ui/link.ts'
import LgaCard from '../world/LgaCard.vue'
import LookEditor from '../start/LookEditor.vue'
import LookStage from '../start/LookStage.vue'
import { chooseLook, lookSummary, sameLook } from '../start/lookModel.ts'
import type { LookField } from '../start/lookModel.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { saveFailure, saveState } from './profileModel.ts'
import { draft, form, saved } from './profileState.ts'

defineProps<{ params?: unknown }>()

const { game, shell, command } = useApp()
const state = game.state
const view = game.view
const traits = TRAITS, homes = START_HOMES
const dream = computed(() => state.value.onboarding.dream ? dreamFor(state.value.estate.city, state.value.onboarding.dream) : null)

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

let focusKey = ''
/** The form was redrawn: the keyboard stays where it was. */
function redraw(): void {
  if (focusKey) void nextTick(() => document.querySelector<HTMLElement>(`[data-profile] [data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true }))
}
function onChoose(field: LookField, value: string): void {
  if (!current.value) return
  draft.value = { ...current.value, look: chooseLook(current.value.look, field, value, view.value.onboarding.wardrobe) }
}
// A saved change from elsewhere replaces the draft: the pieces draw it again.
watch([() => state.value.name, () => state.value.onboarding.look], () => { sync() })
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
    <LookStage class="sim-stage" :look="current.look" variant="wide" :name="state.name" :caption="lookSummary(current.look)" />
    <div class="sim-profile-top">
      <div>
        <label class="sim-field">Display name<input v-model="current.name" name="name" maxlength="24" autocomplete="nickname" data-key="name"></label>
        <p class="sim-hint">{{ view.city.name }} · shown to other players. 3–24 characters.</p>
        <ul class="sim-about">
          <li v-if="onboarding.traits.length"><b>Traits</b> <template v-for="(id, index) in onboarding.traits" :key="id"><template v-if="index"> · </template><GameIcon inline kind="trait" :id="id" :emoji="traits[id]?.icon" /> {{ traits[id]?.label }}</template></li>
          <li v-if="onboarding.dream"><b>Dream</b> <GameIcon inline kind="dream" :id="onboarding.dream" :emoji="dream?.icon" /> {{ dream?.label }}</li>
          <li v-if="onboarding.lottery"><b>Born</b> <GameIcon inline kind="lottery" :id="onboarding.lottery.id" :emoji="onboarding.lottery.icon" /> {{ onboarding.lottery.label }}</li>
          <li v-if="view.estate.placed"><b>Home</b> {{ home ? `${home.label}, ${home.district}` : 'Your home' }} · <button type="button" class="sim-link" @click="shell.open('houses')">See houses</button></li>
          <li v-else-if="view.estate.settle"><b>Home</b> {{ view.estate.home?.name }} · visiting {{ view.estate.cityName }} · <button type="button" class="sim-link" @click="shell.open('visiting')">Rest, go home or take a home here</button></li>
          <li v-else><b>Home</b> None in {{ view.estate.cityName }} yet · <button type="button" class="sim-link" @click="shell.open('houses')">Choose your {{ view.estate.unit }}</button></li>
        </ul>
      </div>
    </div>
    <h3>Appearance</h3>
    <p class="sim-hint">Colours are free. New hairstyles, outfits and fabrics come from Phone → Boutique.</p>
    <LookEditor :look="current.look" :owned="onboarding.wardrobe" @choose="onChoose" />
    <LgaCard v-if="onboarding.done && !view.estate.settle" />
    <p v-if="form.error" class="sim-error" role="alert">{{ form.error }}</p>
    <div class="sim-save-bar"><button type="submit" class="ui-button is-primary sim-save" data-key="save" :disabled="save.disabled">{{ save.label }}</button></div>
  </form>
</template>

<style scoped src="../../../ui/panels/sim.css"></style>
<style scoped>
/* The preview stage stays in view while the editor scrolls (sim.css does this for `.sim-profile > .look-view`, which the hosting wrapper sits above). */
.sim-stage { position: sticky; top: 62px; z-index: 2; background: #fff; box-shadow: 0 0 0 9px #fff, 0 18px 12px -10px #0004; }
</style>
