import type { InventoryNode } from '../production-types.ts';
import type { FineAdminNode } from '../fine-types.ts';
import { ByteLru } from './cache.ts';
import { fetchFineJson, FINE_VIEW_LIMITS, validateFineIndex, validateFineIndexProvenance, validateFineManifest, validateFineOutline, validateFineTopology, type FineGeometry, type FineIndex, type FineManifest } from './fine-view.ts';

interface Binding { country: InventoryNode; coarseHash: string }
interface FinePanelOptions {
  host: HTMLElement;
  binding: () => Binding | null;
  draw: (geometry: FineGeometry, node: FineAdminNode) => void;
  clear: () => void;
  downloaded: (bytes: number) => void;
}

/** Separate lazy administrative directory; it cannot change the coarse hierarchy. */
export function attachFinePanel(options: FinePanelOptions): { reset: () => void } {
  options.host.innerHTML = `<label for="fineUrl">Administrative manifest URL</label><input id="fineUrl" spellcheck="false" placeholder="/world-output/fine/rw/adm1/manifests/&lt;hash&gt;.json"/>
    <label for="fineHash">Administrative SHA-256</label><input id="fineHash" spellcheck="false" placeholder="64 character content hash"/>
    <button id="loadFine" class="secondary" type="button">Load selected country’s divisions <span>↗</span></button>
    <div id="fineStatus" class="inventory-selection" aria-live="polite">Select a country in the geographic inventory first.</div>
    <div id="fineList" class="inventory-list"></div><div id="fineSource" class="inventory-note">Administrative outlines only · no city, climate or playability claim.</div>`;
  const element = <T extends HTMLElement>(id: string) => options.host.querySelector<T>(`#${id}`)!;
  const cache = new ByteLru<string, { value: unknown; bytes: number }>(5 * 1024 * 1024);
  let controller: AbortController | null = null, generation = 0;
  const status = (message: string) => { element('fineStatus').textContent = message; };
  const reset = () => {
    generation++; controller?.abort(); controller = null;
    options.clear();
    element('fineList').replaceChildren();
    element('fineSource').textContent = 'Administrative outlines only · no city, climate or playability claim.';
    status('Select a country and load its separate administrative manifest.');
  };
  const sameBinding = (expected: Binding): boolean => {
    const actual = options.binding();
    return actual?.country.id === expected.country.id && actual.coarseHash === expected.coarseHash
      && actual.country.provider === 'world' && actual.country.countryCode === expected.country.countryCode;
  };
  const start = () => { controller?.abort(); controller = new AbortController(); return { epoch: ++generation, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]) }; };
  const current = (epoch: number, signal: AbortSignal) => epoch === generation && !signal.aborted;
  const get = async (url: URL, hash: string, limit: number, signal: AbortSignal): Promise<unknown> => {
    const key = `${url.href}:${hash}`, cached = cache.get(key);
    if (cached) return cached.value;
    const result = await fetchFineJson(url.href, hash, limit, signal);
    if (signal.aborted) throw signal.reason;
    options.downloaded(result.bytes);
    cache.set(key, { value: result.value, bytes: result.bytes }, result.bytes);
    return result.value;
  };
  const assetHash = (relative: string) => relative.slice(relative.lastIndexOf('/') + 1, -5);
  const outline = async (base: URL, manifest: FineManifest, index: FineIndex, row: FineIndex['nodes'][number]) => {
    const { epoch, signal } = start(); options.clear(); status(`Loading ${row.node.name} outline…`);
    try {
      const geometry = validateFineOutline(await get(new URL(row.outlinePath, base), assetHash(row.outlinePath), FINE_VIEW_LIMITS.outlineBytes, signal));
      const binding = options.binding();
      if (!current(epoch, signal) || binding?.country.id !== manifest.countryId || binding.coarseHash !== manifest.coarseInventoryHash) return;
      options.draw(geometry, row.node);
      status(`${row.node.name} · ${index.nodes.length}/${manifest.sourceUnitCount} source divisions · verified geographic outline`);
    } catch (error) { if (epoch === generation) status(error instanceof Error ? error.message : String(error)); }
  };
  const load = async () => {
    const { epoch, signal } = start(); options.clear(); element('fineList').replaceChildren(); element('fineSource').textContent = 'Waiting for a verified administrative source.'; status('Verifying administrative source…');
    try {
      const binding = options.binding();
      if (!binding || binding.country.provider !== 'world' || !binding.country.countryCode) throw new Error('Select a country with a world geographic outline first. Nigeria remains protected.');
      const hash = element<HTMLInputElement>('fineHash').value.trim().toLowerCase();
      const url = new URL(element<HTMLInputElement>('fineUrl').value.trim(), location.href);
      const match = /^\/world-output\/fine\/([a-z]{2})\/adm1\/manifests\/([a-f0-9]{64})\.json$/.exec(url.pathname);
      if (url.origin !== location.origin || !match || match[1] !== binding.country.countryCode.toLowerCase() || match[2] !== hash) throw new Error('Use this country’s local immutable administrative manifest URL and matching hash.');
      const manifest = validateFineManifest(await get(url, hash, FINE_VIEW_LIMITS.manifestBytes, signal), binding.coarseHash, binding.country.id);
      if (!current(epoch, signal) || !sameBinding(binding)) throw new Error('Selected country changed while the fine manifest was loading.');
      const base = new URL('../', url);
      const index = validateFineIndexProvenance(validateFineIndex(await get(new URL(manifest.nodeIndexPath, base), assetHash(manifest.nodeIndexPath), FINE_VIEW_LIMITS.indexBytes, signal), binding.country.id, manifest.sourceUnitCount), manifest, binding.country.countryCode);
      if (!current(epoch, signal) || !sameBinding(binding)) throw new Error('Selected country changed while the fine index was loading.');
      let qualityText: string;
      if (manifest.schemaVersion === 2) {
        const topology = validateFineTopology(await get(new URL(manifest.topologyPath, base), assetHash(manifest.topologyPath), FINE_VIEW_LIMITS.topologyBytes, signal), manifest, index);
        if (!current(epoch, signal) || !sameBinding(binding)) throw new Error('Selected country changed while topology evidence was loading.');
        qualityText = `${topology.validUnits}/${manifest.sourceUnitCount} divisions passed planar polygon checks; spherical validity and real-world boundary correctness are not established.`;
      } else {
        qualityText = 'Structural checks only; complete polygon topology has not been established.';
      }
      if (!current(epoch, signal) || !sameBinding(binding)) throw new Error('Selected country changed before the fine directory could be shown.');
      element('fineSource').textContent = `${manifest.source.source.attribution} · ${manifest.source.source.license} · ${manifest.source.originalLicense} · represented ${manifest.source.representedYear}. ${qualityText} Geographic outlines only, not playable. ${manifest.exceptions.join(' ')}`;
      status(`${index.nodes.length}/${manifest.sourceUnitCount} divisions verified · outlines load on selection`);
      for (const row of index.nodes) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'district-row'; button.textContent = `${row.node.name} · ${row.node.adminType}`;
        button.addEventListener('click', () => { void outline(base, manifest, index, row); }); element('fineList').appendChild(button);
      }
    } catch (error) { if (epoch === generation) { options.clear(); element('fineList').replaceChildren(); element('fineSource').textContent = 'No verified administrative directory is loaded.'; status(error instanceof Error ? error.message : String(error)); } }
  };
  element('loadFine').addEventListener('click', () => { void load(); });
  return { reset };
}
