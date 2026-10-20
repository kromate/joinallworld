<script setup lang="ts">
// THE ENTRY PAGE — what a first-time visitor sees before the character creator: the world behind, and one compact card (a bottom
// sheet on a phone). "Play now" is the one-tap guest start (a random look, a suggested name: entryPlay.ts); "Sign up free" and
// "Log in" are the existing sheets; "Make my character first" opens the creator, unchanged. The backdrop is a pre-rendered picture
// of the game's own scenes, asked for after the first paint (nothing 3D is loaded here); the live count is the public
// GET /api/world/pulse/online. Returning players never reach this: the quick-start gate only opens for a device with no life.
// A street or a visit (/street/<city>/<place>, /visit/<city>) names its place on the card, and behind it the dive goes down to that place
// (streetEntry.ts, fetched after the first paint with the maps); "Find my street" sets where it goes. Play never waits on the dive.
import '../../../ui/panels/fullscreen.css'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { CITY_WORLD_FIGURES } from '../../../game/cities/catalogue.ts'
import { loadCityContent, loadCityNetwork } from '../../../game/cities/registry.ts'
import { qs } from './quickStartState.ts'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import BonusLine from '../bonus/BonusLine.vue'
import { invitedWords, inviterName } from '../growth/inviterLookup.ts'
import { useAccountEntry } from './accountEntry.ts'
import AgentSheet from './AgentSheet.vue'
import { ENTRY_VARIANTS, placeWords, variantOf, withFigures, withPlace } from '../../../entry-variants.ts'
import type { EntryAction } from '../../../entry-variants.ts'
import { SETUP_NEEDS, SETUP_STEPS, SOURCE_URL, liveLine } from './entryModel.ts'
import { loadCreatorApp } from './loadCreator.ts'
import { invitedNow, playFromEntry } from './entryPlay.ts'
import { cleanAddress, store } from '../../../quick-start/entry.ts'
import { firstLanding, pendingRef, track } from './startBoundary.ts'
import type { CityFind } from './findCity.ts'
import type { StreetTarget } from './streetEntry.ts'
import type { EntryDive } from '../../../map3d/entry-dive.ts'

const props = defineProps<{ path?: string }>()
const emit = defineEmits<{ creator: [] }>()
const { game, shell } = useApp()
const view = game.view
const account = useAccountEntry('entry')
// The figures are generated with the startup index: the entry page never waits for the world network.
const figures = CITY_WORLD_FIGURES
const online = ref<number | null>(null)
const line = computed(() => liveLine(online.value, figures))
const address = props.path ?? globalThis.location?.pathname ?? '/'
const variant = variantOf(address) ?? ENTRY_VARIANTS[0]!
const isHome = variant.id === 'home'
/** The street the card names and the dive goes down to: the address's (once its names are read), or the one "Find my street" found. */
const street = ref<StreetTarget | null>(null)
const chosen = ref(false)
const words = (text: string, place: string | undefined): string => (place && street.value ? withPlace(place, { city: street.value.cityName, name: street.value.place?.name ?? null }) : withFigures(text, figures))
// A visit to Lagos, Accra or Abuja reads "Detty December in Lagos" from 1 to 31 December (src/entry-variants.ts placeWords, by the date).
const placed = computed(() => placeWords(variant, street.value && !street.value.place ? street.value.city : null, Date.now()))
const headline = computed(() => words(variant.headline, placed.value?.headline))
const pitch = computed(() => words(variant.pitch, placed.value?.pitch))
const findLabel = variant.secondary.find((item) => item.kind === 'find')?.label ?? 'Find my city'
const setup = variant.primary.kind === 'setup'
const invited = invitedNow()
const inviter = ref<string | null>(null)
const invitedNote = computed(() => invitedWords(inviter.value))
const sending = ref(false)
const agentOpen = ref(false)
const art = ref('')
const finding = ref(false)
const found = ref<CityFind | null>(null)
const root = ref<HTMLElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const starting = ref(false)
let poll: ReturnType<typeof setInterval> | null = null
let backdrop: EntryDive | null = null, left = false, launching = false

