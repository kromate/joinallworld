/**
 * OWNER: scenes
 * Development-only scene viewer (see harness.html). It mirrors the host's renderer, camera and
 * light setup, builds one scene kind from the query string and draws it once per change.
 * Nothing here runs in the game: the production build does not include this page.
 */
import { createKit } from './kit.js';
import { buildVenueScene, KINDS, TIMES } from './venue-scenes.js';

const params = new URLSearchParams(location.search);
const settings = {
  kind: params.get('kind') || 'park',
  time: params.get('time') || 'day',
  variant: params.get('variant') || '',
  crowd: Number(params.get('crowd') ?? 6),
  spot: params.get('spot') || '',
  busy: params.has('busy'),
};
const stage = document.getElementById('stage'), info = document.getElementById('info'), bar = document.getElementById('bar');
const kit = createKit();
const { THREE } = kit;
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 150);
scene.add(new THREE.HemisphereLight('#bdd4e7', '#273e2b', 1.6));
const sun = new THREE.DirectionalLight('#c7dbec', 1.4);
sun.position.set(-12, 25, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 70 });
sun.shadow.normalBias = 0.04;
scene.add(sun);

let entry = null, renderCount = 0;
const names = ['Ada', 'Tunde', 'Zainab', 'Chidi', 'Bisi', 'Emeka', 'Kemi', 'Sani', 'Ngozi', 'Femi', 'Amaka', 'Yusuf'];
function draw() {
  const { clientWidth: width, clientHeight: height } = stage;
  camera.aspect = width / Math.max(1, height);
  const portrait = camera.aspect < 0.85;
  camera.position.set(...(portrait ? entry.camera.portrait : entry.camera.landscape));
  camera.fov = portrait ? 48 : 43;
  camera.lookAt(0, 0.7, 0);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  renderer.setClearColor(entry.background);
  renderer.render(scene, camera);
  renderCount += 1;
  document.querySelectorAll('.tag').forEach((node) => node.remove());
  for (const tag of entry.tags()) {
    const point = new THREE.Vector3(tag.position.x, tag.position.y, tag.position.z).project(camera);
    const node = document.createElement('div');
    node.className = 'tag';
    node.textContent = tag.marker === 'dot' ? `● ${tag.text}` : tag.marker === 'crown' ? `♛ ${tag.text}` : tag.text;
    node.style.color = tag.colour;
    node.style.left = `${(point.x + 1) / 2 * width}px`;
    node.style.top = `${(1 - point.y) / 2 * height}px`;
    document.body.appendChild(node);
  }
  const stats = entry.stats();
  window.__diag = { ...settings, renderCount, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, stats, spots: Object.keys(entry.anchors) };
  info.textContent = `${settings.kind} · ${entry.time} · frame ${renderCount} · ${renderer.info.render.calls} calls · ${renderer.info.render.triangles} tris (scene ${stats.triangles}) · ${renderer.info.memory.geometries} geometries`;
}
function build() {
  entry?.dispose();
  entry = buildVenueScene(kit, { id: settings.kind, label: settings.kind, scene: { kind: settings.kind, time: settings.time, variant: settings.variant || undefined } });
  scene.add(entry.group);
  entry.setCrowd(names.slice(0, settings.crowd).map((name, i) => ({ id: `p${i}`, name, kind: i % 3 === 2 ? 'npc' : 'player' })));
  if (settings.spot) entry.setSpot(settings.spot);
  if (settings.busy) entry.update({ activeAction: {} });
  draw();
}
function select(key, values) {
  const node = document.createElement('select');
  for (const value of values) node.add(new Option(value || '(default)', value, false, value === settings[key]));
  node.onchange = () => { settings[key] = node.value; build(); };
  bar.appendChild(node);
}
select('kind', [...KINDS, 'library', 'mosque', 'generic']);
select('time', TIMES);
const spots = document.createElement('button');
spots.textContent = 'Next spot';
spots.onclick = () => { const keys = Object.keys(entry.anchors); const next = keys[(keys.indexOf(entry.spot) + 1) % keys.length]; if (entry.setSpot(next)) draw(); };
bar.appendChild(spots);
const busy = document.createElement('button');
busy.textContent = 'Toggle busy';
busy.onclick = () => { settings.busy = !settings.busy; if (entry.update({ activeAction: settings.busy ? {} : null })) draw(); };
bar.appendChild(busy);
addEventListener('resize', draw);
window.__harness = { settings, build, draw, get entry() { return entry; } };
build();
