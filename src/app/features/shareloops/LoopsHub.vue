<script setup lang="ts">
// The "Share" tab of My Life (docs/SHARE-LOOPS.md): the things people screenshot and post, each made on this device from the player's own
// records. Where I grew up (the street video), What did you get (the start card), the passport (a page per continent), the month (Wrapped)
// and street fame (this week's board in the player's city, and the badge). Every card opens in LoopCardSheet, ready for the share sheet.
import { computed, defineAsyncComponent, onMounted, ref, shallowRef } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import LoopCardSheet from './LoopCardSheet.vue'
import { canvasPng, drawPassportPage, drawStoryCard } from './loopPaint.ts'
import { loopFile, loopLink, loopMark, profileOf } from './loopsModel.ts'
import { whoAmI } from './loopShare.ts'
import type { LoopShare } from './loopShare.ts'
import { fameCard, fameText, monthBefore, monthTitle, pageProgress, passportPages, passportText, stampDate, stampTone, wrappedCard, wrappedText } from './loopCards.ts'
import type { PassportPage } from './loopCards.ts'
import type { FameView, PassportView, WrappedView } from '../../../types/shareloops.ts'

const StreetVideo = defineAsyncComponent(() => import('./StreetVideo.vue'))
const StartCard = defineAsyncComponent(() => import('./StartCard.vue'))
const { game } = useApp()
const passport = shallowRef<PassportView | null>(null), wrapped = shallowRef<WrappedView | null>(null), fame = shallowRef<FameView | null>(null)
const month = ref(''), open = ref<'street' | 'start' | null>(null)
const sheet = shallowRef<{ title: string; alt: string; make: () => Promise<LoopShare | null> } | null>(null)
const pages = computed<PassportPage[]>(() => (passport.value ? passportPages(passport.value) : []))
const monthCard = computed(() => (wrapped.value ? wrappedCard(wrapped.value) : null))
const city = computed(() => game.view.value.cityId)
const cityName = computed(() => game.view.value.estate?.cityName ?? city.value)

async function read<T>(path: string, key: string): Promise<T | null> {
  try { const answer = await game.fetchJson<Record<string, unknown>>(path); return (answer[key] as T | undefined) ?? null } catch { return null }
}
async function loadMonth(next: string): Promise<void> { month.value = next; wrapped.value = await read<WrappedView>(`/api/loops/wrapped?month=${encodeURIComponent(next)}`, 'wrapped') }
onMounted(async () => {
  const [stamps, board] = await Promise.all([read<PassportView>('/api/loops/passport', 'passport'), read<FameView>(`/api/loops/fame?id=${encodeURIComponent(city.value)}`, 'fame')])
  passport.value = stamps; fame.value = board
  wrapped.value = await read<WrappedView>('/api/loops/wrapped', 'wrapped')
  month.value = wrapped.value?.month ?? ''
})
const origin = (): string => globalThis.location?.origin ?? ''
async function png(canvas: HTMLCanvasElement | null, loop: LoopShare['loop'], text: (link: string) => string, path: string): Promise<LoopShare | null> {
  const blob = canvas ? await canvasPng(canvas) : null
  if (!blob) return null
  const link = loopLink(origin(), loop, path)
  return { loop, file: new File([blob], loopFile(loop), { type: 'image/png' }), text: text(link), link }
}
function sharePage(page: PassportPage): void {
  sheet.value = { title: `Passport · ${page.name}`, alt: `Passport page for ${page.name}: ${pageProgress(page)}`, make: async () => {
    const who = await whoAmI()
    const canvas = drawPassportPage({ continent: page.name, holder: game.view.value.name ?? 'Resident', page: page.pages > 1 ? `Page ${page.page} of ${page.pages}` : 'Page 1', stamps: page.stamps.map((stamp) => ({ city: stamp.name, country: stamp.countryName, date: stampDate(stamp.at), tone: stampTone(stamp.city) })), progress: pageProgress(page), mark: loopMark(who.handle) })
    return png(canvas, 'passport', (link) => passportText(page, link), profileOf(who.handle, who.id))
  } }
}
function shareMonth(): void {
  const view = wrapped.value, card = monthCard.value
  if (!view || !card) return
  sheet.value = { title: card.title, alt: `${card.title}: ${card.tiles.map((tile) => `${tile.value} ${tile.label}`).join(', ')}`, make: async () => {
    const who = await whoAmI()
    const canvas = drawStoryCard({ theme: 'night', kicker: 'ALLWORLD WRAPPED', title: card.title, name: game.view.value.name ?? '', tiles: card.tiles, rows: card.rows, foot: 'Make yours on Allworld', mark: loopMark(who.handle) })
    return png(canvas, 'wrapped', (link) => wrappedText(view, link), profileOf(who.handle, who.id))
  } }
}
function shareFame(): void {
  const view = fame.value
  if (!view) return
  const card = fameCard(view, cityName.value)
  sheet.value = { title: card.title, alt: `${card.title}: ${card.rows.map((row) => row.value).join(', ')}`, make: async () => {
    const who = await whoAmI()
    const canvas = drawStoryCard({ theme: 'gold', kicker: 'STREET FAME', title: card.title, rows: card.rows, foot: card.foot, mark: loopMark(who.handle) })
    return png(canvas, 'fame', (link) => fameText(view, cityName.value, link), view.badge ? profileOf(who.handle, who.id) : `/visit/${view.city}`)
  } }
}
</script>

