<script setup lang="ts">
// The rest of a long civic list, read a page at a time once the reader asks for it (docs/LISTS.md): the homes of one district of the
// directory, or the rich list below its top. The first rows are drawn by the screen itself; this continues them.
import { computed, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import type { NeighbourHome, RichRow } from '../../../types/civic.ts'
import { money } from '../../ui/format.ts'
import BaseButton from '../../ui/BaseButton.vue'
import LazyList from '../../ui/LazyList.vue'
import { createLazyList } from '../../ui/lazyList.ts'
import type { Fetched } from '../../ui/lazyList.ts'
import CivicAvatar from './CivicAvatar.vue'

type Row = (NeighbourHome | RichRow) & { id: string }
const props = defineProps<{
  /** `/api/civic/neighbours?city=…&district=…` or `/api/civic/richlist?city=…&board=…`: the page's address without its cursor. */
  path: string
  kind: 'homes' | 'rich'
  /** Rows the screen already shows: not listed again. */
  shown: readonly string[]
  /** The cursor to start after (rich list: the last row shown). */
  start?: string
  /** What the button says, with how many there are. */
  label: string
}>()
const emit = defineEmits<{ hi: [home: { id: string; name: string }] }>()
const { game } = useApp()
const open = ref(false)
const held = new Set(props.shown)
const list = createLazyList<Row>({
  key: (row) => row.id,
  label: props.kind === 'homes' ? 'homes' : 'players',
  async fetchPage(cursor): Promise<Fetched<Row>> {
    try {
      const after = cursor ?? props.start
      const got = await game.fetchJson<{ homes?: NeighbourHome[]; rows?: RichRow[]; next: string | null }>(`${props.path}&limit=40${after ? `&after=${encodeURIComponent(after)}` : ''}`)
      return { ok: true, items: [...(got.homes ?? []), ...(got.rows ?? [])].filter((row) => !held.has(row.id)), next: got.next }
    } catch { return { ok: false, reason: 'Could not load.' } }
  },
})
const rows = computed(() => list.items.value)
function show(): void { open.value = true; void list.reset() }
</script>

<template>
  <BaseButton v-if="!open" small @click="show">{{ label }}</BaseButton>
  <LazyList v-else :items="rows" :item-key="(row: Row) => row.id" :has-more="list.hasMore.value" :loading="list.loading.value" :error="list.error.value" :announcement="list.announcement.value"
    :row-height="56" :label="kind === 'homes' ? 'homes' : 'players'" class="ui-rows" @more="list.loadMore()" @retry="list.retry()">
    <template #row="{ item }">
      <div class="ui-row more-row" :class="{ 'is-you': item.you }">
        <span v-if="'rank' in item" class="more-rank">{{ item.rank }}</span>
        <CivicAvatar :name="item.name" :seed="item.id" />
        <span class="ui-row-body"><b>{{ item.name }}{{ item.you ? ' (you)' : '' }}</b><small v-if="'online' in item">{{ item.online ? 'Online now' : 'Not online' }}</small></span>
        <span v-if="'amount' in item" class="ui-row-end">{{ money(item.amount) }}</span>
        <span v-else-if="!item.you" class="ui-row-end"><BaseButton small :aria-label="`Say hi to ${item.name}`" @click="emit('hi', item)">Say hi</BaseButton></span>
      </div>
    </template>
  </LazyList>
</template>

<style scoped>
.more-row { height: 56px; box-sizing: border-box; }
.more-rank { flex: none; width: 28px; text-align: center; font-size: 13px; font-weight: 700; color: var(--c-muted); }
.ui-row.is-you { background: color-mix(in srgb, var(--app-tint, var(--c-green)) 8%, #fff); }
</style>
