/**
 * Draws the share image (public/og/allworld.png, 1200x630) and the app icons from SVG, using the headless Chromium that
 * Playwright keeps in ~/Library/Caches/ms-playwright (or the binary named by CHROME). Nothing is installed or uploaded.
 *
 *   node --experimental-strip-types scripts/make-og.ts
 *
 * The art is flat shapes in the game's palette: dark green ground, amber, a Lekki-style cable-stayed bridge, a yellow danfo.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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

const cables = (): string => {
  const out: string[] = [];
  for (let i = 0; i < 8; i++) { const x = 560 + i * 34; out.push(`<line x1="760" y1="350" x2="${x}" y2="522"/>`); }
  for (let i = 0; i < 8; i++) { const x = 800 + i * 36; out.push(`<line x1="760" y1="350" x2="${x}" y2="522"/>`); }
  return out.join('');
};

const card = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="${FONT}">
<rect width="1200" height="630" fill="${GREEN}"/>
<circle cx="1000" cy="170" r="66" fill="${AMBER}"/>
<g fill="#21503a"><rect x="0" y="430" width="70" height="200"/><rect x="70" y="390" width="54" height="240"/><rect x="124" y="450" width="90" height="180"/><rect x="214" y="410" width="60" height="220"/><rect x="274" y="440" width="80" height="190"/><rect x="354" y="380" width="48" height="250"/><rect x="402" y="430" width="100" height="200"/><rect x="900" y="420" width="70" height="210"/><rect x="970" y="380" width="56" height="250"/><rect x="1026" y="440" width="84" height="190"/><rect x="1110" y="400" width="90" height="230"/></g>
<g fill="#2c6247"><rect x="20" y="470" width="60" height="160"/><rect x="150" y="480" width="70" height="150"/><rect x="300" y="470" width="50" height="160"/><rect x="430" y="490" width="80" height="140"/><rect x="940" y="480" width="60" height="150"/><rect x="1060" y="470" width="70" height="160"/></g>
<rect x="0" y="548" width="1200" height="82" fill="#0f2a1d"/>
<g stroke="#2c6247" stroke-width="3" stroke-linecap="round"><line x1="40" y1="580" x2="160" y2="580"/><line x1="260" y1="600" x2="420" y2="600"/><line x1="820" y1="584" x2="960" y2="584"/><line x1="1000" y1="606" x2="1150" y2="606"/></g>
<polygon points="748,522 772,522 766,350 754,350" fill="#0b2117"/>
<rect x="756" y="346" width="8" height="12" fill="${AMBER}"/>
<g stroke="${AMBER}" stroke-width="2" opacity=".75">${cables()}</g>
<rect x="520" y="522" width="680" height="14" fill="#0b2117"/>
<rect x="520" y="522" width="680" height="3" fill="${AMBER}" opacity=".6"/>
<g><rect x="880" y="486" width="112" height="38" rx="6" fill="${DANFO}"/><rect x="890" y="494" width="20" height="14" rx="2" fill="${INK}"/><rect x="916" y="494" width="20" height="14" rx="2" fill="${INK}"/><rect x="942" y="494" width="20" height="14" rx="2" fill="${INK}"/><rect x="880" y="508" width="112" height="6" fill="${INK}" opacity=".85"/><circle cx="906" cy="526" r="9" fill="${INK}"/><circle cx="966" cy="526" r="9" fill="${INK}"/></g>
<text x="76" y="196" font-size="148" font-weight="800" fill="#ffffff" letter-spacing="-3">Allworld</text>
<rect x="82" y="226" width="96" height="8" rx="4" fill="${AMBER}"/>
<text x="80" y="300" font-size="42" font-weight="500" fill="#e9f1ec">Live a Lagos life. Free, in your browser.</text>
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
render(icon(512, 'round', 1), 512, 512, join(root, 'public/icons/icon-512.png'), true);
render(icon(192, 'round', 1), 192, 192, join(root, 'public/icons/icon-192.png'), true);
render(icon(512, 'full', 0.72), 512, 512, join(root, 'public/icons/icon-maskable-512.png'));
render(icon(180, 'full', 0.8), 180, 180, join(root, 'public/icons/apple-touch-icon.png'));
render(icon(32, 'round', 1), 32, 32, join(root, 'public/icons/favicon-32.png'), true);
writeFileSync(join(root, 'public/favicon.svg'), icon(64, 'round', 1).replace(/\n/g, ''));
for (const file of ['og/allworld.png', 'icons/icon-512.png', 'icons/icon-192.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png']) console.log(file, statSync(join(root, 'public', file)).size, 'bytes');
