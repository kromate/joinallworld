/**
 * OWNER: character
 * Shared pieces for the character panels (onboarding, Sim → Profile, Boutique):
 *
 *   lookStage(look, options)        markup for the preview stage (a placeholder the 3D canvas moves into)
 *   mountLookPreview(root, look)    call from bind(): shows the 3D preview in the stage inside `root`
 *   lookEditor(look, options)       the option tabs (Body, Hair, Outfit, Colours)
 *   lookTabClick(target)            call from a click handler: switches tab; true if it did
 *   chooseLook, sameLook, randomLook, lookLabel, lookSummary, avatarSvg
 *
 * THE PREVIEW is src/scene/avatar-preview.js: a Three.js canvas drawn on demand only (no render
 * loop). Its code and Three.js are fetched with a dynamic import the first time a stage is
 * shown, so neither is part of the first download. Until it arrives the stage shows a still
 * silhouette; if WebGL is not available, or the context is lost, it shows the flat 2D figure
 * (avatarSvg) instead and nothing is reported as an error.
 *
 * ONE CONTEXT: there is one preview for the whole app. Panels redraw by replacing their HTML, so
 * the canvas is kept here and moved into each new stage; it is disposed (renderer, geometry,
 * materials, WebGL context) as soon as its stage leaves the page or the sheet is closed.
 * previewDiagnostics() reports its render counter.
 */
import './look-ui.css';
import { esc, money, mark } from '../dom.js';
import { APPEARANCE, BOUTIQUE_PRICES } from '../../game/content/traits.ts';

const hexOf = (group, id) => APPEARANCE[group].find((swatch) => swatch.id === id)?.hex ?? '#888888';
export const lookLabel = (id) => APPEARANCE.labels[id] ?? id;
export const hairOptions = (body) => [...(APPEARANCE.hair[body] ?? []), ...(APPEARANCE.extra.hair[body] ?? [])];
export const outfitOptions = (body) => [...(APPEARANCE.outfits[body] ?? []), ...(APPEARANCE.extra.outfits[body] ?? [])];
const SLOT = Object.fromEntries(APPEARANCE.accessories.map((item) => [item.id, item.slot]));
const worn = (look) => (Array.isArray(look.accessories) ? look.accessories : []);
/** The accessories of `look` with `id` put on: it replaces whatever shares its slot; at the limit the oldest gives way. */
export function withAccessory(look, id) {
  const kept = worn(look).filter((other) => other !== id && SLOT[other] !== SLOT[id]);
  return [...kept.slice(Math.max(0, kept.length - (APPEARANCE.accessoryLimit - 1))), id];
}
export const withoutAccessory = (look, id) => worn(look).filter((other) => other !== id);
/**
 * What a Sim may wear while it is being created: everything offered except the styles sold only
 * in the Boutique. The same shape as a wardrobe, so the editor locks the rest the same way.
 */
export function starterWardrobe() {
  const free = (kind, ids) => ids.filter((id) => !APPEARANCE.boutiqueOnly[kind].includes(id));
  return { hair: free('hair', [...new Set(APPEARANCE.bodies.flatMap((body) => hairOptions(body.id)))]), outfit: free('outfit', [...new Set(APPEARANCE.bodies.flatMap((body) => outfitOptions(body.id)))]),
    fabric: [...APPEARANCE.fabrics], accessories: free('accessories', APPEARANCE.accessories.map((item) => item.id)) };
}

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
  lastField = group === 'accessories' ? (['eyes', 'head', 'ears', 'neck'].includes(SLOT[value]) ? 'hair' : 'body') : group; zoomOverride = null;
  if (group === 'accessories') return { ...look, accessories: worn(look).includes(value) ? withoutAccessory(look, value) : withAccessory(look, value) };
  const next = { ...look, [group]: value };
  if (group !== 'body') return next;
  const fit = (kind, options) => (options.includes(next[kind]) && (!owned || owned[kind].includes(next[kind])) ? next[kind]
    : options.find((id) => !owned || owned[kind].includes(id)) ?? options[0]);
  next.hair = fit('hair', hairOptions(value));
  next.outfit = fit('outfit', outfitOptions(value));
  return next;
}

