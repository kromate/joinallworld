<script setup lang="ts">
// The stage of the character creator: the character large, lit, and turnable. It is the one 3D preview
// of the app (src/scene/avatar-preview.ts) drawn on demand only — a frame when the look, the view or
// the size changes, one per pointer or key event while turning, and a short bounded ease after a drag
// or a button — never a loop. Until the canvas has arrived the stage shows a still silhouette; when
// WebGL is not available it shows the flat figure, large, instead.
//
// Controls: drag (mouse or touch) or ← / → on the focused stage to turn; Turn left, Turn right, Turn
// around; Body / Face / Outfit for how close to look. They are real buttons over the stage, never in
// the way of the character.
import '../../../ui/panels/look-ui.css'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PreviewFocus } from '../../../scene/avatar-preview.ts'
import type { Look } from '../../../types/life.ts'
import GameIcon from '../../ui/GameIcon.vue'
import AvatarFigure from './AvatarFigure.vue'
import { FOCUS_CHOICES } from './creatorModel.ts'
import { leaveLookPreview, showLookPreview, turnPreview } from './lookPreview.ts'
import type { StageHandle, StageMode } from './lookPreview.ts'
import { lookAlt, lookUi, markSpun, sceneLook } from './lookModel.ts'

const props = defineProps<{ look: Look; name: string; focus: PreviewFocus; caption?: string }>()
const emit = defineEmits<{ focus: [value: PreviewFocus] }>()

const mode = ref<StageMode>('loading')
const host = ref<HTMLElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const tools = ref<HTMLElement | null>(null)
const alt = computed(() => lookAlt(props.look, props.name))
let handle: StageHandle | null = null

/** How much of the stage's bottom the buttons take: the character stands above it. */
function inset(): number { return stage.value && tools.value ? Math.max(0, stage.value.clientHeight - tools.value.offsetTop + 4) : 0 }
function request(): void {
  if (!handle) return
  showLookPreview({ stage: handle, inset: inset(), look: sceneLook(props.look), focus: props.focus, label: `${alt.value} Drag, or use the left and right arrow keys, to turn.` })
}
onMounted(() => {
  const element = host.value
  if (!element) return
  handle = { host: element, setMode: (next) => { mode.value = next }, connected: () => element.isConnected }
  request()
  window.addEventListener('resize', request)
})
watch([() => JSON.stringify(sceneLook(props.look)), () => props.focus, alt], request)
onBeforeUnmount(() => { window.removeEventListener('resize', request); if (handle) leaveLookPreview(handle); handle = null })

const QUARTER = Math.PI / 4
function turn(radians: number): void { markSpun(); turnPreview(radians) }
</script>

<template>
  <div ref="stage" class="cr-stage" :data-mode="mode" :data-spun="lookUi.spun ? '' : undefined" data-cr-stage>
    <div class="cr-floor" aria-hidden="true" />
    <div ref="host" class="cr-stage-view" data-look-canvas>
      <AvatarFigure :look="look" :size="220" :label="mode === '2d' ? alt : ''" />
    </div>
    <p v-if="caption" class="cr-caption" data-cr-caption>{{ caption }}</p>
    <div ref="tools" class="cr-stage-tools">
      <div class="cr-turn" role="group" aria-label="Turn the character">
        <button type="button" class="cr-round" data-key="turn-left" aria-label="Turn left" title="Turn left" :disabled="mode !== '3d'" @click="turn(-QUARTER)"><GameIcon name="back" :size="22" /></button>
        <button type="button" class="cr-round is-wide" data-key="turn-around" aria-label="Turn around" title="Turn around" :disabled="mode !== '3d'" @click="turn(Math.PI)"><GameIcon name="refresh" :size="20" /><span class="cr-lbl">Turn around</span></button>
        <button type="button" class="cr-round" data-key="turn-right" aria-label="Turn right" title="Turn right" :disabled="mode !== '3d'" @click="turn(QUARTER)"><GameIcon name="chevron" :size="22" /></button>
      </div>
      <div class="cr-zoom" role="group" aria-label="How close to look">
        <button v-for="item in FOCUS_CHOICES" :key="item.id" type="button" :data-focus="item.id" :data-key="`focus:${item.id}`" :aria-pressed="focus === item.id" :disabled="mode !== '3d'" @click="emit('focus', item.id)">{{ item.label }}</button>
      </div>
    </div>
    <p v-if="mode === '3d' && !lookUi.spun" class="cr-hint" aria-hidden="true">Drag to turn</p>
  </div>
</template>
