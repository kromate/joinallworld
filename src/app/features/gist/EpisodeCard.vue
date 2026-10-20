<script setup lang="ts">
// "This week in <city>": the city's week so far as a few plain lines and a Share button that sends the public page's address (docs/EPISODES.md).
// Loaded on its own (the Gist app fetches it with defineAsyncComponent), never at first paint. It reads through the game's own fetch only.
import { computed, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { episodeFacts, episodeShareLine } from '../../../episode/text.ts'
import CivicAction from '../civic/CivicAction.vue'
import { episodeApiPath, episodeSharePath, readEpisode } from './episodeModel.ts'
import type { EpisodeView } from '../../../types/world.ts'

const { game } = useApp()
const city = computed(() => game.view.value.cityId)
const offline = computed(() => (game.view.value.connected ? '' : 'Reconnect to share.'))
const episode = ref<EpisodeView | null>(null)
async function load(): Promise<void> {
  const asked = city.value
  if (!asked) return
  try { const read = readEpisode(await game.fetchJson(episodeApiPath(asked))); if (asked === city.value) episode.value = read } catch { /* the card stays as it was */ }
}
onMounted(() => { void load() })
watch(city, () => { episode.value = null; void load() })
const facts = computed(() => (episode.value ? episodeFacts(episode.value) : []))
async function share(): Promise<void> {
  const current = episode.value
  if (!current) return
  try {
    const { shareAddress } = await import('../paths/share.ts')
    await shareAddress(episodeSharePath(current.city), episodeShareLine(current), (line, kind) => { game.toast(line, kind) })
  } catch { game.toast('That could not be shared. Try again.', 'error') }
}
</script>

<template>
  <section v-if="episode" class="episode-card" data-episode="card" :aria-label="episode.headline">
    <h3>{{ episode.headline }}</h3>
    <p v-if="!episode.lines.length" class="social-note" data-episode="quiet">Nothing the city could see has happened yet.</p>
    <ul v-else class="episode-lines" data-episode="lines">
      <li v-for="line in episode.lines" :key="line.text">{{ line.text }}<span v-if="line.ai" class="episode-ai">AI</span></li>
    </ul>
    <ul v-if="facts.length" class="episode-facts social-note"><li v-for="fact in facts" :key="fact">{{ fact }}</li></ul>
    <span class="social-actions"><CivicAction :reason="offline" @click="share">Share</CivicAction></span>
  </section>
</template>

<style scoped>
.episode-card { margin: 0; padding: 14px; border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1), var(--ring); }
.episode-card h3 { font-size: 16px; margin: 0 0 6px; }
.episode-lines, .episode-facts { margin: 0 0 8px; padding-left: 18px; font-size: 14px; line-height: 1.45; }
.episode-lines li { margin-bottom: 4px; }
.episode-ai { margin-left: 6px; padding: 0 6px; border-radius: 99px; background: #4338ca; color: #fff; font-size: 11px; font-weight: 700; }
</style>
