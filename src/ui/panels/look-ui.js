/**
 * OWNER: character
 * Shared pieces for the character panels (onboarding, Sim → Profile, Boutique): a static SVG
 * figure that reflects a look, and the look editor. Not a panel and not registered; the 3D
 * avatar is drawn elsewhere from the same `state.onboarding.look`.
 */
import './look-ui.css';
import { esc, money } from '../dom.js';
import { APPEARANCE, BOUTIQUE_PRICES } from '../../game/content/traits.js';

const hexOf = (group, id) => APPEARANCE[group].find((swatch) => swatch.id === id)?.hex ?? '#888888';
export const lookLabel = (id) => APPEARANCE.labels[id] ?? id;
export const hairOptions = (body) => APPEARANCE.hair[body] ?? [];
export const outfitOptions = (body) => APPEARANCE.outfits[body] ?? [];

function hairShapes(style, colour) {
  const cap = `<path d="M38 46a22 22 0 0 1 44 0c-6-9-14-12-22-12s-16 3-22 12Z" fill="${colour}"/>`;
  switch (style) {
    case 'bald': return ['', ''];
    case 'low-cut': return ['', cap];
    case 'classic': return ['', `<path d="M36 50a24 24 0 0 1 48 0c-4-12-16-18-30-14-8 2-14 7-18 14Z" fill="${colour}"/>`];
    case 'afro': return [`<circle cx="60" cy="40" r="31" fill="${colour}"/>`, ''];
    case 'curls': return ['', `${cap}${[40, 50, 60, 70, 80].map((x, i) => `<circle cx="${x}" cy="${i % 2 ? 26 : 30}" r="7" fill="${colour}"/>`).join('')}`];
    case 'bun': return ['', `${cap}<circle cx="60" cy="20" r="10" fill="${colour}"/>`];
    case 'ponytail': return [`<path d="M80 34c16 4 18 26 10 44-3-14-6-24-14-32Z" fill="${colour}"/>`, cap];
    case 'long': return [`<path d="M34 46a26 26 0 0 1 52 0v42H34Z" fill="${colour}"/>`, cap];
    case 'locs': return [`${[34, 41, 79, 86].map((x) => `<rect x="${x - 3}" y="40" width="6" height="44" rx="3" fill="${colour}"/>`).join('')}`, cap];
    case 'braids': return [`${[33, 38, 43, 77, 82, 87].map((x) => `<rect x="${x - 1.5}" y="40" width="3" height="56" rx="1.5" fill="${colour}"/>`).join('')}`, cap];
    default: return ['', cap];
  }
}

function fabricShapes(fabric) {
  if (fabric === 'ankara') return [[46, 84], [70, 90], [52, 104], [74, 112], [46, 122], [62, 124]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="5" fill="${i % 2 ? '#fff' : '#f2c14e'}" opacity=".55"/>`).join('');
  if (fabric === 'adire') return [[48, 86], [60, 86], [72, 86], [54, 100], [66, 100], [48, 114], [60, 114], [72, 114]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="none" stroke="#fff" stroke-width="1.5" opacity=".7"/>`).join('');
  if (fabric === 'aso-oke') return [44, 52, 60, 68, 76].map((x) => `<rect x="${x - 1.5}" y="76" width="3" height="54" fill="#fff" opacity=".4"/>`).join('');
  return '';
}

