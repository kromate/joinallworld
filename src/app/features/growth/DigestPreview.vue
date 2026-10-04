<script setup lang="ts">
// The weekly message exactly as it would be sent (src/game/digest.js composeDigest), shown as text.
import type { Digest } from '../../../types/growth.ts'

defineProps<{ digest: Digest }>()
</script>

<template>
  <div class="gr-preview">
    <b>{{ digest.subject }}</b>{{ digest.greeting }}
    <ul><li v-for="(line, index) in digest.lines" :key="index">{{ line }}</li></ul>
    <small v-if="digest.more">and {{ digest.more }} more</small>
    <b>This week you could</b>
    <ul><li v-for="(task, index) in digest.tasks" :key="index">{{ task.text }}</li></ul>
    <small>{{ digest.footer }}</small>
  </div>
</template>

<style scoped>
.gr-preview { border: 1px dashed var(--c-line); border-radius: 14px; padding: 12px; background: var(--c-fill); font-size: 13px; line-height: 1.5; }
.gr-preview b { display: block; margin-bottom: 4px; }
.gr-preview ul { margin: 6px 0; padding-left: 18px; }
.gr-preview small { display: block; }
</style>
