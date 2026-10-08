import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { validateManifest, validateTile } from '../validate.ts';
import { daylightHours, localClock, solarAltitude } from '../conditions.ts';
import { boundsCenter, fromLocal, toLocal } from '../geo.ts';
import { WORLD_LIMITS, type Anchor, type WorldManifest, type WorldTile, type TileRef } from '../types.ts';
import { ByteLru } from './cache.ts';
import { createDemandFrames } from './frame.ts';
import { selectVisibleTiles, TileStreamScheduler } from './streaming.ts';
import type { StreamingSnapshot } from './streaming.ts';
import { geographicCircleBounds, groundFootprintRadius } from './view-bounds.ts';
import { fetchInventoryAsset, inventoryGeometryPath, INVENTORY_LIMITS, validateInventoryGeometry, validateInventoryIndex, validateInventoryManifest, type InventoryGeometry, type InventoryManifest, type InventoryNodeIndex } from './inventory-view.ts';
import { attachFinePanel } from './fine-panel.ts';
import { attachCountryDirectoryPanel } from './country-directory-panel.ts';
import { attachAdmin1Panel } from './admin1-panel.ts';
import { admin1AtlasFrame } from './admin1-framing.ts';
import './style.css';

const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `
  <header class="topbar"><a class="brand" href="#"><span class="brandmark">W</span><span>WORLD<span class="brand-light"> / FOUNDATION</span></span></a><span class="preview-tag"><i></i> INDEPENDENT PREVIEW · NOT PLAYABLE</span></header>
  <main class="layout">
    <section class="viewer-wrap"><div id="viewport" aria-label="Interactive 3D city footprint preview"></div>
      <div id="outlineView" class="outline-view hidden" aria-label="Sourced geographic outline map"><svg id="outlineSvg" viewBox="0 0 720 360" role="img" aria-label="Selected country outline on a world map"><path id="outlinePath" d="" fill-rule="evenodd"/><path id="outlineStroke" d="" fill="none"/></svg><div class="outline-caption"><strong id="outlineName">Country outline</strong><span id="outlineDetails">Geographic boundary only · not playable</span></div></div>
      <div class="view-tabs" role="group" aria-label="Preview view"><button id="show3d" aria-pressed="true">3D pack</button><button id="show2d" aria-pressed="false" disabled>2D outline</button></div>
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
      <section class="panel inventory-panel"><div class="section-head"><span class="section-number">02</span><h2>WORLD INVENTORY</h2></div>
        <label for="inventoryUrl">Inventory manifest URL</label><input id="inventoryUrl" spellcheck="false" placeholder="/world-output/inventory/manifests/&lt;sha256&gt;.json" />
        <label for="inventoryHash">Inventory SHA-256</label><input id="inventoryHash" spellcheck="false" placeholder="64 character content hash" />
        <button id="loadInventory" class="secondary">Load geographic inventory <span>↗</span></button>
        <div id="inventoryStatus" class="status"><span class="status-dot"></span><span>Waiting for a pinned inventory</span></div>
        <label for="continentSelect">Continent · loaded on selection</label><select id="continentSelect" disabled><option value="">Load an inventory first</option></select>
        <div id="countryList" class="inventory-list"><div class="placeholder-row">Country indexes load after selecting a continent.</div></div>
        <div class="inventory-coverage"><strong id="inventoryCount">—</strong><span>source units in this Natural Earth release</span></div>
        <div class="inventory-note">Geographic outlines only · climate, terrain and playability unknown. 1:110m source coverage omits some microstates and small territories.</div>
        <div id="inventorySelection" class="inventory-selection" aria-live="polite">No country selected.</div>
        <div id="finePanel"></div>
      </section>
      <section class="panel" id="countryDirectoryPanel"></section>
      <section class="panel" id="admin1Panel"></section>
      <section class="panel district-panel"><div class="section-head"><span class="section-number">03</span><h2>NEARBY VIEW</h2><span id="tileCount" class="count-pill">0</span></div><p class="section-copy">Preview only · not playable. Nearby tiles stream as you move the camera; choose a district to focus it.</p><div id="districtList" class="district-list"><div class="placeholder-row">No districts loaded</div></div>
        <div class="pager"><button id="prevTile" aria-label="Previous district" disabled>←</button><span id="pagerText">—</span><button id="nextTile" aria-label="Next district" disabled>→</button></div>
        <div id="streamingSummary" class="data-note" aria-live="polite">Loaded 0 · pending 0 · deferred 0 · over budget 0 · failed 0 · outside view 0</div><div id="streamingDetails" class="data-note">Nearby streamed geometry is a non-playable preview.</div><button id="retryTiles" class="secondary" type="button" disabled>Retry failed tiles</button>
      </section>
      <section class="panel stats-panel"><div class="section-head"><span class="section-number">04</span><h2>VISIBLE FOOTPRINTS</h2></div><div class="stats-grid"><div><strong id="buildingCount">—</strong><span>buildings drawn</span></div><div><strong id="roadCount">—</strong><span>road segments</span></div><div><strong id="triCount">—</strong><span>triangles drawn</span></div><div><strong id="callCount">—</strong><span>render calls</span></div></div><div id="loadBytes" class="data-note">Downloaded: 0 B · Cached: 0 B</div><div id="heightNote" class="height-note">Height provenance appears after loading a district.</div><div id="frameNote" class="data-note">Demand rendering · waiting for a frame</div></section>
      <section class="panel time-panel"><div class="section-head"><span class="section-number">05</span><h2>DAYLIGHT PREVIEW</h2></div><label for="clock">Date and time · UTC</label><input id="clock" type="datetime-local" value="2026-10-08T12:00"/><div class="sun-readout"><div><strong id="sunAltitude">—</strong><span>solar altitude</span></div><div><strong id="dayLength">—</strong><span>daylight length</span></div><div class="sun-glyph">☼</div></div><div id="timezoneNote" class="data-note">Sun position is approximate. Timezone is unknown until a source provides one.</div></section>
      <section class="panel provenance-panel"><div class="section-head"><span class="section-number">06</span><h2>SOURCE & COVERAGE</h2></div><div id="coverage" class="coverage-badge">NO PACK</div><div id="provenance" class="provenance"><div class="placeholder-row">Source attribution will appear here.</div></div><div id="climateNote" class="climate-note">Climate: unknown — no sourced profile in this pack.</div></section>
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
let manifestIdentity = '';
let packOrigin: Anchor | null = null;
let loadedBytes = 0;
let activeObjects: THREE.Object3D[] = [];
interface RenderedTile {
  objects: THREE.Object3D[]; buildingTriangles: number; roadTriangles: number; calls: number; residentBytes: number;
  buildings: number; roadSegments: number; sourcedHeights: number; estimatedHeights: number;
}
const activeRenders = new Map<string, RenderedTile>();
let lastPlanSignature = '';
let suppressControlPlan = false;
let demandFrames: ReturnType<typeof createDemandFrames> | undefined;
let drawnFrames = 0;
function invalidate() { demandFrames?.invalidate(); }
let tileStream: TileStreamScheduler<WorldTile, RenderedTile> | null = null;
let inventoryManifest: InventoryManifest | null = null;
let inventoryManifestHash = '';
let inventoryBaseUrl: URL | null = null;
let inventoryRootIndex: InventoryNodeIndex | null = null;
let selectedContinentIndex: InventoryNodeIndex | null = null;
let selectedCountryIndex: InventoryNodeIndex | null = null;
let inventoryAbort: AbortController | null = null;
let inventoryGeneration = 0;
let inventoryDownloadedBytes = 0;
const inventoryCache = new ByteLru<string, { value: InventoryManifest|InventoryNodeIndex|InventoryGeometry; bytes:number }>(INVENTORY_LIMITS.cacheBytes);
let directoryPanel: { reset: () => void } | undefined;
let admin1Panel: { reset: () => void } | undefined;
let selectingDirectory = false;
let selectedDirectoryBinding: { country: InventoryNodeIndex['node']; coarseHash: string } | null = null;
const finePanel = attachFinePanel({
 host: $('finePanel'),
 binding: () => selectedDirectoryBinding ?? (selectedCountryIndex && inventoryManifest ? {country: selectedCountryIndex.node, coarseHash: inventoryManifestHash} : null),
 downloaded: bytes => {inventoryDownloadedBytes += bytes; updateCacheNote();},
 clear: () => { admin1Panel?.reset(); if(!selectingDirectory && !selectedDirectoryBinding)directoryPanel?.reset(); clearOutline('Choose a verified administrative division.'); },
 draw: (geometry, node) => {
  if(!selectedDirectoryBinding)directoryPanel?.reset();
  const [w,s,east,n] = node.bounds, wraps = w > east, e = wraps ? east + 360 : east;
  $('outlinePath').setAttribute('d', inventoryGeometryPath(geometry,720,360,false,wraps));
  $('outlineStroke').setAttribute('d', inventoryGeometryPath(geometry,720,360,true,wraps));
  const width = Math.max((e-w)*2,(n-s)*4,0.6)*1.2, height=width/2,cx=w+e+360,cy=180-s-n;
  $('outlineSvg').setAttribute('viewBox',`${cx-width/2} ${cy-height/2} ${width} ${height}`);
  $('outlineSvg').setAttribute('aria-label', `${node.name} sourced administrative outline`);
  $('outlineName').textContent = node.name;
  $('outlineDetails').textContent = `${node.adminType} · ${node.adminLevel} · geographic outline only · not playable`;
  setView('outline');
 }
});
admin1Panel = attachAdmin1Panel({
 host: $('admin1Panel'), binding: () => selectedDirectoryBinding,
 activate: () => { finePanel.reset(); },
 clear: () => { clearOutline('Choose a verified geographic source feature.'); },
 downloaded: bytes => { inventoryDownloadedBytes += bytes; updateCacheNote(); },
 draw: (feature, row) => {
  const geometry = validateInventoryGeometry(feature.geometry), frame = admin1AtlasFrame(geometry);
  $('outlinePath').setAttribute('d', inventoryGeometryPath(geometry,720,360,false,frame.wraps,5));
  $('outlineStroke').setAttribute('d', inventoryGeometryPath(geometry,720,360,true,frame.wraps,5));
  $('outlineSvg').setAttribute('viewBox',frame.viewBox);
  $('outlineSvg').setAttribute('aria-label',`${row.name ?? row.sourceKey} sourced geographic outline`);
  $('outlineName').textContent = row.name ?? row.sourceKey;
  $('outlineDetails').textContent = `${row.sourceTypeEn ?? row.sourceType ?? 'Type unknown'} · source level ${row.gadmLevel ?? 'unknown'} · structural checks only · topology unverified · not playable`;
  ($('show2d') as HTMLButtonElement).disabled = false; setView('outline');
 }
});
directoryPanel = attachCountryDirectoryPanel($('countryDirectoryPanel'), {
 selected: () => {
  selectedDirectoryBinding = null;
  inventoryAbort?.abort(); ++inventoryGeneration; selectedCountryIndex = null;
  selectingDirectory = true;
  try { finePanel.reset(); } finally { selectingDirectory = false; }
  clearError();
 },
 clear: () => { selectedDirectoryBinding = null; clearOutline('Choose a verified country outline.'); },
 draw: (geometry, node, manifestHash) => {
  selectedDirectoryBinding = { country: node, coarseHash: manifestHash };
  const wraps = !!node.bounds && node.bounds[0] > node.bounds[2];
  $('outlinePath').setAttribute('d', inventoryGeometryPath(geometry,720,360,false,wraps,5));
  $('outlineStroke').setAttribute('d', inventoryGeometryPath(geometry,720,360,true,wraps,5));
  if (node.bounds) {
   const [w,s,rawEast,n] = node.bounds, east = wraps ? rawEast + 360 : rawEast;
   const width = Math.max((east-w)*2,(n-s)*4,0.02)*1.2, height = width/2, cx = w+east+360, cy = 180-s-n;
   $('outlineSvg').setAttribute('viewBox',`${cx-width/2} ${cy-height/2} ${width} ${height}`);
  } else $('outlineSvg').setAttribute('viewBox','0 0 720 360');
  $('outlineSvg').setAttribute('aria-label',`${node.name} sourced country outline`);
  $('outlineName').textContent = node.name;
  $('outlineDetails').textContent = 'Geographic outline only · conditions and playability are separate layers';
  ($('show2d') as HTMLButtonElement).disabled = false;
  setView('outline');
 }
});

function safeText(node: HTMLElement, value: string) { node.textContent = value; }
function showError(message: string) { const box = $('error'); box.textContent = message; box.classList.remove('hidden'); }
function clearError() { $('error').classList.add('hidden'); }
function progress(message: string | null) { const el = $('progress'); el.classList.toggle('hidden', !message); if (message) safeText($('progressText'), message); }
function bytesLabel(value: number) { return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`; }
function setStatus(message: string, state: 'wait' | 'ok' | 'error' = 'wait') {
  const el = $('loadStatus'); el.className = `status ${state}`; (el.querySelector('span:last-child') as HTMLElement).textContent = message;
}
function updateCacheNote() { safeText($('loadBytes'), `Downloaded: ${bytesLabel(loadedBytes+inventoryDownloadedBytes)} · Tile cache limit: 50 MB / 512 entries · Inventory cache: ${bytesLabel(inventoryCache.byteLength)}`); }

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
  const origin = packOrigin;
  if (!origin) throw new Error('Pack ENU origin is unavailable.');
  const parts: THREE.BufferGeometry[] = [];
  for (const building of tile.buildings) {
    const exterior = building.rings[0]!;
    const shape = new THREE.Shape();
    let baseElevation = 0;
    exterior.slice(0, -1).forEach((point, i) => {
      const local = toLocal({ longitude: point[0], latitude: point[1], height: tile.anchor.height }, origin);
      baseElevation += local.y / Math.max(1, exterior.length - 1);
      const north = -local.z;
      if (i === 0) shape.moveTo(local.x, north); else shape.lineTo(local.x, north);
    });
    for (const ring of building.rings.slice(1)) {
      const hole = new THREE.Path();
      ring.slice(0, -1).forEach((point, i) => {
        const local = toLocal({ longitude: point[0], latitude: point[1], height: tile.anchor.height }, origin);
        const north = -local.z;
        if (i === 0) hole.moveTo(local.x, north); else hole.lineTo(local.x, north);
      });
      shape.holes.push(hole);
    }
    const height = Math.max(building.heightM * heightScale, 1.2);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
    // ExtrudeGeometry extrudes on +Z; rotate the plan into the horizontal X/Z plane and stand up on +Y.
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, baseElevation, 0);
    parts.push(geometry);
  }
  if (!parts.length) return new THREE.BufferGeometry();
  const merged = mergeGeometries(parts); parts.forEach(part => part.dispose()); return merged;
}

