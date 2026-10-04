/**
 * OWNER: world
 * Civic layers on the 3D city map, drawn only from the server's own responses
 * (GET /api/civic/ads, /neighbours, /gov — the Map panel loads them and passes them on):
 *
 *   billboards  a roadside board beside the venue each slot is `near`, in the renter's colour;
 *               a free slot is a plain "FOR RENT" board
 *   sea         the grid of sea plots floating off the coast, each rented plot in its colour
 *   neighbours  an estate of small houses in each home district; a house whose owner is online
 *               has its lights on
 *   gov         the State House and the Polling Unit ringed, the State House naming the Governor
 *
 * PLAYER TEXT NEVER BECOMES GEOMETRY OR MARKUP. The 3D part of an ad is only a coloured board or
 * tile; its words are returned from chips() as plain strings, and the host writes them into DOM
 * nodes with textContent. Nothing an ad says is a link or a button.
 * A chip's ICON is never player text: `glyph` is ready-made SVG of the game's own icon set (src/ui/icon-map.js),
 * chosen from the ad's icon id, and is the one field the host may write as markup. `icon` (the palette's emoji)
 * is kept only as the plain-text fallback.
 *
 *   createOverlays(kit, city) → { group, set(layers, data) → changed, chips() → [...], triangles, dispose() }
 */
import type * as THREE from 'three';
import type { AdsView, Governor, NeighboursResponse } from '../types/civic.ts';
import type { City, MapKit } from './city-build.ts';
import { createBatch, sceneMaterials } from '../scene/build.ts';
import { sign } from '../scene/props.ts';
import { PLINTH as PLINTH_UNIT } from './landmarks.ts';
import { WATER_Y, LANDMARK_SCALE, leanGeometry } from './city-build.ts';
import { iconFor } from '../ui/icon-map.js';

/** Which layers are on. */
export interface OverlayLayers { billboards?: boolean; sea?: boolean; neighbours?: boolean; gov?: boolean }
/** What the Map panel loaded from /api/civic/{ads,neighbours,gov}: each is null until it has. */
export interface OverlayData { ads?: AdsView | null; neighbours?: NeighboursResponse | null; gov?: { governor?: Pick<Governor, 'name'> | null } | null }
/** One of the neighbours listed on an estate's chip. */
export interface ChipHome { id: string; name: string; online: boolean; you: boolean }
/** A text chip the host draws over the map: plain strings only, except `glyph` (the game's own SVG icon). */
export interface OverlayChip {
  key: string
  kind: 'board' | 'board-free' | 'plot' | 'title' | 'hood' | 'gov'
  x: number; y: number; z: number
  icon: string
  glyph: string
  text: string
  bg?: string
  ink?: string
  label?: string
  lift?: number
  homeGlyph?: string
  homes?: ChipHome[]
  more?: number
}

const HOUSES_PER_ESTATE = 18, HOMES_LISTED = 6, PLOT_CHIPS = 36;
const GOV = '#6a3fa0', PLINTH = PLINTH_UNIT * LANDMARK_SCALE;

