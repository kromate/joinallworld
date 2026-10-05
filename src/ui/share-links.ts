/**
 * Where the share sheet's channel buttons point: plain https links built from the share text and the
 * share page's link, every part encoded with encodeURIComponent so no character of a name or a link
 * can change the address it is placed in. Pure: no DOM, no I/O.
 *
 * The text is shown to the player as text, never as markup; the link preview a chat app draws from
 * the link is the game's own share card (server/growth/share.ts).
 */
import { whatsappUrl, xUrl } from '../game/share-model.ts';

export const telegramUrl = (link: string, text: string): string => `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;

/** The text without its last line when that line is the link (the share text always ends with it). */
export function textWithoutLink(text: string, link: string): string {
  const lines = text.split('\n');
  if (link && lines[lines.length - 1]?.trim() === link) lines.pop();
  return lines.join('\n').trim();
}

export interface ChannelLinks { whatsapp: string; x: string; telegram: string }
/** WhatsApp, X and Telegram links for a share `text` that already ends with `link`. */
export function channelLinks(text: string, link: string): ChannelLinks {
  const body = text.includes(link) ? text : `${text}\n${link}`.trim();
  return { whatsapp: whatsappUrl(body), x: xUrl(body), telegram: telegramUrl(link, textWithoutLink(body, link)) };
}

/** True for an absolute http(s) link: the only kind the sheet will hand to a share channel or draw as a code. */
export const isShareLink = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\/[^\s]{1,200}$/.test(value);
