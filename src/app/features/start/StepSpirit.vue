<script setup lang="ts">
// Step 3, "What drives you?": two traits and a dream, as cards. Chosen for the player to begin with,
// so skipping the step still leaves a life that makes sense; "Pick for me" draws another set.
import { DREAMS, TRAITS, TRAITS_REQUIRED } from '../../../game/content/traits.ts'
import { dreamsFor } from '../../../game/cities/characterContent.ts'
import { cachedCityContent } from '../../../game/cities/registry.ts'
import type { DreamId, TraitId } from '../../../types/life.ts'
import GameIcon from '../../ui/GameIcon.vue'

const props = defineProps<{ city?: string; traits: readonly TraitId[]; dream: DreamId | null }>()
const emit = defineEmits<{ trait: [id: TraitId]; dream: [id: DreamId]; random: [] }>()
const traitList = Object.values(TRAITS)
/** The dreams in the words of the city the life will be in (the same ids and rewards everywhere). */
const dreamList = props.city && cachedCityContent(props.city) ? dreamsFor(props.city) : Object.values(DREAMS)
const picked = (): string => `${props.traits.length} of ${TRAITS_REQUIRED} chosen. A third pick swaps out your first.`
</script>

<template>
  <div class="cr-spirit">
    <div class="cr-sub">
      <h3>Two traits</h3>
      <button type="button" class="cr-btn is-small" data-key="spirit-random" @click="emit('random')"><GameIcon name="game" inline /> Pick for me</button>
    </div>
    <p class="cr-note" role="status">{{ picked() }}</p>
    <div class="cr-cards">
      <button v-for="trait in traitList" :key="trait.id" type="button" class="cr-card" :data-trait="trait.id" :data-key="`trait:${trait.id}`" :aria-pressed="traits.includes(trait.id)" @click="emit('trait', trait.id)">
        <span class="cr-card-icon" aria-hidden="true"><GameIcon kind="trait" :id="trait.id" :emoji="trait.icon" inline /></span>
        <strong>{{ trait.label }}</strong><small>{{ trait.blurb }}</small>
        <ul><li v-for="line in trait.effects" :key="line">{{ line }}</li></ul>
      </button>
    </div>
    <div class="cr-sub"><h3>One big dream</h3></div>
    <p class="cr-note">Reaching it pays a reward.</p>
    <div class="cr-cards is-rows">
      <button v-for="item in dreamList" :key="item.id" type="button" class="cr-card is-row" :data-dream="item.id" :data-key="`dream:${item.id}`" :aria-pressed="dream === item.id" @click="emit('dream', item.id)">
        <span class="cr-card-icon" aria-hidden="true"><GameIcon kind="dream" :id="item.id" :emoji="item.icon" inline /></span>
        <span><strong>{{ item.label }}</strong><small>{{ item.goal }}</small></span>
      </button>
    </div>
  </div>
</template>
