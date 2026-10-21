<script setup lang="ts">
// The Feed (docs/FEED.md): what your neighbours, your friends, your city and the world are doing, as posts that belong to a person and a
// place. Near you (the first tab, and where it opens for someone with a location badge) puts people confirmed in your local government
// first, then your city, then the world, under a line of how many people confirmed your area this month. A post is
// written here or drafted by the world itself (a "moment": something public that happened to you), and it can carry a photo of the scene
// or a short clip. The same app is the whole product for someone without the 3D world (Lite, src/app/features/lite/).
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import './feed.css'
import './feedApp.css'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import EmptyState from '../../ui/EmptyState.vue'
import PlayerAvatar from '../social/PlayerAvatar.vue'
import PostCard from './PostCard.vue'
import SponsoredCard from '../promote/SponsoredCard.vue'
import type { ListingView } from '../../../types/promote.ts'
import { feedApi, portraitUrl, uploadMedia } from './feedApi.ts'
import { feedUnseen } from './feedBadge.ts'
import { encodePhoto, recordScene, snapshotScene, canRecord } from './feedMedia.ts'
import type { Recording } from './feedMedia.ts'
import { shareLink } from './feedShare.ts'
import { agoText, confirmedText, FEED, visibilityWord } from '../../../feed/model.ts'
import { cityName as registryCityName } from '../../../game/cities/registry.ts'
import { social } from '../social/useSocial.ts'
import { enterRoom, enterSquare, loadPlaces, places } from '../places/placesStore.ts'
import { keepBadge } from './badgeMark.ts'
import type { FeedTab, Visibility } from '../../../feed/model.ts'
import type { FeedMe, FeedMedia, InboxLine, NearLine, NewsLine, PostView, Suggestion } from '../../../types/feed.ts'
import { isPlayApp } from '../../playMode.ts'

const props = defineProps<{ params?: { tab?: string; post?: string } | null }>()
const { game, shell, scene } = useApp()
const playApp = isPlayApp()
const api = feedApi((path, options) => game.fetchJson(path, options))
type Tab = FeedTab | 'inbox'
const asked = props.params?.tab === 'near' || props.params?.tab === 'friends' || props.params?.tab === 'city' || props.params?.tab === 'world' || props.params?.tab === 'inbox' ? props.params.tab : null
// Near you is the default for someone with a location badge (the owner's decision); Friends otherwise. Decided once the profile is in.
const tab = ref<Tab>(asked ?? 'friends')
const me = ref<FeedMe | null>(null)
const posts = ref<PostView[]>([]), news = ref<NewsLine[]>([]), next = ref<string | null>(null), sponsored = ref<ListingView[]>([]), near = ref<NearLine | null>(null)
const loading = ref(false), failed = ref(''), now = ref(Date.now())
const open = ref<PostView | null>(null)
const suggestions = ref<Suggestion[]>([])
const city = computed(() => game.view.value.cityId)
const cityName = computed(() => registryCityName(city.value) ?? 'My city')
const toast = (text: string, tone?: 'error'): void => game.toast(text, tone === 'error' ? 'error' : 'info')

// ---- loading -----------------------------------------------------------------------------------------------------------------------
async function loadMe(): Promise<void> {
  const r = await api.me()
  if (r.ok) { me.value = r; feedUnseen.value = r.unseen; keepBadge(Boolean(r.profile.located)) }
}
async function load(more = false): Promise<void> {
  if (loading.value || tab.value === 'inbox') return
  loading.value = true; failed.value = ''
  const r = await api.list(tab.value, city.value, more ? next.value : null)
  loading.value = false; now.value = Date.now()
  if (!r.ok) { failed.value = r.reason; return }
  posts.value = more ? [...posts.value, ...r.posts.filter((p) => !posts.value.some((q) => q.id === p.id))] : r.posts
  next.value = r.next
  if (!more) { news.value = r.news ?? []; sponsored.value = playApp ? [] : r.sponsored ?? []; near.value = r.near ?? null }
  if (tab.value === 'friends' && !more && r.posts.length < 4) void loadSuggestions()
}
async function loadSuggestions(): Promise<void> { const r = await api.suggestions(); if (r.ok) suggestions.value = r.people.slice(0, 8) }
onMounted(() => {
  if (asked) { void loadMe(); void load() } else void loadMe().then(() => { if (me.value?.profile.located) tab.value = 'near'; else void load() })
  void loadPlaces()
  if (props.params?.post) void openPost(props.params.post)
})
// In Lite the Feed is on screen before the game has connected: read again once it has.
watch(() => game.view.value.connected, (on, was) => { if (on && !was) { void loadMe(); void load(); void loadPlaces() } })
// A new inbox line (a reply, a reaction): read the inbox again.
watch(feedUnseen, (n, before) => { if (n > before) void loadMe() })
watch(tab, (t) => { posts.value = []; next.value = null; open.value = null; if (t === 'inbox') void readInbox(); else void load(); void nextTick(showTab) })

