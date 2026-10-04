/**
 * What an analytics event looks like when it leaves (pure: no SDK, so it is tested in Node and
 * shared by the PostHog wrapper). Two steps, both allow-lists:
 *   captureArgs  a kept call → the arguments of posthog.capture, its properties checked against the catalogue
 *   cleanEvent   PostHog's finished event (before_send) → the same event with only the allowed
 *                properties left; everything the SDK added that is not on the list is dropped
 */
import { scrubProps, stripUrl, isEventName } from './scrub.ts';
import type { SafeProps } from './scrub.ts';
import { checkProps } from './events.ts';

/** A kept call: the event name, its raw properties, when it happened (ms) and what to set once on the person. */
export interface Item { name: string; props?: unknown; at?: number; extra?: { setOnce?: unknown } }
/** The options of posthog.capture that telemetry uses. */
export interface CaptureOptions { timestamp?: Date; $set_once?: SafeProps }
/** The arguments of posthog.capture. */
export type CaptureArgs = [name: string, props: SafeProps, options: CaptureOptions];

const rec = (value: unknown): Record<string, unknown> => (value !== null && (typeof value === 'object' || typeof value === 'function') ? (value as Record<string, unknown>) : {});

export function captureArgs({ name, props, at, extra }: Partial<Item> = {}): CaptureArgs | null {
  if (!isEventName(name)) return null;
  return [name, checkProps(name, props, scrubProps), { ...(typeof at === 'number' && Number.isFinite(at) ? { timestamp: new Date(at) } : {}), ...(extra?.setOnce ? { $set_once: scrubProps(extra.setOnce) } : {}) }];
}

/** PostHog's own properties that may stay on an event. Everything else it adds is dropped. */
const KEPT = ['token', 'distinct_id', '$lib', '$lib_version', '$insert_id', '$time', '$session_id', '$window_id', '$device_id', '$user_id', '$anon_distinct_id', '$is_identified',
  '$process_person_profile', '$groups', '$group_type', '$group_key', '$browser', '$os', '$device_type', '$referring_domain', 'utm_source', 'utm_medium', 'utm_campaign'];
const INTERNAL = ['$identify', '$groupidentify', '$set', '$opt_in'];

/** An outgoing event as cleanEvent rebuilds it: the SDK's own fields stay, `properties`, `$set` and `$set_once` are rebuilt. */
export interface CleanedEvent { event: string; properties: Record<string, unknown>; $set: SafeProps | undefined; $set_once: SafeProps | undefined; [key: string]: unknown }

/** One outgoing event, rebuilt. Pure (exported for the tests). `event` is `unknown`: it is whatever the SDK hands to before_send. */
export function cleanEvent(input: unknown, { release, env, location }: { release?: string, env?: string, location?: Pick<Location, 'href' | 'pathname' | 'host'> | null } = {}): CleanedEvent | null {
  const event = rec(input);
  const name = event.event;
  if (!input || typeof name !== 'string' || !(isEventName(name) || INTERNAL.includes(name))) return null;
  const from = rec(event.properties), properties: Record<string, unknown> = { ...checkProps(name, from, scrubProps) };
  for (const key of KEPT) {
    const value = from[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') properties[key] = typeof value === 'string' ? value.slice(0, 200) : value;
    else if (key === '$groups' && value && typeof value === 'object') properties.$groups = scrubProps(value);
  }
  Object.assign(properties, { $geoip_disable: true, app: 'allworld', environment: env, release });
  if (name === '$pageview' && location) Object.assign(properties, { $current_url: stripUrl(location.href), $pathname: location.pathname, $host: location.host });
  const people = (value: unknown) => { const safe = scrubProps(value); return Object.keys(safe).length ? safe : undefined; };
  return { ...event, event: name, properties, $set: people(event.$set ?? from.$set), $set_once: people(event.$set_once ?? from.$set_once) };
}
