import * as THREE from 'three';
import { createKit, type Kit } from '../../../src/scene/kit.ts';
import { buildVenueScene } from '../../../src/scene/venue-scenes.ts';
import type { SceneEntry, SceneVenue } from '../../../src/scene/types.ts';
import { createStandIn } from '../../../src/scene/body/stand-in.ts';
import type { StandIn, StandInScene } from '../../../src/scene/body/stand-in.ts';
import type { BodyPose, SkinnedBody } from '../../../src/scene/body/skinned.ts';
import { loadGameBody, NATIVE_GAME_BODY_CAPABILITIES } from '../../../src/scene/body/provider.ts';
import { crowdList } from '../../../src/scene/crowd.ts';
import { advanceLife, createLife, dispatch, viewLife } from '../../../src/life.ts';
import { loadCityContent } from '../../../src/game/cities/registry.ts';
import { loadCityScenes } from '../../../src/scene/city-scenes.ts';

interface ActorAudit {
  readonly requestedLook: unknown;
  readonly seed: string;
  readonly context: { readonly scene: 'venue'; readonly poses: readonly BodyPose[] };
  body: SkinnedBody;
  lastSolve: ReturnType<SkinnedBody['solveFeet']> | null;
  contacts: number;
}
interface FixtureSnapshot {
  readyState: 'loading' | 'ready' | 'failed';
  errors: string[];
  stage: string;
  life: { location: string; now: number };
  crowd: { desired: number; canonical: number; procedural: number; loading: number };
  player: Record<string, unknown>;
  npcs: Record<string, Record<string, unknown>>;
  unsupportedProbe: Record<string, unknown> | null;
  interaction: Record<string, unknown> | null;
  currentCamera: string;
  viewport: { width: number; height: number; layoutColumns: number };
}

declare global {
  interface Window { nativeGameFixture: ReturnType<typeof createFixture> }
}

const NOW = Date.UTC(2026, 9, 9, 10, 30);
const PLAYER_SEED = 'creator-fixture-same-seed-v1';
const PLAYER_LOOK = Object.freeze({
  body: 'man', hair: 'lowcut', outfit: 'casual', fabric: 'plain', skin: 'skin5', hairColor: 'darkbrown',
  outfitColor: 'navy', bottomsColor: 'blue', accessories: [], face: 'oval', expression: 'smile',
  appearance: { height: 'average', build: 'average', ageAppearance: 'adult' },
});
const PLAYER_POSES: readonly BodyPose[] = Object.freeze(['idle', 'walk', 'interact', 'cook', 'eat', 'drink']);
const NPC_POSES: readonly BodyPose[] = Object.freeze(['idle', 'walk', 'interact']);

