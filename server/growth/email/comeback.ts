/**
 * OWNER: growth
 * The comeback e-mails (docs/COMEBACK-MAIL.md), as a pure function of plain data: { subject, text, html } in the layout
 * of ./templates.ts. One button, no image, no tracking pixel, no third-party asset. Every value written into HTML is
 * escaped; the only player-chosen text is a display name or an event title, both of which passed the text filter.
 * The footer says why the mail was sent and carries three links that need no sign-in: stop this kind, unsubscribe from
 * everything, and the preferences in the game.
 */
import { goUrl } from '../../../src/game/go-links.ts';
import { mailWords, STOP_WORDS } from '../../../src/game/comeback-words.ts';
import { BRAND, build, esc } from './templates.ts';
import type { Plan } from '../../../src/game/comeback.ts';
import type { Mail } from './templates.ts';

export interface ComebackLinks {
  origin: string
  /** Stops this kind of mail (one-click page). */
  stopUrl: string
  /** Unsubscribes from everything (the List-Unsubscribe address). */
  unsubscribeUrl: string
}

export function comebackMail({ plan, name, now, links, contact, source = 'contact' }: { plan: Plan; name: string; now: number; links: ComebackLinks; contact?: string; /** Where the address came from: it decides the sentence that says why the mail was sent. */ source?: 'contact' | 'account' }): Mail {
  const words = mailWords(plan, { name, now });
  const prefsUrl = goUrl(links.origin, 'touch');
  const stop = STOP_WORDS[words.pref];
  const why = source === 'account'
    ? `You get this because you made an ${BRAND} account with this address, which turns on e-mails about your character. A few a week at most. You can turn them off any time.`
    : `You get this because you asked ${BRAND}, a digital world you can live in, to e-mail you about your character. A few a week at most.`;
  const foot = `${esc(why)}<br><a href="${esc(links.stopUrl)}" style="color:#5b6472">${esc(stop)}</a> · <a href="${esc(links.unsubscribeUrl)}" style="color:#5b6472">Unsubscribe from everything</a> · <a href="${esc(prefsUrl)}" style="color:#5b6472">Change what I get</a>${contact ? `<br>${esc(contact)}` : ''}`;
  const footText = `${why}\n${stop}: ${links.stopUrl}\nUnsubscribe from everything: ${links.unsubscribeUrl}\nChange what I get: ${prefsUrl}${contact ? `\n${contact}` : ''}`;
  return build(words.subject, { heading: words.heading, intro: words.intro, lines: words.lines, button: { label: words.button.label, url: goUrl(links.origin, words.button.go) }, foot, footText });
}
