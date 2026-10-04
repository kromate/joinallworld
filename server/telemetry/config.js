/**
 * Telemetry configuration, read from the environment (pure and portable: it is handed an `env`
 * object, so the same code reads process.env on Node and the Worker's `env` binding).
 *
 * OFF UNLESS CONFIGURED. With none of the keys set this returns `{ active: false }` and nothing
 * else in server/telemetry or src/telemetry does anything.
 *
 *   TELEMETRY_ENV            production | staging | dev      REQUIRED once any key below is set
 *   SENTRY_DSN_CLIENT        the browser project's DSN (public; sent to the browser)
 *   SENTRY_DSN_SERVER        the server project's DSN (stays on the server)
 *   POSTHOG_KEY              the PROJECT API key, "phc_…" (public; sent to the browser).
 *                            A personal API key ("phx_…") is a secret and is refused.
 *   POSTHOG_HOST             ingestion host. Default https://us.i.posthog.com (the US cloud, the
 *                            region the owner's other product uses); set https://eu.i.posthog.com for the EU cloud.
 *   BUILD_ID                 the release every event is tagged with
 *   TELEMETRY_DEBUG=1        also run on localhost and with TELEMETRY_ENV=dev (for testing the wiring)
 *   TELEMETRY_CONSENT_AT     reward (default) | landing — when the consent sheet is first shown: after a new life's first
 *                            reward (never during the first-minute flow), or at once. The older value `named` means `reward`.
 *   TELEMETRY_REPLAY_ON_ERROR=1   opt-in: Sentry session replay for sessions that hit an error (masked, no canvas)
 *   TELEMETRY_SLOW_MS        a request slower than this may be sampled as a slow transaction (default 1000)
 *
 * The owner's source-map upload token (SENTRY_AUTH_TOKEN) is NOT read here: only
 * scripts/sentry-sourcemaps.mjs uses it, at build time, and it never reaches a running server.
 */
export const ENVIRONMENTS = Object.freeze(['production', 'staging', 'dev']);
export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
/** The share of slow requests reported as transactions (the owner's convention for trace sampling). */
export const TRACE_SAMPLE_RATE = 0.2;

/**
 * A DSN split into the parts the envelope endpoint needs. Null for anything that is not a DSN —
 * including the legacy form with a secret key (`public:secret@host`), which must never be used.
 * @returns {{ dsn: string, key: string, endpoint: string } | null}
 */
export function parseDsn(value) {
  if (typeof value !== 'string' || value.length > 300) return null;
  const match = /^(https?):\/\/([A-Za-z0-9_-]+)@([A-Za-z0-9.-]+(?::\d{1,5})?)((?:\/[A-Za-z0-9_-]+)*)\/(\d+)$/.exec(value.trim());
  if (!match) return null;
  const [, protocol, key, host, path, project] = match;
  return { dsn: value.trim(), key, endpoint: `${protocol}://${host}${path}/api/${project}/envelope/` };
}

function hostOf(value, allowHttp) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch { return null; }
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @param {{ buildId?: string }} [options]
 * @returns {{ active: boolean, problems: string[], env: string | null, debug: boolean, release: string,
 *   sentryServer: ReturnType<typeof parseDsn>, sentryClient: ReturnType<typeof parseDsn>, posthog: { key: string, host: string } | null,
 *   replayOnError: boolean, consentAt: 'reward' | 'landing', slowMs: number }}
 */
export function readTelemetryConfig(env = {}, { buildId } = {}) {
  const problems = [];
  const text = (name) => (typeof env?.[name] === 'string' ? env[name].trim() : '');
  const debug = text('TELEMETRY_DEBUG') === '1';
  const wanted = ['SENTRY_DSN_CLIENT', 'SENTRY_DSN_SERVER', 'POSTHOG_KEY'].filter((name) => text(name));
  const off = { active: false, problems, env: null, debug, release: String(buildId ?? text('BUILD_ID') ?? '').slice(0, 40), sentryServer: null, sentryClient: null, posthog: null, replayOnError: false, consentAt: 'reward', slowMs: 1000 };
  if (!wanted.length) return off;
  const stage = text('TELEMETRY_ENV');
  if (!ENVIRONMENTS.includes(stage)) { problems.push('TELEMETRY_ENV must be production, staging or dev: telemetry stays off.'); return off; }
  if (stage === 'dev' && !debug) { problems.push('TELEMETRY_ENV=dev: telemetry stays off (set TELEMETRY_DEBUG=1 to test the wiring).'); return off; }
  const dsn = (name) => {
    if (!text(name)) return null;
    const parsed = parseDsn(text(name));
    if (!parsed || (parsed.dsn.startsWith('http://') && !debug)) { problems.push(`${name} is not a usable DSN (https://<public key>@<host>/<project id>): ignored.`); return null; }
    return parsed;
  };
  let posthog = null;
  if (text('POSTHOG_KEY')) {
    const key = text('POSTHOG_KEY');
    const host = hostOf(text('POSTHOG_HOST') || DEFAULT_POSTHOG_HOST, debug);
    if (/^ph[xs]_/i.test(key)) problems.push('POSTHOG_KEY is a personal or secret API key. Use the PROJECT API key (phc_…): ignored.');
    else if (!/^[A-Za-z0-9_-]{8,200}$/.test(key)) problems.push('POSTHOG_KEY is not a project API key: ignored.');
    else if (!host) problems.push('POSTHOG_HOST must be an https URL without a query: analytics ignored.');
    else posthog = { key, host };
  }
  const sentryServer = dsn('SENTRY_DSN_SERVER'), sentryClient = dsn('SENTRY_DSN_CLIENT');
  const slow = Number(text('TELEMETRY_SLOW_MS'));
  return { ...off, active: Boolean(sentryServer || sentryClient || posthog), env: stage, sentryServer, sentryClient, posthog,
    replayOnError: text('TELEMETRY_REPLAY_ON_ERROR') === '1', consentAt: text('TELEMETRY_CONSENT_AT') === 'landing' ? 'landing' : 'reward',
    slowMs: Number.isFinite(slow) && slow >= 50 ? slow : 1000 };
}

/** What GET /api/telemetry/config answers: public values only (see ClientConfig in src/telemetry/policy.js). */
export function publicConfig(config) {
  if (!config?.active || (!config.sentryClient && !config.posthog)) return { enabled: false };
  return { enabled: true, env: config.env, release: config.release, debug: config.debug,
    sentry: config.sentryClient ? { dsn: config.sentryClient.dsn, replayOnError: config.replayOnError } : null,
    posthog: config.posthog ? { key: config.posthog.key, host: config.posthog.host, consentAt: config.consentAt } : null };
}
