<script setup lang="ts">
// Worlds (docs/WORLDS.md): "your world, your rules". A player makes a world of their own (open ground of a chosen size, surface and sky,
// from a starter: empty, a hangout, a treasure hunt, a race, an obstacle course, an island), walks into it in 3D
// (src/app/features/spaces/WorldScreen.vue) to fill it and give it a script, sends friends its link, lets friends build with them, and
// browses and likes the worlds others opened. The 3D screen is fetched only when a world is entered.
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import '../../../ui/panels/worlds.css'
import { useApp } from '../../state/app.ts'
import { track } from '../world/worldModel.ts'
import { liteGames, myFriends, worldBuilders, worldCoverUrl, worldCreate, worldDelete, worldLike, worldUpdate, worldsList, type WorldCard } from '../spaces/spacesClient.ts'
import { cardLine, emptyForm, formOf, groundChoices, groundForTemplate, groundTint, likeLabel, makeWhy, openChoices, sizeChoices, skyChoices, skyTint, templateChoices, worldUrl, WORLDS, type WorldForm } from './worldsModel.ts'
const WorldScreen = defineAsyncComponent(() => import('../spaces/WorldScreen.vue'))
const PhotoWorldSheet = defineAsyncComponent(() => import('./PhotoWorldSheet.vue'))

type Tab = 'new' | 'popular' | 'friends'
const props = defineProps<{ params?: unknown }>()
const { game } = useApp()
const connected = computed(() => game.view.value.connected)
const on = ref(true)
const mine = ref<WorldCard[]>([])
const others = ref<WorldCard[]>([])
const which = ref<Tab>('new')
const count = ref(0)
const limit = ref<number>(WORLDS.perPlayer)
/** A world may be made from a photo here (docs/WORLDS.md, phase 8), and the sheet for it is open. */
const photoOn = ref(false)
const photo = ref(false)
const loading = ref(true)
const error = ref('')
const note = ref('')
/** The form: making a new world, or changing one of mine. */
const form = ref<WorldForm | null>(null)
const editing = ref<WorldCard | null>(null)
const busy = ref(false)
/** Changing a world: the games it may offer and the friends who may build in it. */
const games = ref<{ id: string; title: string }[]>([])
const friends = ref<{ id: string; name: string }[]>([])
const builders = ref<string[]>([])
/** The world the 3D screen shows. */
const inside = ref<WorldCard | { id: string } | null>(null)
const sizes = sizeChoices(), grounds = groundChoices(), skies = skyChoices(), opens = openChoices(), templates = templateChoices()
const makeOff = computed(() => makeWhy(connected.value, on.value, count.value, limit.value))
const tabs: { id: Tab; label: string }[] = [{ id: 'new', label: 'New' }, { id: 'popular', label: 'Popular' }, { id: 'friends', label: 'Friends' }]

async function refresh(): Promise<void> {
  const [own, rest] = await Promise.all([worldsList(game, 'mine'), worldsList(game, which.value)])
  loading.value = false
  if (!own.ok) { on.value = own.code !== 'worlds_off'; error.value = own.code === 'worlds_off' ? '' : own.reason; return }
  on.value = true
  mine.value = own.worlds; count.value = own.mine; limit.value = own.limit; photoOn.value = own.photo === true
  if (rest.ok) others.value = rest.worlds.filter((w) => !w.mine && !w.builder)
}
onMounted(async () => {
  await refresh()
  // Opened by a world's link: straight in.
  const linked = (props.params as { world?: unknown } | undefined)?.world
  if (typeof linked === 'string') enter({ id: linked }, 'link')
})
watch(which, () => { void refresh() })

