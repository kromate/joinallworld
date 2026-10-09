<script setup lang="ts">
// The one dialog of the game, and whatever sheet is open in it: the Phone (its home screen and
// every app), the Sim sheet, Help, or a modal panel such as character creation.
//
// Focus is the platform's: BaseSheet opens a modal <dialog>, so the page behind is inert, focus
// is trapped inside and returns to the control that opened the sheet. On top of that this host
// keeps the existing rules — Esc goes back one level inside the phone before it closes, a panel
// gets Esc first (a chat goes back to the list), and a panel that must be completed cannot be
// closed and says why.
//
// The dialog keeps the id `life-dialog`: existing panels and the phone's stylesheet are written
// against it. It goes when the last of them is converted.
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { Component } from 'vue'
import '../../../ui/controls.css' // the fields, selects and buttons every sheet's panel uses (a panel that does not import it itself would be unstyled until one that does has loaded)
import { useApp } from '../../state/app.ts'
import BaseSheet from '../../ui/BaseSheet.vue'

const { game, shell } = useApp()
const sheet = shell.sheet
const inPhone = shell.inPhone
const panel = computed(() => (sheet.value?.kind === 'panel' ? shell.byId.get(sheet.value.id) ?? null : null))
const lock = computed(() => { void game.view.value; return sheet.value ? shell.lockOf() : null })
const body = ref<{ back(): boolean } | null>(null)
const renderer = shallowRef<Component | null>(null)
const failed = ref(false)
let loading: Promise<void> | null = null
let gone = false
const scope = computed(() => JSON.stringify([game.session.value?.id ?? null, game.cityId.value]))
function loadBody(): void {
  if (renderer.value || loading || !sheet.value) return
  failed.value = false
  loading = import('./SheetBody.vue').then(module => {
    if (!gone) renderer.value = module.default
  }, () => { if (!gone) failed.value = true }).finally(() => { loading = null })
}
watch(() => Boolean(sheet.value), open => { if (open) loadBody() }, { immediate: true })
/** A panel that takes the whole screen (the character creator): no app bar, no lock note, no corner button. */
const fullscreen = computed(() => !inPhone.value && panel.value?.fullscreen === true)

function onClose(by: 'escape' | 'backdrop' | 'button'): void {
  if (lock.value) { refused(); return }
  if (by === 'escape') {
    // The panel in front gets Esc first; if it handled it, nothing is closed.
    if (shell.panelKeys('cancel')) return
    if (inPhone.value && body.value?.back()) return
  }
  shell.close()
}
// Esc is taken at the key (App.vue) and run here, so the browser's own dialog closing never sees it:
// a browser lets only one Esc in a row be refused, and going back level by level needs several.
// The dialog's `cancel` event still arrives for the back gesture, and lands in the same function.
shell.escape.run = () => { if (lock.value) refused(); else onClose('escape') }
onBeforeUnmount(() => { gone = true; shell.escape.run = null })
function refused(): void { const reason = lock.value?.reason; if (reason) game.toast(reason) }
</script>

<template>
  <BaseSheet id="life-dialog" :open="Boolean(sheet)" :locked="Boolean(lock)" :data-phone="inPhone ? '' : undefined" :label="inPhone ? 'Phone' : fullscreen ? panel?.title : undefined" :class="{ 'is-phone': inPhone, 'is-fullscreen': fullscreen }" @close="onClose" @refused="refused">
    <component :is="renderer" v-if="sheet && renderer" :key="scope" ref="body" :fullscreen="fullscreen" :lock-reason="lock?.reason" />
    <div v-else-if="sheet" id="life-dialog-content" class="sheet-body" :aria-busy="!failed">
      <p :role="failed ? 'alert' : 'status'">{{ failed ? 'This screen could not load. Try again when your connection is ready.' : 'Loading screen…' }}</p>
      <button v-if="failed" type="button" class="ui-button" @click="loadBody">Try loading screen again</button>
      <p v-if="lock" class="sheet-lock" role="note">🔒 {{ lock.reason }}</p>
      <button v-else type="button" class="ui-button" @click="onClose('button')">Close</button>
    </div>
  </BaseSheet>
</template>

<style scoped>
/* In the phone the device has its own Close; the sheet's corner button would sit on the bezel. */
.is-phone :deep(.base-sheet-close) { display: none; }
</style>
