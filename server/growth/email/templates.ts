/**
 * OWNER: growth
 * The e-mails, as pure functions of plain data: confirm your address, welcome, "while you were
 * away" and the weekly summary. Each returns { subject, text, html }. Every value written into
 * HTML is escaped; the only player-chosen text is the display name, which the text filter passed.
 * Every message except the confirmation carries a visible unsubscribe link, why it was sent and
 * the sender's contact line; the plain-text part says the same as the HTML part.
 */
import { BRAND, DARK, FONT, bullets, buttonRow, cardRow, esc, heading, originOf, paragraph, rule, shell, softBox } from './frame.ts';
import type { HeroKind } from './frame.ts';
export { BRAND, esc };

/** A message's content before it is laid out as HTML and as plain text. */
export interface Parts {
  heading: string
  intro: string
  lines?: readonly string[]
  tasks?: readonly string[]
  button?: { label: string; url: string }
  /** The scene of the picture at the top, and the line a mail list shows beside the subject (default: the start of the intro). */
  hero?: HeroKind
  preheader?: string
  /** HTML footer (already escaped). */
  foot: string
  /** Plain-text footer. */
  footText: string
}
/** The pieces of a digest the weekly and away mails read (src/game/digest.ts composeDigest). */
interface DigestParts { subject: string; greeting: string; lines: readonly string[]; tasks: readonly { text: string }[] }
export interface Mail { subject: string; text: string; html: string }

function layout({ heading: title, intro, lines = [], tasks = [], button, foot, hero, preheader }: Parts, subject = title): string {
  const origin = originOf(button?.url ?? '');
  const body = [cardRow(`${heading(title)}${paragraph(intro)}${bullets(lines)}${tasks.length ? `<p class="aw-ink" style="margin:16px 0 4px;color:#17201b;font-size:16px;font-weight:700">This week you could</p>${bullets(tasks)}` : ''}`, '0 32px 10px'), button ? buttonRow(button.label, button.url) : ''].join('\n');
  return shell({ subject, preheader: preheader ?? intro.slice(0, 110), hero: hero && origin ? { kind: hero, origin } : undefined, body, foot });
}
const plain = ({ heading, intro, lines = [], tasks = [], button, footText }: Parts): string => [heading, '', intro, ...lines.map((line) => `- ${line}`), ...(tasks.length ? ['', 'This week you could:', ...tasks.map((task) => `- ${task}`)] : []),
  ...(button ? ['', `${button.label}: ${button.url}`] : []), '', footText].join('\n');

function footer({ unsubscribeUrl, contact }: { unsubscribeUrl: string; contact?: string }): { foot: string; footText: string } {
  const why = 'You get this because you asked for Allworld e-mails in the game: at most one a day and three a week.';
  return { foot: `${esc(why)} <a href="${esc(unsubscribeUrl)}" style="color:#5b6472">Unsubscribe with one tap</a>.${contact ? `<br>${esc(contact)}` : ''}`,
    footText: `${why}\nUnsubscribe with one tap: ${unsubscribeUrl}${contact ? `\n${contact}` : ''}` };
}
export const build = (subject: string, parts: Parts): Mail => ({ subject, html: layout(parts, subject), text: plain(parts) });

/** "Confirm your address": sent once per request, before anything else may be sent. It has no unsubscribe link because nothing is subscribed yet. */
export function confirmMail({ name, confirmUrl, hours, contact }: { name: string; confirmUrl: string; hours: number; contact?: string }): Mail {
  const note = `If you did not ask for this in ${BRAND}, do nothing: without this step no other e-mail will ever be sent to you. The link works for ${hours} hours.`;
  return build(`Confirm your e-mail for ${BRAND}`, { heading: `Is this your address, ${name}?`, intro: `You asked ${BRAND} to e-mail you. Press the button to confirm it is you.`,
    button: { label: 'Yes, e-mail me', url: confirmUrl }, hero: 'confirm', preheader: 'One tap and your e-mails can start. If it was not you, do nothing.', foot: `${esc(note)}${contact ? `<br>${esc(contact)}` : ''}`, footText: `${note}${contact ? `\n${contact}` : ''}` });
}

export function welcomeMail({ name, playUrl, unsubscribeUrl, contact }: { name: string; playUrl: string; unsubscribeUrl: string; contact?: string }): Mail {
  return build(`You are in, ${name}`, { heading: 'Your e-mail is confirmed', intro: `We’ll send you a few e-mails a week at most about your character: when someone is waiting, when something finished, and a weekly summary. Never at night, and you can change this any time in the game: Phone, Stay in touch.`,
    button: { label: `Open ${BRAND}`, url: playUrl }, hero: 'welcome', preheader: 'A few e-mails a week at most, never at night. Change it any time in the game.', ...footer({ unsubscribeUrl, contact }) });
}

