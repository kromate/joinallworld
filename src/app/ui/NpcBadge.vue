<script setup lang="ts">
// The small "NPC" badge beside (or before) a game character's name: the one mark the game uses for anyone who is not a
// real player (src/ui/npc-mark.ts holds the word). A real player never gets one, so no badge means a real person.
// The word is visible; a screen reader hears "NPC, a game character, not a real player".
// Styled inline, from the theme's own variables: no stylesheet of its own, so the first download lists one file for the badge, not two.
import { NPC_MEANING, NPC_SPEECH, NPC_WORD } from '../../ui/npc-mark.ts'

/** `lead`: the badge starts a line (the gap goes after it); otherwise it follows a name. */
defineProps<{ lead?: boolean }>()
const BADGE = { display: 'inline-flex', alignItems: 'center', marginInline: '6px 0', padding: '1px 7px', borderRadius: 'var(--r-pill, 999px)', background: 'var(--c-fill-2, #e3e7e4)', color: 'var(--c-ink-2, #39404b)', fontSize: 'var(--t-micro, 11px)', fontWeight: '700', letterSpacing: '.03em', lineHeight: '1.5', verticalAlign: 'middle', whiteSpace: 'nowrap', boxShadow: 'inset 0 0 0 1px var(--c-line, #e3e6e4)' }
const LEAD = { marginInline: '0 6px' }
const SR_ONLY = { position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: '0', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: '0' } as const
</script>

<template>
  <span class="npc-badge" :class="{ 'is-lead': lead }" :style="[BADGE, lead ? LEAD : null]" :title="NPC_MEANING" data-npc-badge><span aria-hidden="true">{{ NPC_WORD }}</span><span class="npc-badge-sr" :style="SR_ONLY">{{ NPC_SPEECH }}</span></span>
</template>