const titled = (id) => { const text = String(lookLabel(id)); return text.charAt(0).toUpperCase() + text.slice(1); };
const swatchLabel = (group, id) => APPEARANCE[group].find((swatch) => swatch.id === id)?.label ?? id;
/** "Woman · Braids · Owambe · Ankara · Glasses" */
export const lookSummary = (look) => [look.body, look.hair, look.outfit, look.fabric, ...worn(look)].filter(Boolean).map(titled).join(' · ');
/** The preview's text alternative: everything the picture shows, in words. */
export function lookAlt(look, name = 'Your Sim') {
  return `${name}: ${titled(look.body)}, ${swatchLabel('skin', look.skin).toLowerCase()} skin, ${titled(look.hair).toLowerCase()} hairstyle in ${swatchLabel('hairColours', look.hairColor).toLowerCase()}, ${titled(look.outfit).toLowerCase()} outfit in ${titled(look.fabric).toLowerCase()} ${swatchLabel('outfitColours', look.outfitColor).toLowerCase()}, ${swatchLabel('outfitColours', look.bottomsColor).toLowerCase()} bottoms${worn(look).length ? `, wearing ${worn(look).map((id) => titled(id).toLowerCase()).join(', ')}` : ''}.`;
}
/** The look as the scene code takes it: style ids as they are, colours as hex values. */
export const sceneLook = (look) => ({ body: look.body, hair: look.hair, outfit: look.outfit, fabric: look.fabric, accessories: [...worn(look)], face: look.face ?? APPEARANCE.faces[0], expression: look.expression ?? APPEARANCE.expressions[0], skin: hexOf('skin', look.skin),
  hairColor: hexOf('hairColours', look.hairColor), outfitColor: hexOf('outfitColours', look.outfitColor), bottomsColor: hexOf('outfitColours', look.bottomsColor) });
/**
 * A random look a new Sim may wear: nothing that is sold only in the Boutique, and up to two of
 * the free accessories. `random` returns 0 ≤ n < 1.
 */
export function randomLook(random = Math.random) {
  const pick = (list) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
  const free = starterWardrobe(), body = pick(APPEARANCE.bodies).id;
  let look = { body, hair: pick(hairOptions(body).filter((id) => free.hair.includes(id))), outfit: pick(outfitOptions(body).filter((id) => free.outfit.includes(id))), fabric: pick(APPEARANCE.fabrics),
    skin: pick(APPEARANCE.skin).id, hairColor: pick(APPEARANCE.hairColours).id, outfitColor: pick(APPEARANCE.outfitColours).id, bottomsColor: pick(APPEARANCE.outfitColours).id,
    accessories: [], face: pick(APPEARANCE.faces), expression: pick(APPEARANCE.expressions) };
  for (let count = Math.floor(random() * 3); count > 0; count--) look = { ...look, accessories: withAccessory(look, pick(free.accessories)) };
  return look;
}

// ---- Editor ----------------------------------------------------------------------------------
// Tabs group the options by what they change. `focus` is where the preview looks while a tab is open.
const SECTIONS = [
  { id: 'body', title: 'Body', icon: 'person', focus: 'body', groups: [['chips', 'body', 'Body type'], ['swatches', 'skin', 'Skin tone', 'skin'], ['chips', 'face', 'Face shape'], ['chips', 'expression', 'Expression']] },
  { id: 'hair', title: 'Hair', icon: 'scissors', focus: 'head', groups: [['chips', 'hair', 'Hairstyle'], ['swatches', 'hairColor', 'Hair colour', 'hairColours']] },
  { id: 'outfit', title: 'Outfit', icon: 'boutique', focus: 'body', groups: [['chips', 'outfit', 'Outfit'], ['chips', 'fabric', 'Fabric']] },
  { id: 'colours', title: 'Colours', icon: 'frame', focus: 'body', groups: [['swatches', 'outfitColor', 'Outfit colour', 'outfitColours'], ['swatches', 'bottomsColor', 'Bottoms colour', 'outfitColours']] },
  { id: 'extras', title: 'Extras', icon: 'crown', focus: 'body', groups: [['chips', 'accessories', `Accessories · up to ${APPEARANCE.accessoryLimit}, tap again to take one off`]] },
];
const HEAD_FIELDS = new Set(['hair', 'hairColor', 'skin', 'face', 'expression']);
let section = 'body', lastField = null, zoomOverride = null;
const optionsOf = (field, look) => (field === 'body' ? APPEARANCE.bodies.map((item) => item.id) : field === 'hair' ? hairOptions(look.body) : field === 'outfit' ? outfitOptions(look.body)
  : field === 'accessories' ? APPEARANCE.accessories.map((item) => item.id) : field === 'face' ? APPEARANCE.faces : field === 'expression' ? APPEARANCE.expressions : APPEARANCE.fabrics);
/** Whether `id` is what the look has for `field` (optional fields fall back to their default; accessories are a list). */
const chosen = (look, field, id) => (field === 'accessories' ? worn(look).includes(id) : (look[field] ?? (field === 'face' ? APPEARANCE.faces[0] : field === 'expression' ? APPEARANCE.expressions[0] : undefined)) === id);

