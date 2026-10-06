<script setup lang="ts">
// The new-player funnel as horizontal bars, with what each step counts and whether the number is exact or not measured at all.
import { computed } from 'vue'

export interface FunnelRow { id: string; label: string; count: number | null; exact: boolean; note: string }
const props = defineProps<{ title: string; rows: readonly FunnelRow[] }>()
const top = computed(() => Math.max(1, ...props.rows.map((row) => row.count ?? 0)))
const first = computed(() => props.rows.find((row) => row.count !== null)?.count ?? 0)
const text = (row: FunnelRow): string => (row.count === null ? 'not measured' : `${row.count.toLocaleString('en-GB')}${first.value > 0 && row.count !== first.value ? ` · ${Math.round((row.count / first.value) * 100)}%` : ''}`)
</script>

<template>
  <div class="adm-funnel" role="group" :aria-label="title">
    <p v-for="row in rows" :key="row.id" class="adm-funnel-row" :title="row.note">
      <span class="adm-funnel-name">{{ row.label }}</span>
      <span class="adm-funnel-bar" aria-hidden="true"><i :style="{ width: row.count === null ? '0%' : `${Math.max(2, Math.round((row.count / top) * 100))}%` }" /></span>
      <span class="adm-funnel-n" :class="{ off: row.count === null }">{{ text(row) }}</span>
    </p>
  </div>
</template>
