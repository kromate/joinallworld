<script setup lang="ts">
// The 'roadside' modal ("On the road"): the pending roadside choice (view.travel.event). Answering
// sends 'world.roadside' { choice } and closes the sheet; not answering is fine, the event passes
// when you travel again or lapses by itself. A choice you cannot afford, or any choice while the
// game is not connected, is off and says why.
import '../../../ui/panels/map.css'
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { useAct } from '../kit/act.ts'
import { choiceHint, choiceTitle, expiryText } from './travelModel.ts'
import { linkWords } from './travelBoundary.ts'

defineProps<{ params?: unknown }>()
const { game, command, shell } = useApp()
const { act, pending } = useAct()
const view = game.view
const event = computed(() => view.value.travel?.event ?? null)
const answer = (choice: string): Promise<boolean> => act(`choice:${choice}`, () => command('world.roadside', { choice }), { close: true })
</script>

<template>
  <template v-if="!event">
    <p>Nothing is waiting for you by the roadside right now.</p>
    <p>{{ game.state.value.message || '' }}</p>
    <button type="button" class="ui-button is-primary" @click="shell.close()">Carry on</button>
  </template>
  <div v-else class="map-event">
    <p class="map-event-icon" aria-hidden="true"><GameIcon inline kind="event" :id="event.id" :emoji="event.icon" /></p>
    <h3>{{ event.title }}</h3>
    <p>{{ event.text }}</p>
    <div class="map-event-choices">
      <button v-for="choice in event.choices" :key="choice.id" type="button" class="ui-button" :disabled="Boolean(choice.blocked) || !view.connected || pending !== null" @click="answer(choice.id)">
        <b>{{ choiceTitle(choice) }}</b><small>{{ choiceHint(choice) }}</small>
        <small v-if="choice.blocked" class="map-event-why">{{ choice.blocked.reason }}</small>
        <small v-else-if="!view.connected" class="map-event-why">{{ linkWords(view)?.short }} — you cannot answer right now.</small>
      </button>
    </div>
    <p class="preview-note">Not answering is fine: this passes when you travel again{{ expiryText(event.expiresIn) }}.</p>
  </div>
</template>
