<script setup lang="ts">
// My shop: six steps with no code (Look, About, Services, Hours, Photos, Contact and payment) and a preview of the shop exactly as
// buyers will see it: beside the form on a wide screen, behind "Preview my shop" on a phone. Prices are yours and are paid outside
// Allworld; nothing here takes or holds money. A refusal is shown beside the field it is about, the first problem gets the focus,
// and a short summary sits by the Save button. The editor keeps itself in step with the server (an approval changes the shop's
// revision): it refreshes on focus and before every save, and only a real clash of the same text asks the seller to choose.
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { SHOWCASE } from '../../../types/showcase.ts'
import type { ShowcaseMine } from '../../../types/showcase.ts'
import { cachedCityContent } from '../../../game/cities/registry.ts'
import SkeletonRows from '../../ui/SkeletonRows.vue'
import { newClientId } from '../social/useSocial.ts'
import FieldRow from './FieldRow.vue'
import PhotoManager from './PhotoManager.vue'
import ShopFront from './ShopFront.vue'
import { CODE_WORDS, DRAFT_PARTS, PRICE_NOTE, TEMPLATES, WEEKDAYS, adultConsentBody, categoryList, draftClashes, draftOf, draftProblems, emptyDraft, emptyService, iconList, inputOf, mergeDraft, refusalProblem, statusWords, templateList, wordsFor } from './showcaseModel.ts'
import type { Problem, ShopDraft, ShopFace } from './showcaseModel.ts'

const props = defineProps<{ city: string; venue?: string }>()
const { game } = useApp()
const mine = ref<ShowcaseMine | null>(null)
const draft = reactive(emptyDraft(props.venue ?? ''))
const failed = ref('')
const note = ref('')
const busy = ref('')
const view = ref<'edit' | 'preview'>('edit')
const confirmRemove = ref(false)
const errors = reactive<Record<string, string>>({})
const summary = ref<Problem[]>([])
const stale = ref<{ latest: ShowcaseMine; clash: (keyof ShopDraft)[] } | null>(null)
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
/** The draft as the server last had it: what "the seller changed this" is measured against. */
let base: ShopDraft = clone(draft)
const ids = new Map<string, string>()
const codeOf = (error: unknown): string | undefined => (error instanceof Error ? (error as { code?: string }).code : undefined)

const shop = computed(() => mine.value?.shop ?? null)
/** A shop is in the city it was opened in; a new one is in the city the player is in. */
const cityId = computed(() => shop.value?.city ?? props.city)
const markets = computed(() => {
  const list = (cachedCityContent(cityId.value)?.venues ?? []).filter((item) => item.kind === 'market').map((item) => ({ id: item.id, name: item.name }))
  return draft.venue && !list.some((item) => item.id === draft.venue) ? [...list, { id: draft.venue, name: draft.venue }] : list
})
const photos = computed(() => shop.value?.photos ?? [])
const photoCount = computed(() => photos.value.length)
const canSubmit = computed(() => shop.value !== null && photoCount.value >= SHOWCASE.photosMin && (shop.value.status === 'draft' || shop.value.status === 'hidden'))
const problems = computed(() => draftProblems(draft))
const dirty = computed(() => JSON.stringify(draft) !== JSON.stringify(base))
const done = computed(() => {
  const bad = new Set(problems.value.map((item) => item.field.split('-')[0]))
  return { look: true, about: !bad.has('name') && !bad.has('venue') && !bad.has('sign') && !bad.has('about'), services: !bad.has('service'), hours: !bad.has('hours'), photos: photoCount.value >= SHOWCASE.photosMin, contact: !bad.has('chat') }
})

// What buyers will see, drawn from the draft (the same component as the shop page).
const face = computed<ShopFace>(() => {
  const input = inputOf(draft, cityId.value)
  const slot = shop.value?.slot ?? input.slot ?? null
  return {
    name: input.name, sign: input.sign, template: input.template, colours: input.colours, logo: input.logo, category: input.category, city: cityId.value, venue: input.venue, slot, about: input.about,
    hours: input.hours, photos: photos.value.filter((photo) => !photo.hidden).map((photo) => ({ id: photo.id, w: photo.w, h: photo.h, ...(photo.caption ? { caption: photo.caption } : {}) })), serviceList: input.services, pay: input.pay !== null && input.pay !== undefined, badge: null, payNotice: null,
  }
})

