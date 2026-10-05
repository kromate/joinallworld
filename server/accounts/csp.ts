/**
 * OWNER: accounts
 * WHAT SIGN-IN NEEDS FROM THE PAGE'S SECURITY HEADERS — for the host's header builder to add, and only when accounts
 * are configured. Pure: a function of the account configuration. Portable.
 *
 *   accounts configured          connect-src  https://identitytoolkit.googleapis.com   sign in, create, confirm, exchange, delete
 *                                connect-src  https://securetoken.googleapis.com       a fresh token
 *   and a Google client id set   script-src   https://accounts.google.com/gsi/client   Google's button script
 *                                frame-src    https://accounts.google.com/gsi/         the button (an iframe) and the chooser
 *                                style-src    https://accounts.google.com/gsi/style    the button's stylesheet
 *                                connect-src  https://accounts.google.com/gsi/         the button's own requests
 *
 * CROSS-ORIGIN-OPENER-POLICY. This client draws Google's button in its default mode (`ux_mode: 'popup'`,
 * src/app/features/account/googleButton.ts): the account chooser opens as a popup on accounts.google.com and hands the
 * credential back to the window that opened it. Under `same-origin` the popup is cut off from its opener and the
 * sign-in never completes, so with a Google client id the page needs `same-origin-allow-popups`. The modes that would
 * keep `same-origin` are not usable here today: the redirect mode posts the credential to a server endpoint (a
 * cross-site form POST that this server deliberately does not accept, and which loses the nonce check), and FedCM
 * removes the popup only in browsers that implement it — the others still open one. Without a Google client id nothing
 * opens a popup and `same-origin` stays.
 */
import type { AccountsConfig } from '../types.ts';

export type CspDirective = 'script-src' | 'connect-src' | 'frame-src' | 'style-src';
export interface AccountsHeaderNeeds {
  /** Sources to ADD to each directive of the game page's Content-Security-Policy. Empty lists when nothing is needed. */
  csp: Record<CspDirective, string[]>
  /** The Cross-Origin-Opener-Policy the game page may have at its strictest. */
  coop: 'same-origin' | 'same-origin-allow-popups'
}
export const IDENTITY_ORIGINS = Object.freeze(['https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com']);
export const GOOGLE_BUTTON = Object.freeze({ script: 'https://accounts.google.com/gsi/client', frame: 'https://accounts.google.com/gsi/', style: 'https://accounts.google.com/gsi/style', connect: 'https://accounts.google.com/gsi/' });

/** What to add when accounts are configured as `config` says (null or undefined: accounts are off, and nothing is added). */
export function accountsCspAdditions(config: AccountsConfig | null | undefined): AccountsHeaderNeeds {
  const needs: AccountsHeaderNeeds = { csp: { 'script-src': [], 'connect-src': [], 'frame-src': [], 'style-src': [] }, coop: 'same-origin' };
  if (!config) return needs;
  needs.csp['connect-src'].push(...IDENTITY_ORIGINS);
  if (!config.googleClientId) return needs;
  needs.csp['script-src'].push(GOOGLE_BUTTON.script);
  needs.csp['frame-src'].push(GOOGLE_BUTTON.frame);
  needs.csp['style-src'].push(GOOGLE_BUTTON.style);
  needs.csp['connect-src'].push(GOOGLE_BUTTON.connect);
  needs.coop = 'same-origin-allow-popups';
  return needs;
}
