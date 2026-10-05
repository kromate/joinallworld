<script setup lang="ts">
// A modal sheet on the platform's <dialog>. The browser does the hard parts and this component
// does not second-guess them: showModal() traps focus inside the sheet, makes the page behind
// inert, and close() returns focus to the control that opened it.
//
// What the sheet adds: it follows `open`; Esc and a tap on the backdrop ask to close (`close`),
// and the owner decides — a `locked` sheet (a step the player must finish) refuses both, and is
// put straight back if the browser closes it anyway (a second Esc can).
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  open: boolean
  /** The sheet must be completed: Esc, the backdrop and the close button do nothing. */
  locked?: boolean
  /** The accessible name when the sheet has no visible heading of its own. */
  label?: string
}>(), { locked: false, label: undefined })
const emit = defineEmits<{
  /** Esc, the back gesture, the backdrop or the close button. `by` says which. */
  close: [by: 'escape' | 'backdrop' | 'button']
  /** A locked sheet was asked to close. */
  refused: []
}>()

const dialog = ref<HTMLDialogElement | null>(null)

function sync(): void {
  const node = dialog.value
  if (!node) return
  if (props.open && !node.open) node.showModal()
  else if (!props.open && node.open) node.close()
}
onMounted(sync)
watch(() => props.open, () => { void nextTick(sync) })
onBeforeUnmount(() => { if (dialog.value?.open) dialog.value.close() })

function onCancel(event: Event): void {
  // Always handled here: the owner closes the sheet by changing `open`, so state and dialog cannot disagree.
  event.preventDefault()
  if (props.locked) emit('refused'); else emit('close', 'escape')
}
function onNativeClose(): void {
  // Closed by the browser while it should be open (a second Esc on a locked sheet): put it back.
  if (props.open) void nextTick(sync)
}
// A tap outside the sheet closes it; a press that began inside (a text selection dragged out) does not.
let pressedOutside = false
function onPointerDown(event: PointerEvent): void { pressedOutside = event.target === dialog.value }
function onClick(event: MouseEvent): void {
  if (event.target === dialog.value && pressedOutside) { if (props.locked) emit('refused'); else emit('close', 'backdrop') }
  pressedOutside = false
}

defineExpose({ element: dialog })
</script>

<template>
  <dialog ref="dialog" class="base-sheet" :data-locked="locked ? '' : undefined" :aria-label="label" @cancel="onCancel" @close="onNativeClose" @pointerdown="onPointerDown" @click="onClick">
    <button v-if="!locked" class="base-sheet-close" type="button" aria-label="Close" @click="emit('close', 'button')">×</button>
    <slot />
  </dialog>
</template>

<style scoped>
.base-sheet { border: 0; padding: 0; border-radius: var(--r-xl); width: min(480px, calc(100% - 24px)); max-width: none; max-height: min(calc(88 * var(--ui-vh)), 780px); background: #fff; color: var(--c-ink); font-family: var(--font); overflow: hidden; box-shadow: var(--e-3); }
.base-sheet[open] { display: flex; flex-direction: column; }
.base-sheet:focus, .base-sheet:focus-visible { outline: none; }
.base-sheet::backdrop { background: #0c1a1485; backdrop-filter: blur(3px); }
.base-sheet-close { position: absolute; right: 10px; top: 9px; z-index: 4; display: grid; place-items: center; width: var(--tap); height: var(--tap); border: 0; border-radius: 50%; background: var(--c-fill); color: var(--c-ink); font-size: 24px; line-height: 1; cursor: pointer; }
.base-sheet-close:hover { background: var(--c-fill-2); }
.base-sheet-close:focus-visible { outline: var(--focus); outline-offset: 2px; }
</style>
