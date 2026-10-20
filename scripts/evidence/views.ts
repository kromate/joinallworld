// The named views of the evidence harness and the small pure helpers around them (no browser, no network: tested in views.test.ts).
//
// A view is: a city, the game actions that bring a fresh open-mode life to the place, the place the page must report when it
// is there, and an in-game clock. Lagos time is UTC+1 all year, which is how the game reads the hour (src/game/clock.ts).

export type ViewName = 'street-dusk' | 'street-night' | 'kano-noon' | 'home-night';
export type Band = 'day' | 'dusk' | 'night';

/** One game action sent over HTTP before the browser opens, then waited for until it has finished. */
export interface Step { type: string; payload: Record<string, unknown> }

export interface ViewSpec {
  name: ViewName;
  /** What a person would call it. */
  title: string;
  city: string;
  /** Actions from the settled start of a new open-mode life. */
  steps: Step[];
  /** `location` the game must report before the picture is taken. */
  location: string;
  /** In-game clock, Lagos local time. */
  clock: { hour: number; minute: number };
  /** The light the clock must give (checked by a test against src/scene/lighting.ts). */
  band: Band;
  /** Where the page is told to open. */
  path: string;
  /** `street-pose`: put the camera where the map's dive ends on the home street (eye height on the pavement, looking along the traffic). */
  camera?: 'street-pose';
  /** What a reader should know about the view that the table does not show. */
  note: string;
}

const goHome: Step = { type: 'travel', payload: { id: 'home', mode: 'trek' } };

export const VIEWS: Readonly<Record<ViewName, ViewSpec>> = Object.freeze({
  'street-dusk': {
    name: 'street-dusk', title: 'A Lagos street at dusk', city: 'lagos', location: 'neighbourhood', band: 'dusk', clock: { hour: 18, minute: 30 }, path: '/', camera: 'street-pose',
    steps: [goHome, { type: 'home.door', payload: { direction: 'outside' } }],
    note: 'The home street (the street-life scene: traffic, passers-by, shopfronts) seen from the pavement, where the map dive lands. Open mode puts the new life in Agege, so this is not Yaba; the scene is the same code for every Lagos home.',
  },
  'street-night': {
    name: 'street-night', title: 'A Lagos street at night', city: 'lagos', location: 'neighbourhood', band: 'night', clock: { hour: 21, minute: 0 }, path: '/', camera: 'street-pose',
    steps: [goHome, { type: 'home.door', payload: { direction: 'outside' } }],
    note: 'The same street and camera as street-dusk at 21:00, when lamps, windows and signs are meant to be the light (open-source plan phase 2b).',
  },
  'kano-noon': {
    name: 'kano-noon', title: 'A Kano venue at noon', city: 'kano', location: 'kurmi-market', band: 'day', clock: { hour: 12, minute: 0 }, path: '/',
    steps: [{ type: 'travel', payload: { id: 'kurmi-market', mode: 'trek' } }],
    note: 'Kurmi Market, the old city market, reached on foot from the Gama garden where a new Kano life starts.',
  },
  'home-night': {
    name: 'home-night', title: 'A home at night', city: 'lagos', location: 'home', band: 'night', clock: { hour: 22, minute: 0 }, path: '/',
    steps: [goHome],
    note: 'The free starter house with its starter furniture, indoors.',
  },
});

export const VIEW_NAMES = Object.keys(VIEWS) as ViewName[];
export const isViewName = (value: string): value is ViewName => Object.hasOwn(VIEWS, value);

/** The instant (ms since 1970) of a Lagos wall-clock time on a calendar day `YYYY-MM-DD`. */
export function lagosInstant(day: string, clock: { hour: number; minute: number }): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error(`"${day}" is not a day like 2026-10-19`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), clock.hour - 1, clock.minute);
}

/** The value at fraction `p` (0 to 1) of an ascending list; null for an empty list. Nearest rank, as the game's own benchmark does. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] ?? null;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

export interface FrameSummary { frames: number; p50: number | null; p95: number | null; max: number | null; over42: number; over100: number }

/** The frame table's numbers from the gaps (ms) between animation frames. */
export function summariseGaps(gaps: readonly number[]): FrameSummary {
  const sorted = [...gaps].sort((a, b) => a - b);
  const at = (p: number): number | null => { const value = percentile(sorted, p); return value === null ? null : round1(value); };
  return { frames: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted.length ? round1(sorted[sorted.length - 1]!) : null, over42: sorted.filter((gap) => gap > 42).length, over100: sorted.filter((gap) => gap > 100).length };
}

/** `HH:MM` as a Lagos clock; throws on anything else. */
export function parseClock(text: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  const hour = match ? Number(match[1]) : NaN, minute = match ? Number(match[2]) : NaN;
  if (!match || hour > 23 || minute > 59) throw new Error(`"${text}" is not a clock like 18:30`);
  return { hour, minute };
}

