<script setup lang="ts">
// Gist: what is being talked about in the city, as short true lines from the public record of the game (elections, laws, new stalls, arrests,
// festivals, a full Square). Nothing private is in it (docs/GIST.md). Each line has a Share button: the server writes the card's words itself
// from the line's number (src/app/features/growth/shareMoment.ts).
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import { computed, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import EmptyState from '../../ui/EmptyState.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import CivicAction from '../civic/CivicAction.vue'
import { shareGist } from '../growth/shareMoment.ts'
import { gist, loadGist } from './gistStore.ts'
import { agoText } from './gistModel.ts'
import { lazyComponent, lazyQuiet } from '../../state/lazy.ts'

// The works card and the home-city pin are fetched when this app opens, never at first paint.
const EpisodeCard = lazyComponent(() => import('./EpisodeCard.vue'))
// The city front page (docs/SHARE-LOOPS.md): yesterday's newspaper of the city, shareable as a picture.
const FrontPageCard = lazyComponent(() => import('../shareloops/FrontPageCard.vue'))
const CityWorks = lazyComponent(() => import('./CityWorks.vue'))
const HomePin = lazyQuiet(() => import('./HomePin.vue'))
const BirthdayCard = lazyComponent(() => import('./BirthdayCard.vue'))
const { game } = useApp()
const city = computed(() => game.view.value.cityId)
const offline = computed(() => !game.view.value.connected)
const now = ref(Date.now())
const refresh = (force = false): Promise<void> => { now.value = Date.now(); return loadGist((path) => game.fetchJson(path), city.value, now.value, force) }
onMounted(() => { void refresh() })
const shareFailed = (): void => game.toast('That could not be shared. Try again.', 'error')
</script>

<template>
  <section class="gist-app" aria-label="Gist" data-gist="app">
    <SectionTitle>The gist</SectionTitle>
    <p class="social-note">What is happening around the city. Only things everybody can already see.</p>
    <p v-if="offline" class="ui-note" role="status">You are offline. Showing the last gist.</p>
    <FrontPageCard />
    <EpisodeCard />
    <CityWorks />
    <HomePin />
    <BirthdayCard />
    <p v-if="gist.failed && !gist.lines.length" class="ui-error" role="alert">The gist could not load. <button type="button" class="social-btn" @click="refresh(true)">Try again</button></p>
    <EmptyState v-else-if="!gist.lines.length && !gist.loading" icon="megaphone" title="Quiet for now" text="Nothing has happened yet. When a stall opens, an election is decided or a festival starts, it shows up here." />
    <p v-if="gist.loading && !gist.lines.length" class="ui-note" role="status">Listening…</p>
    <ul v-if="gist.lines.length" class="social-list" data-gist="list">
      <li v-for="line in gist.lines" :key="line.n" class="social-row" :data-gist-n="line.n">
        <div><strong>{{ line.text }}</strong><small>{{ agoText(line.at, now) }}</small></div>
        <span class="social-actions"><CivicAction :reason="offline ? 'Reconnect to share.' : ''" @click="shareGist(line.n, shareFailed)">Share</CivicAction></span>
      </li>
    </ul>
    <button v-if="gist.lines.length" type="button" class="social-btn" :disabled="gist.loading || offline" @click="refresh(true)">Refresh</button>
  </section>
</template>

<style scoped>
.gist-app { display: grid; gap: 12px; min-width: 0; overflow-wrap: anywhere; }
.gist-app > * { margin-top: 0; margin-bottom: 0; }
.gist-app > .social-btn { justify-self: start; }
</style>
