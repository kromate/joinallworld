/**
 * OWNER: growth
 * The public guide pages, written by both hosts (ctx.pages, registered in server/routes/profiles.ts beside /privacy; the Worker lists the prefixes):
 * /about, what Allworld is, why it was built and the vision (server/docs-about.ts), /features, every feature in the game and how to reach it, /pages, every page, screen and address, and /skills, the AI skills people use to build for it. Plain HTML with no script, the
 * privacy page's palette in a wider layout with a contents list, so a reader moves around by links alone. Every entry states what the code
 * does today (src/paths.ts, src/app/features/*, server/routes/*): when a feature or an address changes, change its line here.
 */
import { OG_IMAGE, safeOrigin } from './growth/share.ts'
import { escapeHtml as esc } from './path-meta.ts'
import { cityCatalogue } from '../src/game/cities/registry.ts'
import { worldFigures } from '../src/app/features/start/entryModel.ts'
import { FEATURE_SECTIONS } from './docs-features.ts'
import { SKILL_SECTIONS } from './docs-skills.ts'
import { aboutSections } from './docs-about.ts'

const UPDATED = '20 October 2026'

/** One line of a guide: what it is, what it does, and how to get there. */
export interface GuideEntry {
  name: string
  /** What the player can do or see. `code` in backquotes is shown as code. */
  text: string
  /** How to reach it, in the same notation. */
  open?: string
  /** Where the name links: a path on this site, or an https address elsewhere (the source code), when it is a page you can simply open. */
  href?: string
  /** A short label: Admin, Developer, Season, Lagos only, … */
  tag?: string
}

export interface GuideSection {
  id: string
  title: string
  intro?: string
  /** Paragraphs shown before the cards, for a page that reads as prose (/about). `code` in backquotes is code, `**words**` bold. */
  prose?: string[]
  entries: GuideEntry[]
}

const STYLE = `*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:72px}body{margin:0;background:#f3f0e7;color:#193126;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-text-size-adjust:100%}
a{color:#0f5132}code{font:14px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:#e6e1d3;border-radius:4px;padding:1px 5px;word-break:break-word}
.bar{position:sticky;top:0;z-index:2;background:#0f5132;color:#fff}.bar .in{max-width:1180px;margin:0 auto;padding:10px 20px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.brand{font-weight:800;color:#fff;text-decoration:none;font-size:19px;margin-right:auto}.bar nav{display:flex;gap:4px;flex-wrap:wrap}.bar nav a{color:#d9eadf;text-decoration:none;padding:5px 11px;border-radius:999px;font-size:15px}
.bar nav a:hover{background:#1c6b45;color:#fff}.bar nav a[aria-current=page]{background:#f3f0e7;color:#0f5132;font-weight:700}
.page{max-width:1180px;margin:0 auto;padding:28px 20px 64px;display:grid;grid-template-columns:250px minmax(0,1fr);gap:40px}
.toc{position:sticky;top:76px;align-self:start;max-height:calc(100vh - 96px);overflow:auto;font-size:15px}.toc b{display:block;font-size:13px;color:#5b6b63;margin-bottom:6px}
.toc ol{list-style:none;margin:0;padding:0}.toc li{margin:0}.toc a{display:flex;justify-content:space-between;gap:8px;padding:5px 10px;border-radius:8px;text-decoration:none;color:#193126}.toc a:hover{background:#e6e1d3}.toc span{color:#5b6b63;font-size:13px}
h1{font-size:34px;line-height:1.15;margin:0 0 8px}.lead{font-size:18px;color:#34493f;margin:0 0 6px;max-width:760px}.meta{color:#5b6b63;font-size:14px}
.chips{display:none;flex-wrap:wrap;gap:6px;margin:16px 0 0;padding:0;list-style:none}.chips a{display:block;padding:5px 11px;border-radius:999px;background:#e6e1d3;text-decoration:none;font-size:14px;color:#193126}
section{margin-top:40px}h2{font-size:23px;margin:0 0 4px;padding-top:8px;border-top:2px solid #d9d3c2}h2 a{color:inherit;text-decoration:none}.intro{color:#34493f;margin:4px 0 14px;max-width:760px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.card{background:#fffdf7;border:1px solid #e0dacb;border-radius:12px;padding:14px 16px}.card h3{font-size:16.5px;margin:0 0 4px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.card h3 a{text-decoration:none}.card h3 a:hover{text-decoration:underline}
.card p{margin:0 0 6px;font-size:15px}.card .how{color:#4a5c53;font-size:14px;margin:0}.card .how b{color:#193126;font-weight:600}
.tag{font-size:12px;font-weight:700;background:#fde7c4;color:#7a4b00;border-radius:999px;padding:1px 8px}
.prose{max-width:720px}.prose p{font-size:17px;line-height:1.65;margin:0 0 14px}.prose strong{color:#0f5132}.prose+.grid{margin-top:8px}
.up{display:inline-flex;align-items:center;min-height:44px;margin-top:4px;font-size:15px}.foot{margin-top:48px;font-size:14px;color:#5b6b63}
@media (max-width:860px){html{scroll-padding-top:12px}.bar{position:static}.bar .in{padding:8px 16px 4px;gap:0 12px}.brand{display:inline-flex;align-items:center;min-height:44px}.bar nav{flex:1 0 100%;flex-wrap:nowrap;gap:2px;overflow-x:auto;margin:0 -16px;padding:0 16px 4px;scrollbar-width:none}.bar nav::-webkit-scrollbar{display:none}.bar nav a{flex:none;display:inline-flex;align-items:center;min-height:44px;padding:0 10px}
.page{grid-template-columns:minmax(0,1fr);gap:0;padding:20px 16px 48px}.page>*{min-width:0}.grid{grid-template-columns:minmax(0,1fr)}.toc{display:none}.chips{display:flex;flex-wrap:nowrap;overflow-x:auto;margin:16px -16px 0;padding:0 16px 4px;gap:8px;scrollbar-width:none;-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent)}.chips::-webkit-scrollbar{display:none}.chips li{flex:none}.chips a{display:flex;align-items:center;min-height:44px;padding:0 14px}h1{font-size:28px}.lead{font-size:17px;line-height:1.5}.card{padding:14px}section{margin-top:32px}}@media(min-width:1700px){.bar .in,.page{max-width:1480px}.page{grid-template-columns:280px minmax(0,1fr);gap:56px}.grid{grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}.lead{font-size:19px}}@media(min-width:2800px){.bar,.page{zoom:1.4}.toc{max-height:none}}`

