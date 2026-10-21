<script setup lang="ts">
// Seasons (docs/MINI-GAMES.md): NYSC camp (three weeks, ending in a passing-out card) and JAMB season (daily practice, a mock exam and a results-day card).
// Both are for Nigeria only and each has an admin switch, so the app shows only what is open or already joined. Each season loads when its tab is opened.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import { computed, defineAsyncComponent, onMounted, ref, shallowRef } from 'vue'
import { useApp } from '../../state/app.ts'
import type { SeasonsView } from '../../../types/minigames.ts'
import { minigamesApi } from './minigamesApi.ts'
import { tabsFor } from './seasonsModel.ts'
import type { Tab } from './seasonsModel.ts'

const NyscPanel = defineAsyncComponent(() => import('./NyscPanel.vue'))
const JambPanel = defineAsyncComponent(() => import('./JambPanel.vue'))
const { game } = useApp()
const api = minigamesApi(game.fetchJson)
const city = computed(() => game.view.value.cityId)
const seasons = shallowRef<SeasonsView | null>(null)
const error = ref('')
const tab = ref<Tab>('nysc')
const tabs = computed(() => tabsFor(seasons.value))

async function load(): Promise<void> {
  const answer = await api.seasons(city.value)
  if (!answer.ok) { error.value = answer.reason; return }
  error.value = ''; seasons.value = answer.seasons
  if (!tabsFor(answer.seasons).includes(tab.value)) tab.value = tabsFor(answer.seasons)[0] ?? 'nysc'
}
onMounted(() => { void load() })
</script>

<template>
  <section class="se-app" aria-labelledby="se-title" data-seasons="app">
    <header class="se-head">
      <span class="se-badge" aria-hidden="true">🎓</span>
      <div>
        <h2 id="se-title">NYSC and JAMB</h2>
        <p>Two seasons of Nigerian life, played for game naira.</p>
      </div>
    </header>
    <p v-if="error" class="ui-error" role="alert">{{ error }} <button type="button" class="social-btn" @click="load">Try again</button></p>
    <p v-else-if="!seasons" class="ui-note" role="status">Opening the seasons…</p>
    <p v-else-if="!seasons.nigeria" class="ui-note" role="status" data-seasons="elsewhere">NYSC camp and JAMB season are for Nigeria only. They open for a character who lives in a Nigerian city.</p>
    <p v-else-if="!tabs.length" class="ui-note" role="status" data-seasons="none">No season is open right now. Check back soon.</p>
    <template v-else>
      <div v-if="tabs.length > 1" class="se-tabs" role="tablist">
        <button v-for="name in tabs" :key="name" type="button" role="tab" class="social-btn" :class="{ 'is-on': tab === name }" :aria-selected="tab === name" :data-tab="name" @click="tab = name">{{ name === 'nysc' ? 'NYSC camp' : 'JAMB season' }}</button>
      </div>
      <NyscPanel v-if="tab === 'nysc'" :view="seasons.nysc" :city="city" @changed="load" />
      <JambPanel v-else :view="seasons.jamb" :city="city" @changed="load" />
    </template>
  </section>
</template>

<style scoped>
.se-app { display: flex; flex-direction: column; gap: 10px; }
.se-head { display: flex; gap: 12px; align-items: center; }
.se-head h2 { margin: 0; font-size: 20px; }
.se-head p { margin: 2px 0 0; font-size: 13px; opacity: .75; }
.se-badge { font-size: 30px; width: 48px; height: 48px; display: grid; place-items: center; border-radius: 14px; background: #2f9e44; }
.se-tabs { display: flex; gap: 6px; }
.se-tabs .is-on { outline: 2px solid #2f9e44; }
</style>
