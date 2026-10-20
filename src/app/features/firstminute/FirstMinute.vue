<script setup lang="ts">
// THE FIRST MINUTE (docs/FEED.md, "First minute"): one strip on the first screen after Play, in the 3D world and in Lite. Up to three things
// of Near you (an event first), how many people are here now, and ONE next action chosen by what exists (./firstMinuteModel.ts): Say hello,
// Join <community> or Walk to the Square. Once per session, put away with ×, gone after its action. A new player also gets "Show me around",
// the walkthrough on request (it no longer starts by itself for them: the strip is their first minute). Mounted by ./startFirstMinute.ts.
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import { useApp, tripKey } from '../../state/app.ts'
import { loadPeople, social } from '../social/useSocial.ts'
import { placeNow, placePeople } from '../places/placeState.ts'
import { cityName } from '../../../game/cities/registry.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { feedApi } from '../feed/feedApi.ts'
import { keepBadge } from '../feed/badgeMark.ts'
import { actionHint, hereText, nextAction, stripItems } from './firstMinuteModel.ts'
import type { Badge, NextAction, StripItem } from './firstMinuteModel.ts'
import type { CrewView, PostView } from '../../../types/feed.ts'

const props = defineProps<{ fresh: boolean }>()
// A new life's start card ("What did you get", docs/SHARE-LOOPS.md): fetched only when tapped.
const StartCard = defineAsyncComponent(() => import('../shareloops/StartCard.vue'))
const showStart = ref(false)
const emit = defineEmits<{ close: [] }>()
const { game, shell, community } = useApp()
const api = feedApi((path, options) => game.fetchJson(path, options))
const posts = ref<PostView[]>([]), communities = ref<CrewView[]>([]), badge = ref<Badge | null>(null), area = ref(''), ready = ref(false), busy = ref(false)

const me = (): string => game.view.value.session?.id ?? ''
/** Other people where the player stands: the room's own count when its chat is connected, else the place's or the venue's listing. */
const others = computed<number | null>(() => {
  const room = community.state.value
  if (room?.connection === 'Connected' && room.memberCount > 0) return room.memberCount - 1
  if (placeNow.value) return placePeople.value.length
  const people = social.people
  return people && 'players' in people ? people.players.filter((person) => person.here && person.id !== me()).length : null
})
const street = computed(() => game.state.value.location === 'city-street')
const action = computed<NextAction>(() => nextAction({
  posts: posts.value, communities: communities.value, badge: badge.value, city: game.view.value.cityId, others: others.value,
  canChat: Boolean(placeNow.value) || !street.value,
  canWalk: placeNow.value?.kind !== 'square' && !street.value && !social.me?.visiting && !tripKey(game.state.value),
}))
const items = computed<StripItem[]>(() => stripItems(posts.value, Date.now()))
const here = computed(() => hereText(others.value))
const hint = computed(() => actionHint(action.value))

onMounted(async () => {
  if (!placeNow.value && social.people === null) void loadPeople()
  const city = game.view.value.cityId
  const page = await api.list('near', city)
  if (page.ok) {
    posts.value = page.posts
    badge.value = page.near ? { city: page.near.city, ...(page.near.lga ? { lga: page.near.lga } : {}) } : null
    area.value = page.near?.lgaName ?? page.near?.cityName ?? ''
    keepBadge(Boolean(page.near))
  }
  const where = badge.value?.city ?? city
  const found = await game.fetchJson<{ ok: boolean; communities?: CrewView[] }>(`/api/feed/communities?city=${encodeURIComponent(where)}`).catch(() => null)
  if (found?.ok) communities.value = found.communities ?? []
  if (!area.value) area.value = cityName(city) ?? ''
  ready.value = true
})

