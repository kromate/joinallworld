<script setup lang="ts">
// The green felt both games are played on: the shared look of the Whot and the penalty board (the
// table, the "what you must do" line, the turn line, a note on the felt). The game's own parts go
// in the slot.
</script>

<template>
  <div class="wh-table"><slot /></div>
</template>

<style scoped>
.wh-table { background: #1d4a34; border-radius: 20px; padding: 12px; color: #fff; display: grid; gap: 10px; margin: 0 0 var(--s-3); }
.wh-table :deep(.wh-need) { margin: 0; text-align: center; font-size: 13px; font-weight: 700; }
.wh-table :deep(.wh-need.is-warn) { color: #ffd27a; }
.wh-table :deep(.wh-need .ui-glyph) { width: 18px; height: 18px; vertical-align: -4px; }
.wh-table :deep(.wh-turn) { margin: 0; text-align: center; font-size: 15px; font-weight: 800; min-height: 22px; }
.wh-table :deep(.wh-note) { font-size: 12px; line-height: 1.45; color: rgba(255, 255, 255, .85); margin: var(--s-2) 2px; }
</style>
