// Build an external-only diagnostic bundle from the exact public 93bc checkout.
// This transforms in-memory fixture text only; no checkout source is changed.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repo = path.resolve(process.env.ALLWORLD_INTEGRATION_ROOT ?? '/workspace/remote-verification/repositories/worker-graphics-native-interaction-temporal-29df');
const fixture = path.join(repo, 'evidence/graphics-loop/native-game-adoption-v1/game-fixture.ts');
const controller = path.join(repo, 'src/scene/body/native/native-interaction-gesture.ts');
const factory = path.join(repo, 'src/scene/body/native/native-rest-contact-v15/native-full-runtime-v15/native-prepared-factory.ts');
const venueScenes = path.join(repo, 'src/scene/venue-scenes.ts');
const clipPack = path.join(repo, 'src/scene/body/assets/clip-pack.glb');
const outDir = '/workspace/remote-verification/worker-results/native-interaction-temporal/extended110-successor';
const outfile = path.join(outDir, 'game-fixture.instrumented.bundle.js');
const manifestPath = path.join(outDir, 'instrumented-bundle-manifest.json');
const requireFromRepo = createRequire(path.join(repo, 'package.json'));
const esbuild = requireFromRepo('esbuild');
const expected = {
  fixtureSha256: '491d57847f4d08a432d5bd75680ac4aabfe901f34360ca654a81dc9fbdc7fe10',
  controllerSha256: '70d28b67deb52af9e0a274ed92d7e2f8d04a309a7129854782adb7994ed24cf3',
  clipPackSha256: '89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47',
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fixtureBytes = await readFile(fixture);
const controllerBytes = await readFile(controller);
const factoryBytes = await readFile(factory);
const venueBytes = await readFile(venueScenes);
const clipBytes = await readFile(clipPack);
for (const [name, actual, expectedValue] of [
  ['fixture', hash(fixtureBytes), expected.fixtureSha256],
  ['controller', hash(controllerBytes), expected.controllerSha256],
  ['factory', hash(factoryBytes), '5af71712de69d4b13beeadb0ac8e4a8722b89dc7601efbe56fe92bb950310d55'],
  ['venue scenes', hash(venueBytes), '249954ca92d180652d9fa3760b502a2cb28fe8502ca9952727cb5c7aa58c553f'],
  ['clip pack', hash(clipBytes), expected.clipPackSha256],
]) if (actual !== expectedValue) throw new Error(`${name} does not match the public 93bc source pin: ${actual}`);

function glbDocument(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2) throw new Error('Pinned clip pack is not GLB v2');
  let offset = 12;
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    offset += 8;
    if (type === 0x4e4f534a) return JSON.parse(bytes.toString('utf8', offset, offset + length).trim());
    offset += length;
  }
  throw new Error('Pinned clip pack has no JSON chunk');
}
const clipDocument = glbDocument(clipBytes);
const interactClips = (clipDocument.animations ?? []).filter((animation) => animation.name === 'interact');
if (interactClips.length !== 1) throw new Error(`Expected exactly one authored interact clip, found ${interactClips.length}`);
const interactClipDurationSeconds = Math.max(...interactClips[0].samplers.map((sampler) => {
  const maximum = clipDocument.accessors?.[sampler.input]?.max?.[0];
  if (!Number.isFinite(maximum)) throw new Error('Interact clip sampler lacks a finite final timestamp');
  return maximum;
}));
if (!(interactClipDurationSeconds > 0)) throw new Error('Pinned interact clip has no positive duration');

function replaceOnce(source, from, to, label) {
  const at = source.indexOf(from);
  if (at < 0 || source.indexOf(from, at + from.length) >= 0) throw new Error(`Expected one ${label} anchor in frozen fixture`);
  return `${source.slice(0, at)}${typeof to === 'function' ? to() : to}${source.slice(at + from.length)}`;
}

