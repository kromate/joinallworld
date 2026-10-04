/**
 * Error monitoring: the ONLY file that imports the Sentry browser SDK. It is a lazy chunk, fetched
 * by the facade (./index.ts) after the first scene is drawn and only when the server sent a DSN.
 *
 * Runs without asking the player because it carries no personal data:
 *   - every part of the SDK's `dataCollection` is off (user info, cookies, headers, bodies, query
 *     strings, frame variables), so it tells Sentry never to infer an IP address — `sendDefaultPii:
 *     false` alone no longer does that in SDK 11. The project must ALSO have "Prevent Storing of IP
 *     Addresses" switched on — see SECURITY.md
 *   - no cookies and no storage are used; the user is the session's PUBLIC id and nothing else
 *   - none of the SDK's automatic breadcrumbs are installed (no console, clicks, fetch, navigation
 *     or history): the only breadcrumbs are the ones the facade writes — action types, result codes,
 *     screen names — and every event is rebuilt by scrubEvent before it is sent
 *   - no performance tracing in the browser (action latency is a sampled analytics event instead)
 *   - session replay is OFF. It exists only behind TELEMETRY_REPLAY_ON_ERROR=1, then records only
 *     sessions that hit an error, with all text and inputs masked and every canvas blocked.
 */
import type { Breadcrumb, ErrorEvent, addIntegration } from '@sentry/browser';
import { init, captureException, captureMessage, addBreadcrumb, setUser, withScope, globalHandlersIntegration, linkedErrorsIntegration, dedupeIntegration } from '@sentry/browser';
import { scrubEvent, scrubProps, stripUrl, isUuid, BREADCRUMB_CATEGORIES } from './scrub.ts';

type Integration = Parameters<typeof addIntegration>[0];

/** What core.ts holds on to once Sentry has started. */
export interface SentryHandle { capture(error: unknown, context?: unknown): void; crumb(item: Breadcrumb): void; user(id: unknown): void }

/**
 * `typed`: what the player is known to have typed (the nickname); the contents of every text field on the page are added here.
 */
export async function startSentry({ dsn, release, env, replayOnError = false, userId = null, window: win, typed = () => [] }: { dsn: string, release?: string, env?: string, replayOnError?: boolean, userId?: string | null, window: Window, typed?: () => Array<string | null> }): Promise<SentryHandle> {
  let user: string | null = isUuid(userId) ? userId : null;
  /** The player's own words, so an error message that repeats them (unquoted) is still sent without them. */
  const words = () => {
    const found: Array<string | null> = [];
    try { found.push(...typed()); for (const field of win.document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) if (typeof field.value === 'string') found.push(field.value, field.value.trim()); } catch { /* no document */ }
    return found;
  };
  const integrations: Integration[] = [globalHandlersIntegration(), linkedErrorsIntegration(), dedupeIntegration()];
  if (replayOnError) {
    try { integrations.push((await import('./sentry-replay.ts')).replay()); } catch { /* replay could not load: errors are still reported */ }
  }
  init({
    dsn, release, environment: env,
    defaultIntegrations: false, integrations,
    // No personal data. In SDK 11 `sendDefaultPii` no longer decides this: `dataCollection` does, and every part of
    // it defaults to ON (userInfo: true makes Sentry infer the IP address). Each part is switched off by name.
    ...{ sendDefaultPii: false }, // no longer in the SDK 11 option types, still sent: it is the safe value for older behaviour
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, stackFrameVariables: false, frameContextLines: 0,
      graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false }, databaseQueryData: false, queues: false },
    sendClientReports: false, attachStacktrace: true, maxBreadcrumbs: 30,
    replaysSessionSampleRate: 0, replaysOnErrorSampleRate: replayOnError ? 1 : 0,
    beforeBreadcrumb: (crumb) => (crumb?.category !== undefined && BREADCRUMB_CATEGORIES.includes(crumb.category) ? { category: crumb.category, timestamp: crumb.timestamp, data: scrubProps(crumb.data) } : null),
    // scrubEvent rebuilds the event from allowed fields only; what it returns is what Sentry sends.
    beforeSend: (event) => scrubEvent({ ...event, request: { url: stripUrl(win.location.href), headers: { 'User-Agent': win.navigator.userAgent } } }, { userId: user, typed: words() }) as ErrorEvent | null,
  });
  if (user) setUser({ id: user });
  return {
    capture(error, context) {
      withScope((scope) => {
        scope.setExtras(scrubProps(context));
        if (error instanceof Error) captureException(error); else captureMessage(typeof error === 'string' ? error : 'Non-error thrown', 'error');
      });
    },
    crumb(item) { addBreadcrumb(item); },
    user(id) { user = isUuid(id) ? id : null; setUser(user ? { id: user } : null); },
  };
}
