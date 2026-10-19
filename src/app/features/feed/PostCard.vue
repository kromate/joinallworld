<script setup lang="ts">
// One post: who, where and when, the words, a photo or clip, an event or gig inside it, reactions, the newest replies and a reply box.
// Everything a viewer may do is what the server said (`canReply`, `mine`); this only draws it.
import './feed.css'
import './feedApp.css'
import { computed, defineAsyncComponent, ref } from 'vue'
import PlayerAvatar from '../social/PlayerAvatar.vue'
import ScamNotice from '../trust/ScamNotice.vue'
import { SCAM_REPORT_REASON } from '../trust/scamNotice.ts'
import { agoText, badgePlaceText, visibilityWord } from '../../../feed/model.ts'
import { mediaUrl, portraitUrl } from './feedApi.ts'
import type { FeedApi } from './feedApi.ts'
import type { PostView, ReplyView } from '../../../types/feed.ts'

const props = defineProps<{ post: PostView; api: FeedApi; now: number; full?: boolean }>()
const emit = defineEmits<{ changed: [post: PostView]; removed: [id: string]; person: [id: string, name: string]; open: [id: string]; toast: [text: string, tone?: 'error']; share: [post: PostView]; event: [id: string]; gig: [id: string]; duet: [post: PostView] }>()
// Duets (docs/SHARE-LOOPS.md): a clip that answers a clip shows beside it; sharing one makes a single video on this device, fetched when asked.
const DuetSheet = defineAsyncComponent(() => import('../shareloops/DuetSheet.vue'))
const sharingDuet = ref(false)
const isClip = computed(() => props.post.kind === 'clip' && (props.post.media?.type === 'webm' || props.post.media?.type === 'mp4'))
const QUICK = ['❤️', '😂', '🔥', '👏', '😮', '🙏']
const reply = ref(''), busy = ref(false), menu = ref(false), picking = ref(false)
const mine = computed(() => props.post.reactions.find((r) => r.mine)?.emoji ?? null)
const placeText = computed(() => { const p = props.post.place; return p ? [p.label, p.cityName].filter(Boolean).join(' · ') : '' })
const meta = computed(() => [agoText(props.post.at, props.now), placeText.value, props.post.vis !== 'public' ? visibilityWord[props.post.vis] : '', props.post.crew?.name ?? ''].filter(Boolean).join(' · '))

async function react(emoji: string): Promise<void> {
  if (busy.value) return
  busy.value = true; picking.value = false
  const r = await props.api.react(props.post.id, mine.value === emoji ? null : emoji)
  busy.value = false
  if (r.ok) emit('changed', r.post); else emit('toast', r.reason, 'error')
}
async function send(): Promise<void> {
  const text = reply.value.trim()
  if (!text || busy.value) return
  busy.value = true
  const r = await props.api.reply(props.post.id, text)
  busy.value = false
  if (r.ok) { reply.value = ''; emit('changed', r.post) } else emit('toast', r.reason, 'error')
}
async function remove(): Promise<void> {
  menu.value = false
  if (!confirm('Delete this post? Replies go with it.')) return
  const r = await props.api.removePost(props.post.id)
  if (r.ok) emit('removed', props.post.id); else emit('toast', r.reason, 'error')
}
/** The scam banner under a reply: reported in one tap (the feed's report of a reply names the post and the reply number). */
async function reportScam(r: ReplyView): Promise<void> {
  const done = await props.api.report('reply', props.post.id, SCAM_REPORT_REASON, r.n)
  emit('toast', done.ok ? 'Thanks. We will look at it.' : done.reason, done.ok ? undefined : 'error')
}
async function report(): Promise<void> {
  menu.value = false
  const reason = prompt('Why are you reporting this? (spam, harassment, scam, nudity, violence, hate, other)', 'spam')
  if (!reason) return
  const r = await props.api.report('post', props.post.id, reason.trim().toLowerCase())
  emit('toast', r.ok ? 'Thanks. We will look at it. Two reports hide a post until someone checks.' : r.reason, r.ok ? undefined : 'error')
}
async function dropReply(n: number): Promise<void> {
  const r = await props.api.removeReply(props.post.id, n)
  if (r.ok) { const t = await props.api.thread(props.post.id); if (t.ok) emit('changed', t.post) } else emit('toast', r.reason, 'error')
}
</script>

