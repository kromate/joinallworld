<script setup lang="ts">
// Step 2, "Make it yours": the whole look editor, inline, with large swatches, and the tools that go
// with it: undo, reset to where the step began, and a shuffle. The editor says what was chosen; the
// creator decides what to do with it.
import type { Look } from '../../../types/life.ts'
import GameIcon from '../../ui/GameIcon.vue'
import LookEditor from './LookEditor.vue'
import type { LookField, Owned } from './lookModel.ts'

defineProps<{ look: Look; owned: Owned; canUndo: boolean; canReset: boolean }>()
const emit = defineEmits<{ choose: [field: LookField, value: string]; undo: []; reset: []; shuffle: []; tab: [id: string] }>()
function onTap(event: MouseEvent): void {
  const tab = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-look-tab]') : null
  if (tab?.dataset.lookTab) emit('tab', tab.dataset.lookTab)
}
</script>

<template>
  <div class="cr-look">
    <div class="cr-tools" role="group" aria-label="Look tools">
      <button type="button" class="cr-btn is-small" data-key="undo" :disabled="!canUndo" @click="emit('undo')"><GameIcon name="back" inline /> Undo</button>
      <button type="button" class="cr-btn is-small" data-key="reset" :disabled="!canReset" @click="emit('reset')"><GameIcon name="refresh" inline /> Reset</button>
      <button type="button" class="cr-btn is-small" data-key="shuffle" @click="emit('shuffle')"><GameIcon name="game" inline /> Surprise me</button>
    </div>
    <div class="cr-editor" @click="onTap"><LookEditor :look="look" :owned="owned" @choose="(field, value) => emit('choose', field, value)" /></div>
  </div>
</template>
