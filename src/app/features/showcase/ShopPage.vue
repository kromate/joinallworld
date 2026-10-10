<script setup lang="ts">
// One shop: the sign, what it does, photos, services with the seller's own prices, hours, who runs it, and the two ways out:
// Chat and Pay. Neither link is on this page. Pressing a button asks the server for it (a signed-in adult only), and the
// answer goes to the "You are leaving Allworld" sheet, which names the site and the address before anything opens.
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { TRUST_REPORT_REASONS, TRUST_REPORT_WORDS } from '../../../game/trust/index.ts'
import type { OutboundLink, TrustReportReason } from '../../../game/trust/index.ts'
import type { ShowcaseGo, ShowcaseLinkKind, ShowcaseView } from '../../../types/showcase.ts'
import { newClientId } from '../social/useSocial.ts'
import StorefrontCard from './StorefrontCard.vue'
import { hoursLines, photoUrl, sellerPrice, wordsFor } from './showcaseModel.ts'
const LinkInterstitial = defineAsyncComponent(() => import('../trust/LinkInterstitial.vue'))

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ back: [] }>()
const { game, shell } = useApp()
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

onMounted(async () => {
  try { shop.value = (await game.fetchJson<{ shop: ShowcaseView | null }>(`/api/showcase/${encodeURIComponent(props.id)}`)).shop } catch (error) { failed.value = wordsFor(codeOf(error), 'This shop could not load.') }
})
const codeOf = (error: unknown): string | undefined => (error instanceof Error ? (error as { code?: string }).code : undefined)
const sorted = computed(() => hoursLines(shop.value?.hours ?? []))

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
  try { await game.fetchJson('/api/growth/consent', { method: 'POST', body: { cityId: game.view.value.cityId, age: 'adult' } }); needs.value = ''; note.value = 'Thank you. Press Chat or Pay again.' } catch (error) { note.value = error instanceof Error ? error.message : 'That did not work.' }
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
    <button type="button" class="ui-button is-quiet" @click="emit('back')">Back to the list</button>
    <p v-if="failed" class="ui-error" role="alert">{{ failed }}</p>
    <p v-else-if="!shop" role="status">Loading…</p>
    <template v-else>
      <StorefrontCard :shop="{ ...shop, cover: null }" />
      <p class="sp-about">{{ shop.about }}</p>
      <section v-if="shop.photos.length" aria-label="Photos">
        <ul class="sp-photos">
          <li v-for="(photo, at) in shop.photos" :key="photo.id">
            <img :src="photoUrl(photo.id)" :alt="`${shop.name}, photo ${at + 1} of ${shop.photos.length}`" loading="lazy" :width="photo.w" :height="photo.h">
            <button type="button" class="ui-button is-quiet" :aria-label="`Report photo ${at + 1}`" @click="reporting = { photo: photo.id }">Report photo</button>
          </li>
        </ul>
      </section>
      <section aria-labelledby="sp-services">
        <h3 id="sp-services">Services</h3>
        <p class="sp-note">{{ shop.priceLabel }}.</p>
        <ul class="sp-services">
          <li v-for="item in shop.serviceList" :key="item.label"><span><b>{{ item.label }}</b><small v-if="item.note"> {{ item.note }}</small></span><span>{{ sellerPrice(item.priceNaira) }}</span></li>
        </ul>
      </section>
      <section aria-labelledby="sp-hours">
        <h3 id="sp-hours">Hours</h3>
        <ul class="sp-hours"><li v-for="line in sorted" :key="line.day"><span>{{ line.day }}</span><span>{{ line.text }}</span></li></ul>
      </section>
      <p class="sp-who"><span class="sp-tier" :class="`is-${shop.badge.tier}`">{{ shop.badge.label }}</span> {{ shop.badge.name }}<template v-if="shop.badge.complaints"> · {{ shop.badge.complaints }} upheld {{ shop.badge.complaints === 1 ? 'complaint' : 'complaints' }} in 90 days</template></p>
      <p v-if="shop.payNotice" class="sp-warn" role="status">{{ shop.payNotice }}. Check it with the seller before you pay.</p>
      <div class="sp-actions">
        <button type="button" class="ui-button is-primary is-block" :disabled="busy !== ''" :aria-busy="busy === 'chat'" @click="go('chat')">Chat with the seller</button>
        <button v-if="shop.pay" type="button" class="ui-button is-block" :disabled="busy !== ''" :aria-busy="busy === 'pay'" @click="go('pay')">Pay the seller</button>
        <button type="button" class="ui-button is-quiet is-block" @click="reporting = {}">Report this shop</button>
      </div>
      <p class="sp-note">Chat and payment happen outside Allworld, on the seller’s own page. Allworld does not hold your money or take part in the deal.</p>
      <p v-if="note" role="status" class="sp-status">{{ note }}</p>
      <div v-if="needs === 'account'"><button type="button" class="ui-button is-block" @click="shell.open('account')">Sign in</button></div>
      <div v-if="needs === 'adult'"><button type="button" class="ui-button is-block" @click="declareAdult">I am 18 or older</button></div>
      <form v-if="reporting" class="sp-report" @submit.prevent="report">
        <fieldset>
          <legend>{{ reporting.photo ? 'Why are you reporting this photo?' : 'Why are you reporting this shop?' }}</legend>
          <label v-for="item in TRUST_REPORT_REASONS" :key="item"><input v-model="reason" type="radio" name="sp-reason" :value="item"> {{ TRUST_REPORT_WORDS[item] }}</label>
        </fieldset>
        <label>Anything else? (optional)<textarea v-model="detail" maxlength="300" rows="2" /></label>
        <button class="ui-button is-block is-danger" :disabled="!reason || busy !== ''">{{ busy === 'report' ? 'Sending…' : 'Send report' }}</button>
        <button type="button" class="ui-button is-quiet is-block" @click="reporting = null">Cancel</button>
      </form>
    </template>
    <LinkInterstitial v-if="leaving && shop" :link="leaving" :author-id="shop.badge.id" :author-name="shop.badge.name" @close="leaving = null" />
  </article>
</template>

<style scoped>
.sp { display: grid; gap: 12px; }
.sp h3 { margin: 0 0 4px; font-size: 15px; }
.sp-about { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
.sp-photos { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 140px), 1fr)); }
.sp-photos img { width: 100%; height: 120px; object-fit: cover; border-radius: 8px; background: rgb(0 0 0 / 8%); }
.sp-note { margin: 0; font-size: 12px; color: var(--c-faint, #6b737c); }
.sp-services, .sp-hours { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.sp-services li, .sp-hours li { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
.sp-services small { color: var(--c-faint, #6b737c); }
.sp-who { margin: 0; font-size: 13px; }
.sp-tier { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--c-fill, #eef1ef); }
.sp-tier.is-phone, .sp-tier.is-id, .sp-tier.is-business { background: #dff3e4; color: #135c2a; }
.sp-warn { margin: 0; padding: 8px 10px; border-radius: 8px; background: #fff3cd; color: #5c4400; font-size: 13px; }
.sp-actions { display: grid; gap: 8px; }
.sp-status { margin: 0; font-weight: 600; }
.sp-report { display: grid; gap: 8px; }
.sp-report fieldset { display: grid; gap: 6px; border: 0; padding: 0; margin: 0; }
.sp-report legend { font-weight: 600; margin-bottom: 4px; }
.sp-report label { display: grid; gap: 4px; font-size: 13px; }
</style>
