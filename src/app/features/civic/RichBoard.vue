<script setup lang="ts">
// One ranked board with room for player names and aligned amounts at phone width.
import { computed, defineAsyncComponent } from 'vue'
import type { RichRow } from '../../../types/civic.ts'
import { money } from '../../ui/format.ts'
import EmptyState from '../../ui/EmptyState.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import CivicAvatar from './CivicAvatar.vue'

const props = defineProps<{ title: string; rows: readonly RichRow[]; none: string; /** The board's name and the city, when the list goes on below the rows given (the server's page size is the length of `rows`). */ more?: { path: string; size: number } }>()
const MoreRows = defineAsyncComponent(() => import('./MoreRows.vue'))
const last = computed(() => props.rows.at(-1))
</script>

<template>
  <SectionTitle>{{ title }}</SectionTitle>
  <EmptyState v-if="!rows.length" compact icon="richlist" title="Nobody yet" :text="none" />
  <template v-else>
    <ol class="ranking" :aria-label="title">
      <li v-for="row in rows" :key="row.id" class="ranking-row" :class="{ 'is-you': row.you, 'is-first': row.rank === 1 }">
        <span class="ranking-rank" :aria-label="`Rank ${row.rank}`">{{ row.rank }}</span>
        <CivicAvatar :name="row.name" :seed="row.name" />
        <span class="ranking-person"><strong>{{ row.name }}</strong><small v-if="row.you">You</small></span>
        <b class="ranking-amount">{{ money(row.amount) }}</b>
      </li>
    </ol>
    <MoreRows v-if="more && rows.length >= more.size && last" :path="more.path" kind="rich" :shown="rows.map((row) => row.id)" :start="`${last.amount}:${last.id}`" label="Show more" />
  </template>
</template>

<style scoped>
.ranking { list-style: none; margin: 0 0 16px; padding: 0; background: #fff; border-radius: 8px; }
.ranking-row { display: grid; grid-template-columns: 24px 36px minmax(0, 1fr) auto; gap: 10px; align-items: center; min-height: 72px; padding: 12px; border-bottom: 1px solid var(--c-line); }
.ranking-row:last-child { border-bottom: 0; }
.ranking-row.is-you { background: #e8f5ee; }
.ranking-rank { color: var(--c-muted); font-size: 14px; font-weight: 650; font-variant-numeric: tabular-nums; text-align: center; }
.ranking-row.is-first .ranking-rank { background: #ffedba; color: #754900; border-radius: 6px; padding: 5px 0; }
.ranking-person { min-width: 0; }
.ranking-person strong { display: block; font-size: 14px; overflow-wrap: anywhere; }
.ranking-person small { display: block; font-size: 12px; color: var(--c-green-dark); margin-top: 3px; }
.ranking-amount { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; text-align: right; }
.ranking-row :deep(.ui-avatar) { width: 36px; height: 36px; font-size: 14px; }
</style>