let transformed = fixtureBytes.toString('utf8');
let transformedFactory = factoryBytes.toString('utf8');
let transformedVenue = venueBytes.toString('utf8');
const transformations = [];
const extendLoop = 'for (let frame = 0; frame < 34 && entry?.easing; frame += 1) {';
transformed = replaceOnce(transformed, extendLoop,
  'for (let frame = 0; frame < 110 && entry?.easing; frame += 1) {', '110-frame natural conversation loop');
transformations.push({ id: 'conversation-loop-110', source: extendLoop, diagnostic: 'same action and 1/30s steps; allow 110 active frames (3.667 sample-clock seconds) before normal fixture completion' });

const jawAnchor = 'function nativeJawWeights(root: THREE.Object3D | null): Record<string, number | null> {';
const blinkHelper = `function nativeBlinkWeights(root: THREE.Object3D | null): Record<string, number | null> {
  const body = root?.getObjectByName('Body') as (THREE.Mesh & { morphTargetDictionary?: Record<string, number>; morphTargetInfluences?: number[] }) | undefined;
  const result: Record<string, number | null> = {};
  for (const name of ['nativeFacialBlinkLeft', 'nativeFacialBlinkRight']) {
    const index = body?.morphTargetDictionary?.[name];
    result[name] = Number.isInteger(index) && index! >= 0 ? body?.morphTargetInfluences?.[index!] ?? null : null;
  }
  return result;
}
\n`;
transformed = replaceOnce(transformed, jawAnchor, `${blinkHelper}${jawAnchor}`, 'blink-weight sampler');
transformations.push({ id: 'actual-blink-morph-snapshot', diagnostic: 'read the authored Body blink morph values from the same current NPC mesh' });

const npcSnapshotAnchor = 'gamePose: root?.userData.nativeGameNpcPose ?? null,\n      jaw: nativeJawWeights(root) };';
transformed = replaceOnce(transformed, npcSnapshotAnchor,
  'gamePose: root?.userData.nativeGameNpcPose ?? null,\n      jaw: nativeJawWeights(root), blink: nativeBlinkWeights(root), armLandmarks: nativeArmLandmarks(root),\n      armLocalTransforms: nativeArmLocalTransforms(root), wristTrace: root?.userData.nativeTemporalWristTrace ?? null };', 'NPC current jaw/blink/arm/wrist snapshot');
transformed = replaceOnce(transformed,
  'armLocalTransforms: nativeArmLocalTransforms(root), wristTrace: root?.userData.nativeTemporalWristTrace ?? null };',
  'armLocalTransforms: nativeArmLocalTransforms(root), wristTrace: root?.userData.nativeTemporalWristTrace ?? null,\n      stepMetrics: root?.userData.nativeTemporalStepMetrics ?? null };',
  'current active step metrics');
transformations.push({ id: 'npc-current-jaw-blink-snapshot', diagnostic: 'extend fixture sample with current jaw and both actual blink morph weights' });

const inspectNpcAnchor = '  function inspectNpc(npcId: string) {';
const armHelper = `function nativeArmLandmarks(root: THREE.Object3D | null): Record<string, number[] | null> {
  const names = ['mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigLeftHand',
    'mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand'];
  if (!root) return Object.fromEntries(names.map((name) => [name, null]));
  root.updateWorldMatrix(true, true);
  const inverseRoot = root.matrixWorld.clone().invert();
  return Object.fromEntries(names.map((name) => {
    const bone = root.getObjectByName(name);
    return [name, bone instanceof THREE.Bone ? bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot).toArray() : null];
  }));
}
\n`;
transformed = replaceOnce(transformed, inspectNpcAnchor, `${armHelper}${inspectNpcAnchor}`, 'live actor-local arm landmark sampler');
transformations.push({ id: 'current-actor-local-arm-landmarks', diagnostic: 'read shoulders-independent native arm/forearm/hand world positions in the current actor root frame at each capture' });
const localArmHelper = `function nativeArmLocalTransforms(root: THREE.Object3D | null): Record<string, unknown> {
  const names = ['mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigLeftHand',
    'mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand'];
  return Object.fromEntries(names.map((name) => {
    const bone = root?.getObjectByName(name);
    return [name, bone instanceof THREE.Bone ? { position: bone.position.toArray(), quaternion: bone.quaternion.toArray(), scale: bone.scale.toArray() } : null];
  }));
}
\n`;
transformed = replaceOnce(transformed, inspectNpcAnchor, `${localArmHelper}${inspectNpcAnchor}`, 'live local wrist transform sampler');
transformations.push({ id: 'current-native-local-arm-transforms', diagnostic: 'record live actual local rotations/positions at pre-action idle, active samples, and returned idle for comparison with pre/post wrist-controller stages' });

