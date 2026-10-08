import { SETTLEMENT_PREVIEW_LIMITS } from './settlement-client-types.ts';
import type { SettlementBinding, SettlementClientOptions, SettlementReaderSnapshot, SettlementReadResult, SettlementPanelOptions } from './settlement-client-types.ts';
import type { SettlementPointRecord } from '../settlement-product-types.ts';
import { SettlementReader } from './settlement-reader.ts';

const HASH = /^[a-f0-9]{64}$/;
const PAGE_SIZE = SETTLEMENT_PREVIEW_LIMITS.pageRows;
function bindingKey(value: SettlementBinding | null): string | null {
  if (!value) return null;
  const source = value.parentSource;
  return JSON.stringify([value.countryId, value.countryName, value.provider, value.parentManifestHash,
    source.id, source.url, source.release, source.license, source.attribution, source.sha256, source.bytes]);
}
function labelBytes(value: number): string { return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KiB`; }
function sortedRows(rows: readonly SettlementPointRecord[]): SettlementPointRecord[] {
  return [...rows].sort((a, b) => a.scaleRank - b.scaleRank || (a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0));
}

/** A bounded selected-country point browser. It never treats points as settlement completeness or playability. */
export function attachSettlementPanel(options: SettlementPanelOptions): { reset: () => void } {
  const host = options.host;
  host.innerHTML = `<div class="section-head"><span class="section-number">PLACES</span><h2>SELECTED PLACE REFERENCES</h2></div>
    <p class="section-copy">Selected city and town reference points only. This is not a complete settlement or house dataset, does not prove Admin1 containment, and does not identify playable destinations.</p>
    <label for="settlementUrl">Selected-place manifest URL</label><input id="settlementUrl" spellcheck="false" placeholder="/world-output/selected-places/manifests/&lt;hash&gt;.json"/>
    <label for="settlementHash">Manifest SHA-256</label><input id="settlementHash" spellcheck="false" placeholder="64 character content hash"/>
    <button id="loadSettlements" class="secondary" type="button">Load selected places <span>↗</span></button>
    <div id="settlementStatus" class="inventory-selection" aria-live="polite">Select a country, then load its selected-place references.</div>
    <div id="settlementMetrics" class="inventory-note" data-downloaded-bytes="0" data-cached-bytes="0" data-request-starts="0" data-inflight-requests="0" data-queued-requests="0">Decoded body bytes: 0 B · Cached bytes: 0 B · Requests: 0 · Active: 0 · Queued: 0</div>
    <div id="settlementSource" class="inventory-note">No verified selected-place source is loaded.</div>
    <label for="settlementSearch">Search this country's downloaded points</label><input id="settlementSearch" type="search" autocomplete="off" placeholder="Name or source key" disabled/>
    <div id="settlementOverview" class="inventory-note"><button type="button" class="secondary" disabled>Show country overview</button></div>
    <div id="settlementSelected" class="inventory-selection" aria-live="polite">No point selected.</div>
    <div id="settlementList" class="inventory-list"></div>
    <div class="settlement-paging"><button id="settlementPrevious" class="secondary" type="button" disabled>Previous</button><span id="settlementPage" class="inventory-note">Page 0 of 0</span><button id="settlementNext" class="secondary" type="button" disabled>Next</button></div>`;
  const el = <T extends HTMLElement>(id: string): T => {
    const found = host.querySelector<T>(`#${id}`);
    if (!found) throw new Error(`Settlement panel is missing #${id}`);
    return found;
  };
  const urlInput = el<HTMLInputElement>('settlementUrl');
  const hashInput = el<HTMLInputElement>('settlementHash');
  const statusElement = el<HTMLElement>('settlementStatus');
  const setStatus = (message: string): void => { statusElement.textContent = message; };
  const sourceText = el<HTMLElement>('settlementSource');
  const searchInput = el<HTMLInputElement>('settlementSearch');
  const list = el<HTMLElement>('settlementList');
  const selected = el<HTMLElement>('settlementSelected');
  const pageLabel = el<HTMLElement>('settlementPage');
  const metrics = el<HTMLElement>('settlementMetrics');
  const overviewButton = el<HTMLElement>('settlementOverview').querySelector<HTMLButtonElement>('button')!;
  let priorDownloaded = 0;
  const renderMetrics = (snapshot: SettlementReaderSnapshot): void => {
    metrics.dataset.downloadedBytes = String(snapshot.downloadedBytes);
    metrics.dataset.cachedBytes = String(snapshot.cacheBytes);
    metrics.dataset.requestStarts = String(snapshot.requestStarts);
    metrics.dataset.inflightRequests = String(snapshot.inflightRequests);
    metrics.dataset.queuedRequests = String(snapshot.queuedRequests);
    metrics.textContent = `Decoded body bytes: ${labelBytes(snapshot.downloadedBytes)} · Cached bytes: ${labelBytes(snapshot.cacheBytes)} · Requests: ${snapshot.requestStarts} · Active: ${snapshot.inflightRequests} · Queued: ${snapshot.queuedRequests}`;
    const delta = Math.max(0, snapshot.downloadedBytes - priorDownloaded);
    priorDownloaded = Math.max(priorDownloaded, snapshot.downloadedBytes);
    if (delta > 0) { try { options.downloaded(delta); } catch { /* UI observers cannot disrupt reader accounting. */ } }
  };
  const readerOptions: SettlementClientOptions = { origin: location.origin, changed: renderMetrics };
  const reader = new SettlementReader(readerOptions);
  renderMetrics(reader.snapshot);

  let generation = 0;
  let controller: AbortController | null = null;
  let result: SettlementReadResult | null = null;
  let rows: SettlementPointRecord[] = [];
  let page = 0;
  let activeBindingKey: string | null = null;
  const abortCurrent = (reason: string): void => {
    controller?.abort(new DOMException(reason, 'AbortError'));
    controller = null;
  };
  const clearPresentation = (): void => {
    result = null; rows = []; page = 0; activeBindingKey = null;
    list.replaceChildren(); selected.textContent = 'No point selected.';
    sourceText.textContent = 'No verified selected-place source is loaded.';
    searchInput.value = '';
    searchInput.disabled = true; overviewButton.disabled = true;
    pageLabel.textContent = 'Page 0 of 0';
    el<HTMLButtonElement>('settlementPrevious').disabled = true;
    el<HTMLButtonElement>('settlementNext').disabled = true;
    options.clear();
  };
  const current = (epoch: number, key: string, signal: AbortSignal): boolean => epoch === generation && !signal.aborted && bindingKey(options.binding()) === key;
  const ownsSelection = (epoch: number, key: string): boolean => epoch === generation && bindingKey(options.binding()) === key;
  const sortedName = (point: SettlementPointRecord): string => `${point.name} ${point.nameAscii} ${point.sourceKey}`.toLocaleLowerCase();
  const filteredRows = (): SettlementPointRecord[] => {
    const query = searchInput.value.trim().toLocaleLowerCase();
    const available = query ? rows.filter(point => sortedName(point).includes(query)) : rows;
    return sortedRows(available);
  };
  const showPoint = (point: SettlementPointRecord): void => {
    selected.replaceChildren();
    const title = document.createElement('strong'); title.textContent = point.name;
    const details = document.createElement('span'); details.textContent = `${point.id} · ${point.sourceKey} · ${point.coordinates[0]}, ${point.coordinates[1]}`;
    selected.append(title, document.createElement('br'), details);
    options.focus(point);
  };
  const renderPage = (): void => {
    list.replaceChildren();
    const matches = filteredRows(), pageCount = matches.length === 0 ? 0 : Math.ceil(matches.length / PAGE_SIZE);
    if (pageCount === 0) page = 0; else page = Math.max(0, Math.min(page, pageCount - 1));
    const begin = page * PAGE_SIZE;
    for (const point of matches.slice(begin, begin + PAGE_SIZE)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'district-row inventory-country';
      const marker = document.createElement('span'); marker.className = 'district-marker'; marker.textContent = '◎';
      const info = document.createElement('span'); info.className = 'district-info';
      const name = document.createElement('strong'); name.textContent = point.name;
      const detail = document.createElement('small'); detail.textContent = `${point.sourceClass} · scale rank ${point.scaleRank} · ${point.sourceKey}`;
      info.append(name, detail); const arrow = document.createElement('span'); arrow.className = 'district-arrow'; arrow.textContent = '›';
      button.append(marker, info, arrow); button.addEventListener('click', () => showPoint(point)); list.append(button);
    }
    pageLabel.textContent = pageCount ? `Page ${page + 1} of ${pageCount} · ${matches.length} matching points` : 'Page 0 of 0 · no matching points';
    el<HTMLButtonElement>('settlementPrevious').disabled = page <= 0;
    el<HTMLButtonElement>('settlementNext').disabled = pageCount === 0 || page >= pageCount - 1;
  };
  const displayAvailable = (read: SettlementReadResult, binding: SettlementBinding): void => {
    result = read;
    const manifest = read.manifest, country = read.country, points = read.points;
    if (!manifest || !country || country.status !== 'available' || !points) throw new Error('selected-place result is missing its verified country points');
    rows = sortedRows(points.rows);
    activeBindingKey = bindingKey(binding);
    searchInput.disabled = false; overviewButton.disabled = false;
    sourceText.textContent = `${manifest.source.attribution} (${manifest.source.license}; release ${manifest.source.release}). Parent source: ${manifest.parent.source.attribution} (${manifest.parent.source.license}; release ${manifest.parent.source.release}). ${country.sourceUnits} source rows; ${country.emittedUnits} emitted selected points; ${manifest.exceptionUnits} source exceptions; ${manifest.invalidRows} invalid source rows; ${manifest.unlinked} unlinked; ${manifest.ambiguous} ambiguous. Selected points are references only, not complete settlement coverage or playable destinations.`;
    setStatus(`${binding.countryName} · ${rows.length} selected reference points verified for this country.`);
    renderPage();
    options.draw(read);
  };
  const load = async (): Promise<void> => {
    options.activate();
    abortCurrent('A newer selected-place request superseded this one.');
    const epoch = ++generation;
    clearPresentation();
    setStatus('Verifying selected-place manifest and country points…');
    const binding = options.binding();
    const key = bindingKey(binding);
    if (!binding || key === null || !HASH.test(binding.parentManifestHash) || !binding.countryId || !binding.countryName) {
      setStatus('Select a verified country directory entry before loading selected places.'); return;
    }
    if ((binding.countryId === 'legacy-ng') !== (binding.provider === 'legacy-ng')) {
      setStatus('Country provider identity is inconsistent; no selected-place request was made.'); return;
    }
    if (binding.countryId === 'legacy-ng' && binding.provider === 'legacy-ng') {
      sourceText.textContent = 'Protected Nigeria legacy provider. No selected-place request was made.';
      setStatus('Nigeria remains on the protected legacy provider; no network request was made.'); return;
    }
    const aborter = new AbortController(); controller = aborter;
    const signal = AbortSignal.any([aborter.signal, AbortSignal.timeout(SETTLEMENT_PREVIEW_LIMITS.requestMs)]);
    const activeUrl = urlInput.value.trim(), activeHash = hashInput.value.trim().toLowerCase();
    try {
      if (!activeUrl || !HASH.test(activeHash)) throw new Error('Enter the exact local selected-place manifest URL and its 64-character SHA-256.');
      const read = await reader.load(activeUrl, activeHash, binding, signal);
      if (!current(epoch, key, signal)) return;
      if (read.status === 'protected') throw new Error('Protected country returned from an unexpected provider path; no points were loaded.');
      if (read.status === 'missing') {
        if (!read.manifest || !read.country || read.country.status !== 'missing') throw new Error('missing selected-place result lacks its verified manifest country reference');
        result = read; activeBindingKey = key;
        sourceText.textContent = `${read.manifest.source.attribution} (${read.manifest.source.license}; release ${read.manifest.source.release}). Parent source: ${read.manifest.parent.source.attribution} (${read.manifest.parent.source.license}; release ${read.manifest.parent.source.release}). ${read.country.sourceUnits} source rows; ${read.manifest.exceptionUnits} source exceptions; ${read.manifest.invalidRows} invalid source rows; ${read.manifest.unlinked} unlinked; ${read.manifest.ambiguous} ambiguous. This country has no emitted selected-place points in the pinned source. This is an explicit source gap, not proof that the country has no settlements.`;
        setStatus(`${binding.countryName} · no selected-place point asset is available.`);
        options.draw(read);
        return;
      }
      displayAvailable(read, binding);
    } catch (error) {
      if (!ownsSelection(epoch, key)) return;
      clearPresentation();
      const message = signal.aborted ? (signal.reason?.name === 'TimeoutError' ? 'Selected-place request timed out. You can retry.' : 'Selected-place request was cancelled.') : error instanceof Error ? error.message : String(error);
      setStatus(message.slice(0, 500));
    } finally { if (controller === aborter) controller = null; }
  };
  el<HTMLButtonElement>('loadSettlements').addEventListener('click', () => { void load(); });
  searchInput.addEventListener('input', () => { page = 0; renderPage(); });
  el<HTMLButtonElement>('settlementPrevious').addEventListener('click', () => { page--; renderPage(); });
  el<HTMLButtonElement>('settlementNext').addEventListener('click', () => { page++; renderPage(); });
  el<HTMLButtonElement>('settlementOverview').addEventListener('click', () => {
    if (!overviewButton.disabled && result && activeBindingKey !== null && bindingKey(options.binding()) === activeBindingKey) options.draw(result);
  });
  const initialHash = new URLSearchParams(location.search).get('settlementHash');
  const initialUrl = new URLSearchParams(location.search).get('settlement');
  if (initialHash && initialUrl) { urlInput.value = initialUrl; hashInput.value = initialHash; }
  return { reset: () => {
    abortCurrent('Selected-place panel reset.'); generation++;
    clearPresentation();
    setStatus('Select a country, then load its selected-place references.');
    renderMetrics(reader.snapshot);
  } };
}
