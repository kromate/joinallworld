/**
 * OWNER: social
 * The feed's small public pages (no script, no cookie): a crew's join link /c/<code>, an event's invitation /ev/<code>, and the social part
 * of a public profile (handle, portrait, bio, status, latest public posts). Chat apps' crawlers read the Open Graph tags; a person who opens
 * the page is sent into the game with the code, where joining or answering is one tap. Every value is escaped.
 */
import { OG_IMAGE, safeOrigin } from '../growth/share.ts'
import { escapeHtml as esc } from '../path-meta.ts'
import type { CrewView, EventView, PostView, ProfileView } from '../../src/types/feed.ts'

const STYLE = `@media(min-width:1800px){body{zoom:1.25}}@media(min-width:2800px){body{zoom:1.6}}*{box-sizing:border-box}body{margin:0;background:#f3f0e7;color:#193126;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}a{color:inherit}
.wrap{width:min(560px,100%);margin:0 auto;padding:22px 16px 48px}.brand{display:inline-flex;align-items:center;min-height:44px;font-weight:850;text-decoration:none}.card{margin:6px 0 14px;padding:24px 20px;border-radius:22px;background:#174c36;color:#fff}
.card h1{margin:4px 0 6px;font-size:clamp(28px,8vw,42px);line-height:1.05;overflow-wrap:anywhere}.card p{margin:4px 0;opacity:.92}.go{display:block;margin:18px 0 8px;padding:15px 18px;border-radius:14px;background:#f2b134;color:#193126;font-weight:850;font-size:18px;text-align:center;text-decoration:none}
.muted{color:#46594f;font-size:15px}.people{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.people span{padding:4px 10px;border-radius:999px;background:#ffffff26;font-size:14px}`
function page(origin: unknown, path: string, title: string, description: string, body: string, image?: string): string {
  const base = safeOrigin(origin), url = `${base}${path}`, img = image ? `${base}${image}` : `${base}${OG_IMAGE}`
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name="description" content="${esc(description)}"><meta name="robots" content="noindex, nofollow"><link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Allworld"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${esc(img)}"><style>${STYLE}</style></head>
<body><main class="wrap"><a class="brand" href="${esc(`${base}/`)}">Allworld</a>${body}</main></body></html>`
}
export function goneHtml(origin: unknown, what: string): string {
  const base = safeOrigin(origin)
  return page(origin, '/', `${what} not found — Allworld`, 'The link may be wrong or it has ended.', `<section class="card"><h1>${esc(what)} not found</h1><p>The link may be wrong, or it has ended.</p></section><a class="go" href="${esc(`${base}/`)}">Open Allworld</a>`)
}
export function crewPageHtml(crew: CrewView, code: string, origin: unknown): string {
  const base = safeOrigin(origin), title = `Join ${crew.name} on Allworld`
  const what = crew.kind === 'crew' ? `a crew of ${crew.size}` : `${crew.kindLabel.replace(/^A |^An /, 'a ').toLowerCase()} of ${crew.size} members${crew.world ? ' with its own 3D world' : ''}`
  const description = `${crew.owner.name} invites you to ${crew.name}, ${what} on Allworld. ${crew.about}`.trim()
  const people = crew.members.slice(0, 12).map((m) => `<span>${esc(m.name)}${m.ai ? ' · AI' : ''}</span>`).join('')
  return page(origin, `/c/${code}`, title, description, `<section class="card"><p>${esc(crew.kind === 'crew' ? 'A crew on Allworld' : `${crew.kindLabel} on Allworld`)}</p><h1>${esc(crew.name)}</h1>${crew.about ? `<p>${esc(crew.about)}</p>` : ''}<p>${crew.size} member${crew.size === 1 ? '' : 's'}</p><div class="people">${people}</div></section>
<a class="go" href="${esc(`${base}/?crew=${encodeURIComponent(code)}`)}">${crew.kind === 'crew' ? 'Join the crew' : 'Join'}</a><p class="muted">Allworld is a world you can walk in, or use like a social app. Joining is free; no sign-up needed to start.</p>`)
}
export function eventPageHtml(event: EventView, origin: unknown): string {
  const base = safeOrigin(origin), when = new Date(event.start).toUTCString().replace(/:\d\d GMT$/, ' GMT')
  const title = `${event.title} · ${event.place.label ?? event.place.cityName}`
  const description = `${event.by.name} is hosting ${event.title} in ${event.place.cityName} on Allworld, ${when}. ${event.going} going.`
  return page(origin, `/ev/${event.code}`, title, description, `<section class="card"><p>${esc(event.phase === 'live' ? 'Happening now' : when)}</p><h1>${esc(event.title)}</h1><p>${esc(event.place.label ?? '')} · ${esc(event.place.cityName)}</p>${event.about ? `<p>${esc(event.about)}</p>` : ''}<p>Hosted by ${esc(event.by.name)} · ${event.going} going</p></section>
<a class="go" href="${esc(`${base}/?event=${encodeURIComponent(event.code)}`)}">I'm coming</a><p class="muted">Open the link to answer. You can go in the 3D world or follow it from your phone.</p>`)
}
/** The social block of /p/: portrait, handle, bio, status and the latest public posts. Empty when the person set none of it. */
export function profileSocialHtml(profile: ProfileView, posts: readonly PostView[], origin: unknown): string {
  const base = safeOrigin(origin)
  const pic = profile.portrait ? `<img src="${esc(`${base}/api/feed/portrait/${profile.id}?h=${profile.portrait}`)}" alt="" width="96" height="96" style="width:96px;height:96px;border-radius:24px;background:#e6efe9;object-fit:cover;display:block;margin:0 0 8px">` : ''
  const lines = [profile.handle ? `<b>@${esc(profile.handle)}</b>` : '', profile.bio ? `<p>${esc(profile.bio)}</p>` : '', profile.status ? `<p class="meta">${esc(profile.status.text)}${profile.status.place ? ` · ${esc(profile.status.place)}` : ''}</p>` : '', profile.work.rating ? `<p class="meta">Gigs: ${esc(profile.work.rating)}</p>` : '', profile.work.vouches.length ? `<p class="meta">Vouched for ${esc(profile.work.vouches.map((v) => `${v.skill} (${v.count})`).join(', '))}</p>` : ''].filter(Boolean).join('')
  const list = posts.slice(0, 10).map((p) => `<li><b>${esc(p.body.slice(0, 280) || (p.media ? 'Photo' : ''))}</b><p class="meta">${esc(new Date(p.at).toISOString().slice(0, 10))}${p.place ? ` · ${esc(p.place.label ?? p.place.cityName)}` : ''}</p></li>`).join('')
  if (!pic && !lines && !list) return ''
  return `<section style="margin:14px 0 0;padding:16px;border:1px solid #d7d2c5;border-radius:18px;background:#fff">${pic}${lines}<a href="${esc(`${base}/?join=${profile.id}`)}" style="display:inline-flex;align-items:center;min-height:44px;margin-top:8px;padding:0 16px;border-radius:12px;background:#174c36;color:#fff;font-weight:750;text-decoration:none">Say hi on Allworld</a></section>${list ? `<h2>Posts</h2><ul class="history">${list}</ul>` : ''}`
}
