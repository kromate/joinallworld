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
  return build(`You are in, ${name}`, { heading: 'Your e-mail is confirmed', intro: `From now on ${BRAND} can tell you what happened while you were away and what is on this week. Never more than one message a day and three a week, and never at night.`,
    button: { label: `Open ${BRAND}`, url: playUrl }, ...footer({ unsubscribeUrl, contact }) });
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
