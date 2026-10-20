<script setup lang="ts">
// "Step inside": a seller's shop in 3D. The room itself is drawn by roomScene.ts (its own chunk, fetched when this opens); this
// component asks for the shop, owns the controls around the canvas (leave, look around, the item card, the counter card, the report)
// and keeps the rule of the whole feature: the game takes no order and holds no money. Message the seller and Pay the seller are
// the seller's own links, the same as on the public page; everything the seller wrote is shown as Vue text, never as markup.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useApp } from '../../../state/app.ts'
import { TRUST_REPORT_REASONS, TRUST_REPORT_WORDS } from '../../../../game/trust/index.ts'
import type { OutboundLink, TrustReportReason } from '../../../../game/trust/index.ts'
import type { ShowcaseGo, ShowcaseMine, ShowcaseView } from '../../../../types/showcase.ts'
import { SHOWCASE_CATEGORY_LABELS } from '../../../../types/showcase.ts'
import { priceWords } from '../../../../types/showcase-link.ts'
import { newClientId } from '../../social/useSocial.ts'
import GameIcon from '../../../ui/GameIcon.vue'
import LinkInterstitial from '../../trust/LinkInterstitial.vue'
import { PRICE_NOTE, openStatus, placeWords, weekLines, wordsFor, zoneOf } from '../showcaseModel.ts'
import { DEAL_LINE, initialOf, menuPageOf, messageLink, pageCount, pageOf, pageSizeOf, payLink, roomColours, roomFromMine, roomFromView, roomLabel, roomPhotoUrl } from './roomModel.ts'
import type { RoomData, RoomRequest } from './roomModel.ts'
import type { RoomScene, RoomView } from './roomScene.ts'
import { isPlayApp } from '../../../playMode.ts'

const props = defineProps<{ request: RoomRequest }>()
const emit = defineEmits<{ close: [] }>()
const { game, shell } = useApp()
const playApp = isPlayApp()

const data = shallowRef<RoomData | null>(null)
const status = ref<'loading' | 'ready' | 'gone' | 'nogl'>('loading')
const problem = ref('')
const canvas = ref<HTMLCanvasElement | null>(null)
const root = ref<HTMLDialogElement | null>(null)
const page = ref(0)
const card = ref<{ kind: 'item'; index: number } | { kind: 'counter' } | null>(null)
const note = ref('')
const needs = ref(false)
const busy = ref('')
const leaving = ref<OutboundLink | null>(null)
const reporting = ref(false)
const reason = ref<TrustReportReason | ''>('')
const detail = ref('')
let scene: RoomScene | null = null
let gone = false
const ids = new Map<string, string>()

const service = computed(() => data.value?.kind === 'service')
const pages = computed(() => (data.value ? pageCount(data.value.items.length, pageSizeOf(data.value.kind)) : 1))
const pageItems = computed(() => (data.value ? (service.value ? menuPageOf(data.value.items, page.value) : pageOf(data.value.items, page.value)) : []))
const item = computed(() => (data.value && card.value?.kind === 'item' ? data.value.items[card.value.index] ?? null : null))
const colours = computed(() => roomColours(data.value?.colours ?? ['#1f3a5f', '#f1f3f5']))
const hours = computed(() => { const open = openStatus(data.value?.hours ?? [], new Date(), data.value?.zone); return { open, week: weekLines(data.value?.hours ?? [], open.today) } })
const kind = computed(() => (data.value ? SHOWCASE_CATEGORY_LABELS[data.value.category] : ''))
const preview = computed(() => data.value?.access === 'preview')
const hasChat = computed(() => data.value !== null && (data.value.access === 'released' || messageLink(data.value) !== null))
const chatHref = computed(() => (data.value && data.value.access !== 'released' ? messageLink(data.value, item.value) : null))
const payHref = computed(() => (!playApp && data.value && data.value.access !== 'released' ? payLink(data.value) : null))
const showPay = computed(() => !playApp && data.value !== null && (data.value.access === 'released' ? data.value.hasPay : payHref.value !== null))

onMounted(async () => {
  // A modal dialog: the page behind is inert, the room is above everything (the tour included, which waits while a dialog is open).
  root.value?.showModal()
  window.addEventListener('keydown', onKey, true)
  try {
    const found = await load()
    if (gone) return
    data.value = found; status.value = 'ready'
    await nextTick()
    if (!canvas.value) return
    try {
      const { createRoomScene } = await import('./roomScene.ts')
      const made = await createRoomScene(canvas.value, found, { pick })
      if (gone) { made.dispose(); return }
      scene = made
      made.setPage(0)
    } catch { if (!gone) status.value = 'nogl' }
  } catch (error) {
    if (!gone) { status.value = 'gone'; problem.value = (error as { code?: string } | null)?.code === 'rate_limited' ? 'Too many people are looking. Try again in a minute.' : 'That shop is not available.' }
  }
})
onBeforeUnmount(() => { gone = true; window.removeEventListener('keydown', onKey, true); scene?.dispose(); scene = null })

