/**
 * OWNER: world
 * Geometry for the atlas: regions as extruded plates, borders and roads as ribbons, capitals as
 * dots. Everything is merged — a whole level is a handful of draw calls — and coloured per vertex,
 * so opening a region or switching a tint layer is a colour write, never a rebuild.
 *
 *   mesher(THREE)
 *     .outline(feature)                       → the feature triangulated once: { xy, index, rings }
 *     .plates(features, { height, colour, walls, edges })   → { geometry, triangles, paint(colourOf) }
 *     .cap(feature, y)                        → a geometry of one feature's top (hover, selection)
 *     .ribbons(segments)                      → { geometry, triangles } from [{ points: [[x, y, z]…], colour, width }]
 *     .ribbonMaterial(opacity) · .dotMaterial()
 *     .dots(points)                           → a geometry for THREE.Points: [{ x, y, z, colour, size }]
 *   arcSegments(topology, keep, y)            → border lines from the topology's arcs, each drawn once
 *   outerEdges(topology)                      → the edges only one region uses (coasts, the outside): where a plate's wall can be seen
 *
 * Map units: x east, z south, y up (see ./projection.js; the map's y is −z here).
 */
import type { BufferGeometry, ShaderMaterial, Vector2 } from 'three';
import { project } from './projection.ts';
import type { Topology } from './topo.ts';

/** Three.js is loaded lazily by the caller and handed in. */
type ThreeModule = typeof import('three');
/** All the mesher reads of a region: its polygons as flat rings, [outer, hole…] each. */
export interface RingFeature { rings: Float64Array[][] }
/** A feature triangulated once: map-unit points, triangle indexes, and each ring's [first point, point count, isHole]. */
export interface Outline { xy: number[]; index: number[]; rings: [number, number, boolean][] }
/** A line with a width in CSS pixels, as [x, y, z] points. */
export interface RibbonLine { points: number[][]; colour: string; width: number }
export interface PlateOptions<F extends RingFeature> {
  height: (feature: F) => number; colour: (feature: F) => string; walls?: boolean; floor?: number; edges?: Set<string> | null; raised?: (feature: F) => boolean;
}
export interface Plates<F extends RingFeature> { geometry: BufferGeometry; triangles: number; paint: (colourOf: (feature: F) => string) => void }
export interface DotPoint { x: number; y: number; z: number; colour: string; size: number }

/** How dark a wall is, by the way it faces: lit from the north-west, so southern and eastern walls are in shade. */
const wallShade = (nx: number, nz: number): number => 0.62 + 0.16 * Math.max(0, -(nx * 0.6 + nz * 0.8)) + 0.06 * Math.max(0, nx * 0.6 + nz * 0.8);

/** Arcs of the topology as line pieces, one per arc. `keep(users, arcIndex)` chooses; users are feature indexes. */
export function arcSegments(topology: Pick<Topology, 'arcs' | 'users'>, keep: (users: number[], arcIndex: number) => boolean, y: number, colour: string, width: number): RibbonLine[] {
  const out: RibbonLine[] = [];
  topology.arcs.forEach((arc, index) => {
    if (!keep(topology.users[index]!, index)) return;
    const points: number[][] = [];
    for (let i = 0; i < arc.length; i += 2) { const [x, py] = project(arc[i]!, arc[i + 1]!); points.push([x, y, -py]); }
    out.push({ points, colour, width });
  });
  return out;
}

const edgeKey = (ax: number, ay: number, bx: number, by: number): string => `${ax},${ay}|${bx},${by}`;
/** Every edge of the topology that only one feature uses, as keys both ways round. A wall between two plates of the same height is never seen, so only these get one. */
export function outerEdges(topology: Pick<Topology, 'arcs' | 'users'>): Set<string> {
  const out = new Set<string>();
  topology.arcs.forEach((arc, index) => {
    if (topology.users[index]!.length !== 1) return;
    for (let i = 0; i + 3 < arc.length; i += 2) { out.add(edgeKey(arc[i]!, arc[i + 1]!, arc[i + 2]!, arc[i + 3]!)); out.add(edgeKey(arc[i + 2]!, arc[i + 3]!, arc[i]!, arc[i + 1]!)); }
  });
  return out;
}

