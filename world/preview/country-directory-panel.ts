import { COUNTRY_DIRECTORY_LIMITS } from '../country-directory-types.ts';
import type { InventoryNode } from '../production-types.ts';
import { CountryDirectoryJsonCache, directoryAssetUrl, fetchCountryOutline, validateCountryDirectoryIdentity, validateCountryDirectoryManifest, validateCountryDirectoryNodeIndex } from './country-directory-view.ts';
import type { CountryDirectoryManifest, CountryDirectoryNodeIndex } from '../country-directory-types.ts';
import type { InventoryGeometry } from './inventory-view.ts';

interface CountryDirectoryCallbacks {
  draw: (geometry: InventoryGeometry, node: InventoryNode, manifestHash: string) => void;
  clear: () => void;
  selected: () => void;
}

/** Lazy, geographically-scoped country directory that does not mutate the legacy inventory. */
export function attachCountryDirectoryPanel(host: HTMLElement, callbacks: CountryDirectoryCallbacks): { reset: () => void } {
  host.innerHTML = `<div class="section-head"><span class="section-number">WORLD</span><h2>WORLD GEOGRAPHY</h2></div>
    <p class="section-copy">Country, territory and disputed map-unit outlines from the separate immutable directory. These are not playable destinations.</p>
    <label for="countryDirectoryUrl">Directory manifest URL</label><input id="countryDirectoryUrl" spellcheck="false" placeholder="/world-output/country-inventory/manifests/&lt;hash&gt;.json"/>
    <label for="countryDirectoryHash">Manifest SHA-256</label><input id="countryDirectoryHash" spellcheck="false" placeholder="64 character content hash"/>
    <button id="loadCountryDirectory" class="secondary" type="button">Load world geography <span>↗</span></button>
    <div id="countryDirectoryStatus" class="inventory-selection" aria-live="polite">Load a separately reviewed country directory.</div>
    <div id="countryDirectoryCache" class="inventory-note">Verified bytes fetched: 0 B · Cached: 0 B</div>
    <div id="countryDirectoryAttribution" class="inventory-note">Geographic reference only · not playable.</div>
    <details id="countryDirectoryExceptions" class="inventory-note" hidden><summary>Directory exceptions and limitations</summary><div></div></details>
    <div id="countryDirectoryList" class="inventory-list"></div>`;
  const element = <T extends HTMLElement>(id: string): T => host.querySelector<T>(`#${id}`)!;
  const inputUrl = element<HTMLInputElement>('countryDirectoryUrl'), inputHash = element<HTMLInputElement>('countryDirectoryHash');
  const status = (message: string): void => { element('countryDirectoryStatus').textContent = message; };
  let downloadedBytes = 0;
  let cachedBytes = 0;
  const byteLabel = (bytes: number): string => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
  const updateCache = (): void => { element('countryDirectoryCache').textContent = `Verified bytes fetched: ${byteLabel(downloadedBytes)} · Cached: ${byteLabel(cachedBytes)}`; };
  const cache = new CountryDirectoryJsonCache({ downloaded: bytes => { downloadedBytes += bytes; cachedBytes = cache.byteLength; updateCache(); } });
  let generation = 0, controller: AbortController | null = null;
  let manifest: CountryDirectoryManifest | null = null, base: URL | null = null, rootIndex: CountryDirectoryNodeIndex | null = null;
  let verifiedManifestHash = '';
  const row = (label: string, detail: string, action: () => void): HTMLButtonElement => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'district-row inventory-country';
    const marker = document.createElement('span'); marker.className = 'district-marker'; marker.textContent = '◎';
    const info = document.createElement('span'); info.className = 'district-info';
    const title = document.createElement('strong'); title.textContent = label;
    const caption = document.createElement('small'); caption.textContent = detail;
    info.append(title, caption); const arrow = document.createElement('span'); arrow.className = 'district-arrow'; arrow.textContent = '›';
    button.append(marker, info, arrow); button.addEventListener('click', action); return button;
  };
  const clearList = (): void => { element('countryDirectoryList').replaceChildren(); };
  const clearExceptions = (): void => {
    const disclosure = element<HTMLDetailsElement>('countryDirectoryExceptions');
    disclosure.hidden = true;
    disclosure.open = false;
    disclosure.querySelector('div')!.textContent = '';
  };
  const operation = (): { epoch: number; signal: AbortSignal } => {
    controller?.abort(new DOMException('Country directory selection changed.', 'AbortError'));
    controller = new AbortController();
    return { epoch: ++generation, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]) };
  };
  const current = (epoch: number, signal: AbortSignal): boolean => epoch === generation && !signal.aborted;
  const operationError = (error: unknown, signal: AbortSignal): string => {
    if (signal.aborted) return signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
      ? 'Country directory request timed out. You can retry.'
      : 'Country directory request was cancelled.';
    return error instanceof Error ? error.message : String(error);
  };
  const manifestAsset = (url: URL, hash: string): boolean => url.origin === location.origin
    && url.pathname === `/world-output/country-inventory/manifests/${hash}.json`;
  const getNode = async (nodePath: string, expectedId: string, expectedParent: string, currentManifest: CountryDirectoryManifest, signal: AbortSignal): Promise<CountryDirectoryNodeIndex> => {
    const hash = nodePath.slice(nodePath.lastIndexOf('/') + 1, -5);
    const result = await cache.getJson(directoryAssetUrl(base!, 'nodes', hash).href, hash, COUNTRY_DIRECTORY_LIMITS.indexBytes, signal);
    return validateCountryDirectoryNodeIndex(result.value, currentManifest, expectedId, expectedParent);
  };
  const showContinents = (epoch = generation, signal = controller?.signal): void => {
    if (!manifest || !rootIndex || (signal && !current(epoch, signal))) return;
    clearList();
    for (const child of rootIndex.children) {
      const rollup = manifest.rollups.find(item => item.id === child.id);
      element('countryDirectoryList').append(row(child.name, `${rollup?.countryCount ?? '—'} map units · continent/region`, () => {
        const next = operation(); callbacks.selected(); callbacks.clear(); void loadContinent(child, next.epoch, next.signal);
      }));
    }
    status(`${manifest.sourceUnitCount} map units · ${manifest.outlineCount} outlines · ${rootIndex.children.length} continents/regions. Select a region.`);
  };
  const showCountries = (index: CountryDirectoryNodeIndex, epoch: number, signal: AbortSignal): void => {
    if (!current(epoch, signal)) return;
    clearList();
    const back = document.createElement('button'); back.type = 'button'; back.className = 'secondary'; back.textContent = 'Back to continents and regions';
    back.addEventListener('click', () => { const next = operation(); callbacks.selected(); callbacks.clear(); showContinents(next.epoch, next.signal); });
    element('countryDirectoryList').append(back);
    for (const child of index.children) {
      const protectedNigeria = child.id === 'legacy-ng';
      const button = row(protectedNigeria ? `${child.name} · protected legacy` : child.name,
        protectedNigeria ? 'Existing Nigeria map remains protected' : 'Map unit · geographic outline',
        () => { void chooseCountry(child, index.node.id); });
      element('countryDirectoryList').append(button);
    }
    status(`${index.children.length} map units listed · select one to load its outline.`);
  };
  const loadContinent = async (child: { id: string; name: string; path: string }, epoch: number, signal: AbortSignal): Promise<void> => {
    const activeManifest = manifest;
    if (!activeManifest) throw new Error('Load the country directory first.');
    try {
      status(`Loading ${child.name} country index…`);
      const index = await getNode(child.path, child.id, 'world:earth', activeManifest, signal);
      if (!current(epoch, signal)) return;
      if (index.node.kind !== 'continent') throw new Error('selected world index does not contain a continent');
      const rollup = activeManifest.rollups.find(item => item.id === child.id);
      if (!rollup || index.children.length !== rollup.countryCount || index.children.length !== rollup.sourceUnitCount) throw new Error('continent country links disagree with its manifest rollup');
      showCountries(index, epoch, signal);
    } catch (error) { if (epoch === generation) status(operationError(error, signal)); }
  };
  const chooseCountry = async (child: { id: string; name: string; path: string }, parentId: string): Promise<void> => {
    const { epoch, signal } = operation(); callbacks.selected(); callbacks.clear();
    if (child.id === 'legacy-ng') { status('Nigeria remains on its protected legacy provider; the separate directory contains no Nigeria outline.'); return; }
    const activeManifest = manifest, activeBase = base, activeHash = verifiedManifestHash;
    if (!activeManifest || !activeBase) { status('Load the country directory first.'); return; }
    status(`Verifying ${child.name} country reference…`);
    try {
      const index = await getNode(child.path, child.id, parentId, activeManifest, signal);
      if (!current(epoch, signal)) return;
      if (index.node.kind !== 'country') throw new Error('selected directory entry is not a country');
      if (index.node.countryCode === 'NG' || index.node.provider === 'legacy-ng' || index.node.id === 'legacy-ng') {
        status('Nigeria remains on its protected legacy provider; no outline request was made.'); return;
      }
      if (!index.outlineIndexPath) { status(`${index.node.name} has no available geographic outline in this directory.`); return; }
      status(`Loading ${index.node.name} outline…`);
      const geometry = await fetchCountryOutline(cache, activeBase, activeManifest, index.node, index.outlineIndexPath, signal);
      if (!current(epoch, signal)) return;
      callbacks.draw(geometry, index.node, activeHash);
      status(`${index.node.name} · verified source geometry · geographic outline only, not playable.`);
    } catch (error) { if (epoch === generation) status(operationError(error, signal)); }
  };
  const load = async (): Promise<void> => {
    const { epoch, signal } = operation(); callbacks.clear(); clearList(); callbacks.selected();
    element('countryDirectoryAttribution').textContent = 'Waiting for verified candidate and baseline provenance.';
    clearExceptions();
    status('Verifying country directory…');
    try {
      const hash = inputHash.value.trim().toLowerCase(), url = new URL(inputUrl.value.trim(), location.href);
      if (!/^[a-f0-9]{64}$/.test(hash) || !manifestAsset(url, hash)) throw new Error('Use the exact local immutable country-inventory manifest URL and its matching SHA-256.');
      const fetched = await cache.getJson(url.href, hash, COUNTRY_DIRECTORY_LIMITS.manifestBytes, signal);
      const parsed = validateCountryDirectoryManifest(fetched.value);
      if (!current(epoch, signal)) return;
      manifest = parsed; verifiedManifestHash = hash; base = new URL('/world-output/country-inventory/', location.href);
      const rootHash = parsed.rootNodePath.slice(parsed.rootNodePath.lastIndexOf('/') + 1, -5);
      const identityHash = parsed.identityPath.slice(parsed.identityPath.lastIndexOf('/') + 1, -5);
      const [rootAsset, identityAsset] = await Promise.all([
        cache.getJson(directoryAssetUrl(base, 'nodes', rootHash).href, rootHash, COUNTRY_DIRECTORY_LIMITS.indexBytes, signal),
        cache.getJson(directoryAssetUrl(base, 'identity', identityHash).href, identityHash, COUNTRY_DIRECTORY_LIMITS.identityBytes, signal),
      ]);
      const root = validateCountryDirectoryNodeIndex(rootAsset.value, parsed, 'world:earth', null);
      if (root.node.kind !== 'world') throw new Error('country directory root is not the world node');
      validateCountryDirectoryIdentity(identityAsset.value, parsed);
      const childById = new Map(root.children.map(child => [child.id, child.name]));
      if (childById.size !== parsed.rollups.length || parsed.rollups.some(rollup => childById.get(rollup.id) !== rollup.name)) throw new Error('country directory rollups do not match the root links');
      if (!current(epoch, signal)) return;
      element('countryDirectoryAttribution').textContent = `${parsed.source.attribution} (${parsed.source.license}); baseline: ${parsed.baselineSource.attribution}. Structural checks passed. Spherical validity and political boundary correctness are not established. Not playable.`;
      const disclosure = element<HTMLDetailsElement>('countryDirectoryExceptions');
      disclosure.querySelector('div')!.textContent = parsed.exceptions.join('\n');
      disclosure.hidden = parsed.exceptions.length === 0;
      rootIndex = root;
      showContinents(epoch, signal);
    } catch (error) {
      if (epoch === generation) { manifest = null; verifiedManifestHash = ''; base = null; rootIndex = null; callbacks.clear(); clearList(); clearExceptions(); element('countryDirectoryAttribution').textContent = 'No verified country directory is loaded.'; status(operationError(error, signal)); }
    }
  };
  element<HTMLButtonElement>('loadCountryDirectory').addEventListener('click', () => { void load(); });
  const params = new URLSearchParams(location.search);
  inputUrl.value = params.get('directory') ?? '';
  inputHash.value = params.get('directoryHash') ?? '';
  if (inputUrl.value && inputHash.value) void load();
  return { reset: () => { generation++; controller?.abort(new DOMException('Country directory reset.', 'AbortError')); controller = null; callbacks.clear(); } };
}
