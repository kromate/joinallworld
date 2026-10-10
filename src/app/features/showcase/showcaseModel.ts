// Showcase shops, the browser's side: paths, the storefront templates and icons, the editor's draft and its checks, the words
// for every state and refusal, and the photo shrink. Pure apart from preparePhoto. The rules are the server's (docs/SHOWCASE.md):
// these checks only save a round trip. Nothing here is in src/game, so none of it is in the first download.
import { SHOWCASE, SHOWCASE_CATEGORIES, SHOWCASE_ICONS, SHOWCASE_TEMPLATES } from '../../../types/showcase.ts'
import type { ShowcaseCategory, ShowcaseHours, ShowcaseIcon, ShowcaseInput, ShowcaseMine, ShowcaseService, ShowcaseStatus, ShowcaseTemplate } from '../../../types/showcase.ts'
import { cachedCityContent, cityName, cityRules } from '../../../game/cities/registry.ts'
import type { TrustBadge } from '../../../game/trust/index.ts'
import { fitWithin, refusalFor, toBase64 } from '../messages/pictureModel.ts'

export const CATEGORY_LABELS: Record<ShowcaseCategory, string> = {
  salon: 'Hair and salon', tailor: 'Tailoring', tech: 'Tech and phones', food: 'Food and catering', beauty: 'Beauty', photography: 'Photography', repair: 'Repairs',
  tutoring: 'Lessons', crafts: 'Crafts', cleaning: 'Cleaning', events: 'Events', other: 'Other',
}
export const ICON_GLYPHS: Record<ShowcaseIcon, { glyph: string; label: string }> = {
  scissors: { glyph: '✂️', label: 'Scissors' }, needle: { glyph: '🧵', label: 'Thread' }, laptop: { glyph: '💻', label: 'Laptop' }, pot: { glyph: '🍲', label: 'Pot' }, camera: { glyph: '📷', label: 'Camera' },
  wrench: { glyph: '🔧', label: 'Wrench' }, book: { glyph: '📖', label: 'Book' }, brush: { glyph: '🖌️', label: 'Brush' }, broom: { glyph: '🧹', label: 'Broom' }, star: { glyph: '⭐', label: 'Star' },
  gift: { glyph: '🎁', label: 'Gift' }, music: { glyph: '🎵', label: 'Music' },
}
/** A storefront: its two starting colours and how the card is laid out. No art; the card is drawn from these. */
export interface TemplateSpec { label: string; layout: 'banner' | 'stacked' | 'split'; colours: [string, string]; icon: ShowcaseIcon }
export const TEMPLATES: Record<ShowcaseTemplate, TemplateSpec> = {
  classic: { label: 'Classic', layout: 'banner', colours: ['#b4541a', '#fff4e6'], icon: 'star' },
  bold: { label: 'Bold', layout: 'split', colours: ['#1f3a5f', '#ffd166'], icon: 'laptop' },
  fresh: { label: 'Fresh', layout: 'stacked', colours: ['#1b7f5c', '#e8f7ef'], icon: 'broom' },
  night: { label: 'Night', layout: 'banner', colours: ['#24213a', '#e9d5ff'], icon: 'music' },
  craft: { label: 'Craft', layout: 'split', colours: ['#8a3b12', '#f6e7cf'], icon: 'needle' },
  plain: { label: 'Plain', layout: 'stacked', colours: ['#3d4852', '#f1f3f5'], icon: 'book' },
}
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

/** Black or white, whichever reads better on this colour. */
export function inkFor(colour: string): string {
  const value = /^#[0-9a-f]{6}$/i.test(colour) ? colour : '#000000'
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0) > 0.4 ? '#14181c' : '#ffffff'
}

/** The body of the "I am 18 or older" answer. The route refuses it without the city, so every screen builds it here. */
export const adultConsentBody = (cityId: string): { cityId: string; age: 'adult' } => ({ cityId, age: 'adult' })

