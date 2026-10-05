<script setup lang="ts">
// The State House block: the sitting Governor, or the empty seat. Shared by the Governor app and
// the State House sheet.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import type { GovResponse } from '../../../types/civic.ts'
import { count, dateTime, until, votes } from './civicModel.ts'
import { cityRules } from '../../../game/cities/registry.ts'
import { STATE_HOUSE_TEXT } from './civicContent.ts'

const props = defineProps<{ data: GovResponse }>()
const { game } = useApp()
const view = game.view
const lagos = computed(() => view.value.cityId === 'lagos')
// A city is not a state: the house is named for the state the city is in ("Oyo State House"), not for the city.
const stateName = computed(() => cityRules(view.value.cityId)?.state.name ?? view.value.city.name)
const title = computed(() => (lagos.value ? STATE_HOUSE_TEXT.title : `${stateName.value} House`))
const empty = computed(() => (lagos.value ? STATE_HOUSE_TEXT.empty : `${stateName.value} has no Governor yet. Sign up to vote, or run for office yourself.`))
</script>

<template>
  <div v-if="!data.governor" class="governor-seat"><small>{{ title }}</small><h3>The seat is empty</h3><p>{{ empty }}</p></div>
  <div v-else class="governor-seat">
    <small>{{ title }}</small>
    <h3>Governor {{ data.governor.name }}{{ data.governor.id === view.session?.id ? ' (you)' : '' }}</h3>
    <p><q>{{ data.governor.slogan }}</q></p>
    <small>Elected with {{ votes(data.governor.votes) }} · term ends {{ dateTime(data.governor.termEndsAt) }} (in {{ until(data.governor.termEndsAt, view.now) }})</small>
  </div>
</template>

<style scoped>
.governor-seat { display: grid; gap: 3px; margin-bottom: var(--s-2); padding: 16px 18px; border-radius: var(--r-lg); background: linear-gradient(150deg, #1f7a45, #0f3d26); color: #fff; box-shadow: var(--e-1); }
.governor-seat h3 { margin: 0 !important; font-size: 20px !important; letter-spacing: -.1px !important; text-transform: none !important; color: #fff !important; }
.governor-seat p { margin: 0 !important; font-size: 13px !important; }
.governor-seat small { font-size: 12px; opacity: .85; }
</style>
