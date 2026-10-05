<script setup lang="ts">
// The small invitation chip that drops under the Invite button at a good moment (inviteNudgeModel.ts
// decides when). It never blocks anything: one line, one button, and a close that means "not now".
// The words are fixed text from the model, never a player's.
import GameIcon from '../../ui/GameIcon.vue'
import { inviteWords } from './inviteNudgeModel.ts'
import type { InviteMoment } from './inviteNudgeModel.ts'

defineProps<{ moment: InviteMoment }>()
const emit = defineEmits<{ accept: []; dismiss: [] }>()
</script>

<template>
  <aside class="inv-chip" role="status" :data-moment="moment">
    <span class="inv-chip-icon" aria-hidden="true"><GameIcon name="people" :size="18" /></span>
    <div class="inv-chip-words"><b>{{ inviteWords(moment).title }}</b><small>{{ inviteWords(moment).text }}</small></div>
    <button type="button" class="inv-chip-go" @click="emit('accept')">{{ inviteWords(moment).action }}</button>
    <button type="button" class="inv-chip-x" aria-label="Not now" @click="emit('dismiss')">×</button>
  </aside>
</template>

<style scoped>
.inv-chip { box-sizing: border-box; display: flex; align-items: center; gap: 10px; width: min(340px, calc(100vw - 16px)); padding: 10px 6px 10px 12px; border-radius: 16px; background: #fff; color: var(--c-ink); box-shadow: var(--e-2), var(--ring); font: 13px/1.35 var(--font); white-space: normal; pointer-events: auto; }
.inv-chip-icon { display: grid; place-items: center; flex: none; width: 32px; height: 32px; border-radius: 50%; background: var(--c-green-soft); color: var(--c-green-dark); }
.inv-chip-words { flex: 1; min-width: 0; }
.inv-chip-words b { display: block; font-size: 13px; }
.inv-chip-words small { display: block; font-size: 12px; color: var(--c-muted); }
.inv-chip button { flex: none; border: 0; font: inherit; cursor: pointer; }
.inv-chip-go { min-height: 36px; padding: 0 12px; border-radius: var(--r-pill); background: var(--c-green-dark); color: #fff; font-weight: 700; font-size: 12px; }
.inv-chip-x { width: 36px; min-height: 36px; border-radius: 50%; background: none; color: var(--c-muted); font-size: 20px; line-height: 1; }
.inv-chip button:focus-visible { outline: var(--focus); outline-offset: 2px; }
@media (prefers-reduced-motion: no-preference) { .inv-chip { animation: inv-chip-in .22s ease-out; } }
@keyframes inv-chip-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
</style>
