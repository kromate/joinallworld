<script setup lang="ts">
// A regular of a venue: what they say, how close you are, and the timed interactions you can
// start with them (each takes a few seconds and can be cancelled).
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import { computed, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { NPCS } from '../../../game/content/npcs.ts'
import { venueLabel } from '../../../game/content/venues.ts'
import { linkWords } from '../../../ui/link.ts'
import { money } from '../../ui/format.ts'
import GameIcon from '../../ui/GameIcon.vue'
import ClosenessMeter from './ClosenessMeter.vue'
import PlayerAvatar from './PlayerAvatar.vue'
import { npcActionReason, npcMeterMax, npcReason } from './personModel.ts'
import { closenessText, STRANGER_TEXT, tagLabel } from './socialModel.ts'

const props = defineProps<{ id: string }>()
const { game, shell } = useApp()
const view = game.view
const base = computed(() => NPCS[props.id] ?? null)
const here = computed(() => view.value.social.here.find((npc) => npc.id === props.id) ?? null)
const rel = computed(() => view.value.social.relationships.find((item) => item.id === props.id))
const why = computed(() => (base.value ? npcReason({
  connected: view.value.connected,
  cannot: linkWords(view.value)?.cannot('interact') ?? 'Not connected.',
  here: here.value,
  name: base.value.name,
  venueLabel: venueLabel(base.value.venue, view.value.cityId),
  busy: Boolean(game.state.value.activeAction),
}) : null))
const points = computed(() => rel.value?.points ?? 0)
const max = computed(() => npcMeterMax(rel.value, view.value.social.maxCloseness))
const starting = ref(false)
const reasonFor = (cost: number): string | null => npcActionReason(why.value, cost, game.state.value.cash)

/** Walk to the people spot if the player is not there, then start the activity; close the card when it started. */
async function start(activity: string): Promise<void> {
  if (starting.value) return
  starting.value = true
  try {
    if (game.state.value.spot !== 'people') { const moved = await game.command('spot', { id: 'people' }); if (!moved.ok) return }
    const result = await game.command('activity', { id: activity })
    if (result.ok) shell.close()
  } finally { starting.value = false }
}
</script>

<template>
  <p v-if="!base" class="ui-error">That person is not around.</p>
  <div v-else>
    <div class="social-head people-who"><span class="social-avatar is-big" aria-hidden="true"><PlayerAvatar :name="base.name" :seed="base.id" /></span><h3>{{ base.name }}</h3></div>
    <p>{{ base.role }} · NPC<template v-if="here"> · {{ here.left }} of {{ view.social.dailyInteractions }} interactions left today</template></p>
    <p v-if="here" class="social-quote">“{{ here.quote }}”</p>
    <p>{{ rel ? closenessText(rel, view.social.maxCloseness) : STRANGER_TEXT }}</p>
    <ClosenessMeter :points="points" :max="max" :label="`Closeness with ${base.name}`" />
    <div v-if="here?.actions.length" class="social-grid">
      <button v-for="action in here.actions" :key="action.id" type="button" class="social-act" :disabled="Boolean(reasonFor(action.cost)) || starting" @click="start(action.activity)">
        <strong><GameIcon kind="npc-action" :id="action.id" :emoji="action.icon" inline /> {{ action.label }}</strong>
        <small><GameIcon name="clock" inline /> {{ action.duration }}s · {{ action.cost ? money(action.cost) : 'Free' }} · {{ action.tags.map(tagLabel).join(' ') }}<template v-if="action.chance !== null"> · {{ action.chance }}% chance</template></small>
        <span v-if="reasonFor(action.cost)" class="social-why">{{ reasonFor(action.cost) }}</span>
      </button>
    </div>
    <p v-else-if="why" class="social-why">{{ why }}</p>
    <p class="preview-note">Each interaction takes a few seconds and can be cancelled. Effects other than Say Hello are original beta values.</p>
  </div>
</template>
