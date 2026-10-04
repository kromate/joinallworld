<script setup lang="ts">
// The one banner a link landing says ("You're joining Ada"). It is text only: a player's name is
// never markup. It leaves when closed or after 12 s (landingStore.ts). Over an open sheet it goes
// inside the dialog, which is the browser's top layer.
import type { ShownBanner } from './landingStore.ts'

defineProps<{
  banner: ShownBanner | null
  /** A selector for the element it lives in: the open dialog, else 'body'. */
  host?: string
}>()
const emit = defineEmits<{ knock: []; close: [] }>()
</script>

<template>
  <Teleport :to="host ?? 'body'">
    <aside v-if="banner" :key="banner.id" class="qs-banner" :class="`is-${banner.tone}`" role="status">
      <div><strong>{{ banner.title }}</strong><small>{{ banner.text }}</small></div>
      <button v-if="banner.knock && banner.knockHost" type="button" class="ui-button is-primary is-small" @click="emit('knock')">Knock</button>
      <button type="button" class="qs-banner-close" aria-label="Dismiss" @click="emit('close')">×</button>
    </aside>
  </Teleport>
</template>

<style scoped>
.qs-banner { box-sizing: border-box; position: fixed; left: 50%; top: calc(env(safe-area-inset-top) + 8px); transform: translateX(-50%); z-index: 30; display: flex; gap: 10px; align-items: center; width: min(440px, calc(100% - 16px)); min-height: 56px; padding: 10px 12px 10px 14px; border-radius: 16px; background: #fff; color: var(--c-ink); box-shadow: 0 8px 28px rgba(0, 0, 0, .28); font-family: var(--font); }
.qs-banner.is-good { border-left: 5px solid var(--c-green-dark); }
.qs-banner.is-info { border-left: 5px solid #e39a1c; }
.qs-banner div { flex: 1; min-width: 0; }
.qs-banner strong { display: block; font-size: 14px; }
.qs-banner small { display: block; font-size: 12px; line-height: 1.35; color: var(--c-muted); }
.qs-banner button { flex: none; min-height: 36px; }
.qs-banner .qs-banner-close { width: 32px; border: 0; border-radius: 50%; background: var(--c-fill); color: var(--c-ink); font-size: 18px; line-height: 1; cursor: pointer; }
</style>