function setBase(next: ShopDraft): void { base = clone(next) }
/** Take the server's shop as the form: used when nothing here is unsaved, or after a save. */
function adopt(next: ShowcaseMine): void {
  mine.value = next
  if (next.shop) { Object.assign(draft, draftOf(next.shop)); setBase(draft) } else if (!draft.venue) { draft.venue = markets.value[0]?.id ?? ''; setBase(draft) }
}
async function fetchMine(): Promise<ShowcaseMine> { return game.fetchJson<ShowcaseMine>('/api/showcase/mine') }
async function load(): Promise<void> {
  failed.value = ''
  try { adopt(await fetchMine()) } catch (error) {
    const code = codeOf(error)
    failed.value = code === 'account_required' ? CODE_WORDS.account_required ?? '' : wordsFor(code, error instanceof Error ? error.message : 'Your shop could not load.')
  }
}
/**
 * Bring the revision (and everything the seller did not touch) up to date. What the seller changed here stays. Only a part that was
 * changed here and, to something else, on the server asks them to choose. True: nothing is in the way of saving.
 */
async function refresh(): Promise<boolean> {
  let latest: ShowcaseMine
  try { latest = await fetchMine() } catch { return true }
  if (!latest.shop) { mine.value = latest; return true }
  const next = draftOf(latest.shop)
  const clash = draftClashes(base, draft, next)
  if (clash.length) { stale.value = { latest, clash }; return false }
  mine.value = latest
  Object.assign(draft, mergeDraft(base, draft, next)); setBase(next); stale.value = null
  return true
}
function loadLatest(): void {
  const pending = stale.value
  if (!pending?.latest.shop) return
  const next = draftOf(pending.latest.shop)
  mine.value = pending.latest
  Object.assign(draft, mergeDraft(base, draft, next)); setBase(next); stale.value = null
  note.value = 'Loaded the latest. Your unsaved changes are still in the form: check them, then save.'
}
const staleWords = computed(() => (stale.value ? `Your shop changed somewhere else, and you changed ${stale.value.clash.map((part) => DRAFT_PARTS[part]).join(', ')} here too.` : ''))

function onFocus(): void { if (shop.value && !busy.value && document.visibilityState !== 'hidden') void refresh() }
onMounted(() => { void load(); window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus) })
onBeforeUnmount(() => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) })

// ---- problems, beside their fields -------------------------------------------------------------------------------------
const reduced = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
function focusField(field: string): void {
  const node = document.getElementById(`se-f-${field}`) ?? document.getElementById(`se-s-${field}`) ?? document.getElementById('se-summary')
  if (!node) return
  node.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' })
  node.focus({ preventScroll: true })
}
function show(list: Problem[]): void {
  for (const key of Object.keys(errors)) delete errors[key]
  for (const item of list) errors[item.field] ??= item.message
  summary.value = list
  const first = list[0]
  if (first) { view.value = 'edit'; setTimeout(() => focusField(first.field), 0) }
}
// Editing clears what was said about a field that is now fine. A refusal from the server is about the text as it was sent, so it goes at the next edit.
watch(draft, () => {
  if (!summary.value.length) return
  const now = new Set(problems.value.map((item) => item.field))
  const kept = summary.value.filter((item) => now.has(item.field))
  if (kept.length === summary.value.length) return
  summary.value = kept
  for (const key of Object.keys(errors)) if (!kept.some((item) => item.field === key)) delete errors[key]
}, { deep: true })

