<script setup lang="ts">
// Artist premieres (docs/ALLWORLD-HOUSE.md "Artist premieres"): approved artists' premieres (the front row, tickets through Earn, the
// world whose screen plays the track), the application form for an unsigned artist (a YouTube link, nothing uploaded; an admin approves
// before the name shows anywhere), and for an approved artist, turning one of their Plans events into a premiere.
import { computed, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { applyArtist, cancelPremiere, loadPremieres, schedulePremiere, watch } from './watchStore.ts'
import { shareGist } from '../growth/shareMoment.ts'
import { PREMIERE } from '../../../watch/premiere.ts'
import type { PremiereView } from '../../../types/watch.ts'
import { isPlayApp } from '../../playMode.ts'

const { game, shell } = useApp()
const playApp = isPlayApp()
onMounted(() => { void loadPremieres(true) })
const data = computed(() => watch.premieres)
const artist = computed(() => data.value?.artist ?? null)
const form = ref({ name: '', about: '', links: '', track: '' })
const plan = ref({ event: '', world: '' })
const problem = ref<string | null>(null)
const when = (at: number): string => new Date(at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const naira = (n: number): string => `₦${n.toLocaleString('en-NG')}`
async function apply(): Promise<void> {
  problem.value = await applyArtist({ name: form.value.name, about: form.value.about, links: form.value.links.split(/\s+/).filter(Boolean).slice(0, PREMIERE.links), track: form.value.track })
  if (!problem.value) game.toast('Sent. An admin will look at it; your name shows nowhere until then.', 'good')
}
async function schedule(): Promise<void> {
  problem.value = await schedulePremiere(plan.value.event, plan.value.world.trim())
  if (!problem.value) game.toast('Your premiere is on. Share it with your fans.', 'good')
}
async function cancel(item: PremiereView): Promise<void> { problem.value = await cancelPremiere(item.id) }
const openWorld = (id: string): void => { shell.open('worlds', { world: id }) }
const openEvent = (id: string): void => { shell.open('plans', { event: id }) }
const fail = (): void => game.toast('That could not be shared. Try again.', 'error')
</script>

<template>
  <div class="watch-part" data-watch="premieres">
    <p class="social-note">New music, heard together. An artist drops a song in a world; fans listen at the same moment<template v-if="!playApp">; the front row is the first {{ PREMIERE.frontRow }} with a ticket</template>.</p>
    <p v-if="problem" class="ui-error" role="alert">{{ problem }}</p>
    <p v-if="!data" class="social-note">Loading…</p>
    <template v-else>
      <p v-if="!data.premieres.length" class="social-note">No premieres are coming up.</p>
      <article v-for="item in data.premieres" :key="item.id" class="watch-card" :data-watch-premiere="item.id">
        <header><strong>{{ item.artist }} · “{{ item.title }}”</strong><small>{{ item.phase === 'live' ? 'On now' : item.phase === 'over' ? 'Over' : when(item.start) }}</small></header>
        <p class="social-note">{{ item.place }} · {{ item.going }} going<template v-if="!playApp"> · {{ item.price ? `tickets ${naira(item.price)} (paid to the artist)` : 'free' }}</template></p>
        <p v-if="item.front.length" class="social-note">Front row: {{ item.front.join(', ') }}</p>
        <p v-if="item.me?.front" class="social-note" data-watch="front">You are in the front row.</p>
        <div class="watch-row">
          <button v-if="item.world && item.phase !== 'over'" type="button" class="ui-button is-primary" data-watch="open-world" @click="openWorld(item.world)">{{ item.phase === 'live' ? 'Go in and listen' : 'See the world' }}</button>
          <button v-if="!item.me?.artist && !item.me?.going && item.phase !== 'over' && (!playApp || !item.price)" type="button" class="ui-button" data-watch="ticket" @click="openEvent(item.event)">{{ item.price ? 'Get a ticket' : 'Say you are going' }}</button>
          <button v-if="item.line" type="button" class="social-btn" @click="shareGist(item.line, fail)">Share</button>
          <button v-if="item.me?.artist && item.phase === 'upcoming'" type="button" class="social-btn" @click="cancel(item)">Call it off</button>
        </div>
      </article>

      <section class="watch-card" aria-label="For artists">
        <header><strong>For artists</strong></header>
        <template v-if="artist?.status === 'approved'">
          <p class="social-note">You are approved as <b>{{ artist.name }}</b>. Make an event in Plans<template v-if="!playApp"> (set a ticket price there if you like, through Earn)</template>, then turn it into your premiere. Put a world with a screen on it, and your track plays for everyone inside.</p>
          <label class="social-note" for="watch-event">Your event</label>
          <select id="watch-event" v-model="plan.event" class="watch-input">
            <option value="">Choose one of your events…</option>
            <option v-for="event in data.events" :key="event.id" :value="event.id">{{ event.title }} · {{ when(event.start) }}</option>
          </select>
          <label class="social-note" for="watch-world">Your world's id (optional, from its link /w/…)</label>
          <input id="watch-world" v-model="plan.world" class="watch-input" autocomplete="off" placeholder="w…">
          <button type="button" class="ui-button is-primary" data-watch="schedule" :disabled="watch.busy || !plan.event" @click="schedule">Make it my premiere</button>
        </template>
        <template v-else>
          <p v-if="artist?.status === 'pending'" class="social-note" data-watch="pending">Your application as “{{ artist.name }}” is with the admins.</p>
          <p v-else-if="artist?.status === 'declined'" class="social-note">Not this time{{ artist.reason ? `: ${artist.reason}` : '' }}. You can apply again a week after the answer.</p>
          <p class="social-note">Unsigned artists: apply with your name, your links and one track as a YouTube or YouTube Music link. Nothing is uploaded. An admin approves; until then your name is shown nowhere.</p>
          <input v-model="form.name" class="watch-input" :maxlength="PREMIERE.name[1]" placeholder="Artist name" aria-label="Artist name" autocomplete="off">
          <textarea v-model="form.about" class="watch-input" :maxlength="PREMIERE.about" rows="2" placeholder="A few words about your music" aria-label="About you" />
          <input v-model="form.links" class="watch-input" placeholder="Links (https://…), separated by spaces" aria-label="Your links" autocomplete="off">
          <input v-model="form.track" class="watch-input" inputmode="url" placeholder="Your track: https://youtu.be/…" aria-label="Your track's YouTube link" autocomplete="off">
          <button type="button" class="ui-button is-primary" data-watch="apply" :disabled="watch.busy || !form.name.trim() || !form.track.trim()" @click="apply">{{ artist?.status === 'pending' ? 'Update my application' : 'Apply' }}</button>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.watch-part { display: grid; gap: 10px; }
.watch-card { display: grid; gap: 6px; padding: 10px 12px; border: 1px solid var(--c-line, #ddd); border-radius: var(--r-sm, 10px); background: var(--c-fill, #f7f7f7); }
.watch-card header { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.watch-card header small { color: var(--c-ink-2, #666); font-size: 12px; }
.watch-row { display: flex; flex-wrap: wrap; gap: 6px; }
.watch-input { box-sizing: border-box; width: 100%; min-height: 44px; padding: 8px 12px; border: 1px solid var(--c-line, #d8d8d8); border-radius: 10px; font: 400 16px var(--font, sans-serif); }
</style>