function startMaking(): void { photo.value = false; editing.value = null; form.value = emptyForm(); note.value = ''; error.value = '' }
function startPhoto(): void { form.value = null; editing.value = null; photo.value = true; note.value = ''; error.value = '' }
function photoMade(world: WorldCard): void {
  photo.value = false
  track('world_created', { size: world.size, ground: world.ground, open: world.open, template: 'photo' })
  void refresh()
  enter(world, 'mine')
}
async function startEditing(world: WorldCard): Promise<void> {
  editing.value = world; form.value = formOf(world); note.value = ''; error.value = ''
  builders.value = (world.builders ?? []).map((b) => b.id)
  const [g, f] = await Promise.all([liteGames(game), myFriends(game)])
  if (g.ok) games.value = g.games.map((x) => ({ id: x.id, title: x.title }))
  if (f.ok) friends.value = f.friends.map((x) => ({ id: x.id, name: x.name }))
}
function cancel(): void { form.value = null; editing.value = null }
function pickTemplate(id: WorldForm['template']): void { if (!form.value) return; form.value.template = id; form.value.ground = groundForTemplate(id, form.value.ground) }
function toggleBuilder(id: string): void { builders.value = builders.value.includes(id) ? builders.value.filter((b) => b !== id) : [...builders.value, id].slice(0, WORLDS.builders) }
async function submit(): Promise<void> {
  const draft = form.value
  if (!draft || busy.value) return
  busy.value = true; error.value = ''
  const was = editing.value
  const answer = was
    ? await worldUpdate(game, { id: was.id, name: draft.name, blurb: draft.blurb, ground: draft.ground, open: draft.open, sky: draft.sky, game: draft.game })
    : await worldCreate(game, { name: draft.name, blurb: draft.blurb, size: draft.size, ground: draft.ground, open: draft.open, sky: draft.sky, template: draft.template })
  if (answer.ok && was && builders.value.join() !== (was.builders ?? []).map((b) => b.id).join()) {
    const saved = await worldBuilders(game, was.id, builders.value)
    if (!saved.ok) { busy.value = false; error.value = saved.reason; return }
  }
  busy.value = false
  if (!answer.ok) { error.value = answer.reason; return }
  form.value = null; editing.value = null
  await refresh()
  if (!was) { track('world_created', { size: draft.size, ground: draft.ground, open: draft.open, template: draft.template }); enter(answer.world, 'mine') }
  else note.value = 'Saved.'
}
async function remove(world: WorldCard): Promise<void> {
  if (!globalThis.confirm?.(`Delete ${world.name}? Its models stay in My 3D models; where they stood, its script and its cover go.`)) return
  const answer = await worldDelete(game, world.id)
  if (!answer.ok) { error.value = answer.reason; return }
  await refresh()
}
async function like(world: WorldCard): Promise<void> {
  const want = !world.liked
  world.liked = want; world.likes += want ? 1 : -1
  const answer = await worldLike(game, world.id, want)
  if (!answer.ok) { world.liked = !want; world.likes += want ? -1 : 1; error.value = answer.reason; return }
  world.likes = answer.likes
  track('world_liked', { on: want })
}
function enter(world: WorldCard | { id: string }, from: 'mine' | Tab | 'link'): void {
  inside.value = world
  track('world_entered', { mine: 'mine' in world ? world.mine : false, from })
}
async function invite(world: WorldCard): Promise<void> {
  const url = worldUrl(location.origin, world.id)
  try {
    if (typeof navigator.share === 'function') { await navigator.share({ title: `${world.name} on Allworld`, url }); track('world_shared', { channel: 'native' }); return }
  } catch (err) { if ((err as { name?: string }).name === 'AbortError') return }
  try { await navigator.clipboard.writeText(url); note.value = `Link to ${world.name} copied. Send it to a friend.`; track('world_shared', { channel: 'copy' }) } catch { note.value = url }
}
const coverOf = (world: WorldCard): string | null => worldCoverUrl(world)
const tintOf = (world: WorldCard): string => `linear-gradient(${skyTint(world.sky)} 0 40%, ${groundTint(world.ground)} 40% 100%)`
</script>