export const photoUrl = (id: string): string => `/api/showcase/photo/${encodeURIComponent(id)}`
export const shopPath = (id: string): string => `/api/showcase/${encodeURIComponent(id)}`
export interface DirectoryQuery { city?: string; venue?: string; category?: string; q?: string; after?: string }
export function directoryPath(query: DirectoryQuery): string {
  const parts = Object.entries(query).filter(([, value]) => typeof value === 'string' && value !== '').map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
  return `/api/showcase/directory${parts.length ? `?${parts.join('&')}` : ''}`
}
/** The seller's own price, as a number with the naira sign. Always shown beside "Seller's price, paid outside Allworld". */
export const sellerPrice = (value: number): string => (Number.isFinite(value) && Math.round(value) > 0 ? `₦${Math.round(value).toLocaleString('en-NG')}` : 'Ask the seller')
export const PRICE_NOTE = 'Seller’s price, paid outside Allworld'

/** One line for each day: "Monday 09:00 to 18:00" or "Sunday closed". */
export function hoursLines(hours: readonly (ShowcaseHours | null)[]): { day: string; text: string }[] {
  return WEEKDAYS.map((day, at) => { const item = hours[at]; return { day, text: item ? `${item.open} to ${item.close}` : 'closed' } })
}

/** The short names of the days, Monday first, for the compact week. */
export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export interface WeekLine { day: string; text: string; today: boolean; closed: boolean }
/** The compact week: one line a day, today marked. */
export function weekLines(hours: readonly (ShowcaseHours | null)[], today: number): WeekLine[] {
  return WEEKDAYS_SHORT.map((day, at) => { const item = hours[at]; return { day, text: item ? `${item.open} to ${item.close}` : 'Closed', today: at === today, closed: !item } })
}

const clockMinutes = (clock: string): number => { const [h, m] = clock.split(':'); return (Number(h) || 0) * 60 + (Number(m) || 0) }
/** The weekday (Monday = 0) and minute of the day at `now` in a time zone; an unknown zone reads as the device's own. */
export function clockIn(now: Date, zone?: string): { day: number; minute: number } {
  if (zone) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
      const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? ''
      const day = WEEKDAYS_SHORT.indexOf(get('weekday') as (typeof WEEKDAYS_SHORT)[number])
      if (day >= 0) return { day, minute: (Number(get('hour')) % 24) * 60 + Number(get('minute')) }
    } catch { /* an unknown zone: fall back to the device clock */ }
  }
  return { day: (now.getDay() + 6) % 7, minute: now.getHours() * 60 + now.getMinutes() }
}
export interface OpenStatus { open: boolean; text: string; today: number }
/**
 * Is the shop open at `now` (the clock is injected), and in words. A day whose closing time is not after its opening time runs
 * past midnight into the next day. `zone` is the shop's own time zone, so a buyer far away reads the shop's day, not their own.
 */
export function openStatus(hours: readonly (ShowcaseHours | null)[], now: Date, zone?: string): OpenStatus {
  const { day, minute } = clockIn(now, zone)
  const today = hours[day], yesterday = hours[(day + 6) % 7]
  if (today) {
    const from = clockMinutes(today.open), to = clockMinutes(today.close)
    if (to > from && minute >= from && minute < to) return { open: true, text: `Open now · closes at ${today.close}`, today: day }
    if (to <= from && minute >= from) return { open: true, text: `Open now · closes at ${today.close} tomorrow`, today: day }
  }
  if (yesterday && clockMinutes(yesterday.close) <= clockMinutes(yesterday.open) && minute < clockMinutes(yesterday.close)) return { open: true, text: `Open now · closes at ${yesterday.close}`, today: day }
  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const at = (day + ahead) % 7, item = hours[at]
    if (!item || (ahead === 0 && minute >= clockMinutes(item.open))) continue
    const when = ahead === 0 ? '' : ahead === 1 ? ' tomorrow' : ` ${WEEKDAYS[at]}`
    return { open: false, text: `Closed · opens${when} at ${item.open}`, today: day }
  }
  return { open: false, text: 'Closed', today: day }
}
/** The shop's own time zone: its city's, and Nigeria's until a city says otherwise. */
export const zoneOf = (city: string): string => cityRules(city)?.timezone ?? 'Africa/Lagos'
/** "Market name, City" for a shop's place, as far as the city is known on this device. */
export function placeWords(city: string, venue: string): string {
  const market = cachedCityContent(city)?.venues.find((item) => item.id === venue)?.name
  const where = cityName(city) ?? city
  return market ? `${market}, ${where}` : where
}

