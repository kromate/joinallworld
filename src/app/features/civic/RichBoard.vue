<script setup lang="ts">
// One board of the Rich List: the top three on a podium (second, first, third), then everyone
// else as a ranked list.
import { computed } from 'vue'
import type { RichRow } from '../../../types/civic.ts'
import { money } from '../../ui/format.ts'
import EmptyState from '../../ui/EmptyState.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import CivicAvatar from './CivicAvatar.vue'
import { podium } from './civicModel.ts'

const props = defineProps<{ title: string; rows: readonly RichRow[]; none: string }>()
const shape = computed(() => podium(props.rows))
const PLACES = [2, 1, 3] as const
</script>

<template>
  <SectionTitle>{{ title }}</SectionTitle>
  <EmptyState v-if="!rows.length" compact icon="richlist" title="Nobody yet" :text="none" />
  <template v-else>
    <ol class="richlist-podium">
      <template v-for="(row, index) in shape.steps" :key="PLACES[index]">
        <li v-if="row" :class="[`is-${PLACES[index]}`, { 'is-you': row.you }]">
          <CivicAvatar :name="row.name" :seed="row.name" /><strong>{{ row.name }}{{ row.you ? ' (you)' : '' }}</strong><b>{{ money(row.amount) }}</b><i :aria-label="`Rank ${row.rank}`">{{ row.rank }}</i>
        </li>
        <li v-else :class="[`is-${PLACES[index]}`, 'is-empty']" aria-hidden="true"><i>{{ PLACES[index] }}</i></li>
      </template>
    </ol>
    <ol v-if="shape.rest.length" class="ui-rows" start="4">
      <li v-for="row in shape.rest" :key="row.id" class="ui-row" :class="{ 'is-you': row.you }">
        <span class="richlist-rank">{{ row.rank }}</span><CivicAvatar :name="row.name" :seed="row.name" />
        <span class="ui-row-body"><b>{{ row.name }}{{ row.you ? ' (you)' : '' }}</b></span><span class="ui-row-end">{{ money(row.amount) }}</span>
      </li>
    </ol>
  </template>
</template>

<style scoped>
.richlist-podium { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: end; gap: 6px; list-style: none; margin: 0 0 var(--s-2); padding: 14px 10px 0; border-radius: var(--r-lg); background: #fff; box-shadow: var(--e-1), var(--ring); overflow: hidden; }
.richlist-podium li { display: grid; justify-items: center; gap: 2px; min-width: 0; text-align: center; }
.richlist-podium strong { max-width: 100%; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.richlist-podium b { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--c-green-dark); }
.richlist-podium i { display: grid; place-items: start center; width: 100%; margin-top: 6px; padding-top: 6px; border-radius: 10px 10px 0 0; font-style: normal; font-size: 18px; font-weight: 800; color: #fff; }
.richlist-podium .is-1 i { height: 74px; background: linear-gradient(180deg, #f0b93a, #c28a12); }
.richlist-podium .is-2 i { height: 54px; background: linear-gradient(180deg, #b8c0cc, #8b95a5); }
.richlist-podium .is-3 i { height: 40px; background: linear-gradient(180deg, #d59a6a, #a86a3a); }
.richlist-podium .is-1 .ui-avatar { width: 50px; height: 50px; font-size: 20px; box-shadow: 0 0 0 3px #f0b93a; }
.richlist-podium .is-empty i { opacity: .35; }
.richlist-podium .is-you strong { color: var(--app-tint, var(--c-green-dark)); }
.richlist-rank { flex: none; width: 20px; text-align: center; font-size: 13px; font-weight: 700; color: var(--c-muted); }
.ui-row.is-you { background: color-mix(in srgb, var(--app-tint, var(--c-green)) 8%, #fff); }
.ui-row.is-you b { font-weight: 800; }
.ui-row .ui-avatar { width: 36px; height: 36px; font-size: 14px; }
</style>
