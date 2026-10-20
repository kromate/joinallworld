<script setup lang="ts">
// Phone → Watch (docs/ALLWORLD-HOUSE.md): shared watching. Match nights with predictions (bragging rights and badges, never money),
// Allworld House (AI housemates, adults vote, Sunday eviction on a stage) and artist premieres. Each part loads when its tab opens.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import { ref } from 'vue'
import { lazyComponent } from '../../state/lazy.ts'

const props = defineProps<{ params?: { tab?: string } | null }>()
const MatchNights = lazyComponent(() => import('./MatchNights.vue'))
const HouseShow = lazyComponent(() => import('./HouseShow.vue'))
const Premieres = lazyComponent(() => import('./Premieres.vue'))
type Tab = 'matches' | 'house' | 'premieres'
const TABS: readonly { id: Tab; label: string }[] = [{ id: 'matches', label: 'Match nights' }, { id: 'house', label: 'Allworld House' }, { id: 'premieres', label: 'Premieres' }]
const tab = ref<Tab>(TABS.find((item) => item.id === props.params?.tab)?.id ?? 'matches')
</script>

<template>
  <section class="watch-app" data-watch="app" aria-label="Watch together">
    <div class="watch-tabs" role="tablist" aria-label="What to watch">
      <button v-for="item in TABS" :key="item.id" type="button" role="tab" class="social-btn" :class="{ 'is-on': tab === item.id }" :aria-selected="tab === item.id" :data-watch-tab="item.id" @click="tab = item.id">{{ item.label }}</button>
    </div>
    <MatchNights v-if="tab === 'matches'" />
    <HouseShow v-else-if="tab === 'house'" />
    <Premieres v-else />
  </section>
</template>

<style scoped>
.watch-app { display: grid; gap: 10px; padding: 4px; overflow-wrap: anywhere; }
.watch-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.watch-tabs .social-btn { padding: 6px 4px; font-size: 13px; line-height: 1.2; text-align: center; overflow-wrap: normal; }
.watch-tabs .is-on { background: var(--c-ink, #222); color: var(--c-bg, #fff); }
</style>