function makeRoadGeometry(tile: WorldTile): THREE.BufferGeometry {
  const origin = packOrigin;
  if (!origin) throw new Error('Pack ENU origin is unavailable.');
  const parts: THREE.BufferGeometry[] = [];
  for (const road of tile.roads) {
    const points = road.points.map(([longitude, latitude]) => {
      const local = toLocal({ longitude, latitude, height: tile.anchor.height }, origin);
      return new THREE.Vector3(local.x, local.y + 0.12 + road.level * 0.06, local.z);
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

function geometryBytes(geometry: THREE.BufferGeometry) {
  let bytes = 0;
  for (const attribute of Object.values(geometry.attributes)) bytes += attribute.array.byteLength;
  if (geometry.index) bytes += geometry.index.array.byteLength;
  return bytes;
}

function disposeRendered(rendered: RenderedTile, ref: TileRef) {
  for (const object of rendered.objects) {
    scene.remove(object);
    if (object instanceof THREE.Mesh) { object.geometry.dispose(); if (Array.isArray(object.material)) object.material.forEach(m => m.dispose()); else object.material.dispose(); }
  }
  activeRenders.delete(ref.id);
  activeObjects = [...activeRenders.values()].flatMap(value => value.objects);
  refreshVisibleStats();
  invalidate();
}

function fixedSceneTriangles() { return triangleCount(ground.geometry); }
function actualSceneTotals(candidate?: RenderedTile) {
  const tiles = [...activeRenders.values(), ...(candidate ? [candidate] : [])];
  return {
    triangles: fixedSceneTriangles() + tiles.reduce((sum, tile) => sum + tile.buildingTriangles * 2 + tile.roadTriangles, 0),
    calls: 2 + tiles.reduce((sum, tile) => sum + tile.calls, 0),
    residentBytes: tiles.reduce((sum, tile) => sum + tile.residentBytes, 0),
  };
}

function refreshVisibleStats() {
  const tiles = [...activeRenders.values()];
  if (manifest) {
    safeText($('sceneTitle'), `${manifest.region.name} · nearby view`);
    safeText($('sceneMeta'), `${tiles.length} nearby tile${tiles.length === 1 ? '' : 's'} · source-aligned footprint geometry · preview only`);
  }
  $('buildingCount').textContent = tiles.reduce((sum, tile) => sum + tile.buildings, 0).toLocaleString();
  $('roadCount').textContent = tiles.reduce((sum, tile) => sum + tile.roadSegments, 0).toLocaleString();
  const totals = actualSceneTotals();
  $('triCount').textContent = totals.triangles.toLocaleString();
  $('callCount').textContent = String(totals.calls);
  const source = tiles.reduce((sum, tile) => sum + tile.sourcedHeights, 0);
  const estimated = tiles.reduce((sum, tile) => sum + tile.estimatedHeights, 0);
  safeText($('heightNote'), tiles.length ? `${source.toLocaleString()} sourced heights · ${estimated.toLocaleString()} estimated heights · ground elevation unavailable` : 'Height provenance appears after loading a nearby tile.');
}

function activateRenderedTile(tile: WorldTile, ref: TileRef): RenderedTile {
  if (!packOrigin) throw new Error('Pack ENU origin is unavailable.');
  const buildingGeometry = makeBuildingGeometry(tile, 1);
  const roadGeometry = makeRoadGeometry(tile);
  const buildingTriangles = triangleCount(buildingGeometry);
  const roadTriangles = triangleCount(roadGeometry);
  const calls = (buildingTriangles > 0 ? 2 : 0) + (roadTriangles > 0 ? 1 : 0); // Building color + shadow, road color.
  const typedArrayBytes = geometryBytes(buildingGeometry) + geometryBytes(roadGeometry);
  const record: RenderedTile = {
    objects: [], buildingTriangles, roadTriangles, calls,
    // Account for parsed payload storage plus CPU and GPU copies of the merged typed arrays.
    residentBytes: ref.bytes * 8 + typedArrayBytes * 2,
    buildings: tile.buildings.length,
    roadSegments: tile.roads.reduce((sum, road) => sum + Math.max(0, road.points.length - 1), 0),
    sourcedHeights: tile.buildings.filter(building => building.heightKind === 'source').length,
    estimatedHeights: tile.buildings.filter(building => building.heightKind === 'estimated').length,
  };
  const totals = actualSceneTotals(record);
  if (totals.triangles > WORLD_LIMITS.visibleTriangles || totals.calls > WORLD_LIMITS.visibleDrawCalls || totals.residentBytes > WORLD_LIMITS.cacheBytes) {
    buildingGeometry.dispose(); roadGeometry.dispose();
    throw new Error(`Tile ${ref.id} exceeds active preview limits (${Math.round(totals.triangles).toLocaleString()} rendered triangles / ${totals.calls} calls / ${bytesLabel(totals.residentBytes)} estimated active memory).`);
  }
  try {
    if (buildingTriangles) {
      const mesh = new THREE.Mesh(buildingGeometry, new THREE.MeshStandardMaterial({ color: '#c6a16d', roughness: 0.78, metalness: 0.02 }));
      mesh.castShadow = true; mesh.receiveShadow = true; record.objects.push(mesh);
    } else buildingGeometry.dispose();
    if (roadTriangles) {
      const mesh = new THREE.Mesh(roadGeometry, new THREE.MeshStandardMaterial({ color: '#918a7d', roughness: 0.96 }));
      mesh.receiveShadow = true; record.objects.push(mesh);
    } else roadGeometry.dispose();
    record.objects.forEach(object => scene.add(object));
  } catch (error) {
    for (const object of record.objects) {
      if (object instanceof THREE.Mesh) { object.geometry.dispose(); object.material.dispose(); }
    }
    buildingGeometry.dispose(); roadGeometry.dispose();
    throw error;
  }
  activeRenders.set(ref.id, record);
  activeObjects = [...activeRenders.values()].flatMap(value => value.objects);
  refreshVisibleStats();
  $('empty').classList.add('hidden');
  safeText($('sceneTitle'), `${manifest?.region.name ?? 'Unknown region'} · nearby view`);
  safeText(document.querySelector('.scene-meta') as HTMLElement, `${activeRenders.size} nearby tile${activeRenders.size === 1 ? '' : 's'} · source-aligned footprint geometry · preview only`);
  invalidate();
  return record;
}

function updateSun() {
  if (!manifest) return;
  const input = $('clock') as HTMLInputElement;
  if (!input.value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.value)) { safeText($('timezoneNote'), 'Enter a valid UTC date and time.'); return; }
  const [date, time] = input.value.split('T');
  const [year, month, day] = date!.split('-').map(Number);
  const [hour, minute] = time!.split(':').map(Number);
  const epoch = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const [longitude, latitude] = boundsCenter(manifest.region.bounds);
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
  invalidate();
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
  manifestIdentity = '';
  tileStream?.setManifest(null);
  activeRenders.clear(); activeObjects = [];
  manifest = null; manifestBaseUrl = null; packOrigin = null; selectedIndex = -1; loadedBytes = 0; lastPlanSignature = '';
  refreshVisibleStats();
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
  $('streamingSummary').textContent = 'Loaded 0 · pending 0 · deferred 0 · over budget 0 · failed 0 · outside view 0';
  $('streamingDetails').textContent = 'Nearby streamed geometry is a non-playable preview.';
  ($('retryTiles') as HTMLButtonElement).disabled = true;
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
  const match = /^\/world-output\/(?:campaigns\/[a-z0-9][a-z0-9-]{0,79}\/)?manifests\/([a-f0-9]{64})\.json$/.exec(pathname);
  return match && match[1] === hash ? pathname : null;
}

function setInventoryStatus(message:string,state:'wait'|'ok'|'error'='wait') { const el=$('inventoryStatus');el.className=`status ${state}`;(el.querySelector('span:last-child') as HTMLElement).textContent=message; }
function inventoryIsCurrent(controller:AbortController,generation:number){return generation===inventoryGeneration&&!controller.signal.aborted;}
function inventoryUrl(path:string){if(!inventoryBaseUrl)throw new Error('Verified inventory URL is unavailable; reload it.');return new URL(path,inventoryBaseUrl).href;}
function inventoryAssetHash(path:string,folder:'nodes'|'outlines') { const match=new RegExp(`^${folder}/([a-f0-9]{64})\\.json$`).exec(path);if(!match)throw new Error('Inventory contains an unsafe asset path.');return match[1]!; }

async function getInventoryIndex(path:string,expectedId:string,controller:AbortController,generation:number,signal:AbortSignal,expectedParentId?:string|null):Promise<InventoryNodeIndex>{
 const key=`${inventoryManifestHash}:${path}`,cached=inventoryCache.get(key);if(cached)return validateInventoryIndex(cached.value,expectedId,expectedParentId);
 const fetched=await fetchInventoryAsset(inventoryUrl(path),inventoryAssetHash(path,'nodes'),INVENTORY_LIMITS.indexBytes,signal,value=>validateInventoryIndex(value,expectedId,expectedParentId));
 if(!inventoryIsCurrent(controller,generation))throw new DOMException('Selection changed','AbortError');inventoryDownloadedBytes+=fetched.bytes;inventoryCache.set(key,{value:fetched.value,bytes:fetched.bytes},fetched.bytes);updateCacheNote();return fetched.value;
}
async function getInventoryOutline(path:string,controller:AbortController,generation:number,signal:AbortSignal):Promise<InventoryGeometry>{
 const key=`${inventoryManifestHash}:${path}`,cached=inventoryCache.get(key);if(cached)return cached.value as InventoryGeometry;
 const fetched=await fetchInventoryAsset(inventoryUrl(path),inventoryAssetHash(path,'outlines'),INVENTORY_LIMITS.outlineBytes,signal,validateInventoryGeometry);
 if(!inventoryIsCurrent(controller,generation))throw new DOMException('Selection changed','AbortError');inventoryDownloadedBytes+=fetched.bytes;inventoryCache.set(key,{value:fetched.value,bytes:fetched.bytes},fetched.bytes);updateCacheNote();return fetched.value;
}
function setView(mode:'pack'|'outline'){
 const outline=mode==='outline';$('viewport').classList.toggle('hidden',outline);$('outlineView').classList.toggle('hidden',!outline);($('show3d') as HTMLButtonElement).setAttribute('aria-pressed',String(!outline));($('show2d') as HTMLButtonElement).setAttribute('aria-pressed',String(outline));
 const viewer=document.querySelector<HTMLElement>('.viewer-wrap')!;viewer.dataset.view=mode;
 invalidate();
}
function renderCountryList(index:InventoryNodeIndex){
 const list=$('countryList');list.innerHTML='';
 if(!index.children.length){list.innerHTML='<div class="placeholder-row">No source country units in this continent.</div>';return;}
 index.children.forEach((child,i)=>{const button=document.createElement('button');button.className='district-row inventory-country';button.type='button';button.innerHTML=`<span class="district-marker">${String(i+1).padStart(2,'0')}</span><span class="district-info"><strong>${escapeHtml(child.id==='legacy-ng'?'Nigeria · protected legacy':child.name??child.id.split('%3A').at(-1)??child.id)}</strong><small>${child.id==='legacy-ng'?'Existing Nigeria map remains protected':'Geographic outline · load on selection'}</small></span><span class="district-arrow">↗</span>`;button.addEventListener('click',()=>void selectInventoryCountry(child));list.appendChild(button);});
}
function clearOutline(message:string){$('outlinePath').setAttribute('d','');$('outlineStroke').setAttribute('d','');$('outlineSvg').setAttribute('aria-label','Country geographic outline');$('outlineName').textContent='Country outline';$('outlineDetails').textContent=message;}
async function selectInventoryCountry(child:{id:string;path:string}){
 directoryPanel?.reset();
 selectedCountryIndex=null;finePanel.reset();clearError();
 const generation=++inventoryGeneration;inventoryAbort?.abort();const controller=new AbortController();inventoryAbort=controller;const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(25_000)]);setInventoryStatus('Loading selected country…');clearOutline('Fetching only this country’s outline.');
 try{
  const index=await getInventoryIndex(child.path,child.id,controller,generation,signal,selectedContinentIndex?.node.id);if(!inventoryIsCurrent(controller,generation))return;
  const node=index.node;$('inventorySelection').textContent=`${node.name} · ${node.countryCode??'country code unknown'} · ${node.sourceFeatureIds.length?node.sourceFeatureIds[0]:'protected legacy provider'}`;$('outlineName').textContent=node.name;
  if(node.provider==='legacy-ng'||node.id==='legacy-ng'){
   clearOutline('Protected legacy Nigeria provider · no world inventory geometry · not playable through this browser.');$('outlineName').textContent='Nigeria · protected legacy';setInventoryStatus('Nigeria remains with the legacy provider', 'ok');setView('outline');return;
  }
  if(!index.outlinePath||node.outline!=='available'){clearOutline('No outline is available in this source release.');setInventoryStatus('Outline unavailable for this source unit','error');setView('outline');return;}
  const geometry=await getInventoryOutline(index.outlinePath,controller,generation,signal);if(!inventoryIsCurrent(controller,generation))return;
  selectedCountryIndex=index;
  $('outlineSvg').setAttribute('aria-label',`${node.name} sourced country outline`);
  const wraps=!!node.bounds&&node.bounds[0]>node.bounds[2];
  const d=inventoryGeometryPath(geometry,720,360,false,wraps);$('outlinePath').setAttribute('d',d);$('outlineStroke').setAttribute('d',inventoryGeometryPath(geometry,720,360,true,wraps));
  if(node.bounds){const[w,s,rawEast,n]=node.bounds,e=wraps?rawEast+360:rawEast,width=Math.max((e-w)*2,(n-s)*4,8)*1.2,height=width/2,cx=w+e+360,cy=180-s-n;$('outlineSvg').setAttribute('viewBox',`${cx-width/2} ${cy-height/2} ${width} ${height}`);}else $('outlineSvg').setAttribute('viewBox','0 0 720 360');
  $('outlineDetails').textContent=`${node.sourceFeatureIds.length} source feature${node.sourceFeatureIds.length===1?'':'s'} · geographic outline only · climate, terrain and playability unknown`;
  setInventoryStatus(`${node.name} outline verified · ${bytesLabel(inventoryCache.byteLength)} cached`,'ok');setView('outline');
 }catch(error){if(!inventoryIsCurrent(controller,generation))return;setInventoryStatus('Could not load selected source unit','error');$('inventorySelection').textContent=signal.aborted?'Country request timed out. Select it again.':error instanceof Error?error.message:String(error);showError(signal.aborted?'Country outline request timed out after 25 seconds.':error instanceof Error?error.message:String(error));}
}
async function selectInventoryContinent(id:string){
 directoryPanel?.reset();
 const child=inventoryRootIndex?.children.find(item=>item.id===id);if(!child)return;
 selectedCountryIndex=null;finePanel.reset();
 const generation=++inventoryGeneration;inventoryAbort?.abort();const controller=new AbortController();inventoryAbort=controller;const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(25_000)]);selectedContinentIndex=null;$('inventorySelection').textContent='Select a country in this continent.';clearError();$('countryList').innerHTML='<div class="placeholder-row">Loading country index…</div>';clearOutline('Choose a country to fetch its outline.');setInventoryStatus('Loading continent index…');
 try{const index=await getInventoryIndex(child.path,child.id,controller,generation,signal,'world:earth');if(!inventoryIsCurrent(controller,generation))return;selectedContinentIndex=index;renderCountryList(index);setInventoryStatus(`${index.children.length} source units · ${index.node.name}`,'ok');}
 catch(error){if(!inventoryIsCurrent(controller,generation))return;setInventoryStatus('Could not load continent index','error');$('countryList').innerHTML=`<div class="placeholder-row">${escapeHtml(error instanceof Error?error.message:String(error))}</div>`;}
}