/** The two clocks the clock-pin proof shoots each view at: full day and clear night. */
export const PROOF_CLOCKS: readonly { hour: number; minute: number }[] = Object.freeze([{ hour: 12, minute: 0 }, { hour: 21, minute: 0 }]);
/** The least difference in the scene's mean brightness (0 to 255) between those two pictures that counts as "the clock reached the light". */
export const PROOF_MIN_DIFFERENCE = 15;

/** The proof's verdict from the two mean brightness figures (day, night). */
export function proveClock(day: number, night: number): { ok: boolean; difference: number } {
  const difference = Math.round((day - night) * 10) / 10;
  return { ok: difference >= PROOF_MIN_DIFFERENCE, difference };
}

export interface ShootOptions { base: string; views: ViewName[]; out: string; scale: number; width: number; height: number; dwellMs: number; gpu: 'swiftshader' | 'metal'; uncapped: boolean; day: string; clock: { hour: number; minute: number } | null; proveClock: boolean; query: string; sid: string | null }

/** `--uncapped` and `--prove-clock` are switches; `--clock HH:MM` replaces each view's own clock; `--sid SID` shoots the life of an earlier run (its `sid` is in the run's JSON) instead of a new one, so two runs show the very same street (a before and an after, `?post=0` and `?post=1`); a life already at the view's place is not moved.  `--base URL --view name[,name|all] --out DIR --scale N --size WxH --dwell SECONDS --gpu swiftshader|metal --day YYYY-MM-DD --query "quality=high&wet=1"` (extra page query). */
export function parseShootArgs(argv: readonly string[], today = new Date().toISOString().slice(0, 10)): ShootOptions {
  const value = (name: string): string | undefined => {
    const at = argv.indexOf(`--${name}`);
    if (at >= 0) return argv[at + 1];
    return argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  };
  const base = (value('base') ?? 'http://127.0.0.1:5211').replace(/\/+$/, '');
  const asked = (value('view') ?? 'all').split(',').map((name) => name.trim()).filter(Boolean);
  const views = asked.includes('all') ? [...VIEW_NAMES] : asked.map((name) => { if (!isViewName(name)) throw new Error(`Unknown view "${name}". Views: ${VIEW_NAMES.join(', ')}.`); return name; });
  const size = /^(\d{3,4})x(\d{3,4})$/.exec(value('size') ?? '1280x800');
  if (!size) throw new Error('--size is WIDTHxHEIGHT, for example 1280x800.');
  const scale = Number(value('scale') ?? 2), dwell = Number(value('dwell') ?? 10);
  if (!(scale >= 1 && scale <= 3)) throw new Error('--scale is between 1 and 3.');
  if (!(dwell >= 1 && dwell <= 120)) throw new Error('--dwell is between 1 and 120 seconds.');
  const gpu = value('gpu') ?? defaultGpu();
  if (gpu !== 'swiftshader' && gpu !== 'metal') throw new Error('--gpu is swiftshader or metal.');
  const day = value('day') ?? today;
  lagosInstant(day, { hour: 12, minute: 0 });
  return { base, views, out: value('out') ?? 'docs/evidence/out', scale, width: Number(size[1]), height: Number(size[2]), dwellMs: dwell * 1000, gpu, uncapped: argv.includes('--uncapped'), day, clock: value('clock') === undefined ? null : parseClock(value('clock')!), proveClock: argv.includes('--prove-clock'), query: (value('query') ?? '').replace(/^[?&]+/, ''), sid: value('sid') ?? null };
}

/**
 * Console errors the game logs on a normal run and that mean nothing is wrong. Each has the reason it is allowed; anything else counts.
 * `GET /api/street/me` answers 409 when the player has no street journey open, which is the usual state; the page logs the refusal.
 */
export const KNOWN_ERRORS: readonly { pattern: RegExp; why: string }[] = Object.freeze([
  { pattern: /409 \(Conflict\) \(https?:\/\/[^/]+\/api\/street\/me\)/, why: 'no street journey is open; the server says so with 409' },
]);

export function classifyErrors(errors: readonly string[]): { unexpected: string[]; known: string[] } {
  const unexpected: string[] = [], known: string[] = [];
  for (const error of errors) (KNOWN_ERRORS.some((entry) => entry.pattern.test(error)) ? known : unexpected).push(error);
  return { unexpected, known };
}

/** Software drawing everywhere, except on an Apple-silicon Mac where the real GPU is reachable. */
export function defaultGpu(platform: string = process.platform, arch: string = process.arch): 'swiftshader' | 'metal' {
  return platform === 'darwin' && arch === 'arm64' ? 'metal' : 'swiftshader';
}
