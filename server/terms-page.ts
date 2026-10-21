import { escapeHtml as esc } from './path-meta.ts'
import { safeOrigin } from './growth/share.ts'
import { STYLE } from './privacy-page.ts'
import { SHARING_TERMS_VERSION } from '../src/types/sharing.ts'

export const SUPPORT_EMAIL = 'support@joinallworld.com'

export function termsPageHtml(origin: unknown = ''): string {
  const base = safeOrigin(origin)
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Terms - Allworld</title><meta name="description" content="Allworld's rules for playing, sharing and staying safe."><link rel="canonical" href="${esc(base)}/terms"><style>${STYLE}</style></head>
<body><main class="wrap"><div class="top"><a class="brand" href="${esc(base)}/">Allworld</a><a href="${esc(base)}/privacy">Privacy</a></div>
<h1>Allworld's rules</h1><p class="meta">Version ${SHARING_TERMS_VERSION}. Draft pending a lawyer's review.</p>
<h2>Who may play</h2><p>You must be 13 or over to play Allworld. Before you first share anything, you must confirm your age and agree to these rules. Voice rooms can include strangers. Do not share private details.</p>
<h2>Treat people with care</h2><p>No harassment, threats, hate, sexual content, content that exploits or endangers minors, scams, impersonation, illegal goods or real-money gambling. Do not ask for money to unlock game rewards. Share only content you have the right to share.</p>
<h2>Report and block</h2><p>Report a player or content in the game, and block anyone you do not want to hear from. Reports are reviewed. Accounts and content can be muted, removed or erased when they break these rules.</p>
<h2>People and AI characters</h2><p>AI characters are labelled. They are computer-controlled characters, and what they say may be wrong. Do not treat them as professional advice.</p>
<h2>Money in the game</h2><p>In-game naira and coins have no cash value unless a page explicitly says otherwise. They are not a promise of real earnings. The app does not offer purchases of digital goods. For real shops and services, customers message sellers directly.</p>
<h2>Your content and account</h2><p>You keep your rights to what you share. You allow Allworld to display it to the audience you choose so the game can work. Read <a href="${esc(base)}/privacy">Privacy</a> for what is stored and <a href="${esc(base)}/privacy#delete">how to delete your account</a>. Rules may change; a new version asks you to agree again before sharing.</p>
<h2>Contact</h2><p>For help, reports or account deletion when you cannot sign in, email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
<p class="foot"><a href="${esc(base)}/">Back to Allworld</a></p></main></body></html>`
}
