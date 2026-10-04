/**
 * Draws the share image (public/og/allworld.png, 1200x630) and the app icons from SVG, using the headless Chromium that
 * Playwright keeps in ~/Library/Caches/ms-playwright (or the binary named by CHROME). Nothing is installed or uploaded.
 *
 *   node --experimental-strip-types scripts/make-og.ts
 *
 * The share card is a shaded globe (the repo's own world outlines, projected orthographically) with amber lights on many
 * continents and a few thin travel arcs; the icons are flat shapes. Palette: dark green ground, amber, off-white.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WORLD } from '../src/map3d/geo/data/world.ts';
import { decodeTopology } from '../src/map3d/geo/topo.ts';

const root = resolve(import.meta.dirname, '..');
const GREEN = '#183b2a', AMBER = '#e8a643', DANFO = '#f5c21b', INK = '#20232c', FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

function chrome(): string {
  const given = process.env.CHROME;
  if (given && existsSync(given)) return given;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const found: string[] = [];
  if (existsSync(cache)) for (const dir of readdirSync(cache).sort().reverse()) {
    if (!dir.startsWith('chromium_headless_shell')) continue;
    for (const arch of readdirSync(join(cache, dir))) { const bin = join(cache, dir, arch, 'chrome-headless-shell'); if (existsSync(bin)) found.push(bin); }
  }
  const first = found[0];
  if (!first) throw new Error('No headless Chromium found: set CHROME to a chrome-headless-shell binary.');
  return first;
}

function render(svg: string, width: number, height: number, out: string, transparent = false): void {
  const dir = mkdtempSync(join(tmpdir(), 'og-'));
  try {
    const page = join(dir, 'page.html');
    writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${transparent ? 'transparent' : GREEN}}svg{display:block}</style>${svg}`);
    execFileSync(chrome(), ['--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${width},${height}`,
      `--default-background-color=${transparent ? '00000000' : 'ff183b2aff'.slice(0, 8)}`, `--screenshot=${out}`, `file://${page}`], { stdio: 'ignore' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const WHITE = '#ffffff';
const GLOBE = { cx: 950, cy: 375, r: 345 };
const VIEW = { lon: 0, lat: 16 };
const RAD = Math.PI / 180;

/** Orthographic projection of a lon/lat (at height `lift` above the surface, 1 = surface) as seen from VIEW; `depth` > 0 faces the viewer. */
function project(lon: number, lat: number, lift = 1): { x: number; y: number; depth: number } {
  const l = (lon - VIEW.lon) * RAD, p = lat * RAD, p0 = VIEW.lat * RAD;
  const x = Math.cos(p) * Math.sin(l);
  const y = Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l);
  const depth = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l);
  return { x: GLOBE.cx + GLOBE.r * lift * x, y: GLOBE.cy - GLOBE.r * lift * y, depth };
}
/** A point behind the globe is pushed out to the edge of the disc, so a coastline runs along the rim instead of disappearing. */
function onDisc(lon: number, lat: number): [number, number] {
  const q = project(lon, lat);
  if (q.depth >= 0) return [q.x, q.y];
  const dx = q.x - GLOBE.cx, dy = q.y - GLOBE.cy, d = Math.hypot(dx, dy) || 1;
  return [GLOBE.cx + (dx / d) * GLOBE.r, GLOBE.cy + (dy / d) * GLOBE.r];
}

