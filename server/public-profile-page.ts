import type { PublicCharacterProfile, PublicHistoryEntry } from '../src/types/public-profile.ts'
import { OG_IMAGE, safeOrigin } from './growth/share.ts'
import { escapeHtml as esc } from './path-meta.ts'

const kindLabel = (kind: PublicHistoryEntry['kind']): string => ({ achievement: 'Achievement', story: 'Story', project: 'Project', collection: 'Collection' })[kind]
const date = (at: number): string => new Date(at).toISOString().slice(0, 10)
const originLabel = (origin: PublicHistoryEntry['origins'][number]): string => ({ human: 'Human play', 'delegated-agent': 'Delegated assistance', 'agent-character': 'Agent play', system: 'Game system', unknown: 'Origin not recorded' })[origin]
const origins = (row: PublicHistoryEntry): string => row.origins.length ? row.origins.map(originLabel).join(', ') : 'Origin not recorded'

const STYLE = `@media(min-width:1800px){body{zoom:1.25}}@media(min-width:2800px){body{zoom:1.6}}*{box-sizing:border-box}body{margin:0;background:#f3f0e7;color:#193126;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-text-size-adjust:100%}
a{color:inherit}.wrap{width:min(680px,100%);margin:0 auto;padding:18px 16px 48px}.top{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px}.brand{display:inline-flex;align-items:center;min-height:44px;font-weight:850;text-decoration:none}.type{font-size:14px;color:#53665d;text-align:right}
.cover{margin:10px 0 0;padding:24px 20px;border-radius:22px;background:#174c36;color:#fff;box-shadow:0 14px 36px #123b2920}.cover h1{margin:3px 0 5px;font-size:clamp(29px,9vw,46px);line-height:1.03;letter-spacing:-.035em;overflow-wrap:anywhere}.cover p{margin:0;color:#d7ebe0}
.counts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;margin:16px 0 0;overflow:hidden;border:1px solid #d7d2c5;border-radius:16px;background:#d7d2c5}.counts div{padding:11px 7px;background:#fff;text-align:center}.counts b{display:block;font-size:21px}.counts span{display:block;font-size:13px;color:#55635c;overflow-wrap:anywhere}
h2{margin:28px 2px 11px;font-size:19px}.badges,.history{list-style:none;margin:0;padding:0;display:grid;gap:9px}.badges li,.history li{padding:14px;border:1px solid #d7d2c5;border-radius:15px;background:#fff}.badges b,.history b{display:block;overflow-wrap:anywhere}.stamp{display:inline-block;margin-bottom:5px;padding:2px 8px;border-radius:99px;background:#e4f2e9;color:#236341;font-size:12px;font-weight:750}.meta{margin:4px 0 0;color:#55635c;font-size:14px}.memento{margin:9px 0 0;padding:10px;border-left:3px solid #d29a30;background:#fff8e6;font-size:14px}.memento strong{display:block}.empty{padding:18px;border:1px dashed #bfc6c0;border-radius:15px;color:#55635c}.older{display:flex;align-items:center;justify-content:center;min-height:44px;margin:18px 0 0;padding:11px 16px;border-radius:12px;background:#174c36;color:#fff;font-weight:750;text-decoration:none}.address{margin:24px 0 0;padding:12px;border-radius:12px;background:#e7e3d8;color:#46594f;font-size:13px;overflow-wrap:anywhere}.foot{margin:12px 0 0;text-align:center;font-size:14px;color:#55635c}.foot a{display:inline-flex;align-items:center;min-height:44px;padding:0 12px}
.gone{text-align:center;padding-top:64px}.gone h1{font-size:30px}.gone a{display:inline-flex;align-items:center;min-height:44px;margin-top:14px;padding:11px 16px;border-radius:12px;background:#174c36;color:#fff;font-weight:750;text-decoration:none}@media(max-width:390px){.counts{grid-template-columns:repeat(2,minmax(0,1fr))}.cover{padding:21px 17px}}`