const contactMethodAnchor = '    performNpcAction,\n    scenePoses: PLAYER_BODY_POSES,';
const contactMethod = `    performNpcAction,
    sampleNpcSoles(npcId: string, phase = 'temporal-capture'): ReturnType<typeof sampleNativeNpcSoles> {
      if (!entry) throw new Error('Office venue entry is unavailable during temporal shoe sampling');
      const npcRoot = entry.group.getObjectByName(\`canonical-crowd:npc:\${npcId}\`);
      if (!npcRoot) throw new Error(\`Canonical NPC \${npcId} is not mounted during temporal shoe sampling\`);
      return sampleNativeNpcSoles(npcRoot, entry, phase);
    },
    scenePoses: PLAYER_BODY_POSES,`;
transformed = replaceOnce(transformed, contactMethodAnchor, contactMethod, 'actual-skinned-shoe diagnostic seam');
transformations.push({ id: 'read-only-current-shoe-geometry-seam', diagnostic: 'call the existing full deformed authored-shoe sampler and floor callback without changing pose/placement' });

const soleMatrixAnchor = "  return { npcId: root.name.replace(/^canonical-crowd:npc:/, ''), phase,\n    sampleFrame: 'post-placement current native skinned-shoe geometry and actor matrices',";
const soleMatrixReplacement = `  const footBoneMatrices = Object.fromEntries(['mixamorigLeftFoot', 'mixamorigLeftToeBase',
    'mixamorigRightFoot', 'mixamorigRightToeBase'].map((name) => {
    const bone = root.getObjectByName(name);
    return [name, bone instanceof THREE.Bone ? { matrixWorld: bone.matrixWorld.toArray(),
      position: bone.position.toArray(), quaternion: bone.quaternion.toArray(),
      quaternionNorm: bone.quaternion.length(), scale: bone.scale.toArray() } : null];
  }));
  return { npcId: root.name.replace(/^canonical-crowd:npc:/, ''), phase, footBoneMatrices,
    sampleFrame: 'post-placement current native skinned-shoe geometry and actor matrices',`;
transformed = replaceOnce(transformed, soleMatrixAnchor, soleMatrixReplacement, 'current full foot/toe matrices');
transformations.push({ id: 'current-foot-toe-matrix-witness', diagnostic: 'record post-update world matrices and local transforms for both feet/toes at every temporal sole capture' });

const metricsAnchor = '    let talkLoopFrames = 0, talkLoopSynchronized = true;\n    for (let frame = 0; frame < 110 && entry?.easing; frame += 1) {';
const metricsReplacement = `    let talkLoopFrames = 0, talkLoopSynchronized = true;
    const talkLoopFrameMetrics: Array<{ frame: number; sourceSeconds: number; stepMs: number; frameWorkMs: number }> = [];
    window.__nativeTemporalLoopProgress = { npcId, frame: 0, sourceSeconds: 0 };
    for (let frame = 0; frame < 110 && entry?.easing; frame += 1) {`;
transformed = replaceOnce(transformed, metricsAnchor, metricsReplacement, 'per-step metric initialization');
const stepAnchor = `      entry.stepCrowd(1 / 30);
      const weights = nativeJawWeights(entry.group.getObjectByName(\`canonical-crowd:npc:\${npcId}\`) ?? null);`;
const stepReplacement = `      const stepStartedAt = performance.now();
      entry.stepCrowd(1 / 30);
      const stepMs = performance.now() - stepStartedAt;
      const weights = nativeJawWeights(entry.group.getObjectByName(\`canonical-crowd:npc:\${npcId}\`) ?? null);`;
