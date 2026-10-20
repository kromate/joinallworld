<script setup lang="ts">
// Communities (docs/FEED.md, "Communities"): a crew of friends, or your own city, state, estate, campus, club or any community, based on
// a real place of the world map or on one you imagined. Each has a wall only members read, one join link that previews in WhatsApp
// (/c/<code>), moderators, and, once its founder makes it, a 3D world: a group chat whose room is built with AI Spaces (design it by
// describing it, import a Space Plan, your own models, scripts and games), entered by every member through the room's link. A community of
// a real city can also name one of its local governments (its area), and be kept for the people confirmed there: the neighbours.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import './feed.css'
import { computed, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import PlayerAvatar from '../social/PlayerAvatar.vue'
import PostCard from './PostCard.vue'
import EmptyState from '../../ui/EmptyState.vue'
import { feedApi, mediaUrl, uploadMedia } from './feedApi.ts'
import { encodePhoto } from './feedMedia.ts'
import { shareLink, whatsappUrl } from './feedShare.ts'
import { COLOURS, COMMUNITY_KINDS, FEED, LOCAL_SCOPE_LABEL, cleanCode } from '../../../feed/model.ts'
import type { CommunityKind, LocalScope } from '../../../feed/model.ts'
import { cityCatalogue, loadCityRules } from '../../../game/cities/registry.ts'
import { enterByLink, enterRoom } from '../places/placesStore.ts'
import type { CrewView, PostView } from '../../../types/feed.ts'
import { lazyQuiet } from '../../state/lazy.ts'
// The gist board and group trips of a community (docs/SOCIAL-GLUE.md), fetched when a community is opened.
const GluePart = lazyQuiet(() => import('../glue/GluePart.vue'))

const props = defineProps<{ params?: { code?: string; crew?: string } | null }>()
const { game, shell } = useApp()
const api = feedApi((path, options) => game.fetchJson(path, options))
type Tab = 'mine' | 'discover' | 'start'
const tab = ref<Tab>('mine')
const crews = ref<CrewView[]>([]), found = ref<CrewView[]>([]), current = ref<CrewView | null>(null), wall = ref<PostView[]>([]), preview = ref<CrewView | null>(null)
const code = ref(props.params?.code ?? ''), text = ref(''), busy = ref(false), now = ref(Date.now()), kindFilter = ref('')
const form = ref({ name: '', about: '', colour: COLOURS[0]?.id ?? 'gold', kind: 'crew' as CommunityKind, where: 'real' as 'real' | 'imagined' | 'none', city: '', lga: '', placeName: '', open: true, cover: '', locals: '' as '' | LocalScope })
const search = ref('')
/** The chosen city's local units (its local governments), for the optional area of a community; read from the city's rules when chosen. */
const units = ref<{ id: string; name: string }[]>([])
watch(() => form.value.city, async (city) => {
  form.value.lga = ''; units.value = []
  if (form.value.locals === 'lga') form.value.locals = ''
  if (!city) return
  const rules = await loadCityRules(city).catch(() => null)
  if (form.value.city === city) units.value = (rules?.units ?? []).map((u) => ({ id: u.id, name: u.name }))
})
watch(() => form.value.lga, (lga) => { if (!lga && form.value.locals === 'lga') form.value.locals = '' })
type Answer = { ok: boolean; crew?: CrewView; reason?: string }
async function setLocals(value: string): Promise<void> {
  if (!current.value) return
  const r = await send('/api/feed/crews/locals', { id: current.value.id, locals: value || 'all' })
  if (r.ok && r.crew) current.value = r.crew; else game.toast(r.reason ?? 'That did not go through.', 'error')
}
const send = (path: string, body: object): Promise<Answer> => game.fetchJson<Answer>(path, { method: 'POST', body }).catch((e: unknown) => ({ ok: false, reason: (e as { reason?: string }).reason }))
const toast = (t: string, tone?: 'error'): void => game.toast(t, tone === 'error' ? 'error' : 'info')
const hex = (id: string): string => COLOURS.find((c) => c.id === id)?.hex ?? '#d4a017'
const places = computed(() => { const q = search.value.trim().toLowerCase(); return cityCatalogue().filter((c) => !q || c.name.toLowerCase().includes(q) || c.state.name.toLowerCase().includes(q) || (c.countryName ?? '').toLowerCase().includes(q)).slice(0, 40) })
const placeLine = (c: CrewView): string => c.place ? [c.place.name ?? '', c.place.lgaName ?? '', c.place.city ? (cityCatalogue().find((x) => x.id === c.place?.city)?.name ?? '') : '', c.place.state ?? '', c.place.country ?? ''].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ') : ''

async function load(): Promise<void> {
  const r = await api.me()
  if (r.ok) crews.value = r.crews
  if (props.params?.crew) { const c = crews.value.find((x) => x.id === props.params?.crew); if (c) await openCrew(c) }
  if (props.params?.code && !preview.value) await look()
}
async function discover(): Promise<void> {
  const r = await game.fetchJson<{ ok: boolean; communities: CrewView[] }>(`/api/feed/communities?city=${encodeURIComponent(game.view.value.cityId)}${kindFilter.value ? `&kind=${kindFilter.value}` : ''}`).catch(() => null)
  if (r?.ok) found.value = r.communities
}
onMounted(load)
watch(tab, (t) => { if (t === 'discover') void discover() })
watch(kindFilter, () => { void discover() })
watch(() => game.view.value.connected, (on, was) => { if (on && !was) void load() })

async function look(): Promise<void> {
  const c = cleanCode(code.value); if (!c) { toast('A code is six letters.', 'error'); return }
  const r = await api.code(c)
  if (r.ok && r.kind === 'crew' && r.crew) preview.value = r.crew; else toast(r.ok ? 'That code is not a community.' : r.reason, 'error')
}
async function join(byId?: string): Promise<void> {
  busy.value = true
  const r: Answer = byId ? await send('/api/feed/crews/join', { id: byId }) : await api.joinCrew(cleanCode(code.value) ?? '')
  busy.value = false
  if (!r.ok || !r.crew) { toast(r.reason || 'That did not go through.', 'error'); return }
  preview.value = null; code.value = ''; toast(`You joined ${r.crew.name}.`); await load(); await openCrew(r.crew)
}
async function cover(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]; (event.target as HTMLInputElement).value = ''
  if (!file) return
  const blob = await encodePhoto(file); if (!blob) { toast('That photo could not be used.', 'error'); return }
  const r = await uploadMedia(blob, 'post'); if (r.ok) form.value.cover = r.media.hash; else toast(r.reason, 'error')
}
async function create(): Promise<void> {
  const v = form.value
  busy.value = true
  const r = await send('/api/feed/crews', { name: v.name, about: v.about, colour: v.colour, kind: v.kind, open: v.kind !== 'crew' && v.open, ...(v.cover ? { cover: v.cover } : {}), ...(v.kind !== 'crew' && v.where === 'real' && v.city ? { city: v.city, ...(v.lga ? { lga: v.lga } : {}), ...(v.locals ? { locals: v.locals } : {}) } : {}), ...(v.kind !== 'crew' && v.where === 'imagined' && v.placeName ? { placeName: v.placeName } : {}) })
  busy.value = false
  if (!r.ok || !r.crew) { toast(r.reason ?? 'That did not go through.', 'error'); return }
  form.value = { ...form.value, name: '', about: '', placeName: '', cover: '' }
  await load(); await openCrew(r.crew)
  toast(r.crew.kind === 'crew' ? 'Your crew is ready. Share the link.' : 'Your community is ready. Give it its 3D world, then invite people.')
}
async function openCrew(c: CrewView): Promise<void> {
  const again = await api.crew(c.id); current.value = again.ok ? again.crew : c
  const r = await api.crewWall(c.id); wall.value = r.ok ? r.posts : []
  tab.value = 'mine'
}
async function post(): Promise<void> {
  if (!current.value || !text.value.trim()) return
  busy.value = true; const r = await api.post({ body: text.value, vis: 'crew', crew: current.value.id }); busy.value = false
  if (!r.ok) { toast(r.reason, 'error'); return }
  text.value = ''; wall.value = [r.post, ...wall.value]
}
async function leave(member?: string): Promise<void> {
  if (!current.value) return
  if (!confirm(member ? 'Ask them to leave? They cannot rejoin for a week.' : 'Leave this community?')) return
  const r = await api.leaveCrew(current.value.id, member)
  if (!r.ok) { toast(r.reason, 'error'); return }
  if (!member) { current.value = null; await load() } else await openCrew(current.value)
}
async function mod(member: string, on: boolean): Promise<void> {
  if (!current.value) return
  const r = await send('/api/feed/crews/mod', { id: current.value.id, member, on })
  if (r.ok && r.crew) current.value = r.crew; else toast(r.reason ?? 'That did not go through.', 'error')
}
/** The world: a group chat the founder owns (its room is the 3D place), its link switched on, then given to the community. */
async function makeWorld(): Promise<void> {
  const c = current.value; if (!c) return
  busy.value = true
  try {
    const group = await game.fetchJson<{ ok: boolean; conv?: { id: string }; reason?: string }>('/api/social/groups', { method: 'POST', body: { name: c.name.slice(0, 40), members: [], clientId: `${Date.now()}:${crypto.randomUUID()}` } })
    if (!group.ok || !group.conv) { toast(group.reason ?? 'The group could not be made.', 'error'); return }
    const link = await game.fetchJson<{ ok: boolean; reason?: string }>('/api/places/room/link', { method: 'POST', body: { id: group.conv.id, on: true } })
    if (!link.ok) { toast(link.reason ?? 'The world\'s link could not be switched on.', 'error'); return }
    const done = await game.fetchJson<{ ok: boolean; crew?: CrewView; reason?: string }>('/api/feed/crews/world', { method: 'POST', body: { id: c.id, conv: group.conv.id } })
    if (!done.ok || !done.crew) { toast(done.reason ?? 'That did not go through.', 'error'); return }
    current.value = done.crew
    toast('Its world is ready. Open it and use Build → Design with AI, or paste a plan to import one.')
  } catch (e) { toast((e as { reason?: string }).reason ?? 'That did not go through.', 'error') } finally { busy.value = false }
}
async function enterWorld(): Promise<void> {
  const c = current.value; if (!c?.world) return
  // A builder (in the world's group) goes in as a member, who can build; everyone else through the room's link, as a visitor.
  const ok = c.mod && (await enterRoom(c.world.room))
  if (ok) { shell.closeSheet(); return }
  const token = c.world.link?.slice(3)
  if (!token) { toast('Ask the founder to switch the world\'s link on.', 'error'); return }
  const r = await enterByLink(token)
  if (r.ok) shell.closeSheet(); else toast(r.reason, 'error')
}
const link = computed(() => (current.value?.code ? `/c/${current.value.code}` : ''))
async function share(): Promise<void> { if (current.value && (await shareLink(link.value, `Join ${current.value.name} on Allworld`)) === 'copied') toast('Link copied.') }
const big = computed(() => Boolean(current.value && current.value.kind !== 'crew'))
// A community based on a real, open city: "Share place" sends a street card of that city (growth/shareMoment.ts), linking to /visit/<city>.
const sharedCity = computed(() => { const id = current.value?.place?.real ? current.value.place.city : null; return id && cityCatalogue().some((c) => c.id === id && c.open) ? id : null })
function sharePlace(): void { if (sharedCity.value) void import('../growth/shareMoment.ts').then(({ shareStreet }) => { shareStreet({ city: sharedCity.value ?? undefined }, () => { toast('That could not be shared.', 'error') }) }) }
</script>

