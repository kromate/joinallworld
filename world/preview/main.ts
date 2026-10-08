import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { validateManifest, validateTile } from '../validate.ts';
import { daylightHours, localClock, solarAltitude } from '../conditions.ts';
import { toLocal } from '../geo.ts';
import { WORLD_LIMITS, type WorldManifest, type WorldTile, type TileRef } from '../types.ts';
import { ByteLru } from './cache.ts';
import './style.css';

const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `
  <header class="topbar"><a class="brand" href="#"><span class="brandmark">W</span><span>WORLD<span class="brand-light"> / FOUNDATION</span></span></a><span class="preview-tag"><i></i> INDEPENDENT PREVIEW · NOT PLAYABLE</span></header>
  <main class="layout">
    <section class="viewer-wrap"><div id="viewport" aria-label="Interactive 3D city footprint preview"></div>
      <div class="view-overlay"><div class="eyebrow">GEOGRAPHIC FOOTPRINTS <span class="live-dot"></span></div><div id="sceneTitle" class="scene-title">Awaiting a world pack</div><div id="sceneMeta" class="scene-meta">Enter a manifest URL and its SHA-256 hash.</div></div>
      <div class="compass"><span>N</span><b id="compassArrow">↑</b></div><div class="keyboard-controls" aria-label="Keyboard camera controls"><button data-pan="0,-1" title="Pan north">↑</button><div><button data-pan="-1,0" title="Pan west">←</button><button data-pan="0,1" title="Pan south">↓</button><button data-pan="1,0" title="Pan east">→</button></div></div><div class="controls-hint"><kbd>Drag</kbd> orbit <kbd>Scroll</kbd> zoom <kbd>Arrows</kbd> move</div>
      <div id="progress" class="progress hidden"><span class="spinner"></span><span id="progressText">Fetching manifest…</span></div>
      <div id="empty" class="empty-state"><div class="empty-icon">◈</div><div class="empty-title">A grounded view of the city</div><p>Load a compiled world pack to inspect its sourced building and road geometry.</p></div>
      <div id="error" class="toast hidden" role="alert"></div>
    </section>
    <aside class="sidebar">
      <section class="panel source-panel"><div class="section-head"><span class="section-number">01</span><h2>WORLD PACK</h2></div>
        <label for="manifestUrl">Manifest URL</label><input id="manifestUrl" spellcheck="false" placeholder="/world-output/manifests/&lt;sha256&gt;.json" />
        <label for="manifestHash">Manifest SHA-256</label><input id="manifestHash" spellcheck="false" placeholder="64 character content hash" />
        <button id="loadPack" class="primary">Load verified pack <span>↗</span></button>
        <div id="loadStatus" class="status"><span class="status-dot"></span><span>Waiting for a manifest</span></div>
      </section>
      <section class="panel district-panel"><div class="section-head"><span class="section-number">02</span><h2>DISTRICTS</h2><span id="tileCount" class="count-pill">0</span></div><p class="section-copy">Choose an area to download and inspect. Only the selected tile is drawn.</p><div id="districtList" class="district-list"><div class="placeholder-row">No districts loaded</div></div>
        <div class="pager"><button id="prevTile" aria-label="Previous district" disabled>←</button><span id="pagerText">—</span><button id="nextTile" aria-label="Next district" disabled>→</button></div>
      </section>
      <section class="panel stats-panel"><div class="section-head"><span class="section-number">03</span><h2>VISIBLE FOOTPRINTS</h2></div><div class="stats-grid"><div><strong id="buildingCount">—</strong><span>buildings drawn</span></div><div><strong id="roadCount">—</strong><span>road segments</span></div><div><strong id="triCount">—</strong><span>triangles drawn</span></div><div><strong id="callCount">—</strong><span>render calls</span></div></div><div id="loadBytes" class="data-note">Downloaded: 0 B · Cached: 0 B</div><div id="heightNote" class="height-note">Height provenance appears after loading a district.</div></section>
      <section class="panel time-panel"><div class="section-head"><span class="section-number">04</span><h2>DAYLIGHT PREVIEW</h2></div><label for="clock">Date and time · UTC</label><input id="clock" type="datetime-local" value="2026-10-08T12:00"/><div class="sun-readout"><div><strong id="sunAltitude">—</strong><span>solar altitude</span></div><div><strong id="dayLength">—</strong><span>daylight length</span></div><div class="sun-glyph">☼</div></div><div id="timezoneNote" class="data-note">Sun position is approximate. Timezone is unknown until a source provides one.</div></section>
      <section class="panel provenance-panel"><div class="section-head"><span class="section-number">05</span><h2>SOURCE & COVERAGE</h2></div><div id="coverage" class="coverage-badge">NO PACK</div><div id="provenance" class="provenance"><div class="placeholder-row">Source attribution will appear here.</div></div><div id="climateNote" class="climate-note">Climate: unknown — no sourced profile in this pack.</div></section>
      <footer><span>WGS84 · LOCAL ENU METRES</span><span>◌ PREVIEW TOOLING</span></footer>
    </aside>
  </main>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvasHost = document.querySelector<HTMLDivElement>('#viewport')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(canvasHost.clientWidth, canvasHost.clientHeight);
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('aria-label', '3D district scene. Use arrow keys or camera buttons to move.');
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
canvasHost.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#d9d2c2');
scene.fog = new THREE.Fog('#d9d2c2', 900, 4200);
const camera = new THREE.PerspectiveCamera(42, canvasHost.clientWidth / canvasHost.clientHeight, 0.1, 10000);
camera.position.set(260, 250, 310);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 20;
controls.maxDistance = 2500;

scene.add(new THREE.HemisphereLight('#fff4d7', '#727b83', 2.05));
const sun = new THREE.DirectionalLight('#fff0d4', 3.1);
sun.position.set(-180, 320, 170);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -700; sun.shadow.camera.right = 700; sun.shadow.camera.top = 700; sun.shadow.camera.bottom = -700;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial({ color: '#d8cfbd', roughness: 0.98 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.3;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(1800, 36, '#a99f8f', '#c2b9aa');
grid.position.y = -0.2;
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.32;
scene.add(grid);

let manifest: WorldManifest | null = null;
let selectedIndex = -1;
let activeAbort: AbortController | null = null;
let requestGeneration = 0;
let manifestBaseUrl: URL | null = null;
let loadedBytes = 0;
let activeObjects: THREE.Object3D[] = [];
const cache = new ByteLru<string, { tile: WorldTile; bytes: number }>(WORLD_LIMITS.cacheBytes);

function safeText(node: HTMLElement, value: string) { node.textContent = value; }
function showError(message: string) { const box = $('error'); box.textContent = message; box.classList.remove('hidden'); }
function clearError() { $('error').classList.add('hidden'); }
function progress(message: string | null) { const el = $('progress'); el.classList.toggle('hidden', !message); if (message) safeText($('progressText'), message); }
function bytesLabel(value: number) { return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`; }
function setStatus(message: string, state: 'wait' | 'ok' | 'error' = 'wait') {
  const el = $('loadStatus'); el.className = `status ${state}`; (el.querySelector('span:last-child') as HTMLElement).textContent = message;
}
function updateCacheNote() { safeText($('loadBytes'), `Downloaded: ${bytesLabel(loadedBytes)} · Cached: ${bytesLabel(cache.byteLength)}`); }

