<script setup lang="ts">
// A picture in a bubble: the right shape from the start (no jump when it loads), blurred until tapped when it is from a new friend or
// a friend's first, and plain words instead when it expired, is hidden pending review, was reported by you, or is switched off for you.
import { computed, ref, watch } from 'vue'
import { pictureUrl } from './pictureModel.ts'
import type { PictureView } from '../../../types/social.ts'

const props = defineProps<{ image: PictureView; meId?: string }>()
const emit = defineEmits<{ open: [] }>()
const revealed = ref(false)
const state = ref<'loading' | 'ready' | 'failed'>('loading')
const tries = ref(0)
const words: Record<string, string> = { expired: 'Picture expired', hidden: 'This picture is hidden while it is being reviewed', reported: 'You reported this picture. It is hidden for you', off: 'Pictures are switched off in your settings' }
const blurred = computed(() => props.image.blur === true && !revealed.value)
const shape = computed(() => ({ aspectRatio: `${props.image.width} / ${props.image.height}`, width: `${Math.min(240, props.image.width)}px` }))
function tap(): void { if (blurred.value) revealed.value = true; else emit('open') }
function retry(): void { state.value = 'loading'; tries.value += 1 }
watch([() => props.image.id, () => props.meId], () => { revealed.value = false; state.value = 'loading'; tries.value = 0 }, { flush: 'sync' })
</script>

<template>
  <div v-if="image.state" class="pic is-gone" role="img" :aria-label="words[image.state]">{{ words[image.state] }}</div>
  <div v-else class="pic" :style="shape">
    <button type="button" class="pic-hit" :aria-label="blurred ? 'Show picture' : 'Open picture'" @click="tap">
      <img :key="`${meId}:${image.id}:${tries}`" :src="`${pictureUrl(image.id, meId)}${tries ? `${meId ? '&' : '?'}try=${tries}` : ''}`" alt="Picture" decoding="async" loading="lazy" :class="{ 'is-blurred': blurred, 'is-loading': state === 'loading' }" :width="image.width" :height="image.height" @load="state = 'ready'" @error="state = 'failed'">
      <span v-if="blurred && state === 'ready'" class="pic-cover">Tap to show</span>
    </button>
    <span v-if="state === 'loading'" class="pic-note" role="status">Loading…</span>
    <span v-else-if="state === 'failed'" class="pic-note is-warn" role="alert">Could not load. <button type="button" class="pic-retry" @click="retry">Retry</button></span>
  </div>
</template>

<style scoped>
.pic { position: relative; max-width: 100%; overflow: hidden; border-radius: 12px; background: var(--c-fill-2); }
.pic-hit { display: block; width: 100%; height: 100%; padding: 0; border: 0; background: none; cursor: zoom-in; }
.pic img { display: block; width: 100%; height: 100%; object-fit: cover; }
.pic img.is-blurred { filter: blur(22px); transform: scale(1.1); }
.pic img.is-loading { opacity: 0; }
.pic-cover { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0, 0, 0, .18); color: #fff; font: 700 13px var(--font); }
.pic-note { position: absolute; inset: 0; display: grid; place-items: center; font-size: 12px; color: var(--c-muted); text-align: center; }
.pic-note.is-warn { color: var(--c-red); }
.pic-retry { padding: 0 6px; border: 0; background: none; color: var(--c-green-dark); font: 700 12px var(--font); text-decoration: underline; cursor: pointer; }
.pic.is-gone { padding: 14px 16px; width: 200px; max-width: 100%; box-sizing: border-box; font-size: 12px; line-height: 1.4; color: var(--c-muted); text-align: center; }
</style>