export function createOverlays(kit: MapKit, city: City) {
  const { THREE } = kit, pack = city.pack;
  const group = new THREE.Group();
  group.name = 'overlays';
  const shared = sceneMaterials(kit);
  const tile = new THREE.MeshStandardMaterial({ vertexColors: false, roughness: 0.8, transparent: true, opacity: 0.92 });
  const house = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const lamp = new THREE.MeshBasicMaterial({ color: '#ffe9a8' });
  const ringMaterial = new THREE.MeshBasicMaterial({ color: GOV, transparent: true, opacity: 0.85, depthWrite: false });
  let parts: THREE.Mesh[] = [], chipList: OverlayChip[] = [], key = '', triangles = 0;
  const dummy = new THREE.Object3D(), tint = new THREE.Color();

  function clear() {
    for (const mesh of parts) { group.remove(mesh); mesh.geometry.dispose(); }
    parts = []; chipList = []; triangles = 0;
  }
  const push = <M extends THREE.Mesh>(mesh: M, name: string): M => { mesh.name = name; mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false; group.add(mesh); parts.push(mesh); triangles += (mesh.geometry.index!.count / 3) * ((mesh as unknown as THREE.InstancedMesh).isInstancedMesh ? (mesh as unknown as THREE.InstancedMesh).count : 1); return mesh; };
  const colourOf = (ads: AdsView | null | undefined, id: string): { bg: string; ink: string } => ads?.palette?.colours?.find((item) => item.id === id) || { bg: '#256b45', ink: '#ffffff' };
  const iconOf = (ads: AdsView | null | undefined, id: string): string => ads?.palette?.icons?.find((item) => item.id === id)?.icon || '';
  const glyphOf = (ads: AdsView | null | undefined, id: string) => iconFor('ad', id, iconOf(ads, id));

  function billboards(ads: AdsView) {
    const b = createBatch(THREE);
    for (const slot of ads.billboards.slots) {
      const place = city.places[slot.near];
      if (!place) continue;
      // Beside the plinth, on the road side, always facing south so it reads from the opening view.
      const side = PLINTH / 2 + 1.1, x = place.x + Math.cos(place.ry) * side + Math.sin(place.ry) * 2.2, z = place.z - Math.sin(place.ry) * side + Math.cos(place.ry) * 2.2;
      const colour = slot.ad ? colourOf(ads, slot.ad.colour) : { bg: '#f4f1e6', ink: '#6b6247' };
      for (const sx of [-1, 1]) b.box(x + sx * 1.2, 1.5, z, 0.16, 3.0, 0.16, '#3d444b');
      b.box(x, 3.5, z, 3.7, 2.0, 0.16, '#22252a');
      b.box(x, 3.5, z + 0.09, 3.4, 1.7, 0.04, colour.bg);
      b.box(x, 3.5, z - 0.09, 3.4, 1.7, 0.04, colour.bg);
      if (slot.ad) b.box(x, 2.82, z + 0.12, 3.4, 0.14, 0.02, colour.ink);
      else sign(b, x, 3.5, z + 0.12, 'FOR RENT', { size: 0.3, color: '#8a7a4a' });
      chipList.push(slot.ad
        ? { key: `board:${slot.slot}`, kind: 'board', x, y: 4.7, z, icon: iconOf(ads, slot.ad.icon), glyph: glyphOf(ads, slot.ad.icon), text: slot.ad.text, bg: colour.bg, ink: colour.ink, label: `Billboard on ${slot.road}: ${slot.ad.text}, by ${slot.ad.by.name}` }
        : { key: `board:${slot.slot}`, kind: 'board-free', x, y: 4.7, z, icon: '', glyph: iconFor('ad', 'megaphone'), text: 'For rent', label: `Billboard on ${slot.road}: for rent` });
    }
    for (const mesh of b.build(shared).meshes) push(mesh, `billboards-${mesh.name}`);
  }

  function sea(ads: AdsView) {
    const area = pack.bounds.sea, grid = ads.sea;
    if (!area || !grid?.rows || !grid?.cols) return;
    const taken = new Map(grid.plots.map((plot) => [plot.slot, plot] as const));
    const stepX = (area.x1 - area.x0) / grid.cols, stepZ = (area.z1 - area.z0) / grid.rows;
    const geometry = leanGeometry(THREE, 'box');   // no underside: nobody sees a sea plot from below
    const mesh = new THREE.InstancedMesh(geometry, tile, grid.rows * grid.cols);
    let i = 0;
    for (let row = 0; row < grid.rows; row++) for (let col = 0; col < grid.cols; col++) {
      const plot = taken.get(`sea-${row}-${col}`), x = area.x0 + (col + 0.5) * stepX, z = area.z0 + (row + 0.5) * stepZ;
      dummy.position.set(x, WATER_Y + (plot ? 0.05 : 0.04), z); dummy.rotation.set(0, 0, 0); dummy.scale.set(stepX - 0.5, plot ? 0.5 : 0.12, stepZ - 0.5); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tint.set(plot ? colourOf(ads, plot.colour).bg : row < grid.shoreRows ? '#e8f6f8' : '#c2e6ee'));
      i += 1;
      if (plot && chipList.length < 200) {
        const colour = colourOf(ads, plot.colour);
        chipList.push({ key: `plot:${plot.slot}`, kind: 'plot', x, y: WATER_Y + 0.9, z, icon: iconOf(ads, plot.icon), glyph: glyphOf(ads, plot.icon), text: plot.text, bg: colour.bg, ink: colour.ink, label: `Sea plot ${row + 1}·${col + 1}: ${plot.text}, by ${plot.by.name}` });
      }
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor!.needsUpdate = true;
    push(mesh, 'sea-plots');
    chipList.push({ key: 'sea-title', kind: 'title', x: (area.x0 + area.x1) / 2, y: 0.5, z: area.z0 - 2.5, icon: '', glyph: iconFor('spot', null, 'wave'), text: `Sea plots · ${grid.plots.length} of ${grid.rows * grid.cols} rented`, label: `Sea plots: ${grid.plots.length} of ${grid.rows * grid.cols} rented` });
    // Only so many chips are worth drawing at once; the nearest to the shore keep theirs.
    let plots = 0;
    chipList = chipList.filter((chip) => chip.kind !== 'plot' || (plots += 1) <= PLOT_CHIPS);
  }

  function neighbours(data: NeighboursResponse) {
    const unit = createBatch(THREE);
    unit.box(0, 0.6, 0, 1.7, 1.2, 1.9, '#ffffff');
    unit.cyl(0, 1.5, 0, 1.45, 0.75, '#b5593c', { seg: 4, top: 0.08, ry: Math.PI / 4 });
    const geometry = unit.build({ solid: house, glow: house, glass: house }).meshes[0]!.geometry;
    const lit = new THREE.PlaneGeometry(0.55, 0.5);
    const homes: { x: number; z: number; colour: string }[] = [], lights: { x: number; z: number }[] = [];
    for (const district of data.districts) {
      const estate = pack.estates?.[district.id];
      if (!estate || !district.count) continue;
      const shown = Math.min(district.count, estate.max ?? HOUSES_PER_ESTATE), online = Math.min(shown, district.online);
      for (let i = 0; i < shown; i++) {
        const x = estate.x + (i % estate.cols) * 2.7, z = estate.z + Math.floor(i / estate.cols) * 3.0;
        homes.push({ x, z, colour: i < online ? '#fff6dc' : '#d9d6cc' });
        if (i < online) lights.push({ x, z });
      }
      const rows = Math.ceil(shown / estate.cols);
      chipList.push({ key: `hood:${district.id}`, kind: 'hood', x: estate.x + (Math.min(shown, estate.cols) - 1) * 1.35, y: 3.2, z: estate.z + (rows - 1) * 1.5,
        icon: '', glyph: iconFor('house', null, 'home'), homeGlyph: iconFor('house', null, 'home'), text: `${district.label} · ${district.count} home${district.count === 1 ? '' : 's'} · ${district.online} online`,
        homes: district.homes.slice(0, HOMES_LISTED).map((home) => ({ id: home.id, name: home.name, online: Boolean(home.online), you: Boolean(home.you) })), more: Math.max(0, district.count - Math.min(district.homes.length, HOMES_LISTED)) });
    }
    if (!homes.length) { geometry.dispose(); lit.dispose(); return; }
    const mesh = new THREE.InstancedMesh(geometry, house, homes.length);
    homes.forEach((item, i) => { dummy.position.set(item.x, 0.02, item.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, tint.set(item.colour)); });
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor!.needsUpdate = true;
    push(mesh, 'estate-homes');
    if (lights.length) {
      const glow = new THREE.InstancedMesh(lit, lamp, lights.length);
      lights.forEach((item, i) => { dummy.position.set(item.x, 0.68, item.z + 0.96); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); glow.setMatrixAt(i, dummy.matrix); });
      glow.instanceMatrix.needsUpdate = true;
      push(glow, 'estate-lights');
    } else lit.dispose();
  }

  function gov(data: NonNullable<OverlayData['gov']>) {
    for (const id of ['state-house', 'polling-unit']) {
      const place = city.places[id];
      if (!place) continue;
      const ring = new THREE.Mesh(new THREE.RingGeometry(PLINTH * 0.72, PLINTH * 0.86, 40), ringMaterial);
      ring.rotation.x = -Math.PI / 2; ring.position.set(place.x, 0.11, place.z); ring.renderOrder = 3;
      push(ring, `gov-ring-${id}`);
    }
    const seat = city.places['state-house'];
    // `lift` raises the chip (in pixels) clear of the State House's own label, at every zoom.
    if (seat) chipList.push({ key: 'gov', kind: 'gov', lift: 40, x: seat.x, y: seat.top + 0.5, z: seat.z, icon: '', glyph: iconFor('panel', 'governor'), text: data.governor ? `Governor ${data.governor.name}` : 'No Governor yet', label: data.governor ? `The Governor is ${data.governor.name}` : 'There is no Governor yet' });
  }

  return {
    group,
    /** Draw the layers that are on and have data. Returns true when anything changed. */
    set(layers: OverlayLayers, data: OverlayData) {
      const next = JSON.stringify([layers.billboards && data.ads?.billboards, layers.sea && data.ads?.sea, (layers.billboards || layers.sea) && data.ads?.palette, layers.neighbours && data.neighbours?.districts, layers.gov && data.gov ? { governor: data.gov.governor ?? null } : null,
        layers.neighbours ? city.places.home?.house : null]);
      if (next === key) return false;
      key = next;
      clear();
      if (layers.billboards && data.ads?.billboards) billboards(data.ads);
      if (layers.sea && data.ads?.sea) sea(data.ads);
      if (layers.neighbours && data.neighbours?.districts) neighbours(data.neighbours);
      if (layers.gov && data.gov) gov(data.gov);
      return true;
    },
    chips: () => chipList,
    get triangles() { return triangles; },
    dispose() { clear(); for (const material of [tile, house, lamp, ringMaterial]) material.dispose(); group.parent?.remove(group); },
  };
}
