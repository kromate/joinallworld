/**
 * OWNER: showcase
 * The public page of a published shop, /shop/<name>-<token>: what a customer sees when a seller sends them the link. One HTML
 * document with its style inline and no script at all, so a slow phone loads a few kilobytes and never the game, and a chat
 * app's crawler (which runs no JavaScript) reads the preview tags from the same document. Both hosts serve it through
 * `ctx.pages` (routes/showcase.ts).
 *
 * Everything the seller wrote is escaped; links are built here from the stored, already allow-listed addresses and checked again
 * (src/types/showcase-link.ts). The page holds no player id, no coordinates and no online state. "Message the seller" opens the
 * seller's own chat with the first words filled in; the game takes no order and holds no money.
 */
import { SAFETY_LINE } from '../../src/game/trust/index.ts';
import { SHOWCASE_CATEGORY_LABELS } from '../../src/types/showcase.ts';
import type { ShowcaseShop } from '../../src/types/showcase.ts';
import { buyMessage, messageHref, priceWords, safeLink, shopEntryPath, shopPath } from '../../src/types/showcase-link.ts';
import { OG_IMAGE, safeOrigin } from '../growth/share.ts';
import { escapeHtml as esc } from '../path-meta.ts';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const HEX = /^#[0-9a-f]{6}$/i;
/** A photo this wide is big enough for a link preview. */
const PREVIEW_MIN_WIDTH = 300;
export const UNAVAILABLE = 'This shop is not available';

/** What the page needs beyond the stored shop. */
export interface ShopPageFacts { shop: ShowcaseShop; token: string; city: string; market: string; checked: string | null; payNotice: string | null }

const clip = (text: string, max: number): string => { const letters = Array.from(text.replace(/\s+/g, ' ').trim()); return letters.length <= max ? letters.join('') : `${letters.slice(0, max - 1).join('').replace(/\s+\S*$/, '')}…`; };
const colour = (value: string | undefined, fallback: string): string => (value !== undefined && HEX.test(value) ? value : fallback);
const photoPath = (id: string): string => `/api/showcase/photo/${encodeURIComponent(id)}`;

const STYLE = `@media(min-width:1800px){body{zoom:1.25}}@media(min-width:2800px){body{zoom:1.6}}*{box-sizing:border-box}body{margin:0;background:#f6f4ef;color:#1d2330;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
a{color:inherit}.wrap{max-width:640px;margin:0 auto;padding:0 16px 40px}
.top{display:flex;align-items:center;justify-content:space-between;min-height:56px}.brand{font-weight:800;letter-spacing:.02em;text-decoration:none;font-size:18px;display:inline-flex;align-items:center;min-height:44px}
.hero{display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;border-radius:16px;background:var(--c2)}
.mark{display:grid;place-items:center;aspect-ratio:16/9;border-radius:16px;background:var(--c1);color:var(--c2);font-size:72px;font-weight:800}
h1{font-size:26px;line-height:1.2;margin:16px 0 4px;overflow-wrap:anywhere}h2{font-size:18px;margin:28px 0 10px}
.meta{margin:0;color:#4a5361;font-size:15px;overflow-wrap:anywhere}.chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0;padding:0;list-style:none}
.chips li{padding:4px 12px;border-radius:999px;background:#e8e4da;font-size:14px}
.btn{display:flex;align-items:center;justify-content:center;min-height:48px;padding:10px 18px;border-radius:12px;border:2px solid #1f6f4a;background:#1f6f4a;color:#fff;font-weight:700;font-size:16px;text-align:center;text-decoration:none}
.btn.alt{background:transparent;color:#1f6f4a}.btn.sm{min-height:44px;padding:8px 14px;font-size:15px}
.act{display:grid;gap:10px;margin:18px 0 0}.fine{margin:10px 0 0;font-size:14px;color:#4a5361}.warn{margin:8px 0 0;font-size:14px;color:#7a4b00}
.about{margin:20px 0 0;overflow-wrap:anywhere}.about p{margin:0 0 8px}
.items{list-style:none;margin:0;padding:0;display:grid;gap:10px}.item{background:#fff;border-radius:14px;padding:14px;border:1px solid #e1ddd2}
.item b{display:block;overflow-wrap:anywhere}.item .note{margin:2px 0 0;font-size:14px;color:#4a5361;overflow-wrap:anywhere}.price{margin:6px 0 10px;font-weight:700;font-size:17px}.price small{font-weight:400;color:#4a5361;font-size:13px}
.shots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0;padding:0;list-style:none}.shots img{display:block;width:100%;height:auto;aspect-ratio:1;object-fit:cover;border-radius:12px;background:#e8e4da}
table{width:100%;border-collapse:collapse;font-size:15px}td{padding:6px 0;border-bottom:1px solid #e1ddd2}td:last-child{text-align:right}
.inside{margin-top:28px;padding:18px;border-radius:16px;background:#183b2a;color:#fff}.inside h2{margin:0 0 6px}.inside p{margin:0 0 14px;font-size:15px}.inside .btn{background:#e8a643;border-color:#e8a643;color:#20232c}
.foot{margin:28px 0 0;font-size:13px;color:#4a5361}.empty{padding:14px;border-radius:14px;background:#fff;border:1px dashed #cfc9bb;color:#4a5361;font-size:15px}
.gone{text-align:center;padding:64px 16px 0}.gone .btn{display:inline-flex;margin-top:18px}
@media(max-width:340px){h1{font-size:23px}.btn{font-size:15px}}`;