<template>
  <section class="feed" aria-label="Communities" data-feed="crews">
    <template v-if="current">
      <button type="button" class="feed-pill" @click="current = null">← All communities</button>
      <div class="feed-card">
        <img v-if="current.cover" class="feed-media" :src="mediaUrl(current.cover)" alt="">
        <div class="feed-head"><span class="feed-crew-chip"><i :style="{ background: hex(current.colour) }" />{{ current.name }}</span><span class="feed-note">{{ current.kindLabel }} · {{ current.size }} / {{ current.cap }}{{ current.open ? ' · open to all' : ' · by link' }}</span></div>
        <p v-if="placeLine(current)" class="feed-note">{{ current.place?.real ? 'Based on' : 'An imagined place:' }} {{ placeLine(current) }}</p>
        <p v-if="current.locals" class="feed-note" data-feed="locals">📍 Locals only: people whose device confirmed they are in this {{ current.locals === 'lga' ? 'area' : current.locals }}.<template v-if="!current.mine && !current.qualifies"> Get your location badge in My profile to join.</template></p>
        <label v-if="current.owned && current.place?.real" class="feed-row">Who can join<select :value="current.locals ?? ''" @change="setLocals(($event.target as HTMLSelectElement).value)"><option value="">Anyone</option><option v-if="current.place?.lga" value="lga">Only people confirmed in its area ({{ current.place.lgaName }})</option><option v-if="current.place?.city" value="city">Only people confirmed in its city</option><option value="state">Only people confirmed in its state</option><option value="country">Only people confirmed in its country</option></select></label>
        <button v-if="sharedCity" type="button" class="feed-pill" data-crew-share-place @click="sharePlace">Share place</button>
        <p v-if="current.about" class="feed-body">{{ current.about }}</p>
        <div class="feed-strip" style="margin-top:8px">
          <button v-for="m in current.members" :key="m.id" type="button" class="feed-person" @click="shell.open('person', { player: m.id, name: m.name })">
            <PlayerAvatar :name="m.name" :seed="m.id" /><b>{{ m.name }}</b><small v-if="m.id === current.owner.id">Founder</small><small v-else-if="current.mods.some((x) => x.id === m.id)">Moderator</small><small v-if="m.ai">AI-played</small>
            <span v-if="current.owned && m.id !== current.owner.id && big" class="feed-pill" role="button" @click.stop="mod(m.id, !current.mods.some((x) => x.id === m.id))">{{ current.mods.some((x) => x.id === m.id) ? 'Not mod' : 'Make mod' }}</span>
            <span v-if="current.mod && m.id !== current.owner.id && m.id !== game.view.value.session?.id" class="feed-pill" role="button" @click.stop="leave(m.id)">Remove</span>
          </button>
        </div>
        <p v-if="current.size > current.members.length" class="feed-note">and {{ current.size - current.members.length }} more</p>
        <div class="feed-row" style="margin-top:8px">
          <button type="button" class="social-btn is-primary" @click="share">Invite with the link</button>
          <a class="feed-pill" :href="whatsappUrl(link, `Join ${current.name} on Allworld`)" target="_blank" rel="noopener">WhatsApp</a>
          <button type="button" class="feed-pill" @click="leave()">Leave</button>
        </div>
        <GluePart v-if="current.mine" part="community" :crew="current" />
      </div>

      <div class="feed-card feed-form" data-feed="world">
        <b>Its 3D world</b>
        <template v-if="current.world">
          <p class="feed-note">A place to meet and build together. {{ current.world.builders }} {{ current.world.builders === 1 ? 'builder' : 'builders' }} shape it with AI Spaces: describe it, import a Space Plan, add your own models, scripts and games. Everyone else walks in as a visitor.</p>
          <div class="feed-row"><button type="button" class="social-btn is-primary" :disabled="busy" @click="enterWorld">Enter the world</button><button v-if="current.mod" type="button" class="feed-pill" @click="shell.open('messages')">Its group chat</button></div>
          <p v-if="current.owned" class="feed-note">To let a moderator build, add them to the world's group chat (they must be your friend).</p>
        </template>
        <template v-else-if="current.owned">
          <p class="feed-note">Give {{ current.name }} its own place: a group chat for the builders, and a room everyone can walk into, built in 3D.</p>
          <button type="button" class="social-btn is-primary" :disabled="busy" @click="makeWorld">Create its world and group chat</button>
        </template>
        <p v-else class="feed-note">The founder has not made its world yet.</p>
      </div>

      <form class="feed-card feed-compose" @submit.prevent="post">
        <textarea v-model="text" :maxlength="FEED.body" :placeholder="`Say something to ${current.name}`" aria-label="Post to the community" />
        <button type="submit" class="social-btn is-primary" :disabled="busy || !text.trim()">Post</button>
      </form>
      <p v-if="!wall.length" class="feed-note">The wall is empty. Only members see it.</p>
      <PostCard v-for="p in wall" :key="p.id" :post="p" :api="api" :now="now" @changed="(x) => (wall = wall.map((q) => (q.id === x.id ? x : q)))" @removed="(id) => (wall = wall.filter((q) => q.id !== id))" @person="(id, n) => shell.open('person', { player: id, name: n })" @toast="toast" />
    </template>

    <template v-else>
      <nav class="feed-tabs"><button type="button" :class="{ 'is-on': tab === 'mine' }" @click="tab = 'mine'">Mine</button><button type="button" :class="{ 'is-on': tab === 'discover' }" @click="tab = 'discover'">Discover</button><button type="button" :class="{ 'is-on': tab === 'start' }" @click="tab = 'start'">Start one</button></nav>

      <template v-if="tab === 'mine'">
        <p class="social-note">Your crews and communities: your city, your state, your estate, your campus, your club.</p>
        <ul v-if="crews.length" class="social-list">
          <li v-for="c in crews" :key="c.id" class="social-row">
            <span class="feed-crew-chip"><i :style="{ background: hex(c.colour) }" />{{ c.name }}</span>
            <div><small>{{ c.kindLabel }} · {{ c.size }} member{{ c.size === 1 ? '' : 's' }}{{ c.world ? ' · has a 3D world' : '' }}</small></div>
            <span class="social-actions"><button type="button" class="social-btn" @click="openCrew(c)">Open</button></span>
          </li>
        </ul>
        <EmptyState v-if="!crews.length" icon="people" title="You are not in a community yet" text="Join one with a code, look around your city, or start your own.">
          <span class="feed-row is-centered"><button type="button" class="social-btn is-primary" @click="tab = 'discover'">Find one</button><button type="button" class="social-btn" @click="tab = 'start'">Start one</button></span>
        </EmptyState>
        <form class="feed-card feed-form" @submit.prevent="preview ? join() : look()">
          <b>Join with a code</b>
          <label>Code<input v-model="code" maxlength="8" placeholder="ABCDEF" autocapitalize="characters"></label>
          <div v-if="preview" class="feed-embed"><b>{{ preview.name }}</b><small>{{ preview.kindLabel }} · {{ preview.size }} members · founded by {{ preview.owner.name }}</small><small v-if="preview.about">{{ preview.about }}</small></div>
          <button type="submit" class="social-btn is-primary" :disabled="busy || !code.trim()">{{ preview ? `Join ${preview.name}` : 'Look it up' }}</button>
        </form>
      </template>

      <template v-else-if="tab === 'discover'">
        <p class="social-note">Communities around your city that anyone can join.</p>
        <select v-model="kindFilter" aria-label="Kind"><option value="">Every kind</option><option v-for="[id, label] in COMMUNITY_KINDS.filter(([k]) => k !== 'crew')" :key="id" :value="id">{{ label }}</option></select>
        <EmptyState v-if="!found.length" icon="people" title="None here yet" text="Be the first: start one for your city, estate or club.">
          <button type="button" class="social-btn is-primary" @click="tab = 'start'">Start one</button>
        </EmptyState>
        <div v-for="c in found" :key="c.id" class="feed-card">
          <div class="feed-head"><div class="feed-who"><b>{{ c.name }}</b><small>{{ c.kindLabel }}<template v-if="placeLine(c)"> · {{ placeLine(c) }}</template> · {{ c.size }} members{{ c.world ? ' · 3D world' : '' }}</small></div>
            <button v-if="!c.mine" type="button" class="social-btn is-primary" :disabled="busy" @click="join(c.id)">Join</button><button v-else type="button" class="social-btn" @click="openCrew(c)">Open</button></div>
          <p v-if="c.about" class="feed-body">{{ c.about }}</p>
        </div>
      </template>

      <form v-else class="feed-card feed-form" @submit.prevent="create">
        <b>Start a community</b>
        <label>What is it<select v-model="form.kind"><option v-for="[id, label] in COMMUNITY_KINDS" :key="id" :value="id">{{ label }}</option></select></label>
        <label>Name<input v-model="form.name" :maxlength="FEED.crew.nameMax" :placeholder="form.kind === 'crew' ? 'Yaba Ballers' : form.kind === 'city' ? 'Ikeja Peeps' : form.kind === 'state' ? 'Oyo Connect' : 'Name it'"></label>
        <label>About<input v-model="form.about" :maxlength="FEED.crew.about" placeholder="What brings people together"></label>
        <template v-if="form.kind !== 'crew'">
          <div class="feed-row"><label class="feed-row"><input v-model="form.where" type="radio" value="real"> A real place</label><label class="feed-row"><input v-model="form.where" type="radio" value="imagined"> A place I imagine</label><label class="feed-row"><input v-model="form.where" type="radio" value="none"> No place</label></div>
          <template v-if="form.where === 'real'">
            <label>Find the city<input v-model="search" placeholder="Ibadan, Accra, Nairobi, London…"></label>
            <select v-model="form.city" aria-label="City"><option value="">Choose…</option><option v-for="c in places" :key="c.id" :value="c.id">{{ c.name }}, {{ c.state.name }}{{ c.countryName ? `, ${c.countryName}` : '' }}</option></select>
            <label v-if="form.city && units.length">Its area (optional)<select v-model="form.lga"><option value="">The whole city</option><option v-for="u in units" :key="u.id" :value="u.id">{{ u.name }}</option></select></label>
            <label v-if="form.city">Who can join<select v-model="form.locals"><option value="">Anyone</option><option v-if="form.lga" value="lga">{{ LOCAL_SCOPE_LABEL.lga }}</option><option value="city">{{ LOCAL_SCOPE_LABEL.city }}</option><option value="state">{{ LOCAL_SCOPE_LABEL.state }}</option><option value="country">{{ LOCAL_SCOPE_LABEL.country }}</option></select></label>
            <p v-if="form.locals" class="feed-note">People need a location badge (My profile → Location badge): their phone checks where they are, and the position is never sent. You need one in that place too.</p>
          </template>
          <label v-else-if="form.where === 'imagined'">Its name<input v-model="form.placeName" maxlength="40" placeholder="New Eko City"></label>
          <label class="feed-row"><input v-model="form.open" type="checkbox"> Anyone can find and join it (otherwise by link only)</label>
          <label class="feed-pill">{{ form.cover ? 'Change the cover' : 'Add a cover photo' }}<input type="file" accept="image/*" hidden @change="cover"></label>
        </template>
        <label>Colour<select v-model="form.colour"><option v-for="c in COLOURS" :key="c.id" :value="c.id">{{ c.label }}</option></select></label>
        <p class="feed-note">{{ form.kind === 'crew' ? `A crew holds ${FEED.crew.size} friends.` : `A community holds up to ${FEED.community.size} members. You can give it a 3D world and a group chat next.` }}</p>
        <p v-if="form.name.trim().length < FEED.crew.nameMin" class="feed-note">Give it a name to start it.</p>
        <button type="submit" class="social-btn is-primary" :disabled="busy || form.name.trim().length < FEED.crew.nameMin">Start it</button>
      </form>
    </template>
  </section>
</template>

<style scoped>
.feed .feed-pill { min-height: var(--tap, 44px); padding: 0 14px; display: inline-flex; align-items: center; text-decoration: none; }
.feed input[type='checkbox'], .feed input[type='radio'] { flex: none; width: 22px; height: 22px; min-width: 22px; padding: 0; margin: 0; accent-color: var(--c-green-dark); }
.feed .feed-form label.feed-row, .feed .feed-card label.feed-row { display: flex !important; flex-wrap: nowrap; align-items: center; gap: 10px; min-height: var(--tap, 44px); }
.feed .feed-row.is-centered { justify-content: center; }
.feed .social-list { padding: 0; list-style: none; }
.feed .social-row > .feed-crew-chip { flex: none; }
</style>