function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  for (const geometry of parts) {
    const p = geometry.getAttribute('position');
    const n = geometry.getAttribute('normal');
    const base = positions.length / 3;
    for (let i = 0; i < p.count; i++) { positions.push(p.getX(i), p.getY(i), p.getZ(i)); normals.push(n.getX(i), n.getY(i), n.getZ(i)); }
    const index = geometry.getIndex();
    if (index) for (let i = 0; i < index.count; i++) indices.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) indices.push(base + i);
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  result.setIndex(indices);
  return result;
}

function makeBuildingGeometry(tile: WorldTile, heightScale: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const building of tile.buildings) {
    const exterior = building.rings[0]!;
    const shape = new THREE.Shape();
    exterior.slice(0, -1).forEach((point, i) => {
      const local = toLocal({ longitude: point[0], latitude: point[1], height: tile.anchor.height }, tile.anchor);
      const north = -local.z;
      if (i === 0) shape.moveTo(local.x, north); else shape.lineTo(local.x, north);
    });
    for (const ring of building.rings.slice(1)) {
      const hole = new THREE.Path();
      ring.slice(0, -1).forEach((point, i) => {
        const local = toLocal({ longitude: point[0], latitude: point[1], height: tile.anchor.height }, tile.anchor);
        const north = -local.z;
        if (i === 0) hole.moveTo(local.x, north); else hole.lineTo(local.x, north);
      });
      shape.holes.push(hole);
    }
    const height = Math.max(building.heightM * heightScale, 1.2);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
    // ExtrudeGeometry extrudes on +Z; rotate the plan into the horizontal X/Z plane and stand up on +Y.
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, 0);
    parts.push(geometry);
  }
  if (!parts.length) return new THREE.BufferGeometry();
  const merged = mergeGeometries(parts); parts.forEach(part => part.dispose()); return merged;
}