/** What the address asked for (My shop, the Games app, the map) is kept for the life that is about to exist; the page's other buttons leave it. */
function armPaths(): void { if (!isHome) void import('../paths/arrive.ts').then((module) => { module.startPaths() }, () => undefined) }
function play(city: string | null = null, withAddress = true): void {
  if (sending.value) return
  if (withAddress) armPaths(); else if (!isHome) cleanAddress()
  sending.value = playFromEntry({ shell, viewName: view.value.name }, city)
}
/** Play on a street: the city's content (asked for when the card learnt the street) first, then the life starts there; never the dive. */
async function playStreet(target: StreetTarget, found: boolean): Promise<void> {
  if (sending.value || starting.value) return
  starting.value = true
  const module = await import('./streetEntry.ts')
  const ok = await module.cityReady(target.city)
  if (found) await module.keepStreet(target).catch(() => undefined)
  starting.value = false
  play(ok ? target.city : null, !found)
}
function act(action: EntryAction): void {
  if (action.kind === 'play' && action === variant.primary && variant.place && street.value) void playStreet(street.value, chosen.value)
  else if (action.kind === 'play') play(null, action === variant.primary)
  else if (action.kind === 'setup') play()
  else if (action.kind === 'browse') { store.write(store.KEYS.go, { go: 'shop', at: Date.now(), shop: null }); play(null, false) }
  else if (action.kind === 'agent') openAgent()
  else void find()
}
function signUp(): void { armPaths(); account.openSignUp() }
function logIn(): void { armPaths(); account.openSignIn() }
async function startIn(city: string): Promise<void> {
  // The kept address is read against the world city network (src/paths.ts), so it is in before the landing is marked.
  try { await Promise.all([loadCityContent(city), loadCityNetwork()]); (await import('../paths/intent.ts')).markLanding() } catch { play(null); return }
  play(city)
}
async function find(): Promise<void> {
  finding.value = true
  try {
    const answer = await (await import('./streetEntry.ts')).findStreet()
    found.value = answer.found
    // Worked out on this device: the dive goes there, and Play starts there. Nothing is sent until then.
    if (answer.target && (variant.place || answer.target.place)) { street.value = answer.target; chosen.value = true; void goDown(answer.target) }
  } finally { finding.value = false }
}
/** "Start in …" under the line Find my street wrote: on a street it found, Play there; otherwise the city, as before. */
function startFound(city: string): void { if (chosen.value && street.value) void playStreet(street.value, true); else void startIn(city) }
const foundLine = computed(() => (chosen.value && street.value?.place && found.value?.kind === 'in' ? `You are in ${street.value.place.name}, ${street.value.cityName} — start there?` : found.value?.line ?? ''))
/** The dive behind the card goes to `target`: started the first time (once the card has drawn), moved after; one on its way takes the latest street when it lands. */
async function goDown(target: StreetTarget): Promise<void> {
  const module = await import('./streetEntry.ts')
  void module.cityReady(target.city)
  const aim = (): void => { if (street.value) backdrop?.retarget({ city: street.value.city, name: module.targetName(street.value) }) }
  if (backdrop) { aim(); return }
  if (!stage.value || launching) return
  launching = true
  const started = await module.startBackdrop(stage.value, target)
  launching = false
  if (left) { started?.destroy(); return }
  backdrop = started
  aim()
}
/** The address names a street or a visit: its names are read (with the city's rules), then the dive starts. */
async function readStreet(): Promise<void> {
  const target = await (await import('./streetEntry.ts')).streetOf(address).catch(() => null)
  if (!target || left || chosen.value) return
  street.value = target
  void goDown(target)
}
/** The creator's code is asked for when the visitor shows interest in it, so it is ready by the time the link is pressed. */
function warmCreator(): void {
  void loadCreatorApp().catch(() => undefined)
  void import('./lookPreview.ts').then((module) => module.warmLookPreview()).catch(() => undefined)
}
const opening = ref(false)
/** The creator's code arrives first, so the page is replaced at once and never by a blank; the button says so meanwhile. */
async function openCreator(): Promise<void> {
  if (opening.value) return
  opening.value = true
  armPaths()
  try { await loadCreatorApp() } catch { /* the creator's own loader asks again */ }
  emit('creator')
}
function openAgent(): void { agentOpen.value = true }
/** A card of the agent sheet: the game starts as for Play now, and Settings opens at the AI agents section once it is up. */
function chooseAgent(id: 'mine' | 'own'): void {
  agentOpen.value = false
  void import('../agents/claimEntry.ts').then((module) => { module.wantAgentSetup(id) }, () => undefined)
  play(null, false)
}