const land = (): string => {
  const topo = decodeTopology(WORLD), out: string[] = [];
  for (const feature of topo.features) {
    if (feature.id === 'aq') continue;
    const near = project(feature.at[0], feature.at[1]).depth > -0.45 || (feature.bounds.maxLon - feature.bounds.minLon) > 40;
    if (!near) continue;
    for (const poly of feature.rings) for (const ring of poly) {
      const pts: string[] = [];
      let seen = false;
      for (let k = 0; k + 1 < ring.length; k += 2) { const lon = ring[k]!, lat = ring[k + 1]!; if (project(lon, lat).depth > -0.1) seen = true; const [x, y] = onDisc(lon, lat); pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`); }
      if (seen && pts.length > 5) out.push(`M${pts.join('L')}Z`);
    }
  }
  return out.join('');
};

/** Faint meridians every 30 degrees and parallels every 30 degrees, following the sphere's curvature. */
const grid = (): string => {
  const out: string[] = [];
  const trace = (points: [number, number][]): void => {
    let run: string[] = [];
    for (const [lon, lat] of points) { const q = project(lon, lat); if (q.depth > 0) run.push(`${q.x.toFixed(1)} ${q.y.toFixed(1)}`); else { if (run.length > 1) out.push(`M${run.join('L')}`); run = []; } }
    if (run.length > 1) out.push(`M${run.join('L')}`);
  };
  for (let lon = -180; lon < 180; lon += 30) trace(Array.from({ length: 91 }, (_, k): [number, number] => [lon, -90 + k * 2]));
  for (let lat = -60; lat <= 60; lat += 30) trace(Array.from({ length: 181 }, (_, k): [number, number] => [-180 + k * 2, lat]));
  return out.join('');
};

/** Small amber lights spread over many countries (a deterministic scatter): people live everywhere. */
const lights = (): string => {
  const out: string[] = [];
  let seed = 7;
  const rand = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const feature of decodeTopology(WORLD).features) {
    if (feature.id === 'aq' || feature.id === 'ng') continue;
    const size = Math.min(3, 1 + Math.round((feature.bounds.maxLon - feature.bounds.minLon) / 22));
    for (let n = 0; n < size; n++) {
      const lon = feature.at[0] + (rand() - 0.5) * Math.min(12, feature.bounds.maxLon - feature.bounds.minLon) * (n ? 1 : 0), lat = feature.at[1] + (rand() - 0.5) * Math.min(8, feature.bounds.maxLat - feature.bounds.minLat) * (n ? 1 : 0);
      const q = project(lon, lat);
      if (q.depth < 0.12) continue;
      const rr = 1.6 + rand() * 2.2, edge = Math.min(1, q.depth * 2.5);
      out.push(`<circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="${rr.toFixed(1)}" fill="${AMBER}" opacity="${(0.55 + 0.45 * edge).toFixed(2)}"/>`);
    }
  }
  return out.join('');
};

/** Thin amber arcs between far-apart places, lifted off the surface a little. */
const flights = (): string => {
  const pairs: [[number, number], [number, number]][] = [[[2, 49], [28, -26]], [[31, 30], [73, 19]], [[-17, 15], [-35, -8]], [[-3, 40], [37, -1]]];
  return pairs.map(([a, b]) => {
    const pts: string[] = [], rad = (v: number): number => v * RAD;
    const va = [Math.cos(rad(a[1])) * Math.cos(rad(a[0])), Math.cos(rad(a[1])) * Math.sin(rad(a[0])), Math.sin(rad(a[1]))] as const;
    const vb = [Math.cos(rad(b[1])) * Math.cos(rad(b[0])), Math.cos(rad(b[1])) * Math.sin(rad(b[0])), Math.sin(rad(b[1]))] as const;
    const omega = Math.acos(va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]);
    for (let k = 0; k <= 40; k++) {
      const t = k / 40, f = Math.sin((1 - t) * omega) / Math.sin(omega), g = Math.sin(t * omega) / Math.sin(omega);
      const v = [f * va[0] + g * vb[0], f * va[1] + g * vb[1], f * va[2] + g * vb[2]] as const;
      const q = project(Math.atan2(v[1], v[0]) / RAD, Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD, 1 + 0.16 * Math.sin(Math.PI * t));
      pts.push(`${q.x.toFixed(1)} ${q.y.toFixed(1)}`);
    }
    return `<path d="M${pts.join('L')}" fill="none" stroke="${AMBER}" stroke-width="2" stroke-linecap="round" opacity=".8"/>`;
  }).join('');
};

const { cx: GX, cy: GY, r: GR } = GLOBE;
const card = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="${FONT}">
<defs>
<radialGradient id="glow" cx="${GX}" cy="${GY}" r="${GR * 1.9}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2b6a4a" stop-opacity=".75"/><stop offset=".55" stop-color="#21503a" stop-opacity=".25"/><stop offset="1" stop-color="${GREEN}" stop-opacity="0"/></radialGradient>
<radialGradient id="sea" cx="${GX - GR * 0.35}" cy="${GY - GR * 0.4}" r="${GR * 1.5}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2f6f50"/><stop offset=".5" stop-color="#1f5a3f"/><stop offset="1" stop-color="#0f2f21"/></radialGradient>
<radialGradient id="shade" cx="${GX - GR * 0.35}" cy="${GY - GR * 0.4}" r="${GR * 1.35}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffffff" stop-opacity=".16"/><stop offset=".45" stop-color="#ffffff" stop-opacity="0"/><stop offset=".82" stop-color="#04140c" stop-opacity=".4"/><stop offset="1" stop-color="#04140c" stop-opacity=".78"/></radialGradient>
<radialGradient id="rim" cx="${GX}" cy="${GY}" r="${GR + 34}" gradientUnits="userSpaceOnUse"><stop offset=".9" stop-color="#7fd0a0" stop-opacity=".0"/><stop offset=".935" stop-color="#7fd0a0" stop-opacity=".38"/><stop offset="1" stop-color="#7fd0a0" stop-opacity="0"/></radialGradient>
<clipPath id="disc"><circle cx="${GX}" cy="${GY}" r="${GR}"/></clipPath>
<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>
</defs>
<rect width="1200" height="630" fill="${GREEN}"/>
<rect width="1200" height="630" fill="url(#glow)"/>
<ellipse cx="${GX + 18}" cy="${GY + 40}" rx="${GR}" ry="${GR}" fill="#04140c" opacity=".55" filter="url(#soft)"/>
<circle cx="${GX}" cy="${GY}" r="${GR + 34}" fill="url(#rim)"/>
<circle cx="${GX}" cy="${GY}" r="${GR}" fill="url(#sea)"/>
<g clip-path="url(#disc)">
<path d="${grid()}" fill="none" stroke="#9fe0b8" stroke-width="1.2" opacity=".22"/>
<path d="${land()}" fill="#5aa77a" fill-rule="evenodd"/>
<circle cx="${GX}" cy="${GY}" r="${GR}" fill="url(#shade)"/>
${flights()}${lights()}
</g>
<text x="72" y="282" font-size="132" font-weight="800" fill="${WHITE}" letter-spacing="-3">Allworld</text>
<rect x="80" y="312" width="96" height="8" rx="4" fill="${AMBER}"/>
<text x="78" y="384" font-size="40" font-weight="500" fill="#e9f1ec">A whole world to live in.</text>
</svg>`;

/** The mark: a rounded or full-bleed green square with an amber A. `inset` keeps the A inside the maskable safe zone. */
const icon = (size: number, shape: 'round' | 'full', scale: number): string => {
  const s = size, c = s / 2, h = s * 0.3 * scale, w = h * 0.62;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
${shape === 'round' ? `<rect width="${s}" height="${s}" rx="${s * 0.22}" fill="${GREEN}"/>` : `<rect width="${s}" height="${s}" fill="${GREEN}"/>`}
<path d="M${c - w} ${c + h * 0.92} L${c} ${c - h} L${c + w} ${c + h * 0.92}" fill="none" stroke="${AMBER}" stroke-width="${s * 0.095 * scale}" stroke-linecap="round" stroke-linejoin="round"/>
<line x1="${c - w * 0.5}" y1="${c + h * 0.34}" x2="${c + w * 0.5}" y2="${c + h * 0.34}" stroke="${AMBER}" stroke-width="${s * 0.075 * scale}" stroke-linecap="round"/>
</svg>`;
};

mkdirSync(join(root, 'public/og'), { recursive: true });
mkdirSync(join(root, 'public/icons'), { recursive: true });
render(card, 1200, 630, join(root, 'public/og/allworld.png'));
/** The shaded globe is smooth, so a 24-bit PNG is large; when ffmpeg is installed the card is kept as a 256-colour palette PNG (about a third of the size). */
function shrink(file: string): void {
  const temp = `${file}.tmp.png`;
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', 'split[a][b];[a]palettegen=max_colors=200:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=3', '-frames:v', '1', temp], { stdio: 'ignore' });
    if (statSync(temp).size < statSync(file).size) renameSync(temp, file);
  } catch { /* ffmpeg is optional */ } finally { rmSync(temp, { force: true }); }
}
shrink(join(root, 'public/og/allworld.png'));
render(icon(512, 'round', 1), 512, 512, join(root, 'public/icons/icon-512.png'), true);
render(icon(192, 'round', 1), 192, 192, join(root, 'public/icons/icon-192.png'), true);
render(icon(512, 'full', 0.72), 512, 512, join(root, 'public/icons/icon-maskable-512.png'));
render(icon(180, 'full', 0.8), 180, 180, join(root, 'public/icons/apple-touch-icon.png'));
render(icon(32, 'round', 1), 32, 32, join(root, 'public/icons/favicon-32.png'), true);
writeFileSync(join(root, 'public/favicon.svg'), icon(64, 'round', 1).replace(/\n/g, ''));
for (const file of ['og/allworld.png', 'icons/icon-512.png', 'icons/icon-192.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png']) console.log(file, statSync(join(root, 'public', file)).size, 'bytes');