const head = (title: string, description: string, url: string, image: { url: string; w?: number; h?: number; alt: string }, robots: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Allworld"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}"><meta property="og:locale" content="en_NG"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(image.url)}">${image.w && image.h ? `<meta property="og:image:width" content="${image.w}"><meta property="og:image:height" content="${image.h}">` : '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:type" content="image/jpeg">'}<meta property="og:image:alt" content="${esc(image.alt)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${esc(image.url)}">
<meta name="robots" content="${robots}"><style>${STYLE}</style></head>`;

/** The page of a shop that cannot be shown (unknown address, hidden, held, in review, removed, owner no longer able to publish). */
export function unavailablePageHtml(origin: unknown = ''): string {
  const base = safeOrigin(origin);
  return `${head(`${UNAVAILABLE} — Allworld`, 'This shop is closed, hidden or the link is wrong. Allworld is a digital world you can live in.', `${base}/`, { url: `${base}${OG_IMAGE}`, alt: 'Allworld' }, 'noindex, nofollow')}
<body><main class="wrap gone" style="--c1:#1f6f4a;--c2:#fff"><h1>${UNAVAILABLE}</h1><p class="meta">It may have been closed, or the link may be wrong. Ask the seller to send it again.</p><a class="btn" href="${esc(`${base}/`)}">Open Allworld</a></main></body></html>`;
}

/** The page of a published shop. Every value that came from a person goes through esc(). */
export function shopPageHtml(facts: ShopPageFacts, origin: unknown = ''): string {
  const { shop, token } = facts, base = safeOrigin(origin);
  const c1 = colour(shop.colours[0], '#1f3a5f'), c2 = colour(shop.colours[1], '#f1f3f5');
  const photos = shop.photos.filter((photo) => photo.approved && !photo.hidden);
  const cover = photos[0];
  const preview = photos.find((photo) => photo.w >= PREVIEW_MIN_WIDTH);
  const kind = SHOWCASE_CATEGORY_LABELS[shop.category];
  const url = `${base}${shopPath(shop.name, token)}`;
  const where = [facts.market, facts.city].filter(Boolean).join(', ');
  const description = clip(`${kind}${facts.city ? ` in ${facts.city}` : ''}. ${shop.about}`, 155);
  const image = preview ? { url: `${base}${photoPath(preview.id)}`, w: preview.w, h: preview.h, alt: preview.caption || shop.name } : { url: `${base}${OG_IMAGE}`, alt: 'Allworld' };

  const contact = (item?: { label: string; priceNaira: number }): string => messageHref(shop.chat.url, buyMessage(shop.name, item), `${shop.name}${item ? `: ${item.label}` : ''}`) ?? '';
  const outside = (href: string, label: string, cls: string, aria = ''): string => (href
    ? `<a class="btn ${cls}" href="${esc(href)}"${/^https:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}${aria ? ` aria-label="${esc(aria)}"` : ''}>${esc(label)}</a>` : '');
  const chat = contact();
  const pay = safeLink(shop.pay?.url);

  const items = shop.services.map((item) => {
    const price = item.priceNaira > 0 ? `${esc(priceWords(item.priceNaira))} <small>seller’s price</small>` : esc(priceWords(0));
    return `<li class="item"><b>${esc(item.label)}</b>${item.note ? `<p class="note">${esc(item.note)}</p>` : ''}<p class="price">${price}</p>${outside(contact(item), 'Message the seller', 'sm', `Message the seller about ${item.label}`)}</li>`;
  }).join('');
  const rest = photos.slice(cover ? 1 : 0);
  const open = shop.hours.some((day) => day !== null);
  const hours = shop.hours.map((day, at) => `<tr><td>${DAYS[at] ?? ''}</td><td>${day ? `${esc(day.open)} to ${esc(day.close)}` : 'Closed'}</td></tr>`).join('');

  return `${head(`${shop.name} — Allworld`, description, url, image, 'noindex, nofollow')}
