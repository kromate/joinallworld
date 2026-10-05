/**
 * OWNER: growth
 * THE PING MAIL: "Ada is waiting for you in Allworld" (docs/COMEBACK-MAIL.md, "Ping"), as a pure function of plain data:
 * { subject, text, html }. It has the look of the account welcome message (./templates.ts): tables for the layout, every
 * colour inline, the dark colours for a reader that honours the choice. One button, the join link. No image, nothing
 * fetched when it is read, no pixel and no redirect that reports an opening: the only thing the server ever learns is
 * that the join link itself was used, by the signed-in player it was made for.
 *
 * Every value written into HTML is escaped. The two player-chosen values are display names, which passed the text filter;
 * a venue name comes from the game's own content and is escaped all the same.
 * The footer says why the mail was sent and carries three links that need no sign-in: stop e-mails about friends,
 * unsubscribe from everything, and the preferences in the game.
 */
import { goUrl } from '../../../src/game/go-links.ts';
import { STOP_WORDS } from '../../../src/game/comeback-words.ts';
import { PING, pingLine } from '../../../src/game/ping.ts';
import { BRAND, WELCOME_DARK, WELCOME_FONT, esc } from './templates.ts';
import type { Mail } from './templates.ts';

export interface PingMailInput {
  /** The friend who pinged: their display name. */
  from: string
  /** "at Freedom Park, Lagos" · "at home in Lagos" (src/game/ping.ts placeWords). */
  place: string
  /** The join link: `<origin>/j/<token>`. */
  joinUrl: string
  links: { origin: string; /** Stops e-mails about friends (one-click page). */ stopUrl: string; /** Unsubscribes from everything (the List-Unsubscribe address). */ unsubscribeUrl: string }
  contact?: string
  /** Where the address came from: it decides the sentence that says why the mail was sent. */
  source?: 'contact' | 'account'
}
interface PingParts {
  subject: string; preheader: string; tagline: string; heading: string; intro: string; land: string
  live: { title: string; text: string }
  button: { label: string; url: string }; fallback: string; safe: string
  why: string; stop: { label: string; url: string }; all: { label: string; url: string }; prefs: { label: string; url: string }; contact: string
}