function makeRoadGeometry(tile: WorldTile): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const road of tile.roads) {
    const points = road.points.map(([longitude, latitude]) => {
      const local = toLocal({ longitude, latitude, height: tile.anchor.height }, tile.anchor);
      return new THREE.Vector3(local.x, 0.12 + road.level * 0.06, local.z);
    });
    const width = road.class.toLowerCase().includes('motorway') || road.class.toLowerCase().includes('primary') ? 4.2 : 1.8;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!, b = points[i + 1]!;
      const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      if (length < 0.05) continue;
      const geometry = new THREE.BoxGeometry(length, 0.12, width);
      geometry.rotateY(-Math.atan2(dz, dx));
      geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      parts.push(geometry);
    }
  }
  if (!parts.length) return new THREE.BufferGeometry();
  const merged = mergeGeometries(parts); parts.forEach(part => part.dispose()); return merged;
}

function triangleCount(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position');
  if (!position) return 0;
  return (geometry.index?.count ?? position.count) / 3;
}

function disposeActive() {
  for (const object of activeObjects) {
    scene.remove(object);
    if (object instanceof THREE.Mesh) { object.geometry.dispose(); if (Array.isArray(object.material)) object.material.forEach(m => m.dispose()); else object.material.dispose(); }
  }
  activeObjects = [];
  document.querySelectorAll('.stats-grid strong').forEach(el => { el.textContent = '—'; });
}

function renderTile(tile: WorldTile, ref: TileRef) {
  disposeActive();
  const buildingGeometry = makeBuildingGeometry(tile, 1);
  const roadGeometry = makeRoadGeometry(tile);
  const buildingTriangles = triangleCount(buildingGeometry);
  const roadTriangles = triangleCount(roadGeometry);
  const cityTriangles = buildingTriangles + roadTriangles;
  const cityCalls = Number(buildingTriangles > 0) + Number(roadTriangles > 0);
  const reservedCalls = cityCalls * 2 + 3; // Color and shadow passes, ground, and grid.
  const reservedTriangles = cityTriangles * 2 + triangleCount(ground.geometry);
  if (reservedTriangles > WORLD_LIMITS.visibleTriangles || reservedCalls > WORLD_LIMITS.visibleDrawCalls) {
    buildingGeometry.dispose(); roadGeometry.dispose();
    throw new Error(`Visible scene exceeds the workload budget (${Math.round(reservedTriangles).toLocaleString()} reserved triangles / ${reservedCalls} reserved calls).`);
  }
  if (buildingTriangles) {
    const mesh = new THREE.Mesh(buildingGeometry, new THREE.MeshStandardMaterial({ color: '#c6a16d', roughness: 0.78, metalness: 0.02 }));
    mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); activeObjects.push(mesh);
  } else buildingGeometry.dispose();
  if (roadTriangles) {
    const mesh = new THREE.Mesh(roadGeometry, new THREE.MeshStandardMaterial({ color: '#918a7d', roughness: 0.96 }));
    mesh.receiveShadow = true; scene.add(mesh); activeObjects.push(mesh);
  } else roadGeometry.dispose();
  const localPoints: THREE.Vector3[] = [];
  for (const building of tile.buildings) for (const ring of building.rings) for (const [longitude, latitude] of ring) {
    const local = toLocal({ longitude, latitude, height: tile.anchor.height }, tile.anchor); localPoints.push(new THREE.Vector3(local.x, 0, local.z));
  }
  for (const road of tile.roads) for (const [longitude, latitude] of road.points) {
    const local = toLocal({ longitude, latitude, height: tile.anchor.height }, tile.anchor); localPoints.push(new THREE.Vector3(local.x, 0, local.z));
  }
  let center = new THREE.Vector3();
  let extent = 100;
  if (localPoints.length) {
    const bounds = new THREE.Box3().setFromPoints(localPoints);
    center = bounds.getCenter(new THREE.Vector3());
    extent = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, 40);
  }
  controls.target.copy(center);
  camera.position.set(center.x + extent * 0.68, center.y + extent * 0.72, center.z + extent * 0.88);
  controls.minDistance = Math.max(12, extent * 0.06);
  controls.maxDistance = Math.max(500, extent * 6);
  controls.update();
  document.querySelectorAll('.stats-grid strong')[0]!.textContent = tile.buildings.length.toLocaleString();
  document.querySelectorAll('.stats-grid strong')[1]!.textContent = tile.roads.reduce((sum, road) => sum + road.points.length - 1, 0).toLocaleString();
  document.querySelectorAll('.stats-grid strong')[2]!.textContent = '…';
  document.querySelectorAll('.stats-grid strong')[3]!.textContent = '…';
  const sourceHeight = tile.buildings.filter(b => b.heightKind === 'source').length;
  const estimated = tile.buildings.length - sourceHeight;
  safeText($('heightNote'), `${sourceHeight.toLocaleString()} sourced heights · ${estimated.toLocaleString()} estimated heights · ground elevation unavailable`);
  $('empty').classList.add('hidden');
  safeText($('sceneTitle'), `${manifest?.region.name ?? 'Unknown region'} · ${tile.id}`);
  safeText(document.querySelector('.scene-meta') as HTMLElement, `${tile.buildings.length.toLocaleString()} buildings · ${tile.roads.length.toLocaleString()} roads · source-aligned footprint geometry`);
  updateSun();
}

