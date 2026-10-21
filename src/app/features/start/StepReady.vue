<script setup lang="ts">
// Step 5, "Ready": the whole character on one card, each line with a way back to change it. The
// buttons that start the life are the creator's footer. What comes right after is one social action, not a tour (features/firstminute).
import { computed, defineAsyncComponent, ref } from 'vue'
import { DREAMS, TRAITS } from '../../../game/content/traits.ts'
import { dreamFor } from '../../../game/cities/characterContent.ts'
import { cachedCityContent } from '../../../game/cities/registry.ts'
import type { DreamId, Look, TraitId } from '../../../types/life.ts'
import { lookSummary } from './lookModel.ts'
import type { StepId } from './creatorModel.ts'
import GameIcon from '../../ui/GameIcon.vue'

// The share card is drawn from the stage and fetched only when asked for, so the first download does not grow. `canCard`: the stage is on screen to draw from.
const CharacterCard = defineAsyncComponent(() => import('./CharacterCard.vue'))
const showCard = ref(false)
const props = defineProps<{ city?: string; name: string; look: Look; traits: readonly TraitId[]; dream: DreamId | null; area: string; canCard?: boolean }>()
const emit = defineEmits<{ edit: [step: StepId] }>()
/** The two traits as pills with their icons; the other rows are one line of words. */
const traitPills = computed(() => props.traits.map((id) => ({ id, label: TRAITS[id]?.label ?? id, icon: TRAITS[id]?.icon })))
const rows = computed<{ step: StepId; label: string; value: string }[]>(() => [
  { step: 'look', label: 'Look', value: lookSummary(props.look) },
  { step: 'spirit', label: 'Traits', value: props.traits.map((id) => TRAITS[id]?.label ?? id).join(' and ') || 'None yet' },
  { step: 'spirit', label: 'Dream', value: props.dream ? (props.city && cachedCityContent(props.city) ? dreamFor(props.city, props.dream).label : DREAMS[props.dream]?.label) ?? props.dream : 'None yet' },
  { step: 'home', label: 'Home', value: props.area ? `Starter house in ${props.area}` : 'Not chosen yet' },
])
</script>

<template>
  <div class="cr-ready" data-cr-summary>
    <div class="cr-ready-top">
      <div><p class="cr-eyebrow">Here's you</p><h3 class="cr-ready-name" data-cr-name>{{ name }}</h3></div>
    </div>
    <dl class="cr-sum">
      <div v-for="(row, index) in rows" :key="index">
        <dt>{{ row.label }}</dt>
        <dd v-if="row.label === 'Traits' && traitPills.length" class="cr-pills"><span v-for="pill in traitPills" :key="pill.id" class="cr-pill"><GameIcon kind="trait" :id="pill.id" :emoji="pill.icon" inline /> {{ pill.label }}</span></dd>
        <dd v-else>{{ row.value }}</dd>
        <button type="button" class="cr-link" :data-key="`edit:${row.label}`" :aria-label="`Change ${row.label.toLowerCase()}`" @click="emit('edit', row.step)">Change</button>
      </div>
    </dl>
    <div v-if="canCard" class="cr-share-card" data-cr-share-card>
      <button v-if="!showCard" type="button" class="cr-btn is-small" data-key="share-card" @click="showCard = true"><GameIcon name="share" inline /> Share my character</button>
      <CharacterCard v-else :name="name" @close="showCard = false" />
    </div>
    <p class="cr-note" data-cr-first>When you start, the first screen shows what is happening near you and who is here, with one thing to do: say hello, join your area's community or walk to the Square.</p>
    <p class="cr-note">Your birth lottery is rolled when you start. It decides your start cash. You keep going from there: jobs, friends, a house to make your own.</p>
    <p class="cr-note" data-cr-start-card>Once you start, "What did you get?" makes a card of your start (job, home, money and a title) to post on your Status.</p>
    <p class="cr-note" data-cr-world>Allworld is the real world, one city at a time: travel between cities to see what life is like in each. Call and chat with the people you meet, earn, invest and advertise as you go, and open a business of your own.</p>
  </div>
</template>