<template>
  <div class="worlds-app" data-worlds="app">
    <section class="ui-card worlds-hero" data-worlds="hero">
      <small>Worlds</small>
      <strong>Your world, your rules</strong>
      <p>Open ground of your own. Start from a hangout, a treasure hunt or a race, put your 3D models in it, write what happens, and send friends the link. Or walk into a world somebody else made.</p>
      <button type="button" class="ui-button is-primary is-block" data-worlds="make" :disabled="Boolean(makeOff) || form !== null" :title="makeOff ?? undefined" @click="startMaking">Make a world</button>
      <button v-if="photoOn" type="button" class="ui-button is-block worlds-photo-start" data-worlds="photo" :disabled="Boolean(makeOff) || form !== null || photo" :title="makeOff ?? undefined" @click="startPhoto">Walk into a photo</button>
      <p v-if="makeOff && !loading" class="ui-why">{{ makeOff }}</p>
    </section>

    <PhotoWorldSheet v-if="photo" @made="photoMade" @close="photo = false" />

    <section v-if="form" class="ui-card worlds-form" data-worlds="form" :aria-label="editing ? `Change ${editing.name}` : 'Make a world'">
      <h3>{{ editing ? `Change ${editing.name}` : 'A new world' }}</h3>
      <template v-if="!editing">
        <p class="worlds-label">Start from</p>
        <div class="worlds-chips worlds-starters" role="group" aria-label="Start from">
          <button v-for="t in templates" :key="t.id" type="button" class="worlds-chip" :aria-pressed="form.template === t.id" :data-worlds="`template-${t.id}`" @click="pickTemplate(t.id)"><b>{{ t.label }}</b><small>{{ t.line }}</small></button>
        </div>
      </template>
      <label class="worlds-label" for="worlds-name">Name</label>
      <input id="worlds-name" v-model="form.name" class="ui-field" type="text" :maxlength="WORLDS.name" autocomplete="off" placeholder="Ada's park" data-worlds="name" />
      <label class="worlds-label" for="worlds-blurb">What it is <small>optional</small></label>
      <input id="worlds-blurb" v-model="form.blurb" class="ui-field" type="text" :maxlength="WORLDS.blurb" autocomplete="off" placeholder="Bring a ball" />
      <template v-if="!editing">
        <p class="worlds-label">Size <small>cannot change later</small></p>
        <div class="worlds-chips" role="group" aria-label="Size">
          <button v-for="s in sizes" :key="s.id" type="button" class="worlds-chip" :aria-pressed="form.size === s.id" :data-worlds="`size-${s.id}`" @click="form.size = s.id"><b>{{ s.label }}</b><small>{{ s.line }}</small></button>
        </div>
      </template>
      <p class="worlds-label">Ground</p>
      <div class="worlds-chips worlds-grounds" role="group" aria-label="Ground">
        <button v-for="g in grounds" :key="g.id" type="button" class="worlds-chip" :aria-pressed="form.ground === g.id" @click="form.ground = g.id"><i :style="{ background: groundTint(g.id) }" /><b>{{ g.label }}</b></button>
      </div>
      <p class="worlds-label">Sky</p>
      <div class="worlds-chips" role="group" aria-label="Sky">
        <button v-for="s in skies" :key="s.id" type="button" class="worlds-chip" :aria-pressed="form.sky === s.id" :data-worlds="`sky-${s.id}`" @click="form.sky = s.id"><i :style="{ background: skyTint(s.id) }" /><b>{{ s.label }}</b></button>
      </div>
      <p class="worlds-label">Who can come</p>
      <div class="worlds-chips" role="group" aria-label="Who can come">
        <button v-for="o in opens" :key="o.id" type="button" class="worlds-chip" :aria-pressed="form.open === o.id" :data-worlds="`open-${o.id}`" @click="form.open = o.id"><b>{{ o.label }}</b><small>{{ o.line }}</small></button>
      </div>
      <template v-if="editing">
        <label class="worlds-label" for="worlds-game">A game to play here <small>optional</small></label>
        <select id="worlds-game" v-model="form.game" class="ui-field" data-worlds="game">
          <option value="">No game</option>
          <option v-for="g in games" :key="g.id" :value="g.id">{{ g.title }}</option>
        </select>
        <p class="worlds-label">Friends who build with you <small>up to {{ WORLDS.builders }}</small></p>
        <p v-if="!friends.length" class="ui-note">Add friends first; then they can arrange this world with you.</p>
        <div v-else class="worlds-builders" role="group" aria-label="Friends who build with you">
          <button v-for="f in friends" :key="f.id" type="button" class="ui-chip" :aria-pressed="builders.includes(f.id)" :class="{ 'is-good': builders.includes(f.id) }" @click="toggleBuilder(f.id)">{{ f.name }}</button>
        </div>
      </template>
      <div class="worlds-row">
        <button type="button" class="ui-button" @click="cancel">Cancel</button>
        <button type="button" class="ui-button is-primary" data-worlds="submit" :disabled="busy || form.name.trim().length < 2" @click="submit">{{ busy ? '…' : editing ? 'Save' : 'Make it and walk in' }}</button>
      </div>
      <p v-if="error" class="ui-why" role="alert">{{ error }}</p>
    </section>
    <p v-else-if="error" class="ui-why" role="alert">{{ error }}</p>
    <p v-if="note" class="ui-note" role="status">{{ note }}</p>

    <section data-worlds="mine">
      <h3 class="ui-section">My worlds</h3>
      <p v-if="loading" class="ui-note">Loading…</p>
      <p v-else-if="!mine.length" class="ui-note">{{ on ? 'No worlds yet. Make one above: it takes a name and a tap.' : 'Worlds are not switched on here yet.' }}</p>
      <div v-else class="worlds-list">
        <article v-for="w in mine" :key="w.id" class="worlds-card" :data-worlds-card="w.id">
          <button type="button" class="worlds-cover" :aria-label="`Go into ${w.name}`" @click="enter(w, 'mine')">
            <img v-if="coverOf(w)" :src="coverOf(w)!" alt="" loading="lazy" />
            <i v-else :style="{ background: tintOf(w) }" />
            <b>{{ w.name }}</b><small>{{ cardLine(w) }}</small>
            <em v-if="w.likes" class="worlds-likes">♥ {{ w.likes }}</em>
          </button>
          <p v-if="w.blurb" class="worlds-blurb">{{ w.blurb }}</p>
          <div class="worlds-acts" :class="{ 'is-two': !w.mine }">
            <button type="button" class="ui-button is-primary" @click="enter(w, 'mine')">Go in</button>
            <button type="button" class="ui-button" data-worlds="invite" @click="invite(w)">Invite</button>
            <template v-if="w.mine">
              <button type="button" class="ui-button" data-worlds="change" @click="startEditing(w)">Change</button>
              <button type="button" class="ui-button" @click="remove(w)">Delete</button>
            </template>
          </div>
        </article>
      </div>
    </section>

    <section v-if="on" data-worlds="others">
      <h3 class="ui-section">Worlds people made</h3>
      <div class="ui-seg" role="tablist" aria-label="Which worlds">
        <button v-for="t in tabs" :key="t.id" type="button" role="tab" :aria-selected="which === t.id" :data-worlds="`tab-${t.id}`" @click="which = t.id">{{ t.label }}</button>
      </div>
      <p v-if="!others.length && !loading" class="ui-note">{{ which === 'friends' ? 'None of your friends has made a world for friends or everyone yet.' : 'Nobody else has opened a world to everyone yet. Make one and choose “Everyone”: it shows here for all.' }}</p>
      <div v-else class="worlds-list">
        <article v-for="w in others" :key="w.id" class="worlds-card">
          <button type="button" class="worlds-cover" :aria-label="`Go into ${w.name} by ${w.by.name}`" @click="enter(w, which)">
            <img v-if="coverOf(w)" :src="coverOf(w)!" alt="" loading="lazy" />
            <i v-else :style="{ background: tintOf(w) }" />
            <b>{{ w.name }}</b><small>{{ cardLine(w) }}</small>
          </button>
          <div class="worlds-meta">
            <p v-if="w.blurb" class="worlds-blurb">{{ w.blurb }}</p>
            <button type="button" class="worlds-like" :aria-pressed="w.liked" :aria-label="`${w.liked ? 'Unlike' : 'Like'} ${w.name}, ${w.likes} likes`" data-worlds="like" @click="like(w)">{{ likeLabel(w) }}</button>
          </div>
        </article>
      </div>
    </section>

    <WorldScreen v-if="inside" :where="{ target: 'world', id: inside.id }" @close="inside = null; refresh()" @saved="refresh" />
  </div>
</template>