/** A person-facing value for one line of a mail: no control characters, trimmed and bounded. */
const oneLine = (value: unknown, max: number): string => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
/** "A", "A and B", "A, B and C". */
const listOf = (items: readonly string[]): string => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0] ?? '');

/** What the welcome message says, once, for both of its parts. */
interface WelcomeParts {
  subject: string; preheader: string; tagline: string; heading: string; intro: string; saved: string; cities: string
  stepsTitle: string; steps: readonly { title: string; text: string }[]
  invite: { title: string; text: string }; tip: string
  button: { label: string; url: string }; fallback: string; why: string; help: string; contact: string; origin: string
}

export const WELCOME_FONT = FONT;
export const WELCOME_DARK = DARK;

/** The welcome message as HTML, in the frame of every message (./frame.ts): the picture, one headline, the first steps and one large button. */
function welcomeLayout(m: WelcomeParts): string {
  const step = (item: { title: string; text: string }, index: number) => `<tr><td width="46" valign="top" style="padding:0 0 16px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="aw-badge" width="32" height="32" align="center" valign="middle" bgcolor="#e2f0e7" style="width:32px;height:32px;border-radius:16px;background:#e2f0e7;color:#1c5436;${FONT};font-size:15px;line-height:32px;font-weight:800">${index + 1}</td></tr></table></td>
<td valign="top" style="padding:0 0 16px;${FONT};font-size:15px;line-height:1.5"><div class="aw-ink" style="color:#17201b;font-size:16px;font-weight:700;margin:4px 0 2px">${esc(item.title)}</div><div class="aw-body" style="color:#3b4640">${esc(item.text)}</div></td></tr>`;
  const body = [
    cardRow(`${heading(m.heading)}${paragraph(m.intro)}${paragraph(m.saved, { strong: true })}<p class="aw-muted" style="margin:0;color:#56625b;font-size:14px;line-height:1.5">${esc(m.cities)}</p>`, '0 32px 16px'),
    buttonRow(m.button.label, m.button.url, m.fallback),
    rule(),
    cardRow(`<h2 class="aw-link" style="margin:14px 0 16px;color:#256b45;font-size:13px;line-height:1.3;font-weight:800;letter-spacing:1.4px;text-transform:uppercase">${esc(m.stepsTitle)}</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${m.steps.map(step).join('\n')}</table>`, '0 32px 4px'),
    softBox(m.invite.title, m.invite.text),
    cardRow(`<div class="aw-rule" style="border-top:1px solid #e3e8e4;font-size:0;line-height:0">&nbsp;</div><p class="aw-muted" style="margin:14px 0 0;color:#56625b;font-size:14px;line-height:1.5">${esc(m.tip)}</p>`, '0 32px 8px'),
  ].join('\n');
  return shell({ subject: m.subject, preheader: m.preheader, hero: m.origin ? { kind: 'welcome', origin: m.origin } : undefined, tagline: m.tagline, body, foot: `${esc(m.why)} ${esc(m.help)}${m.contact ? `<br>${esc(m.contact)}` : ''}` });
}
const welcomePlain = (m: WelcomeParts): string => [m.heading, '', m.intro, m.saved, m.cities, '', `${m.stepsTitle}:`, ...m.steps.map((item, index) => `${index + 1}. ${item.title}: ${item.text}`), '', `${m.invite.title}: ${m.invite.text}`, '',
  `${m.button.label}: ${m.button.url}`, '', m.tip, '', `${m.why} ${m.help}`, ...(m.contact ? [m.contact] : [])].join('\n');

/**
 * "Welcome to Allworld": sent once to the verified address of a NEW account (server/accounts/welcome.ts). It is about the
 * account the person has just made, not a subscription: one message, no unsubscribe link because nothing follows it, and
 * nothing that reports back whether it was opened (the globe in its header is drawn with borders; the only thing fetched when
 * it is read is its one picture, a static file of the game itself: ./frame.ts). `name` is the character's name when there is one; `cities` are the names of the cities open
 * today, in the order to say them, and the message names none when it is given none.
 */