transformed = replaceOnce(transformed, stepAnchor, stepReplacement, 'stepCrowd measured-call timer');
const drawAnchor = `      talkLoopFrames += 1;
      draw();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 33));`;
const drawReplacement = `      talkLoopFrames += 1;
      const drawStartedAt = performance.now();
      draw();
      const drawMs = performance.now() - drawStartedAt;
      const frameMetric = { frame: talkLoopFrames, sourceSeconds: talkLoopFrames / 30, stepMs, drawMs,
        frameWorkMs: performance.now() - stepStartedAt };
      talkLoopFrameMetrics.push(frameMetric);
      window.__nativeTemporalLoopProgress = { npcId, ...frameMetric };
      await new Promise<void>((resolve) => window.setTimeout(resolve, 33));`;
transformed = replaceOnce(transformed, drawAnchor, drawReplacement, 'per-step frame metric capture');
transformations.push({ id: 'step-and-frame-work-timing', diagnostic: 'record 1/30 venue step duration separately from aggregate step/gesture/draw frame work' });

const returnActionAnchor = '      talkLoopStarted, talkLoopFrames, jawBefore, jawPeak, jawAfter, talkLoopSynchronized, jawRestored,';
transformed = replaceOnce(transformed, returnActionAnchor,
  '      talkLoopStarted, talkLoopFrames, talkLoopFrameMetrics, jawBefore, jawPeak, jawAfter, talkLoopSynchronized, jawRestored,',
  'action loop timing report');

const clickActionAnchor = '          void performNpcAction(npc.id, action.activity).catch((error: unknown) => {';
transformed = replaceOnce(transformed, clickActionAnchor,
  `          window.__nativeTemporalActionError = null;
          window.__nativeTemporalHandlerDone = false;
          window.__nativeTemporalPlayerActionStartedAt = performance.now();
          window.__nativeTemporalPlayerActionFinishedAt = null;
          window.__nativeTemporalLoopProgress = null;
          const actionPromise = performNpcAction(npc.id, action.activity);
          window.__nativeTemporalActionPromise = actionPromise;
          void actionPromise.catch((error: unknown) => {
            window.__nativeTemporalActionError = error instanceof Error ? error.message : String(error);`,
  'actual player NPC-card action promise capture');
const handlerDoneAnchor = `              updateDom(); draw();
            }
          });`;
transformed = replaceOnce(transformed, handlerDoneAnchor,
  `              updateDom(); draw();
            }
            window.__nativeTemporalPlayerActionFinishedAt = performance.now();
            window.__nativeTemporalHandlerDone = true;
          });`, 'player action handler restoration completion marker');
transformations.push({ id: 'actual-player-action-handler', diagnostic: 'click the existing offered NPC card action; record its promise and completion after its normal player-mode restoration' });

const lookAnchor = `        source: regulars.find((npc) => npc.id === id) ? 'viewLife(createLife(...)).social.here' : 'missing',
        actions: regulars.find((npc) => npc.id === id)?.actions ?? [],`;
transformed = replaceOnce(transformed, lookAnchor,
  `        source: regulars.find((npc) => npc.id === id) ? 'viewLife(createLife(...)).social.here' : 'missing',
        look: regulars.find((npc) => npc.id === id)?.look ?? null,
        actions: regulars.find((npc) => npc.id === id)?.actions ?? [],`, 'actual NPC look inventory');
transformations.push({ id: 'npc-look-readout', diagnostic: 'report only the exact two current life-view look values; no admission or coverage expansion' });

function replaceFactoryOnce(source, from, to, label) {
  const at = source.indexOf(from);
  if (at < 0 || source.indexOf(from, at + from.length) >= 0) throw new Error(`Expected one factory ${label} anchor in frozen source`);
  return `${source.slice(0, at)}${to}${source.slice(at + from.length)}`;
}
const localTransformHelper = `function nativeTemporalWristTransforms(root: THREE.Group): Record<string, unknown> {
  const names = ['mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigLeftHand',
    'mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand'];
  return Object.fromEntries(names.map((name) => {
    const bone = root.getObjectByName(name);
    return [name, bone instanceof THREE.Bone ? { position: bone.position.toArray(), quaternion: bone.quaternion.toArray(), scale: bone.scale.toArray() } : null];
  }));
}
\n`;
transformedFactory = replaceFactoryOnce(transformedFactory,
  'function createPosePort(root: THREE.Group, sampler:', `${localTransformHelper}function createPosePort(root: THREE.Group, sampler:`, 'local wrist transform helper');
