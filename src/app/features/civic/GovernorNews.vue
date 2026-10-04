<script setup lang="ts">
// The Governor's announcements and the city's civic updates, as two lists. Shared by the Governor
// app and the State House sheet.
import type { GovResponse, CivicNotice } from '../../../types/civic.ts'
import EmptyState from '../../ui/EmptyState.vue'
import GameIcon from '../../ui/GameIcon.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import { dateTime } from './civicModel.ts'

defineProps<{ data: GovResponse; notices: readonly CivicNotice[] }>()
</script>

<template>
  <SectionTitle>Governor’s announcements</SectionTitle>
  <ul v-if="data.announcements.length" class="ui-rows">
    <li v-for="item in data.announcements" :key="item.id" class="ui-row governor-news">
      <span class="ui-row-icon is-round" aria-hidden="true"><GameIcon inline name="megaphone" /></span>
      <span class="ui-row-body"><b>{{ item.text }}</b><small>Governor {{ item.by.name }} · {{ dateTime(item.at) }}</small></span>
    </li>
  </ul>
  <EmptyState v-else compact icon="megaphone" title="No announcements yet" :text="data.governor ? 'When the Governor posts to the city, it appears here.' : 'There is no Governor to post one. The next election decides who can.'" />
  <SectionTitle>Updates</SectionTitle>
  <ul v-if="notices.length" class="ui-rows">
    <li v-for="item in notices" :key="item.id" class="ui-row governor-news">
      <span class="ui-row-icon is-round" aria-hidden="true"><GameIcon inline name="statement" /></span>
      <span class="ui-row-body"><b>{{ item.title }}</b><small>{{ item.text }} · {{ dateTime(item.at) }}</small></span>
    </li>
  </ul>
  <EmptyState v-else compact icon="statement" title="No civic updates this week" text="Election results and city notices are listed here as they happen." />
</template>

<style scoped>
.governor-news { align-items: flex-start; }
.governor-news .ui-row-body > b { white-space: normal; font-weight: 500; }
</style>
