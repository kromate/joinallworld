<script setup lang="ts">
// One announcement, as a calm card in the stack above the navigation: a title, a line of text, and (when the admin chose one) a button that opens
// one in-game panel from a fixed list. It can be dismissed; it is also in Messages → Updates.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import BaseButton from '../../ui/BaseButton.vue'
import { announceUi, dismissAnnounce } from './announceStore.ts'

const { shell } = useApp()
const item = computed(() => announceUi.banner)
const LABELS = { map: 'Open the Map', missions: 'See Missions', business: 'Open Business', invite: 'Invite a friend' } as const
function go(): void {
  const action = item.value?.action
  dismissAnnounce()
  if (action) shell.open(action)
}
</script>

<template>
  <aside v-if="item" class="announce-card" role="status" aria-live="polite" aria-label="Announcement">
    <div class="announce-text"><b>{{ item.title }}</b><span>{{ item.body }}</span></div>
    <BaseButton v-if="item.action" variant="primary" small @click="go">{{ LABELS[item.action] }}</BaseButton>
    <button type="button" class="announce-close" aria-label="Dismiss" @click="dismissAnnounce">×</button>
  </aside>
</template>

<style scoped>
.announce-card { box-sizing: border-box; width: 100%; max-width: 460px; display: flex; align-items: center; gap: 8px; padding: 8px 6px 8px 12px; border-radius: 12px; background: #fff8e6; color: var(--c-ink); box-shadow: inset 0 0 0 1px #ecd9a3, var(--e-1, 0 2px 8px rgba(0, 0, 0, .12)); font: 500 13px/1.35 var(--font); pointer-events: auto; }
.announce-text { flex: 1; min-width: 0; display: grid; gap: 2px; }
.announce-card :deep(.base-button) { flex: none; min-height: 32px; }
.announce-close { flex: none; width: 32px; height: 32px; border: 0; border-radius: 50%; background: transparent; color: var(--c-ink-2); font-size: 18px; line-height: 1; cursor: pointer; }
</style>
