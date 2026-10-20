<script setup lang="ts">
// The city front page in the Gist app (docs/SHARE-LOOPS.md): yesterday's newspaper of the city, written each morning from its public gist
// lines (by a model when one was free, else the lines as they are), and a Share button that draws it as a picture on this device.
// Fetched with the Gist app's other cards (defineAsyncComponent), never at first paint.
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import LoopCardSheet from './LoopCardSheet.vue'
import { canvasPng, drawFrontPage } from './loopPaint.ts'
import { loopFile, loopLink, loopMark } from './loopsModel.ts'
import { whoAmI } from './loopShare.ts'
import type { LoopShare } from './loopShare.ts'
import { frontCredit, frontDate, frontText } from './loopCards.ts'
import type { FrontPageView } from '../../../types/shareloops.ts'

const { game } = useApp()
const city = computed(() => game.view.value.cityId)
const page = shallowRef<FrontPageView | null>(null)
const sharing = ref(false)
async function load(): Promise<void> {
  const asked = city.value
  if (!asked) return
  try {
    const answer = await game.fetchJson<{ page?: FrontPageView | null }>(`/api/loops/frontpage?id=${encodeURIComponent(asked)}`)
    if (asked === city.value) page.value = answer.page ?? null
  } catch { /* the card stays as it was */ }
}
onMounted(() => { void load() })
watch(city, () => { page.value = null; void load() })

async function make(): Promise<LoopShare | null> {
  const current = page.value
  if (!current) return null
  const who = await whoAmI()
  const canvas = drawFrontPage({ paper: current.paper, date: frontDate(current), headline: current.headline, stories: current.stories, credit: frontCredit(current), mark: loopMark(who.handle) })
  const blob = canvas ? await canvasPng(canvas) : null
  if (!blob) return null
  const link = loopLink(globalThis.location?.origin ?? '', 'frontpage', `/visit/${current.city}`)
  return { loop: 'frontpage', file: new File([blob], loopFile('frontpage'), { type: 'image/png' }), text: frontText(current, link), link }
}
</script>

<template>
  <section v-if="page" class="fp" data-frontpage :aria-label="`${page.paper}, ${frontDate(page)}`">
    <header class="fp-head"><b>{{ page.paper }}</b><small>{{ frontDate(page) }}</small></header>
    <h3 class="fp-headline">{{ page.headline }}</h3>
    <ul v-if="page.stories.length" class="fp-stories">
      <li v-for="story in page.stories" :key="story.head"><b>{{ story.head }}</b> <span>{{ story.body }}</span></li>
    </ul>
    <p class="fp-credit">{{ frontCredit(page) }}<template v-if="page.by === 'ai'">. Nothing in it is new: it only retells those lines.</template></p>
    <button type="button" class="fp-share" data-frontpage="share" @click="sharing = true">Share the front page</button>
    <LoopCardSheet v-if="sharing" :title="page.paper" :alt="`${page.paper}: ${page.headline}`" :make="make" @close="sharing = false" />
  </section>
</template>

<style scoped>
.fp { margin: 0; padding: 14px; border-radius: var(--r-md); background: #f7f3ea; color: #1b1b1b; font-family: Georgia, "Times New Roman", serif; }
.fp-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; border-bottom: 2px solid #1b1b1b; padding-bottom: 4px; }
.fp-head b { font-size: 16px; }
.fp-head small { font-family: system-ui, sans-serif; font-size: 12px; color: #555; }
.fp-headline { margin: 8px 0 6px; font-size: 18px; line-height: 1.25; }
.fp-stories { margin: 0 0 8px; padding-left: 18px; font-size: 14px; line-height: 1.4; }
.fp-stories li { margin-bottom: 4px; }
.fp-credit { margin: 0 0 8px; font: 12px system-ui, sans-serif; color: #666; }
.fp-share { min-height: var(--tap, 44px); padding: 0 16px; border: 0; border-radius: 999px; background: #1b1b1b; color: #fff; font: 700 13px system-ui, sans-serif; cursor: pointer; }
</style>