/** What the shop page and the editor's preview draw: a shop as buyers see it. */
export interface ShopFace {
  name: string; sign: string; template: ShowcaseTemplate; colours: readonly [string, string]; logo: ShowcaseIcon; category: ShowcaseCategory
  city: string; venue: string; slot: number | null; about: string; hours: readonly (ShowcaseHours | null)[]
  photos: readonly { id: string; w: number; h: number; caption?: string }[]; serviceList: readonly ShowcaseService[]; pay: boolean
  badge: TrustBadge | null; payNotice: string | null
}
/** The caption of a photo, or what a screen reader hears when there is none. */
export const photoAlt = (name: string, photo: { caption?: string }, at: number, count: number): string => photo.caption || `${name}, photo ${at + 1} of ${count}`

// ---- the editor's draft ------------------------------------------------------------------------------------------------
export interface ServiceDraft { label: string; price: string; note: string }
export interface HoursDraft { open: boolean; from: string; to: string }
export interface ShopDraft {
  venue: string
  slot: string
  name: string
  category: ShowcaseCategory
  template: ShowcaseTemplate
  colours: [string, string]
  sign: string
  logo: ShowcaseIcon
  about: string
  services: ServiceDraft[]
  hours: HoursDraft[]
  chat: string
  pay: string
}
export const emptyService = (): ServiceDraft => ({ label: '', price: '', note: '' })
export function emptyDraft(venue = ''): ShopDraft {
  const spec = TEMPLATES.classic
  return {
    venue, slot: '', name: '', category: 'salon', template: 'classic', colours: [...spec.colours], sign: '', logo: spec.icon, about: '', services: [emptyService()],
    hours: WEEKDAYS.map((_, at) => ({ open: at < 6, from: '09:00', to: '18:00' })), chat: '', pay: '',
  }
}
export function draftOf(shop: NonNullable<ShowcaseMine['shop']>): ShopDraft {
  return {
    venue: shop.venue, slot: String(shop.slot), name: shop.name, category: shop.category, template: shop.template, colours: [...shop.colours], sign: shop.sign, logo: shop.logo, about: shop.about,
    services: shop.services.map((item) => ({ label: item.label, price: String(item.priceNaira), note: item.note })), hours: WEEKDAYS.map((_, at) => { const item = shop.hours[at]; return { open: item !== null && item !== undefined, from: item?.open ?? '09:00', to: item?.close ?? '18:00' } }),
    chat: shop.chat.url, pay: shop.pay?.url ?? '',
  }
}
/** The body to send. Prices are whole naira; an empty price is 0 ("ask the seller"). */
export function inputOf(draft: ShopDraft, city: string): ShowcaseInput {
  const services: ShowcaseService[] = draft.services.filter((item) => item.label.trim() !== '').map((item) => ({ label: item.label.trim(), priceNaira: Math.max(0, Math.round(Number(item.price) || 0)), note: item.note.trim() }))
  const slot = Number(draft.slot)
  return {
    city, venue: draft.venue, ...(Number.isInteger(slot) && slot > 0 ? { slot } : {}), name: draft.name.trim(), category: draft.category, template: draft.template, colours: [draft.colours[0], draft.colours[1]], sign: draft.sign.trim(), logo: draft.logo,
    about: draft.about.trim(), services, hours: draft.hours.map((day) => (day.open ? { open: day.from, close: day.to } : null)),
    chat: { url: draft.chat.trim() }, pay: draft.pay.trim() ? { url: draft.pay.trim() } : null,
  }
}
/** A problem and the field it belongs to: `field` is the id suffix of the input (`name`, `service-0-price`, `hours-2`, `chat` …). */
export interface Problem { field: string; message: string }
/** What is missing or wrong, in the order the form shows it, each with its field. The server checks everything again. */
export function draftProblems(draft: ShopDraft): Problem[] {
  const found: Problem[] = []
  const name = draft.name.trim()
  if (name.length < SHOWCASE.name.min || name.length > SHOWCASE.name.max) found.push({ field: 'name', message: `Give the shop a name of ${SHOWCASE.name.min} to ${SHOWCASE.name.max} letters.` })
  if (!draft.venue) found.push({ field: 'venue', message: 'Choose the market your shop is in.' })
  if (!draft.sign.trim()) found.push({ field: 'sign', message: 'Write a short sign for the front of the shop.' })
  if (!draft.about.trim()) found.push({ field: 'about', message: 'Say a little about the shop.' })
  if (!draft.services.some((item) => item.label.trim())) found.push({ field: 'service-0-label', message: 'Add at least one service.' })
  draft.services.forEach((item, at) => { if (item.label.trim() && item.price.trim() !== '' && !(Number.isInteger(Number(item.price)) && Number(item.price) >= 0 && Number(item.price) <= SHOWCASE.priceMax)) found.push({ field: `service-${at}-price`, message: `The price of ${item.label.trim()} must be a whole number of naira.` }) })
  draft.hours.forEach((day, at) => { if (day.open && day.to <= day.from) found.push({ field: `hours-${at}`, message: `${WEEKDAYS[at]}: closing time must be after opening time.` }) })
  if (!draft.chat.trim()) found.push({ field: 'chat', message: 'Add the link where people can chat with you.' })
  return found
}
export const draftIssues = (draft: ShopDraft): string[] => draftProblems(draft).map((item) => item.message)

