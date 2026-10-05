<script setup lang="ts">
// Step 5, "Ready": the whole character on one card, each line with a way back to change it. The
// buttons that start the life are the creator's footer.
import { computed } from 'vue'
import { DREAMS, TRAITS } from '../../../game/content/traits.ts'
import { dreamFor } from '../../../game/cities/characterContent.ts'
import { cachedCityContent } from '../../../game/cities/registry.ts'
import type { DreamId, Look, TraitId } from '../../../types/life.ts'
import { lookSummary } from './lookModel.ts'
import type { StepId } from './creatorModel.ts'

const props = defineProps<{ city?: string; name: string; look: Look; traits: readonly TraitId[]; dream: DreamId | null; area: string }>()
const emit = defineEmits<{ edit: [step: StepId] }>()
const rows = computed<{ step: StepId; label: string; value: string }[]>(() => [
  { step: 'look', label: 'Look', value: lookSummary(props.look) },
  { step: 'spirit', label: 'Traits', value: props.traits.map((id) => TRAITS[id]?.label ?? id).join(' and ') || 'None yet' },
  { step: 'spirit', label: 'Dream', value: props.dream ? (props.city && cachedCityContent(props.city) ? dreamFor(props.city, props.dream).label : DREAMS[props.dream]?.label) ?? props.dream : 'None yet' },
  { step: 'home', label: 'Home', value: props.area ? `Starter house in ${props.area}` : 'Not chosen yet' },
])
</script>

<template>
  <div class="cr-ready" data-cr-summary>
    <h3 class="cr-ready-name" data-cr-name>{{ name }}</h3>
    <dl class="cr-sum">
      <div v-for="(row, index) in rows" :key="index">
        <dt>{{ row.label }}</dt><dd>{{ row.value }}</dd>
        <button type="button" class="cr-link" :data-key="`edit:${row.label}`" :aria-label="`Change ${row.label.toLowerCase()}`" @click="emit('edit', row.step)">Change</button>
      </div>
    </dl>
    <p class="cr-note">Your birth lottery is rolled when you start. It decides your start cash. You keep going from there: jobs, friends, a house to make your own.</p>
    <p class="cr-note" data-cr-world>Allworld is the real world, one city at a time: travel between cities to see what life is like in each. Call and chat with the people you meet, earn, invest and advertise as you go, and open a business of your own.</p>
  </div>
</template>
