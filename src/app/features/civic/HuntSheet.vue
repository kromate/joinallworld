<script setup lang="ts">
// Daily gem hunt: the sheet (a Phone app) that the HUD chip opens. How the hunt works is
// original; the chip wording and the prize follow the reference game. The hunt itself is in the
// life (view.civic.hunt); the city counters come from the pulse (GET /api/civic/pulse). Searching
// and claiming are game actions, so the press says "Working…" until the server answers.
import { computed, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { isDeparting } from '../../legacy/engine.ts'
import { linkWords } from '../../legacy/modules.ts'
import type { PulseResponse } from '../../../types/civic.ts'
import { money } from '../../ui/format.ts'
import GameIcon from '../../ui/GameIcon.vue'
import HeroCard from '../../ui/HeroCard.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import CivicAction from './CivicAction.vue'
import CivicStale from './CivicStale.vue'
import { count, huntClaimWhy, huntSearchWhy, pulseKey, pulsePath } from './civicModel.ts'
import { useLinkWhy, useLoaded, useOffline } from './useCivic.ts'

defineProps<{ params?: unknown }>()
const { game, command } = useApp()
const offline = useOffline()
const linkWhy = useLinkWhy()
const view = game.view
const state = game.state
const hunt = computed(() => view.value.civic?.hunt ?? null)
const { item, reload } = useLoaded<PulseResponse>({ key: () => pulseKey(view.value.cityId), path: () => pulsePath(view.value.cityId), maxAge: 60000, live: true })
const pulse = computed(() => item.value.data)
const here = computed(() => view.value.venues.find((venue) => venue.id === state.value.location)?.label ?? 'here')
const searchWhy = computed(() => (hunt.value ? huntSearchWhy(offline('search'), isDeparting(state.value), hunt.value.found, hunt.value.total) : ''))
const claimWhy = computed(() => (hunt.value ? huntClaimWhy(offline('claim'), hunt.value) : ''))
const working = ref<'search' | 'claim' | null>(null)

async function search(): Promise<void> {
  if (working.value) return
  working.value = 'search'
  try {
    const result = await command('civic.hunt-search')
    if (result.ok) game.toast(state.value.message || 'You found a gem.', 'good')
  } finally { working.value = null }
}
async function claim(): Promise<void> {
  if (working.value) return
  working.value = 'claim'
  try {
    const result = await command('civic.hunt-claim')
    if (result.ok) { game.toast(state.value.message || 'Prize claimed.', 'good'); reload() }
  } finally { working.value = null }
}
</script>

<template>
  <p v-if="!hunt">The gem hunt is not available right now.</p>
  <div v-else class="hunt">
    <HeroCard label="Daily gem hunt" :figure="`${hunt.found} of ${hunt.total} found`" class="hunt-hero">
      <div class="hunt-dots" aria-hidden="true"><i v-for="(gem, index) in hunt.gems" :key="index" :class="{ 'is-found': gem.found }" /></div>
      {{ hunt.claimed ? 'Prize claimed. New gems at midnight, Lagos time.' : `Find them all to win ${money(hunt.prize)}.` }}
    </HeroCard>
    <ul v-if="pulse" class="ui-stats">
      <li><b>{{ count(pulse.hunt.found) }}</b>gems found in {{ view.city.name }}</li>
      <li><b>{{ count(pulse.hunt.today) }}</b>counted today</li>
      <li><b>{{ count(pulse.hunt.claims) }}</b>prizes claimed</li>
    </ul>
    <p v-else class="civic-note">{{ view.connected ? 'Loading the city counter…' : `${linkWords(view)?.why ?? ''} The city counter is not available.` }}</p>
    <CivicStale :item="item" />
    <ul class="ui-rows hunt-gems">
      <li v-for="(gem, index) in hunt.gems" :key="index" class="ui-row" :class="{ 'is-found': gem.found }">
        <span class="ui-row-icon" aria-hidden="true"><GameIcon inline :name="gem.found ? 'good' : 'hunt'" /></span>
        <span class="ui-row-body"><b>{{ gem.label }}</b><small>{{ gem.clue }}</small></span>
        <span v-if="gem.found" class="ui-row-end"><span class="ui-chip is-good">Found</span></span>
      </li>
    </ul>
    <div class="civic-actions is-stack">
      <CivicAction primary block :working="working === 'search'" :reason="searchWhy" @click="search">Search {{ here }}</CivicAction>
      <CivicAction block :highlight="hunt.canClaim" :working="working === 'claim'" :reason="claimWhy" @click="claim">Claim {{ money(hunt.prize) }}</CivicAction>
    </div>
    <p class="civic-note">Resets at midnight, Lagos time — an unclaimed prize does not carry over.</p>
    <HowItWorks id="hunt-rules" page label="How the hunt works" :rules="['Travel to a place in the clues, stand at a spot and search.', 'Some gems only come loose when you finish an activity there.', 'Find them all, then claim the prize here. Gems and the prize reset at midnight, Lagos time; an unclaimed prize does not carry over.', `Beta: the chip wording and the ${money(hunt.prize)} prize follow the reference game; how gems are hidden and found is an original beta mechanic. The prize is in-game naira.`]" />
  </div>
</template>

<style scoped>
.civic-note { font-size: 12px !important; line-height: 1.45 !important; color: var(--c-muted); margin: var(--s-2) 2px !important; }
.civic-actions { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: var(--s-3) 0 0; }
.civic-actions.is-stack { display: grid; }
:global(.ph.is-wide) .civic-actions.is-stack { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
.hunt-hero.hero-card { --hero: var(--app-tint, #0aa5c2); }
.hunt-dots { display: flex; gap: 6px; margin: 6px 0 2px; }
.hunt-dots i { width: 22px; height: 22px; transform: rotate(45deg) scale(.7); border-radius: 4px; background: #ffffff40; box-shadow: inset 0 0 0 2px #ffffff80; }
.hunt-dots i.is-found { background: #fff; }
.hunt-gems .is-found .ui-row-body > b { color: var(--c-green-dark); }
</style>
