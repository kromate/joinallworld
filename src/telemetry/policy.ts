/**
 * Telemetry policy (pure: no DOM, no storage, no SDK). Who may be measured, and when.
 *
 *   ERROR MONITORING (Sentry)  runs without asking: a diagnostic with no personal data.
 *   PRODUCT ANALYTICS (PostHog) runs only after the player chose Accept on this device, and never
 *                               for a browser that sends Do Not Track or Global Privacy Control,
 *                               nor for a player known to be under 18.
 *   Neither runs on a development host unless the server says TELEMETRY_DEBUG=1.
 */

export type Consent = 'granted' | 'denied' | 'unset';
/**
 * What GET /api/telemetry/config answers. Only public values: a DSN and a project key are meant
 * to be in a browser. `enabled: false` (or any failure to read it) means: do nothing at all.
 */
export interface ClientConfig {
  enabled: boolean;
  /** 'production' | 'staging' | 'dev' */
  env?: string;
  /** BUILD_ID */
  release?: string;
  /** TELEMETRY_DEBUG=1: also run on localhost */
  debug?: boolean;
  sentry?: { dsn: string; replayOnError?: boolean } | null;
  posthog?: { key: string; host: string; consentAt?: 'landing' | 'reward' } | null;
  /** the caller's stored age answer is "under 18": analytics is off for them, whatever was chosen */
  under18?: boolean;
}

/** localhost, loopback, private and link-local addresses, and the usual development suffixes. */
export function isDevHost(hostname: unknown): boolean {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host === '::1' || host === '0.0.0.0') return true;
  if (/\.(localhost|local|test|internal|lan|home\.arpa)$/.test(host)) return true;
  if (/^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return /^(fe80|fc|fd)[0-9a-f]*:/.test(host);
}

/** True when the browser asks not to be tracked: Do Not Track or Global Privacy Control. Both are read as "Reject". */
export function privacySignal(navigator: object | null | undefined, win?: object | null): boolean {
  const nav = (navigator ?? undefined) as Record<string, unknown> | undefined, scope = (win ?? undefined) as Record<string, unknown> | undefined;
  const dnt = nav?.doNotTrack ?? scope?.doNotTrack ?? nav?.msDoNotTrack;
  return dnt === '1' || dnt === 'yes' || dnt === 1 || nav?.globalPrivacyControl === true;
}

/**
 * The consent in force. A privacy signal or an under-18 player is always 'denied', whatever was stored.
 */
export function resolveConsent({ stored, signal = false, under18 = false }: { stored?: unknown, signal?: boolean, under18?: boolean } = {}): Consent {
  if (signal || under18) return 'denied';
  return stored === 'granted' || stored === 'denied' ? stored : 'unset';
}

/**
 * What may load in this browser.
 */
export function clientPlan(config: ClientConfig | null | undefined, hostname: unknown): { sentry: boolean, posthog: boolean } {
  if (!config || config.enabled !== true) return { sentry: false, posthog: false };
  if (isDevHost(hostname) && config.debug !== true) return { sentry: false, posthog: false };
  return {
    sentry: typeof config.sentry?.dsn === 'string' && config.sentry.dsn.length > 0,
    posthog: typeof config.posthog?.key === 'string' && config.posthog.key.length > 0 && typeof config.posthog?.host === 'string' && config.posthog.host.length > 0,
  };
}

/** The calendar day in Lagos (UTC+1, no daylight saving) as YYYY-MM-DD. */
export function lagosDay(ms: number): string { return new Date(ms + 3600000).toISOString().slice(0, 10); }
/** Whole days from one Lagos day to another (0 = the same day). */
export function daysBetween(first: string, later: string): number { return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86400000); }

/** A duration as a coarse word, for properties that should not be a fingerprint. */
export function bucket(value: number, edges: readonly number[], labels: readonly string[]): string {
  // `?? ''` only satisfies the index check: every caller passes one more label than edges.
  for (let i = 0; i < edges.length; i += 1) if (value < (edges[i] as number)) return labels[i] ?? '';
  return labels[edges.length] ?? '';
}
export const latencyBucket = (ms: number) => bucket(ms, [100, 250, 500, 1000, 2500, 5000], ['lt100', 'lt250', 'lt500', 'lt1000', 'lt2500', 'lt5000', 'gte5000']);
export const fpsBucket = (fps: number) => bucket(fps, [15, 25, 40, 55], ['lt15', '15to24', '25to39', '40to54', 'gte55']);
export const durationBucket = (seconds: number) => bucket(seconds, [60, 300, 900, 1800, 3600], ['lt1m', '1to5m', '5to15m', '15to30m', '30to60m', 'gte60m']);