function pingLayout(m: PingParts): string {
  const cell = (padding: string, extra = '') => `style="padding:${padding};${WELCOME_FONT};${extra}"`;
  // The mark of the welcome message: a globe drawn with borders. A reader that cannot round a corner is not shown it at all.
  const globe = `<!--[if !mso]><!--><td width="44" valign="middle" style="padding:0 14px 0 0"><div style="width:40px;height:40px;border:2px solid #ffffff;border-radius:50%;position:relative;overflow:hidden;box-sizing:border-box">
<div style="width:16px;height:36px;margin:0 auto;border-left:2px solid #ffffff;border-right:2px solid #ffffff;border-radius:50%;box-sizing:border-box"></div><div style="height:2px;line-height:2px;font-size:0;background:#ffffff;margin-top:-19px">&nbsp;</div></div></td><!--<![endif]-->`;
  const link = (item: { label: string; url: string }) => `<a class="aw-muted" href="${esc(item.url)}" style="color:#56625b;text-decoration:underline">${esc(item.label)}</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(m.subject)}</title><style>${WELCOME_DARK}</style></head>
<body class="aw-page" style="margin:0;padding:0;background:#eef2ef;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;mso-hide:all">${esc(m.preheader)}</div>
<table role="presentation" class="aw-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef2ef" style="background:#eef2ef"><tr><td align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto">
<tr><td bgcolor="#256b45" ${cell('26px 28px', 'background:#256b45;background-image:linear-gradient(135deg,#2f8055 0%,#256b45 55%,#1b5235 100%);border-radius:18px 18px 0 0')}><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${globe}
<td valign="middle" style="${WELCOME_FONT}"><div style="color:#ffffff;font-size:24px;line-height:1.15;font-weight:800;letter-spacing:.3px">${esc(BRAND)}</div><div style="color:#d7ecdf;font-size:13px;line-height:1.4;margin-top:2px">${esc(m.tagline)}</div></td></tr></table></td></tr>
<tr><td class="aw-card" bgcolor="#ffffff" ${cell('28px 28px 8px', 'background:#ffffff;font-size:16px;line-height:1.55')}>
<h1 class="aw-ink" style="margin:0 0 12px;color:#17201b;font-size:26px;line-height:1.2;font-weight:800;overflow-wrap:anywhere;word-wrap:break-word">${esc(m.heading)}</h1>
<p class="aw-body" style="margin:0 0 12px;color:#3b4640;overflow-wrap:anywhere;word-wrap:break-word">${esc(m.intro)}</p><p class="aw-body" style="margin:0;color:#3b4640"><b class="aw-ink" style="color:#17201b">${esc(m.land)}</b></p></td></tr>
<tr><td class="aw-card" bgcolor="#ffffff" align="center" ${cell('20px 28px 8px', 'background:#ffffff')}><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td align="center" bgcolor="#256b45" style="background:#256b45;border-radius:999px"><a href="${esc(m.button.url)}" style="display:inline-block;padding:14px 34px;${WELCOME_FONT};font-size:17px;line-height:1.2;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px">${esc(m.button.label)}</a></td></tr></table>
<p class="aw-muted" style="margin:12px 0 0;color:#56625b;font-size:13px;line-height:1.5">${esc(m.fallback)}<br><span class="aw-link" style="color:#256b45;overflow-wrap:anywhere;word-wrap:break-word;word-break:break-all">${esc(m.button.url)}</span></p></td></tr>
<tr><td class="aw-card" bgcolor="#ffffff" ${cell('16px 28px 8px', 'background:#ffffff')}><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="aw-soft" bgcolor="#f1f7f3" ${cell('16px 18px', 'background:#f1f7f3;border:1px solid #d5e6db;border-radius:14px;font-size:15px;line-height:1.5')}>
<div class="aw-ink" style="color:#17201b;font-size:16px;font-weight:700;margin:0 0 2px">${esc(m.live.title)}</div><div class="aw-body" style="color:#3b4640">${esc(m.live.text)}</div></td></tr></table></td></tr>
<tr><td class="aw-card" bgcolor="#ffffff" ${cell('12px 28px 26px', 'background:#ffffff;border-radius:0 0 18px 18px')}><div class="aw-rule" style="border-top:1px solid #e3e8e4;font-size:0;line-height:0">&nbsp;</div><p class="aw-muted" style="margin:16px 0 0;color:#56625b;font-size:14px;line-height:1.5">${esc(m.safe)}</p></td></tr>
<tr><td class="aw-muted" ${cell('16px 20px 0', 'color:#56625b;font-size:12px;line-height:1.55')}>${esc(m.why)}<br>${link(m.stop)} · ${link(m.all)} · ${link(m.prefs)}${m.contact ? `<br>${esc(m.contact)}` : ''}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}
const pingPlain = (m: PingParts): string => [m.heading, '', m.intro, m.land, '', `${m.button.label}: ${m.button.url}`, '', `${m.live.title}: ${m.live.text}`, '', m.safe, '',
  m.why, `${m.stop.label}: ${m.stop.url}`, `${m.all.label}: ${m.all.url}`, `${m.prefs.label}: ${m.prefs.url}`, ...(m.contact ? [m.contact] : [])].join('\n');

export function pingMail({ from, place, joinUrl, links, contact, source = 'contact' }: PingMailInput): Mail {
  const who = pingLine(from, 24) || 'A friend', where = pingLine(place, 120) || `in ${BRAND}`;
  const parts: PingParts = {
    subject: `${who} is waiting for you in ${BRAND}`,
    preheader: `${who} is ${where}. Join them and you land right there.`,
    tagline: 'The whole world, to live in',
    heading: `${who} is waiting for you`,
    intro: `${who} is in ${BRAND} right now, ${where}, and pinged you to come.`,
    land: `Press the button and you land right where ${who} is, ready to play and talk.`,
    live: { title: `Good for ${PING.liveMinutes} minutes`, text: `The invitation is live while ${who} is still in the game. If they have left when you arrive, the button simply opens ${BRAND} and you can send them a message.` },
    button: { label: `Join ${who}`, url: joinUrl },
    fallback: 'Or copy this address into your browser:',
    safe: 'The link was made for you and does not sign anybody in: you play as yourself, on a device where you already play or after you log in.',
    why: source === 'account'
      ? `You get this because ${who}, a friend of yours in ${BRAND}, pinged you, and your ${BRAND} account e-mails you about your friends. A friend’s ping reaches you at most ${PING.mail.recipientPerDay} times a day, never at night.`
      : `You get this because ${who}, a friend of yours in ${BRAND}, pinged you, and you asked ${BRAND} to e-mail you about your friends. A friend’s ping reaches you at most ${PING.mail.recipientPerDay} times a day, never at night.`,
    stop: { label: STOP_WORDS.friends, url: links.stopUrl },
    all: { label: 'Unsubscribe from everything', url: links.unsubscribeUrl },
    prefs: { label: 'Change what I get', url: goUrl(links.origin, 'touch') },
    contact: contact ?? '',
  };
  return { subject: parts.subject, html: pingLayout(parts), text: pingPlain(parts) };
}