/** Escape, then show `backquoted` words as code. */
const rich = (text: string): string => esc(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

function entryHtml(entry: GuideEntry, base: string): string {
  const external = entry.href?.startsWith('https://') ?? false
  const name = entry.href ? `<a href="${esc(external ? entry.href : `${base}${entry.href}`)}"${external ? ' rel="noopener"' : ''}>${esc(entry.name)}</a>` : esc(entry.name)
  const tag = entry.tag ? ` <span class="tag">${esc(entry.tag)}</span>` : ''
  const how = entry.open ? `<p class="how"><b>Open:</b> ${rich(entry.open)}</p>` : ''
  return `<div class="card"><h3>${name}${tag}</h3><p>${rich(entry.text)}</p>${how}</div>`
}

interface GuideOptions { path: GuidePath; title: string; heading: string; lead: string; description: string; sections: readonly GuideSection[]; /** The line under the lead; the entry count when absent. */ meta?: string }

export type GuidePath = '/about' | '/features' | '/pages' | '/skills'

const NAV: readonly [string, string][] = [['/about', 'About'], ['/features', 'Features'], ['/pages', 'Pages'], ['/skills', 'Skills'], ['/money', 'Money'], ['/privacy', 'Privacy']]

function guideHtml(origin: unknown, o: GuideOptions): string {
  const base = safeOrigin(origin)
  const nav = NAV.map(([path, label]) => `<a href="${esc(`${base}${path}`)}"${path === o.path ? ' aria-current="page"' : ''}>${label}</a>`).join('')
  const toc = o.sections.map((s) => `<li><a href="#${s.id}">${esc(s.title)}${s.entries.length ? ` <span>${s.entries.length}</span>` : ''}</a></li>`).join('')
  const chips = o.sections.map((s) => `<li><a href="#${s.id}">${esc(s.title)}</a></li>`).join('')
  const total = o.sections.reduce((n, s) => n + s.entries.length, 0)
  const body = o.sections.map((s) => `<section id="${s.id}"><h2><a href="#${s.id}">${esc(s.title)}</a></h2>${s.intro ? `<p class="intro">${rich(s.intro)}</p>` : ''}${s.prose ? `<div class="prose">${s.prose.map((p) => `<p>${rich(p)}</p>`).join('')}</div>` : ''}${s.entries.length ? `<div class="grid">${s.entries.map((e) => entryHtml(e, base)).join('')}</div>` : ''}<a class="up" href="#top">Back to top</a></section>`).join('\n')
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}"><link rel="canonical" href="${esc(`${base}${o.path}`)}"><meta property="og:title" content="${esc(o.title)}"><meta property="og:description" content="${esc(o.description)}"><meta property="og:image" content="${esc(`${base}${OG_IMAGE}`)}"><style>${STYLE}</style></head>
<body id="top"><header class="bar"><div class="in"><a class="brand" href="${esc(`${base}/`)}">Allworld</a><nav aria-label="Guides">${nav}</nav></div></header>
<div class="page"><aside class="toc" aria-label="On this page"><b>On this page</b><ol>${toc}</ol></aside><main>
<h1>${esc(o.heading)}</h1><p class="lead">${rich(o.lead)}</p><p class="meta">${esc(o.meta ?? `${total} entries in ${o.sections.length} sections`)} · Updated ${UPDATED}</p><ul class="chips" aria-label="Sections">${chips}</ul>
${body}
<p class="foot">This guide is kept in step with the game's code; the source is public (AGPL). <a href="${esc(`${base}/`)}">Back to Allworld</a></p></main></div></body></html>`
}

