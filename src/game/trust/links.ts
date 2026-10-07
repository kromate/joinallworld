/**
 * OWNER: trust. The only places a link may send a player out of Allworld. Pure and portable.
 *
 * A link is allowed when it is https (or has no scheme and is read as https), has no user name, password or port, and
 * its host (with or without "www.") and path start match ALLOWED_LINKS. Everything else is refused: other sites,
 * shorteners, look-alike hosts (wa.me.evil.ng), IP addresses and punycode.
 *
 * Nothing a player types is turned into a link by itself. The server lets an allowed link through venue chat only from
 * a checked stall owner in their own stall's venue (server/trust/service.ts vendorLink); the client then shows it as a
 * button that opens the "You are leaving Allworld" screen first.
 */

export interface AllowedSite { host: string; paths?: readonly string[]; label: string }
export const ALLOWED_LINKS: readonly AllowedSite[] = Object.freeze([
  { host: 'wa.me', label: 'WhatsApp' },
  { host: 'instagram.com', label: 'Instagram' },
  { host: 'selar.co', label: 'Selar' },
  { host: 'selar.com', label: 'Selar' },
  { host: 'paystack.com', paths: ['/pay/'], label: 'Paystack' },
  { host: 'paystack.shop', label: 'Paystack' },
  { host: 'flutterwave.com', paths: ['/pay/', '/store/'], label: 'Flutterwave' },
])

/** An allowed link, as it will be opened. */
export interface OutboundLink { url: string; host: string; site: string }

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/
const SAFE_REST = /^[A-Za-z0-9\-._~!$&'()*+,;=%/?#@]*$/

/** The allowed link this text is, or null. Accepts "wa.me/234…" as well as "https://wa.me/234…".
 * Parsed by hand and strictly (portable code has no URL class): anything unusual is refused, not normalised. */
export function outboundLink(text: unknown): OutboundLink | null {
  if (typeof text !== 'string') return null
  const raw = text.trim().replace(/[.,!?)\]]+$/, '')
  if (!raw || raw.length > 300 || /\s/.test(raw)) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https:\/\//i.test(raw)) return null
  const rest = raw.replace(/^https:\/\//i, '')
  const cut = rest.search(/[/?#]/)
  const authority = cut < 0 ? rest : rest.slice(0, cut), tail = cut < 0 ? '' : rest.slice(cut)
  if (!SAFE_REST.test(tail) || /[@:]/.test(authority)) return null // a user name, password or port
  if (/(^|\/)(\.|%2e){1,2}(\/|[?#]|$)/i.test(tail)) return null // "/pay/../admin" would leave the allowed path
  const host = authority.toLowerCase()
  if (!HOST.test(host) || host.includes('xn--')) return null
  if (/^[0-9.]+$/.test(host)) return null
  const bare = host.startsWith('www.') ? host.slice(4) : host
  const site = ALLOWED_LINKS.find((item) => item.host === bare)
  if (!site) return null
  const path = (tail.split(/[?#]/)[0] || '/').toLowerCase()
  if (site.paths && !site.paths.some((start) => path.startsWith(start) && path.length > start.length)) return null
  return { url: `https://${host}${tail || '/'}`, host: bare, site: site.label }
}

/** Words in `text` that look like a web address (a scheme, "www." or a dotted host). */
export function linkTokens(text: string): string[] {
  return text.split(/\s+/).filter((word) => /(^|[^a-z0-9])(https?:\/\/|www\.)|^[("'[]*[a-z0-9-]+(\.[a-z0-9-]+)+([/?#:]|[.,!?)\]]*$)/i.test(word))
}

/** The parts of a chat line, with every allowed link split out so it can be shown as a button. */
export type LinePart = { text: string; link?: undefined } | { text: string; link: OutboundLink }
export function lineParts(body: string): LinePart[] {
  const parts: LinePart[] = []
  for (const piece of body.split(/(\s+)/)) {
    const link = piece.trim() ? outboundLink(piece) : null
    const last = parts[parts.length - 1]
    if (link) parts.push({ text: piece, link })
    else if (last && !last.link) last.text += piece
    else parts.push({ text: piece })
  }
  return parts
}