function updateSun() {
  if (!manifest) return;
  const input = $('clock') as HTMLInputElement;
  if (!input.value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.value)) { safeText($('timezoneNote'), 'Enter a valid UTC date and time.'); return; }
  const [date, time] = input.value.split('T');
  const [year, month, day] = date!.split('-').map(Number);
  const [hour, minute] = time!.split(':').map(Number);
  const epoch = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const { latitude, longitude } = { latitude: (manifest.region.bounds[1] + manifest.region.bounds[3]) / 2, longitude: (manifest.region.bounds[0] + manifest.region.bounds[2]) / 2 };
  const altitude = solarAltitude(epoch, latitude, longitude);
  const daylight = daylightHours(epoch, latitude);
  safeText(document.querySelector('.sun-readout strong') as HTMLElement, `${altitude.toFixed(1)}°`);
  document.querySelectorAll('.sun-readout strong')[1]!.textContent = `${daylight.toFixed(1)} h`;
  const elevation = Math.max(0.18, Math.sin(Math.max(-5, altitude) * Math.PI / 180));
  sun.intensity = altitude < -6 ? 0.48 : 0.8 + elevation * 2.8;
  sun.position.set(-180, Math.max(20, 320 * elevation), 170);
  renderer.toneMappingExposure = altitude < -6 ? 0.65 : 1.18;
  const zone = manifest.region.timezone;
  const regionTime = zone ? localClock(epoch, zone) : null;
  safeText($('timezoneNote'), regionTime
    ? `Approximate sun · ${zone} local time ${String(regionTime.hour).padStart(2, '0')}:${String(regionTime.minute).padStart(2, '0')} on ${regionTime.year}-${String(regionTime.month).padStart(2, '0')}-${String(regionTime.day).padStart(2, '0')}`
    : 'Approximate sun · timezone unknown; entered instant is UTC');
}

