<script setup lang="ts">
// The shortcuts sheet (the ? key, Phone → Help, the tour's last card): the keys the game answers to, in groups, with
// key-caps; on a device with no keyboard, the gestures. The rows come from src/ui/keys.ts (shortcutsModel.ts).
import { computed } from 'vue'
import BaseSheet from '../../ui/BaseSheet.vue'
import { shortcutGroups } from './shortcutsModel.ts'

const emit = defineEmits<{ close: [] }>()
const touch = globalThis.matchMedia?.('(pointer: coarse)').matches === true
const groups = computed(() => shortcutGroups(touch))
// The sheet owns the keyboard while it is open: Esc and ? close it, and nothing reaches the game behind it.
function onKey(event: KeyboardEvent): void {
  event.stopPropagation()
  if (event.key === 'Escape' || event.key === '?') { event.preventDefault(); emit('close') }
}
</script>

<template>
  <BaseSheet class="shortcuts" open :label="touch ? 'How to get around' : 'Keyboard shortcuts'" @close="emit('close')" @keydown="onKey">
    <header class="shortcuts-head"><h2>{{ touch ? 'How to get around' : 'Keyboard shortcuts' }}</h2><p>{{ touch ? 'Touch gestures in Allworld.' : 'Press ? any time to open this list. Shortcuts wait while you type in a box.' }}</p></header>
    <div class="shortcuts-body">
      <section v-for="group in groups" :key="group.id" class="shortcuts-group" :aria-labelledby="`sc-${group.id}`">
        <h3 :id="`sc-${group.id}`">{{ group.title }}</h3>
        <dl>
          <div v-for="row in group.rows" :key="row.text + row.caps.join()"><dt><kbd v-for="cap in row.caps" :key="cap">{{ cap }}</kbd></dt><dd>{{ row.text }}</dd></div>
        </dl>
      </section>
    </div>
  </BaseSheet>
</template>

<style scoped>
.shortcuts { width: min(760px, calc(100% - 24px)); z-index: 70; }
.shortcuts-head { padding: 18px 64px 10px 20px; border-bottom: 1px solid var(--c-line); }
h2 { margin: 0; font-size: var(--t-heading); }
.shortcuts-head p { margin: 4px 0 0; color: var(--c-muted); font-size: var(--t-body); }
.shortcuts-body { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 4px 28px; padding: 8px 20px 20px; overflow: auto; }
h3 { margin: 14px 0 6px; color: var(--c-green-dark); font-size: var(--t-small); letter-spacing: .06em; text-transform: uppercase; }
dl { margin: 0; display: grid; gap: 6px; }
dl > div { display: flex; align-items: center; gap: 12px; min-height: 30px; }
dt { display: inline-flex; flex: none; flex-wrap: wrap; gap: 3px; width: 168px; }
dd { margin: 0; color: var(--c-ink-2); font-size: 14px; }
kbd { display: inline-grid; place-items: center; min-width: 26px; height: 26px; padding: 0 7px; border: 1px solid #c9cfcb; border-bottom-width: 2px; border-radius: 6px; background: #f6f8f7; color: var(--c-ink); font: 700 12px var(--font); }
@media (max-width: 480px) { dt { width: 96px; } dd { font-size: 13px; } }
</style>