const TEXT_REFUSALS = new Set(['fee_request', 'money_doubling', 'text_blocked', 'links_not_allowed', 'contact_not_allowed', 'home_address_not_allowed'])
const SHAPES: Readonly<Record<string, RegExp>> = { contact_not_allowed: /\d[\d\s().-]{6,}|@/, links_not_allowed: /https?:|www\.|\b[a-z0-9-]+\.(?:com|ng|net|org|co|io|me|ly)\b/i, home_address_not_allowed: /\b(?:home address|house address|my house|my home|flat \d|apartment \d|\d+\s+\w+\s+(?:street|road|avenue|close))\b/i }
/**
 * The field a refusal from the server belongs to. A wording refusal does not say which text it was, so the texts are looked
 * through for the shape that was refused; when none shows, the About box takes it (the longest text). Null: not about a field.
 */
export function refusalProblem(code: string | undefined, draft: ShopDraft, fallback: string): Problem | null {
  if (!code) return null
  const message = wordsFor(code, fallback)
  switch (code) {
    case 'chat_link_not_allowed': return { field: 'chat', message }
    case 'pay_link_not_allowed': return { field: 'pay', message }
    case 'slot_taken': return { field: 'slot', message }
    case 'market_full': case 'market_required': return { field: 'venue', message }
    case 'photos_needed': case 'photo_limit': case 'upload_limit': case 'picture_store_full': case 'picture_rejected': return { field: 'photos', message }
    default:
  }
  if (!TEXT_REFUSALS.has(code)) return null
  const texts: [string, string][] = [['name', draft.name], ['sign', draft.sign], ['about', draft.about], ...draft.services.flatMap((item, at): [string, string][] => [[`service-${at}-label`, item.label], [`service-${at}-note`, item.note]])]
  const shape = SHAPES[code]
  const hit = shape ? texts.find(([, text]) => shape.test(text)) : undefined
  return { field: hit?.[0] ?? 'about', message }
}