// ---- writes ----------------------------------------------------------------------------------------------------------------
interface Answer { ok: boolean; code?: string; message: string }
/** One write. It keeps its request id until it is answered, so pressing again after a lost answer repeats the same request. */
async function post(what: string, path: string, body: Record<string, unknown>): Promise<Answer> {
  const clientId = ids.get(what) ?? newClientId()
  ids.set(what, clientId)
  try {
    await game.fetchJson(path, { method: 'POST', body: { clientId, ...body } })
    ids.delete(what)
    return { ok: true, message: '' }
  } catch (error) {
    const code = codeOf(error)
    if (code !== undefined) ids.delete(what)
    return { ok: false, ...(code ? { code } : {}), message: wordsFor(code, error instanceof Error ? error.message : 'That did not work. Try again.') }
  }
}
async function send(what: string, path: string, body: Record<string, unknown>, ok: string): Promise<boolean> {
  if (busy.value) return false
  busy.value = what; note.value = ''
  try {
    const answer = await post(what, path, body)
    if (!answer.ok) { note.value = answer.message; if (answer.code === 'revision_conflict') await refresh(); return false }
    note.value = ok
    await refresh()
    return true
  } finally { busy.value = '' }
}
async function save(): Promise<void> {
  if (busy.value) return
  note.value = ''
  const list = problems.value
  show(list)
  if (list.length) return
  busy.value = 'save'
  try {
    if (shop.value && !(await refresh())) { note.value = 'Not saved. Load the latest first.'; return }
    const body = (): Record<string, unknown> => ({ expectedRevision: shop.value?.revision ?? 0, ...inputOf(draft, cityId.value) })
    let answer = await post('save', '/api/showcase/mine', body())
    // The revision moved between the refresh and the save: take the new one once and try again.
    if (!answer.ok && answer.code === 'revision_conflict' && (await refresh())) answer = await post('save', '/api/showcase/mine', body())
    if (!answer.ok) {
      if (answer.code === 'revision_conflict') { note.value = 'Not saved. Load the latest first.'; return }
      const problem = refusalProblem(answer.code, draft, answer.message) ?? { field: 'save', message: answer.message }
      show([problem]); note.value = `Not saved. ${problem.message}`
      return
    }
    const wasNew = shop.value === null
    const next = await fetchMine().catch(() => null)
    if (next) adopt(next)
    note.value = wasNew ? 'Saved. Now add photos.' : 'Saved.'
    show([])
  } finally { busy.value = '' }
}
const submit = (): Promise<boolean> => send('submit', '/api/showcase/mine/submit', {}, 'Sent for review. It is shown to others once it has been approved.')
const hide = (hidden: boolean): Promise<boolean> => send('hide', '/api/showcase/mine/hide', { hidden }, hidden ? 'Hidden.' : 'Shown again.')
async function removeShop(): Promise<void> { if (await send('remove', '/api/showcase/mine/remove', {}, 'Your shop is removed and its stall is free.')) { Object.assign(draft, emptyDraft(props.venue ?? '')); setBase(draft); confirmRemove.value = false } }
const removePhoto = (photo: string): Promise<boolean> => send(`photo-remove:${photo}`, '/api/showcase/mine/photos/remove', { photo }, 'Photo removed.')
const arrange = (change: { order: string[]; captions?: Record<string, string> }): Promise<boolean> => send('photo-arrange', '/api/showcase/mine/photos/arrange', change, 'Photos updated.')
async function declareAdult(): Promise<void> {
  try { await game.fetchJson('/api/growth/consent', { method: 'POST', body: adultConsentBody(props.city) }); note.value = 'Thank you.'; await refresh() } catch (error) { note.value = error instanceof Error ? error.message : 'That did not work.' }
}
function pick(template: keyof typeof TEMPLATES): void {
  draft.template = template
  draft.colours = [...TEMPLATES[template].colours]
  draft.logo = TEMPLATES[template].icon
}
function jump(step: string): void { document.getElementById(`se-s-${step}`)?.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }) }
const STEPS = [['look', 'Look'], ['about', 'About'], ['services', 'Services'], ['hours', 'Hours'], ['photos', 'Photos'], ['contact', 'Contact and payment']] as const
</script>