/** "284 cities in 243 countries", from the city registry, so the page never goes stale when a city opens. */
function worldLine(): string {
  const { cities, countries } = worldFigures(cityCatalogue())
  return `${cities} open cities in ${countries} countries`
}

export function aboutPageHtml(origin: unknown = ''): string {
  const world = worldLine()
  return guideHtml(origin, {
    path: '/about', title: 'About — Allworld', heading: 'About Allworld',
    lead: 'A digital world you can live in, built to hold the whole world. What it is, why we built it, and where it is going.',
    description: `Allworld is a free digital world in your browser: ${world}, people and AI living side by side. Why we built it, and the vision of the whole world in one place.`,
    sections: aboutSections(world), meta: 'A short read',
  })
}

export function featuresPageHtml(origin: unknown = ''): string {
  return guideHtml(origin, {
    path: '/features', title: 'Features — Allworld', heading: 'Everything you can do in Allworld',
    lead: `Allworld is a digital world you live in, free in your browser: ${worldLine()}, a home of your own, work, money, friends, games and politics. Here is every feature, grouped, with how to reach it.`,
    description: 'Every feature in Allworld, grouped and explained: your character, cities and travel, homes, friends and chat, work and money, games, politics, AI agents and more.',
    sections: FEATURE_SECTIONS,
  })
}

export function pagesPageHtml(origin: unknown = ''): string {
  return guideHtml(origin, {
    path: '/pages', title: 'Pages — Allworld', heading: 'Every page and screen in Allworld',
    lead: 'The addresses you can open, the links people share, and every screen, phone app and panel inside the game. A linked name opens that page.',
    description: 'A map of Allworld: every web address, share link, in-game screen, phone app, panel and keyboard shortcut, with what each one shows and how to open it.',
    sections: PAGE_SECTIONS,
  })
}

export function skillsPageHtml(origin: unknown = ''): string {
  return guideHtml(origin, {
    path: '/skills', title: 'Skills — Allworld', heading: 'AI skills for Allworld',
    lead: 'Give your own AI assistant a skill and it can copy your real house into the game, design a room, or build a small game, and connect to play beside you.',
    description: 'The AI skills for Allworld: copy your real house from photos, design a home or room, build a game, and connect ChatGPT, Claude or any MCP client to play.',
    sections: SKILL_SECTIONS,
  })
}

/** The guides' own addresses. Each answers its exact path (and a trailing slash) only: anything under /skills/ is a file of a skill, served as before. */
const GUIDES: Readonly<Record<GuidePath, (origin: unknown) => string>> = { '/about': aboutPageHtml, '/features': featuresPageHtml, '/pages': pagesPageHtml, '/skills': skillsPageHtml }
export function guidePage(path: string, origin: unknown): string | null {
  const exact = path.length > 1 ? path.replace(/\/$/, '') : path
  return Object.hasOwn(GUIDES, exact) ? GUIDES[exact as GuidePath](origin) : null
}

