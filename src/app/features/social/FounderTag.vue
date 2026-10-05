<script setup lang="ts">
// The small "Founder" tag beside a player's name. Drawn only where the server marked that player's reference
// (`founder: true`), which it does for the founder's own character and nobody else.
</script>

<template>
  <span class="founder-tag">Founder</span>
</template>

<style scoped>
.founder-tag { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 999px; background: var(--c-green-dark, #0b6b3a); color: #fff; font-size: 10px; font-weight: 700; line-height: 1.5; letter-spacing: .02em; vertical-align: middle; white-space: nowrap; }
</style>
