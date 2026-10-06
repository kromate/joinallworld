// The moderation queue's own rules, without a screen: the three kinds of thing joined into one list (oldest first), the counts, how long each has
// waited, and the canned words an admin may send. Pure, so it is tested without a browser.
export type Kind = 'report' | 'shop' | 'picture'
export interface Item { key: string; kind: Kind; id: string; at: number; title: string; summary: string; player: { id: string; name: string } | null }
export interface Reports { id: string; about: string; aboutName: string; aboutNow: string | null; byName: string; reason: string; text: string; at: number; status: string }
export interface ShopRow { shop?: string; id?: string; name?: string; by?: { id: string; name: string }; reason?: string; current?: string | null; at?: number }
export interface PictureRow { id: string; from: string | null; fromName: string | null; at: number; reports: number; hidden: boolean; removed: boolean }

/** What an admin may send as a warning with one tap: kind, short, and the same words every time. */
export const CANNED: readonly { id: string; label: string; text: string }[] = [
  { id: 'kind', label: 'Keep chat kind', text: 'Please keep chat friendly. Insults and harassment are not allowed in Allworld.' },
  { id: 'private', label: 'No personal details', text: 'Please do not share personal details such as phone numbers or addresses in chat.' },
  { id: 'spam', label: 'No spam', text: 'Please stop sending the same message again and again. Spam is not allowed.' },
  { id: 'name', label: 'Choose a respectful name', text: 'The name you chose breaks the rules. Please choose a respectful one.' },
  { id: 'rules', label: 'General reminder', text: 'This is a reminder to follow the Allworld rules. Further reports may lead to a longer mute.' },
]

export function queue(reports: readonly Reports[], shops: readonly ShopRow[], pictures: readonly PictureRow[], now: number): Item[] {
  const items: Item[] = []
  for (const report of reports) if (report.status === 'received') items.push({ key: `report:${report.id}`, kind: 'report', id: report.id, at: report.at, title: `${report.reason} · ${report.aboutNow ?? report.aboutName}`, summary: report.text, player: { id: report.about, name: report.aboutNow ?? report.aboutName } })
  for (const shop of shops) if (shop.shop) items.push({ key: `shop:${shop.shop}`, kind: 'shop', id: shop.shop, at: shop.at ?? now, title: `Shop “${shop.current ?? shop.name ?? ''}”`, summary: shop.reason ?? '', player: shop.by ? { id: shop.by.id, name: shop.by.name } : null })
  for (const picture of pictures) if (!picture.removed && (picture.reports > 0 || picture.hidden)) items.push({ key: `picture:${picture.id}`, kind: 'picture', id: picture.id, at: picture.at, title: `Picture from ${picture.fromName ?? 'System'}`, summary: `${picture.reports} report${picture.reports === 1 ? '' : 's'}${picture.hidden ? ' · hidden' : ''}`, player: picture.from ? { id: picture.from, name: picture.fromName ?? 'Player' } : null })
  return items.sort((a, b) => a.at - b.at)
}
export const counts = (items: readonly Item[]): Record<Kind | 'all', number> => ({ all: items.length, report: items.filter((i) => i.kind === 'report').length, shop: items.filter((i) => i.kind === 'shop').length, picture: items.filter((i) => i.kind === 'picture').length })
/** "3 h", "2 d": how long an item has waited. */
export function age(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60000))
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min` : minutes < 2880 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} d`
}
/** The next or previous key in the list (stays put at the ends); the first when nothing is chosen. */
export function step(items: readonly Item[], current: string | null, by: 1 | -1): string | null {
  if (!items.length) return null
  const at = items.findIndex((item) => item.key === current)
  return items[at < 0 ? 0 : Math.max(0, Math.min(items.length - 1, at + by))]!.key
}