transformedFactory = replaceFactoryOnce(transformedFactory,
  '          neutralPose.apply();\n          if (context.pose === \'interact\') {',
  `          neutralPose.apply();
          if (context.pose === 'interact' && Reflect.get(globalThis, '__nativeTemporalTraceWrist') === true) {
            root.userData.nativeTemporalWristTrace = { clipName: frame.clipName, sampleSeconds: context.seconds, duration: frame.duration,
              stages: { correctedNeutral: nativeTemporalWristTransforms(root) } };
          }
          if (context.pose === 'interact') {`, 'corrected-neutral wrist snapshot');
transformedFactory = replaceFactoryOnce(transformedFactory,
  '            interactionGesture.apply(frame);',
  `            interactionGesture.apply(frame);
            if (Reflect.get(globalThis, '__nativeTemporalTraceWrist') === true) {
              const trace = root.userData.nativeTemporalWristTrace as { stages?: Record<string, unknown> } | undefined;
              if (trace?.stages) trace.stages.afterGesture = nativeTemporalWristTransforms(root);
            }`, 'post-gesture wrist snapshot');
transformedFactory = replaceFactoryOnce(transformedFactory,
  '      if (!(directionRetargeter && context.pose === \'idle\' && context.clip === \'idle\' && support.kind === \'flat-feet\')) wrists.apply(frame);',
  `      const temporalWristTraceEnabled = context.pose === 'interact' && Reflect.get(globalThis, '__nativeTemporalTraceWrist') === true;
      const temporalWristTrace = temporalWristTraceEnabled
        ? root.userData.nativeTemporalWristTrace as { stages?: Record<string, unknown>; wristControllerResult?: unknown } | undefined : undefined;
      if (temporalWristTrace?.stages) temporalWristTrace.stages.beforeWristController = nativeTemporalWristTransforms(root);
      if (!(directionRetargeter && context.pose === 'idle' && context.clip === 'idle' && support.kind === 'flat-feet')) {
        const wristControllerResult = wrists.apply(frame);
        if (temporalWristTrace?.stages) {
          temporalWristTrace.stages.afterWristController = nativeTemporalWristTransforms(root);
          temporalWristTrace.wristControllerResult = wristControllerResult;
        }
      }`, 'before/after wrist controller snapshots');
transformations.push({ id: 'before-after-native-wrist-controller-stages', diagnostic: 'instrument the in-memory public factory only, reading actual six shoulder/arm/forearm/hand local transforms at corrected-neutral, post-gesture, pre/post-wrist-controller stages when the external diagnostic flag is enabled' });

const activeTalkStep = `      actor.body.sampleUse('interact', actor.interactionSeconds);
      solveNativeNpcFeetOnVenueFloor(actor);
      actor.talk.step(delta);`;
