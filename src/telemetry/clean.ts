/**
 * What an analytics event looks like when it leaves (pure: no SDK, so it is tested in Node and
 * shared by the PostHog wrapper). Two steps, both allow-lists:
 *   captureArgs  a kept call → the arguments of posthog.capture, its properties checked against the catalogue
 *   cleanEvent   PostHog's finished event (before_send) → the same event with only the allowed
 *                properties left; everything the SDK added that is not on the list is dropped
 */
import { scrubProps, stripUrl, isEventName } from './scrub.ts';
import { checkProps } from './events.ts';

/** @typedef {{ name: string, props?: object, at?: number, extra?: { setOnce?: object } }} Item */

/**
 * @param {Item} item
 * @returns {[name: string, props: object, options: object] | null}
 */
export function captureArgs({ name, props, at, extra } = {}) {
  if (!isEventName(name)) return null;
  return [name, checkProps(name, props, scrubProps), { ...(Number.isFinite(at) ? { timestamp: new Date(at) } : {}), ...(extra?.setOnce ? { $set_once: scrubProps(extra.setOnce) } : {}) }];
}

/** PostHog's own properties that may stay on an event. Everything else it adds is dropped. */
const KEPT = ['token', 'distinct_id', '$lib', '$lib_version', '$insert_id', '$time', '$session_id', '$window_id', '$device_id', '$user_id', '$anon_distinct_id', '$is_identified',
  '$process_person_profile', '$groups', '$group_type', '$group_key', '$browser', '$os', '$device_type', '$referring_domain', 'utm_source', 'utm_medium', 'utm_campaign'];
const INTERNAL = ['$identify', '$groupidentify', '$set', '$opt_in'];

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

