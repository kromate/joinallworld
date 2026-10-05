<script setup lang="ts">
// The toast stack. Toasts must never be covered: a modal dialog sits in the browser's top layer,
// so the stack moves into the open dialog (`host`) and back to the page when it closes.
import { toasts } from '../state/toasts.ts'
import GameIcon from './GameIcon.vue'
import GlyphText from '../features/kit/GlyphText.vue'
import { stripLeadEmoji } from '../../ui/icon-map.ts'

withDefaults(defineProps<{
  /** A selector for the element the stack lives in: the open dialog, else 'body'. */
  host?: string
}>(), { host: 'body' })
</script>

<template>
  <Teleport :to="host">
    <div class="toast-stack" :class="{ 'is-in-dialog': host !== 'body' }" role="status" aria-live="polite">
      <div v-for="item in toasts" :key="item.id" class="toast" :class="`is-${item.kind}`">
        <span class="toast-mark"><GameIcon :name="item.kind" :size="16" /></span>
        <span class="toast-text"><GlyphText :text="stripLeadEmoji(item.text) || item.text" /></span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-stack { position: fixed; top: var(--toast-top, 84px); left: 50%; transform: translateX(-50%); display: grid; gap: 6px; justify-items: center; width: min(440px, calc(100% - 24px)); z-index: 40; pointer-events: none; font-family: var(--font); }
/* In a sheet the stack hangs under the header (62px tall), inside the sheet: the title and the close button stay clear. */
.toast-stack.is-in-dialog { top: 12px; z-index: 12; }
#life-dialog:not([data-phone]):not(.is-fullscreen) > .toast-stack.is-in-dialog { position: absolute; top: 68px; }
.toast { display: flex; align-items: center; gap: 9px; max-width: 100%; padding: 8px 16px 8px 8px; border-radius: var(--r-lg); background: #1b1f27f7; color: #fff; font-size: var(--t-body); font-weight: 500; line-height: 1.35; box-shadow: var(--e-2), inset 0 0 0 1px #ffffff1f; animation: toast-in .18s ease-out; }
.toast-text { min-width: 0; overflow: hidden; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
.toast-mark { flex: none; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: #ffffff24; }
.toast.is-good .toast-mark, .toast.is-earn .toast-mark { background: #2f8a57; }
.toast.is-spend .toast-mark { background: #a2542a; }
.toast.is-error { background: #7d2416f7; }
.toast.is-error .toast-mark { background: #ffffff33; }
/* On a phone the stack starts under the HUD's top row and the change note that hangs from it. */
@media (max-width: 720px) { .toast-stack:not(.is-in-dialog) { top: var(--toast-top, 104px); } }
@keyframes toast-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
</style>