async function loadInventory(){
 directoryPanel?.reset();
 selectedCountryIndex=null;finePanel.reset();
 const generation=++inventoryGeneration;inventoryAbort?.abort();const controller=new AbortController();inventoryAbort=controller;const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(25_000)]);clearError();setInventoryStatus('Fetching inventory manifest…');
 try{
  const url=($('inventoryUrl') as HTMLInputElement).value.trim(),expected=($('inventoryHash') as HTMLInputElement).value.trim().toLowerCase();if(!url)throw new Error('Enter an inventory manifest URL.');if(!/^[a-f0-9]{64}$/.test(expected))throw new Error('Enter the inventory manifest SHA-256 hash.');
  const resolved=new URL(url,location.href);const result=await fetchInventoryAsset(resolved.href,expected,INVENTORY_LIMITS.manifestBytes,signal,validateInventoryManifest);if(!inventoryIsCurrent(controller,generation))return;
  inventoryDownloadedBytes+=result.bytes;inventoryManifest=result.value;inventoryManifestHash=expected;inventoryBaseUrl=new URL('../',resolved);updateCacheNote();
  const rootPath=inventoryManifest.rootNodePath;const root=await getInventoryIndex(rootPath,'world:earth',controller,generation,signal,null);if(!inventoryIsCurrent(controller,generation))return;inventoryRootIndex=root;
  const select=$('continentSelect') as HTMLSelectElement;select.innerHTML='<option value="">Choose a continent</option>';const rollups=new Map(inventoryManifest.rollups.map(r=>[r.id,r]));
  for(const child of root.children){const option=document.createElement('option');option.value=child.id;const rollup=rollups.get(child.id);option.textContent=`${rollup?.name??child.id} · ${rollup?.sourceUnitCount??'—'} source units`;select.appendChild(option);}
  select.disabled=false;($('show2d') as HTMLButtonElement).disabled=false;$('inventoryCount').textContent=inventoryManifest.sourceUnitCount.toLocaleString();$('inventorySelection').textContent='Select a continent, then a country. Country outlines are fetched on demand.';$('countryList').innerHTML='<div class="placeholder-row">Choose a continent to fetch its country index.</div>';
  setInventoryStatus(`Verified · ${inventoryManifest.sourceUnitCount} source units · ${inventoryManifest.sources[0]?.release??'unknown release'}`,'ok');updateInventoryUrl(resolved,expected);
 }catch(error){if(!inventoryIsCurrent(controller,generation))return;inventoryManifest=null;inventoryRootIndex=null;inventoryBaseUrl=null;selectedContinentIndex=null;($('continentSelect') as HTMLSelectElement).disabled=true;($('show2d') as HTMLButtonElement).disabled=true;$('countryList').innerHTML='<div class="placeholder-row">Load a verified inventory to select a country.</div>';clearOutline('No verified inventory is loaded.');setInventoryStatus('Could not load inventory','error');showError(signal.aborted?'Inventory request timed out after 25 seconds.':error instanceof Error?error.message:String(error));}
}
function updateInventoryUrl(url:URL,hash:string){const page=new URL(location.href);const match=/^\/world-output\/inventory\/manifests\/([a-f0-9]{64})\.json$/.exec(url.pathname);if(url.origin===location.origin&&match?.[1]===hash){page.searchParams.set('inventory',url.pathname);page.searchParams.set('inventoryHash',hash);}else{page.searchParams.delete('inventory');page.searchParams.delete('inventoryHash');}history.replaceState(history.state,'',page);}

