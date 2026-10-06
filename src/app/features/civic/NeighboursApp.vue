<script setup lang="ts">
// Neighbours: the directory of player homes, grouped by district, with truthful presence.
// Counts and the online flag come from the server (GET /api/civic/neighbours). "Say hi" opens that
// player's card (the social 'person' panel): chat, add friend, knock at their house.
import { computed, defineAsyncComponent } from 'vue'
import ResidentBadge from '../locate/ResidentBadge.vue'
import { useConfirmedOnly } from '../locate/confirmedFilter.ts'
import { useApp } from '../../state/app.ts'
import type { NeighboursResponse } from '../../../types/civic.ts'
import HeroCard from '../../ui/HeroCard.vue'
import BaseButton from '../../ui/BaseButton.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import CivicAction from './CivicAction.vue'
import CivicAvatar from './CivicAvatar.vue'
import CivicStale from './CivicStale.vue'
import CivicStatus from './CivicStatus.vue'
import { count, hoodKey, hoodPath } from './civicModel.ts'
// The rest of a district, read a page at a time: its own chunk, fetched when the first district with more homes is drawn.
const MoreRows = defineAsyncComponent(() => import('./MoreRows.vue'))
import { useCivic, useLoaded, useOffline } from './useCivic.ts'

defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
const civic = useCivic()
const offline = useOffline()
const view = game.view
const { item, reload } = useLoaded<NeighboursResponse>({ key: () => hoodKey(view.value.cityId), path: () => hoodPath(view.value.cityId), maxAge: 30000, live: true })
const data = computed(() => item.value.data)
const groups = computed(() => data.value?.districts.filter((group) => group.count > 0) ?? [])
const confirmed = useConfirmedOnly(() => groups.value.flatMap((group) => group.homes.map((home) => home.id)))
const unset = computed(() => data.value?.districts.some((group) => group.id === 'unknown') ?? false)

async function toggle(): Promise<void> {
  const hidden = Boolean(data.value?.hidden)
  const result = await civic.send('prefs', '/api/civic/prefs', { directory: hidden }, { success: hidden ? 'Your home is listed again.' : 'Your home is hidden from the directory.' })
  if (result.ok) reload()
}
function hi(player: { id: string; name: string }): void {
  if (!shell.open('person', { player: player.id, name: player.name })) game.toast('That player’s card could not be opened. Try again from your People tab.', 'error')
}
</script>

<template>
  <div class="neighbours">
    <CivicStatus :item="item" @retry="reload" />
    <template v-if="data">
      <HeroCard :label="`${view.city.name} directory`" :figure="`${count(data.total)} home${data.total === 1 ? '' : 's'}`">{{ count(data.online) }} online now{{ data.hidden ? ' · your home is hidden' : '' }}</HeroCard>
      <CivicStale :item="item" />
      <label v-if="groups.length" class="civic-note"><input v-model="confirmed.on.value" type="checkbox" data-confirmed-filter> Location-confirmed only</label>
      <template v-if="groups.length">
        <template v-for="group in groups" :key="group.id">
          <SectionTitle :note="`${count(group.count)} home${group.count === 1 ? '' : 's'}${group.count ? ` · ${count(group.online)} online` : ''}`">{{ group.label }}</SectionTitle>
          <ul v-if="group.homes.length" class="ui-rows">
            <li v-for="home in group.homes.filter((entry) => confirmed.keep(entry.id))" :key="home.id" class="ui-row" :class="{ 'is-you': home.you }">
              <CivicAvatar :name="home.name" :seed="home.id"><i class="social-dot" :class="{ 'is-on': home.online }" /></CivicAvatar>
              <span class="ui-row-body"><b>{{ home.name }}{{ home.you ? ' (you)' : '' }}</b><ResidentBadge :id="home.id" /><small>{{ home.online ? 'Online now' : 'Not online' }}</small></span>
              <span v-if="!home.you" class="ui-row-end"><BaseButton small :aria-label="`Say hi to ${home.name}`" @click="hi(home)">Say hi</BaseButton></span>
            </li>
          </ul>
          <MoreRows v-if="group.count - group.homes.length > 0" :path="`/api/civic/neighbours?city=${encodeURIComponent(view.cityId)}&district=${encodeURIComponent(group.id)}`" kind="homes" :shown="group.homes.map((home) => home.id)" :label="`Show everyone in ${group.label}`" @hi="hi" />
        </template>
      </template>
      <p v-else class="civic-note">Nobody has checked in yet.</p>
      <div class="civic-actions">
        <CivicAction :working="civic.busy('prefs')" :reason="offline('change this') ?? ''" @click="toggle">{{ data.hidden ? 'List my home in the directory' : 'Hide my home from the directory' }}</CivicAction>
        <CivicAction :working="item.loading" @click="reload">Refresh</CivicAction>
      </div>
      <HowItWorks id="neighbours-rules" page label="How the directory works" :rules="['These are real counts of players who have opened the game since this feature shipped (beta).', '“Online now” means a live connection at the moment this list was loaded.', unset ? 'Districts fill in once players choose a house.' : '', 'Homes are drawn on the city map behind the Neighbours layer.', 'Hiding your home takes you off this list and off that map layer.']" />
    </template>
  </div>
</template>

<style scoped>
.civic-note { font-size: 12px !important; line-height: 1.45 !important; color: var(--c-muted); margin: var(--s-2) 2px !important; }
.civic-actions { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: var(--s-3) 0 0; }
.civic-actions .civic-action { flex: 1 1 140px; display: grid; margin: 0; }
.ui-row.is-you { background: color-mix(in srgb, var(--app-tint, var(--c-green)) 8%, #fff); }
.ui-row.is-you .ui-row-body > b { font-weight: 800; }
.social-dot { position: absolute; right: -1px; bottom: -1px; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff; background: #b9bec4; }
.social-dot.is-on { background: var(--c-green); }
.ui-row .ui-avatar { width: 36px; height: 36px; font-size: 14px; }
</style>
