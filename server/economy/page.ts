/**
 * OWNER: social
 * The public economy page of a city, /economy/<city> (ctx.pages on both hosts; the Worker lists the prefix): plain HTML with no script and no
 * cookie, its own preview tags, every value escaped. It prints server/economy/dashboard.ts and nothing else. Game naira only.
 */
import { OG_IMAGE, safeOrigin } from '../growth/share.ts'
import { escapeHtml as esc } from '../path-meta.ts'
import { naira } from '../../src/promote/model.ts'
import type { EconomyView } from '../../src/types/neighbourhood.ts'

const STYLE = `*{box-sizing:border-box}body{margin:0;background:#f3f0e7;color:#193126;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-text-size-adjust:100%}
.wrap{max-width:760px;margin:0 auto;padding:22px 16px 48px}.brand{display:inline-flex;align-items:center;min-height:44px;font-weight:850;text-decoration:none;color:#0f5132}h1{font-size:clamp(26px,7vw,38px);line-height:1.1;margin:14px 0 4px}h2{font-size:18px;margin:26px 0 8px}
.meta{color:#53665d;font-size:14px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:14px 0}.stat{padding:14px 12px;border-radius:16px;background:#174c36;color:#fff}.stat b{display:block;font-size:clamp(18px,5.4vw,22px);line-height:1.25;overflow-wrap:anywhere}.stat span{display:block;margin-top:2px;font-size:14px;line-height:1.35;opacity:.92}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden}th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #e6e1d3;font-size:15px}td.n,th.n{text-align:right}.go{display:inline-block;margin:18px 0 8px;padding:13px 18px;border-radius:14px;background:#f2b134;color:#193126;font-weight:850;text-decoration:none}a{color:#0f5132}`

export function economyNotFoundHtml(origin: unknown): string {
  const base = safeOrigin(origin)
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>City not found — Allworld</title><meta name="robots" content="noindex"><style>${STYLE}</style></head><body><main class="wrap"><a class="brand" href="${esc(`${base}/`)}">Allworld</a><h1>City not found</h1><p>That city is not in the world yet.</p><a class="go" href="${esc(`${base}/`)}">Open Allworld</a></main></body></html>`
}
const rows = (list: readonly { rank: number; name: string; amount: number }[]): string => (list.length ? `<table><tr><th>#</th><th>Name</th><th class="n">Game naira</th></tr>${list.map((r) => `<tr><td>${r.rank}</td><td>${esc(r.name)}</td><td class="n">${esc(naira(r.amount))}</td></tr>`).join('')}</table>` : '<p class="meta">Nobody is listed yet.</p>')

export function economyPageHtml(v: EconomyView, origin: unknown): string {
  const base = safeOrigin(origin), title = `The economy of ${v.cityName} · Allworld`
  const description = `${v.cityName} on Allworld: ${naira(v.circulation.total)} game naira in circulation, ${v.government.governor ? `${v.government.title} ${v.government.governor}` : `no ${v.government.title} yet`}, prices and the rich list. Game naira is never real money.`
  const g = v.government
  const prices = v.prices.length ? `<table><tr><th>Commodity</th><th class="n">Median price</th><th class="n">Trades today</th></tr>${v.prices.map((p) => `<tr><td>${esc(p.label)} <span class="meta">(${esc(p.unit)})</span></td><td class="n">${esc(naira(p.median))}</td><td class="n">${p.source === 'trades' ? p.trades : 'reference'}</td></tr>`).join('')}</table>` : '<p class="meta">The market of this city has not opened yet.</p>'
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(`${base}/economy/${v.city}`)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Allworld"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(`${base}/economy/${v.city}`)}"><meta property="og:image" content="${esc(`${base}${OG_IMAGE}`)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><style>${STYLE}</style></head>
<body><main class="wrap"><a class="brand" href="${esc(`${base}/`)}">Allworld</a>
<h1>The economy of ${esc(v.cityName)}</h1><p class="meta">Game naira only: it is never real money and nobody can withdraw it. Week ${v.week}. From the game's own records.</p>
<div class="grid"><div class="stat"><b>${esc(naira(v.circulation.total))}</b><span>game naira in circulation</span></div><div class="stat"><b>${esc(naira(g.treasury))}</b><span>in the ${esc(g.title)}'s treasury</span></div><div class="stat"><b>${esc(naira(g.taxWeek))}</b><span>levies collected this week</span></div><div class="stat"><b>${v.circulation.players}</b><span>players seen recently</span></div></div>
<h2>The ${esc(g.title)}</h2><p>${g.governor ? `${esc(g.title)} <b>${esc(g.governor)}</b> is in office.` : `Nobody holds the ${esc(g.title)}'s seat this week.`} The treasury holds ${esc(naira(g.treasury))}. This week it took in ${esc(naira(g.taxWeek))} in levies and ${esc(naira(g.feesWeek))} in fees and bail, and paid out ${esc(naira(g.spentWeek))} in salary and grants.${g.term ? ` This term: ${esc(naira(g.term.income))} in, ${esc(naira(g.term.salary))} salary, ${esc(naira(g.term.granted))} granted.` : ''}</p>
<h2>Median prices</h2>${prices}
<h2>Where the game naira is</h2><table><tr><th>Where</th><th class="n">Game naira</th></tr><tr><td>In players' wallets</td><td class="n">${esc(naira(v.circulation.wallets))}</td></tr><tr><td>In Market accounts</td><td class="n">${esc(naira(v.circulation.market))}</td></tr><tr><td>In the treasury</td><td class="n">${esc(naira(v.circulation.treasury))}</td></tr></table>
<h2>Rich list</h2>${rows(v.rich.balances)}<h2>Top earners this week</h2>${rows(v.rich.earners)}
<p class="meta">Players can leave the rich list in the game's settings; they are not shown here either.</p>
<a class="go" href="${esc(`${base}/`)}">Open Allworld</a></main></body></html>`
}
