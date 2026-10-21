<script setup lang="ts">
// My profile (docs/FEED.md): the face and handle other people see in the feed, on /p/@handle and in WhatsApp previews. A handle, a one-line
// bio, a status with the city you are in, a portrait taken from your character in the scene or from a photo, and your friend code.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import './feed.css'
import { computed, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import PlayerAvatar from '../social/PlayerAvatar.vue'
import PostCard from './PostCard.vue'
import ContactsCard from './ContactsCard.vue'
import LocatedCard from './LocatedCard.vue'
import { feedApi, portraitUrl, uploadMedia } from './feedApi.ts'
import { keepBadge } from './badgeMark.ts'
import { portraitFrom, portraitFromScene, stickerFrom } from './feedMedia.ts'
import { shareLink, whatsappUrl } from './feedShare.ts'
import { FEED, badgePlaceText, cleanCode } from '../../../feed/model.ts'
import { canDraw3d, chooseLite, stepInto3d } from '../../state/liteSwitch.ts'
import type { PostView, ProfileView } from '../../../types/feed.ts'

const props = defineProps<{ params?: { code?: string } | null }>()
const { game, shell, scene } = useApp()
const api = feedApi((path, options) => game.fetchJson(path, options))
const profile = ref<ProfileView | null>(null), posts = ref<PostView[]>([])
const onLocated = (p: ProfileView): void => { keepBadge(Boolean(p.located)); if (!profile.value) return; const { located: _old, ...rest } = profile.value; profile.value = p.located ? { ...rest, located: p.located } : rest }
const handle = ref(''), bio = ref(''), status = ref(''), withPlace = ref(true), code = ref(''), busy = ref(false), now = ref(Date.now())
const toast = (text: string, tone?: 'error'): void => game.toast(text, tone === 'error' ? 'error' : 'info')
const link = computed(() => profile.value ? `/p/${profile.value.handle ? `@${profile.value.handle}` : profile.value.id}` : '')
async function load(): Promise<void> {
  const r = await api.me()
  if (!r.ok) { toast(r.reason, 'error'); return }
  profile.value = r.profile; keepBadge(Boolean(r.profile.located)); handle.value = r.profile.handle ?? ''; bio.value = r.profile.bio ?? ''; status.value = r.profile.status?.text ?? ''
  const mine = await api.by(r.profile.id); if (mine.ok) posts.value = mine.posts
}
watch(() => game.view.value.connected, (on, was) => { if (on && !was) void load() })
onMounted(() => { void load(); if (props.params?.code) { code.value = props.params.code; void findByCode() } })
async function saveHandle(): Promise<void> {
  busy.value = true; const r = await api.handle(handle.value); busy.value = false
  if (r.ok) { profile.value = r.profile; toast(`You are @${r.profile.handle}.`) } else toast(r.reason, 'error')
}
async function save(): Promise<void> {
  busy.value = true; const r = await api.editProfile({ bio: bio.value, status: status.value, withPlace: withPlace.value }); busy.value = false
  if (r.ok) { profile.value = r.profile; toast('Saved.') } else toast(r.reason, 'error')
}
async function setOpen(on: boolean): Promise<void> {
  const r = await api.editProfile({ open: on })
  if (r.ok) profile.value = r.profile; else toast(r.reason, 'error')
}
async function portrait(blob: Blob | null): Promise<void> {
  if (!blob) { toast('That picture could not be used.', 'error'); return }
  busy.value = true; const r = await uploadMedia(blob, 'portrait'); busy.value = false
  if (r.ok) { toast('Your portrait is up.'); await load() } else toast(r.reason, 'error')
}
const fromScene = async (): Promise<void> => portrait(await portraitFromScene(() => scene.venue.value?.captureCanvas?.() ?? null))
async function fromFile(event: Event): Promise<void> { const file = (event.target as HTMLInputElement).files?.[0]; (event.target as HTMLInputElement).value = ''; if (file) await portrait(await portraitFrom(file)) }
async function sticker(): Promise<void> {
  if (!profile.value?.portrait) return
  const blob = await stickerFrom(portraitUrl(profile.value.id, profile.value.portrait))
  if (!blob) { toast('The sticker could not be made.', 'error'); return }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'allworld-sticker.webp'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  toast('Saved. Add it to WhatsApp with a sticker maker app.')
}
async function share(): Promise<void> { if ((await shareLink(link.value, `Find me on Allworld${profile.value?.handle ? ` as @${profile.value.handle}` : ''}`)) === 'copied') toast('Link copied.') }
async function findByCode(): Promise<void> {
  const c = cleanCode(code.value)
  if (!c) { toast('A code is six letters.', 'error'); return }
  const r = await api.code(c)
  if (!r.ok) { toast(r.reason, 'error'); return }
  if (r.kind === 'friend' && r.profile) shell.open('person', { player: r.profile.id, name: r.profile.name })
  else if (r.kind === 'crew') shell.open('crews', { code: c })
  else if (r.kind === 'event' && r.event) shell.open('plans', { event: r.event.id })
}
const can3d = canDraw3d()
const lite = document.body.classList.contains('is-lite')
const sceneOn = computed(() => Boolean(scene.venue.value) && !document.body.classList.contains('is-lite'))
</script>

<template>
  <section class="feed" aria-label="My profile" data-feed="me">
    <div v-if="profile" class="feed-card">
      <div class="feed-head">
        <img v-if="profile.portrait" class="feed-portrait is-big" :src="portraitUrl(profile.id, profile.portrait)" alt="Your portrait">
        <PlayerAvatar v-else :name="profile.name" :seed="profile.id" />
        <div class="feed-who"><b>{{ profile.name }}</b><small>{{ profile.handle ? `@${profile.handle}` : 'No handle yet' }}<template v-if="profile.followers"> · {{ profile.followers }}</template><template v-if="profile.located"> · 📍 {{ badgePlaceText(profile.located) }}</template><template v-if="profile.returnee"> · ✈️ {{ profile.returnee }}</template></small></div>
      </div>
      <div class="feed-row" style="margin-top:8px">
        <button v-if="sceneOn" type="button" class="feed-pill" :disabled="busy" @click="fromScene">Portrait from the scene</button>
        <label class="feed-pill">Portrait from a photo<input type="file" accept="image/*" hidden @change="fromFile"></label>
        <button v-if="profile.portrait" type="button" class="feed-pill" @click="sticker">Save as a sticker</button>
      </div>
      <p v-if="sceneOn" class="feed-note">For the scene portrait, stand your character in the middle of the screen.</p>
    </div>

    <form v-if="profile" class="feed-card feed-form" @submit.prevent="saveHandle">
      <label>Handle<input v-model="handle" :maxlength="FEED.handleMax + 1" placeholder="@yourname" autocapitalize="none" spellcheck="false"></label>
      <p class="feed-note">Letters, digits, one dot or underscore. You can change it once a month.</p>
      <button type="submit" class="social-btn" :disabled="busy || !handle.trim() || handle.replace(/^@/, '') === profile.handle">Save handle</button>
    </form>

    <form v-if="profile" class="feed-card feed-form" @submit.prevent="save">
      <label>Bio<input v-model="bio" :maxlength="FEED.bio" placeholder="Jollof first, questions later"></label>
      <label>Status<input v-model="status" :maxlength="FEED.status" placeholder="Open to a game of Whot"></label>
      <label class="feed-row"><input v-model="withPlace" type="checkbox"> Show the city I am in</label>
      <button type="submit" class="social-btn is-primary" :disabled="busy">Save</button>
    </form>

    <div v-if="profile" class="feed-card feed-form">
      <b>Your link and code</b>
      <p class="feed-note">Share your link anywhere. Friends can type your code in their Profile app to find you.</p>
      <div class="feed-row"><span class="feed-crew-chip">Code {{ profile.code }}</span><button type="button" class="feed-pill" @click="share">Share my link</button><a class="feed-pill" :href="whatsappUrl(link, 'Find me on Allworld')" target="_blank" rel="noopener">WhatsApp</a></div>
      <label class="feed-row"><input :checked="profile.canFollowMe" type="checkbox" :disabled="!profile.adult" @change="setOpen(($event.target as HTMLInputElement).checked)"> Let anyone follow my public posts</label>
      <p v-if="!profile.adult" class="feed-note">Following is for players confirmed as 18 or older.</p>
    </div>

    <ContactsCard />

    <LocatedCard v-if="profile" :located="profile.located" @changed="onLocated" />

    <form class="feed-card feed-form" @submit.prevent="findByCode">
      <label>Have a code?<input v-model="code" maxlength="8" placeholder="ABCDEF" autocapitalize="characters"></label>
      <button type="submit" class="social-btn">Find</button>
    </form>

    <div class="feed-card feed-form">
      <b>{{ lite ? 'Allworld Lite is on' : 'Allworld Lite' }}</b>
      <p class="feed-note">{{ lite ? 'You are using Allworld without the 3D world: less data, the same friends, chats, calls and feed.' : 'Use Allworld without the 3D world: less data and battery, the same friends, chats, calls and feed.' }}</p>
      <button v-if="!lite" type="button" class="social-btn" @click="chooseLite">Use Lite on this device</button>
      <button v-else-if="can3d" type="button" class="social-btn" @click="stepInto3d">Go back to the 3D world</button>
    </div>

    <template v-if="profile">
      <b>Your posts</b>
      <p v-if="!posts.length" class="feed-note">Nothing yet. Post from the Feed.</p>
      <PostCard v-for="p in posts" :key="p.id" :post="p" :api="api" :now="now" @changed="(x) => (posts = posts.map((q) => (q.id === x.id ? x : q)))" @removed="(id) => (posts = posts.filter((q) => q.id !== id))" @person="(id, name) => shell.open('person', { player: id, name })" @toast="toast" @share="share" />
    </template>
  </section>
</template>

<style scoped>
.feed .feed-form label.feed-row, .feed .feed-card label.feed-row { display: flex !important; flex-wrap: nowrap; align-items: center; gap: 10px; min-height: var(--tap, 44px); }
.feed input[type='checkbox'] { flex: none; width: 22px; height: 22px; min-width: 22px; margin: 0; padding: 0; border-radius: 6px; accent-color: var(--c-green-dark); }
.feed .feed-row { gap: 8px; }
.feed .feed-pill { min-height: var(--tap, 44px); padding: 0 14px; display: inline-flex; align-items: center; text-decoration: none; }
</style>
