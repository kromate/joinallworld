<script setup lang="ts">
// The photos of a shop: the cover (the first photo) large directly under the sign, the others in a row that swipes sideways,
// and a larger view with next and previous (buttons, arrow keys, a swipe). Alt text is the seller's caption when there is one.
import { computed, nextTick, ref } from 'vue'
import BaseSheet from '../../ui/BaseSheet.vue'
import { photoAlt, photoUrl } from './showcaseModel.ts'

const props = defineProps<{ name: string; photos: readonly { id: string; w: number; h: number; caption?: string }[]; reportable?: boolean }>()
const emit = defineEmits<{ report: [photo: string] }>()
const at = ref<number | null>(null)
const opener = ref<HTMLElement | null>(null)
const count = computed(() => props.photos.length)
const current = computed(() => (at.value === null ? null : props.photos[at.value] ?? null))
const alt = (index: number): string => { const photo = props.photos[index]; return photo ? photoAlt(props.name, photo, index, count.value) : '' }

function show(index: number, event?: Event): void {
  at.value = index
  if (event?.currentTarget instanceof HTMLElement) opener.value = event.currentTarget
}
function step(by: -1 | 1): void { if (at.value !== null && count.value) at.value = (at.value + by + count.value) % count.value }
function close(): void { at.value = null; const back = opener.value; void nextTick(() => back?.focus()) }
function key(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1) } else if (event.key === 'ArrowRight') { event.preventDefault(); step(1) }
}
let startX = 0
const down = (event: PointerEvent): void => { startX = event.clientX }
function up(event: PointerEvent): void { const moved = event.clientX - startX; if (Math.abs(moved) > 48) step(moved < 0 ? 1 : -1) }
</script>

<template>
  <section v-if="count" class="pg" aria-label="Photos">
    <button type="button" class="pg-cover" :aria-label="`View larger: ${alt(0)}`" @click="show(0, $event)">
      <img :src="photoUrl(photos[0]!.id)" :alt="alt(0)" :width="photos[0]!.w" :height="photos[0]!.h" loading="eager">
    </button>
    <ul v-if="count > 1" class="pg-row" tabindex="0" aria-label="More photos, swipe sideways">
      <li v-for="(photo, index) in photos.slice(1)" :key="photo.id">
        <button type="button" :aria-label="`View larger: ${alt(index + 1)}`" @click="show(index + 1, $event)"><img :src="photoUrl(photo.id)" :alt="alt(index + 1)" loading="lazy" width="96" height="96"></button>
      </li>
    </ul>
    <BaseSheet :open="current !== null" :label="`${name}, photo ${(at ?? 0) + 1} of ${count}`" @close="close">
      <div v-if="current" class="pg-view" @keydown="key">
        <img class="pg-big" :src="photoUrl(current.id)" :alt="alt(at ?? 0)" @pointerdown="down" @pointerup="up">
        <p class="pg-cap" aria-live="polite">{{ current.caption || name }} <span>({{ (at ?? 0) + 1 }} of {{ count }})</span></p>
        <div class="pg-nav">
          <button type="button" class="ui-button is-small" :disabled="count < 2" @click="step(-1)">Previous</button>
          <button type="button" class="ui-button is-small" :disabled="count < 2" @click="step(1)">Next</button>
          <button v-if="reportable" type="button" class="ui-button is-quiet is-small" @click="emit('report', current.id); close()">Report photo</button>
        </div>
      </div>
    </BaseSheet>
  </section>
</template>

<style scoped>
.pg { display: grid; gap: var(--s-2); }
.pg-cover { display: block; width: 100%; padding: 0; border: 0; border-radius: var(--r-md); overflow: hidden; background: var(--c-fill); cursor: zoom-in; }
.pg-cover img { display: block; width: 100%; aspect-ratio: 4 / 3; max-height: 320px; object-fit: cover; }
.pg-row { list-style: none; margin: 0; padding: 2px 0 6px; display: flex; gap: var(--s-2); overflow-x: auto; scroll-snap-type: x proximity; overscroll-behavior-x: contain; }
.pg-row li { flex: none; scroll-snap-align: start; }
.pg-row button { display: block; padding: 0; border: 0; border-radius: var(--r-sm); overflow: hidden; background: var(--c-fill); cursor: zoom-in; }
.pg-row img { display: block; width: 96px; height: 96px; object-fit: cover; }
.pg-cover:focus-visible, .pg-row button:focus-visible, .pg-row:focus-visible { outline: var(--focus); outline-offset: 2px; }
.pg-view { display: grid; gap: var(--s-2); padding: 52px var(--s-3) var(--s-3); overflow: auto; }
.pg-big { width: 100%; max-height: 58vh; object-fit: contain; background: #0c1a14; border-radius: var(--r-sm); touch-action: pan-y; }
.pg-cap { margin: 0; font-size: var(--t-body); overflow-wrap: anywhere; }
.pg-cap span { color: var(--c-muted); font-size: var(--t-small); }
.pg-nav { display: flex; flex-wrap: wrap; gap: var(--s-2); }
@media (prefers-reduced-motion: no-preference) { .pg-row { scroll-behavior: smooth; } }
</style>