// ---- keeping the editor in step with the server ------------------------------------------------------------------------
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
export const DRAFT_PARTS: Readonly<Record<keyof ShopDraft, string>> = Object.freeze({
  venue: 'the market', slot: 'the stall number', name: 'the name', category: 'the kind', template: 'the look', colours: 'the colours', sign: 'the sign', logo: 'the logo', about: 'the about text', services: 'the services', hours: 'the hours', chat: 'the chat link', pay: 'the payment link',
})
const PARTS = Object.keys(DRAFT_PARTS) as (keyof ShopDraft)[]
/** The parts of a draft that differ between two drafts. */
export const draftChanges = (a: ShopDraft, b: ShopDraft): (keyof ShopDraft)[] => PARTS.filter((part) => !same(a[part], b[part]))
/** Parts the seller edited here and that also changed on the server to something else: the only real conflict. */
export const draftClashes = (base: ShopDraft, mine: ShopDraft, latest: ShopDraft): (keyof ShopDraft)[] => PARTS.filter((part) => !same(mine[part], base[part]) && !same(latest[part], base[part]) && !same(latest[part], mine[part]))
/** The latest shop with the seller's own unsaved edits laid over it, part by part: what they changed stays, the rest is the latest. */
export function mergeDraft(base: ShopDraft, mine: ShopDraft, latest: ShopDraft): ShopDraft {
  const merged: ShopDraft = JSON.parse(JSON.stringify(latest)) as ShopDraft
  for (const part of PARTS) if (!same(mine[part], base[part])) Object.assign(merged, { [part]: JSON.parse(JSON.stringify(mine[part])) as unknown })
  return merged
}

// ---- photos: order ---------------------------------------------------------------------------------------------------------
/** The ids with one moved earlier (-1) or later (+1); the first is the cover. Out of range changes nothing. */
export function movePhoto(order: readonly string[], id: string, step: -1 | 1): string[] {
  const at = order.indexOf(id), to = at + step
  if (at < 0 || to < 0 || to >= order.length) return [...order]
  const next = [...order]
  next.splice(at, 1); next.splice(to, 0, id)
  return next
}
/** The ids with one moved to the front: it becomes the cover. */
export const makeCover = (order: readonly string[], id: string): string[] => (order.includes(id) ? [id, ...order.filter((item) => item !== id)] : [...order])

/** Words for a shop's status, for the banner at the top of the editor. */
export function statusWords(status: ShowcaseStatus, photos: number, note?: string): string {
  switch (status) {
    case 'draft': return photos < SHOWCASE.photosMin ? `Not shown yet. Add at least ${SHOWCASE.photosMin} photos, then send it for review.` : 'Not shown yet. Send it for review when you are ready.'
    case 'review': return 'Waiting for review. It is not shown to others until a person has looked at it.'
    case 'live': return 'Live. Other players can find it.'
    case 'hidden': return 'Hidden by you. Nobody else can see it.'
    case 'held': return note ? `On hold: ${note}` : 'On hold while we look at it. You cannot change it until that is done.'
  }
}
/** Words for what stops someone publishing or going to a seller; a code the server sends. */
export const CODE_WORDS: Readonly<Record<string, string>> = Object.freeze({
  account_required: 'Sign in to an account first. Guests can look around, but only an account can do this.',
  adult_self_declaration_required: 'Say that you are 18 or older first.',
  adults_only: 'You said you are under 18, so this is not open to you.',
  verification_required: 'Your phone must be checked first. An operator can do this by hand.',
  account_too_new: 'New accounts wait a day before they can do this.',
  listings_held: 'Your listings are on hold while complaints are reviewed.',
  shop_held: 'This shop is on hold while we look at it.',
  slot_taken: 'That stall number is taken. Choose another or leave it empty.',
  market_full: 'That market has no free stall numbers.',
  market_required: 'Choose a market.',
  chat_link_not_allowed: 'That chat link is not accepted. Use a link of your own where people can message you.',
  pay_link_not_allowed: 'That payment link is not accepted. Use a payment page link of your own, or leave it empty.',
  fee_request: 'That wording asks people to pay before they get anything. Change it.',
  money_doubling: 'That wording promises to grow money. Change it.',
  text_blocked: 'Some of that wording is not accepted. Change it.',
  links_not_allowed: 'Write no web addresses in the text. The chat and payment links go in their own boxes.',
  contact_not_allowed: 'Write no phone numbers, e-mail addresses or chat handles in the text. The chat link goes in its own box.',
  home_address_not_allowed: 'Do not write a home address.',
  unsupported_shop_field: 'Something in the form is not accepted.',
  photos_needed: `Add at least ${SHOWCASE.photosMin} photos first.`,
  photo_limit: `A shop has at most ${SHOWCASE.photosMax} photos.`,
  upload_limit: `You can add ${SHOWCASE.uploadsPerDay} photos a day. Try again tomorrow.`,
  picture_store_full: 'There is no room for more photos right now. Try again later.',
  picture_rejected: 'That photo was not accepted.',
  go_limit: `You can open ${SHOWCASE.goPerDay} chats or payment pages a day. Try again tomorrow.`,
  own_shop: 'This is your own shop.',
  shop_unavailable: 'This shop is not available.',
  revision_conflict: 'Your shop changed somewhere else. Load the latest, check it, and save again.',
  invalid_photo_order: 'The photos changed. Reload and try again.',
  invalid_caption: 'A photo caption can be up to 60 letters.',
  rate_limited: 'Too many tries. Wait a moment.',
})
export const wordsFor = (code: string | undefined, fallback: string): string => (code ? CODE_WORDS[code] : undefined) ?? fallback

