<script setup lang="ts">
// The invite link as a QR code, drawn here as one SVG path from the local encoder (src/ui/qr.ts):
// nothing is requested from anywhere. It is its own component so the encoder is only fetched when a
// player asks to see the code.
import { computed } from 'vue'
import { encodeQr, qrPath } from '../../../ui/qr.ts'

const props = defineProps<{ link: string }>()
const QUIET = 4
const code = computed(() => encodeQr(props.link))
const box = computed(() => (code.value ? code.value.size + QUIET * 2 : 0))
const path = computed(() => (code.value ? qrPath(code.value) : ''))
</script>

<template>
  <figure v-if="code" class="gr-qr">
    <svg :viewBox="`${-QUIET} ${-QUIET} ${box} ${box}`" role="img" aria-label="QR code for your invite link" shape-rendering="crispEdges" width="200" height="200"><rect :x="-QUIET" :y="-QUIET" :width="box" :height="box" fill="#fff" /><path :d="path" fill="#111" /></svg>
    <figcaption>Point a friend’s camera at this.</figcaption>
  </figure>
  <p v-else class="gr-note">This link is too long to show as a code. Copy it instead.</p>
</template>

<style scoped>
.gr-qr { margin: 0 0 var(--s-3); display: grid; justify-items: center; gap: 6px; }
.gr-qr svg { width: min(200px, 60vw); height: auto; border-radius: 12px; box-shadow: var(--e-1), var(--ring); background: #fff; }
.gr-qr figcaption, .gr-note { font-size: 12px; color: var(--c-muted); }
</style>
