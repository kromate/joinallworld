<script setup lang="ts">
// The preview stage of the look editor: the character in 3D (src/scene/avatar-preview.ts, drawn on
// demand only, never in a loop) with the flat figure under it until the canvas has arrived or when
// WebGL is not there. variant 'hero' is the creator, 'wide' is Profile and Boutique, 'mini' sits
// beside the later creation steps. The controls sit in a row under the stage, never over the
// character: the Face / Full body switch, `caption` and whatever the `tools` slot holds.
import '../../../ui/panels/look-ui.css'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Look } from '../../../types/life.ts'
import GameIcon from '../../ui/GameIcon.vue'
import AvatarFigure from './AvatarFigure.vue'
import { leaveLookPreview, setPreviewFocus, showLookPreview } from './lookPreview.ts'
import type { StageHandle, StageMode } from './lookPreview.ts'
import { lookAlt, lookFocus, lookUi, sceneLook, toggleZoom } from './lookModel.ts'

const props = withDefaults(defineProps<{
  look: Look
  variant?: 'hero' | 'wide' | 'mini'
  /** Whose Sim it is, for the text alternative. */
  name?: string
  caption?: string
}>(), { variant: 'hero', name: 'Your Sim', caption: '' })

const mini = computed(() => props.variant === 'mini')
const mode = ref<StageMode>('loading')
const host = ref<HTMLElement | null>(null)
const focus = computed(() => lookFocus())
const alt = computed(() => lookAlt(props.look, props.name))
let handle: StageHandle | null = null

function request(): void {
  if (!handle) return
  showLookPreview({ stage: handle, look: sceneLook(props.look), focus: focus.value, label: `${alt.value} Drag, or use the left and right arrow keys, to turn.` })
}
onMounted(() => {
  const element = host.value
  if (!element) return
  handle = { host: element, setMode: (next) => { mode.value = next }, connected: () => element.isConnected }
  request()
})
// A look that changed costs one frame; so does a change of where the preview looks.
watch([() => JSON.stringify(sceneLook(props.look)), focus, alt], request)
onBeforeUnmount(() => { if (handle) leaveLookPreview(handle); handle = null })

function zoom(): void { setPreviewFocus(toggleZoom()) }
</script>

<template>
  <div class="look-view" :class="`is-${variant}`">
    <div class="look-stage" data-look-stage :data-mode="mode" :data-spun="lookUi.spun ? '' : undefined">
      <div ref="host" class="look-stage-view" data-look-canvas><AvatarFigure :look="look" :size="150" :label="alt" /></div>
      <p v-if="!mini" class="look-hint" aria-hidden="true">↔ Drag to spin</p>
    </div>
    <div v-if="!mini" class="look-bar">
      <button type="button" class="look-tool" data-look-zoom :aria-pressed="focus === 'head'" title="Switch between full body and face" @click="zoom">
        <template v-if="focus === 'head'"><GameIcon name="person" inline /> Full body</template>
        <template v-else><GameIcon name="search" inline /> Face</template>
      </button>
      <p class="look-caption">{{ caption }}</p>
      <slot name="tools" />
    </div>
  </div>
</template>
