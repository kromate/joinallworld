<script setup lang="ts">
// The small "NPC" badge beside (or before) a game character's name: the one mark the game uses for anyone who is not a
// real player (src/game/npc-mark.ts holds the word). A real player never gets one, so no badge means a real person.
// The word is visible; a screen reader hears "NPC, a game character, not a real player".
import { NPC_MEANING, NPC_SPEECH, NPC_WORD } from '../../game/npc-mark.ts'

/** `lead`: the badge starts a line (the gap goes after it); otherwise it follows a name. */
defineProps<{ lead?: boolean }>()
</script>

<template>
  <span class="npc-badge" :class="{ 'is-lead': lead }" :title="NPC_MEANING" data-npc-badge><span aria-hidden="true">{{ NPC_WORD }}</span><span class="npc-badge-sr">{{ NPC_SPEECH }}</span></span>
</template>

<style scoped>
.npc-badge { display: inline-flex; align-items: center; margin-inline: 6px 0; padding: 1px 7px; border-radius: var(--r-pill, 999px); background: var(--c-fill-2, #e3e7e4); color: var(--c-ink-2, #39404b); font-size: var(--t-micro, 11px); font-weight: 700; letter-spacing: .03em; line-height: 1.5; vertical-align: middle; white-space: nowrap; box-shadow: inset 0 0 0 1px var(--c-line, #e3e6e4); }
.npc-badge.is-lead { margin-inline: 0 6px; }
.npc-badge-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
</style>
