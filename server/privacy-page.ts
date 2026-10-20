/**
 * OWNER: growth
 * The public privacy page, /privacy, written by both hosts (ctx.pages, registered in server/routes/profiles.ts; the Worker lists the prefix).
 * Plain HTML with no script, the same style as the public profile page. Every line states what the code does today (docs/FEED.md,
 * docs/LOCATION.md, docs/EARN.md, src/telemetry/what-we-collect.ts, SECURITY.md): when a behaviour changes, change the line. It is written
 * for a player and for the app stores' "privacy policy URL"; the owner's lawyer reads it before it is called a policy.
 */
import { OG_IMAGE, safeOrigin } from './growth/share.ts'
import { escapeHtml as esc } from './path-meta.ts'

const UPDATED = '19 October 2026'
export const STYLE = `@media(min-width:1800px){body{zoom:1.25}}@media(min-width:2800px){body{zoom:1.6}}*{box-sizing:border-box}body{margin:0;background:#f3f0e7;color:#193126;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-text-size-adjust:100%}
.wrap{max-width:720px;margin:0 auto;padding:24px 20px 48px}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px}.brand{display:inline-flex;align-items:center;min-height:44px;font-weight:800;color:#0f5132;text-decoration:none;font-size:20px}
h1{font-size:28px;line-height:1.2;margin:0 0 8px}h1+.meta{font-size:16px;color:#34493f;margin-bottom:12px}h2{font-size:19px;margin:28px 0 8px}p,li{margin:0 0 10px}ul{padding-left:20px}.meta{color:#5b6b63;font-size:14px}.foot{margin-top:32px;font-size:14px;color:#5b6b63}a{color:#0f5132}.foot a{display:inline-flex;align-items:center;min-height:44px}@media(max-width:480px){.wrap{padding:12px 16px 40px}.top{margin-bottom:8px}h2{margin-top:24px}}`

export function privacyPageHtml(origin: unknown = ''): string {
  const base = safeOrigin(origin), title = 'Privacy — Allworld'
  const description = 'What Allworld stores about you, what never leaves your phone, and how to download or erase your account.'
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(`${base}/privacy`)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:image" content="${esc(`${base}${OG_IMAGE}`)}"><style>${STYLE}</style></head>
<body><main class="wrap"><div class="top"><a class="brand" href="${esc(`${base}/`)}">Allworld</a><span class="meta">Updated ${UPDATED}</span></div>
<h1>Privacy</h1><p class="meta">Allworld is a game and a social world you play in your browser or as an app. This page says, in plain words, what it keeps about you and what it never sees. It is kept in step with the game's code.</p>
<h2>What Allworld stores</h2><ul>
<li><b>Your character:</b> the nickname you chose, how your character looks, and the life it lives in the game (its home, money in the game, friends, what it has done). This is the game itself.</li>
<li><b>An account, only if you sign in:</b> the e-mail address of the sign-in you used (Google or e-mail and password), so your character follows you to another phone. Guests have no account and no e-mail.</li>
<li><b>What you post:</b> feed posts, photos and clips you upload, replies, reactions, communities, events, gigs, notices on your area's noticeboard (with your character's name, and only people whose badge is in the same area can read them) and the messages you send. Public posts are public; friends-only posts are for friends.</li>
<li><b>Your location badge, if you turn it on:</b> the city (and, if you choose, the local government area) that your own phone found itself in. Your phone works it out and sends only the place name. Allworld never receives, stores or logs your position, and the badge is removed with one tap.</li>
<li><b>Business and payment details, if you use them:</b> a business listing you wrote; for real-money features, an account at the payment company Bachs opened in your name. Bachs checks your identity and holds your bank details; Allworld keeps only the account's reference and its status, and never holds your money. <a href="${esc(`${base}/money`)}">What counts as real money</a>.</li>
<li><b>Technical records:</b> a session cookie so the game knows which character is yours, and short-lived counts per network address to stop abuse. The address itself is never stored.</li>
</ul>
<h2>What never leaves your phone</h2><ul>
<li>Your position. "Find my street", the location badge and "Find my area" all run on your device; only a place name is sent, and only when you say yes.</li>
<li>Your contacts. If you look for friends from your contacts, every number is scrambled on your phone first; only the scrambled codes are sent, and you are matched only with people who also have your number.</li>
<li>A selfie used to start your character from a photo: it is read on your phone and thrown away.</li>
<li>Clips and photos you record of the game stay on your phone until you share them yourself.</li>
</ul>
<h2>Analytics and error reports</h2>
<p>Usage analytics is optional and off until you accept it (Settings → Privacy). If you accept, Allworld counts which steps you complete and how the game runs for you, never what you write, where you are, your voice, or your e-mail. Error reports (what went wrong in the code) are always sent so the game can be fixed; they contain no chat, names or positions. Analytics is always off for players under 18 and when your browser sends a "Do Not Track" signal. The companies that process this for Allworld are PostHog and Sentry.</p>
<h2>Who can see what</h2>
<p>Other players see your nickname, your character, your public posts and your badges. People you add as friends see friends-only posts. Nobody sees your e-mail, your contacts or your position. Allworld does not sell data and does not show you advertising based on your data.</p>
<h2>Children</h2>
<p>Allworld asks your age once. Players under 18 cannot post publicly, use real-money features, or be followed by strangers, and analytics is off for them.</p>
<h2>Your account: download and erase</h2>
<p>In the game, Settings → Account lets you download everything this server stores about your account, and erase the account and your character's saved life. Erasing removes your posts, badges, contacts codes and payment references; a sale that was already paid stays as a record without your name.</p>
<h2>Where it is kept</h2>
<p>Allworld runs on Cloudflare's network and keeps your data encrypted in transit. Payments are handled by Bachs under its own terms. The source code is public (AGPL), so what this page says can be checked.</p>
<h2>Contact</h2>
<p>Questions about privacy: use Help in the game, or the contact address on the site. This page changes when the game changes; the date at the top is the last change.</p>
<p class="foot"><a href="${esc(`${base}/`)}">Back to Allworld</a></p></main></body></html>`
}