function updateShareableUrl(manifestUrl: URL, hash: string) {
  const page = new URL(location.href);
  const pathname = manifestUrl.origin === location.origin ? shareableManifestQuery(manifestUrl.pathname, hash) : null;
  if (pathname) { page.searchParams.set('manifest', pathname); page.searchParams.set('hash', hash); }
  else { page.searchParams.delete('manifest'); page.searchParams.delete('hash'); }
  history.replaceState(history.state, '', page);
}

function renderStreamingStatus(snapshot: StreamingSnapshot<RenderedTile>) {
  const deferred = snapshot.deferred.length;
  const overbudget = snapshot.overbudget.length;
  const failed = snapshot.failed.length;
  safeText($('streamingSummary'), `Loaded ${snapshot.active.length} · pending ${snapshot.pendingIds.length} · deferred ${deferred} · over budget ${overbudget} · failed ${failed} · outside view ${snapshot.outsideView.length}`);
  const notes = [
    ...snapshot.deferred.map(item => `${item.ref.id}: deferred (${item.reason})`),
    ...snapshot.overbudget.map(item => `${item.ref.id}: over budget (${item.reason})`),
    ...snapshot.failed.map(item => `${item.id}: failed (${item.message})`),
  ];
  safeText($('streamingDetails'), `${notes.length ? notes.join(' · ') : 'Nearby streamed geometry is a non-playable preview.'} · view radius capped at 5 km`);
  ($('retryTiles') as HTMLButtonElement).disabled = failed === 0;
  document.querySelectorAll<HTMLButtonElement>('#districtList .district-row').forEach(button => {
    const id = button.dataset.tileId;
    const loaded = snapshot.active.some(item => item.ref.id === id);
    const pending = snapshot.pendingIds.includes(id ?? '');
    const error = snapshot.failed.some(item => item.id === id);
    const suffix = loaded ? ' · loaded' : pending ? ' · loading' : error ? ' · failed' : '';
    const small = button.querySelector('small');
    if (small) small.textContent = `${small.dataset.baseLabel ?? small.textContent?.replace(/ · (loaded|loading|failed)$/, '') ?? ''}${suffix}`;
  });
  $('empty').classList.toggle('hidden', snapshot.active.length > 0 || snapshot.pendingIds.length > 0);
}

