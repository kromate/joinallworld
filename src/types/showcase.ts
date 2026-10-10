/**
 * OWNER: showcase
 * Showcase shops: a place where real people show real skills and services and are contacted, or paid, outside Allworld.
 * The game holds no money and no contact details. Prices here are the seller's real prices, paid outside; the chat and pay
 * destinations are allow-listed outside links released only to a signed-in adult (docs/SHOWCASE.md).
 * Types only, plus the small lists the browser and the server must agree on. The rules are in server/showcase/.
 */
import type { TrustBadge } from '../game/trust/index.ts'

export const SHOWCASE_CATEGORIES = ['salon', 'tailor', 'tech', 'food', 'beauty', 'photography', 'repair', 'tutoring', 'crafts', 'cleaning', 'events', 'other'] as const
export type ShowcaseCategory = (typeof SHOWCASE_CATEGORIES)[number]
export const SHOWCASE_TEMPLATES = ['classic', 'bold', 'fresh', 'night', 'craft', 'plain'] as const
export type ShowcaseTemplate = (typeof SHOWCASE_TEMPLATES)[number]
export const SHOWCASE_ICONS = ['scissors', 'needle', 'laptop', 'pot', 'camera', 'wrench', 'book', 'brush', 'broom', 'star', 'gift', 'music'] as const
export type ShowcaseIcon = (typeof SHOWCASE_ICONS)[number]
export const SHOWCASE_CHAT_KINDS = ['whatsapp', 'instagram'] as const
export type ShowcaseChatKind = (typeof SHOWCASE_CHAT_KINDS)[number]
export const SHOWCASE_PAY_KINDS = ['paystack', 'flutterwave', 'selar'] as const
export type ShowcasePayKind = (typeof SHOWCASE_PAY_KINDS)[number]
export type ShowcaseLinkKind = 'chat' | 'pay'
export type ShowcaseStatus = 'draft' | 'review' | 'live' | 'hidden' | 'held'

/** Every number the server enforces and the editor shows. */
export const SHOWCASE = Object.freeze({
  shops: 2000,
  /** The numbered slots of one market: first come, first served. */
  slotsPerVenue: 24,
  name: Object.freeze({ min: 3, max: 40 }),
  sign: 24,
  about: 400,
  services: 12,
  label: 40,
  note: 80,
  /** A photo's caption (also its alt text). */
  caption: 60,
  priceMax: 100000000,
  photosMin: 3,
  photosMax: 6,
  /** After the server has rewritten the picture. */
  photoBytes: 150000,
  uploadsPerDay: 10,
  goPerDay: 10,
  /** Contact events kept at most, and for how long. */
  contacts: 5000,
  contactDays: 90,
  /** The shop's pay link shows "Payment details changed recently" for this long after it changes. */
  payNoticeMs: 7 * 86400000,
  /** Distinct reports that hide one photo until an operator decides. */
  reportsToHide: 2,
  /** All showcase pictures together; past it uploads are refused, nothing older is deleted. */
  imageCeilingBytes: 100 * 1024 * 1024,
  page: 20,
  search: 40,
  day: 86400000,
})

export interface ShowcaseService { label: string; priceNaira: number; note: string }
/** 24-hour "HH:MM"; a day with no entry is closed. Monday first. */
export interface ShowcaseHours { open: string; close: string }
export interface ShowcaseLink { kind: ShowcaseChatKind; url: string }
export interface ShowcasePayLink { kind: ShowcasePayKind; url: string }

/** What a seller writes. The same body creates a shop and edits it. */
export interface ShowcaseInput {
  city: string
  venue: string
  /** A free slot of the market; left out: the lowest free one. */
  slot?: number
  name: string
  category: ShowcaseCategory
  template: ShowcaseTemplate
  colours: [string, string]
  sign: string
  logo: ShowcaseIcon
  about: string
  services: ShowcaseService[]
  hours: (ShowcaseHours | null)[]
  chat: { url: string; kind?: ShowcaseChatKind }
  pay?: { url: string; kind?: ShowcasePayKind } | null
}