<template>
  <div class="se" :data-view="view" data-showcase-editor>
    <p v-if="failed" class="ui-error" role="alert">{{ failed }}</p>
    <SkeletonRows v-else-if="!mine" :rows="3" label="Loading your shop" />
    <template v-else>
      <p v-if="shop" class="se-status" role="status" data-status>{{ statusWords(shop.status, photoCount, shop.note) }}</p>
      <section v-if="mine.blocked" class="se-block" aria-label="Before you can publish">
        <p>{{ wordsFor(mine.blocked, 'You cannot publish a shop yet.') }}</p>
        <button v-if="mine.blocked === 'adult_self_declaration_required'" type="button" class="ui-button is-block" @click="declareAdult">I am 18 or older</button>
      </section>
      <section v-if="stale" class="se-stale" role="alert" aria-label="Your shop changed somewhere else">
        <p>{{ staleWords }} Your unsaved changes stay in the form.</p>
        <button type="button" class="ui-button is-primary is-small" @click="loadLatest">Load the latest</button>
      </section>
      <div class="se-toggle" role="group" aria-label="Edit or preview">
        <button type="button" :class="{ 'is-on': view === 'edit' }" :aria-pressed="view === 'edit'" @click="view = 'edit'">Edit</button>
        <button type="button" :class="{ 'is-on': view === 'preview' }" :aria-pressed="view === 'preview'" @click="view = 'preview'">Preview my shop</button>
      </div>

      <div class="se-grid">
        <div class="se-edit">
          <nav class="se-steps" aria-label="Steps">
            <button v-for="(step, at) in STEPS" :key="step[0]" type="button" :class="{ 'is-done': done[step[0]] }" @click="jump(step[0])"><span aria-hidden="true">{{ at + 1 }}</span> {{ step[1] }}<span v-if="done[step[0]]" class="se-sr"> (done)</span></button>
          </nav>
          <form class="se-form" novalidate @submit.prevent="save">
            <section id="se-s-look" class="se-step" aria-labelledby="se-h-look" tabindex="-1">
              <h3 id="se-h-look"><span aria-hidden="true">1</span> Look</h3>
              <p class="se-help">Pick a style. It sets the sign, the colours and the logo, and you can change any of them.</p>
              <div class="se-choices" role="radiogroup" aria-label="Style">
                <label v-for="item in templateList" :key="item.id" :class="{ 'is-on': draft.template === item.id }"><input type="radio" name="se-template" :checked="draft.template === item.id" @change="pick(item.id)"> {{ item.label }}</label>
              </div>
              <div class="se-colours">
                <label>Sign colour<input v-model="draft.colours[0]" type="color"></label>
                <label>Card colour<input v-model="draft.colours[1]" type="color"></label>
              </div>
              <div class="se-choices" role="radiogroup" aria-label="Logo">
                <label v-for="item in iconList" :key="item.id" :class="{ 'is-on': draft.logo === item.id }" :title="item.label"><input v-model="draft.logo" type="radio" name="se-logo" :value="item.id" :aria-label="item.label"><span aria-hidden="true">{{ item.glyph }}</span></label>
              </div>
            </section>

            <section id="se-s-about" class="se-step" aria-labelledby="se-h-about" tabindex="-1">
              <h3 id="se-h-about"><span aria-hidden="true">2</span> About your shop</h3>
              <FieldRow v-slot="a" field="name" label="Shop name" :error="errors.name"><input v-bind="a" v-model="draft.name" :maxlength="SHOWCASE.name.max" autocomplete="off"></FieldRow>
              <FieldRow v-slot="a" field="sign" label="Sign (on the front of the shop)" :hint="`Up to ${SHOWCASE.sign} letters.`" :error="errors.sign"><input v-bind="a" v-model="draft.sign" :maxlength="SHOWCASE.sign" autocomplete="off"></FieldRow>
              <FieldRow v-slot="a" field="category" label="Kind of shop"><select v-bind="a" v-model="draft.category"><option v-for="item in categoryList" :key="item.id" :value="item.id">{{ item.label }}</option></select></FieldRow>
              <FieldRow v-slot="a" field="venue" label="Market" :error="errors.venue"><select v-bind="a" v-model="draft.venue"><option v-for="item in markets" :key="item.id" :value="item.id">{{ item.name }}</option></select></FieldRow>
              <FieldRow v-slot="a" field="slot" label="Stall number (optional)" :hint="`1 to ${SHOWCASE.slotsPerVenue}. First come, first served; leave it empty to get the lowest free one.`" :error="errors.slot"><input v-bind="a" v-model="draft.slot" inputmode="numeric" maxlength="2"></FieldRow>
              <FieldRow v-slot="a" field="about" label="About" hint="Write no phone numbers, e-mail addresses, chat handles, web addresses or home address in the text. Your chat link goes in its own box below." :error="errors.about"><textarea v-bind="a" v-model="draft.about" rows="5" :maxlength="SHOWCASE.about" /></FieldRow>
              <p class="se-count" aria-hidden="true">{{ draft.about.length }} of {{ SHOWCASE.about }}</p>
            </section>

            <section id="se-s-services" class="se-step" aria-labelledby="se-h-services" tabindex="-1">
              <h3 id="se-h-services"><span aria-hidden="true">3</span> Services and prices</h3>
              <p class="se-help">{{ PRICE_NOTE }}. Put your own price in naira, or leave it empty to say “Ask the seller”.</p>
              <div v-for="(item, at) in draft.services" :key="at" class="se-service">
                <FieldRow v-slot="a" :field="`service-${at}-label`" :label="`Service ${at + 1}`" :error="errors[`service-${at}-label`]"><input v-bind="a" v-model="item.label" :maxlength="SHOWCASE.label" autocomplete="off"></FieldRow>
                <FieldRow v-slot="a" :field="`service-${at}-price`" label="Your price (₦)" :error="errors[`service-${at}-price`]"><input v-bind="a" v-model="item.price" inputmode="numeric" autocomplete="off"></FieldRow>
                <FieldRow v-slot="a" :field="`service-${at}-note`" label="A line about it (optional)" :error="errors[`service-${at}-note`]"><input v-bind="a" v-model="item.note" :maxlength="SHOWCASE.note" autocomplete="off"></FieldRow>
                <button type="button" class="ui-button is-quiet is-small se-remove" :aria-label="`Remove service ${at + 1}`" @click="draft.services.splice(at, 1)">Remove</button>
              </div>
              <button v-if="draft.services.length < SHOWCASE.services" type="button" class="ui-button" @click="draft.services.push(emptyService())">Add a service</button>
            </section>

            <section id="se-s-hours" class="se-step" aria-labelledby="se-h-hours" tabindex="-1">
              <h3 id="se-h-hours"><span aria-hidden="true">4</span> Opening hours</h3>
              <div v-for="(day, at) in draft.hours" :key="at" class="se-day" :class="{ 'has-error': errors[`hours-${at}`] }">
                <label class="se-open"><input v-model="day.open" type="checkbox"> {{ WEEKDAYS[at] }}</label>
                <template v-if="day.open">
                  <label class="se-time">From<input :id="`se-f-hours-${at}`" v-model="day.from" type="time" :aria-invalid="errors[`hours-${at}`] ? 'true' : undefined" :aria-describedby="errors[`hours-${at}`] ? `se-e-hours-${at}` : undefined"></label>
                  <label class="se-time">To<input v-model="day.to" type="time" :aria-invalid="errors[`hours-${at}`] ? 'true' : undefined" :aria-describedby="errors[`hours-${at}`] ? `se-e-hours-${at}` : undefined"></label>
                </template>
                <span v-else class="se-closed">Closed</span>
                <p v-if="errors[`hours-${at}`]" :id="`se-e-hours-${at}`" class="se-day-error" role="alert">{{ errors[`hours-${at}`] }}</p>
              </div>
            </section>

            <section id="se-s-photos" class="se-step" aria-labelledby="se-h-photos" tabindex="-1">
              <h3 id="se-h-photos"><span aria-hidden="true">5</span> Photos ({{ photoCount }} of {{ SHOWCASE.photosMin }} to {{ SHOWCASE.photosMax }})</h3>
              <p class="se-help">Real photos of your work. The first one is the cover that people see in the list. They are shrunk on your device and stripped of camera details. A new shop’s photos are shown after the first review.</p>
              <p v-if="errors.photos" id="se-e-photos" class="se-day-error" role="alert">{{ errors.photos }}</p>
              <PhotoManager v-if="shop" :photos="photos" :uploads-left="mine.uploadsLeft" :busy="busy !== ''" @arrange="arrange" @remove="removePhoto" @changed="refresh" />
              <p v-else class="se-help">Save your shop first (the button below), then add photos here.</p>
            </section>

            <section id="se-s-contact" class="se-step" aria-labelledby="se-h-contact" tabindex="-1">
              <h3 id="se-h-contact"><span aria-hidden="true">6</span> Contact and payment</h3>
              <FieldRow v-slot="a" field="chat" label="Chat link" hint="Paste the link where people can message you. In your messaging app, look for “Share link” or “Copy chat link”." :error="errors.chat"><input v-bind="a" v-model="draft.chat" type="url" inputmode="url" autocomplete="off" placeholder="Paste your chat link"></FieldRow>
              <FieldRow v-slot="a" field="pay" label="Payment link (optional)" hint="Only if you take payment online: paste the link to your own payment page. Leave it empty if people pay you another way." :error="errors.pay"><input v-bind="a" v-model="draft.pay" type="url" inputmode="url" autocomplete="off"></FieldRow>
              <p class="se-help">Your links are never shown on the shop. They are given only to signed-in adults who press Chat or Pay, after a screen that says they are leaving Allworld. Changing your shop’s name or either link sends it back for review. A changed payment link shows “Payment details changed recently” for 7 days.</p>
            </section>

            <div class="se-save">
              <div v-if="summary.length" id="se-summary" class="se-summary" role="alert" tabindex="-1">
                <p>Not saved. {{ summary.length === 1 ? 'One thing to fix:' : `${summary.length} things to fix:` }}</p>
                <ul><li v-for="item in summary" :key="item.field + item.message"><button type="button" class="se-link" @click="focusField(item.field)">{{ item.message }}</button></li></ul>
              </div>
              <button class="ui-button is-primary is-block" :class="{ 'is-loading': busy === 'save' }" :disabled="busy !== '' || mine.blocked !== null" :aria-describedby="summary.length ? 'se-summary' : undefined">{{ busy === 'save' ? 'Saving…' : shop ? 'Save changes' : 'Save my shop' }}</button>
              <p v-if="dirty && !summary.length" class="se-help">You have changes that are not saved yet.</p>
              <p v-if="note" class="se-note" role="status" data-note>{{ note }}</p>
            </div>
          </form>

          <div v-if="shop" class="se-actions">
            <button v-if="canSubmit" type="button" class="ui-button is-primary is-block" :disabled="busy !== ''" @click="submit">Send for review</button>
            <button v-if="shop.status === 'live' || shop.status === 'review'" type="button" class="ui-button is-block" :disabled="busy !== ''" @click="hide(true)">Hide my shop</button>
            <button v-if="shop.status === 'hidden'" type="button" class="ui-button is-block" :disabled="busy !== ''" @click="hide(false)">Show my shop again</button>
            <label class="se-confirm"><input v-model="confirmRemove" type="checkbox"> I want to remove my shop and its photos</label>
            <button type="button" class="ui-button is-danger is-block" :disabled="!confirmRemove || busy !== ''" @click="removeShop">Remove my shop</button>
          </div>
        </div>

        <aside class="se-preview" aria-label="Preview of your shop">
          <p class="se-help">This is how buyers will see your shop.</p>
          <ShopFront :shop="face" badge-note="Your name and trust badge show here once the shop is live." />
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.se { display: grid; gap: var(--s-3); container-type: inline-size; min-width: 0; }
.se-status { margin: 0; padding: 8px 10px; border-radius: var(--r-sm); background: var(--c-fill); font-weight: 600; font-size: 14px; }
.se-block { padding: 10px; border-radius: var(--r-sm); background: var(--c-amber-soft); color: var(--c-amber-dark); display: grid; gap: 8px; }
.se-block p, .se-stale p { margin: 0; }
.se-stale { padding: 10px; border-radius: var(--r-sm); background: var(--c-blue-soft); color: #1d3f9a; display: grid; gap: 8px; justify-items: start; }
.se-toggle { display: flex; gap: 6px; }
.se-toggle button { flex: 1; min-height: var(--tap); border: 1px solid var(--c-line); border-radius: var(--r-md); background: #fff; font: inherit; font-weight: 600; color: var(--c-ink-2); }
.se-toggle button.is-on { background: var(--c-night); color: #fff; border-color: var(--c-night); }
.se-toggle button:focus-visible, .se-steps button:focus-visible, .se-link:focus-visible { outline: var(--focus); outline-offset: 2px; }
.se-grid { display: grid; gap: var(--s-4); min-width: 0; }
.se[data-view='edit'] .se-preview, .se[data-view='preview'] .se-edit { display: none; }
.se-edit, .se-preview { min-width: 0; display: grid; gap: var(--s-3); align-content: start; }
.se-steps { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
.se-steps button { flex: none; min-height: 40px; padding: 0 12px; border: 1px solid var(--c-line); border-radius: var(--r-pill); background: #fff; font: inherit; font-size: var(--t-small); font-weight: 600; color: var(--c-ink-2); white-space: nowrap; }
.se-steps button span[aria-hidden] { display: inline-grid; place-items: center; width: 20px; height: 20px; margin-right: 4px; border-radius: 50%; background: var(--c-fill-2); font-size: var(--t-micro); }
.se-steps button.is-done span[aria-hidden] { background: var(--c-green); color: #fff; }
.se-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.se-form { display: grid; gap: var(--s-4); }
.se-step { display: grid; gap: var(--s-3); padding: var(--s-4); border: 1px solid var(--c-line); border-radius: var(--r-md); background: #fff; min-width: 0; scroll-margin-top: 8px; }
.se-step:focus { outline: none; }
.se-step h3 { margin: 0; display: flex; align-items: center; gap: 8px; font-size: var(--t-title); color: var(--c-ink); text-transform: none; letter-spacing: 0; }
.se-step h3 span { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--c-night); color: #fff; font-size: var(--t-small); flex: none; }
.se-help { margin: 0; font-size: var(--t-small); line-height: 1.45; color: var(--c-muted); }
.se-count { margin: -8px 0 0; text-align: right; font-size: var(--t-micro); color: var(--c-muted); }
.se input:not([type='checkbox'], [type='radio'], [type='color']), .se select, .se textarea { min-height: 44px; font: inherit; width: 100%; box-sizing: border-box; }
.se-choices { display: flex; flex-wrap: wrap; gap: 6px; }
.se-choices label { display: flex; align-items: center; gap: 4px; min-height: 44px; padding: 0 12px; border: 1px solid var(--c-line); border-radius: var(--r-pill); font-size: var(--t-body); background: #fff; }
.se-choices label.is-on { border-color: var(--c-green-dark); background: var(--c-green-soft); font-weight: 600; }
.se-colours { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.se-colours label { display: grid; gap: 3px; font-size: var(--t-small); font-weight: 600; }
.se-service { display: grid; gap: var(--s-2); padding: var(--s-3); border: 1px solid var(--c-line); border-radius: var(--r-sm); background: var(--c-canvas); }
.se-remove { justify-self: end; }
.se-day { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 8px; align-items: end; padding: 6px 0; border-top: 1px solid var(--c-line); }
.se-day:first-of-type { border-top: 0; }
.se-day .se-open { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; min-height: 36px; font-size: var(--t-body); font-weight: 600; }
.se-time { display: grid; gap: 2px; min-width: 0; font-size: var(--t-small); }
.se-time input { min-width: 0; }
.se-closed { grid-column: 1 / -1; font-size: var(--t-small); color: var(--c-muted); }
.se-day-error { grid-column: 1 / -1; margin: 0; font-size: var(--t-body); font-weight: 600; color: var(--c-red-dark); }
.se-day.has-error input[type='time'] { border-color: var(--c-red); }
.se-save { display: grid; gap: var(--s-2); }
.se-summary { padding: 10px 12px; border-radius: var(--r-sm); background: var(--c-red-soft); color: var(--c-red-dark); }
.se-summary p { margin: 0 0 4px; font-weight: 700; }
.se-summary ul { margin: 0; padding-left: 18px; font-size: var(--t-body); }
.se-link { padding: 4px 0; min-height: 32px; border: 0; background: none; color: inherit; font: inherit; text-align: left; text-decoration: underline; cursor: pointer; }
.se-note { margin: 0; font-weight: 600; }
.se-actions { display: grid; gap: 8px; }
.se-confirm { display: flex; align-items: center; gap: 8px; font-size: var(--t-body); }
@container (min-width: 720px) {
  .se-toggle { display: none; }
  .se[data-view] .se-preview, .se[data-view] .se-edit { display: grid; }
  .se-grid { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); align-items: start; }
  .se-preview { position: sticky; top: 8px; max-height: calc(100 * var(--ui-vh) - 24px); overflow-y: auto; }
  .se-day { grid-template-columns: minmax(0, 1.2fr) 1fr 1fr; }
  .se-day .se-open { grid-column: auto; }
}
</style>
