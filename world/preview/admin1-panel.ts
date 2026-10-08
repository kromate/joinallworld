import type { InventoryNode } from '../production-types.ts';
import type { Admin1AssetRef, Admin1CountryIndex, Admin1CountryIndexRow, Admin1ProductManifest } from '../admin1-product-types.ts';
import { ADMIN1_PRODUCT_LIMITS } from '../admin1-product-types.ts';
import { ByteLru } from './cache.ts';
import { fetchAdmin1Json, fetchAdmin1Manifest, selectAdmin1Feature, validateAdmin1CountryIndex, validateAdmin1Manifest, validateAdmin1Partition } from './admin1-view.ts';

interface Binding { country: InventoryNode; coarseHash: string }
interface Options {
  host: HTMLElement; binding: () => Binding | null;
  activate: () => void; clear: () => void;
  draw: (feature: Record<string, unknown>, row: Admin1CountryIndexRow) => void;
  downloaded: (bytes: number) => void;
}

/** Independent atlas source; requests only the selected country and feature's partition. */
export function attachAdmin1Panel(options: Options): { reset: () => void } {
  options.host.innerHTML = `<div class="section-head"><span class="section-number">03</span><h2>GLOBAL ADMINISTRATIVE GEOGRAPHY</h2></div>
    <p class="section-copy">Select a country in the 258-unit directory. Its source units load separately from city detail.</p>
    <label for="admin1Url">Global geographic manifest URL</label><input id="admin1Url" spellcheck="false" placeholder="/world-output/admin1-foundation/manifests/&lt;hash&gt;.json"/>
    <label for="admin1Hash">Geographic SHA-256</label><input id="admin1Hash" spellcheck="false" placeholder="64 character content hash"/>
    <button id="loadAdmin1" class="secondary" type="button">Load selected country’s source units <span>↗</span></button>
    <div id="admin1Status" class="inventory-selection" aria-live="polite">Select a country in the 258-unit directory first.</div>
    <div id="admin1List" class="inventory-list"></div>
    <div id="admin1Source" class="inventory-note">Structural geography only · polygon topology unverified · not playable.</div>`;
  const element = <T extends HTMLElement>(id: string) => options.host.querySelector<T>(`#${id}`)!;
  const cache = new ByteLru<string, { value: unknown; bytes: number }>(ADMIN1_PRODUCT_LIMITS.cacheBytes);
  let controller: AbortController | null = null, generation = 0;
  const status = (message: string) => { element('admin1Status').textContent = message; };
  const reset = () => {
    ++generation; controller?.abort(); controller = null; options.clear();
    element('admin1List').replaceChildren();
    element('admin1Source').textContent = 'Structural geography only · polygon topology unverified · not playable.';
    status('Select a country in the 258-unit directory and load its source units.');
  };
  const start = () => {
    controller?.abort(); controller = new AbortController();
    return { epoch: ++generation, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]) };
  };
  const current = (epoch: number, signal: AbortSignal, binding: Binding) => {
    const selected = options.binding();
    return epoch === generation && !signal.aborted && selected?.country.id === binding.country.id
      && selected.coarseHash === binding.coarseHash && selected.country.provider === binding.country.provider;
  };
  const remember = (key: string, result: {value: unknown; bytes: number}, signal: AbortSignal) => {
    if (signal.aborted) throw signal.reason;
    options.downloaded(result.bytes); cache.set(key, result, result.bytes); return result.value;
  };
  const get = async (base: URL, ref: Admin1AssetRef, limit: number, signal: AbortSignal) => {
    const url = new URL(ref.path, base), key = `${url.href}:${ref.sha256}`;
    const cached = cache.get(key); if (cached) return cached.value;
    return remember(key, await fetchAdmin1Json(url.href, ref, limit, signal), signal);
  };
  const outline = async (base: URL, manifest: Admin1ProductManifest, index: Admin1CountryIndex, row: Admin1CountryIndexRow, binding: Binding) => {
    const { epoch, signal } = start(); options.clear(); status(`Loading ${row.name ?? row.sourceKey}…`);
    try {
      if (!row.partitionPath || row.exception) throw new Error(`Source-reference exception: ${row.exception ?? 'no geometry'}`);
      const ref = manifest.partitions.find(asset => asset.path === row.partitionPath);
      if (!ref) throw new Error('Selected source feature has no manifest-bound partition.');
      const partition = await validateAdmin1Partition(await get(base, ref, ADMIN1_PRODUCT_LIMITS.partitionBytes, signal), manifest, index, ref.path);
      const feature = await selectAdmin1Feature(partition, index, row.sourceKey);
      if (!current(epoch, signal, binding)) return;
      options.draw(feature, row);
      status(`${row.name ?? row.sourceKey} · source level ${row.gadmLevel ?? 'unknown'} · geographic outline`);
    } catch (error) { if (epoch === generation) { options.clear(); status(error instanceof Error ? error.message : String(error)); } }
  };
  const load = async () => {
    options.activate();
    const { epoch, signal } = start(); options.clear(); element('admin1List').replaceChildren();
    element('admin1Source').textContent = 'Waiting for verified geographic source context.'; status('Verifying selected country’s source units…');
    try {
      const binding = options.binding();
      if (!binding || binding.country.provider !== 'world') throw new Error('Select a country with a world outline in the 258-unit directory. Nigeria keeps its protected provider.');
      const hash = element<HTMLInputElement>('admin1Hash').value.trim().toLowerCase();
      const url = new URL(element<HTMLInputElement>('admin1Url').value.trim(), location.href);
      const match = /^\/world-output\/admin1-foundation\/manifests\/([a-f0-9]{64})\.json$/.exec(url.pathname);
      if (url.origin !== location.origin || url.search || url.hash || !match || match[1] !== hash) throw new Error('Use a local immutable geographic manifest URL and its matching SHA-256.');
      const key = `${url.href}:${hash}`, cached = cache.get(key);
      const raw = cached ? cached.value : remember(key, await fetchAdmin1Manifest(url.href, hash, signal), signal);
      const manifest = validateAdmin1Manifest(raw, binding.coarseHash);
      if (!current(epoch, signal, binding)) return;
      const country = manifest.countries.find(row => row.countryId === binding.country.id);
      if (!country) throw new Error('Selected country is absent from this source-bound manifest.');
      element('admin1Source').textContent = `${manifest.source.attribution} · ${manifest.source.license}. Source ${manifest.source.release.slice(0, 12)}…; parent ${manifest.parent.manifestHash.slice(0, 12)}…. Structural checks only; polygon topology unverified. Mixed source levels are preserved, not an official state/province hierarchy. Geographic outlines, not playable destinations.`;
      if (!country.index) { status(country.status === 'protected' ? 'Nigeria retains its existing protected geography.' : 'This country has no units in the pinned source.'); return; }
      const base = new URL('../', url);
      const index = validateAdmin1CountryIndex(await get(base, country.index, ADMIN1_PRODUCT_LIMITS.countryIndexBytes, signal), manifest, binding.country.id);
      if (!current(epoch, signal, binding)) return;
      status(`${index.sourceUnits} source units · ${index.emittedUnits} with geometry · partitions load on selection`);
      for (const row of index.rows) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'district-row';
        button.textContent = `${row.name ?? row.sourceKey} · ${row.sourceTypeEn ?? row.sourceType ?? 'type unknown'} · source level ${row.gadmLevel ?? 'unknown'}${row.exception ? ` · ${row.exception}` : ''}`;
        button.addEventListener('click', () => { void outline(base, manifest, index, row, binding); }); element('admin1List').appendChild(button);
      }
    } catch (error) { if (epoch === generation) { options.clear(); element('admin1List').replaceChildren(); element('admin1Source').textContent = 'No verified administrative geography is loaded.'; status(error instanceof Error ? error.message : String(error)); } }
  };
  element('loadAdmin1').addEventListener('click', () => { void load(); });
  return { reset };
}