/** Where the preview should look now: head and shoulders while hair, face or skin is being changed. */
export function lookFocus() {
  if (zoomOverride) return zoomOverride;
  if (lastField) return HEAD_FIELDS.has(lastField) ? 'head' : 'body';
  return SECTIONS.find((item) => item.id === section)?.focus ?? 'body';
}
/** Show the whole Sim again (after a shuffle, say), whatever was last being changed. */
export function lookFocusBody() { lastField = 'body'; zoomOverride = null; }
/** Handle a click on a look tab (call with the clicked element). Returns true when it was one. */
export function lookTabClick(target) {
  const tab = target?.closest?.('[data-look-tab]');
  if (!tab) return false;
  section = SECTIONS.some((item) => item.id === tab.dataset.lookTab) ? tab.dataset.lookTab : 'body';
  lastField = null; zoomOverride = null;
  return true;
}

/**
 * Look editor markup: a tab row and the open tab's options. Option buttons carry
 * data-look="<field>" data-value="<id>"; tabs carry data-look-tab="<id>"; all carry data-key for
 * focus restoring. With `owned` (a wardrobe), styles not owned are disabled and say where to buy them.
 */
export function lookEditor(look, { owned = null } = {}) {
  const current = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];
  const chips = (field, title) => `<fieldset class="look-group"><legend>${title}</legend><div class="look-chips">${optionsOf(field, look).map((id) => {
    const why = owned && owned[field] && !owned[field].includes(id) && !chosen(look, field, id) ? `Boutique · ${money(BOUTIQUE_PRICES[field][id])}` : '';
    return `<button type="button" class="look-chip" data-look="${field}" data-value="${esc(id)}" data-key="${field}:${esc(id)}" aria-pressed="${chosen(look, field, id)}" ${why ? `disabled title="${esc(why)}"` : ''}>${esc(titled(id))}${why ? `<small>${mark('lock')} ${esc(why)}</small>` : ''}</button>`;
  }).join('')}</div></fieldset>`;
  const swatches = (field, title, group) => `<fieldset class="look-group"><legend>${title} <b>${esc(swatchLabel(group, look[field]))}</b></legend><div class="look-swatches">${APPEARANCE[group].map((swatch) => `<button type="button" class="look-swatch" data-look="${field}" data-value="${esc(swatch.id)}" data-key="${field}:${esc(swatch.id)}" aria-pressed="${look[field] === swatch.id}" aria-label="${esc(title)}: ${esc(swatch.label)}" style="--swatch:${swatch.hex}"><i aria-hidden="true">${look[field] === swatch.id ? '✓' : ''}</i><span>${esc(swatch.label)}</span></button>`).join('')}</div></fieldset>`;
  const tabs = SECTIONS.map((item) => `<button type="button" role="tab" class="look-tab" id="look-tab-${item.id}" data-look-tab="${item.id}" data-key="tab:${item.id}" aria-selected="${item === current}" aria-controls="look-panel"><span aria-hidden="true">${mark(item.icon)}</span>${item.title}${item.id === 'extras' && worn(look).length ? `<b>${worn(look).length}</b>` : ''}</button>`).join('');
  const groups = current.groups.map(([kind, field, title, group]) => (kind === 'chips' ? chips(field, title) : swatches(field, title, group))).join('');
  return `<div class="look-editor"><div class="look-tabs" role="tablist" aria-label="What to change">${tabs}</div><div class="look-panel" id="look-panel" role="tabpanel" aria-labelledby="look-tab-${current.id}">${groups}</div></div>`;
}

// ---- Preview stage -------------------------------------------------------------------------------
const SPUN_KEY = 'joinallworld-spun';
let spun = false;
try { spun = globalThis.localStorage?.getItem(SPUN_KEY) === '1'; } catch { spun = false; }

/**
 * Stage markup. variant: 'hero' (the creator), 'wide' (Profile, Boutique) or 'mini' (beside the
 * later creation steps). The controls sit in a row under the stage, never over the character:
 * the Face / Full body switch, `caption` and `tools` (both already-escaped HTML).
 */
export function lookStage(look, { variant = 'hero', name = 'Your Sim', tools = '', caption = '' } = {}) {
  const focus = lookFocus(), mini = variant === 'mini';
  return `<div class="look-view is-${variant}"><div class="look-stage" data-look-stage data-mode="loading" ${spun ? 'data-spun' : ''}>
    <div class="look-stage-view" data-look-canvas>${avatarSvg(look, { size: 150, label: lookAlt(look, name) })}</div>
    ${mini ? '' : '<p class="look-hint" aria-hidden="true">↔ Drag to spin</p>'}</div>
    ${mini ? '' : `<div class="look-bar"><button type="button" class="look-tool" data-look-zoom aria-pressed="${focus === 'head'}" title="Switch between full body and face">${focus === 'head' ? `${mark('person')} Full body` : `${mark('search')} Face`}</button><p class="look-caption">${caption}</p>${tools}</div>`}</div>`;
}

