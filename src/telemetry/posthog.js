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
import { scrubProps, stripUrl, isEventName, isUuid } from './scrub.js';
import { checkProps } from './events.js';

export const PERSISTENCE_NAME = 'allworld_analytics';
/** PostHog's own properties that may stay on an event. Everything else it adds is dropped. */
const KEPT = ['token', 'distinct_id', '$lib', '$lib_version', '$insert_id', '$time', '$session_id', '$window_id', '$device_id', '$user_id', '$anon_distinct_id', '$is_identified',
  '$process_person_profile', '$groups', '$group_type', '$group_key', '$browser', '$os', '$device_type', '$referring_domain', 'utm_source', 'utm_medium', 'utm_campaign'];
const INTERNAL = ['$identify', '$groupidentify', '$set', '$opt_in'];

let initialised = false;

/** One outgoing event, rebuilt. Pure (exported for the tests). */
export function cleanEvent(event, { release, env, location } = {}) {
  if (!event || typeof event.event !== 'string' || !(isEventName(event.event) || INTERNAL.includes(event.event))) return null;
  const from = event.properties || {}, properties = { ...checkProps(event.event, from, scrubProps) };
  for (const key of KEPT) {
    const value = from[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') properties[key] = typeof value === 'string' ? value.slice(0, 200) : value;
    else if (key === '$groups' && value && typeof value === 'object') properties.$groups = scrubProps(value);
  }
  Object.assign(properties, { $geoip_disable: true, app: 'allworld', environment: env, release });
  if (event.event === '$pageview' && location) Object.assign(properties, { $current_url: stripUrl(location.href), $pathname: location.pathname, $host: location.host });
  const people = (value) => { const safe = scrubProps(value); return Object.keys(safe).length ? safe : undefined; };
  return { ...event, properties, $set: people(event.$set ?? from.$set), $set_once: people(event.$set_once ?? from.$set_once) };
}

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
    /** @param {{ name: string, props?: object, at?: number, extra?: { setOnce?: object } }} item */
    capture({ name, props, at, extra }) {
      if (!isEventName(name)) return;
      posthog.capture(name, checkProps(name, props, scrubProps), { ...(Number.isFinite(at) ? { timestamp: new Date(at) } : {}), ...(extra?.setOnce ? { $set_once: scrubProps(extra.setOnce) } : {}) });
    },
    identify(id, traits) { if (isUuid(id) && id !== identified) { identified = id; posthog.identify(id, scrubProps(traits)); } },
    group(type, id) { const safe = scrubProps({ [type]: id }); if (Object.keys(safe).length) posthog.group(type, safe[type]); },
    /** Reject after Accept: stop sending and forget what PostHog kept on this device. */
    stop() { posthog.opt_out_capturing(); posthog.reset(); },
  };
}
