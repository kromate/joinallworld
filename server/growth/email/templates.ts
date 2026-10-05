/**
 * OWNER: growth
 * The e-mails, as pure functions of plain data: confirm your address, welcome, "while you were
 * away" and the weekly summary. Each returns { subject, text, html }. Every value written into
 * HTML is escaped; the only player-chosen text is the display name, which the text filter passed.
 * Every message except the confirmation carries a visible unsubscribe link, why it was sent and
 * the sender's contact line; the plain-text part says the same as the HTML part.
 */
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
export const BRAND = 'Allworld';

/** A message's content before it is laid out as HTML and as plain text. */
export interface Parts {
  heading: string
  intro: string
  lines?: readonly string[]
  tasks?: readonly string[]
  button?: { label: string; url: string }
  /** HTML footer (already escaped). */
  foot: string
  /** Plain-text footer. */
  footText: string
}
/** The pieces of a digest the weekly and away mails read (src/game/digest.ts composeDigest). */
interface DigestParts { subject: string; greeting: string; lines: readonly string[]; tasks: readonly { text: string }[] }
export interface Mail { subject: string; text: string; html: string }

function layout({ heading, intro, lines = [], tasks = [], button, foot }: Parts): string {
  const list = (items: readonly string[]) => (items.length ? `<ul style="margin:12px 0;padding-left:20px">${items.map((item) => `<li style="margin:4px 0">${esc(item)}</li>`).join('')}</ul>` : '');
  return `<!doctype html><html lang="en"><body style="margin:0;background:#f3f5f4;font:16px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#20232c">
<div style="max-width:480px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border-radius:18px;padding:24px">
<div style="color:#256b45;font-weight:800;letter-spacing:2px;font-size:13px">${esc(BRAND.toUpperCase())}</div>
<h1 style="font-size:22px;line-height:1.25;margin:8px 0 12px">${esc(heading)}</h1><p style="margin:0 0 8px">${esc(intro)}</p>${list(lines)}
${tasks.length ? `<p style="margin:16px 0 0;font-weight:700">This week you could</p>${list(tasks)}` : ''}
${button ? `<p style="margin:20px 0 4px"><a href="${esc(button.url)}" style="display:inline-block;background:#256b45;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">${esc(button.label)}</a></p>` : ''}</div>
<p style="font-size:12px;line-height:1.5;color:#5b6472;margin:16px 8px 0">${foot}</p></div></body></html>`;
}
const plain = ({ heading, intro, lines = [], tasks = [], button, footText }: Parts): string => [heading, '', intro, ...lines.map((line) => `- ${line}`), ...(tasks.length ? ['', 'This week you could:', ...tasks.map((task) => `- ${task}`)] : []),
  ...(button ? ['', `${button.label}: ${button.url}`] : []), '', footText].join('\n');

function footer({ unsubscribeUrl, contact }: { unsubscribeUrl: string; contact?: string }): { foot: string; footText: string } {
  const why = 'You get this because you asked for Allworld e-mails in the game: at most one a day and three a week.';
  return { foot: `${esc(why)} <a href="${esc(unsubscribeUrl)}" style="color:#5b6472">Unsubscribe with one tap</a>.${contact ? `<br>${esc(contact)}` : ''}`,
    footText: `${why}\nUnsubscribe with one tap: ${unsubscribeUrl}${contact ? `\n${contact}` : ''}` };
}
export const build = (subject: string, parts: Parts): Mail => ({ subject, html: layout(parts), text: plain(parts) });

/** "Confirm your address": sent once per request, before anything else may be sent. It has no unsubscribe link because nothing is subscribed yet. */
export function confirmMail({ name, confirmUrl, hours, contact }: { name: string; confirmUrl: string; hours: number; contact?: string }): Mail {
  const note = `If you did not ask for this in ${BRAND}, do nothing: without this step no other e-mail will ever be sent to you. The link works for ${hours} hours.`;
  return build(`Confirm your e-mail for ${BRAND}`, { heading: `Is this your address, ${name}?`, intro: `You asked ${BRAND} to e-mail you. Press the button to confirm it is you.`,
    button: { label: 'Yes, e-mail me', url: confirmUrl }, foot: `${esc(note)}${contact ? `<br>${esc(contact)}` : ''}`, footText: `${note}${contact ? `\n${contact}` : ''}` });
}

export function welcomeMail({ name, playUrl, unsubscribeUrl, contact }: { name: string; playUrl: string; unsubscribeUrl: string; contact?: string }): Mail {
  return build(`You are in, ${name}`, { heading: 'Your e-mail is confirmed', intro: `We’ll send you a few e-mails a week at most about your character: when someone is waiting, when something finished, and a weekly summary. Never at night, and you can change this any time in the game: Phone, Stay in touch.`,
    button: { label: `Open ${BRAND}`, url: playUrl }, ...footer({ unsubscribeUrl, contact }) });
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
  button: { label: string; url: string }; fallback: string; why: string; help: string; contact: string
}

