/**
 * Product analytics: the ONLY file that imports the PostHog SDK. It is a lazy chunk, fetched by
 * the facade (./index.js) only after the player chose Accept on the consent sheet.
 *
 * The slim "no-external" build is used: it contains no session recorder, surveys or autocapture
 * and cannot download further scripts from PostHog. On top of that everything optional is off:
 *   - explicit events only: no autocapture, no rage/dead clicks, no heatmaps, no web vitals, no
 *     exception capture (Sentry does that), no session recording, no surveys, no feature flags
 *   - pageviews are sent by hand (one per page load) with the page origin and path only
 *   - storage is localStorage under one name; no cookies, nothing shared across subdomains
 *   - person profiles for identified players only; the distinct id is the session's PUBLIC id
 *   - every event is rebuilt in before_send from an allow-list, its properties checked against the
 *     catalogue (./events.js), and GeoIP lookup is disabled per event ($geoip_disable)
 */
import posthog from 'posthog-js/dist/module.slim.no-external.js';
import { scrubProps, isUuid } from './scrub.js';
import { cleanEvent, captureArgs } from './clean.js';

export const PERSISTENCE_NAME = 'allworld_analytics';
let initialised = false;

/**
 * @param {{ key: string, host: string, release?: string, env?: string, distinctId?: string | null, location?: Location }} options
 */
export function startPosthog({ key, host, release, env, distinctId = null, location }) {
  // Accept again after a Reject on the same page: the SDK is already set up, it only has to be allowed to send again.
  if (initialised) posthog.opt_in_capturing({ captureEventName: false });
  else posthog.init(key, {
    api_host: host,
    persistence: 'localStorage', persistence_name: PERSISTENCE_NAME, cross_subdomain_cookie: false,
    person_profiles: 'identified_only',
    autocapture: false, capture_pageview: false, capture_pageleave: false, rageclick: false,
    capture_dead_clicks: false, capture_heatmaps: false, enable_heatmaps: false, capture_exceptions: false, capture_performance: false,
    disable_session_recording: true, disable_surveys: true, disable_product_tours: true, disable_conversations: true, disable_web_experiments: true,
    disable_external_dependency_loading: true, advanced_disable_flags: true, advanced_disable_feature_flags: true, advanced_disable_toolbar_metrics: true,
    respect_dnt: true, save_referrer: false, mask_personal_data_properties: true,
    ...(isUuid(distinctId) ? { bootstrap: { distinctID: distinctId, isIdentifiedID: true } } : {}),
    before_send: (event) => cleanEvent(event, { release, env, location }),
  });
  initialised = true;
  let identified = null;
  return {
    /** @param {import('./clean.js').Item} item */
    capture(item) { const args = captureArgs(item); if (args) posthog.capture(...args); },
    identify(id, traits) { if (isUuid(id) && id !== identified) { identified = id; posthog.identify(id, scrubProps(traits)); } },
    group(type, id) { const safe = scrubProps({ [type]: id }); if (Object.keys(safe).length) posthog.group(type, safe[type]); },
    /** Reject after Accept: stop sending and forget what PostHog kept on this device. */
    stop() { posthog.opt_out_capturing(); posthog.reset(); },
  };
}