async function load(): Promise<RoomData> {
  const request = props.request
  if (request.by === 'token') {
    const found = await game.fetchJson<{ id: string; shop: ShowcaseView; chat: string | null; pay: string | null }>(`/api/showcase/entry/${request.token}`)
    return roomFromView(found.shop, { chat: found.chat, pay: found.pay }, placeWords(found.shop.city, found.shop.venue), zoneOf(found.shop.city))
  }
  if (request.by === 'id') {
    const found = await game.fetchJson<{ shop: ShowcaseView | null }>(`/api/showcase/${encodeURIComponent(request.id)}`)
    if (!found.shop) throw new Error('unavailable')
    return roomFromView(found.shop, undefined, placeWords(found.shop.city, found.shop.venue), zoneOf(found.shop.city))
  }
  const mine = await game.fetchJson<ShowcaseMine>('/api/showcase/mine')
  if (!mine.shop) throw new Error('no shop')
  return roomFromMine(mine.shop, placeWords(mine.shop.city, mine.shop.venue), zoneOf(mine.shop.city))
}

function pick(found: { kind: string; index?: number }): void {
  if (found.kind === 'item' && typeof found.index === 'number') { card.value = { kind: 'item', index: found.index }; note.value = ''; needs.value = false; reporting.value = false }
  else if (found.kind === 'counter') { card.value = { kind: 'counter' }; note.value = ''; needs.value = false; reporting.value = false }
  else if (found.kind === 'page') page.value = scene?.diagnostics().page ?? 0
}
function look(view: RoomView): void { card.value = null; scene?.view(view) }
function more(): void { if (!scene) return; card.value = null; scene.setPage(page.value + 1 < pages.value ? page.value + 1 : 0); page.value = scene.diagnostics().page; scene.view(service.value ? 'menu' : 'room') }
function about(): void { scene?.view(service.value ? 'room' : 'counter'); card.value = { kind: 'counter' }; note.value = ''; reporting.value = false }
function closeCard(): void { card.value = null; reporting.value = false; note.value = ''; needs.value = false }
/** Escape (or the browser's back gesture): the report, then the card, then the room. */
function back(): void { if (reporting.value) reporting.value = false; else if (card.value) closeCard(); else emit('close') }
function onKey(event: KeyboardEvent): void {
  // The game behind this room must not walk or close anything while the room is open: these keys belong to the room.
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); back(); return }
  const typing = event.target instanceof Element && event.target.matches('input, textarea, select')
  if (typing || event.ctrlKey || event.metaKey || event.altKey) return
  if (scene?.nudge(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); return }
  if (['w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(event.key)) event.stopImmediatePropagation()
}

/** A seller's link, released one at a time to a signed-in adult, when the room was not opened from the shop's public address. */
async function release(what: 'chat' | 'pay'): Promise<void> {
  const room = data.value
  if (!room || busy.value || (playApp && what === 'pay')) return
  busy.value = what; note.value = ''; needs.value = false
  const key = `go:${what}`, clientId = ids.get(key) ?? newClientId()
  ids.set(key, clientId)
  try {
    const answer = await game.fetchJson<ShowcaseGo>(`/api/showcase/${encodeURIComponent(room.shopId)}/go`, { method: 'POST', body: { clientId, kind: what } })
    ids.delete(key); leaving.value = answer.link
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    ids.delete(key)
    needs.value = code === 'account_required'
    note.value = needs.value ? (playApp ? 'Sign in to message the seller from here. The shop page outside the game needs no account.' : 'Sign in to message or pay the seller from here. The shop page outside the game needs no account.') : wordsFor(code, error instanceof Error ? error.message : 'That did not work. Try again.')
  } finally { busy.value = '' }
}
async function report(): Promise<void> {
  const room = data.value
  if (!room || !reason.value || busy.value) return
  busy.value = 'report'
  const key = 'report', clientId = ids.get(key) ?? newClientId()
  ids.set(key, clientId)
  try {
    await game.fetchJson(`/api/showcase/${encodeURIComponent(room.shopId)}/report`, { method: 'POST', body: { clientId, reason: reason.value, ...(detail.value.trim() ? { note: detail.value.trim() } : {}) } })
    ids.delete(key); note.value = 'Thank you. We will look at it. They are not told who reported them.'; reporting.value = false; reason.value = ''; detail.value = ''
  } catch (error) {
    ids.delete(key)
    const code = (error as { code?: string } | null)?.code
    needs.value = code === 'account_required'
    note.value = needs.value ? 'Sign in to report a shop.' : wordsFor(code, error instanceof Error ? error.message : 'That report was not sent.')
  } finally { busy.value = '' }
}
/** Sign in sits in the game behind this room: the room closes first, so nothing is hidden. */
function signIn(): void { emit('close'); shell.open('account') }
function openShopPage(): void { const id = data.value?.shopId; emit('close'); if (id && props.request.by !== 'mine') shell.open('showcase', { shop: id }); else shell.open('showcase') }

watch(card, (now) => { if (now) void nextTick(() => root.value?.querySelector<HTMLElement>('[data-si-card]')?.scrollTo?.({ top: 0 })) })
</script>

<template>
  <dialog ref="root" class="si" :aria-label="data ? roomLabel(data) : 'Shop'" data-shop-inside @cancel.prevent="back">
    <canvas ref="canvas" class="si-canvas" tabindex="0" :aria-label="data ? `${roomLabel(data)}. Drag to look around, pinch to move closer. Tap an item for its card.` : 'Shop'" />
    <header class="si-top">
      <button type="button" class="si-exit" aria-label="Leave the shop" data-si-exit @click="emit('close')"><GameIcon name="back" :size="18" /><span>Leave</span></button>
      <p v-if="data" class="si-name" data-si-name>{{ data.name }}</p>
      <p v-if="preview" class="si-tag" data-si-preview>Preview</p>
    </header>

    <p v-if="status === 'loading'" class="si-state" role="status" data-si-loading>Opening the shop…</p>
    <div v-else-if="status === 'gone'" class="si-state si-gone" role="alert" data-si-gone>
      <p>{{ problem }}</p>
      <button type="button" class="ui-button is-primary" @click="emit('close')">Back to the game</button>
    </div>
    <div v-else-if="status === 'nogl'" class="si-state si-gone" role="alert" data-si-nogl>
      <p>This device cannot draw the 3D shop. You can still see everything on the shop page.</p>
      <button type="button" class="ui-button is-primary" @click="openShopPage">Open the shop page</button>
      <button type="button" class="ui-button" @click="emit('close')">Back to the game</button>
    </div>

    <template v-if="data && status === 'ready'">
      <p v-if="!data.items.length && !card" class="si-hint" data-si-empty>{{ service ? 'Opening soon: no services are listed yet.' : 'Opening soon: nothing is on the shelves yet.' }}</p>
      <ul v-if="!card" class="si-sr" aria-label="Items on this page">
        <li v-for="entry in pageItems" :key="entry.index"><button type="button" :data-si-item="entry.index" @click="pick({ kind: 'item', index: entry.index })">{{ entry.item.name }}, {{ priceWords(entry.item.priceNaira) }}</button></li>
      </ul>
      <nav v-if="!card" class="si-views" aria-label="Look around the shop">
        <template v-if="service">
          <button type="button" data-si-view="room" @click="look('room')">Reception</button>
          <button type="button" data-si-view="menu" @click="look('menu')">Service menu</button>
          <button type="button" data-si-view="portfolio" @click="look('portfolio')">Portfolio</button>
          <button v-if="pages > 1" type="button" data-si-more :aria-label="`More services: page ${page + 1} of ${pages}`" @click="more">More services {{ page + 1 }}/{{ pages }}</button>
        </template>
        <template v-else>
          <button type="button" data-si-view="room" @click="look('room')">Shop</button>
          <button type="button" data-si-view="left" @click="look('left')">Left</button>
          <button type="button" data-si-view="counter" @click="look('counter')">Counter</button>
          <button type="button" data-si-view="right" @click="look('right')">Right</button>
          <button v-if="pages > 1" type="button" data-si-more :aria-label="`More items: page ${page + 1} of ${pages}`" @click="more">More items {{ page + 1 }}/{{ pages }}</button>
        </template>
        <button type="button" data-si-about @click="about">About</button>
      </nav>

      <section v-if="card" class="si-card" :aria-label="item ? item.name : 'The shop'" data-si-card>
        <button type="button" class="si-x" aria-label="Close the card" data-si-close @click="closeCard">×</button>
        <template v-if="item">
          <div class="si-art" :style="{ background: colours.tile, color: colours.tileInk }">
            <img v-if="item.photo && roomPhotoUrl(item.photo)" :src="roomPhotoUrl(item.photo) ?? ''" :alt="item.name" width="96" height="96" data-si-photo>
            <span v-else aria-hidden="true">{{ initialOf(item.name) }}</span>
          </div>
          <h2 class="si-h" data-si-item-name>{{ item.name }}</h2>
          <p class="si-price" data-si-item-price>{{ priceWords(item.priceNaira) }}<small v-if="item.priceNaira > 0"> {{ PRICE_NOTE }}</small></p>
          <p v-if="item.note" class="si-text" data-si-item-note>{{ item.note }}</p>
        </template>
        <template v-else>
          <h2 class="si-h" data-si-shop-name>{{ data.name }}</h2>
          <p class="si-meta">{{ kind }}<template v-if="data.place"> · {{ data.place }}</template></p>
          <p class="si-meta si-open" :class="{ 'is-open': hours.open.open }">{{ hours.open.text }}</p>
          <p v-for="line in data.about.split('\n')" :key="line" class="si-text" data-si-about-text>{{ line }}</p>
          <table class="si-week" aria-label="Opening hours"><tbody><tr v-for="line in hours.week" :key="line.day" :class="{ 'is-today': line.today }"><td>{{ line.day }}</td><td>{{ line.text }}</td></tr></tbody></table>
        </template>
        <div class="si-go">
          <template v-if="data.access === 'released'">
            <button v-if="hasChat" type="button" class="ui-button is-primary is-block" :disabled="busy !== ''" data-si-message @click="release('chat')">Message the seller</button>
            <button v-if="showPay" type="button" class="ui-button is-block" :disabled="busy !== ''" data-si-pay @click="release('pay')">Pay the seller</button>
          </template>
          <template v-else>
            <a v-if="chatHref" class="ui-button is-primary is-block" :href="chatHref" target="_blank" rel="noopener noreferrer" data-si-message>Message the seller</a>
            <a v-if="payHref" class="ui-button is-block" :href="payHref" target="_blank" rel="noopener noreferrer" data-si-pay>Pay the seller</a>
          </template>
          <p v-if="preview" class="si-fine">This is a preview. These buttons work for your visitors.</p>
        </div>
        <p v-if="data.payNotice && showPay" class="si-warn" role="status">{{ data.payNotice }}. Check it with the seller before you pay.</p>
        <p v-if="note" class="si-note" role="status" data-si-note>{{ note }} <button v-if="needs" type="button" class="ui-button is-small" @click="signIn">Sign in</button></p>
        <p class="si-fine" data-si-deal>{{ DEAL_LINE }}</p>
        <template v-if="!preview">
          <button v-if="!reporting" type="button" class="ui-button is-quiet is-block" data-si-report @click="reporting = true">Report this shop</button>
          <form v-else class="si-report" @submit.prevent="report">
            <fieldset>
              <legend>Why are you reporting this shop?</legend>
              <label v-for="why in TRUST_REPORT_REASONS" :key="why"><input v-model="reason" type="radio" name="si-reason" :value="why"> {{ TRUST_REPORT_WORDS[why] }}</label>
            </fieldset>
            <label>Anything else? (optional)<textarea v-model="detail" maxlength="300" rows="2" /></label>
            <button class="ui-button is-block is-danger" :disabled="!reason || busy !== ''">{{ busy === 'report' ? 'Sending…' : 'Send report' }}</button>
            <button type="button" class="ui-button is-quiet is-block" @click="reporting = false">Cancel</button>
          </form>
        </template>
      </section>
    </template>
    <LinkInterstitial v-if="leaving && data" :link="leaving" :author-id="data.author?.id" :author-name="data.author?.name ?? data.name" @close="leaving = null" />
  </dialog>
</template>

<style scoped>
.si { position: fixed; inset: 0; z-index: 38; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; overflow: hidden; background: #1b1410; color: #fff; font-family: var(--font, system-ui, sans-serif); overscroll-behavior: contain; }
.si::backdrop { background: none; }
.si-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; outline: none; }
.si-top { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 10px; padding: max(8px, env(safe-area-inset-top)) 10px 8px; background: linear-gradient(#000a, #0000); pointer-events: none; }
.si-top > * { pointer-events: auto; }
.si-exit { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; padding: 0 14px 0 10px; border: 0; border-radius: 22px; background: #fff; color: #17212f; font: 700 15px var(--font, system-ui, sans-serif); cursor: pointer; }
.si-exit:focus-visible, .si-views button:focus-visible, .si-x:focus-visible { outline: 3px solid #ffd34d; outline-offset: 2px; }
.si-name { margin: 0; min-width: 0; flex: 1; font: 800 17px/1.2 var(--font, system-ui, sans-serif); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 1px 3px #000a; pointer-events: none; }
.si-tag { margin: 0; padding: 3px 10px; border-radius: 12px; background: #ffd34d; color: #20232c; font-weight: 800; font-size: 12px; }
.si-state { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); margin: 0; padding: 14px 20px; border-radius: 14px; background: #000a; font-weight: 600; text-align: center; }
.si-gone { display: grid; gap: 10px; width: min(320px, calc(100% - 32px)); background: #fff; color: #17212f; }
.si-gone p { margin: 0; }
.si-hint { position: absolute; left: 50%; bottom: calc(112px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); margin: 0; padding: 6px 14px; border-radius: 16px; background: #000a; font-size: 14px; white-space: nowrap; max-width: calc(100% - 20px); overflow: hidden; text-overflow: ellipsis; }
.si-sr { position: absolute; width: 1px; height: 1px; margin: 0; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; list-style: none; }
.si-views { position: absolute; left: 0; right: 0; bottom: 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; padding: 8px 10px calc(10px + env(safe-area-inset-bottom, 0px)); background: linear-gradient(#0000, #000b); }
.si-views button { flex: none; min-height: 44px; padding: 0 12px; border: 1px solid #fff6; border-radius: 22px; background: #fffffff0; color: #17212f; font: 700 14px var(--font, system-ui, sans-serif); cursor: pointer; }
.si-card { position: absolute; left: 50%; bottom: 0; transform: translateX(-50%); width: min(460px, 100%); max-height: min(78%, calc(100% - 64px)); overflow-y: auto; box-sizing: border-box; padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px)); border-radius: 18px 18px 0 0; background: #fff; color: #1d2330; box-shadow: 0 -8px 32px #0006; display: grid; gap: 8px; align-content: start; }
.si-x { position: absolute; top: 6px; right: 6px; display: grid; place-items: center; width: 44px; height: 44px; border: 0; border-radius: 50%; background: #eef1ef; color: #1d2330; font-size: 26px; line-height: 1; cursor: pointer; }
.si-art { display: grid; place-items: center; width: 96px; height: 96px; border-radius: 12px; overflow: hidden; font: 800 52px var(--font, system-ui, sans-serif); }
.si-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.si-h { margin: 0; padding-right: 44px; font-size: 20px; line-height: 1.2; overflow-wrap: anywhere; }
.si-price { margin: 0; font-size: 18px; font-weight: 800; }
.si-price small { display: block; font-size: 12px; font-weight: 500; color: #4a5361; }
.si-text, .si-meta { margin: 0; overflow-wrap: anywhere; font-size: 15px; }
.si-meta { color: #4a5361; font-size: 14px; }
.si-open { font-weight: 700; color: #7a4b00; }
.si-open.is-open { color: #1f6f4a; }
.si-week { width: 100%; border-collapse: collapse; font-size: 14px; }
.si-week td { padding: 3px 0; border-bottom: 1px solid #e1ddd2; }
.si-week td:last-child { text-align: right; }
.si-week .is-today { font-weight: 800; }
.si-go { display: grid; gap: 8px; margin-top: 4px; }
.si-go .ui-button { box-sizing: border-box; width: 100%; text-decoration: none; text-align: center; display: flex; align-items: center; justify-content: center; min-height: 48px; }
.si-fine { margin: 0; font-size: 13px; color: #4a5361; }
.si-warn { margin: 0; padding: 8px 10px; border-radius: 8px; background: #fff3dc; color: #7a4b00; font-size: 13px; }
.si-note { margin: 0; font-size: 14px; font-weight: 600; }
.si-report { display: grid; gap: 8px; }
.si-report fieldset { display: grid; gap: 6px; border: 0; padding: 0; margin: 0; }
.si-report legend { font-weight: 700; margin-bottom: 4px; }
.si-report label { display: grid; gap: 4px; font-size: 14px; }
@media (max-height: 640px) { .si-card { max-height: calc(100% - 56px); } }
@media (min-width: 720px) { .si-card { left: auto; right: 16px; bottom: 16px; transform: none; border-radius: 18px; max-height: calc(100% - 96px); } }
</style>