/** A simple standing figure. `look` is state.onboarding.look. */
export function avatarSvg(look, { size = 150, label = 'Preview of your Sim' } = {}) {
  const skin = hexOf('skin', look.skin), hair = hexOf('hairColours', look.hairColor);
  const top = hexOf('outfitColours', look.outfitColor), bottom = hexOf('outfitColours', look.bottomsColor);
  const outfit = look.outfit;
  const sleeves = outfit === 'office' || outfit === 'hoodie' || outfit === 'site-work' ? 'long' : outfit === 'chill' ? 'none' : 'short';
  const arm = (x) => `<rect x="${x}" y="76" width="11" height="48" rx="5.5" fill="${sleeves === 'long' ? top : skin}"/>${sleeves === 'short' ? `<rect x="${x}" y="76" width="11" height="20" rx="5.5" fill="${top}"/>` : ''}`;
  const legs = outfit === 'owambe' && look.body === 'woman'
    ? `<path d="M40 126h40l12 46H28Z" fill="${top}"/><rect x="30" y="150" width="60" height="7" fill="${bottom}" opacity=".9"/>`
    : `<rect x="43" y="126" width="15" height="48" rx="5" fill="${outfit === 'chill' ? skin : bottom}"/><rect x="62" y="126" width="15" height="48" rx="5" fill="${outfit === 'chill' ? skin : bottom}"/>${outfit === 'chill' ? `<rect x="42" y="126" width="36" height="22" rx="5" fill="${bottom}"/>` : ''}`;
  const detail = outfit === 'office' ? '<path d="M52 74l8 12 8-12Z" fill="#fff"/><path d="M58 84h4l2 22-4 5-4-5Z" fill="#20232c"/>'
    : outfit === 'hoodie' ? '<path d="M50 112h20v10H50Z" fill="#0002"/><path d="M57 76v14M63 76v14" stroke="#fff" stroke-width="1.5"/>'
      : outfit === 'site-work' ? '<rect x="38" y="92" width="44" height="6" fill="#f4e04d"/><rect x="38" y="112" width="44" height="6" fill="#f4e04d"/>' : '';
  const [back, front] = look.hair === 'gele'
    ? ['', `<path d="M34 44c-6-22 14-34 28-30 16-8 34 8 24 30-10-10-38-10-52 0Z" fill="${top}"/><path d="M44 30c10-6 24-6 34 0" fill="none" stroke="#fff" stroke-width="1.5" opacity=".6"/>`]
    : hairShapes(look.hair, hair);
  const hood = outfit === 'hoodie' ? `<path d="M34 78a26 30 0 0 1 52 0Z" fill="${top}"/>` : '';
  return `<svg class="look-avatar" role="img" aria-label="${esc(label)}" viewBox="0 0 120 190" width="${size}" height="${Math.round(size * 190 / 120)}">
    <ellipse cx="60" cy="178" rx="42" ry="8" fill="#0000001a"/>${hood}${back}
    ${legs}<rect x="42" y="170" width="17" height="8" rx="4" fill="#20232c"/><rect x="61" y="170" width="17" height="8" rx="4" fill="#20232c"/>
    ${arm(27)}${arm(82)}<rect x="38" y="74" width="44" height="58" rx="10" fill="${top}"/>${fabricShapes(look.fabric)}${detail}
    <rect x="54" y="62" width="12" height="14" fill="${skin}"/><circle cx="60" cy="48" r="22" fill="${skin}"/>
    <circle cx="52" cy="48" r="2.4" fill="#20232c"/><circle cx="68" cy="48" r="2.4" fill="#20232c"/><path d="M52 57q8 7 16 0" fill="none" stroke="#20232c" stroke-width="2" stroke-linecap="round"/>
    ${front}</svg>`;
}

/**
 * The look after choosing `value` in `group`. Switching body keeps the hairstyle and outfit
 * when the new body has them, otherwise falls back to the first one allowed (and owned, when
 * `owned` — a wardrobe — is given). The server validates the result either way.
 */
export function chooseLook(look, group, value, owned) {
  const next = { ...look, [group]: value };
  if (group !== 'body') return next;
  const fit = (kind, options) => (options.includes(next[kind]) && (!owned || owned[kind].includes(next[kind])) ? next[kind]
    : options.find((id) => !owned || owned[kind].includes(id)) ?? options[0]);
  next.hair = fit('hair', hairOptions(value));
  next.outfit = fit('outfit', outfitOptions(value));
  return next;
}

const GROUPS = [
  ['hair', 'Hairstyle', (look) => hairOptions(look.body)], ['outfit', 'Outfit', (look) => outfitOptions(look.body)], ['fabric', 'Fabric', () => APPEARANCE.fabrics],
];
const SWATCHES = [['skin', 'Skin tone', 'skin'], ['hairColor', 'Hair colour', 'hairColours'], ['outfitColor', 'Outfit colour', 'outfitColours'], ['bottomsColor', 'Bottoms colour', 'outfitColours']];

/**
 * Look editor markup. Buttons carry data-look="<field>" data-value="<id>" (and data-key for
 * focus restoring). With `owned` (a wardrobe), styles not owned are disabled and say where to buy them.
 */
export function lookEditor(look, { owned = null } = {}) {
  const chip = (field, id, text, disabledWhy) => `<button type="button" class="look-chip" data-look="${field}" data-value="${esc(id)}" data-key="${field}:${esc(id)}" aria-pressed="${look[field] === id}" ${disabledWhy ? `disabled title="${esc(disabledWhy)}"` : ''}>${esc(text)}${disabledWhy ? `<small>🔒 ${esc(disabledWhy)}</small>` : ''}</button>`;
  const body = `<fieldset class="look-group"><legend>Body</legend><div class="look-chips">${APPEARANCE.bodies.map((item) => chip('body', item.id, item.label)).join('')}</div></fieldset>`;
  const styles = GROUPS.map(([field, title, options]) => `<fieldset class="look-group"><legend>${title}</legend><div class="look-chips">${options(look).map((id) => chip(field, id, lookLabel(id),
    owned && !owned[field].includes(id) ? `Boutique · ${money(BOUTIQUE_PRICES[field][id])}` : '')).join('')}</div></fieldset>`).join('');
  const swatches = SWATCHES.map(([field, title, group]) => `<fieldset class="look-group"><legend>${title}</legend><div class="look-swatches">${APPEARANCE[group].map((swatch) => `<button type="button" class="look-swatch" data-look="${field}" data-value="${esc(swatch.id)}" data-key="${field}:${esc(swatch.id)}" aria-pressed="${look[field] === swatch.id}" aria-label="${esc(title)}: ${esc(swatch.label)}" title="${esc(swatch.label)}" style="--swatch:${swatch.hex}">${look[field] === swatch.id ? '✓' : ''}</button>`).join('')}</div></fieldset>`).join('');
  return `<div class="look-editor">${body}${styles}${swatches}</div>`;
}

export const sameLook = (a, b) => Object.keys(a).every((field) => a[field] === b[field]);
