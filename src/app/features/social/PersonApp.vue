<script setup lang="ts">
// The person card ('person', opened from a card): an NPC's quote and timed interactions, or a
// player's Chat, Add friend, interactions, Ask to be my Bae, Send money, Block and Report.
// Every disabled control says why. All names and text are rendered as text.
import { computed } from 'vue'
import NpcCard from './NpcCard.vue'
import PlayerCard from './PlayerCard.vue'

const props = defineProps<{ params?: unknown }>()
const asked = computed(() => (props.params ?? {}) as { npc?: unknown; player?: unknown })
const npc = computed(() => (typeof asked.value.npc === 'string' ? asked.value.npc : null))
const player = computed(() => (typeof asked.value.player === 'string' ? asked.value.player : null))
</script>

<template>
  <NpcCard v-if="npc" :id="npc" />
  <PlayerCard v-else-if="player" :id="player" />
  <p v-else class="ui-error">Nobody selected.</p>
</template>