function renderManifestInfo(value: WorldManifest, hash: string) {
  safeText(document.querySelector('.scene-title') as HTMLElement, value.region.name);
  safeText(document.querySelector('.scene-meta') as HTMLElement, `${value.region.kind.toUpperCase()} · ${value.coverage.toUpperCase()} COVERAGE · manifest ${hash.slice(0, 12)}…`);
  $('coverage').className = `coverage-badge ${value.coverage}`;
  $('coverage').textContent = `${value.coverage.toUpperCase()} COVERAGE`;
  $('provenance').innerHTML = value.sources.map(source => {
    let safeUrl: string | null = null;
    try { const parsed = new URL(source.url); if (parsed.protocol === 'http:' || parsed.protocol === 'https:') safeUrl = parsed.href; } catch { /* Invalid source links are shown as text only. */ }
    return `<article class="source-item"><strong>${escapeHtml(source.attribution)}</strong><span>${escapeHtml(source.release)} · ${escapeHtml(source.license)}</span>${safeUrl ? `<a href="${escapeAttribute(safeUrl)}" target="_blank" rel="noreferrer">View source ↗</a>` : ''}<code>${source.sha256.slice(0, 16)}…</code></article>`;
  }).join('') || '<div class="placeholder-row">No source records in this pack.</div>';
  $('climateNote').textContent = value.climate ? `Climate: sourced profile · ${value.climate.period} · source ${value.climate.sourceId}` : 'Climate: unknown — no sourced profile in this pack.';
  const timezone = value.region.timezone;
  $('timezoneNote').textContent = timezone ? `Timezone: ${timezone}` : 'Timezone is unknown in this pack.';
  $('tileCount').textContent = String(value.tiles.length);
  const exceptions = value.exceptions.length
    ? `<details class="exception-note"><summary>Coverage exceptions · ${value.exceptions.length}</summary>${value.exceptions.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</details>`
    : '';
  $('provenance').insertAdjacentHTML('beforeend', exceptions);
}

function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
function escapeAttribute(value: string) { return escapeHtml(value); }

function clearPackUi() {
  disposeActive(); cache.clear(); manifest = null; manifestBaseUrl = null; selectedIndex = -1; loadedBytes = 0;
  updateCacheNote();
  $('districtList').innerHTML = '<div class="placeholder-row">No districts loaded</div>';
  $('tileCount').textContent = '0'; $('pagerText').textContent = '—';
  ($('prevTile') as HTMLButtonElement).disabled = true; ($('nextTile') as HTMLButtonElement).disabled = true;
  $('coverage').className = 'coverage-badge'; $('coverage').textContent = 'NO PACK';
  $('provenance').innerHTML = '<div class="placeholder-row">Source attribution will appear here.</div>';
  $('climateNote').textContent = 'Climate: unknown — no sourced profile in this pack.';
  $('timezoneNote').textContent = 'Sun position is approximate. Timezone is unknown until a source provides one.';
  $('sunAltitude').textContent = '—'; $('dayLength').textContent = '—';
  $('heightNote').textContent = 'Height provenance appears after loading a district.';
  $('sceneTitle').textContent = 'Awaiting a world pack';
  $('sceneMeta').textContent = 'Enter a manifest URL and its SHA-256 hash.';
  $('empty').classList.remove('hidden');
}

function isRequestReplaced(controller: AbortController, generation: number) {
  return generation !== requestGeneration || controller.signal.aborted;
}

function checkRequest(controller: AbortController, generation: number, signal: AbortSignal) {
  if (isRequestReplaced(controller, generation)) return false;
  if (signal.aborted) throw new Error('Request timed out after 25 seconds. Check the local pack and try again.');
  return true;
}

function shareableManifestQuery(pathname: string, hash: string) {
  const match = /^\/world-output\/manifests\/([a-f0-9]{64})\.json$/.exec(pathname);
  return match && match[1] === hash ? pathname : null;
}

function updateShareableUrl(manifestUrl: URL, hash: string) {
  const page = new URL(location.href);
  const pathname = manifestUrl.origin === location.origin ? shareableManifestQuery(manifestUrl.pathname, hash) : null;
  if (pathname) { page.searchParams.set('manifest', pathname); page.searchParams.set('hash', hash); }
  else { page.searchParams.delete('manifest'); page.searchParams.delete('hash'); }
  history.replaceState(history.state, '', page);
}

