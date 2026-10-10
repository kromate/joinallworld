<script setup lang="ts">
// Places ranked against each other: cities, states and countries, by what their players did this Lagos week. Aggregates only
// (GET /api/civic/boards): no player is named, and a place with too few players is left off. Opened from the Rich List.
import { computed, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import type { BoardMeasure, BoardRow, BoardScope, BoardsResponse } from '../../../types/civic.ts'
import BaseButton from '../../ui/BaseButton.vue'
import EmptyState from '../../ui/EmptyState.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import { BOARD_MEASURES, BOARD_SEGMENTS, boardAmount, boardsKey, boardsPath, count, explain, lastWeekLine, placeShareLine, standingLine } from './civicModel.ts'
import CivicStale from './CivicStale.vue'
import CivicStatus from './CivicStatus.vue'
import { useLoaded } from './useCivic.ts'

const { game } = useApp()
const scope = ref<BoardScope>('city')
const by = ref<BoardMeasure>('pride')
const { item, reload } = useLoaded<BoardsResponse>({ key: () => boardsKey(scope.value, by.value), path: () => boardsPath(scope.value, by.value), maxAge: 30000, live: true })
const data = computed(() => item.value.data)
const noun = computed(() => BOARD_SEGMENTS.find((segment) => segment.id === scope.value)?.noun ?? 'place')
const standing = computed(() => (data.value ? standingLine(data.value.you, by.value, data.value.min) : ''))
const last = computed(() => (data.value ? lastWeekLine(data.value.lastWeek) : null))
const share = computed(() => (data.value ? placeShareLine(data.value.you, scope.value) : null))
const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

// Further pages are read on request and shown after the first; a change of board or of week starts again.
const more = ref<BoardRow[]>([])
const next = ref<string | null>(null)
const loadingMore = ref(false)
watch([() => data.value?.next, scope, by], () => { more.value = []; next.value = data.value?.next ?? null })
const rows = computed(() => [...(data.value?.rows ?? []), ...more.value])
async function showMore(): Promise<void> {
  if (!next.value || loadingMore.value) return
  loadingMore.value = true
  try {
    const page = await game.fetchJson<BoardsResponse>(`${boardsPath(scope.value, by.value)}&after=${encodeURIComponent(next.value)}`)
    more.value = [...more.value, ...page.rows]; next.value = page.next
  } catch (error) { game.toast(explain(error), 'error') } finally { loadingMore.value = false }
}
async function send(): Promise<void> {
  if (!share.value) return
  if (canShare) { try { await navigator.share({ text: share.value }) } catch { /* the sheet was closed */ } return }
  try { await navigator.clipboard.writeText(share.value); game.toast('Copied. Paste it anywhere.', 'good') } catch { game.toast('Could not copy. Press and hold the line to copy it.', 'error') }
}
const measureLabel = computed(() => BOARD_MEASURES.find((measure) => measure.id === by.value)?.label ?? '')
/** The figures of a row that the main column does not show. */
const others = (row: BoardRow): string => `${count(row.residents)} players · ${count(row.active)} active · ${boardAmount('earned', row.earned)} earned`
</script>

<template>
  <div class="places">
    <section class="ui-hero places-hero">
      <small>Allworld this week</small>
      <strong>{{ last ?? 'Who will lead?' }}</strong>
      <p>Cities, states and countries are ranked on what their players do. Rep yours.</p>
    </section>
    <div class="places-segments" role="group" aria-label="What to rank">
      <button v-for="segment in BOARD_SEGMENTS" :key="segment.id" type="button" :class="{ 'is-on': scope === segment.id }" :aria-pressed="scope === segment.id" @click="scope = segment.id">{{ segment.label }}</button>
    </div>
    <label class="places-by"><span>Rank by</span>
      <select v-model="by"><option v-for="measure in BOARD_MEASURES" :key="measure.id" :value="measure.id">{{ measure.label }}</option></select>
    </label>
    <CivicStatus :item="item" @retry="reload" />
    <template v-if="data">
      <p v-if="data.you" class="places-you" role="status" data-places="standing">{{ standing }}</p>
      <CivicStale :item="item" />
      <EmptyState v-if="!rows.length" compact icon="richlist" title="Nobody ranked yet" :text="`No ${noun} has ${data.min} players who opened the game this week. Be one of them.`" />
      <table v-else class="places-table">
        <caption class="places-caption">{{ BOARD_SEGMENTS.find((segment) => segment.id === scope)?.label }} this week, by {{ measureLabel.toLowerCase() }}</caption>
        <thead><tr><th scope="col" class="places-rank">Rank</th><th scope="col">Place</th><th scope="col" class="places-figure">{{ measureLabel }}</th></tr></thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id" :class="{ 'is-you': row.you, 'is-first': row.rank === 1 }" :aria-current="row.you ? 'true' : undefined">
            <td class="places-rank">{{ row.rank }}</td>
            <th scope="row" class="places-place"><strong>{{ row.name }}</strong><small v-if="row.you" class="places-mine">Your {{ noun }}</small><small v-if="row.within">{{ row.within }}</small><small>{{ others(row) }}</small></th>
            <td class="places-figure">{{ boardAmount(by, row[by]) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="data.unranked" class="places-held">{{ data.unranked === 1 ? 'One place is' : `${count(data.unranked)} places are` }} not shown yet: a place needs {{ data.min }} players, {{ data.min }} of them active this week.</p>
      <div class="places-actions">
        <BaseButton v-if="next" :disabled="loadingMore" @click="showMore">{{ loadingMore ? 'Loading…' : 'Show more places' }}</BaseButton>
        <BaseButton v-if="share" @click="send">{{ canShare ? 'Share where you stand' : 'Copy a line to share' }}</BaseButton>
        <BaseButton :disabled="item.loading" @click="reload">Refresh</BaseButton>
      </div>
      <p v-if="share" class="places-share" data-places="share">{{ share }}</p>
      <HowItWorks id="places-rules" page label="How places are ranked" :rules="['Only totals are used. No player is named or counted on their own, and players hidden from the Rich List are still part of their place’s totals.', 'Pride is the naira received this week per player of the place, so a small place that plays hard can beat a big one.', 'The week runs from Monday, Nigerian time. Last week’s winner stays on show for the week after.', 'A place appears once it has at least five players and five of them opened the game this week. States and countries add up their cities. This is a beta feature.']" />
    </template>
  </div>
</template>

<style scoped>
.places-hero { --hero: var(--app-tint, #b7791f); }
.places-segments { display: flex; gap: 4px; margin: 0 0 var(--s-2); padding: 4px; border-radius: var(--r-md); background: var(--c-fill); }
.places-segments button { flex: 1 1 0; min-width: 0; padding: 0 8px; min-height: var(--tap); border: 0; border-radius: var(--r-sm); background: transparent; font: 600 13px var(--font); color: var(--c-ink-2); cursor: pointer; }
.places-segments button.is-on { background: #fff; color: var(--c-ink); }
.places-by { display: grid; gap: 4px; margin: 0 0 var(--s-3); font-size: 12px; font-weight: 600; color: var(--c-ink-2); }
.places-by select { min-height: var(--tap); padding: 0 10px; border: 1px solid var(--c-line); border-radius: var(--r-sm); background: #fff; font: 14px var(--font); color: var(--c-ink); }
.places-you { margin: 0 0 var(--s-3); padding: 10px 12px; border-radius: var(--r-sm); background: #e8f5ee; font-size: 14px; font-weight: 650; line-height: 1.4; }
.places-table { width: 100%; border-collapse: collapse; margin: 0 0 var(--s-3); background: #fff; border-radius: 8px; }
.places-caption { padding: 0 0 var(--s-2); text-align: left; font-size: 12px; color: var(--c-muted); }
.places-table thead th { padding: 6px 10px; text-align: left; font-size: 11px; font-weight: 600; color: var(--c-muted); border-bottom: 1px solid var(--c-line); }
.places-table tbody tr { border-bottom: 1px solid var(--c-line); }
.places-table tbody tr:last-child { border-bottom: 0; }
.places-table tr.is-you { background: #e8f5ee; }
.places-table td, .places-table tbody th { padding: 10px; vertical-align: top; text-align: left; }
.places-rank { width: 40px; text-align: center !important; font-variant-numeric: tabular-nums; color: var(--c-muted); font-weight: 650; }
tr.is-first .places-rank { color: #754900; }
.places-place { min-width: 0; font-weight: 400; }
.places-place strong { display: block; font-size: 14px; overflow-wrap: anywhere; }
.places-place small { display: block; margin-top: 2px; font-size: 12px; color: var(--c-muted); overflow-wrap: anywhere; }
.places-place small.places-mine { color: var(--c-green-dark); }
.places-figure { text-align: right !important; font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
thead .places-figure { white-space: normal; max-width: 7em; }
.places-held, .places-share { margin: 0 0 var(--s-3); font-size: 12px; line-height: 1.4; color: var(--c-ink-2); }
.places-actions { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: 0 0 var(--s-3); }
</style>