let scene3d = null, loading = null, preview = null, unavailable = false, wanted = null, watcher = null, watchedDialog = null, lastShown = '';
/** { renderCount, frames, animating, live, … } of the preview that is alive, or null. For tests and checks. */
export const previewDiagnostics = () => (preview ? preview.diagnostics() : null);
if (typeof window !== 'undefined') window.__lookPreview = previewDiagnostics;

/** Free the preview and its WebGL context. Safe to call at any time. */
export function releaseLookPreview() {
  preview?.dispose(); preview = null; lastShown = '';
  watcher?.disconnect(); watcher = null;
}
function onDialogClose(event) { const dialog = event.currentTarget; queueMicrotask(() => { if (!dialog.open) releaseLookPreview(); }); }
function watch(stage) {
  // The preview lives exactly as long as its stage is on the page and its sheet is open.
  if (!watcher) {
    watcher = new MutationObserver(() => { if (preview && !preview.canvas.isConnected) releaseLookPreview(); });
    watcher.observe(document.body, { childList: true, subtree: true });
  }
  const dialog = stage.closest('dialog');
  if (dialog && dialog !== watchedDialog) { watchedDialog?.removeEventListener('close', onDialogClose); watchedDialog = dialog; dialog.addEventListener('close', onDialogClose); }
}
function show() {
  const { stage, host, look, focus, react, label } = wanted;
  if (!host.isConnected) return;
  try {
    if (!preview) {
      preview = scene3d.createAvatarPreview(host, { look, focus, label,
        onSpin() { if (spun) return; spun = true; try { localStorage.setItem(SPUN_KEY, '1'); } catch { /* private mode */ } document.querySelectorAll('[data-look-stage]').forEach((node) => node.setAttribute('data-spun', '')); },
        onLost() { releaseLookPreview(); document.querySelectorAll('[data-look-stage]').forEach((node) => { node.dataset.mode = '2d'; }); } });
    } else {
      preview.attach(host);
      preview.setLook(look, { react });
      preview.setFocus(focus);
      preview.setLabel(label);
    }
    stage.dataset.mode = '3d';
    watch(stage);
  } catch (error) {
    // No WebGL (or it failed to start): keep the flat figure and do not try again this session.
    releaseLookPreview(); unavailable = true; stage.dataset.mode = '2d';
    if (!scene3d || !(error instanceof scene3d.PreviewUnavailable)) console.warn('The 3D preview is not available; showing the 2D figure.', error);
  }
}
/**
 * Show the 3D preview of `look` in the stage inside `root` (call from a panel's bind()). The first
 * call downloads the preview code; later calls move the existing canvas and update it, costing one
 * frame only when something changed. A root without a stage releases the preview.
 */
export function mountLookPreview(root, look, { name = 'Your Sim' } = {}) {
  const stage = root?.querySelector?.('[data-look-stage]');
  if (!stage) { releaseLookPreview(); return; }
  const view = stage.closest('.look-view') ?? stage;
  const host = stage.querySelector('[data-look-canvas]'), drawn = sceneLook(look), key = JSON.stringify(drawn);
  wanted = { stage, host, look: drawn, focus: lookFocus(), react: lastShown !== '' && lastShown !== key, label: `${lookAlt(look, name)} Drag, or use the left and right arrow keys, to turn.` };
  lastShown = key;
  view.querySelector('[data-look-zoom]')?.addEventListener('click', (event) => {
    zoomOverride = lookFocus() === 'head' ? 'body' : 'head';
    const button = event.currentTarget, head = zoomOverride === 'head';
    button.setAttribute('aria-pressed', String(head)); button.innerHTML = head ? `${mark('person')} Full body` : `${mark('search')} Face`;
    preview?.setFocus(zoomOverride);
  });
  if (unavailable) { stage.dataset.mode = '2d'; return; }
  if (scene3d) { show(); return; }
  loading ??= import('../../scene/avatar-preview.js');
  loading.then((module) => { scene3d = module; if (wanted?.host.isConnected) show(); },
    () => { loading = null; if (wanted?.stage.isConnected) wanted.stage.dataset.mode = '2d'; });
}

/** The same look, whatever order the accessories are in and whether or not the optional fields are spelled out. */
const canonical = (look) => JSON.stringify([look.body, look.hair, look.outfit, look.fabric, look.skin, look.hairColor, look.outfitColor, look.bottomsColor,
  [...worn(look)].sort(), look.face ?? APPEARANCE.faces[0], look.expression ?? APPEARANCE.expressions[0]]);
export const sameLook = (a, b) => canonical(a) === canonical(b);
