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
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import '../../../ui/controls.css' // the fields, selects and buttons every sheet's panel uses (a panel that does not import it itself would be unstyled until one that does has loaded)
import { useApp } from '../../state/app.ts'
import AppBar from '../../ui/AppBar.vue'
import BaseSheet from '../../ui/BaseSheet.vue'
import PanelHost from './PanelHost.vue'
import type PhoneDeviceType from './PhoneDevice.vue'

// Fetched the first time they are shown, like the existing shell's phone: the entry stays small.
const PhoneDevice = defineAsyncComponent(() => import('./PhoneDevice.vue'))
const SimSheet = defineAsyncComponent(() => import('../sim/SimSheet.vue'))
const HelpBody = defineAsyncComponent(() => import('../help/HelpBody.vue'))

const { game, shell } = useApp()
const sheet = shell.sheet
const inPhone = shell.inPhone
const panel = computed(() => (sheet.value?.kind === 'panel' ? shell.byId.get(sheet.value.id) ?? null : null))
const lock = computed(() => { void game.view.value; return sheet.value ? shell.lockOf() : null })
const phone = ref<InstanceType<typeof PhoneDeviceType> | null>(null)
const content = ref<HTMLElement | null>(null)
/** A panel that takes the whole screen (the character creator): no app bar, no lock note, no corner button. */
const fullscreen = computed(() => panel.value?.fullscreen === true)

function onClose(by: 'escape' | 'backdrop' | 'button'): void {
  if (by === 'escape') {
    // The panel in front gets Esc first; if it handled it, nothing is closed.
    if (shell.panelKeys('cancel')) return
    if (inPhone.value && phone.value) { phone.value.back(); return }
  }
  shell.close()
}
// Esc is taken at the key (App.vue) and run here, so the browser's own dialog closing never sees it:
// a browser lets only one Esc in a row be refused, and going back level by level needs several.
// The dialog's `cancel` event still arrives for the back gesture, and lands in the same function.
shell.escape.run = () => { if (lock.value) refused(); else onClose('escape') }
onBeforeUnmount(() => { shell.escape.run = null })
function refused(): void { const reason = lock.value?.reason; if (reason) game.toast(reason) }
// A different screen starts at its top.
watch(() => (sheet.value ? `${sheet.value.kind}:${sheet.value.kind === 'panel' ? sheet.value.id : sheet.value.kind === 'sim' ? sheet.value.tab : ''}` : ''), () => { void nextTick(() => { if (content.value) content.value.scrollTop = 0 }) })
</script>

<template>
  <BaseSheet id="life-dialog" :open="Boolean(sheet)" :locked="Boolean(lock)" :data-phone="inPhone ? '' : undefined" :label="inPhone ? 'Phone' : fullscreen ? panel?.title : undefined" :class="{ 'is-phone': inPhone, 'is-fullscreen': fullscreen }" @close="onClose" @refused="refused">
    <div v-if="sheet" id="life-dialog-content" ref="content">
      <PhoneDevice v-if="inPhone" ref="phone" />
      <template v-else-if="sheet.kind === 'help'">
        <AppBar title="How to play" />
        <div class="sheet-body"><HelpBody /></div>
      </template>
      <SimSheet v-else-if="sheet.kind === 'sim'" :tab="sheet.tab" :params="sheet.params" />
      <PanelHost v-else-if="panel && fullscreen" :key="panel.id" class="sheet-fullscreen" :panel="panel" :params="sheet.kind === 'panel' ? sheet.params : null" />
      <template v-else-if="panel">
        <AppBar :title="`${panel.icon ?? ''} ${panel.title}`.trim()" :back="sheet.kind === 'panel' && sheet.from === 'phone' ? 'Back to phone' : null" @back="shell.open('phone')" />
        <p v-if="lock" class="sheet-lock" role="note">🔒 {{ lock.reason }}</p>
        <PanelHost :key="panel.id" class="sheet-body" :panel="panel" :params="sheet.kind === 'panel' ? sheet.params : null" />
      </template>
    </div>
  </BaseSheet>
</template>

<style scoped>
/* In the phone the device has its own Close; the sheet's corner button would sit on the bezel. */
.is-phone :deep(.base-sheet-close) { display: none; }
</style>