const openPost = (id: string): void => { shell.open('feed', { tab: 'near', post: id }); emit('close') }
async function go(): Promise<void> {
  const next = action.value
  if (busy.value) return
  if (next.kind === 'room') { community.toggle(true); emit('close'); return }
  if (next.kind === 'reply') { openPost(next.post); return }
  if (next.kind === 'post') { shell.open('feed', { tab: 'near' }); emit('close'); return }
  busy.value = true
  try {
    if (next.kind === 'square') {
      const { enterSquare } = await import('../places/placesStore.ts')
      if (await enterSquare()) emit('close')
      return
    }
    const r = await game.fetchJson<{ ok: boolean; reason?: string }>('/api/feed/crews/join', { method: 'POST', body: { id: next.crew } }).catch((e: unknown) => ({ ok: false, reason: (e as { reason?: string }).reason }))
    if (!r.ok) { game.toast(r.reason ?? 'That did not go through.', 'error'); communities.value = communities.value.filter((crew) => crew.id !== next.crew); return }
    game.toast(`You joined ${next.name}.`)
    shell.open('crews', { crew: next.crew })
    emit('close')
  } finally { busy.value = false }
}
function showAround(): void { emit('close'); window.dispatchEvent(new CustomEvent('jaw:tour', { detail: { from: 'first-minute' } })) }
</script>

<template>
  <section v-if="ready" class="fm" :aria-label="area ? `Near you in ${area}` : 'Near you'" data-first-minute>
    <header class="fm-top">
      <b><GameIcon name="globe" :size="15" inline /> Near you<template v-if="area"> · {{ area }}</template></b>
      <span v-if="here" class="fm-here" data-fm="here">{{ here }}</span>
      <button type="button" class="fm-x" data-fm="close" aria-label="Put this away" title="Put this away" @click="emit('close')"><GameIcon name="close" :size="14" /></button>
    </header>
    <ul v-if="items.length" class="fm-items">
      <li v-for="item in items" :key="item.id"><button type="button" :data-fm-item="item.id" @click="openPost(item.id)"><span v-if="item.event" aria-label="Event">📅 </span><b>{{ item.who }}</b> {{ item.text }}</button></li>
    </ul>
    <div class="fm-act">
      <button type="button" class="fm-go" :data-fm-action="action.kind" :disabled="busy" @click="go">{{ action.label }}</button>
      <small>{{ hint }}</small>
      <button v-if="props.fresh" type="button" class="fm-link" data-fm="tour" @click="showAround">Show me around</button>
      <button v-if="props.fresh" type="button" class="fm-link" data-fm="start-card" @click="showStart = true">What did you get?</button>
    </div>
    <StartCard v-if="showStart" @close="showStart = false" />
  </section>
</template>

<style scoped>
.fm { display: grid; gap: 6px; width: 100%; box-sizing: border-box; padding: 8px 10px 10px 12px; border-radius: 16px; background: var(--c-surface, #fff); border: 1px solid var(--c-line, #e5e1d6); box-shadow: var(--e-1, 0 1px 4px #0002); pointer-events: auto; color: var(--c-ink, #111); font-size: var(--t-small, 13px); line-height: 1.35; animation: fm-in .28s ease-out both; }
.fm button { font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.fm button:focus-visible { outline: var(--focus); outline-offset: 2px; }
.fm-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.fm-top b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--c-green-dark, #1d6b43); }
.fm-here { flex: none; padding: 2px 8px; border-radius: 999px; background: var(--c-green-soft, #e8f5ec); color: var(--c-green-dark, #1d6b43); font-weight: 650; }
.fm-x { flex: none; display: grid; place-items: center; width: 44px; height: 44px; margin: -8px -8px -8px 0; border: 0; border-radius: 50%; background: none; color: var(--c-muted, #6b7280); }
.fm-items { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
.fm-items button { width: 100%; min-height: 44px; padding: 4px 0; border: 0; background: none; color: inherit; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fm-act { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
.fm-act small { flex: 1 1 140px; color: var(--c-muted, #6b7280); }
.fm-go { min-height: 44px; padding: 0 16px; border: 0; border-radius: var(--r-pill, 999px); background: var(--c-green-dark, #1d6b43); color: #fff; font-weight: 700; }
.fm-go:disabled { opacity: .6; cursor: default; }
.fm-link { min-height: 44px; padding: 0 8px; border: 0; background: none; color: var(--c-green-dark, #1d6b43); font-weight: 650; text-decoration: underline; }
@keyframes fm-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .fm { animation: none; } }
</style>