const timedActiveTalkStep = `      const temporalMetrics = Reflect.get(globalThis, '__nativeTemporalTraceWrist') === true
        ? (actor.body.object.userData.nativeTemporalStepMetrics ??= { npcId: id,
          sampleUseCalls: 0, sampleUseTotalMs: 0, sampleUseMaxMs: 0,
          contactSolveCalls: 0, contactSolveTotalMs: 0, contactSolveMaxMs: 0,
          expressionStepCalls: 0, expressionStepTotalMs: 0, expressionStepMaxMs: 0 }) as Record<string, number | string>
        : null;
      const measureTemporalCall = (callsKey: string, totalKey: string, maxKey: string, call: () => void) => {
        if (!temporalMetrics) { call(); return; }
        const start = performance.now(); call(); const duration = performance.now() - start;
        temporalMetrics[callsKey] = Number(temporalMetrics[callsKey]) + 1;
        temporalMetrics[totalKey] = Number(temporalMetrics[totalKey]) + duration;
        temporalMetrics[maxKey] = Math.max(Number(temporalMetrics[maxKey]), duration);
      };
      measureTemporalCall('sampleUseCalls', 'sampleUseTotalMs', 'sampleUseMaxMs', () => actor.body.sampleUse('interact', actor.interactionSeconds));
      measureTemporalCall('contactSolveCalls', 'contactSolveTotalMs', 'contactSolveMaxMs', () => solveNativeNpcFeetOnVenueFloor(actor));
      measureTemporalCall('expressionStepCalls', 'expressionStepTotalMs', 'expressionStepMaxMs', () => actor.talk.step(delta));`;
transformedVenue = replaceFactoryOnce(transformedVenue, activeTalkStep, timedActiveTalkStep, 'live NPC step timing');
transformations.push({ id: 'live-venue-step-timings', diagnostic: 'instrument actual active native source pose, contact solve, and expression clock at the existing venue 1/30 step; per-actor call counts/totals/maxima are collected only after the external diagnostic flag is enabled' });

await stat(path.dirname(outfile));
const plugin = {
  name: 'public-93bc-temporal-fixture-instrumentation',
  setup(build) {
    build.onLoad({ filter: /game-fixture\.ts$/ }, async (args) => {
      if (path.resolve(args.path) !== fixture) return null;
      return { contents: transformed, loader: 'ts', resolveDir: path.dirname(fixture) };
    });
    build.onLoad({ filter: /native-prepared-factory\.ts$/ }, async (args) => {
      if (path.resolve(args.path) !== factory) return null;
      return { contents: transformedFactory, loader: 'ts', resolveDir: path.dirname(factory) };
    });
    build.onLoad({ filter: /venue-scenes\.ts$/ }, async (args) => {
      if (path.resolve(args.path) !== venueScenes) return null;
      return { contents: transformedVenue, loader: 'ts', resolveDir: path.dirname(venueScenes) };
    });
    build.onResolve({ filter: /\?url$/ }, (args) => {
      const asset = path.resolve(args.resolveDir, args.path.slice(0, -4));
      const relative = path.relative(repo, asset);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Asset escaped frozen repo: ${args.path}`);
      return { path: asset, namespace: 'native-temporal-asset-url' };
    });
    build.onLoad({ filter: /.*/, namespace: 'native-temporal-asset-url' }, (args) => {
      const relative = path.relative(repo, args.path).split(path.sep).join('/');
      return { contents: `export default ${JSON.stringify(`/${relative}`)};`, loader: 'js' };
    });
  },
};
const result = await esbuild.build({ absWorkingDir: repo, entryPoints: [fixture], outfile, bundle: true, format: 'esm',
  platform: 'browser', target: ['es2022'], packages: 'bundle', splitting: false, sourcemap: false, legalComments: 'none',
  logLevel: 'silent', plugins: [plugin] });
if (result.errors.length) throw new Error(result.errors.map((error) => error.text).join('\n'));
const built = await readFile(outfile);
const manifest = { schema: 'native-office-temporal-instrumentation.v1', sourceHead: '93bc1acc87dc7e80373910d20a25daf6078e5b24',
  sourcePath: path.relative(repo, fixture), expectedSourceSha256: expected.fixtureSha256,
  controllerPath: path.relative(repo, controller), controllerSha256: expected.controllerSha256,
  factoryPath: path.relative(repo, factory), factorySha256: hash(factoryBytes),
  venueScenesPath: path.relative(repo, venueScenes), venueScenesSha256: hash(venueBytes),
  clipPackPath: path.relative(repo, clipPack), clipPackSha256: expected.clipPackSha256,
  instrumentationOnlyExternalBundle: true, interactClipDurationSeconds, output: outfile, outputBytes: built.length,
  outputSha256: hash(built), transformations };
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ status: 'instrumented-bundle-built', ...manifest }, null, 2));
