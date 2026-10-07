<script setup lang="ts">
// A small, closable tip for players who opened Allworld inside another app's browser that is blocking storage. It never covers the game's controls:
// one short card at the top, only as wide as its text, and nothing else on the page is made inert.
import { onMounted, ref } from 'vue'
import { dismissTip, inAppTip, isStandalone, liveInAppEnv, tipDismissed } from './state/inAppBrowser.ts'

const tip = ref<ReturnType<typeof inAppTip>>(null)
const keep = (): Storage | null => { try { return window.localStorage } catch { return null } }
onMounted(() => {
  const found = inAppTip(navigator.userAgent, liveInAppEnv(), { standalone: isStandalone() })
  if (found && !tipDismissed(keep())) tip.value = found
})
const close = (): void => { dismissTip(keep()); tip.value = null }
</script>

<template>
  <aside v-if="tip" class="inapp-tip" role="status">
    <p class="inapp-title">{{ tip.title }}</p>
    <p class="inapp-detail">{{ tip.detail }}</p>
    <button type="button" @click="close">{{ tip.dismiss }}</button>
  </aside>
</template>

<style scoped>
.inapp-tip { position: fixed; z-index: 90; top: max(8px, env(safe-area-inset-top)); left: max(8px, env(safe-area-inset-left)); right: max(8px, env(safe-area-inset-right)); width: fit-content; max-width: 26rem; margin-inline: auto; padding: 10px 14px; box-sizing: border-box; border-radius: var(--r-md); background: var(--c-surface-solid); color: var(--c-ink); box-shadow: 0 4px 18px rgba(0, 0, 0, .25); font: 14px/1.4 var(--font); }
p { margin: 0; }
.inapp-title { font-weight: 700; }
.inapp-detail { margin-top: 2px; color: var(--c-muted); }
button { min-height: var(--tap); margin-top: 6px; padding: 8px 18px; border: 0; border-radius: var(--r-pill); background: var(--c-green-dark); color: var(--c-surface-solid); font: inherit; font-weight: 700; cursor: pointer; }
button:focus-visible { outline: var(--focus); outline-offset: 3px; }
</style>