// The tab row scrolls on a narrow screen: fade the side that has more tabs, and keep the chosen tab in view.
const tabsEl = ref<HTMLElement | null>(null), fadeLeft = ref(false), fadeRight = ref(false)
function tabHints(): void { const el = tabsEl.value; if (!el) return; fadeLeft.value = el.scrollLeft > 4; fadeRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4 }
function showTab(): void { tabsEl.value?.querySelector<HTMLElement>('.is-on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }); tabHints() }
onMounted(() => { void nextTick(tabHints); window.addEventListener('resize', tabHints) })
onBeforeUnmount(() => window.removeEventListener('resize', tabHints))
watch(cityName, () => void nextTick(tabHints))

// ---- composing ---------------------------------------------------------------------------------------------------------------------
const text = ref(''), vis = ref<Visibility | ''>(''), crew = ref(''), label = ref(''), media = ref<FeedMedia | null>(null), preview = ref(''), busy = ref(false), draftN = ref<number | null>(null)
const recording = ref<Recording | null>(null), poster = ref<string | null>(null)
const adult = computed(() => Boolean(me.value?.profile.adult))
const choices = computed<{ id: Visibility; label: string }[]>(() => {
  const all: { id: Visibility; label: string }[] = []
  if (adult.value && (!media.value || me.value?.publicMedia)) all.push({ id: 'public', label: visibilityWord.public }, { id: 'city', label: visibilityWord.city })
  all.push({ id: 'friends', label: visibilityWord.friends })
  if (me.value?.crews.length) all.push({ id: 'crew', label: visibilityWord.crew })
  return all
})
watch(choices, (list) => { if (!list.some((c) => c.id === vis.value)) vis.value = list[0]?.id ?? 'friends' }, { immediate: true })
const sceneCanvas = () => scene.venue.value?.captureCanvas?.() ?? null
const hasScene = computed(() => Boolean(scene.venue.value) && !document.body.classList.contains('is-lite'))
function clearMedia(): void { if (preview.value) URL.revokeObjectURL(preview.value); preview.value = ''; media.value = null }
async function attach(blob: Blob | null, extra: { ms?: number; w?: number; h?: number } = {}): Promise<void> {
  if (!blob) { toast('That could not be used. Try another photo.', 'error'); return }
  busy.value = true
  const r = await uploadMedia(blob, 'post', extra)
  busy.value = false
  if (!r.ok) { toast(r.reason, 'error'); return }
  clearMedia(); media.value = r.media; preview.value = URL.createObjectURL(blob)
}
async function pickPhoto(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  ;(event.target as HTMLInputElement).value = ''
  if (file) await attach(await encodePhoto(file))
}
const snap = async (): Promise<void> => attach(await snapshotScene(sceneCanvas))
/** A duet being answered (docs/SHARE-LOOPS.md): the clip the next posted clip answers, shown beside it. */
const duetOf = ref<PostView | null>(null)
function answerDuet(post: PostView): void {
  duetOf.value = post
  toast(hasScene.value && canRecord() ? `Record a clip to answer ${post.by.name}. It will show beside theirs.` : 'Duets are recorded from the 3D scene. Open the world on this device to record one.')
  document.querySelector('[data-feed="compose"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}
async function clip(): Promise<void> {
  if (recording.value) { recording.value.stop(); return }
  // The clip's still, taken as it starts: the reviewer looks at it and the player shows it before the clip plays.
  const still = await snapshotScene(sceneCanvas)
  const r = recordScene(sceneCanvas)
  if (!r) { toast('This browser cannot record the scene.', 'error'); return }
  if (still) void uploadMedia(still, 'post').then((up) => { poster.value = up.ok ? up.media.hash : null })
  recording.value = r
  toast(`Recording up to ${Math.round(FEED.media.clipMs / 1000)} seconds. Tap again to stop.`)
  const done = await r.done
  recording.value = null
  if (done) await attach(done.blob, { ms: Math.round(done.ms), w: done.w, h: done.h }); else toast('The clip was too long or empty.', 'error')
}
function useDraft(n: number, line: string): void { draftN.value = n; text.value = ''; toast(`Posting the moment: “${line}”. Add a few words if you like.`) }
async function dropDraft(n: number): Promise<void> { await api.dropDraft(n); if (me.value) me.value.drafts = me.value.drafts.filter((d) => d.n !== n); if (draftN.value === n) draftN.value = null }
async function publish(): Promise<void> {
  if (busy.value || (!text.value.trim() && !media.value && draftN.value === null)) return
  busy.value = true
  const r = await api.post({ body: text.value, vis: vis.value || undefined, ...(vis.value === 'crew' && crew.value ? { crew: crew.value } : {}), ...(media.value ? { media: media.value.hash, ...(poster.value ? { poster: poster.value } : {}) } : {}), ...(draftN.value !== null ? { draft: draftN.value } : {}), ...(label.value.trim() ? { label: label.value.trim() } : {}), ...(duetOf.value && media.value && (media.value.type === 'webm' || media.value.type === 'mp4') ? { duet: duetOf.value.id } : {}) })
  busy.value = false
  if (!r.ok) { toast(r.reason, 'error'); return }
  text.value = ''; label.value = ''; clearMedia(); poster.value = null; duetOf.value = null
  if (draftN.value !== null && me.value) me.value.drafts = me.value.drafts.filter((d) => d.n !== draftN.value)
  draftN.value = null
  posts.value = [r.post, ...posts.value]
  toast('Posted.')
}
watch(() => me.value?.crews, (list) => { if (list?.length && !crew.value) crew.value = list[0]!.id })

// ---- posts -------------------------------------------------------------------------------------------------------------------------
const replace = (post: PostView): void => { posts.value = posts.value.map((p) => (p.id === post.id ? post : p)); if (open.value?.id === post.id) open.value = post }
const removed = (id: string): void => { posts.value = posts.value.filter((p) => p.id !== id); if (open.value?.id === id) open.value = null }
async function openPost(id: string): Promise<void> { const r = await api.thread(id); if (r.ok) open.value = r.post; else toast(r.reason, 'error') }
const person = (id: string, name: string): void => { shell.open('person', { player: id, name }) }
async function share(post: PostView): Promise<void> {
  const url = post.event ? `/ev/${post.event.code}` : `/p/${post.by.handle ? `@${post.by.handle}` : post.by.id}`
  const said = await shareLink(url, post.event ? `Come to ${post.event.title} on Allworld` : `${post.by.name} on Allworld: ${post.body.slice(0, 80)}`)
  if (said === 'copied') toast('Link copied.')
}
const openEvent = (id: string): void => { shell.open('plans', { event: id }) }
const openGig = (): void => { shell.open('work') }

// ---- live places: where people are right now (the Square, your group rooms) ----
const lonely = computed(() => (social.me?.friends.length ?? 0) < 3)
const liveRooms = computed(() => places.rooms.filter((r) => r.here > 0).slice(0, 3))
async function join(id: string | null): Promise<void> { const ok = id ? await enterRoom(id) : await enterSquare(); if (ok) shell.closeSheet() }

// ---- inbox, people, places ---------------------------------------------------------------------------------------------------------
async function readInbox(): Promise<void> { await loadMe(); if (feedUnseen.value) { await api.seen(); feedUnseen.value = 0 } }
const inbox = computed<InboxLine[]>(() => me.value?.inbox ?? [])
async function addFriend(s: Suggestion): Promise<void> {
  try { await game.fetchJson('/api/social/friends/request', { method: 'POST', body: { to: s.person.id, cityId: city.value } }); toast(`Asked ${s.person.name} to be your friend.`); suggestions.value = suggestions.value.filter((x) => x !== s) }
  catch (error) { toast((error as { reason?: string }).reason ?? 'That did not go through.', 'error') }
}
</script>

<template>
  <section class="feed" aria-label="Feed" data-feed="app">
    <nav ref="tabsEl" class="feed-tabs" :class="{ 'has-left': fadeLeft, 'has-right': fadeRight }" aria-label="Feed tabs" @scroll.passive="tabHints">
      <button type="button" :class="{ 'is-on': tab === 'near' }" @click="tab = 'near'">Near you</button>
      <button type="button" :class="{ 'is-on': tab === 'friends' }" @click="tab = 'friends'">Friends</button>
      <button type="button" :class="{ 'is-on': tab === 'city' }" @click="tab = 'city'">{{ cityName }}</button>
      <button type="button" :class="{ 'is-on': tab === 'world' }" @click="tab = 'world'">World</button>
      <button type="button" :class="{ 'is-on': tab === 'inbox' }" @click="tab = 'inbox'">Inbox<span v-if="feedUnseen" class="feed-dot">{{ feedUnseen }}</span></button>
    </nav>

    <template v-if="open">
      <button type="button" class="feed-pill" @click="open = null">← Back</button>
      <PostCard :post="open" :api="api" :now="now" full @changed="replace" @removed="removed" @person="person" @toast="toast" @share="share" @event="openEvent" @gig="openGig" @duet="answerDuet" />
    </template>

    <template v-else-if="tab === 'inbox'">
      <EmptyState v-if="!inbox.length" icon="megaphone" title="Nothing yet" text="Replies, reactions, follows, crew news and RSVPs show up here." />
      <ul v-else class="social-list">
        <li v-for="(line, i) in inbox" :key="i" class="social-row" :class="{ 'is-seen': line.seen }">
          <PlayerAvatar v-if="line.from" :name="line.from.name" :seed="line.from.id" />
          <div><strong>{{ line.text }}</strong><small>{{ agoText(line.at, now) }}</small></div>
          <span class="social-actions"><button v-if="line.post" type="button" class="social-btn" @click="openPost(line.post)">Open</button></span>
        </li>
      </ul>
    </template>

    <template v-else>
      <p v-if="tab === 'near' && near" class="feed-note" data-feed="near" role="status">📍 <template v-if="near.lgaName">{{ confirmedText(near.lgaN ?? 0, near.lgaName) }} · {{ (near.n).toLocaleString('en') }} in {{ near.cityName }}</template><template v-else>{{ confirmedText(near.n, near.cityName) }}</template></p>
      <p v-else-if="tab === 'near' && me && !me.profile.located" class="feed-note" data-feed="near-badge">Showing {{ cityName }}. Get the location badge in <button type="button" class="feed-pill" @click="shell.open('me')">My profile</button> to see the people near you first.</p>
      <div v-if="me?.drafts.length" class="feed-card" data-feed="drafts">
        <b>Moments waiting to be posted</b>
        <p class="feed-note">Things that really happened to you. One tap posts them.</p>
        <ul class="feed-news">
          <li v-for="d in me.drafts" :key="d.n">{{ d.text }}
            <span class="feed-row"><button type="button" class="feed-pill" @click="useDraft(d.n, d.text)">{{ draftN === d.n ? 'Chosen' : 'Post this' }}</button><button type="button" class="feed-pill" @click="dropDraft(d.n)">Not now</button></span>
          </li>
        </ul>
      </div>

      <form class="feed-card feed-compose" data-feed="compose" @submit.prevent="publish">
        <p v-if="duetOf" class="feed-answering" data-feed="answering"><span>Answering {{ duetOf.by.name }}'s clip with a duet: record yours below.</span><button type="button" class="feed-pill" @click="duetOf = null">Cancel</button></p>
        <textarea v-model="text" :maxlength="FEED.body" :placeholder="draftN !== null ? 'Add a few words to your moment (optional)' : tab === 'city' ? `What is happening in ${cityName}?` : tab === 'near' ? `What is happening around ${near?.lgaName ?? near?.cityName ?? cityName}?` : 'What are you up to?'" aria-label="Write a post" />
        <img v-if="preview && media && media.type !== 'webm' && media.type !== 'mp4'" class="feed-media" :src="preview" alt="Your photo">
        <video v-else-if="preview" class="feed-media" :src="preview" controls muted playsinline />
        <div class="feed-row">
          <label class="feed-pill">Photo<input type="file" accept="image/*" hidden :disabled="busy || !me?.media" @change="pickPhoto"></label>
          <button v-if="hasScene" type="button" class="feed-pill" :disabled="busy || !me?.media" @click="snap">Snap the scene</button>
          <button v-if="hasScene && canRecord()" type="button" class="feed-pill" :disabled="busy || !me?.media" @click="clip">{{ recording ? 'Stop clip' : 'Record a clip' }}</button>
          <button v-if="media" type="button" class="feed-pill" @click="clearMedia">Remove</button>
        </div>
        <div class="feed-row">
          <select v-model="vis" aria-label="Who sees it"><option v-for="c in choices" :key="c.id" :value="c.id">{{ c.label }}</option></select>
          <select v-if="vis === 'crew'" v-model="crew" aria-label="Which crew"><option v-for="c in me?.crews ?? []" :key="c.id" :value="c.id">{{ c.name }}</option></select>
          <input v-model="label" :maxlength="FEED.place" placeholder="Where? (optional)" aria-label="Place">
          <button type="submit" class="social-btn is-primary" :disabled="busy || (!text.trim() && !media && draftN === null)">Post</button>
        </div>
        <p v-if="me && !adult" class="feed-note">Until you confirm you are 18 or older, posts go to friends and crews.</p>
        <p v-else-if="media && !me?.publicMedia" class="feed-note">Photos and clips go to friends and crews for now.</p>
      </form>

      <div v-if="tab !== 'world' && (places.squareHere > 0 || liveRooms.length)" class="feed-strip" data-feed="live">
        <div v-if="places.squareHere > 0" class="feed-live"><b>{{ places.squareHere }} {{ places.squareHere === 1 ? 'person is' : 'people are' }} in the Square now{{ lonely ? '. Go say hi.' : '' }}</b><button type="button" @click="join(null)">Join</button></div>
        <div v-for="r in liveRooms" :key="r.id" class="feed-live"><b>{{ r.here }} in {{ r.name }}</b><button type="button" @click="join(r.id)">Join</button></div>
      </div>

      <div v-if="tab === 'friends' && suggestions.length" class="feed-card" data-feed="suggestions">
        <b>People you may know</b>
        <div class="feed-strip">
          <div v-for="s in suggestions" :key="s.person.id" class="feed-person">
            <img v-if="s.person.portrait" class="feed-portrait" :src="portraitUrl(s.person.id, s.person.portrait)" alt="">
            <PlayerAvatar v-else :name="s.person.name" :seed="s.person.id" />
            <button type="button" class="feed-name" @click="person(s.person.id, s.person.name)"><b>{{ s.person.name }}</b></button>
            <small>{{ s.why }}</small>
            <button type="button" class="feed-pill" @click="addFriend(s)">Add</button>
          </div>
        </div>
      </div>

      <ul v-if="news.length && tab !== 'friends'" class="feed-news" aria-label="The gist">
        <li v-for="n in news.slice(0, 3)" :key="n.n">{{ n.text }} <small class="feed-note">{{ agoText(n.at, now) }}</small></li>
      </ul>

      <p v-if="failed" class="feed-error" role="alert">{{ failed }} <button type="button" class="social-btn" @click="load()">Try again</button></p>
      <EmptyState v-else-if="!posts.length && !loading" icon="people" :title="tab === 'friends' ? 'Your friends have not posted yet' : 'Quiet so far'" :text="tab === 'friends' ? 'Post the first thing, add people you meet, or start a crew. The World tab is never empty.' : 'Be the first to post here.'" />
      <template v-for="(p, i) in posts" :key="p.id">
        <PostCard :post="p" :api="api" :now="now" @changed="replace" @removed="removed" @person="person" @open="openPost" @toast="toast" @share="share" @event="openEvent" @gig="openGig" @duet="answerDuet" />
        <SponsoredCard v-if="!playApp && i === 0 && sponsored[0]" :listing="sponsored[0]" />
        <SponsoredCard v-if="!playApp && i === 5 && sponsored[1]" :listing="sponsored[1]" />
      </template>
      <SponsoredCard v-if="!playApp && !posts.length && sponsored[0]" :listing="sponsored[0]" />
      <button v-if="next" type="button" class="social-btn" :disabled="loading" @click="load(true)">More</button>
      <p v-if="loading" class="feed-note" role="status">Loading…</p>
    </template>
  </section>
</template>