async function loadManifest() {
  const generation = ++requestGeneration;
  activeAbort?.abort();
  const controller = new AbortController(); activeAbort = controller;
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]);
  clearError(); clearPackUi();
  progress('Verifying manifest…'); setStatus('Fetching manifest…');
  try {
    const url = ($('manifestUrl') as HTMLInputElement).value.trim();
    const expected = ($('manifestHash') as HTMLInputElement).value.trim().toLowerCase();
    if (!url) throw new Error('Enter a manifest URL.');
    if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('Enter the manifest SHA-256 hash from the build output.');
    const resolvedManifestUrl = new URL(url, location.href);
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Manifest request failed (${response.status}).`);
    const bytes = await readBounded(response, 2_000_000);
    if (!checkRequest(controller, generation, signal)) return;
    loadedBytes += bytes.byteLength; updateCacheNote();
    const actual = await digest(bytes);
    if (!checkRequest(controller, generation, signal)) return;
    if (actual !== expected) throw new Error('Manifest SHA-256 does not match the supplied build hash.');
    const validated = validateManifest(JSON.parse(new TextDecoder().decode(bytes)));
    if (!checkRequest(controller, generation, signal)) return;
    manifestBaseUrl = resolvedManifestUrl;
    manifest = validated;
    updateShareableUrl(resolvedManifestUrl, actual);
    $('districtList').innerHTML = '';
    validated.tiles.forEach((ref, index) => {
      const button = document.createElement('button'); button.className = 'district-row';
      button.innerHTML = `<span class="district-marker">${String(index + 1).padStart(2, '0')}</span><span class="district-info"><strong>${escapeHtml(ref.id)}</strong><small>${(ref.triangles / 1000).toFixed(1)}k triangles · ${bytesLabel(ref.bytes)}</small></span><span class="district-arrow">↗</span>`;
      button.addEventListener('click', () => selectTile(index)); $('districtList').appendChild(button);
    });
    renderManifestInfo(validated, actual);
    progress(null); setStatus(`Verified · ${actual.slice(0, 12)}…`, 'ok');
    ($('prevTile') as HTMLButtonElement).disabled = validated.tiles.length === 0;
    const buttons = document.querySelectorAll<HTMLButtonElement>('.district-row');
    buttons.forEach(button => { button.disabled = false; });
    if (validated.tiles.length) await selectTile(0);
  } catch (error) {
    if (isRequestReplaced(controller, generation)) return;
    manifestBaseUrl = null;
    progress(null); setStatus('Could not load pack', 'error');
    showError(signal.aborted ? 'Request timed out after 25 seconds. Check the local pack and try again.' : error instanceof Error ? error.message : String(error));
  }
}

async function selectTile(index: number) {
  if (!manifest || index < 0 || index >= manifest.tiles.length) return;
  const generation = ++requestGeneration;
  selectedIndex = index;
  activeAbort?.abort(); const controller = new AbortController(); activeAbort = controller;
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]), ref = manifest.tiles[index]!;
  document.querySelectorAll('.district-row').forEach((el, i) => el.classList.toggle('selected', i === index));
  $('pagerText').textContent = `${index + 1} / ${manifest!.tiles.length}`;
  ($('prevTile') as HTMLButtonElement).disabled = index === 0;
  ($('nextTile') as HTMLButtonElement).disabled = index === manifest!.tiles.length - 1;
  clearError();
  const pinnedBase = manifestBaseUrl;
  if (!pinnedBase) { showError('Verified manifest URL is unavailable; reload the pack.'); return; }
  const tileUrl = new URL(`../${ref.path}`, pinnedBase.href.endsWith('/') ? pinnedBase : new URL('.', pinnedBase));
  const key = `${manifest.tiles[index]!.sha256}`;
  const cached = cache.get(key);
  if (cached) { try { renderTile(cached.tile, ref); progress(null); $('pagerText').textContent = `${index + 1} / ${manifest.tiles.length}`; } catch (e) { progress(null); showError(String(e)); } return; }
  if (ref.bytes > 10_000_000) { showError(`Tile ${ref.id} exceeds the raw download safety limit.`); return; }
  progress(`Downloading district ${index + 1} of ${manifest.tiles.length}…`);
  $('pagerText').textContent = `Loading ${ref.id}…`;
  try {
    const response = await fetch(tileUrl, { signal });
    if (!response.ok) throw new Error(`District request failed (${response.status}).`);
    const bytes = await readBounded(response, Math.min(ref.bytes, 10_000_000));
    if (!checkRequest(controller, generation, signal)) return;
    loadedBytes += bytes.byteLength; updateCacheNote();
    if (bytes.byteLength !== ref.bytes) throw new Error(`Tile byte size mismatch for ${ref.id}.`);
    if (await digest(bytes) !== ref.sha256) throw new Error(`Tile SHA-256 mismatch for ${ref.id}.`);
    if (!checkRequest(controller, generation, signal)) return;
    const tile = validateTile(JSON.parse(new TextDecoder().decode(bytes)));
    if (tile.id !== ref.id) throw new Error('Tile identity does not match the selected manifest reference.');
    if (tile.regionId !== manifest.region.id) throw new Error('Tile region identity does not match the selected manifest.');
    const sourceIds = new Set(manifest.sources.map(source => source.id));
    if (tile.buildings.some(building => !sourceIds.has(building.sourceId)) || tile.roads.some(road => !sourceIds.has(road.sourceId))) throw new Error('Tile geometry references an unknown source ID.');
    if (ref.triangles > WORLD_LIMITS.tileTriangles || ref.drawCalls > WORLD_LIMITS.visibleDrawCalls) throw new Error('Manifest-declared tile workload exceeds the tile safety limit.');
    if (!checkRequest(controller, generation, signal)) return;
    cache.set(key, { tile, bytes: bytes.byteLength }, bytes.byteLength);
    renderTile(tile, ref);
    progress(null); updateCacheNote();
    $('pagerText').textContent = `${index + 1} / ${manifest!.tiles.length}`;
  } catch (error) {
    if (isRequestReplaced(controller, generation)) return;
    progress(null); $('pagerText').textContent = `${index + 1} / ${manifest!.tiles.length}`;
    showError(signal.aborted ? 'District request timed out after 25 seconds. Try loading the district again.' : error instanceof Error ? error.message : String(error));
  }
}

async function digest(bytes: Uint8Array) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }

async function readBounded(response: Response, limit: number): Promise<Uint8Array> {
  const advertised = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > limit) throw new Error(`Response exceeds the ${bytesLabel(limit)} size limit.`);
  if (!response.body) throw new Error('Response has no readable body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw new Error(`Response exceeds the ${bytesLabel(limit)} size limit.`); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

document.querySelector('#loadPack')!.addEventListener('click', () => void loadManifest());
document.querySelector('#prevTile')!.addEventListener('click', () => void selectTile(selectedIndex - 1));
document.querySelector('#nextTile')!.addEventListener('click', () => void selectTile(selectedIndex + 1));
document.querySelector('#clock')!.addEventListener('input', updateSun);
document.querySelector('#manifestUrl')!.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Enter') void loadManifest(); });
document.querySelector('#manifestHash')!.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Enter') void loadManifest(); });
function panCamera(dx: number, dz: number) {
  const step = Math.max(8, camera.position.distanceTo(controls.target) * 0.075);
  const delta = new THREE.Vector3(dx * step, 0, dz * step);
  camera.position.add(delta); controls.target.add(delta); controls.update();
}
document.querySelectorAll<HTMLButtonElement>('.keyboard-controls button').forEach(button => {
  button.addEventListener('click', () => { const [x, z] = button.dataset.pan!.split(',').map(Number); panCamera(x!, z!); });
});
window.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement | null)?.tagName ?? '')) return;
  const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault(); panCamera(direction[0], direction[1]);
});
const initialQuery = new URLSearchParams(location.search);
const queriedManifest = initialQuery.get('manifest');
const queriedHash = initialQuery.get('hash')?.toLowerCase() ?? '';
if (queriedManifest && /^[a-f0-9]{64}$/.test(queriedHash) && shareableManifestQuery(queriedManifest, queriedHash)) {
  ($('manifestUrl') as HTMLInputElement).value = queriedManifest;
  ($('manifestHash') as HTMLInputElement).value = queriedHash;
  void loadManifest();
}
new ResizeObserver(() => { const width = canvasHost.clientWidth, height = canvasHost.clientHeight; renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); }).observe(canvasHost);
function animate() {
  requestAnimationFrame(animate); controls.update(); updateCompass(); renderer.render(scene, camera);
  if (!activeObjects.length) return;
  const triangles = renderer.info.render.triangles;
  const calls = renderer.info.render.calls;
  document.querySelectorAll('.stats-grid strong')[2]!.textContent = triangles.toLocaleString();
  document.querySelectorAll('.stats-grid strong')[3]!.textContent = String(calls);
  if (triangles > WORLD_LIMITS.visibleTriangles || calls > WORLD_LIMITS.visibleDrawCalls) {
    disposeActive(); showError(`Rendered scene reached ${triangles.toLocaleString()} triangles / ${calls} calls, above the visible safety limit.`);
  }
}

function updateCompass() {
  const northInView = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion.clone().invert());
  const angle = Math.atan2(northInView.x, northInView.y) * 180 / Math.PI;
  $('compassArrow').style.transform = `rotate(${angle}deg)`;
}
animate();
