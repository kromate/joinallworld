<script setup lang="ts">
// "Allworld was updated. Reload to continue." — shown after a lazy chunk failed because the app was updated (state/updateNotice.ts).
// Text only; non-blocking; the player taps Reload (never automatic: a draft or a running activity must not be lost).
import { updateAvailable } from '../state/updateNotice.ts'
const dismiss = (): void => { updateAvailable.value = false }
const reload = (): void => { globalThis.location.reload() }
</script>

<template>
  <Teleport to="body">
    <aside v-if="updateAvailable" class="update-banner" role="status">
      <span>Allworld was updated. Reload to continue.</span>
      <button type="button" class="ui-button is-primary is-small" @click="reload">Reload</button>
      <button type="button" class="update-banner-close" aria-label="Dismiss" @click="dismiss">×</button>
    </aside>
  </Teleport>
</template>

<style scoped>
.update-banner { box-sizing: border-box; position: fixed; left: 50%; top: calc(env(safe-area-inset-top) + 8px); transform: translateX(-50%); z-index: 70; display: flex; gap: 10px; align-items: center; width: min(440px, calc(100% - 16px)); min-height: 56px; padding: 10px 12px 10px 14px; border-radius: 16px; background: #fff; color: var(--c-ink); border-left: 5px solid #e39a1c; box-shadow: 0 8px 28px rgba(0, 0, 0, .28); font: 600 14px var(--font); }
.update-banner span { flex: 1; min-width: 0; }
.update-banner button { flex: none; min-height: 36px; }
.update-banner .update-banner-close { width: 32px; border: 0; border-radius: 50%; background: var(--c-fill); color: var(--c-ink); font-size: 18px; line-height: 1; cursor: pointer; }
</style>