function required<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing fixture element ${selector}`);
  return value;
}

function text(node: Element, value: unknown): void {
  node.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function makeRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

function nativeMeshEvidence(root: THREE.Object3D | null): { meshes: string[]; morphs: string[]; authoredRig: boolean } {
  const meshNames: string[] = [], morphNames = new Set<string>();
  root?.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshNames.push(mesh.name || '(unnamed)');
    const dictionary = (mesh as THREE.Mesh & { morphTargetDictionary?: Record<string, number> }).morphTargetDictionary;
    if (dictionary) Object.keys(dictionary).forEach((name) => morphNames.add(name));
  });
  const names = new Set(meshNames);
  const morphs = [...morphNames].sort();
  return {
    meshes: meshNames,
    morphs,
    authoredRig: names.has('Body') && names.has('Eyes') && names.has('Teeth') && names.has('Tongue')
      && morphs.includes('nativeFacialBlinkLeft') && morphs.includes('nativeFacialJawOpen'),
  };
}

function createFixture() {
  const canvas = required<HTMLCanvasElement>('#game-stage');
  const status = required<HTMLElement>('#status');
  const auditNode = required<HTMLElement>('#audit');
  const npcNode = required<HTMLElement>('#npc-cards');
  const renderer = makeRenderer(canvas);
  const kit: Kit = createKit();
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 160);
  const errors: string[] = [];
  const actors = new Map<string, ActorAudit>();
  const actions = new Set<() => void>();
  let entry: SceneEntry | null = null;
  let standIn: StandIn | null = null;
  let lifeState: ReturnType<typeof createLife> | null = null;
  let regulars: ReturnType<typeof viewLife>['social']['here'] = [];
  let npcCrowd: ReturnType<typeof crowdList> = [];
  let readyState: FixtureSnapshot['readyState'] = 'loading';
  let stage = 'Loading Lagos office game slice';
  let currentCamera = 'scene';
  let unsupportedProbe: Record<string, unknown> | null = null;
  let interaction: Record<string, unknown> | null = null;
  let lastContact: ReturnType<SkinnedBody['solveFeet']> | null = null;
  let frame = 0;
  let startedAt = 0;
  let mode: 'idle' | 'walk' | 'interact' = 'idle';
  let animationHandle = 0;
  let lastRenderedState = '';
  let disposed = false;
  let disposalEvidence: Record<string, unknown> | null = null;

  const sceneLights: THREE.Object3D[] = [];
  type CrowdCounts = { desired: number; canonical: number; procedural: number; loading: number };
  function crowdCounts(): CrowdCounts {
    const read = entry?.group.userData.canonicalCrowdCounts;
    if (typeof read !== 'function') return { desired: 0, canonical: 0, procedural: 0, loading: 0 };
    const counts = (read as () => Partial<CrowdCounts>)();
    return {
      desired: Number(counts.desired ?? 0), canonical: Number(counts.canonical ?? 0),
      procedural: Number(counts.procedural ?? 0), loading: Number(counts.loading ?? 0),
    };
  }
  const sceneVenue: SceneVenue = {
    id: 'office', label: 'Lagoon Towers office', district: 'lagos-island',
    scene: { kind: 'office', time: 'day', spots: [
      { id: 'reception', label: 'Reception', activities: [] },
      { id: 'lounge', label: 'Tea lounge', activities: [] },
      { id: 'desks', label: 'Office desks', activities: [] },
    ] },
  };

  const updateLights = () => {
    if (!entry) return;
    const preset = entry.lighting();
    const hemi = new THREE.HemisphereLight(preset.hemi[0], preset.hemi[1], preset.hemi[2]);
    const sun = new THREE.DirectionalLight(preset.sun[0], preset.sun[1]);
    sun.position.set(...preset.sun[2]);
    sun.castShadow = true;
    world.add(hemi, sun);
    sceneLights.push(hemi, sun);
    world.background = new THREE.Color(entry.background);
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    renderer.setSize(Math.round(rect.width), Math.round(rect.height), false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  };

  function draw() {
    if (disposed || !entry) return;
    resize();
    entry.look(camera.position.x, camera.position.z);
    renderer.render(world, camera);
  }

  const playerLoader = async (owner: Kit, look: unknown, seed: unknown, scale: number): Promise<SkinnedBody> => {
    const identitySeed = String(seed ?? PLAYER_SEED);
    const body = await loadGameBody(owner, look, identitySeed, scale, { scene: 'venue', poses: PLAYER_POSES });
    const audit: ActorAudit = { requestedLook: look, seed: identitySeed, context: { scene: 'venue', poses: PLAYER_POSES }, body, lastSolve: null, contacts: 0 };
    const solve = body.solveFeet.bind(body), sample = body.sampleFootContacts.bind(body);
    body.solveFeet = (heightAt) => { const result = solve(heightAt); audit.lastSolve = result; lastContact = result; return result; };
    body.sampleFootContacts = () => { const points = sample(); audit.contacts = points.reduce((count, item) => count + (item.points?.length ?? 1), 0); return points; };
    body.object.userData.nativeGameFixture = { seed: identitySeed, context: audit.context, hasPreparedMetrics: 'preparedMetrics' in body };
    actors.set('player', audit);
    return body;
  };

  async function initialize() {
    try {
      await loadCityContent('lagos');
      await loadCityScenes('lagos');
      lifeState = createLife({ location: 'office', spot: 'people', name: 'Office game fixture' }, { cityId: 'lagos', now: NOW, seed: 'lagos-office-game-slice' });
      const view = viewLife(lifeState, { cityId: 'lagos', now: NOW, seed: 'lagos-office-game-slice' });
      regulars = view.social.here;
      const targeted = regulars.filter((npc) => npc.id === 'mrs-okafor' || npc.id === 'dapo');
      if (targeted.length !== 2) throw new Error(`Real office regulars missing from viewLife: ${targeted.map((npc) => npc.id).join(',')}`);
      npcCrowd = crowdList({ npcs: targeted });
      if (npcCrowd.length !== 2 || npcCrowd.some((person) => person.kind !== 'npc' || !person.seed)) {
        throw new Error('crowdList did not preserve the two real regular identities');
      }
      entry = buildVenueScene(kit, sceneVenue, 'lagos');
      entry.setTime('day');
      entry.update({ t: NOW, location: 'office', name: 'Player', onboarding: { look: PLAYER_LOOK } });
      entry.setPlayer({ look: PLAYER_LOOK, seed: PLAYER_SEED, name: 'Player' });
      entry.setCrowd(npcCrowd);
      world.add(entry.group);
      updateLights();

      standIn = createStandIn(kit, () => { stage = 'Player stand-in ready'; draw(); }, true, playerLoader);
      standIn.attach({
        group: entry.group,
        avatar: entry.walk.avatar,
        scale: entry.walk.scale,
        contactHeightAt: entry.walk.contactHeightAt,
      } satisfies StandInScene);
      standIn.wear(PLAYER_LOOK, PLAYER_SEED);
      const start = entry.walk.entrance ?? { x: 0, y: 0, z: 7.8, ry: Math.PI };
      standIn.move(start.x, start.y, start.z, start.ry);

      // Render the actual scene once before either native queue starts, matching venue-world's first-frame gate.
      camera.position.set(13.5, 10.2, 17.2);
      camera.lookAt(0, 1.15, 0);
      draw();
      if (!renderer.capabilities.isWebGL2) throw new Error('Remote renderer did not provide WebGL2');
      standIn.start(renderer);
      const startCrowd = Reflect.get(entry, 'startCrowd');
      if (typeof startCrowd !== 'function') throw new Error('Staged venue scene does not expose the post-first-frame canonical crowd seam');
      startCrowd.call(entry, renderer, () => { stage = 'Canonical NPC queue changed'; draw(); });
      stage = 'Loading prepared player and real office regulars';
      readyState = 'loading';
      startedAt = performance.now();
      animationHandle = requestAnimationFrame(poll);
      renderNpcCards(targeted);
    } catch (error) {
      readyState = 'failed';
      errors.push(error instanceof Error ? error.message : String(error));
      stage = errors.at(-1)!;
      updateDom();
    }
  }

  function renderNpcCards(npcs: typeof regulars) {
    npcNode.replaceChildren();
    for (const npc of npcs) {
      const card = document.createElement('article');
      card.className = 'npc-card';
      const header = document.createElement('header');
      const title = document.createElement('strong');
      title.textContent = npc.name;
      const role = document.createElement('span');
      role.textContent = npc.role;
      header.append(title, role);
      const spot = document.createElement('p');
      spot.textContent = `At ${npc.at ?? 'unplaced'} · ${npc.emoji} · ${npc.look ? JSON.stringify(npc.look) : 'stable seed appearance'}`;
      const actionList = document.createElement('div');
      actionList.className = 'action-list';
      for (const action of npc.actions) {
        const button = document.createElement('button');
        button.id = `npc-action-${npc.id}-${action.id}`;
        button.type = 'button';
        button.textContent = `${action.icon} ${action.label}`;
        button.title = `Run game activity ${action.activity}`;
        button.addEventListener('click', () => {
          if (!standIn) return;
          standIn.pose('wave', undefined, false);
          void performNpcAction(npc.id, action.activity);
        });
        actionList.append(button);
      }
      card.append(header, spot, actionList);
      npcNode.append(card);
    }
  }

  async function performNpcAction(npcId: string, activityId: string) {
    if (!lifeState) throw new Error('Life state is unavailable');
    const now = lifeState.t;
    const ctx = { cityId: 'lagos', now, seed: `office-fixture:${npcId}:${activityId}:${now}` };
    const beforeView = viewLife(lifeState, ctx).social;
    const npc = beforeView.here.find((person) => person.id === npcId);
    const offered = npc?.actions.find((action) => action.activity === activityId);
    if (!npc || !offered) throw new Error(`The current life view does not offer ${activityId} for ${npcId}`);
    const beforeRelationship = beforeView.relationships.find((person) => person.id === npcId);
    const started = dispatch(lifeState, { type: 'activity', id: activityId }, ctx);
    if (!started.ok || started.code !== 'started') {
      interaction = { npcId, activityId, started: { ok: started.ok, code: started.code, reason: started.reason ?? null }, completed: false };
      stage = `Game refused ${offered.label}: ${started.reason ?? started.code}`;
      updateDom(); draw();
      return interaction;
    }
    const completed = advanceLife(lifeState, offered.duration, {
      cityId: 'lagos', now: lifeState.t + offered.duration * 1000,
      seed: `office-fixture-complete:${npcId}:${activityId}:${now}`,
    });
    const afterView = viewLife(lifeState, { cityId: 'lagos', now: lifeState.t, seed: `office-fixture-view:${npcId}:${now}` }).social;
    regulars = afterView.here;
    const afterNpc = afterView.here.find((person) => person.id === npcId);
    const afterRelationship = afterView.relationships.find((person) => person.id === npcId);
    const response = lifeState.message ?? '';
    const familiarityChanged = afterRelationship !== undefined
      && (afterRelationship.points > (beforeRelationship?.points ?? -1)
        || afterRelationship.left < (beforeRelationship?.left ?? Number.POSITIVE_INFINITY));
    interaction = {
      npcId, activityId, label: offered.label,
      started: { ok: started.ok, code: started.code },
      completed: completed.ok && completed.code === 'completed',
      response,
      responseNamesNpc: response.includes(npc.name),
      beforeRelationship: beforeRelationship ? { points: beforeRelationship.points, left: beforeRelationship.left } : null,
      afterRelationship: afterRelationship ? { points: afterRelationship.points, left: afterRelationship.left } : null,
      familiarityChanged,
      viewUpdated: Boolean(afterNpc),
    };
    stage = `${offered.label} completed with ${npc.name}`;
    renderNpcCards(afterView.here.filter((person) => person.id === 'mrs-okafor' || person.id === 'dapo'));
    updateDom(); draw();
    return interaction;
  }

  function setCamera(name: string) {
    currentCamera = name;
    if (name === 'scene') camera.position.set(13.5, 10.2, 17.2);
    else if (name === 'front') camera.position.set(7.8, 5.4, 13.2);
    else camera.position.set(-6.8, 5.2, 12.8);
    camera.lookAt(0, 1.05, 0);
    draw(); updateDom();
  }

  function setMode(next: 'idle' | 'walk' | 'interact') {
    mode = next;
    if (!standIn || !entry) return;
    if (next === 'idle') {
      const start = entry.walk.entrance ?? { x: 0, y: 0, z: 7.8, ry: Math.PI };
      standIn.move(start.x, start.y, start.z, start.ry);
      standIn.pose('stand', undefined, false);
    } else if (next === 'interact') {
      standIn.pose('wave', undefined, false);
    }
    frame = 0;
    draw(); updateDom();
  }

  function poll() {
    if (disposed) return;
    if (readyState === 'loading' && startedAt > 0 && performance.now() - startedAt > 100_000) {
      readyState = 'failed';
      errors.push(`Readiness timeout: player prepared=${Boolean(actors.get('player') && 'preparedMetrics' in actors.get('player')!.body)}, crowd=${JSON.stringify(crowdCounts())}`);
      stage = errors.at(-1)!;
    }
    if (mode === 'walk' && standIn && entry) {
      frame += 1;
      const start = entry.walk.entrance ?? { x: 0, y: 0, z: 7.8, ry: Math.PI };
      const phase = frame * 0.12;
      const x = start.x + Math.sin(phase) * 0.62;
      const z = start.z - (1 - Math.cos(phase)) * 0.62;
      standIn.move(x, entry.walk.heightAt(x, z), z, Math.atan2(Math.cos(phase), Math.sin(phase)));
      standIn.gait(phase, false, entry.walk.heightAt(x, z));
      if (frame % 6 === 0) draw();
    }
    updateDom();
    animationHandle = requestAnimationFrame(poll);
  }

  function inspectNpc(npcId: string) {
    const canonicalName = `canonical-crowd:npc:${npcId}`;
    const root = entry?.group.getObjectByName(canonicalName) ?? null;
    return { ...nativeMeshEvidence(root), mounted: Boolean(root) };
  }

  function snapshot(): FixtureSnapshot {
    // The frozen SceneEntry type has no diagnostic property; the staged venue candidate exposes
    // the canonical crowd's live counts on its owned group userData.
    const crowd = crowdCounts();
    const playerAudit = actors.get('player');
    const playerEvidence = nativeMeshEvidence(playerAudit?.body.object ?? null);
    const playerPrepared = Boolean(playerAudit && 'preparedMetrics' in playerAudit.body);
    const npcAudits = Object.fromEntries(['mrs-okafor', 'dapo'].map((id) => [id, inspectNpc(id)]));
    const npcPreparedCount = Object.values(npcAudits).filter((person) => person.authoredRig && person.mounted).length;
    const contact = playerAudit?.lastSolve ?? lastContact;
    const unsupported = unsupportedProbe;
    const errorsNow = [...errors];
    if (readyState === 'loading' && playerPrepared && npcPreparedCount === 2) {
      readyState = 'ready'; stage = 'Prepared game actors ready';
    }
    if (readyState === 'ready' && crowd.procedural > 0 && crowd.desired > 0) {
      errorsNow.push(`procedural fallback error: ${crowd.procedural} of ${crowd.desired} crowd actors remain procedural`);
    }
    return {
      readyState, errors: errorsNow, stage,
      life: { location: lifeState?.location ?? '(missing)', now: NOW },
      crowd,
      player: {
        seed: playerAudit?.seed ?? PLAYER_SEED,
        look: PLAYER_LOOK,
        prepared: playerPrepared,
        authoredRig: playerEvidence.authoredRig,
        meshes: playerEvidence.meshes,
        morphs: playerEvidence.morphs,
        pose: mode,
        standInShown: standIn?.shown ?? false,
        sampleCount: playerAudit?.contacts ?? 0,
        contact: contact ? { limited: contact.limited, maxError: contact.maxError } : null,
      },
      npcs: Object.fromEntries(Object.entries(npcAudits).map(([id, audit]) => [id, {
        ...audit,
        source: regulars.find((npc) => npc.id === id) ? 'viewLife(createLife(...)).social.here' : 'missing',
        actions: regulars.find((npc) => npc.id === id)?.actions ?? [],
      }])),
      unsupportedProbe: unsupported,
      interaction,
      currentCamera,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        layoutColumns: getComputedStyle(required<HTMLElement>('.layout')).gridTemplateColumns.trim().split(/\s+/).length,
      },
    };
  }

  function updateDom() {
    const current = snapshot();
    const serialized = JSON.stringify(current);
    if (serialized === lastRenderedState) return;
    lastRenderedState = serialized;
    status.dataset.state = current.readyState;
    text(status, current.stage);
    text(auditNode, current);
    for (const error of current.errors) if (!errors.includes(error)) errors.push(error);
  }

  async function probeUnsupportedPose() {
    try {
      const fallback = await loadGameBody(kit, PLAYER_LOOK, `${PLAYER_SEED}:unsupported-probe`, 1,
        { scene: 'venue', poses: ['sit'] });
      const acceptedAsNative = 'preparedMetrics' in fallback;
      fallback.dispose();
      unsupportedProbe = { acceptedAsNative, expectedNativeRefusal: !acceptedAsNative, requested: ['sit'], fallbackDisposed: true };
      if (acceptedAsNative) errors.push('unsupported sit probe was incorrectly accepted by native provider');
    } catch (error) {
      unsupportedProbe = { acceptedAsNative: false, expectedNativeRefusal: true, requested: ['sit'], error: error instanceof Error ? error.message : String(error) };
    }
    stage = 'Unsupported-pose refusal sampled';
    updateDom(); draw();
    return unsupportedProbe;
  }

  function sample() { updateDom(); return snapshot(); }

  async function start() { await initialize(); }

  function dispose() {
    if (disposalEvidence) return disposalEvidence;
    const crowdBefore = crowdCounts();
    disposed = true;
    cancelAnimationFrame(animationHandle);
    for (const off of actions) off();
    standIn?.dispose();
    entry?.dispose();
    const crowdAfter = crowdCounts();
    const playerUnmounted = standIn?.shown === false;
    const rendererContextLost = renderer.getContext().isContextLost();
    for (const light of sceneLights) world.remove(light);
    world.clear();
    kit.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    disposalEvidence = {
      idempotent: true,
      playerUnmounted,
      crowdBefore,
      crowdAfter,
      noCanonicalActorsRemain: crowdAfter.canonical === 0 && crowdAfter.desired === 0,
      rendererContextLost: rendererContextLost || renderer.getContext().isContextLost(),
      kitDisposed: true,
    };
    return disposalEvidence;
  }

  const fixture = {
    get readyState() { return readyState; },
    start,
    sample,
    setMode,
    setCamera,
    probeUnsupportedPose,
    performNpcAction,
    scenePoses: NATIVE_GAME_BODY_CAPABILITIES,
    dispose,
  };
  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', dispose, { once: true });
  text(status, stage);
  return fixture;
}

window.nativeGameFixture = createFixture();
void window.nativeGameFixture.start();
