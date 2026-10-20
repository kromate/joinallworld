<script setup lang="ts">
// Talks (docs/SOCIAL-GLUE.md "Stage rooms"), the third side of Plans: hosted talks on Phase 2's stage. Plan one (an adult: a title, a
// time, a length, up to five friends as speakers, and where: the Square, the place you stand in, or a community's world), ask to be
// reminded, and when it is time the host opens the stage where they stand. The stage itself (hands, the question queue, the moderator's
// buttons) is the world events' StagePanel. There is no recording: the voice never reaches the server.
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { social } from '../social/useSocial.ts'
import { enterRoom, enterSquare } from '../places/placesStore.ts'
import { GLUE } from '../../../glue/model.ts'
import { SQUARE_ROOM } from '../../../places/model.ts'
import type { TalkView, TalksView } from '../../../types/glue.ts'
import { glue, glueCall } from './glueStore.ts'
// The stage is shown through the place view of the world events (its stage only, outside the Square): the chunk the places already load.
const PlaceLive = defineAsyncComponent(() => import('../world-events/PlaceLive.vue'))

const { game, shell } = useApp()
const talks = ref<TalkView[]>([]), rooms = ref<TalksView['rooms']>([]), problem = ref<string | null>(null), busy = ref(false), making = ref(false), stageOf = ref<string | null>(null)
const soon = new Date(game.serverNow() + 60 * 60000)
const local = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:00`
const form = ref({ title: '', about: '', when: local(soon), minutes: 60 as number, room: SQUARE_ROOM, speakers: [] as string[] })
const friends = computed(() => social.me?.friends ?? [])
async function load(): Promise<void> {
  const r = await glueCall<TalksView>('/api/glue/talks')
  if (r.ok) { talks.value = r.talks; rooms.value = r.rooms; if (!rooms.value.some((x) => x.room === form.value.room)) form.value.room = rooms.value[0]?.room ?? SQUARE_ROOM } else problem.value = r.reason
}
onMounted(load)
watch(() => glue.rev.talk, load)
const when = (t: TalkView): string => new Date(t.start).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
const phaseWord: Record<TalkView['phase'], string> = { soon: 'Coming up', open: 'Starting soon', live: 'Live now', over: 'Over' }
async function act(path: string, body: Record<string, unknown>, done?: string): Promise<boolean> {
  busy.value = true; problem.value = null
  const r = await glueCall<{ talk?: TalkView }>(path, body)
  busy.value = false
  if (!r.ok) { problem.value = r.reason; return false }
  if (done) game.toast(done)
  await load()
  return true
}
async function create(): Promise<void> {
  const start = new Date(form.value.when).getTime()
  if (await act('/api/glue/talks', { title: form.value.title, about: form.value.about, start, minutes: form.value.minutes, room: form.value.room, speakers: form.value.speakers }, 'Talk planned. People can ask to be reminded.')) { making.value = false; form.value.title = ''; form.value.about = '' }
}
async function open(t: TalkView): Promise<void> { if (await act('/api/glue/talks/open', { id: t.id }, 'The stage is open.')) stageOf.value = t.room }
/** Take the person to where the talk is: the Square, a community's room, or the map for a venue. */
async function goTo(t: TalkView): Promise<void> {
  if (t.room === SQUARE_ROOM) { await enterSquare(); return }
  const room = /^world:room:(g\.\d+)$/.exec(t.room)?.[1]
  if (room) { await enterRoom(room); return }
  shell.open('map')
}
</script>

<template>
  <section class="glue-talks" data-glue="talks" aria-label="Talks">
    <p class="feed-note">Hosted talks: speakers on a stage, the audience raises hands and asks questions. Voice is live only; nothing is recorded.</p>
    <button v-if="!making" type="button" class="social-btn is-primary" @click="making = true">Host a talk</button>
    <form v-else class="feed-card feed-form" data-glue="talk-form" @submit.prevent="create">
      <input v-model="form.title" :maxlength="GLUE.talk.titleMax" placeholder="What is the talk about?" aria-label="Title">
      <textarea v-model="form.about" :maxlength="GLUE.talk.aboutMax" placeholder="A line about it (optional)" aria-label="About" />
      <label class="feed-row">When <input v-model="form.when" type="datetime-local" aria-label="When"></label>
      <label class="feed-row">How long <select v-model.number="form.minutes"><option v-for="m in GLUE.talk.minutes" :key="m" :value="m">{{ m }} minutes</option></select></label>
      <label class="feed-row">Where <select v-model="form.room"><option v-for="r in rooms" :key="r.room" :value="r.room">{{ r.label }}</option></select></label>
      <label class="feed-row">Speakers (friends, up to {{ GLUE.talk.speakers }})
        <select v-model="form.speakers" multiple :size="Math.min(5, Math.max(2, friends.length))"><option v-for="f in friends" :key="f.id" :value="f.id">{{ f.name }}</option></select>
      </label>
      <div class="feed-row"><button type="submit" class="social-btn is-primary" :disabled="busy || form.title.trim().length < GLUE.talk.titleMin">Plan it</button><button type="button" class="feed-pill" @click="making = false">Cancel</button></div>
      <p class="feed-note">To host at a venue, stand in it first. Everyone who asks is reminded half an hour before.</p>
    </form>
    <p v-if="problem" class="social-note" role="alert">{{ problem }}</p>
    <p v-if="!talks.length" class="feed-note">No talks coming up. Host the first one.</p>
    <article v-for="t in talks" :key="t.id" class="feed-card" :data-talk-phase="t.phase">
      <small class="feed-note">{{ phaseWord[t.phase] }} · {{ when(t) }} · {{ t.place }}</small>
      <b>{{ t.title.replace(/^Talk: /, '') }}</b>
      <p v-if="t.about" class="feed-body">{{ t.about }}</p>
      <p class="feed-note">Host {{ t.host.name }}<template v-if="t.speakers.length"> · with {{ t.speakers.map((s) => s.name).join(', ') }}</template> · {{ t.going }} coming</p>
      <div class="feed-row">
        <button v-if="!t.mine" type="button" class="social-btn" :class="{ 'is-primary': !t.reminded }" :disabled="busy" @click="act('/api/glue/talks/remind', { id: t.id, on: !t.reminded }, t.reminded ? undefined : 'We will remind you.')">{{ t.reminded ? 'Reminded ✓' : 'Remind me' }}</button>
        <button v-if="t.canOpen" type="button" class="social-btn is-primary" :disabled="busy" @click="open(t)">Open the stage</button>
        <button v-else-if="t.mine && t.phase === 'open'" type="button" class="social-btn" @click="goTo(t)">Go to {{ t.place }} to open it</button>
        <button v-if="t.phase === 'live'" type="button" class="social-btn is-primary" @click="goTo(t); stageOf = t.room">Join</button>
        <button v-if="t.mine && t.phase !== 'live'" type="button" class="feed-pill" :disabled="busy" @click="act('/api/glue/talks/cancel', { id: t.id }, 'Talk called off.')">Call off</button>
      </div>
      <PlaceLive v-if="stageOf === t.room && t.phase === 'live'" :room="t.room" :square="false" />
    </article>
  </section>
</template>

<style scoped>
.glue-talks { display: grid; gap: 10px; min-width: 0; overflow-wrap: anywhere; }
</style>
