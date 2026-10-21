<script setup lang="ts">
// One shop: the sign, what it does, photos, services with the seller's own prices, hours, who runs it, and the two ways out:
// Chat and Pay. Neither link is on this page. Pressing a button asks the server for it (a signed-in adult only), and the
// answer goes to the "You are leaving Allworld" sheet, which names the site and the address before anything opens.
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { TRUST_REPORT_REASONS, TRUST_REPORT_WORDS } from '../../../game/trust/index.ts'
import type { OutboundLink, TrustReportReason } from '../../../game/trust/index.ts'
import type { ShowcaseGo, ShowcaseLinkKind, ShowcaseView } from '../../../types/showcase.ts'
import { newClientId } from '../social/useSocial.ts'
import GameIcon from '../../ui/GameIcon.vue'
import SkeletonRows from '../../ui/SkeletonRows.vue'
import ShopFront from './ShopFront.vue'
import { adultConsentBody, wordsFor } from './showcaseModel.ts'
const LinkInterstitial = defineAsyncComponent(() => import('../trust/LinkInterstitial.vue'))

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ back: [] }>()
const { game, shell } = useApp()
/** "Step inside": the shop in 3D. Leaving brings the visitor back to this page. */
function stepInside(): void {
  shell.close()
  void import('./room/openRoom.ts').then((room) => room.openShopRoom({ by: 'id', id: props.id }, { back: () => shell.open('showcase', { shop: props.id }) }))
}
const shop = ref<ShowcaseView | null>(null)
const failed = ref('')
const note = ref('')
const needs = ref<'account' | 'adult' | ''>('')
const leaving = ref<OutboundLink | null>(null)
const busy = ref('')
const reporting = ref<{ photo?: string } | null>(null)
const reason = ref<TrustReportReason | ''>('')
const detail = ref('')
// One request id per press that has not finished: pressing again after a lost answer repeats the same request.
const ids = new Map<string, string>()
const form = ref<HTMLElement | null>(null)
/** One short line for the bar: a prompt with its one action, or the answer. Long refusals stay readable in the list of codes, not here. */
const message = computed(() => (needs.value === 'account' ? 'Sign in to chat or pay.' : needs.value === 'adult' ? 'Say you are 18 or older to continue.' : note.value))
const bar = ref<HTMLElement | null>(null)
const barHeight = ref(64)
let watcher: ResizeObserver | null = null
/** The bar's height as drawn now; read again when its content changes (a prompt shows or goes) and when the window is resized. */
const measure = (): void => { if (bar.value) barHeight.value = Math.ceil(bar.value.getBoundingClientRect().height) }
watch(bar, (node) => { watcher?.disconnect(); measure(); if (node && typeof ResizeObserver === 'function') { watcher = new ResizeObserver(measure); watcher.observe(node) } })
watch(message, () => { void nextTick(measure) })
onMounted(() => window.addEventListener('resize', measure))
onBeforeUnmount(() => { watcher?.disconnect(); window.removeEventListener('resize', measure) })
watch(reporting, (now) => { if (now) void nextTick(() => form.value?.scrollIntoView({ block: 'center' })) })

onMounted(async () => {
  try { shop.value = (await game.fetchJson<{ shop: ShowcaseView | null }>(`/api/showcase/${encodeURIComponent(props.id)}`)).shop } catch (error) { failed.value = wordsFor(codeOf(error), 'This shop could not load.') }
})
const codeOf = (error: unknown): string | undefined => (error instanceof Error ? (error as { code?: string }).code : undefined)

async function go(kind: ShowcaseLinkKind): Promise<void> {
  if (!shop.value || busy.value) return
  busy.value = kind; note.value = ''; needs.value = ''
  const key = `go:${kind}`, clientId = ids.get(key) ?? newClientId()
  ids.set(key, clientId)
  try {
    const answer = await game.fetchJson<ShowcaseGo>(`/api/showcase/${encodeURIComponent(props.id)}/go`, { method: 'POST', body: { clientId, kind } })
    ids.delete(key)
    leaving.value = answer.link
  } catch (error) {
    const code = codeOf(error)
    ids.delete(key)
    if (code === 'account_required') needs.value = 'account'
    else if (code === 'adult_self_declaration_required') needs.value = 'adult'
    note.value = wordsFor(code, error instanceof Error ? error.message : 'That did not work. Try again.')
  } finally { busy.value = '' }
}
async function declareAdult(): Promise<void> {
  try { await game.fetchJson('/api/growth/consent', { method: 'POST', body: adultConsentBody(game.view.value.cityId) }); needs.value = ''; note.value = 'Thank you. Press Chat or Pay again.' } catch (error) { note.value = error instanceof Error ? error.message : 'That did not work.' }
}
async function report(): Promise<void> {
  if (!reporting.value || !reason.value || busy.value) return
  busy.value = 'report'
  const key = `report:${reporting.value.photo ?? ''}`, clientId = ids.get(key) ?? newClientId()
  ids.set(key, clientId)
  try {
    await game.fetchJson(`/api/showcase/${encodeURIComponent(props.id)}/report`, { method: 'POST', body: { clientId, reason: reason.value, ...(detail.value.trim() ? { note: detail.value.trim() } : {}), ...(reporting.value.photo ? { photo: reporting.value.photo } : {}) } })
    ids.delete(key); note.value = 'Thank you. We will look at it. They are not told who reported them.'; reporting.value = null; reason.value = ''; detail.value = ''
  } catch (error) { ids.delete(key); const code = codeOf(error); if (code === 'account_required') needs.value = 'account'; note.value = wordsFor(code, error instanceof Error ? error.message : 'That report was not sent.') } finally { busy.value = '' }
}
</script>