function createTileStream() {
  // Reuse the scheduler across packs: aborted old requests retain their slots
  // until they settle, and all manifest-scoped cache entries share one cap.
  if (tileStream) return;
  tileStream = new TileStreamScheduler<WorldTile, RenderedTile>({
    maxConcurrent: 2,
    maxCacheEntries: 512,
    maxCacheBytes: 50_000_000,
    load: async (ref, context, requestSignal) => {
      const base = manifestBaseUrl;
      if (!base || context.manifestIdentity !== manifestIdentity || !manifest) throw new Error('Tile request no longer belongs to the verified manifest.');
      if (ref.bytes > 10_000_000) throw new Error(`Tile ${ref.id} exceeds the raw download safety limit.`);
      const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(25_000)]);
      const tileUrl = new URL(`../${ref.path}`, base.href.endsWith('/') ? base : new URL('.', base));
      const response = await fetch(tileUrl, { signal });
      if (!response.ok) throw new Error(`Tile request failed (${response.status}).`);
      const bytes = await readBounded(response, Math.min(ref.bytes, 10_000_000));
      if (signal.aborted || context.manifestIdentity !== manifestIdentity) throw new DOMException('Tile request was replaced or timed out.', 'AbortError');
      loadedBytes += bytes.byteLength; updateCacheNote();
      if (bytes.byteLength !== ref.bytes) throw new Error(`Tile byte size mismatch for ${ref.id}.`);
      if (await digest(bytes) !== ref.sha256) throw new Error(`Tile SHA-256 mismatch for ${ref.id}.`);
      if (signal.aborted || context.manifestIdentity !== manifestIdentity) throw new DOMException('Tile request was replaced or timed out.', 'AbortError');
      const tile = validateTile(JSON.parse(new TextDecoder().decode(bytes)));
      if (tile.id !== ref.id) throw new Error('Tile identity does not match the selected manifest reference.');
      if (tile.regionId !== context.regionId) throw new Error('Tile region identity does not match the pinned manifest.');
      if (tile.buildings.some(building => !context.sourceIds.has(building.sourceId)) || tile.roads.some(road => !context.sourceIds.has(road.sourceId))) throw new Error('Tile geometry references an unknown source ID.');
      if (ref.triangles > WORLD_LIMITS.tileTriangles || ref.drawCalls > WORLD_LIMITS.visibleDrawCalls) throw new Error('Manifest-declared tile workload exceeds the tile safety limit.');
      if (signal.aborted || context.manifestIdentity !== manifestIdentity) throw new DOMException('Tile request was replaced or timed out.', 'AbortError');
      return { manifestIdentity: context.manifestIdentity, regionId: context.regionId, tileId: tile.id, sha256: ref.sha256, cacheBytes: bytes.byteLength * 8, payload: tile };
    },
    activate: activateRenderedTile,
    disposeActive: disposeRendered,
    onChange: renderStreamingStatus,
  });
}

