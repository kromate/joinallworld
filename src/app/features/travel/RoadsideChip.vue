<script setup lang="ts">
// The HUD alert of the road: the chip shown while a roadside choice is pending (view.travel.event); tapping it opens the
// 'roadside' modal. It never opens by itself: nothing covers a place the player has just arrived
// at. It draws the eye once when the event is new (a one-shot CSS pulse, off under reduced motion)
// and then waits to be tapped. Beside it, in the same slot, the "What you can do now" card (src/app/features/relief) for a moment
// a player could be stuck in: it shows nothing otherwise.
import '../../../ui/panels/map.css'
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { chipKey, markShown } from './roadsideChipModel.ts'

const ReliefCard = defineAsyncComponent(() => import('../relief/ReliefCard.vue'))
const { game, shell } = useApp()
const event = computed(() => game.view.value.travel?.event ?? null)
const fresh = ref(false)
watch(() => (event.value ? chipKey(event.value) : ''), (key) => { fresh.value = markShown(key) }, { immediate: true })
</script>

<template>
  <ReliefCard />
  <button v-if="event" type="button" class="map-event-chip" :class="{ 'is-new': fresh }" @click="shell.open('roadside')">
    <span aria-hidden="true"><GameIcon inline kind="event" :id="event.id" :emoji="event.icon" /></span>
    <span><b>{{ event.title }}</b><small>Tap to answer</small></span>
  </button>
</template>