async function loadOnline(): Promise<void> {
  if (document.visibilityState === 'hidden') return
  try {
    const answer = await game.fetchJson<{ online?: unknown }>('/api/world/pulse/online')
    online.value = typeof answer.online === 'number' && answer.online > 0 ? Math.floor(answer.online) : null
  } catch { /* no number is shown: the pill still says what is open */ }
}
/** The backdrop: one of two pictures, asked for once the card is on screen, and faded in when it has arrived. */
function loadArt(): void {
  const wide = globalThis.matchMedia?.('(min-width: 700px)').matches !== false
  const image = new Image()
  image.onload = () => { art.value = image.src }
  image.src = wide ? '/icons/entry-wide.webp' : '/icons/entry-tall.webp'
}

onMounted(() => {
  // Once per device, as in the creator: a reload of the same landing is not another one.
  if (!qs.landed) { qs.landed = true; if (!(view.value.onboarding?.required && view.value.connected) && firstLanding()) track('landed', { join: invited }) }
  const code = pendingRef()
  if (code) void inviterName(game.fetchJson, code).then((name) => { inviter.value = name })
  void loadOnline()
  poll = setInterval(() => { void loadOnline() }, 30000)
  requestAnimationFrame(() => { setTimeout(loadArt, 0); if (variant.place) setTimeout(() => { void readStreet() }, 0) })
  if (variant.id === 'agents') agentOpen.value = true
  root.value?.querySelector<HTMLElement>('[data-entry-title]')?.focus({ preventScroll: true })
})
onBeforeUnmount(() => { if (poll !== null) clearInterval(poll); left = true; backdrop?.destroy(); backdrop = null })
</script>

