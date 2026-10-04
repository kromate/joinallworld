<script setup lang="ts">
// The State House sheet: who governs, their announcements, civic updates. Opened with
// open('state-house'), e.g. from the State House on the map. Read-only; its button opens the
// Governor app.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import type { GovResponse, PulseResponse } from '../../../types/civic.ts'
import BaseButton from '../../ui/BaseButton.vue'
import CivicStale from './CivicStale.vue'
import CivicStatus from './CivicStatus.vue'
import GovernorNews from './GovernorNews.vue'
import GovernorSeat from './GovernorSeat.vue'
import { NEXT, PHASES, govKey, govPath, houseButton, pulseKey, pulsePath, until } from './civicModel.ts'
import { useLoaded } from './useCivic.ts'

defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
const view = game.view
const cityId = computed(() => view.value.cityId)
const { item, reload } = useLoaded<GovResponse>({ key: () => govKey(cityId.value), path: () => govPath(cityId.value), maxAge: 20000 })
const pulse = useLoaded<PulseResponse>({ key: () => pulseKey(cityId.value), path: () => pulsePath(cityId.value), maxAge: 60000 })
const notices = computed(() => pulse.item.value.data?.notices ?? [])
const data = computed(() => item.value.data)
</script>

<template>
  <div class="state-house">
    <CivicStatus :item="item" @retry="reload" />
    <template v-if="data">
      <GovernorSeat :data="data" />
      <CivicStale :item="item" />
      <GovernorNews :data="data" :notices="notices" />
      <p class="civic-note">{{ PHASES[data.phase] }}: {{ NEXT[data.phase] }} in {{ until(data.phaseEndsAt, view.now) }}.</p>
      <BaseButton variant="primary" block @click="shell.open('governor')">{{ houseButton(data.phase) }}</BaseButton>
    </template>
  </div>
</template>

<style scoped>
.civic-note { font-size: 12px !important; line-height: 1.45 !important; color: var(--c-muted); margin: var(--s-2) 2px !important; }
</style>