// ---- photos -----------------------------------------------------------------------------------------------------------------
/** The same steps as pictures in chat (decode, draw again on a canvas which drops all metadata, shrink), aimed under the 150 kB cap. */
export const PHOTO = Object.freeze({ target: 120000, cap: SHOWCASE.photoBytes, qualities: [0.8, 0.68, 0.56, 0.44, 0.34] as readonly number[], sides: [1280, 1024, 800, 640, 480] as readonly number[] })
export interface ReadyPhoto { blob: Blob; type: 'image/webp' | 'image/jpeg'; width: number; height: number }
export async function preparePhoto(file: File): Promise<{ ok: true; ready: ReadyPhoto } | { ok: false; reason: string }> {
  const refused = refusalFor(file.type)
  if (refused) return { ok: false, reason: refused.replace('sent', 'used') }
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { return { ok: false, reason: 'That file could not be read as a photo. Try another one.' } }
  try {
    for (const side of PHOTO.sides) {
      const size = fitWithin(bitmap.width, bitmap.height, side)
      const canvas = document.createElement('canvas')
      canvas.width = size.width; canvas.height = size.height
      const context = canvas.getContext('2d')
      if (!context) return { ok: false, reason: 'This browser cannot prepare photos.' }
      context.fillStyle = '#fff'; context.fillRect(0, 0, size.width, size.height)
      context.drawImage(bitmap, 0, 0, size.width, size.height)
      for (const quality of PHOTO.qualities) {
        let blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/webp', quality))
        if (!blob || blob.type !== 'image/webp') blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', quality))
        if (blob && blob.size <= PHOTO.target) return { ok: true, ready: { blob, type: blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg', width: size.width, height: size.height } }
        if (blob && quality === PHOTO.qualities.at(-1) && blob.size <= PHOTO.cap) return { ok: true, ready: { blob, type: blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg', width: size.width, height: size.height } }
      }
    }
    return { ok: false, reason: 'That photo is too big even after shrinking it. Try another one.' }
  } finally { bitmap.close() }
}
export async function photoBody(ready: ReadyPhoto, clientId: string): Promise<{ clientId: string; type: string; data: string }> {
  return { clientId, type: ready.type, data: await toBase64(ready.blob) }
}
export const categoryList = SHOWCASE_CATEGORIES.map((id) => ({ id, label: CATEGORY_LABELS[id] }))
export const templateList = SHOWCASE_TEMPLATES.map((id) => ({ id, ...TEMPLATES[id] }))
export const iconList = SHOWCASE_ICONS.map((id) => ({ id, ...ICON_GLYPHS[id] }))
