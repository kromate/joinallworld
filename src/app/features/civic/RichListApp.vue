<script setup lang="ts">
// Rich List: top balances and top earners of the week, plus the real city counters. Everything
// shown comes from the server (GET /api/civic/richlist); nothing is estimated here.
import { computed, defineAsyncComponent, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import type { RichListResponse } from '../../../types/civic.ts'
import { money } from '../../ui/format.ts'
import HowItWorks from '../../ui/HowItWorks.vue'
import CivicAction from './CivicAction.vue'
import CivicStale from './CivicStale.vue'
import CivicStatus from './CivicStatus.vue'
import RichBoard from './RichBoard.vue'
import { count, richKey, richPath } from './civicModel.ts'
import { useCivic, useLoaded, useOffline } from './useCivic.ts'

const props = defineProps<{ params?: unknown }>()
// The cities, states and countries board is its own lazily loaded part of this screen.
const PlacesBoard = defineAsyncComponent(() => import('./PlacesBoard.vue'))
const tab = ref<'players' | 'places'>(typeof props.params === 'object' && props.params !== null && Reflect.get(props.params, 'tab') === 'places' ? 'places' : 'players')
const { game } = useApp()
const civic = useCivic()
const offline = useOffline()
const view = game.view
const { item, reload } = useLoaded<RichListResponse>({ key: () => richKey(view.value.cityId), path: () => richPath(view.value.cityId), maxAge: 30000, live: true })
const data = computed(() => item.value.data)
const you = computed(() => data.value?.you ?? null)

async function toggle(): Promise<void> {
  const listed = Boolean(you.value?.listed)
  const result = await civic.send('prefs', '/api/civic/prefs', { richList: !listed }, { success: listed ? 'You are now hidden from the Rich List.' : 'You are back on the Rich List.' })
  if (result.ok) reload()
}
</script>

<template>
  <div class="richlist">
    <nav class="richlist-tabs" role="group" aria-label="Rich List">
      <button type="button" :class="{ 'is-on': tab === 'players' }" :aria-pressed="tab === 'players'" @click="tab = 'players'">Players</button>
      <button type="button" :class="{ 'is-on': tab === 'places' }" :aria-pressed="tab === 'places'" @click="tab = 'places'">Places</button>
    </nav>
    <PlacesBoard v-if="tab === 'places'" />
    <template v-else>
    <CivicStatus :item="item" @retry="reload" />
    <template v-if="data">
      <section v-if="you?.listed" class="ui-hero richlist-hero"><small>You{{ you.balanceRank ? ` · rank ${you.balanceRank}` : '' }}</small><strong>{{ money(you.cash) }}</strong><p>Earned {{ money(you.earned) }} this week</p></section>
      <section v-else-if="you" class="ui-hero richlist-hero"><small>You are hidden</small><strong>Not on the list</strong><p>Your balance is not shown to anyone.</p></section>
      <ul class="ui-stats">
        <li><b>{{ count(data.counters.players) }}</b>players in {{ view.city.name }}</li>
        <li><b>{{ count(data.counters.online) }}</b>online now</li>
        <li><b>{{ count(data.counters.visits) }}</b>daily visits</li>
      </ul>
      <CivicStale :item="item" />
      <div class="richlist-boards">
        <div><RichBoard title="Top balances" :rows="data.balances" none="Nobody is listed yet." :more="{ path: `/api/civic/richlist?city=${encodeURIComponent(view.cityId)}&board=balances`, size: data.size }" /></div>
        <div><RichBoard title="Top earners this week" :rows="data.earners" none="Nobody has earned anything this week yet." :more="{ path: `/api/civic/richlist?city=${encodeURIComponent(view.cityId)}&board=earners`, size: data.size }" /></div>
      </div>
      <div class="civic-actions">
        <CivicAction v-if="you" :working="civic.busy('prefs')" :reason="offline('change this') ?? ''" @click="toggle">{{ you.listed ? 'Hide me from the Rich List' : 'Show me on the Rich List' }}</CivicAction>
        <CivicAction :working="item.loading" @click="reload">Refresh</CivicAction>
      </div>
      <HowItWorks id="richlist-rules" page label="How the lists are counted" :rules="['Balances are each player’s in-game naira at their last check-in.', 'Earners count naira received since Monday, Nigerian time.', 'Players are counted once they have opened the game since this feature shipped; “online” means a live connection right now.', 'You can hide yourself from both lists with the button above. This is a beta feature.']" />
    </template>
    </template>
  </div>
</template>

<style scoped>
.richlist-tabs { display: flex; gap: 4px; margin: 0 0 var(--s-3); padding: 4px; border-radius: var(--r-md); background: var(--c-fill); }
.richlist-tabs button { flex: 1 1 0; padding: 0 8px; min-height: var(--tap); border: 0; border-radius: var(--r-sm); background: transparent; font: 600 13px var(--font); color: var(--c-ink-2); cursor: pointer; }
.richlist-tabs button.is-on { background: #fff; color: var(--c-ink); }
.civic-actions { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: var(--s-3) 0 0; }
.civic-actions .civic-action { flex: 1 1 140px; display: grid; margin: 0; }
.richlist-hero { --hero: var(--app-tint, #b7791f); }
.richlist-boards { display: grid; grid-template-columns: minmax(0, 1fr); column-gap: var(--s-3); }
:global(.ph.is-wide) .richlist-boards { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
</style>