export const PAGE_SECTIONS: readonly GuideSection[] = [
  {
    id: 'start', title: 'Start here',
    intro: 'Short addresses open the game on the right screen. Most of them show the same game page; the game reads the address and opens the screen it names.',
    entries: [
      { name: 'Home', href: '/', text: 'The front door. A new device sees one card: Play now, Sign up free, Log in or Make my character first. A returning player goes straight back into their life.', open: '`/`' },
      { name: 'Allworld Lite', href: '/app', text: 'Allworld without 3D: five tabs (Feed, Here, Chats, People, Me). Used automatically when a browser cannot draw 3D.', open: '`/app` or `?lite=1` (`?lite=0` turns it off)' },
      { name: 'Sign up', href: '/signup', text: 'Make an account so your character follows you to another phone.', open: '`/signup`' },
      { name: 'Log in', href: '/login', text: 'Sign in to an existing account.', open: '`/login`' },
      { name: 'Features', href: '/features', text: 'Every feature in the game, grouped, with how to reach it.', open: '`/features`' },
      { name: 'Pages', href: '/pages', text: 'This page: every address, screen and app.', open: '`/pages`' },
      { name: 'Skills', href: '/skills', text: 'AI skills that copy your house, design a room or build a game, and how to connect your AI.', open: '`/skills`' },
      { name: 'About', href: '/about', text: 'What Allworld is, why we built it and the vision of the whole world in one place.', open: '`/about`' },
      { name: 'Money', href: '/money', text: 'Game naira is never real money. What real money exists, who holds it, and how to report a scam.', open: '`/money`' },
      { name: 'Privacy', href: '/privacy', text: 'What Allworld stores, what never leaves your phone, and how to download or erase your account.', open: '`/privacy`' },
    ],
  },
  {
    id: 'world', title: 'World, cities and places',
    entries: [
      { name: 'World map', href: '/world', text: 'The atlas of every open city in the world. Pick a city to see its card and travel there.', open: '`/world` or `/map`' },
      { name: 'Nigeria map', href: '/nigeria', text: 'The atlas at the Nigeria level, state by state.', open: '`/nigeria`' },
      { name: 'A city', href: '/lagos', text: 'In your own city: the city map. Anywhere else: the world map with that city’s travel card open. Every open city has its own address.', open: '`/<city>`, e.g. `/lagos`, `/abuja`, `/accra`, `/london`' },
      { name: 'A state', href: '/ogun', text: 'A state page listing its open cities. A state with one open city behaves like that city.', open: '`/<state>`, e.g. `/ogun`' },
      { name: 'A venue', text: 'A place inside a city. In your own city the map opens on that venue.', open: '`/<city>/<venue>`' },
      { name: 'Games in a city', href: '/lagos/games', text: 'The games at a city’s venues; elsewhere, its travel card.', open: '`/<city>/games`' },
      { name: 'Walk your street', href: '/street', text: 'Find your own street. With a city and place, the map opens on that local area or district.', open: '`/street` or `/street/<city>/<place>`' },
      { name: 'Visit home', href: '/visit', text: 'For people living abroad: visit your home city. In December it becomes Detty December in Lagos, Accra or Abuja.', open: '`/visit` or `/visit/<city>`' },
      { name: 'The Square', href: '/square', text: 'The world’s shared public square: who is here, voice, chat and building together.', open: '`/square`' },
      { name: 'UNILAG campus', href: '/unilag', text: 'The walkable University of Lagos campus: study, residence and community.', open: '`/unilag`', tag: 'Lagos' },
      { name: 'City economy', href: '/economy/lagos', text: 'A city’s public numbers: the governor, the treasury, median prices, money in circulation, the rich list and top earners.', open: '`/economy/<city>`' },
      { name: 'City episode', href: '/episode/lagos', text: 'The week in a city, written as an episode. The last eight weeks can be read.', open: '`/episode/<city>` or `/episode/<city>/<monday>`' },
    ],
  },
  {
    id: 'entry', title: 'Topic pages',
    intro: 'Each opens the game on one subject, with its own preview when shared.',
    entries: [
      { name: 'Games', href: '/games', text: 'Chess, Oro (a new word every day), Weave, Whot, penalties and Ayo, against the computer or at a table with friends.', open: '`/games`, also `/play`' },
      { name: 'Chess', href: '/games/chess', text: 'Chess against the computer: easy, medium or hard.', open: '`/games/chess` or `/chess`' },
      { name: 'Oro, the daily word', href: '/games/oro', text: 'One word puzzle a day, the same for everyone. Six tries; share your squares.', open: '`/games/oro` or `/word`' },
      { name: 'Weave', href: '/games/weave', text: 'The word-tile game: weave words across the cloth with seven tiles.', open: '`/games/weave`' },
      { name: 'Whot', href: '/games/whot', text: 'The card game, against the computer or at a table with friends.', open: '`/games/whot`' },
      { name: 'Penalties', href: '/games/penalties', text: 'The penalty shootout against the computer.', open: '`/games/penalties`' },
      { name: 'Ayo', href: '/games/ayo', text: 'Sow and capture seeds, played with Oware rules.', open: '`/games/ayo`' },
      { name: 'Open a shop', href: '/shops', text: 'Open a free shop for your real business; opens Services on My shop.', open: '`/shops` or `/sell`' },
      { name: 'List your services', href: '/services', text: 'List the services you offer in a virtual office.', open: '`/services`' },
      { name: 'Politics', href: '/politics', text: 'Run for governor this week: seats, elections, parties and the treasury.', open: '`/politics`' },
      { name: 'Detty December', href: '/detty', text: 'The December season in Lagos, Accra and Abuja; opens Events on the season.', open: '`/detty`', tag: 'Season' },
      { name: 'AI agents', href: '/agents', text: 'Let your own AI agent play Allworld.', open: '`/agents` or `/ai`' },
    ],
  },
  {
    id: 'shortcuts', title: 'Screen shortcuts',
    intro: 'These open one screen of the game once you have a character.',
    entries: [
      { name: 'Messages', href: '/messages', text: 'Your chats and updates.', open: '`/messages`' },
      { name: 'Friends', href: '/friends', text: 'People: players, requests and blocks.', open: '`/friends`' },
      { name: 'Invite', href: '/invite', text: 'Your house invite link and knocks.', open: '`/invite`' },
      { name: 'Business', href: '/business', text: 'Your business and this market’s stalls.', open: '`/business`' },
      { name: 'Jobs', href: '/jobs', text: 'Your job and the listings.', open: '`/jobs`' },
      { name: 'Danfo', href: '/danfo', text: 'Drive a danfo: motor park lines and weekly boards.', open: '`/danfo`' },
      { name: 'Records', href: '/records', text: 'Politics, on the Records tab.', open: '`/records`' },
      { name: 'Help', href: '/help', text: 'How to play, the tour, shortcuts and credits.', open: '`/help`' },
      { name: 'Settings', href: '/sound', text: 'Sound, camera, data, privacy, account and AI agents.', open: '`/sound`' },
      { name: 'Feedback', href: '/feedback', text: 'The public ideas board and problem reports.', open: '`/feedback`' },
    ],
  },
  {
    id: 'agents', title: 'AI agent pages',
    entries: [
      { name: 'Agent league', href: '/agents/league', text: 'The weekly ranking of AI agents, live matches, cups and winners. Add `?by=alltime` for all time.', open: '`/agents/league`' },
      { name: 'Connect an agent', href: '/agents/join', text: 'How to connect your AI agent; “Make my key” opens Settings → AI agents.', open: '`/agents/join`' },
      { name: 'One agent', text: 'An AI agent’s profile, always labelled AI-played.', open: '`/agents/<name>`' },
      { name: 'Agent cup', text: 'A cup’s rounds, scores and results.', open: '`/agents/cup/<id>`' },
      { name: 'Agent challenge', text: 'One challenge between two agents.', open: '`/agents/challenge/<code>`' },
      { name: 'Agent match', text: 'One match between agents.', open: '`/agents/match/<id>`' },
      { name: 'Claim an agent', text: 'Claim an agent as yours; opens Settings → AI agents.', open: '`/agents/claim/<token>`' },
    ],
  },
  {
    id: 'links', title: 'Share and invite links',
    intro: 'Links players send each other. Each lands on the right screen.',
    entries: [
      { name: 'Public profile', text: 'A player’s badges, history and public posts, if they allow it.', open: '`/p/@handle` or `/p/<id>`; made from Phone → My profile' },
      { name: 'Shop page', text: 'A seller’s public shop.', open: '`/shop/<name>-<token>`; made from Services → My shop → Share' },
      { name: 'Invite a friend', text: '“You’re joining …”, then the Invite panel with the host.', open: '`/v/<id>`, or `?join=<id>`' },
      { name: 'House link', text: 'An invitation to visit a home.', open: '`/h/<token>`; made from Phone → Invite' },
      { name: 'Ping a friend', text: 'A friend who is not yet in the game lands where you are.', open: '`/j/<token>`' },
      { name: 'Share card', text: 'The preview page for a shared card; the link counts as a referral for a week.', open: '`/s/<code>`' },
      { name: 'Community', text: 'Join a community or crew.', open: '`/c/<code>`' },
      { name: 'Plan or event', text: 'An event page with RSVP.', open: '`/ev/<code>`' },
      { name: 'Group room', text: 'An invite to a group room.', open: '`/r/<number>-<key>`' },
      { name: 'Player world', text: 'An invite into a world a player made.', open: '`/w/<id>`' },
      { name: 'Game table or match', text: '“Join my match”: opens the table or the arena room. A clan invite uses the same link.', open: '`?table=<id>`' },
      { name: 'Match replay', text: 'The replay of a finished arena match, also used for shared clips.', open: '`/replay?replay=<match>`' },
      { name: 'Story help', text: 'Help a friend through a story scene together.', open: '`?storyHelp=<id>`' },
      { name: 'Mail buttons', text: 'Buttons in Allworld e-mails open one screen: needs, messages, people, career, houses, events, governor, tables, bank, stay in touch or a shop.', open: '`/?go=<screen>`' },
      { name: 'E-mail confirm and unsubscribe', text: 'A page with one button; only pressing it confirms or unsubscribes.', open: '`/e/confirm?t=…`, `/e/unsub?t=…`' },
    ],
  },
  {
    id: 'first-run', title: 'First visit',
    entries: [
      { name: 'Loading screen', text: 'Shown while the city and game load. After 40 seconds it offers Retry and Start fresh.', open: 'Every visit' },
      { name: 'Front door', text: 'A world backdrop with Play now, Sign up, Log in and Make my character first, and how many people are online.', open: 'A new device' },
      { name: 'Character creator', text: 'Five steps: Who are you, Look, Spirit, Home, Ready. Play now is on every step.', open: 'Front door → Make my character first' },
      { name: 'Settle in', text: 'Make this life yours: choose a home and finish your character. Offered, never forced.', open: 'The Settle in chip, or Home or Buy as a guest' },
      { name: 'Find my city', text: 'Finds your city on your phone; your position is never sent.', open: 'Front door' },
      { name: 'First minute', text: 'What is near, who is here and one thing to do.', open: 'Once per session' },
      { name: 'Tour', text: 'A walk through the screen.', open: '`?` key, Help → Take the tour, or Settings → Show the tour again' },
      { name: 'Add to your phone', text: 'Install Allworld like an app; a tip appears inside Instagram or TikTok browsers.', open: 'After a first session' },
    ],
  },
  {
    id: 'screens', title: 'Main screens',
    intro: 'The bottom bar has four tabs: Home, Buy, Map and Phone.',
    entries: [
      { name: 'Where you are', text: 'The 3D scene of the place you are in, with its spots and activities.', open: 'Always behind the panels' },
      { name: 'Home', text: 'Your home in 3D. Tap furniture to use, move or sell it. Away from home, a card offers the trip back.', open: 'Home tab or `H`' },
      { name: 'Buy mode', text: 'The furniture catalogue: place, rotate and sell pieces in your home.', open: 'Buy tab or `B`, at home' },
      { name: 'Map', text: 'The city map in 3D or flat, with levels from the world down to the street, a trip bar and layers (Moving, Billboards, Sea, Neighbours, Government).', open: 'Map tab or `M`; `G` for the world' },
      { name: 'Phone', text: 'Every app, on two pages, with a dock of four.', open: 'Phone tab or `P`' },
      { name: 'Sim sheet', text: 'Your character: Profile, Needs, Goals, Skills, People, Career and Settings.', open: 'Tap your name, or `I`' },
      { name: 'Place panel', text: 'In the Square or a group room: who is here, voice, chat, building together and the room link.', open: 'Enter a place' },
      { name: 'Walk through a space', text: 'Walk a home, room or world in full screen and place models.', open: 'Houses, Worlds or Places' },
      { name: 'Arena', text: 'Full-screen live games: Fight, Race, Football and games made by players.', open: 'Games → live games, or a match link' },
      { name: 'Danfo run', text: 'Drive a danfo along a real line, picking up passengers.', open: 'Phone → Drive a danfo' },
      { name: 'Practice', text: 'Driving, barber, clerk and justice practice.', open: 'Phone → Practice apps' },
      { name: 'Story mode', text: 'Story scenes, a street walk and each story’s signature game, alone or with a friend.', open: 'Phone → My Life → Story mode' },
    ],
  },
  {
    id: 'phone-life', title: 'Phone apps: life',
    entries: [
      { name: 'My Life', text: 'Your progress: badges, stories, collections, Wrapped, street video and Story mode.', open: 'Phone' },
      { name: 'Missions', text: 'Three daily and three weekly missions, a stamp card and days lived.', open: 'Phone' },
      { name: 'Ride', text: 'Choose how you travel once, then tap Go beside any place.', open: 'Phone dock' },
      { name: 'Groceries', text: 'Buy ingredients in one tap, with a basket.', open: 'Phone' },
      { name: 'Health', text: 'Sickness risk, the weather and cures with prices.', open: 'Phone' },
      { name: 'Houses', text: 'Your house, upgrades, visitors, renting, passing it on and hosting.', open: 'Phone' },
      { name: 'Worlds', text: 'Make and enter your own worlds and browse others’.', open: 'Phone' },
      { name: 'My land', text: 'Buy and see plots of land.', open: 'Phone' },
      { name: 'My street', text: 'Your street’s neighbours; walk to their doors.', open: 'Phone' },
      { name: 'Boutique', text: 'Buy and try on hair, outfits and shoes.', open: 'Phone' },
      { name: 'Cars', text: 'The dealer: buy, drive and sell cars.', open: 'Phone' },
      { name: 'Practice', text: 'Driving school, barber, clerk and justice practice.', open: 'Phone' },
      { name: 'Seasons', text: 'NYSC and JAMB seasonal games.', open: 'Phone', tag: 'Nigeria' },
      { name: 'Story scenes', text: 'Make and run story scenes.', open: 'Phone' },
      { name: 'Capture', text: 'Take a photo or a six-second clip and share it.', open: 'Phone' },
      { name: 'Goals', text: 'Your starter goal, dream, wishes and perks.', open: 'Phone or Sim sheet' },
      { name: 'Career', text: 'Your track, pay and promotion.', open: 'Phone or Sim sheet' },
      { name: 'Stay in touch', text: 'Notifications and e-mail, only if you say yes.', open: 'Phone' },
      { name: 'Feedback', text: 'The public ideas board and problem reports.', open: 'Phone' },
      { name: 'Help', text: 'How to play, the tour, shortcuts and credits.', open: 'Phone' },
      { name: 'Settings', text: 'Wallpaper, camera view (with Reduce shake and flashes), guidance, sound, data, calls, visit door, residence, account, privacy, AI agent memory, mail and credits.', open: 'Phone or Sim sheet' },
    ],
  },
  {
    id: 'phone-money', title: 'Phone apps: money',
    entries: [
      { name: 'Jobs', text: 'Your job, how work works and the listings.', open: 'Phone dock' },
      { name: 'Work', text: 'The gig board, with reviews.', open: 'Phone' },
      { name: 'Earn', text: 'Real money through Bachs: payout account, tickets, gigs and the creator pool.', open: 'Phone' },
      { name: 'Drive a danfo', text: 'Motor park lines, runs and weekly boards.', open: 'Phone' },
      { name: 'Market haggle', text: 'Haggle with AI traders.', open: 'Phone' },
      { name: 'Bank', text: 'Balance, bills, rent, loans, savings and every payment.', open: 'Phone dock' },
      { name: 'Statement', text: 'Why your balance is what it is.', open: 'Phone' },
      { name: 'Business', text: 'Your business’s cash box and stock, and this market’s stalls.', open: 'Phone' },
      { name: 'My Store', text: 'Connect your real online store.', open: 'Phone' },
      { name: 'Services', text: 'Browse shops, open one, and edit your own.', open: 'Phone' },
      { name: 'Businesses', text: 'The city’s business listing and paid boosts.', open: 'Phone' },
      { name: 'Invest', text: 'Fixed deposits.', open: 'Phone' },
      { name: 'Market', text: 'The commodity exchange, with game money.', open: 'Phone' },
      { name: 'Rich List', text: 'The richest and the top earners; you can hide your balance.', open: 'Phone' },
    ],
  },
  {
    id: 'phone-people', title: 'Phone apps: people',
    entries: [
      { name: 'Feed', text: 'Posts near you, from friends, your city and the world.', open: 'Phone' },
      { name: 'Messages', text: 'Chats, groups and updates.', open: 'Phone dock' },
      { name: 'My profile', text: 'Handle, bio, status, portrait and friend code: your public page.', open: 'Phone' },
      { name: 'Places', text: 'Doors into the Square and your group rooms.', open: 'Phone' },
      { name: 'World event', text: 'This week’s event, and election night.', open: 'Phone' },
      { name: 'Watch', text: 'Match nights, Allworld House and premieres.', open: 'Phone' },
      { name: 'Gist', text: 'City talk, the front page, birthdays and works.', open: 'Phone' },
      { name: 'Communities', text: 'Crews and place communities.', open: 'Phone' },
      { name: 'Plans', text: 'Events with RSVP, the noticeboard and talks.', open: 'Phone' },
      { name: 'Contacts', text: 'Mummy, saved contacts and finding a player.', open: 'Phone' },
      { name: 'AI agents', text: 'AI agents online: chat, call or go to them.', open: 'Phone' },
      { name: 'Skit studio', text: 'Write and record skits.', open: 'Phone' },
      { name: 'Family', text: 'Marriage and a shared home.', open: 'Phone' },
      { name: 'Invite', text: 'Your house invite link and knocks.', open: 'Phone' },
      { name: 'Bring a friend', text: 'Your referral link and progress.', open: 'Phone' },
      { name: 'People', text: 'Players, requests and blocks.', open: 'Phone, Sim sheet or `E`' },
    ],
  },
  {
    id: 'phone-city', title: 'Phone apps: city',
    entries: [
      { name: 'Governor', text: 'The election, candidates and the tally. The title follows the city (Chairman, Governor, …).', open: 'Phone' },
      { name: 'Politics', text: 'Seats, weekly elections, rules, the treasury and parties.', open: 'Phone' },
      { name: 'Events', text: 'Festivals and the calendar, with export.', open: 'Phone' },
      { name: 'Neighbours', text: 'The directory of homes by district.', open: 'Phone' },
      { name: 'Tables', text: 'Game tables where you are: chess, Weave, Whot, penalties and Ayo.', open: 'Phone' },
      { name: 'Games', text: 'Oro, practice, live games, clans and making your own game.', open: 'Phone' },
      { name: 'Billboards', text: 'Rent an advert slot in the city.', open: 'Phone' },
      { name: 'Gem hunt', text: 'The daily hunt.', open: 'Phone or the hunt chip' },
      { name: 'Radio', text: 'Club radio shout-outs.', open: 'Phone' },
      { name: 'Campus', text: 'UNILAG: overview, study, residence and community.', open: 'Phone', tag: 'Lagos' },
      { name: 'Report a problem', text: 'File a report and follow its receipt.', open: 'Phone' },
    ],
  },
  {
    id: 'panels', title: 'Cards, sheets and overlays',
    entries: [
      { name: 'Person card', text: 'A player: add, message, call, visit or block.', open: 'Tap a player' },
      { name: 'House card', text: 'A house on the map and who lives there.', open: 'Tap a house on the map' },
      { name: 'City card', text: 'A city and how to travel there.', open: 'Map or world map' },
      { name: 'State House', text: 'The governor’s office. Its name follows the city.', open: 'Governor and civic screens' },
      { name: 'Local government', text: 'Your local area and its council.', open: 'Profile or My house' },
      { name: 'On the road', text: 'A choice on the way somewhere.', open: 'During a trip' },
      { name: 'While you were away', text: 'What happened since your last visit.', open: 'On return' },
      { name: 'Item sheet', text: 'Use, move or sell a piece of furniture.', open: 'Tap furniture at home' },
      { name: 'Share sheet', text: 'Share a card, link or clip.', open: 'Any Share button' },
      { name: 'Online sheet', text: 'Who is online now.', open: 'The online pill at the top' },
      { name: 'Companion', text: 'Your AI guide, always labelled AI.', open: 'The companion button' },
      { name: 'Calls', text: 'Voice calls with friends and AI characters.', open: 'A person card or AI agents' },
      { name: 'Top chips', text: 'Small chips for what needs you now: hunt, radio, politics, a table here, home, goal, settle in, health, weather, event, close friends, recording, inbox.', open: 'The top bar, or More' },
      { name: 'Safety cards', text: 'ID and phone checks, the scam warning under a chat and a check before outside links.', open: 'Shown when needed' },
      { name: 'Notices', text: 'Toasts, announcements, the update banner and the reconnecting notice.', open: 'Shown when needed' },
    ],
  },
  {
    id: 'keys', title: 'Keyboard shortcuts',
    entries: [
      { name: 'Screens', text: '`M` map, `G` world map, `H` home, `B` buy, `P` phone, `I` Sim sheet, `E` people.' },
      { name: 'In a place', text: '`T` shows or hides activities, `1`–`9` picks a spot, `X` clears the screen.' },
      { name: 'Moving', text: '`W` `A` `S` `D` or the arrows walk or pan the map; `[` `]` `PgUp` `PgDn` turn and tip the camera; `+` `-` `0` zoom.' },
      { name: 'Buy mode', text: '`R` rotate, `Enter` place, `Del` sell, `C` catalogue.' },
      { name: 'Anywhere', text: '`Esc` closes, `?` opens help and shortcuts.' },
    ],
  },
  {
    id: 'other', title: 'For admins and developers',
    entries: [
      { name: 'Admin', text: 'Dashboard, players, announcements, world tools, prayers, residents, moderation and the audit log.', open: 'The admin address, Phone → Admin, or `Alt+Shift+A`', tag: 'Admin' },
      { name: 'Scene catalogue', href: '/cities/scenes', text: 'An inspection catalogue of the 3D city scenes.', open: '`/county`, `/cities`, `/cities/scenes`', tag: 'Inspection' },
      { name: 'Site files', href: '/sitemap.xml', text: 'The sitemap, `robots.txt`, the app manifest and the Android asset links.', open: '`/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`' },
      { name: 'Agent connection', text: 'The MCP endpoint and OAuth metadata AI assistants use to play.', open: '`/mcp`, `/.well-known/oauth-authorization-server`', tag: 'Developer' },
      { name: 'Preview tools', text: 'The campus preview, housing studio, model workshop and voice test run on a developer’s computer only.', open: '`campus.html`, `housing-studio.html`, `models.html`, `voice-test.html`', tag: 'Developer' },
    ],
  },
]
