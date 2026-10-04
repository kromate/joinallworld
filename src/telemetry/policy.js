/**
 * Telemetry policy (pure: no DOM, no storage, no SDK). Who may be measured, and when.
 *
 *   ERROR MONITORING (Sentry)  runs without asking: a diagnostic with no personal data.
 *   PRODUCT ANALYTICS (PostHog) runs only after the player chose Accept on this device, and never
 *                               for a browser that sends Do Not Track or Global Privacy Control,
 *                               nor for a player known to be under 18.
 *   Neither runs on a development host unless the server says TELEMETRY_DEBUG=1.
 */

/** @typedef {'granted' | 'denied' | 'unset'} Consent */
/**
 * What GET /api/telemetry/config answers. Only public values: a DSN and a project key are meant
 * to be in a browser. `enabled: false` (or any failure to read it) means: do nothing at all.
 * @typedef {object} ClientConfig
 * @property {boolean} enabled
 * @property {string} [env]            'production' | 'staging' | 'dev'
 * @property {string} [release]        BUILD_ID
 * @property {boolean} [debug]         TELEMETRY_DEBUG=1: also run on localhost
 * @property {{ dsn: string, replayOnError?: boolean } | null} [sentry]
 * @property {{ key: string, host: string, consentAt?: 'landing' | 'named' } | null} [posthog]
 */

/** localhost, loopback, private and link-local addresses, and the usual development suffixes. */
export function isDevHost(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host === '::1' || host === '0.0.0.0') return true;
  if (/\.(localhost|local|test|internal|lan|home\.arpa)$/.test(host)) return true;
  if (/^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return /^(fe80|fc|fd)[0-9a-f]*:/.test(host);
}

/** True when the browser asks not to be tracked: Do Not Track or Global Privacy Control. Both are read as "Reject". */
export function privacySignal(nav, win) {
  const dnt = nav?.doNotTrack ?? win?.doNotTrack ?? nav?.msDoNotTrack;
  return dnt === '1' || dnt === 'yes' || dnt === 1 || nav?.globalPrivacyControl === true;
}

/**
 * The consent in force. A privacy signal or an under-18 player is always 'denied', whatever was stored.
 * @param {{ stored?: unknown, signal?: boolean, under18?: boolean }} input
 * @returns {Consent}
 */
export function resolveConsent({ stored, signal = false, under18 = false } = {}) {
  if (signal || under18) return 'denied';
  return stored === 'granted' || stored === 'denied' ? stored : 'unset';
}

/**
 * What may load in this browser.
 * @param {ClientConfig | null | undefined} config
 * @param {string} hostname
 * @returns {{ sentry: boolean, posthog: boolean }}
 */
export function clientPlan(config, hostname) {
  if (!config || config.enabled !== true) return { sentry: false, posthog: false };
  if (isDevHost(hostname) && config.debug !== true) return { sentry: false, posthog: false };
  return {
    sentry: typeof config.sentry?.dsn === 'string' && config.sentry.dsn.length > 0,
    posthog: typeof config.posthog?.key === 'string' && config.posthog.key.length > 0 && typeof config.posthog?.host === 'string' && config.posthog.host.length > 0,
  };
}

/** The calendar day in Lagos (UTC+1, no daylight saving) as YYYY-MM-DD. */
export function lagosDay(ms) { return new Date(ms + 3600000).toISOString().slice(0, 10); }
/** Whole days from one Lagos day to another (0 = the same day). */
export function daysBetween(first, later) { return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86400000); }

/** A duration as a coarse word, for properties that should not be a fingerprint. */
export function bucket(value, edges, labels) {
  for (let i = 0; i < edges.length; i += 1) if (value < edges[i]) return labels[i];
  return labels[edges.length];
}
export const latencyBucket = (ms) => bucket(ms, [100, 250, 500, 1000, 2500, 5000], ['lt100', 'lt250', 'lt500', 'lt1000', 'lt2500', 'lt5000', 'gte5000']);
export const fpsBucket = (fps) => bucket(fps, [15, 25, 40, 55], ['lt15', '15to24', '25to39', '40to54', 'gte55']);
export const durationBucket = (seconds) => bucket(seconds, [60, 300, 900, 1800, 3600], ['lt1m', '1to5m', '5to15m', '15to30m', '30to60m', 'gte60m']);