function head(origin: unknown, path: string, title: string, description: string): string {
  const base = safeOrigin(origin), url = `${base}${path}`
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name="description" content="${esc(description)}"><meta name="robots" content="noindex, nofollow"><link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="profile"><meta property="og:site_name" content="Allworld"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(`${base}${OG_IMAGE}`)}"><meta property="og:image:alt" content="Allworld">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${esc(`${base}${OG_IMAGE}`)}"><style>${STYLE}</style></head>`
}

export function unavailableProfilePageHtml(origin: unknown = ''): string {
  const base = safeOrigin(origin), title = 'Profile unavailable — Allworld', description = 'This public character profile is hidden, expired or the link is wrong.'
  return `${head(origin, '/', title, description)}<body><main class="wrap gone"><h1>Profile unavailable</h1><p>This character may have hidden their public profile, or the link may be wrong.</p><a href="${esc(`${base}/`)}">Open Allworld</a></main></body></html>`
}

/** `social`: the feed's block (server/feed/pages.ts profileSocialHtml), already escaped; empty when the person set nothing. */
export function publicProfilePageHtml(profile: PublicCharacterProfile, origin: unknown = '', social = '', landing = ''): string {
  // `landing`: the cleaned ad-source words the page was opened with (a shared clip's link has utm_source=clip), kept on the links into the game so the landing is counted.
  const base = safeOrigin(origin), open = landing ? `${base}/?${landing}` : `${base}/`, canonical = `${base}${profile.path}`, kind = profile.kind === 'agent' ? 'Agent character' : 'Human character'
  const total = profile.counts.achievements + profile.counts.stories + profile.counts.projects + profile.counts.collections
  const description = `${profile.name}'s ${kind.toLowerCase()} record on Allworld: ${total} earned accomplishment${total === 1 ? '' : 's'}.`
  const badges = profile.achievements.map(row => `<li><span class="stamp">${esc(row.path)}</span><b>${esc(row.title)}${row.pinned ? ' · Pinned' : ''}</b><p class="meta">Earned ${date(row.earnedAt)} · ${esc(row.origins.length ? row.origins.map(originLabel).join(', ') : 'Origin not recorded')}</p></li>`).join('')
  const history = profile.history.map(row => `<li><span class="stamp">${kindLabel(row.kind)}</span><b>${esc(row.title)}</b><p class="meta">Earned ${date(row.earnedAt)} · ${esc(origins(row))}</p>${row.memento ? `<div class="memento"><strong>${esc(row.memento.icon)} ${esc(row.memento.title)}</strong>${esc(row.memento.description)}</div>` : ''}</li>`).join('')
  const older = profile.next ? `<a class="older" href="${esc(`${profile.path}?after=${encodeURIComponent(profile.next)}`)}">Older accomplishments</a>` : ''
  return `${head(origin, profile.path, `${profile.name}'s accomplishments — Allworld`, description)}<body><main class="wrap"><div class="top"><a class="brand" href="${esc(open)}">Allworld</a><span class="type">Public character record</span></div>
<section class="cover"><p>${kind}</p><h1>${esc(profile.name)}</h1><p>Earned achievements and completed stories, projects and collections.</p></section>${social}
<section class="counts" aria-label="Accomplishment totals"><div><b>${profile.counts.achievements}</b><span>Achievements</span></div><div><b>${profile.counts.stories}</b><span>Stories</span></div><div><b>${profile.counts.projects}</b><span>Projects</span></div><div><b>${profile.counts.collections}</b><span>Collections</span></div></section>
<h2>Earned badges</h2>${badges ? `<ul class="badges">${badges}</ul>` : '<p class="empty">No earned achievement badges are recorded yet.</p>'}
<h2>Accomplishment history</h2>${history ? `<ul class="history">${history}</ul>${older}` : '<p class="empty">No completed stories, projects, collections or achievements are recorded yet.</p>'}
<p class="address">Share this public address: ${esc(canonical)}</p><p class="foot"><a href="${esc(open)}">Open Allworld</a></p></main></body></html>`
}