export function accountWelcomeMail({ name, playUrl, contact, cities = [], bonus }: { name?: string; playUrl: string; contact?: string; cities?: readonly string[]; /** The launch bonus this account holds, said only while there is one (paid, or reserved and on its way). In-game naira. */ bonus?: { amount: number; places: number; paid: boolean } }): Mail {
  const who = oneLine(name, 40), open = cities.map((city) => oneLine(city, 40)).filter(Boolean).slice(0, 12);
  const parts: WelcomeParts = {
    subject: `Welcome to ${BRAND}: your character is saved`,
    preheader: 'A whole world to live in. Four first steps, and how to bring a friend.',
    tagline: 'The whole world, to live in',
    heading: who ? `Welcome to the world, ${who}` : 'Welcome to the world',
    intro: `${BRAND} is a digital universe of the whole world that you can live in. Make a character, get a home, work, eat, meet real people who are online, and travel between real cities to see what life is like there.`,
    saved: `${who ? `${who} is` : 'Your character is'} saved to this account: log in on any device to carry on.${bonus ? ` You are one of the first ${bonus.places.toLocaleString('en-NG')} players: ₦${bonus.amount.toLocaleString('en-NG')} in-game is ${bonus.paid ? 'in your wallet' : 'reserved for you'}.` : ''}`,
    cities: open.length ? `Open today: ${listOf(open)}. More cities are opening.` : 'More cities are opening.',
    stepsTitle: 'What to do first',
    steps: [
      { title: 'Settle into your home', text: 'Finish your character if you have not yet, then pick where you live and make the place yours.' },
      { title: 'Find work and keep fed', text: 'Open your Phone and choose Jobs to find work. Your needs bars show energy, food and more, and the line under them says what to do next.' },
      { title: 'Meet the people who are online', text: 'The green count in the top bar shows who is online. Tap it, pick a player, then press Chat to write to them or Call to ring them. They choose whether to answer.' },
      { title: 'Travel to another city', text: 'Open the Map and tap World at the top. Tap an open city, then the bus, train or flight: each shows its price and how many seconds it takes. You live there as a visitor for as long as you like, and your home stays yours.' },
    ],
    invite: { title: 'Bring a friend', text: 'A world is better with someone you know in it. Press Invite in the top bar to share your own link.' },
    tip: 'On a keyboard, press ? at any time to see the shortcuts. To see the guided tour again, open your Phone, then Help, then Take the tour.',
    button: { label: `Open ${BRAND}`, url: playUrl },
    fallback: 'Or copy this address into your browser:',
    why: `You got this because you created an ${BRAND} account with this address. It is sent once.`,
    help: 'Need help? In the game, open your Phone and choose "Report a problem".',
    contact: contact ?? '', origin: originOf(playUrl),
  };
  return { subject: parts.subject, html: welcomeLayout(parts), text: welcomePlain(parts) };
}

/** `digest` is src/game/digest.ts composeDigest(): lines (at most five) and one to three tasks. */
export function awayMail({ digest, playUrl, unsubscribeUrl, contact }: { digest: DigestParts; playUrl: string; unsubscribeUrl: string; contact?: string }): Mail {
  return build(digest.subject.replace(/^Your week in/, 'While you were away in'), { heading: 'While you were away', intro: `${digest.greeting} Nothing was taken from you.`, lines: digest.lines, tasks: digest.tasks.map((task) => task.text),
    button: { label: `Open ${BRAND}`, url: playUrl }, hero: 'home', ...footer({ unsubscribeUrl, contact }) });
}

export function weekMail({ digest, playUrl, unsubscribeUrl, contact }: { digest: DigestParts; playUrl: string; unsubscribeUrl: string; contact?: string }): Mail {
  return build(digest.subject, { heading: digest.subject, intro: digest.greeting, lines: digest.lines, tasks: digest.tasks.map((task) => task.text),
    button: { label: 'See my week', url: playUrl }, hero: 'home', ...footer({ unsubscribeUrl, contact }) });
}

/** The small page a link in an e-mail opens: a statement, and at most one button that POSTs back to the same address. */
export function mailPage({ title, text, button = null, action = '' }: { title: string; text: string; button?: string | null; action?: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#183b2a;color:#fff;font:16px/1.5 system-ui,sans-serif;text-align:center}main{padding:24px;max-width:420px}h1{margin:0 0 12px;font-size:28px;line-height:1.2}p{margin:0}button,a{display:inline-flex;align-items:center;justify-content:center;min-height:48px;margin-top:24px;padding:0 28px;border-radius:999px;background:#e8a643;color:#20232c;font:inherit;font-weight:700;text-decoration:none;border:0;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #fff;outline-offset:3px}@media(min-width:1800px){main{zoom:1.25}}@media(min-width:2800px){main{zoom:1.6}}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(text)}</p>${button ? `<form method="post" action="${esc(action)}"><button type="submit">${esc(button)}</button></form>` : '<a href="/">Open Allworld</a>'}</main></body></html>`;
}