export interface ShowcasePhoto {
  id: string
  w: number
  h: number
  n: number
  at: number
  /** Public: the shop was approved before it, or after it. A new shop's first photos wait for the first approval. */
  approved: boolean
  /** The seller's short words about the photo; screened like all shop text. */
  caption?: string
  /** Hidden until an operator decides (two distinct reports). */
  hidden?: true
  /** Distinct players who reported it. Server only. */
  reports?: string[]
}

/** The stored shop. Server only: the two links are never put into a card, the directory or a shop page. */
export interface ShowcaseShop {
  v: 1
  id: string
  owner: string
  city: string
  venue: string
  slot: number
  name: string
  category: ShowcaseCategory
  template: ShowcaseTemplate
  colours: [string, string]
  sign: string
  logo: ShowcaseIcon
  about: string
  services: ShowcaseService[]
  hours: (ShowcaseHours | null)[]
  chat: ShowcaseLink
  pay: ShowcasePayLink | null
  photos: ShowcasePhoto[]
  status: ShowcaseStatus
  /** First approval by an operator. */
  reviewedAt?: number
  /** When the pay link last changed after the shop was first approved. */
  payChangedAt?: number
  /** Name, chat or pay changed after the first approval: an operator looks again before it is shown. */
  reapprove?: true
  /** Why an operator held it (shown to its owner). */
  note?: string
  revision: number
  createdAt: number
  updatedAt: number
}

export interface ShowcaseOwner { shop?: string; day: number; uploads: number }
export interface ShowcaseContact { id: string; shop: string; buyer: string; kind: ShowcaseLinkKind; at: number }
export interface ShowcaseCollection {
  v: 1
  seq: number
  shops: Record<string, ShowcaseShop>
  owners: Record<string, ShowcaseOwner>
  contacts: Record<string, ShowcaseContact>
}

/** The face of a shop in the directory. */
export interface ShowcaseCard {
  id: string
  name: string
  category: ShowcaseCategory
  template: ShowcaseTemplate
  colours: [string, string]
  sign: string
  logo: ShowcaseIcon
  city: string
  venue: string
  slot: number
  cover: string | null
  /** Opening hours, Monday first: a card says whether the shop is open now. */
  hours: (ShowcaseHours | null)[]
  services: number
  /** The least a service costs, the seller's real price in naira, or null. */
  from: number | null
  pay: boolean
  badge: TrustBadge
}
export interface ShowcasePage { shops: ShowcaseCard[]; next: string | null }
export interface ShowcaseView extends ShowcaseCard {
  about: string
  photos: { id: string; w: number; h: number; caption?: string }[]
  serviceList: ShowcaseService[]
  /** Set for 7 days after the pay link changed. */
  payNotice: string | null
  priceLabel: string
}
export interface ShowcasePhotoView { id: string; w: number; h: number; approved: boolean; hidden: boolean; caption?: string }
/** The owner's own record: the links are theirs to see. */
export interface ShowcaseMine {
  shop: (Omit<ShowcaseShop, 'photos' | 'v'> & { photos: ShowcasePhotoView[] }) | null
  /** Why the caller cannot publish now (a refusal code), or null. */
  blocked: string | null
  uploadsLeft: number
}

export interface ShowcaseGo { link: { url: string; host: string; site: string }; badge: TrustBadge; warning: string; requiresWarning: true; kind: ShowcaseLinkKind }

/** The operator's queue. */
export interface ShowcaseQueueItem { id: string; name: string; owner: string; ownerName: string; city: string; venue: string; status: ShowcaseStatus; reviewedAt: number | null; updatedAt: number; photos: ShowcasePhotoView[]; hiddenPhotos: string[]; about: string; chat: string; pay: string | null }
