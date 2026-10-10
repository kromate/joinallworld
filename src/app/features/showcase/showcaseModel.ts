// Showcase shops, the browser's side: paths, the storefront templates and icons, the editor's draft and its checks, the words
// for every state and refusal, and the photo shrink. Pure apart from preparePhoto. The rules are the server's (docs/SHOWCASE.md):
// these checks only save a round trip. Nothing here is in src/game, so none of it is in the first download.
import { SHOWCASE, SHOWCASE_CATEGORIES, SHOWCASE_ICONS, SHOWCASE_TEMPLATES } from '../../../types/showcase.ts'
import type { ShowcaseCategory, ShowcaseHours, ShowcaseIcon, ShowcaseInput, ShowcaseMine, ShowcaseService, ShowcaseStatus, ShowcaseTemplate } from '../../../types/showcase.ts'
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

export const photoUrl = (id: string): string => `/api/showcase/photo/${encodeURIComponent(id)}`
export const shopPath = (id: string): string => `/api/showcase/${encodeURIComponent(id)}`
export interface DirectoryQuery { city?: string; venue?: string; category?: string; q?: string; after?: string }
export function directoryPath(query: DirectoryQuery): string {
  const parts = Object.entries(query).filter(([, value]) => typeof value === 'string' && value !== '').map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
  return `/api/showcase/directory${parts.length ? `?${parts.join('&')}` : ''}`
}
/** The seller's own price, as a number with the naira sign. Always shown beside "Seller's price, paid outside Allworld". */
export const sellerPrice = (value: number): string => (value > 0 ? `₦${Math.round(value).toLocaleString('en-NG')}` : 'Ask the seller')
export const PRICE_NOTE = 'Seller’s price, paid outside Allworld'

/** One line for each day: "Monday 09:00 to 18:00" or "Sunday closed". */
export function hoursLines(hours: readonly (ShowcaseHours | null)[]): { day: string; text: string }[] {
  return WEEKDAYS.map((day, at) => { const item = hours[at]; return { day, text: item ? `${item.open} to ${item.close}` : 'closed' } })
}

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
/** What is missing or wrong, in the order the form shows it. The server checks everything again. */
export function draftIssues(draft: ShopDraft): string[] {
  const issues: string[] = []
  const name = draft.name.trim()
  if (name.length < SHOWCASE.name.min || name.length > SHOWCASE.name.max) issues.push(`Give the shop a name of ${SHOWCASE.name.min} to ${SHOWCASE.name.max} letters.`)
  if (!draft.venue) issues.push('Choose the market your shop is in.')
  if (!draft.sign.trim()) issues.push('Write a short sign for the front of the shop.')
  if (!draft.about.trim()) issues.push('Say a little about the shop.')
  if (!draft.services.some((item) => item.label.trim())) issues.push('Add at least one service.')
  for (const item of draft.services) if (item.label.trim() && item.price.trim() !== '' && !(Number.isInteger(Number(item.price)) && Number(item.price) >= 0 && Number(item.price) <= SHOWCASE.priceMax)) { issues.push(`The price of ${item.label.trim()} must be a whole number of naira.`); break }
  for (const day of draft.hours) if (day.open && day.to <= day.from) { issues.push('Closing time must be after opening time.'); break }
  if (!draft.chat.trim()) issues.push('Add the link where people can chat with you.')
  return issues
}

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
  revision_conflict: 'The shop changed somewhere else. Reload it and try again.',
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