<template>
  <article class="feed-card" :class="{ 'is-hidden': post.hidden }" :data-post="post.id">
    <header class="feed-head">
      <img v-if="post.by.portrait" class="feed-portrait" :src="portraitUrl(post.by.id, post.by.portrait)" alt="" loading="lazy">
      <PlayerAvatar v-else :name="post.by.name" :seed="post.by.id" />
      <div class="feed-who">
        <button type="button" class="feed-name" @click="emit('person', post.by.id, post.by.name)"><b>{{ post.by.name }}<span v-if="post.by.handle" class="feed-note"> @{{ post.by.handle }}</span></b></button>
        <small>{{ meta }}<template v-if="post.by.located"> · <span class="feed-located" :title="`Their device confirmed they are in ${badgePlaceText(post.by.located)}`">📍 {{ post.by.located.lgaName ?? post.by.located.name }}</span></template><template v-if="post.ai || post.by.ai"> · <span class="ai-tag" title="An AI agent plays this character">AI-played</span></template></small>
      </div>
      <button type="button" class="feed-pill" aria-label="More" @click="menu = !menu">⋯</button>
    </header>
    <div v-if="menu" class="feed-bar" role="menu">
      <button type="button" @click="menu = false; emit('share', post)">Share</button>
      <button v-if="post.duet && isClip" type="button" @click="menu = false; sharingDuet = true">Share the duet</button>
      <button v-if="post.mine" type="button" @click="remove">Delete</button>
      <button v-else type="button" @click="report">Report</button>
    </div>
    <p v-if="post.hidden" class="feed-note">Hidden after reports. Only you see it until someone checks.</p>
    <p v-if="post.kind === 'moment' && post.body" class="feed-moment">{{ post.body }}</p>
    <p v-else-if="post.body" class="feed-body">{{ post.body }}</p>
    <img v-if="post.media && (post.media.type === 'jpeg' || post.media.type === 'png' || post.media.type === 'webp')" class="feed-media" :src="mediaUrl(post.media.hash)" :width="post.media.w" :height="post.media.h" alt="" loading="lazy">
    <div v-else-if="post.media && post.duet" class="feed-duet" data-feed="duet">
      <figure><video class="feed-media" :src="mediaUrl(post.duet.media.hash)" :poster="post.duet.poster ? mediaUrl(post.duet.poster) : undefined" controls playsinline preload="metadata" /><figcaption>{{ post.duet.by.name }}</figcaption></figure>
      <figure><video class="feed-media" :src="mediaUrl(post.media.hash)" :poster="post.poster ? mediaUrl(post.poster) : undefined" controls playsinline preload="metadata" /><figcaption>{{ post.by.name }}</figcaption></figure>
    </div>
    <video v-else-if="post.media" class="feed-media" :src="mediaUrl(post.media.hash)" :poster="post.poster ? mediaUrl(post.poster) : undefined" controls playsinline preload="metadata" />
    <p v-if="post.duet === null" class="feed-note">A duet: the clip it answered is no longer here.</p>
    <button v-if="post.event" type="button" class="feed-embed" @click="emit('event', post.event.id)">
      <small>{{ post.event.phase === 'live' ? 'Happening now' : new Date(post.event.start).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }}</small>
      <b>{{ post.event.title }}</b>
      <small>{{ post.event.place.label }} · {{ post.event.place.cityName }} · {{ post.event.going }} going<template v-if="post.event.me"> · you: {{ post.event.me }}</template></small>
    </button>
    <button v-if="post.gig" type="button" class="feed-embed" @click="emit('gig', post.gig.id)">
      <small>Gig · ₦{{ post.gig.reward.toLocaleString('en-NG') }} in game money</small><b>{{ post.gig.title }}</b><small>{{ post.gig.state }}</small>
    </button>
    <div class="feed-bar">
      <button v-for="r in post.reactions" :key="r.emoji" type="button" :class="{ 'is-mine': r.mine }" :disabled="busy" @click="react(r.emoji)">{{ r.emoji }} {{ r.count }}</button>
      <button type="button" :aria-expanded="picking" aria-label="React" :disabled="busy" @click="picking = !picking">{{ mine ? 'Change' : 'React' }}</button>
      <button v-if="isClip && post.canReply" type="button" data-feed="duet-answer" @click="emit('duet', post)">Duet</button>
      <span class="feed-grow" />
      <button v-if="!full && post.replies > post.thread.length" type="button" @click="emit('open', post.id)">{{ post.replies }} replies</button>
    </div>
    <div v-if="picking" class="feed-bar"><button v-for="e in QUICK" :key="e" type="button" :class="{ 'is-mine': e === mine }" @click="react(e)">{{ e }}</button></div>
    <ul v-if="post.thread.length" class="feed-replies">
      <li v-for="r in post.thread" :key="r.n"><b><button type="button" class="feed-name" @click="emit('person', r.by.id, r.by.name)">{{ r.by.name }}</button><template v-if="r.by.ai"> <span class="ai-tag">AI</span></template></b>{{ r.body }} <small class="feed-note">{{ agoText(r.at, now) }}</small> <button v-if="r.mine || post.mine" type="button" class="feed-name feed-note" @click="dropReply(r.n)">Delete</button><ScamNotice v-if="r.scam && !r.mine" @report="reportScam(r)" /></li>
    </ul>
    <DuetSheet v-if="sharingDuet" :post="post" @close="sharingDuet = false" />
    <form v-if="post.canReply" class="feed-reply" @submit.prevent="send">
      <input v-model="reply" maxlength="280" placeholder="Reply" aria-label="Reply">
      <button type="submit" class="feed-pill" :disabled="busy || !reply.trim()">Send</button>
    </form>
  </article>
</template>