<template>
  <div ref="root" class="en-root" data-entry>
    <div class="en-backdrop" aria-hidden="true"><div class="en-art" :class="{ 'is-on': art }" :style="art ? { backgroundImage: `url(${art})` } : undefined" /><div ref="stage" class="en-stage" inert data-entry-stage /></div>
    <main class="en-card" aria-labelledby="en-title" :inert="agentOpen" :data-variant="variant.id">
      <img v-if="variant.image" class="en-shot" :src="variant.image" width="640" height="280" loading="lazy" decoding="async" :alt="variant.title" data-entry-shot>
      <p class="en-brand"><i aria-hidden="true"><GameIcon name="globe" :size="22" /></i><b>Allworld</b></p>
      <p class="en-live" role="status" data-entry-live><i class="en-dot" :class="{ 'is-live': online !== null }" aria-hidden="true" /><span>{{ line }}</span></p>
      <h1 id="en-title" tabindex="-1" data-entry-title>{{ headline }}</h1>
      <p v-if="variant.place && street" class="en-place" data-entry-place><i aria-hidden="true"><GameIcon name="pin" :size="16" /></i>{{ street.place ? `${street.place.name}, ${street.cityName}` : street.cityName }}</p>
      <p class="en-pitch">{{ pitch }}</p>
      <ol v-if="setup" class="en-steps" aria-label="How it works" data-entry-steps><li v-for="step in SETUP_STEPS" :key="step">{{ step }}</li></ol>
      <p v-if="invited && !variant.place" class="en-invite" role="status" data-entry-invite><strong>{{ invitedNote.title }}</strong> {{ inviter ? `Tap Play now and you land where ${inviter} is.` : 'Tap Play now and you land where they are.' }}</p>

      <div class="en-actions">
        <button type="button" class="en-btn is-primary" data-qs="play" data-key="play-now" data-entry-play :disabled="sending || starting" @click="act(variant.primary)">{{ sending || starting ? 'Starting…' : variant.primary.label }}</button>
        <div v-if="variant.secondary.some((item) => item.kind !== 'find')" class="en-pair">
          <button v-for="action in variant.secondary.filter((item) => item.kind !== 'find')" :key="action.label" type="button" class="en-btn" :data-entry-secondary="action.kind" :disabled="sending && action.kind !== 'agent'" @click="act(action)">{{ action.label }}</button>
        </div>
        <div v-if="!account.loaded" class="en-pair en-hold" aria-hidden="true" />
        <div v-else-if="account.available && !account.signedIn" class="en-pair">
          <button type="button" class="en-btn" data-key="sign-up" data-entry-signup @click="signUp">Sign up free</button>
          <button type="button" class="en-btn" data-key="sign-in" data-entry-login @click="logIn">Log in</button>
        </div>
      </div>
      <details v-if="setup" class="en-needs" data-entry-needs>
        <summary>What publishing needs</summary>
        <ul><li v-for="need in SETUP_NEEDS" :key="need">{{ need }}</li></ul>
      </details>
      <p class="en-fine">No password, no e-mail to start.
        <button type="button" class="en-link" data-key="make-character" data-entry-creator @pointerenter="warmCreator" @focus="warmCreator" @touchstart.passive="warmCreator" @click="openCreator">{{ opening ? 'Opening…' : 'Make my character first' }}</button>
      </p>
      <BonusLine v-if="account.available && !account.signedIn" />

      <ul class="en-tiles" aria-label="What you can do">
        <li v-for="tile in variant.tiles" :key="tile.label"><i aria-hidden="true"><GameIcon :name="tile.icon" :size="20" /></i><span>{{ tile.label }}</span></li>
      </ul>

      <div v-if="isHome || variant.secondary.some((item) => item.kind === 'find')" class="en-find">
        <p v-if="found" class="en-found" role="status" data-entry-found>{{ foundLine }}</p>
        <button v-if="found && found.kind !== 'none'" type="button" class="en-btn is-small" data-key="found-start" :disabled="sending || starting" @click="startFound(found.city)">Start in {{ chosen && street?.place ? street.place.name : found.name }}</button>
        <button v-else type="button" class="en-link" data-key="find-city" :disabled="finding" @click="find">{{ finding ? 'Finding…' : findLabel }}</button>
        <small v-if="!found">Worked out on this device. Your position is never sent or stored.</small>
      </div>

      <nav class="en-quiet" aria-label="More">
        <button type="button" class="en-link" data-key="agent" data-entry-agent @click="openAgent"><GameIcon name="link" :size="16" /> Connect an AI agent</button>
        <a class="en-link" href="/about" target="_blank" rel="noopener">About</a>
        <a class="en-link" href="/terms" target="_blank" rel="noopener">Terms</a>
        <a class="en-link" href="/privacy" target="_blank" rel="noopener">Privacy</a>
        <a class="en-link" :href="SOURCE_URL" target="_blank" rel="noopener noreferrer">Source code · AGPL</a>
      </nav>
    </main>
    <AgentSheet v-if="agentOpen" @close="agentOpen = false" @choose="chooseAgent" />
  </div>
</template>

