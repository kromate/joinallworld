<script setup lang="ts">
import { onBeforeUnmount, reactive, ref } from 'vue'
import {
  onViewPreferencesChange,
  readViewPreferences,
  setViewPreferences,
  type ViewPreferences,
} from '../../../scene/first-person/preferences.ts'

const preferences = reactive(readViewPreferences())
const warning = ref('')
/** What "Reduce shake" means while the person has not chosen: the device's own Reduced Motion setting. */
const reducedMotion = typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
const sync = (): void => { Object.assign(preferences, readViewPreferences()) }
const stop = onViewPreferencesChange(sync)
onBeforeUnmount(stop)

function change(patch: Partial<ViewPreferences>): void {
  warning.value = setViewPreferences(patch) ? '' : 'Could not save camera settings on this device. Kept for this visit.'
  sync()
}
</script>

<template>
  <section aria-labelledby="camera-view-title">
    <h3 id="camera-view-title" class="ui-section">Camera view</h3>
    <div class="ui-rows" role="radiogroup" aria-label="Camera view">
      <button type="button" class="ui-row settings-row" role="radio" :aria-checked="preferences.mode === 'third'" @click="change({ mode: 'third' })">
        <span class="ui-row-body"><b>Third person</b><small>See your character and the world around them.</small></span><span class="settings-state">{{ preferences.mode === 'third' ? 'On' : 'Off' }}</span>
      </button>
      <button type="button" class="ui-row settings-row" role="radio" :aria-checked="preferences.mode === 'first'" @click="change({ mode: 'first' })">
        <span class="ui-row-body"><b>First person</b><small>See the world through your character's eyes.</small></span><span class="settings-state">{{ preferences.mode === 'first' ? 'On' : 'Off' }}</span>
      </button>
    </div>
    <p class="settings-note">Saved on this device only.</p>
    <p class="settings-list">Drag to look. WASD/arrows or the move stick to walk. E/Space to interact; P opens Phone.</p>

    <div class="ui-rows">
      <label class="ui-row settings-row"><span class="ui-row-body"><b>Head bob</b><small>Gentle movement while walking. Your device's Reduced Motion setting always turns this off.</small></span>
        <span class="settings-state">{{ preferences.bob ? 'On' : 'Off' }}</span><input type="checkbox" role="switch" :checked="preferences.bob" aria-label="Head bob" @change="change({ bob: ($event.target as HTMLInputElement).checked })"><i class="ui-switch" aria-hidden="true" /></label>
      <label class="ui-row settings-row"><span class="ui-row-body"><b>Comfort vignette</b><small>Softens the edges of the screen while moving.</small></span>
        <span class="settings-state">{{ preferences.vignette ? 'On' : 'Off' }}</span><input type="checkbox" role="switch" :checked="preferences.vignette" aria-label="Comfort vignette" @change="change({ vignette: ($event.target as HTMLInputElement).checked })"><i class="ui-switch" aria-hidden="true" /></label>
      <label class="ui-row settings-row"><span class="ui-row-body"><b>Snap turning (30°)</b><small>Turns in fixed steps instead of rotating smoothly.</small></span>
        <span class="settings-state">{{ preferences.snapTurn ? 'On' : 'Off' }}</span><input type="checkbox" role="switch" :checked="preferences.snapTurn" aria-label="Snap turning (30 degrees)" @change="change({ snapTurn: ($event.target as HTMLInputElement).checked })"><i class="ui-switch" aria-hidden="true" /></label>
      <label class="ui-row settings-row"><span class="ui-row-body"><b>Reduce shake and flashes</b><small>No camera nudge or freeze on big moments. Follows your device's Reduced Motion setting until you choose.</small></span>
        <span class="settings-state">{{ preferences.reduceShake ?? reducedMotion ? 'On' : 'Off' }}</span><input type="checkbox" role="switch" :checked="preferences.reduceShake ?? reducedMotion" aria-label="Reduce shake and flashes" @change="change({ reduceShake: ($event.target as HTMLInputElement).checked })"><i class="ui-switch" aria-hidden="true" /></label>
    </div>
    <p v-if="warning" class="ui-error" role="alert">{{ warning }}</p>
  </section>
</template>

<style scoped src="../../../ui/panels/settings.css"></style>