function planNearbyTiles() {
  if (!manifest || !packOrigin || !tileStream) return;
  const localFocus = { x: controls.target.x, y: 0, z: controls.target.z };
  const worldFocus = fromLocal(localFocus, packOrigin);
  const focus: [number, number] = [worldFocus.longitude, worldFocus.latitude];
  camera.updateMatrixWorld();
  const cornerDirections = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, y]) => new THREE.Vector3(x!, y!, 0.5).unproject(camera).sub(camera.position).normalize());
  const radius = groundFootprintRadius(camera.position, controls.target, cornerDirections);
  const view = geographicCircleBounds(focus, Math.max(1, radius));
  const selection = selectVisibleTiles(manifest.tiles, view.bounds, focus, {
    maxTriangles: 90_000 - fixedSceneTriangles(),
    maxDrawCalls: 40 - 2, // Ground and grid are fixed scene calls.
    maxResidentBytes: 50_000_000,
    maxTiles: 8,
    shadowOverhead: { triangles: 0, drawCalls: 0 },
    renderCost: ref => ({
      triangles: ref.triangles * 2,
      drawCalls: 3,
      residentBytes: 8 * ref.bytes + 192 * ref.triangles,
    }),
  });
  const signature = [
    selection.selected.map(ref => ref.id).join(','),
    selection.deferred.map(item => `${item.ref.id}:${item.reason}`).join(','),
    selection.overbudget.map(item => `${item.ref.id}:${item.reason}`).join(','),
    selection.outsideView.map(ref => ref.id).join(','),
  ].join('|');
  if (signature === lastPlanSignature) return;
  lastPlanSignature = signature;
  tileStream.setSelection(selection);
  if (view.limited) $('streamingDetails').textContent += ' · camera footprint capped at 5 km';
}

