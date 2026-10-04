/**
 * OWNER: scenes
 * The shared LOOK of every 3D view: how a renderer is set up, what a phone is allowed to cost, the
 * graded sky behind a scene and the soft ground it stands on. One place, so the venue host, the
 * character preview, the scene harness (and the city map, when it adopts it) show the same colours.
 *
 * TONE MAPPING. The art is hand-picked sRGB colour, so the tone mapper is Khronos PBR Neutral: it
 * leaves a colour as it was chosen up to a threshold and only rolls off what would otherwise clip
 * to white (sunlit sand, cream walls). Exposure stays at 1.
 *
 * TIERS. A phone (coarse pointer, short side up to 720 CSS px) draws at a pixel ratio of at most
 * 1.5 with a 1024 shadow map and plain PCF; everything else at up to 2 with a 2048 map and soft
 * PCF. The tier is chosen from the device, never from a frame-rate measurement: nothing shifts
 * resolution while the player is looking.
 *
 * Nothing here keeps time, draws, or needs a DOM: the sky is a small data texture.
 *
 * FOR THE CITY MAP (src/map3d, another owner): call applyRendererLook(THREE, renderer, renderTier())
 * in place of its own outputColorSpace / setPixelRatio lines to match the scenes' tone mapping.
 */

export const PHONE_TIER = Object.freeze({ name: 'phone', pixelRatio: 1.5, shadowMap: 1024, softShadows: false });
export const WIDE_TIER = Object.freeze({ name: 'wide', pixelRatio: 2, shadowMap: 2048, softShadows: true });

/**
 * FOR REVIEW, DEFAULT OFF: cheaper scenery. With the flag on, the kit's per-colour materials and the
 * merged scene material are MeshLambertMaterial instead of MeshStandardMaterial — the same matte look
 * without the per-pixel roughness/specular work. Turn it on with ?matte in the address, or
 * localStorage['joinallworld-matte'] = '1'; ?matte=0 turns it off again for that page.
 */
export function matteScenery(win = globalThis) {
  try {
    const query = new URLSearchParams(win.location?.search || '');
    if (query.has('matte')) return query.get('matte') !== '0';
    return win.localStorage?.getItem('joinallworld-matte') === '1';
  } catch { return false; }
}

/** The render tier for this device. */
export function renderTier(win = globalThis) {
  const coarse = win.matchMedia?.('(pointer: coarse)').matches === true;
  const short = Math.min(Number(win.innerWidth) || Infinity, Number(win.innerHeight) || Infinity);
  return coarse && short <= 720 ? PHONE_TIER : WIDE_TIER;
}

/** Colour space, tone mapping, pixel ratio and shadow filter for a renderer. Safe on a test stub. */
export function applyRendererLook(THREE, renderer, tier = WIDE_TIER, { shadows = true, win = globalThis } = {}) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setPixelRatio?.(Math.min(win.devicePixelRatio || 1, tier.pixelRatio));
  if (shadows && renderer.shadowMap) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = tier.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  }
  return tier;
}

const channels = (hex) => { const n = parseInt(String(hex).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/** '#rrggbb' between two colours. */
export function mixHex(a, b, t) {
  const x = channels(a), y = channels(b);
  return `#${x.map((v, i) => Math.round(v * (1 - t) + y[i] * t).toString(16).padStart(2, '0')).join('')}`;
}

const SKY_ROWS = 32;
/**
 * A graded sky for scene.background: the horizon colour at the bottom of the screen rising to the
 * zenith colour at the top. One 1×32 texture, re-used and re-filled when the colours change.
 * → { texture, set(horizon, zenith) → boolean (changed), dispose() }
 */
export function createSky(THREE) {
  const data = new Uint8Array(SKY_ROWS * 4);
  const texture = new THREE.DataTexture(data, 1, SKY_ROWS, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  let key = '';
  return {
    texture,
    set(horizon, zenith = horizon) {
      const next = `${horizon}:${zenith}`;
      if (next === key) return false;
      key = next;
      const low = channels(horizon), high = channels(zenith);
      for (let row = 0; row < SKY_ROWS; row += 1) {
        // The lower third stays near the horizon colour (that is where the ground meets it), then it rises.
        const t = Math.max(0, (row / (SKY_ROWS - 1) - 0.3) / 0.7), ease = t * t * (3 - 2 * t);
        for (let c = 0; c < 3; c += 1) data[row * 4 + c] = Math.round(low[c] * (1 - ease) + high[c] * ease);
        data[row * 4 + 3] = 255;
      }
      texture.needsUpdate = true;
      return true;
    },
    dispose() { texture.dispose(); },
  };
}

const GROUND_SEGMENTS = 48;
/**
 * The soft ground a scene stands on: a wide disc just under the floor slab that takes the scene's
 * shadows and fades out into the sky at its rim, so no room floats in a flat void. One mesh, one
 * draw call, 96 triangles; it never casts a shadow.
 * → { mesh, place(x, z, radius, y), tint(colour), dispose() }
 */
export function createGround(THREE) {
  const positions = [0, 0, 0], colours = [1, 1, 1, 1], index = [];
  const rings = [[0.72, 1], [1, 0]];
  for (const [reach, alpha] of rings) {
    for (let i = 0; i < GROUND_SEGMENTS; i += 1) {
      const a = (i / GROUND_SEGMENTS) * Math.PI * 2;
      positions.push(Math.cos(a) * reach, 0, Math.sin(a) * reach);
      colours.push(1, 1, 1, alpha);
    }
  }
  for (let i = 0; i < GROUND_SEGMENTS; i += 1) {
    const next = (i + 1) % GROUND_SEGMENTS, a = 1 + i, b = 1 + next, c = 1 + GROUND_SEGMENTS + i, d = 1 + GROUND_SEGMENTS + next;
    index.push(0, b, a, a, b, d, a, d, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 4));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setIndex(index);
  const material = new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ground';
  mesh.castShadow = false; mesh.receiveShadow = true;
  mesh.renderOrder = -1;
  return {
    mesh,
    place(x, z, radius, y = -0.5) { mesh.position.set(x, y, z); mesh.scale.set(radius, 1, radius); },
    tint(colour) { material.color.set(colour); },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