<template>
  <article class="sp" aria-label="Shop">
    <button type="button" class="sp-back" aria-label="Back to the list" @click="emit('back')"><GameIcon name="back" :size="18" /><span>All shops</span></button>
    <p v-if="failed" class="ui-error" role="alert">{{ failed }}</p>
    <SkeletonRows v-else-if="!shop" :rows="3" label="Loading the shop" />
    <template v-else>
      <ShopFront :shop="shop" reportable @report="reporting = { photo: $event }" />
      <p v-if="shop.payNotice" class="sp-warn" role="status">{{ shop.payNotice }}. Check it with the seller before you pay.</p>
      <p class="sp-fine">Chat and payment happen outside Allworld, on the seller’s own page. Allworld does not hold your money or take part in the deal.</p>
      <button type="button" class="ui-button is-primary is-block" data-step-inside @click="stepInside">Step inside</button>
      <button type="button" class="ui-button is-quiet is-block" @click="reporting = {}">Report this shop</button>
      <form v-if="reporting" ref="form" class="sp-report" @submit.prevent="report">
        <fieldset>
          <legend>{{ reporting.photo ? 'Why are you reporting this photo?' : 'Why are you reporting this shop?' }}</legend>
          <label v-for="item in TRUST_REPORT_REASONS" :key="item"><input v-model="reason" type="radio" name="sp-reason" :value="item"> {{ TRUST_REPORT_WORDS[item] }}</label>
        </fieldset>
        <label>Anything else? (optional)<textarea v-model="detail" maxlength="300" rows="2" /></label>
        <button class="ui-button is-block is-danger" :disabled="!reason || busy !== ''">{{ busy === 'report' ? 'Sending…' : 'Send report' }}</button>
        <button type="button" class="ui-button is-quiet is-block" @click="reporting = null">Cancel</button>
      </form>
      <div ref="bar" class="sp-bar" role="group" aria-label="Contact the seller">
        <div v-if="message" class="sp-msg">
          <p role="status" class="sp-status">{{ message }}</p>
          <button v-if="needs === 'account'" type="button" class="ui-button is-small" @click="shell.open('account')">Sign in</button>
          <button v-if="needs === 'adult'" type="button" class="ui-button is-small" @click="declareAdult">I am 18+</button>
        </div>
        <div class="sp-go">
          <button type="button" class="ui-button is-primary" aria-label="Chat with the seller" :disabled="busy !== ''" :aria-busy="busy === 'chat'" @click="go('chat')">Chat</button>
          <button v-if="shop.pay" type="button" class="ui-button" aria-label="Pay the seller" :disabled="busy !== ''" :aria-busy="busy === 'pay'" @click="go('pay')">Pay</button>
        </div>
      </div>
      <!-- The bar is fixed to the bottom while the page scrolls under it; this gap is its height, so nothing is ever covered. -->
      <div class="sp-end" :style="{ height: `${barHeight}px` }" aria-hidden="true" />
    </template>
    <LinkInterstitial v-if="leaving && shop" :link="leaving" :author-id="shop.badge.id" :author-name="shop.badge.name" @close="leaving = null" />
  </article>
</template>

<style scoped>
.sp { display: grid; gap: var(--s-3); }
.sp-back { justify-self: start; display: inline-flex; align-items: center; gap: 4px; min-height: 36px; padding: 0 10px 0 4px; border: 0; background: none; color: var(--c-green-dark); font: 600 var(--t-body) var(--font); cursor: pointer; }
.sp-back:focus-visible { outline: var(--focus); outline-offset: 2px; }
.sp-fine { margin: 0; font-size: var(--t-small); color: var(--c-muted); }
.sp-warn { margin: 0; padding: 8px 10px; border-radius: var(--r-sm); background: var(--c-amber-soft); color: var(--c-amber-dark); font-size: 13px; }
.sp-status { margin: 0; font-weight: 600; }
.sp-msg { display: flex; align-items: center; gap: var(--s-2); margin-bottom: var(--s-2); }
.sp-msg .sp-status { flex: 1; min-width: 0; font-size: var(--t-small); line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sp-msg .ui-button { flex: none; white-space: nowrap; }
.sp-report { display: grid; gap: 8px; }
.sp-report fieldset { display: grid; gap: 6px; border: 0; padding: 0; margin: 0; }
.sp-report legend { font-weight: 600; margin-bottom: 4px; }
.sp-report label { display: grid; gap: 4px; font-size: 13px; }
/* Chat and Pay stay at the bottom of the screen while the page scrolls under them: solid, as wide as the cards. */
.sp-bar { position: sticky; bottom: calc(var(--s-2) + env(safe-area-inset-bottom, 0px)); z-index: 2; padding: var(--s-2); background: #fff; border: 1px solid var(--c-line); border-radius: var(--r-md); box-shadow: var(--e-2); }
.sp-go { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: var(--s-2); }
.sp-go .ui-button { white-space: nowrap; }
.sp-end { padding-bottom: calc(var(--s-4) + var(--s-2) + env(safe-area-inset-bottom, 0px)); }
</style>