function focusTile(index: number) {
  if (!manifest || !packOrigin || index < 0 || index >= manifest.tiles.length) return;
  selectedIndex = index;
  const ref = manifest.tiles[index]!;
  const center = boundsCenter(ref.bounds);
  const target = toLocal({ longitude: center[0], latitude: center[1], height: 0 }, packOrigin);
  const [west, south, east, north] = ref.bounds;
  const corners: [number, number][] = [[west, south], [west, north], [east, south], [east, north]];
  const locals = corners.map(([longitude, latitude]) => toLocal({ longitude, latitude, height: 0 }, packOrigin!));
  const extent = Math.max(Math.max(...locals.map(point => point.x)) - Math.min(...locals.map(point => point.x)), Math.max(...locals.map(point => point.z)) - Math.min(...locals.map(point => point.z)), 40);
  const distance = Math.max(40, extent * 1.65);
  document.querySelectorAll<HTMLButtonElement>('#districtList .district-row').forEach((button, i) => button.classList.toggle('selected', i === index));
  $('pagerText').textContent = `${index + 1} / ${manifest.tiles.length}`;
  ($('prevTile') as HTMLButtonElement).disabled = index === 0;
  ($('nextTile') as HTMLButtonElement).disabled = index === manifest.tiles.length - 1;
  suppressControlPlan = true;
  controls.target.set(target.x, target.y, target.z);
  camera.position.set(target.x + distance * 0.62, target.y + distance * 0.76, target.z + distance * 0.92);
  controls.minDistance = Math.max(12, extent * 0.06);
  controls.maxDistance = Math.max(500, extent * 6);
  controls.update();
  suppressControlPlan = false;
  planNearbyTiles();
  invalidate();
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
    manifestIdentity = actual;
    const originCenter = boundsCenter(validated.region.bounds);
    packOrigin = { longitude: originCenter[0], latitude: originCenter[1], height: 0 };
    createTileStream();
    tileStream!.setManifest({ identity: actual, value: validated });
    updateShareableUrl(resolvedManifestUrl, actual);
    $('districtList').innerHTML = '';
    validated.tiles.forEach((ref, index) => {
      const button = document.createElement('button'); button.className = 'district-row';
      button.dataset.tileId = ref.id;
      button.innerHTML = `<span class="district-marker">${String(index + 1).padStart(2, '0')}</span><span class="district-info"><strong>${escapeHtml(ref.id)}</strong><small data-base-label="${escapeAttribute(`${(ref.triangles / 1000).toFixed(1)}k triangles · ${bytesLabel(ref.bytes)}`)}">${(ref.triangles / 1000).toFixed(1)}k triangles · ${bytesLabel(ref.bytes)}</small></span><span class="district-arrow">↗</span>`;
      button.addEventListener('click', () => focusTile(index)); $('districtList').appendChild(button);
    });
    renderManifestInfo(validated, actual);
    updateSun();
    progress(null); setStatus(`Verified · ${actual.slice(0, 12)}…`, 'ok');
    ($('prevTile') as HTMLButtonElement).disabled = validated.tiles.length === 0;
    ($('nextTile') as HTMLButtonElement).disabled = validated.tiles.length === 0;
    const buttons = document.querySelectorAll<HTMLButtonElement>('.district-row');
    buttons.forEach(button => { button.disabled = false; });
    if (validated.tiles.length) focusTile(0);
  } catch (error) {
    if (isRequestReplaced(controller, generation)) return;
    tileStream?.setManifest(null); manifest = null; manifestBaseUrl = null; manifestIdentity = ''; packOrigin = null;
    progress(null); setStatus('Could not load pack', 'error');
    showError(signal.aborted ? 'Request timed out after 25 seconds. Check the local pack and try again.' : error instanceof Error ? error.message : String(error));
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
document.querySelector('#loadInventory')!.addEventListener('click', () => void loadInventory());
document.querySelector('#continentSelect')!.addEventListener('change', event => { const id=(event.target as HTMLSelectElement).value;if(id)void selectInventoryContinent(id); });
document.querySelector('#show3d')!.addEventListener('click',()=>setView('pack'));
document.querySelector('#show2d')!.addEventListener('click',()=>setView('outline'));
document.querySelector('#prevTile')!.addEventListener('click', () => focusTile(selectedIndex - 1));
document.querySelector('#nextTile')!.addEventListener('click', () => focusTile(selectedIndex + 1));
document.querySelector('#retryTiles')!.addEventListener('click', () => { tileStream?.retryFailed(); });
document.querySelector('#clock')!.addEventListener('input', updateSun);
document.querySelector('#manifestUrl')!.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Enter') void loadManifest(); });
document.querySelector('#manifestHash')!.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Enter') void loadManifest(); });
document.querySelector('#inventoryUrl')!.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Enter') void loadInventory(); });
document.querySelector('#inventoryHash')!.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Enter') void loadInventory(); });
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
const queriedInventory=initialQuery.get('inventory');const queriedInventoryHash=initialQuery.get('inventoryHash')?.toLowerCase()??'';
if(queriedInventory&&/^\/world-output\/inventory\/manifests\/[a-f0-9]{64}\.json$/.test(queriedInventory)&&/^[a-f0-9]{64}$/.test(queriedInventoryHash)){
 ($('inventoryUrl') as HTMLInputElement).value=queriedInventory;($('inventoryHash') as HTMLInputElement).value=queriedInventoryHash;
 if(!initialQuery.has('directory'))void loadInventory();
}
new ResizeObserver(() => { const width = canvasHost.clientWidth, height = canvasHost.clientHeight; if(width<1||height<1)return;renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); planNearbyTiles(); invalidate(); }).observe(canvasHost);
function drawFrame() {
  if (document.hidden || canvasHost.clientWidth < 1 || canvasHost.clientHeight < 1) return false;
  const moving = controls.update(); updateCompass(); renderer.render(scene, camera);
  safeText($('frameNote'), `Demand rendering · ${++drawnFrames} frames · ${moving ? 'camera settling' : 'idle'}`);
  if (!activeObjects.length) return moving;
  const triangles = renderer.info.render.triangles;
  const calls = renderer.info.render.calls;
  document.querySelectorAll('.stats-grid strong')[2]!.textContent = triangles.toLocaleString();
  document.querySelectorAll('.stats-grid strong')[3]!.textContent = String(calls);
  if (triangles > WORLD_LIMITS.visibleTriangles || calls > WORLD_LIMITS.visibleDrawCalls) {
    tileStream?.setSelection({ selected: [], deferred: [], overbudget: [], outsideView: [], cost: { triangles: 0, drawCalls: 0, residentBytes: 0 } });
    lastPlanSignature = '';
    showError(`Rendered scene reached ${triangles.toLocaleString()} triangles / ${calls} calls, above the visible safety limit.`);
  }
  return moving;
}

function updateCompass() {
  const northInView = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion.clone().invert());
  const angle = Math.atan2(northInView.x, northInView.y) * 180 / Math.PI;
  $('compassArrow').style.transform = `rotate(${angle}deg)`;
}
demandFrames = createDemandFrames({ request: callback => requestAnimationFrame(callback), cancel: cancelAnimationFrame, draw: drawFrame });
controls.addEventListener('change', () => { if (!suppressControlPlan) planNearbyTiles(); invalidate(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) invalidate(); });
invalidate();
