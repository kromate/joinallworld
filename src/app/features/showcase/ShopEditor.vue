<script setup lang="ts">
// My shop: a form with no code. Pick a look (template, two colours, a logo), write the sign, the about text, the services with
// your own prices, your hours, and your own chat link (and a payment link if you take payment). Add 3 to 6 photos, then send it
// for review; it is shown to others once a person has approved it. The card above the form is how buyers will see it.
// Prices are yours and are paid outside Allworld; nothing here takes or holds money.
import { computed, onMounted, reactive, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { SHOWCASE } from '../../../types/showcase.ts'
import type { ShowcaseMine } from '../../../types/showcase.ts'
import { cachedCityContent } from '../../../game/cities/registry.ts'
import { newClientId } from '../social/useSocial.ts'
import StorefrontCard from './StorefrontCard.vue'
import { CODE_WORDS, PRICE_NOTE, TEMPLATES, WEEKDAYS, categoryList, draftIssues, draftOf, emptyDraft, emptyService, iconList, inputOf, photoBody, photoUrl, preparePhoto, statusWords, templateList, wordsFor } from './showcaseModel.ts'

const props = defineProps<{ city: string; venue?: string }>()
const { game } = useApp()
const mine = ref<ShowcaseMine | null>(null)
const draft = reactive(emptyDraft(props.venue ?? ''))
const failed = ref('')
const note = ref('')
const busy = ref('')
// The markets of the city the player is in: the places that rent stalls.
const markets = computed(() => (cachedCityContent(props.city)?.venues ?? []).filter((item) => item.kind === 'market').map((item) => ({ id: item.id, name: item.name })))
const shop = computed(() => mine.value?.shop ?? null)
const issues = computed(() => draftIssues(draft))
const ids = new Map<string, string>()
const codeOf = (error: unknown): string | undefined => (error instanceof Error ? (error as { code?: string }).code : undefined)
const confirmRemove = ref(false)

function adopt(next: ShowcaseMine): void {
  mine.value = next
  if (next.shop) Object.assign(draft, draftOf(next.shop))
  else if (!draft.venue) draft.venue = markets.value[0]?.id ?? ''
}
async function load(): Promise<void> {
  failed.value = ''
  try { adopt(await game.fetchJson<ShowcaseMine>('/api/showcase/mine')) } catch (error) {
    const code = codeOf(error)
    failed.value = code === 'account_required' ? CODE_WORDS.account_required ?? '' : wordsFor(code, error instanceof Error ? error.message : 'Your shop could not load.')
  }
}
onMounted(load)

/** A write that keeps its request id until it is answered, so pressing again after a lost answer repeats the same request. */
async function send(what: string, path: string, body: Record<string, unknown>, done: string): Promise<boolean> {
  if (busy.value) return false
  busy.value = what; note.value = ''
  const clientId = ids.get(what) ?? newClientId()
  ids.set(what, clientId)
  try {
    await game.fetchJson(path, { method: 'POST', body: { clientId, ...body } })
    ids.delete(what); note.value = done
    await load()
    return true
  } catch (error) {
    if (codeOf(error) !== undefined) ids.delete(what)
    note.value = wordsFor(codeOf(error), error instanceof Error ? error.message : 'That did not work. Try again.')
    return false
  } finally { busy.value = '' }
}
const save = (): Promise<boolean> => send('save', '/api/showcase/mine', { expectedRevision: shop.value?.revision ?? 0, ...inputOf(draft, props.city) }, shop.value ? 'Saved.' : 'Saved. Now add photos.')
const submit = (): Promise<boolean> => send('submit', '/api/showcase/mine/submit', {}, 'Sent for review. It is shown to others once it has been approved.')
const hide = (hidden: boolean): Promise<boolean> => send('hide', '/api/showcase/mine/hide', { hidden }, hidden ? 'Hidden.' : 'Shown again.')
async function removeShop(): Promise<void> { if (await send('remove', '/api/showcase/mine/remove', {}, 'Your shop is removed and its stall is free.')) { Object.assign(draft, emptyDraft(props.venue ?? '')); confirmRemove.value = false } }
const removePhoto = (photo: string): Promise<boolean> => send(`photo-remove:${photo}`, '/api/showcase/mine/photos/remove', { photo }, 'Photo removed.')
async function declareAdult(): Promise<void> {
  try { await game.fetchJson('/api/growth/consent', { method: 'POST', body: { cityId: props.city, age: 'adult' } }); note.value = 'Thank you.'; await load() } catch (error) { note.value = error instanceof Error ? error.message : 'That did not work.' }
}
async function addPhotos(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  for (const file of files) {
    if ((shop.value?.photos.length ?? 0) >= SHOWCASE.photosMax) { note.value = CODE_WORDS.photo_limit ?? ''; break }
    busy.value = 'photo'; note.value = `Preparing ${file.name}…`
    const prepared = await preparePhoto(file)
    if (!prepared.ok) { note.value = prepared.reason; busy.value = ''; continue }
    try {
      const answer = await game.fetchJson<{ ok: boolean; code: string; reason?: string }>('/api/showcase/mine/photos', { method: 'POST', body: await photoBody(prepared.ready, newClientId()) })
      note.value = answer.ok ? 'Photo added.' : (answer.reason ?? wordsFor(answer.code, 'That photo was not accepted.'))
      await load()
    } catch (error) { note.value = wordsFor(codeOf(error), error instanceof Error ? error.message : 'That photo did not upload.') } finally { busy.value = '' }
  }
}
function pick(template: keyof typeof TEMPLATES): void {
  draft.template = template
  draft.colours = [...TEMPLATES[template].colours]
  draft.logo = TEMPLATES[template].icon
}
const preview = computed(() => {
  const prices = draft.services.map((item) => Number(item.price) || 0).filter((price) => price > 0)
  return { name: draft.name, sign: draft.sign, template: draft.template, colours: draft.colours, logo: draft.logo, category: draft.category, slot: shop.value?.slot ?? null, cover: shop.value?.photos.find((photo) => photo.approved && !photo.hidden)?.id ?? null, from: prices.length ? Math.min(...prices) : null }
})
const photoCount = computed(() => shop.value?.photos.length ?? 0)
const canSubmit = computed(() => shop.value !== null && photoCount.value >= SHOWCASE.photosMin && (shop.value.status === 'draft' || shop.value.status === 'hidden'))
</script>

<template>
  <div class="se" data-showcase-editor>
    <p v-if="failed" class="ui-error" role="alert">{{ failed }}</p>
    <p v-else-if="!mine" role="status">Loading…</p>
    <template v-else>
      <p v-if="shop" class="se-status" role="status" data-status>{{ statusWords(shop.status, photoCount, shop.note) }}</p>
      <section v-if="mine.blocked" class="se-block" aria-label="Before you can publish">
        <p>{{ wordsFor(mine.blocked, 'You cannot publish a shop yet.') }}</p>
        <button v-if="mine.blocked === 'adult_self_declaration_required'" type="button" class="ui-button is-block" @click="declareAdult">I am 18 or older</button>
      </section>
      <StorefrontCard :shop="preview" />

      <form class="se-form" @submit.prevent="save">
        <fieldset>
          <legend>Look</legend>
          <div class="se-choices" role="radiogroup" aria-label="Template">
            <label v-for="item in templateList" :key="item.id" :class="{ 'is-on': draft.template === item.id }"><input type="radio" name="se-template" :checked="draft.template === item.id" @change="pick(item.id)"> {{ item.label }}</label>
          </div>
          <div class="se-colours">
            <label>Sign colour<input v-model="draft.colours[0]" type="color"></label>
            <label>Card colour<input v-model="draft.colours[1]" type="color"></label>
          </div>
          <div class="se-choices" role="radiogroup" aria-label="Logo">
            <label v-for="item in iconList" :key="item.id" :class="{ 'is-on': draft.logo === item.id }" :title="item.label"><input v-model="draft.logo" type="radio" name="se-logo" :value="item.id" :aria-label="item.label"><span aria-hidden="true">{{ item.glyph }}</span></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>About your shop</legend>
          <label>Shop name<input v-model="draft.name" maxlength="40" autocomplete="off" required></label>
          <label>Sign (on the front of the shop)<input v-model="draft.sign" maxlength="24" autocomplete="off" required></label>
          <label>Kind<select v-model="draft.category"><option v-for="item in categoryList" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
          <label>Market<select v-model="draft.venue" required><option v-for="item in markets" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
          <label>Stall number (optional, 1 to {{ SHOWCASE.slotsPerVenue }}; first come, first served)<input v-model="draft.slot" inputmode="numeric" maxlength="2"></label>
          <label>About<textarea v-model="draft.about" rows="4" :maxlength="SHOWCASE.about" required /></label>
          <p class="se-hint">Write no phone numbers, e-mail addresses, chat handles, web addresses or home address in the text. Your chat link goes in its own box below.</p>
        </fieldset>
        <fieldset>
          <legend>Services</legend>
          <p class="se-hint">{{ PRICE_NOTE }}. Put your own price in naira, or leave it empty to say “ask the seller”.</p>
          <div v-for="(item, at) in draft.services" :key="at" class="se-service">
            <label>Service<input v-model="item.label" :maxlength="SHOWCASE.label"></label>
            <label>Your price (₦)<input v-model="item.price" inputmode="numeric"></label>
            <label>Note<input v-model="item.note" :maxlength="SHOWCASE.note"></label>
            <button type="button" class="ui-button is-quiet" :aria-label="`Remove service ${at + 1}`" @click="draft.services.splice(at, 1)">Remove</button>
          </div>
          <button v-if="draft.services.length < SHOWCASE.services" type="button" class="ui-button" @click="draft.services.push(emptyService())">Add a service</button>
        </fieldset>
        <fieldset>
          <legend>Hours</legend>
          <div v-for="(day, at) in draft.hours" :key="at" class="se-day">
            <label class="se-open"><input v-model="day.open" type="checkbox"> {{ WEEKDAYS[at] }}</label>
            <template v-if="day.open"><label>From<input v-model="day.from" type="time"></label><label>To<input v-model="day.to" type="time"></label></template>
            <span v-else>closed</span>
          </div>
        </fieldset>
        <fieldset>
          <legend>Where people reach you</legend>
          <label>Chat link (a link of your own where people can message you)<input v-model="draft.chat" type="url" inputmode="url" autocomplete="off" placeholder="Paste your chat link" required></label>
          <label>Payment link (optional: your own payment page)<input v-model="draft.pay" type="url" inputmode="url" autocomplete="off"></label>
          <p class="se-hint">These are only given to signed-in adults who press Chat or Pay, after a screen that says they are leaving Allworld. Changing your shop’s name or either link sends it back for review. A changed payment link shows “Payment details changed recently” for 7 days.</p>
        </fieldset>
        <ul v-if="issues.length" class="se-issues" aria-label="Still to do"><li v-for="line in issues" :key="line">{{ line }}</li></ul>
        <button class="ui-button is-primary is-block" :disabled="busy !== '' || issues.length > 0 || mine.blocked !== null">{{ busy === 'save' ? 'Saving…' : shop ? 'Save changes' : 'Save my shop' }}</button>
      </form>

      <section v-if="shop" class="se-photos" aria-labelledby="se-photos-h">
        <h3 id="se-photos-h">Photos ({{ photoCount }} of {{ SHOWCASE.photosMin }} to {{ SHOWCASE.photosMax }})</h3>
        <p class="se-hint">Real photos of your work. They are shrunk on your device and stripped of camera details. You can add {{ mine.uploadsLeft }} more today. A new shop’s photos are shown after the first review.</p>
        <ul class="se-thumbs">
          <li v-for="(photo, at) in shop.photos" :key="photo.id">
            <img :src="photoUrl(photo.id)" :alt="`Your photo ${at + 1}`" width="96" height="96">
            <small v-if="photo.hidden">Hidden after reports</small><small v-else-if="!photo.approved">Waiting for review</small>
            <button type="button" class="ui-button is-quiet" :aria-label="`Remove photo ${at + 1}`" :disabled="busy !== ''" @click="removePhoto(photo.id)">Remove</button>
          </li>
        </ul>
        <label v-if="photoCount < SHOWCASE.photosMax" class="se-file">Add photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple :disabled="busy !== ''" @change="addPhotos"></label>
      </section>

      <div v-if="shop" class="se-actions">
        <button v-if="canSubmit" type="button" class="ui-button is-primary is-block" :disabled="busy !== ''" @click="submit">Send for review</button>
        <button v-if="shop.status === 'live' || shop.status === 'review'" type="button" class="ui-button is-block" :disabled="busy !== ''" @click="hide(true)">Hide my shop</button>
        <button v-if="shop.status === 'hidden'" type="button" class="ui-button is-block" :disabled="busy !== ''" @click="hide(false)">Show my shop again</button>
        <label class="se-confirm"><input v-model="confirmRemove" type="checkbox"> I want to remove my shop and its photos</label>
        <button type="button" class="ui-button is-danger is-block" :disabled="!confirmRemove || busy !== ''" @click="removeShop">Remove my shop</button>
      </div>
      <p v-if="note" class="se-note" role="status" data-note>{{ note }}</p>
    </template>
  </div>
</template>

<style scoped>
.se { display: grid; gap: 12px; }
.se-status { margin: 0; padding: 8px 10px; border-radius: 8px; background: var(--c-fill, #eef1ef); font-weight: 600; font-size: 14px; }
.se-block { padding: 10px; border-radius: 8px; background: #fff3cd; color: #5c4400; display: grid; gap: 8px; }
.se-block p { margin: 0; }
.se-form, .se fieldset { display: grid; gap: 10px; }
.se fieldset { border: 1px solid rgb(0 0 0 / 14%); border-radius: 10px; padding: 10px; margin: 0; min-width: 0; }
.se legend { font-weight: 600; padding: 0 4px; }
.se label { display: grid; gap: 3px; font-size: 13px; min-width: 0; }
.se input:not([type='checkbox'], [type='radio'], [type='color']), .se select, .se textarea { min-height: 40px; font: inherit; width: 100%; box-sizing: border-box; }
.se-choices { display: flex; flex-wrap: wrap; gap: 6px; }
.se-choices label { display: flex; align-items: center; gap: 4px; min-height: 40px; padding: 0 10px; border: 1px solid rgb(0 0 0 / 16%); border-radius: 999px; }
.se-choices label.is-on { border-color: var(--c-focus, #2a6fdb); background: var(--c-fill, #eef1ef); font-weight: 600; }
.se-colours { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.se-hint { margin: 0; font-size: 12px; color: var(--c-faint, #6b737c); }
.se-service { display: grid; gap: 6px; padding-bottom: 8px; border-bottom: 1px solid rgb(0 0 0 / 8%); }
.se-day { display: grid; grid-template-columns: minmax(0, 1.4fr) 1fr 1fr; gap: 6px; align-items: end; }
.se-day .se-open { grid-template-columns: auto 1fr; align-items: center; }
.se-issues { margin: 0; padding-left: 18px; font-size: 13px; color: var(--c-red, #b3261e); }
.se-thumbs { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 10px; }
.se-thumbs li { display: grid; gap: 2px; justify-items: start; max-width: 96px; }
.se-thumbs img { width: 96px; height: 96px; object-fit: cover; border-radius: 8px; background: rgb(0 0 0 / 8%); }
.se-thumbs small { font-size: 11px; }
.se-file input { font: inherit; }
.se-actions { display: grid; gap: 8px; }
.se-confirm { display: flex !important; align-items: center; gap: 8px; }
.se-note { margin: 0; font-weight: 600; }
@media (max-width: 360px) { .se-colours { grid-template-columns: 1fr; } }
</style>
