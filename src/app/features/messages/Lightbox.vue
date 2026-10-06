<script setup lang="ts">
// A picture full size: closes on Escape or a tap outside it, zooms with two fingers (or double tap) and with the wheel, and offers Report.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import BaseButton from '../../ui/BaseButton.vue'
import { pictureUrl } from './pictureModel.ts'

defineProps<{ id: string; caption: string; from: string; mine: boolean }>()
const emit = defineEmits<{ close: []; report: [] }>()
const scale = ref(1)
const pointers = new Map<number, { x: number; y: number }>()
let start = 0, begin = 1
const spread = (): number => { const [a, b] = [...pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0 }
function down(event: PointerEvent): void { pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (pointers.size === 2) { start = spread(); begin = scale.value } }
function move(event: PointerEvent): void { if (!pointers.has(event.pointerId)) return; pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (pointers.size === 2 && start) scale.value = Math.min(5, Math.max(1, begin * spread() / start)) }
function up(event: PointerEvent): void { pointers.delete(event.pointerId) }
const wheel = (event: WheelEvent): void => { scale.value = Math.min(5, Math.max(1, scale.value - event.deltaY / 400)) }
const toggle = (): void => { scale.value = scale.value > 1 ? 1 : 2.5 }
function key(event: KeyboardEvent): void { if (event.key === 'Escape') { event.stopPropagation(); emit('close') } }
const box = ref<HTMLElement | null>(null)
onMounted(() => { document.addEventListener('keydown', key, true); box.value?.focus() })
onBeforeUnmount(() => document.removeEventListener('keydown', key, true))
</script>

<template>
  <div ref="box" class="lightbox" role="dialog" aria-modal="true" aria-label="Picture" tabindex="-1" @click.self="emit('close')">
    <div class="lightbox-bar"><span>{{ mine ? 'You' : from }}<template v-if="caption"> · {{ caption }}</template></span>
      <BaseButton v-if="!mine" small @click="emit('report')">Report</BaseButton><BaseButton small variant="primary" @click="emit('close')">Close</BaseButton></div>
    <div class="lightbox-stage" @click.self="emit('close')" @wheel.prevent="wheel">
      <img :src="pictureUrl(id)" alt="Picture" :style="{ transform: `scale(${scale})` }" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @dblclick="toggle">
    </div>
  </div>
</template>

<style scoped>
.lightbox { position: fixed; inset: 0; z-index: 90; display: flex; flex-direction: column; background: rgba(8, 12, 10, .94); color: #fff; outline: none; }
.lightbox-bar { display: flex; align-items: center; gap: 8px; padding: 10px 12px; font-size: 13px; }
.lightbox-bar span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lightbox-stage { flex: 1; display: grid; place-items: center; min-height: 0; overflow: hidden; touch-action: none; }
.lightbox-stage img { max-width: 100%; max-height: 100%; object-fit: contain; transition: transform .12s ease-out; user-select: none; -webkit-user-drag: none; }
</style>