const WELCOME_FONT = "font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
/** The dark colours, for a reader that honours the reader's choice; one that ignores this block shows the light message, whose colours are all set inline. */
const WELCOME_DARK = `:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){.aw-page{background:#101613!important}.aw-card{background:#18211c!important}.aw-ink{color:#eef2ef!important}.aw-body{color:#d5dcd7!important}.aw-muted{color:#a3aea7!important}
.aw-soft{background:#203027!important;border-color:#2f4638!important}.aw-badge{background:#274a37!important;color:#bfe6cd!important}.aw-rule{border-color:#2a352f!important}.aw-link{color:#9ad6b2!important}}`;

/** The welcome message as HTML: tables for the layout and every colour inline, so that it holds in the mail readers that drop style sheets. No image, nothing fetched. */
function welcomeLayout(m: WelcomeParts): string {
  const cell = (padding: string, extra = '') => `style="padding:${padding};${WELCOME_FONT};${extra}"`;
  // The mark: a globe drawn with borders. A reader that cannot round a corner is not shown it at all.
  const globe = `<!--[if !mso]><!--><td width="44" valign="middle" style="padding:0 14px 0 0"><div style="width:40px;height:40px;border:2px solid #ffffff;border-radius:50%;position:relative;overflow:hidden;box-sizing:border-box">
<div style="width:16px;height:36px;margin:0 auto;border-left:2px solid #ffffff;border-right:2px solid #ffffff;border-radius:50%;box-sizing:border-box"></div><div style="height:2px;line-height:2px;font-size:0;background:#ffffff;margin-top:-19px">&nbsp;</div></div></td><!--<![endif]-->`;
  const step = (item: { title: string; text: string }, index: number) => `<tr><td width="46" valign="top" style="padding:0 0 18px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="aw-badge" width="32" height="32" align="center" valign="middle" bgcolor="#e2f0e7" style="width:32px;height:32px;border-radius:16px;background:#e2f0e7;color:#1c5436;${WELCOME_FONT};font-size:15px;line-height:32px;font-weight:800">${index + 1}</td></tr></table></td>
<td valign="top" ${cell('0 0 18px', 'font-size:15px;line-height:1.5')}><div class="aw-ink" style="color:#17201b;font-size:16px;font-weight:700;margin:4px 0 2px">${esc(item.title)}</div><div class="aw-body" style="color:#3b4640">${esc(item.text)}</div></td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(m.subject)}</title><style>${WELCOME_DARK}</style></head>
<body class="aw-page" style="margin:0;padding:0;background:#eef2ef;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;mso-hide:all">${esc(m.preheader)}</div>
<table role="presentation" class="aw-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef2ef" style="background:#eef2ef"><tr><td align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto">
<tr><td bgcolor="#256b45" ${cell('26px 28px', 'background:#256b45;background-image:linear-gradient(135deg,#2f8055 0%,#256b45 55%,#1b5235 100%);border-radius:18px 18px 0 0')}><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${globe}
<td valign="middle" style="${WELCOME_FONT}"><div style="color:#ffffff;font-size:24px;line-height:1.15;font-weight:800;letter-spacing:.3px">${esc(BRAND)}</div><div style="color:#d7ecdf;font-size:13px;line-height:1.4;margin-top:2px">${esc(m.tagline)}</div></td></tr></table></td></tr>
<tr><td class="aw-card" bgcolor="#ffffff" ${cell('28px 28px 8px', 'background:#ffffff;font-size:16px;line-height:1.55')}>
<h1 class="aw-ink" style="margin:0 0 12px;color:#17201b;font-size:26px;line-height:1.2;font-weight:800">${esc(m.heading)}</h1>
<p class="aw-body" style="margin:0 0 12px;color:#3b4640">${esc(m.intro)}</p><p class="aw-body" style="margin:0 0 12px;color:#3b4640"><b class="aw-ink" style="color:#17201b">${esc(m.saved)}</b></p><p class="aw-muted" style="margin:0;color:#56625b;font-size:14px">${esc(m.cities)}</p></td></tr>
<tr><td class="aw-card" bgcolor="#ffffff" ${cell('16px 28px 4px', 'background:#ffffff')}><div class="aw-rule" style="border-top:1px solid #e3e8e4;font-size:0;line-height:0">&nbsp;</div>
<h2 class="aw-link" style="margin:20px 0 16px;color:#256b45;font-size:13px;line-height:1.3;font-weight:800;letter-spacing:1.4px;text-transform:uppercase">${esc(m.stepsTitle)}</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${m.steps.map(step).join('\n')}</table></td></tr>
<tr><td class="aw-card" bgcolor="#ffffff" ${cell('0 28px 8px', 'background:#ffffff')}><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="aw-soft" bgcolor="#f1f7f3" ${cell('16px 18px', 'background:#f1f7f3;border:1px solid #d5e6db;border-radius:14px;font-size:15px;line-height:1.5')}>
<div class="aw-ink" style="color:#17201b;font-size:16px;font-weight:700;margin:0 0 2px">${esc(m.invite.title)}</div><div class="aw-body" style="color:#3b4640">${esc(m.invite.text)}</div></td></tr></table></td></tr>
<tr><td class="aw-card" bgcolor="#ffffff" align="center" ${cell('20px 28px 8px', 'background:#ffffff')}><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td align="center" bgcolor="#256b45" style="background:#256b45;border-radius:999px"><a href="${esc(m.button.url)}" style="display:inline-block;padding:14px 34px;${WELCOME_FONT};font-size:17px;line-height:1.2;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px">${esc(m.button.label)}</a></td></tr></table>
<p class="aw-muted" style="margin:12px 0 0;color:#56625b;font-size:13px;line-height:1.5">${esc(m.fallback)}<br><span class="aw-link" style="color:#256b45;overflow-wrap:anywhere;word-wrap:break-word">${esc(m.button.url)}</span></p></td></tr>
<tr><td class="aw-card" bgcolor="#ffffff" ${cell('12px 28px 26px', 'background:#ffffff;border-radius:0 0 18px 18px')}><div class="aw-rule" style="border-top:1px solid #e3e8e4;font-size:0;line-height:0">&nbsp;</div><p class="aw-muted" style="margin:16px 0 0;color:#56625b;font-size:14px;line-height:1.5">${esc(m.tip)}</p></td></tr>
<tr><td class="aw-muted" ${cell('16px 20px 0', 'color:#56625b;font-size:12px;line-height:1.55')}>${esc(m.why)} ${esc(m.help)}${m.contact ? `<br>${esc(m.contact)}` : ''}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}
const welcomePlain = (m: WelcomeParts): string => [m.heading, '', m.intro, m.saved, m.cities, '', `${m.stepsTitle}:`, ...m.steps.map((item, index) => `${index + 1}. ${item.title}: ${item.text}`), '', `${m.invite.title}: ${m.invite.text}`, '',
  `${m.button.label}: ${m.button.url}`, '', m.tip, '', `${m.why} ${m.help}`, ...(m.contact ? [m.contact] : [])].join('\n');

/**
 * "Welcome to Allworld": sent once to the verified address of a NEW account (server/accounts/welcome.ts). It is about the
 * account the person has just made, not a subscription: one message, no unsubscribe link because nothing follows it, no
 * image and nothing that reports back whether it was opened (the globe in its header is drawn with borders; nothing is
 * fetched when it is read). `name` is the character's name when there is one; `cities` are the names of the cities open
 * today, in the order to say them, and the message names none when it is given none.
 */
export function accountWelcomeMail({ name, playUrl, contact, cities = [] }: { name?: string; playUrl: string; contact?: string; cities?: readonly string[] }): Mail {
  const who = oneLine(name, 40), open = cities.map((city) => oneLine(city, 40)).filter(Boolean).slice(0, 12);
  const parts: WelcomeParts = {
    subject: `Welcome to ${BRAND}: your character is saved`,
    preheader: 'A whole world to live in. Here is what to do first, and how to bring a friend.',
    tagline: 'The whole world, to live in',
    heading: who ? `Welcome to the world, ${who}` : 'Welcome to the world',
    intro: `${BRAND} is a digital universe of the whole world that you can live in. Make a character, get a home, work, eat, meet real people who are online, and travel between real cities to see what life is like there.`,
    saved: `${who ? `${who} is` : 'Your character is'} saved to this account: log in on any device to carry on.`,
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
    contact: contact ?? '',
  };
  return { subject: parts.subject, html: welcomeLayout(parts), text: welcomePlain(parts) };
}

/** `digest` is src/game/digest.ts composeDigest(): lines (at most five) and one to three tasks. */
export function awayMail({ digest, playUrl, unsubscribeUrl, contact }: { digest: DigestParts; playUrl: string; unsubscribeUrl: string; contact?: string }): Mail {
  return build(digest.subject.replace(/^Your week in/, 'While you were away in'), { heading: 'While you were away', intro: `${digest.greeting} Nothing was taken from you.`, lines: digest.lines, tasks: digest.tasks.map((task) => task.text),
    button: { label: `Open ${BRAND}`, url: playUrl }, ...footer({ unsubscribeUrl, contact }) });
}

export function weekMail({ digest, playUrl, unsubscribeUrl, contact }: { digest: DigestParts; playUrl: string; unsubscribeUrl: string; contact?: string }): Mail {
  return build(digest.subject, { heading: digest.subject, intro: digest.greeting, lines: digest.lines, tasks: digest.tasks.map((task) => task.text),
    button: { label: 'See my week', url: playUrl }, ...footer({ unsubscribeUrl, contact }) });
}

/** The small page a link in an e-mail opens: a statement, and at most one button that POSTs back to the same address. */
export function mailPage({ title, text, button = null, action = '' }: { title: string; text: string; button?: string | null; action?: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#183b2a;color:#fff;font:16px/1.5 system-ui,sans-serif;text-align:center}main{padding:24px;max-width:420px}button,a{display:inline-block;margin-top:16px;padding:12px 22px;border-radius:999px;background:#e8a643;color:#20232c;font:inherit;font-weight:700;text-decoration:none;border:0;cursor:pointer}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(text)}</p>${button ? `<form method="post" action="${esc(action)}"><button type="submit">${esc(button)}</button></form>` : '<a href="/">Open Allworld</a>'}</main></body></html>`;
}