export function mesher(THREE: ThreeModule) {
  const outlines = new WeakMap<RingFeature, Outline>(), tint = new THREE.Color();

  /** The feature's polygons triangulated in map units. Cached: hover and selection reuse it. */
  function outline(feature: RingFeature): Outline {
    let made = outlines.get(feature);
    if (made) return made;
    const xy: number[] = [], index: number[] = [], rings: [number, number, boolean][] = [];
    for (const poly of feature.rings) {
      const base = xy.length / 2, loops = poly.map((ring, hole) => {
        const points: Vector2[] = [], start = xy.length / 2;
        for (let i = 0; i < ring.length; i += 2) { const [x, y] = project(ring[i]!, ring[i + 1]!); xy.push(x, y); points.push(new THREE.Vector2(x, y)); }
        rings.push([start, ring.length / 2, hole > 0]);
        return points;
      });
      for (const face of THREE.ShapeUtils.triangulateShape(loops[0]!, loops.slice(1))) index.push(base + face[0]!, base + face[1]!, base + face[2]!);
    }
    made = { xy, index, rings };
    outlines.set(feature, made);
    return made;
  }

  /**
   * Regions as plates in one geometry.
   * options.edges: with it (see outerEdges), only those edges get a wall — except for a `raised` plate, which stands above its neighbours and gets them all
   */
  function plates<F extends RingFeature>(features: readonly F[], { height, colour, walls = true, floor = 0, edges = null, raised = () => false }: PlateOptions<F>): Plates<F> {
    const position: number[] = [], shade: number[] = [], index: number[] = [], spans: [F, number, number][] = [];
    for (const feature of features) {
      const shape = outline(feature), top = height(feature), start = position.length / 3, n = shape.xy.length / 2;
      for (let i = 0; i < n; i++) { position.push(shape.xy[i * 2]!, top, -shape.xy[i * 2 + 1]!); shade.push(1); }
      for (const i of shape.index) index.push(start + i);
      if (walls && top > floor) {
        const lonLat = feature.rings.flat(), every = !edges || raised(feature);
        for (const [r, [from, count]] of shape.rings.entries()) {
          for (let i = 0; i < count; i++) {
            const j = (i + 1) % count, ring = lonLat[r]!;
            if (!every && !edges!.has(edgeKey(ring[i * 2]!, ring[i * 2 + 1]!, ring[j * 2]!, ring[j * 2 + 1]!))) continue;
            const a = from + i, b = from + j, ax = shape.xy[a * 2]!, az = -shape.xy[a * 2 + 1]!, bx = shape.xy[b * 2]!, bz = -shape.xy[b * 2 + 1]!;
            const length = Math.hypot(bx - ax, bz - az) || 1, lit = wallShade((bz - az) / length, -(bx - ax) / length), lit2 = wallShade(-(bz - az) / length, (bx - ax) / length), v = position.length / 3;
            // The wall is seen from outside the plate whichever way the ring runs: both faces are drawn (DoubleSide), shaded for the brighter side.
            const k = Math.max(lit, lit2) * 0.5 + Math.min(lit, lit2) * 0.5;
            position.push(ax, top, az, bx, top, bz, bx, floor, bz, ax, floor, az); shade.push(k, k, k * 0.86, k * 0.86);
            index.push(v, v + 1, v + 2, v, v + 2, v + 3);
          }
        }
      }
      spans.push([feature, start, position.length / 3 - start]);
    }
    const geometry = new THREE.BufferGeometry(), colours = new Float32Array(position.length);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geometry.setIndex(index);
    /** Colour every plate again (a status changed, a tint layer was switched). */
    function paint(colourOf: (feature: F) => string) {
      for (const [feature, start, count] of spans) {
        tint.set(colourOf(feature));
        for (let i = start; i < start + count; i++) { colours[i * 3] = tint.r * shade[i]!; colours[i * 3 + 1] = tint.g * shade[i]!; colours[i * 3 + 2] = tint.b * shade[i]!; }
      }
      geometry.attributes.color!.needsUpdate = true;
    }
    paint(colour);
    geometry.computeBoundingSphere();
    return { geometry, triangles: index.length / 3, paint };
  }

  /** One feature's top face at height y: what lights up under the pointer and when selected. */
  function cap(feature: RingFeature, y: number): BufferGeometry {
    const shape = outline(feature), position = new Float32Array((shape.xy.length / 2) * 3);
    for (let i = 0; i < shape.xy.length / 2; i++) { position[i * 3] = shape.xy[i * 2]!; position[i * 3 + 1] = y; position[i * 3 + 2] = -shape.xy[i * 2 + 1]!; }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setIndex(shape.index);
    geometry.computeBoundingSphere();
    return geometry;
  }
  /** The feature's rings as closed lines at height y, for ribbons(). `holes: false` leaves out lakes and lagoons inside it. */
  function ringLines(feature: RingFeature, y: number, colour: string, width: number, { holes = true }: { holes?: boolean } = {}): RibbonLine[] {
    const shape = outline(feature);
    return shape.rings.filter((ring) => holes || !ring[2]).map(([from, count]) => ({ colour, width, points: Array.from({ length: count + 1 }, (_, i) => { const at = from + (i % count); return [shape.xy[at * 2]!, y, -shape.xy[at * 2 + 1]!]; }) }));
  }

  /**
   * Lines with a width in screen pixels: two triangles a piece, widened in the vertex shader.
   * `lines` width in CSS pixels
   */
  function ribbons(lines: readonly RibbonLine[]): { geometry: BufferGeometry; triangles: number } {
    let pieces = 0;
    for (const line of lines) pieces += Math.max(0, line.points.length - 1);
    const position = new Float32Array(pieces * 12), other = new Float32Array(pieces * 12), offset = new Float32Array(pieces * 4), colours = new Float32Array(pieces * 12), index = new Uint32Array(pieces * 6);
    let v = 0, f = 0;
    for (const line of lines) {
      tint.set(line.colour);
      for (let i = 0; i < line.points.length - 1; i++) {
        const a = line.points[i]!, b = line.points[i + 1]!, half = line.width / 2;
        // Two vertices at each end; `other` is the far end, so the shader knows which way the line runs on screen.
        for (const [at, far, side] of [[a, b, half], [a, b, -half], [b, a, half], [b, a, -half]] satisfies [number[], number[], number][]) {
          position.set(at, v * 3); other.set(far, v * 3); offset[v] = side; colours[v * 3] = tint.r; colours[v * 3 + 1] = tint.g; colours[v * 3 + 2] = tint.b; v += 1;
        }
        index.set([v - 4, v - 3, v - 2, v - 4, v - 2, v - 1], f); f += 6;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('other', new THREE.BufferAttribute(other, 3));
    geometry.setAttribute('offset', new THREE.BufferAttribute(offset, 1));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeBoundingSphere();
    return { geometry, triangles: pieces * 2 };
  }
  /** The material every ribbon mesh uses; `resolution` is the canvas in CSS pixels and must be kept current. */
  function ribbonMaterial(opacity = 1): ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { resolution: { value: new THREE.Vector2(1, 1) }, opacity: { value: opacity }, lift: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `attribute vec3 other; attribute float offset; attribute vec3 color; uniform vec2 resolution; uniform float lift; varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 here = projectionMatrix * modelViewMatrix * vec4(position, 1.0), there = projectionMatrix * modelViewMatrix * vec4(other, 1.0);
          vec2 along = (there.xy / there.w - here.xy / here.w) * resolution;
          float size = length(along);
          vec2 across = size > 0.0001 ? vec2(-along.y, along.x) / size : vec2(0.0, 1.0);
          // The two ends see the line run opposite ways, so the same sign of offset lands on opposite sides: a quad.
          here.xy += across * offset * 2.0 / resolution * here.w;
          here.z -= lift * here.w;
          gl_Position = here;
        }`,
      fragmentShader: `uniform float opacity; varying vec3 vColor; void main() {
          gl_FragColor = vec4(vColor, opacity);
          #include <colorspace_fragment>
        }`,
    });
  }

  /** Round dots a fixed number of pixels wide. */
  function dots(points: readonly DotPoint[]): BufferGeometry {
    const position = new Float32Array(points.length * 3), colours = new Float32Array(points.length * 3), size = new Float32Array(points.length);
    points.forEach((point, i) => { position.set([point.x, point.y, point.z], i * 3); tint.set(point.colour); colours.set([tint.r, tint.g, tint.b], i * 3); size[i] = point.size; });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(size, 1));
    geometry.computeBoundingSphere();
    return geometry;
  }
  function dotMaterial(): ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { ratio: { value: 1 }, opacity: { value: 1 } }, transparent: true, depthWrite: false, depthTest: false,
      vertexShader: `attribute float size; attribute vec3 color; uniform float ratio; varying vec3 vColor;
        void main() { vColor = color; gl_PointSize = size * ratio; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float opacity; varying vec3 vColor;
        void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; vec3 c = d > 0.33 ? vec3(1.0) : vColor; gl_FragColor = vec4(c, opacity);
          #include <colorspace_fragment>
        }`,
    });
  }

  /** Plain one-pixel lines (no triangles at all): the far-out coastline. */
  function hairlines(lines: readonly { points: readonly (readonly number[])[] }[]): BufferGeometry {
    const position: number[] = [];
    for (const line of lines) for (let i = 0; i < line.points.length - 1; i++) position.push(...line.points[i]!, ...line.points[i + 1]!);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.computeBoundingSphere();
    return geometry;
  }

  return { outline, plates, cap, ringLines, ribbons, hairlines, ribbonMaterial, dots, dotMaterial };
}
/** What mesher(THREE) returns. */
export type Mesher = ReturnType<typeof mesher>;
