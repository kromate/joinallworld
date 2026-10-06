<script setup lang="ts">
// The person card ('person', opened from a card): an NPC's quote and timed interactions, or a
// player's Chat, Add friend, interactions, Ask to be my Bae, Send money, Block and Report.
// Every disabled control says why. All names and text are rendered as text.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import NpcCard from './NpcCard.vue'
import PlayerCard from './PlayerCard.vue'
import { personTarget } from './personModel.ts'

const props = defineProps<{ params?: unknown }>()
const { game } = useApp()
const asked = computed(() => (props.params ?? {}) as { npc?: unknown; player?: unknown; gift?: unknown })
// A reference to an NPC never reaches the player card, however it was asked for: Block and Report are for real players only.
const target = computed(() => personTarget(asked.value, [...game.view.value.social.here.map((npc) => npc.id), ...game.view.value.social.relationships.filter((rel) => rel.npc).map((rel) => rel.id)]))
const npc = computed(() => (target.value?.kind === 'npc' ? target.value.id : null))
const player = computed(() => (target.value?.kind === 'player' ? target.value.id : null))
</script>

<template>
  <NpcCard v-if="npc" :id="npc" />
  <PlayerCard v-else-if="player" :id="player" :form="asked.gift === true ? 'money' : undefined" />
  <p v-else class="ui-error">Nobody selected.</p>
</template>
