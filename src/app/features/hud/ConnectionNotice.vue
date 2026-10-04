<script setup lang="ts">
// The notice under the top bar: shown for as long as the game cannot be played or saved, with what
// happened in plain words and the one action that resolves it.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import BaseButton from '../../ui/BaseButton.vue'
import GameIcon from '../../ui/GameIcon.vue'
import { hudNotice } from './hudModel.ts'

const { game, menu, startLife } = useApp()
const notice = computed(() => hudNotice(game.view.value))
const run = (action: 'new-life' | 'reconnect'): void => { if (action === 'new-life') startLife(null); else menu('reconnect') }
</script>

<template>
  <div v-if="notice" class="notice" :class="{ 'is-storage': notice.storage }" role="status">
    <i aria-hidden="true"><GameIcon :name="notice.storage ? 'error' : 'cloud-off'" :size="22" /></i>
    <div><strong>{{ notice.title }}</strong><span>{{ notice.text }}</span></div>
    <span class="notice-actions">
      <BaseButton v-for="action in notice.actions" :key="action.label" :variant="action.primary ? 'primary' : 'default'" @click="run(action.run)">{{ action.label }}</BaseButton>
    </span>
  </div>
</template>

<style scoped>
.notice { position: absolute; z-index: 5; top: 70px; left: 50%; transform: translateX(-50%); width: min(600px, calc(100% - 24px)); display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px 12px 12px 14px; background: #fff7ee; border: 1.5px solid #e2a47e; border-radius: var(--r-lg); box-shadow: var(--e-2); pointer-events: auto; color: var(--c-ink); font-family: var(--font); }
.notice > i { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: var(--c-red-dark); color: #fff; }
.notice > div { flex: 1 1 220px; min-width: 0; }
.notice strong { display: block; font-size: var(--t-lead); line-height: 1.25; }
.notice span { display: block; margin-top: 2px; font-size: var(--t-caption); line-height: 1.4; color: var(--c-ink-2); }
.notice-actions { flex: 1 1 100%; display: flex !important; flex-wrap: wrap; gap: 6px; margin: 0 !important; }
.notice-actions > * { flex: 1; white-space: nowrap; }
.notice-actions > :not(.is-primary) { background: #fff; box-shadow: inset 0 0 0 1px var(--c-line); }
.notice.is-storage { background: var(--c-amber-soft); border-color: #e0c46c; }
.notice.is-storage > i { background: var(--c-amber-dark); }
@media (max-width: 720px) { .notice { top: 58px; left: 8px; right: 8px; width: auto; transform: none; gap: 10px; padding: 10px 10px 10px 12px; } }
</style>