<style scoped>
.en-root { position: relative; display: grid; height: 100%; width: 100%; min-height: 0; overflow: hidden; place-items: center; box-sizing: border-box; padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); color: var(--c-ink); font-family: var(--font); background: #123524; }
.en-root *, .en-root *::before, .en-root *::after { box-sizing: border-box; }
.en-backdrop { position: absolute; inset: 0; overflow: hidden; container-type: size; background: radial-gradient(80% 70% at 50% 40%, #2f7a58 0, #1b4d37 50%, #0e2219 100%); }
.en-backdrop::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, #0b1a1385 0%, #0b1a135c 45%, #0b1a13ad 100%); }
/* One tall picture (three scenes of the game) drifts upward very slowly: a compositor-only transform, no layout and no paint per frame. */
.en-art { --en-ratio: 1.5; position: absolute; left: 0; top: 0; width: 100%; height: max(calc(var(--en-ratio) * 100cqw), 130cqh); background: center top / cover no-repeat; opacity: 0; transition: opacity 1.2s ease; will-change: transform; animation: en-pan 120s ease-in-out infinite alternate; }
.en-art.is-on { opacity: 1; }
@keyframes en-pan { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(0, calc(100cqh - 100%), 0); } }
@media (max-width: 699px) { .en-art { --en-ratio: 1.875; } }
@media (prefers-reduced-motion: reduce) { .en-art { animation: none; transition: none; } }
/* The dive behind the card (src/map3d/entry-dive.ts): its own box, under the card, never touched; only the globe and its names show. */
.en-stage { position: absolute; inset: 0; contain: strict; pointer-events: none; }
.en-stage :deep(.en-dive) { position: absolute; inset: 0; opacity: 0; }
.en-stage :deep(.en-dive.is-on) { opacity: 1; }
.en-stage :deep(.atlas > :not(.atlas-canvas):not(.atlas-labels)) { display: none; }
.en-stage :deep(.dv-veil) { position: absolute; }
.en-stage :deep(.dv-skip) { display: none; }

.en-card { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 12px; width: min(100%, 27.5rem); max-height: 100%; overflow-y: auto; overscroll-behavior: contain; padding: 22px 22px 18px; border-radius: 24px; background: #fffffff2; box-shadow: 0 24px 70px #000a, 0 0 0 1px #ffffff40 inset; font-size: 15px; line-height: 1.45; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
.en-card > * { margin: 0; }
.en-brand { display: flex; align-items: center; gap: 10px; }
.en-brand i { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 11px; background: var(--c-green-dark); color: #fff; }
.en-brand b { font-size: 20px; letter-spacing: -.3px; }
.en-live { display: flex; align-items: center; gap: 8px; align-self: flex-start; max-width: 100%; padding: 6px 12px; border-radius: var(--r-pill); background: var(--c-green-soft); color: var(--c-green-dark); font-size: 13px; font-weight: 700; line-height: 1.3; }
.en-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #8aa89a; }
.en-dot.is-live { background: var(--c-green); box-shadow: 0 0 0 3px #2fa86633; }
h1 { font-size: 27px; line-height: 1.15; letter-spacing: -.5px; text-wrap: balance; }
h1:focus { outline: none; }
.en-pitch { color: var(--c-ink-2); text-wrap: pretty; }
.en-place { display: flex; align-items: center; gap: 6px; align-self: flex-start; color: var(--c-green-dark); font-size: 14px; font-weight: 700; }
.en-invite { padding: 10px 12px; border-radius: 12px; background: var(--c-amber-soft); color: var(--c-amber-dark); font-size: 14px; }
.en-actions { display: grid; gap: 10px; }
.en-hold { min-height: 48px; }
.en-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.en-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 10px 16px; border: 1.5px solid var(--c-line); border-radius: var(--r-pill); background: #fff; color: var(--c-ink); font: inherit; font-weight: 700; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.en-btn:hover:enabled { background: var(--c-fill); }
.en-btn.is-primary { min-height: 54px; border-color: var(--c-green-dark); background: var(--c-green-dark); color: #fff; font-size: 17px; box-shadow: 0 6px 18px #1d6b4359; }
.en-btn.is-primary:hover:enabled { background: #175a38; }
.en-btn.is-small { min-height: var(--tap); align-self: flex-start; }
.en-btn:disabled { opacity: .65; cursor: default; }
.en-link { display: inline-flex; align-items: center; gap: 6px; min-height: var(--tap); padding: 0 4px; border: 0; background: none; color: var(--c-green-dark); font: inherit; font-weight: 700; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.en-link:disabled { opacity: .6; cursor: default; }
.en-btn:focus-visible, .en-link:focus-visible { outline: var(--focus); outline-offset: 2px; }
.en-fine { display: flex; flex-wrap: wrap; align-items: center; column-gap: 8px; color: var(--c-muted); font-size: 13px; }
.en-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 0; list-style: none; }
.en-tiles li { display: flex; align-items: center; gap: 8px; min-height: 52px; padding: 8px 10px; border-radius: 14px; background: var(--c-canvas); border: 1px solid var(--c-line); font-size: 12.5px; font-weight: 600; line-height: 1.25; }
.en-tiles i { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: var(--c-green-soft); color: var(--c-green-dark); }
.en-find { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.en-find small { color: var(--c-muted); font-size: 12px; }
.en-found { color: var(--c-ink-2); font-size: 14px; }
.en-quiet { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; column-gap: 12px; padding-top: 6px; border-top: 1px solid var(--c-line); }
.en-quiet .en-link { font-size: 13px; font-weight: 600; color: var(--c-ink-2); }

.en-shot { display: block; width: calc(100% + 44px); max-width: none; height: auto; aspect-ratio: 640 / 280; margin: -22px -22px 0; object-fit: cover; border-radius: 24px 24px 0 0; background: var(--c-fill); }
.en-steps { display: flex; flex-wrap: wrap; gap: 6px 8px; padding: 0; list-style: none; counter-reset: step; }
.en-steps li { counter-increment: step; display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: var(--r-pill); background: var(--c-amber-soft); color: var(--c-amber-dark); font-size: 13px; font-weight: 700; }
.en-steps li::before { content: counter(step); display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--c-amber-dark); color: #fff; font-size: 11px; }
.en-needs { font-size: 13.5px; color: var(--c-ink-2); }
.en-needs summary { display: flex; align-items: center; min-height: var(--tap); cursor: pointer; color: var(--c-green-dark); font-weight: 700; }
.en-needs ul { margin: 0 0 4px; padding-left: 20px; }
@media (max-height: 700px) { .en-shot { display: none; } }
@media (max-width: 600px) { .en-shot { width: calc(100% + 36px); margin: -20px -18px 0; } }
@media (min-width: 1800px) and (min-height: 1000px) { .en-shot { width: calc(100% + 64px); margin: -32px -32px 0; } }
/* A phone: the card is a sheet on the bottom edge. */
@media (max-width: 600px) {
  .en-root { place-items: end center; padding: 0; }
  .en-card { width: 100%; max-height: 94%; padding: 20px 18px max(16px, env(safe-area-inset-bottom)); border-radius: 24px 24px 0 0; gap: 10px; }
  h1 { font-size: 24px; }
  /* The first look is the headline and Play now: the reassurance and the feature tiles are quieter, and sit closer together. */
  .en-pitch { font-size: 14.5px; }
  .en-tiles { gap: 6px; }
  .en-tiles li { min-height: 44px; padding: 6px 8px; background: transparent; font-size: 12px; font-weight: 600; color: var(--c-ink-2); }
  .en-tiles i { width: 26px; height: 26px; }
  .en-find { gap: 0; }
}
@media (max-height: 620px) { .en-tiles li { min-height: 44px; } .en-card { gap: 8px; } }
/* A very large screen: the same card, drawn larger so it is not lost in the picture. */
@media (min-width: 1800px) and (min-height: 1000px) { .en-card { width: 38rem; font-size: 21px; padding: 32px 32px 26px; } h1 { font-size: 40px; } .en-btn.is-primary { min-height: 68px; font-size: 24px; } .en-btn { min-height: 56px; } .en-live { font-size: 17px; } .en-tiles li { font-size: 17px; } .en-fine, .en-find small { font-size: 17px; } .en-quiet .en-link { font-size: 17px; } .en-brand b { font-size: 26px; } }
</style>
