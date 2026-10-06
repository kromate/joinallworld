<script lang="ts">
let faces = 0
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { COMPANION_COLOURS as C } from './identity.ts'

type Mood = 'idle' | 'happy' | 'think' | 'sleepy' | 'talk' | 'wave'
const gradient = `lumo-body-${++faces}`
const props = withDefaults(defineProps<{ size?: number, mood?: Mood, still?: boolean }>(), { size: 40, mood: 'idle', still: false })
// Eye height by mood: sleepy eyes are half shut, happy ones are squeezed into a smile.
const eye = computed(() => (props.mood === 'sleepy' ? 0.28 : props.mood === 'happy' || props.mood === 'wave' ? 0.8 : 1))
const look = computed(() => (props.mood === 'think' ? 'translate(2.4 -2.4)' : undefined))
</script>

<template>
  <svg
    class="lumo" :class="[`is-${mood}`, { still }]" :width="size" :height="size" viewBox="0 0 64 64" aria-hidden="true" focusable="false"
    :style="{ '--lumo-body': C.body, '--lumo-glow': C.glow }"
  >
    <g class="halo"><circle cx="32" cy="36" r="29" :fill="C.glow" opacity="0.25" /></g>
    <g class="bob">
      <g class="flame">
        <path d="M32 18 C26 12 29 6 32 2 C35 6 38 12 32 18 Z" :fill="C.glow" />
        <ellipse cx="38" cy="14" rx="5" ry="2.4" transform="rotate(-25 38 14)" :fill="C.accent" />
      </g>
      <g class="arm left"><ellipse cx="9" cy="39" rx="4.6" ry="8" transform="rotate(14 9 39)" :fill="C.cheek" /></g>
      <g class="arm right"><ellipse cx="55" cy="39" rx="4.6" ry="8" transform="rotate(-14 55 39)" :fill="C.cheek" /></g>
      <ellipse cx="32" cy="55" rx="15" ry="4" :fill="C.accent" />
      <defs>
        <linearGradient :id="gradient" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" :stop-color="C.body" /><stop offset="1" :stop-color="C.bodyLight" />
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="35" rx="23" ry="22" :fill="`url(#${gradient})`" />
      <rect x="25" y="14" width="14" height="5" rx="2.5" :fill="C.accent" />
      <ellipse cx="32" cy="36" rx="18" ry="14" :fill="C.face" />
      <ellipse cx="14.5" cy="40" rx="3.2" ry="2" :fill="C.cheek" opacity="0.8" />
      <ellipse cx="49.5" cy="40" rx="3.2" ry="2" :fill="C.cheek" opacity="0.8" />
      <g :transform="look">
        <g class="eyes" :style="{ '--eye': eye }">
          <ellipse class="eye" cx="24.5" cy="34" rx="4.6" ry="6" :fill="C.glow" />
          <ellipse class="eye" cx="39.5" cy="34" rx="4.6" ry="6" :fill="C.glow" />
        </g>
        <circle cx="26" cy="31.6" r="1.3" fill="#fff" /><circle cx="41" cy="31.6" r="1.3" fill="#fff" />
        <path class="mouth" d="M28 43 Q32 42.6 36 43 Q35.5 47 32 47 Q28.5 47 28 43 Z" :fill="C.glow" />
      </g>
    </g>
  </svg>
</template>

<style scoped>
.lumo { display: inline-block; flex: none; overflow: visible; vertical-align: middle; }
.bob { animation: lumo-bob 3s ease-in-out infinite; transform-origin: 32px 40px; }
.eyes { transform-box: fill-box; }
.eye { transform-box: fill-box; transform-origin: center; transform: scaleY(var(--eye, 1)); animation: lumo-blink 4.2s infinite; }
.mouth { transform-box: fill-box; transform-origin: 50% 0; transform: scaleY(0.45); }
.flame { transform-box: fill-box; transform-origin: 50% 100%; animation: lumo-sway 2.6s ease-in-out infinite; }
.halo { transform-box: fill-box; transform-origin: center; animation: lumo-glow 3s ease-in-out infinite; }
.arm { transform-box: fill-box; transform-origin: 50% 12%; }
.is-talk .mouth { animation: lumo-talk 0.5s steps(1) infinite; }
.is-happy .mouth, .is-wave .mouth { transform: scaleY(0.9); }
.is-wave .arm.right { animation: lumo-wave 0.9s ease-in-out infinite; transform: rotate(-150deg); }
.is-sleepy .bob { animation-duration: 5.5s; }
.is-sleepy .halo { opacity: 0.6; }
.is-think .flame { transform: rotate(18deg); animation: none; }
.is-think .halo { opacity: 0.7; }
.still, .still * { animation: none !important; }
@keyframes lumo-bob { 50% { transform: translateY(-2px) rotate(1.5deg); } }
@keyframes lumo-blink { 0%, 93%, 100% { transform: scaleY(var(--eye, 1)); } 96% { transform: scaleY(0.08); } }
@keyframes lumo-sway { 50% { transform: rotate(6deg); } }
@keyframes lumo-glow { 50% { transform: scale(1.06); } }
@keyframes lumo-wave { 50% { transform: rotate(-125deg); } }
@keyframes lumo-talk { 0% { transform: scaleY(0.4); } 25% { transform: scaleY(1.2); } 50% { transform: scaleY(0.6); } 75% { transform: scaleY(1.4); } }
@media (prefers-reduced-motion: reduce) { .lumo, .lumo * { animation: none !important; } }
</style>