<template>
  <div class="lh" data-loops-hub>
    <section class="lh-card">
      <h3><GameIcon name="globe" inline /> Where I grew up</h3>
      <p>A video from space down to your old street, captioned and ready for your Status.</p>
      <button type="button" class="lh-btn is-primary" data-loops="street" @click="open = 'street'">Find my old street</button>
    </section>

    <section class="lh-card">
      <h3><GameIcon name="star" inline /> What did you get?</h3>
      <p>Your start in one card: job, home, money and a title.</p>
      <button type="button" class="lh-btn" data-loops="start" @click="open = 'start'">Make my start card</button>
    </section>

    <section class="lh-card" data-loops="passport">
      <h3><GameIcon name="plane" inline /> Passport</h3>
      <p v-if="!passport">Loading your stamps…</p>
      <p v-else-if="!pages.length">Every city you travel to stamps your passport.</p>
      <ul v-else class="lh-list">
        <li v-for="page in pages" :key="`${page.continent}-${page.page}`">
          <span><b>{{ page.name }}<template v-if="page.pages > 1"> · page {{ page.page }}</template></b><small>{{ pageProgress(page) }} · {{ page.stamps.map((stamp) => stamp.name).join(', ') }}</small></span>
          <button type="button" class="lh-btn is-small" @click="sharePage(page)">Share page</button>
        </li>
      </ul>
    </section>

    <section class="lh-card" data-loops="wrapped">
      <h3><GameIcon name="calendar" inline /> {{ month ? monthTitle(month) : 'Your month' }}</h3>
      <div class="lh-months">
        <button v-if="wrapped" type="button" class="lh-btn is-small" @click="loadMonth(monthBefore(wrapped.month))">Month before</button>
        <button v-if="wrapped && wrapped.partial === false" type="button" class="lh-btn is-small" @click="loadMonth('')">This month</button>
      </div>
      <p v-if="!monthCard">Loading your month…</p>
      <p v-else-if="monthCard.empty">Nothing to show for this month yet: visit places, make friends and vote, and it fills up.</p>
      <template v-else>
        <dl class="lh-tiles"><div v-for="tile in monthCard.tiles" :key="tile.label"><dt>{{ tile.label }}</dt><dd>{{ tile.value }}</dd></div></dl>
        <p v-for="row in monthCard.rows" :key="row.label" class="lh-row"><small>{{ row.label }}</small> {{ row.value }}</p>
        <button type="button" class="lh-btn is-primary" @click="shareMonth">Share my month</button>
      </template>
      <p class="lh-note">Game naira is never real money.</p>
    </section>

    <section class="lh-card" data-loops="fame">
      <h3><GameIcon name="star" inline /> Street fame · {{ cityName }}</h3>
      <p v-if="fame?.badge" class="lh-badge" data-loops="badge">Street famous: #{{ fame.badge.rank }} home in {{ fame.badge.cityName }} last week</p>
      <p v-if="!fame">Loading this week's board…</p>
      <template v-else>
        <p v-if="!fame.homes.length && !fame.communities.length">Nobody is on this week's board yet. Invite people home, or post in your community.</p>
        <ol v-if="fame.homes.length" class="lh-board"><li v-for="home in fame.homes" :key="home.rank"><b>{{ home.name }}<template v-if="home.mine"> (you)</template></b> · {{ home.visitors }} visitor{{ home.visitors === 1 ? '' : 's' }}</li></ol>
        <ol v-if="fame.communities.length" class="lh-board"><li v-for="crew in fame.communities" :key="crew.id"><b>{{ crew.name }}</b> · {{ crew.reactions }} reaction{{ crew.reactions === 1 ? '' : 's' }}</li></ol>
        <button v-if="fame.homes.length || fame.communities.length || fame.badge" type="button" class="lh-btn" @click="shareFame">Share the board</button>
      </template>
    </section>

    <StreetVideo v-if="open === 'street'" @close="open = null" />
    <StartCard v-if="open === 'start'" @close="open = null" />
    <LoopCardSheet v-if="sheet" :key="sheet.title" :title="sheet.title" :alt="sheet.alt" :make="sheet.make" @close="sheet = null" />
  </div>
</template>

<style scoped>
.lh { display: grid; gap: 12px; }
.lh-card { display: grid; gap: 6px; padding: 12px; border-radius: 14px; background: var(--c-surface-2, rgba(0, 0, 0, 0.03)); border: 1px solid var(--c-line, #e5e1d6); }
.lh-card h3 { margin: 0; font-size: 15px; }
.lh-card p { margin: 0; font-size: 13px; color: var(--c-muted, #6b7280); }
.lh-btn { justify-self: start; min-height: 40px; padding: 0 16px; border: 1px solid var(--c-line, #e5e1d6); border-radius: 999px; background: none; color: inherit; font: inherit; font-weight: 700; cursor: pointer; }
.lh-btn.is-primary { border-color: transparent; background: var(--c-green-dark, #1d6b43); color: #fff; }
.lh-btn.is-small { min-height: 34px; padding: 0 12px; font-size: 13px; }
.lh-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.lh-list li { display: flex; align-items: center; gap: 8px; }
.lh-list li > span { flex: 1; display: grid; min-width: 0; }
.lh-list small { color: var(--c-muted, #6b7280); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lh-months { display: flex; gap: 6px; }
.lh-tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin: 0; }
.lh-tiles div { padding: 8px; border-radius: 10px; background: #121a3a; color: #fff; }
.lh-tiles dt { font-size: 12px; opacity: .8; }
.lh-tiles dd { margin: 0; font-size: 20px; font-weight: 800; color: #9fd8ff; }
.lh-row small { display: block; }
.lh-badge { padding: 6px 10px; border-radius: 10px; background: #fff1b8; color: #5a3b0c !important; font-weight: 700; }
.lh-board { margin: 0; padding-left: 20px; font-size: 13px; }
.lh-note { font-size: 12px !important; }
</style>