<body><main class="wrap" style="--c1:${c1};--c2:${c2}">
<div class="top"><a class="brand" href="${esc(`${base}/`)}">Allworld</a></div>
${cover ? `<img class="hero" src="${esc(photoPath(cover.id))}" width="${cover.w}" height="${cover.h}" alt="${esc(cover.caption || shop.name)}" fetchpriority="high">` : `<div class="mark" aria-hidden="true">${esc(Array.from(shop.name)[0]?.toUpperCase() ?? '')}</div>`}
<h1>${esc(shop.name)}</h1>
<p class="meta">${esc(kind)}${where ? ` · ${esc(where)}` : ''}</p>
<ul class="chips">${shop.sign ? `<li>${esc(shop.sign)}</li>` : ''}${facts.checked ? `<li>${esc(facts.checked)}</li>` : ''}</ul>
<div class="act">${chat ? outside(chat, 'Message the seller', '') : '<p class="empty">The seller has not added a way to message them yet.</p>'}${pay ? outside(pay, 'Pay the seller', 'alt') : ''}</div>
<p class="fine"><strong>You deal directly with the seller.</strong> Allworld takes no orders and never holds or moves your money.</p>
${pay && facts.payNotice ? `<p class="warn">${esc(facts.payNotice)}.</p>` : ''}
<div class="about">${shop.about.split('\n').map((line) => `<p>${esc(line)}</p>`).join('')}</div>
<h2>What this shop offers</h2>
${items ? `<ul class="items">${items}</ul>` : '<p class="empty">Nothing is listed yet. Message the seller to ask what they offer.</p>'}
<p class="fine">${esc(SAFETY_LINE)}</p>
${rest.length ? `<h2>Photos</h2><ul class="shots">${rest.map((photo) => `<li><img src="${esc(photoPath(photo.id))}" width="${photo.w}" height="${photo.h}" alt="${esc(photo.caption || shop.name)}" loading="lazy" decoding="async"></li>`).join('')}</ul>` : ''}
<h2>Opening hours</h2>
${open ? `<table>${hours}</table>` : '<p class="empty">Ask the seller when they are open.</p>'}
<section class="inside" aria-label="Step inside"><h2>Step inside</h2><p>Visit this shop in Allworld, a digital world you can live in. Free, in your browser, as a guest.</p><a class="btn" href="${esc(`${base}${shopEntryPath(token)}`)}">Step inside</a></section>
<p class="foot">Shops on Allworld are run by real people, and what they show here is their own. Allworld is free to play.</p>
</main></body></html>`;
}
