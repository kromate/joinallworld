import { readFile } from 'node:fs/promises';

const reportPath = process.argv[2];
if (!reportPath) throw new Error('Usage: node check-native-npc-foot-contact.mjs <office-game-fixture-report.json>');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const activities = [
  ['mrs-okafor', report.npcInteraction],
  ['dapo', report.dapoInteraction],
];
const expectedPhases = ['canonical-placement-idle', 'during-interaction', 'returned-idle-after-interaction'];
const failures = [];
const summary = [];

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function validateRawSoleSample(sample, label) {
  if (!finite(sample?.contactTargetClearanceMeters) || sample.contactTargetClearanceMeters < 0) {
    failures.push(`${label}: missing finite callback clearance offset`);
    return false;
  }
  if (!Array.isArray(sample?.sides) || sample.sides.length !== 2) {
    failures.push(`${label}: expected exactly two post-solve shoe sides`);
    return false;
  }
  const ids = sample.sides.map((side) => side.side);
  if (new Set(ids).size !== 2 || !['left', 'right'].every((side) => ids.includes(side))) {
    failures.push(`${label}: expected exact left/right shoe IDs`);
    return false;
  }
  let pass = true;
  for (const side of sample.sides) {
    const sideLabel = `${label}/${side.side}`;
    const points = side.deformedSoleSamples;
    if (!Array.isArray(points) || points.length === 0 || points.length !== side.soleCandidateCount) {
      failures.push(`${sideLabel}: missing complete post-solve authored sole samples`);
      pass = false;
      continue;
    }
    const gaps = [];
    for (const point of points) {
      if (![point.x, point.y, point.z, point.callbackTargetY, point.sceneFloorY].every(finite)) {
        failures.push(`${sideLabel}: incomplete/non-finite post-solve host surface sample`);
        pass = false;
        continue;
      }
      const expectedFloor = point.callbackTargetY - sample.contactTargetClearanceMeters;
      const physicalGap = point.y - point.sceneFloorY;
      if (Math.abs(point.sceneFloorY - expectedFloor) > 1e-9
        || Math.abs(point.gapToSceneFloor - physicalGap) > 1e-9) {
        failures.push(`${sideLabel}: inconsistent callback clearance or physical floor gap`);
        pass = false;
      }
      gaps.push(physicalGap);
    }
    if (gaps.length !== points.length) { pass = false; continue; }
    const nearest = Math.min(...gaps.map(Math.abs)), minimum = Math.min(...gaps);
    if (nearest > 0.004 || minimum < -0.004) {
      failures.push(`${sideLabel}: post-solve shoe oracle misses 4 mm floor limits`);
      pass = false;
    }
  }
  return pass;
}

const refresh = report.finalSnapshot?.nativeNpcRefreshWitness;
if (refresh?.status !== 'pass' || refresh.identityPreserved !== true || !Array.isArray(refresh.actors)
  || refresh.actors.length !== 2) failures.push('same-identity refresh/reposition/repeated-solve witness failed');
if (Array.isArray(refresh?.actors)) for (const actor of refresh.actors) {
  const label = `refresh/${actor.id}`;
  if (!['mrs-okafor', 'dapo'].includes(actor.id) || actor.identityPreserved !== true
    || actor.seedBefore !== actor.seedAfter || !finite(actor.repositionMeters) || actor.repositionMeters <= 0.05
    || !finite(actor.solveAttemptsBefore) || !finite(actor.solveAttemptsAfter)
    || actor.solveAttemptsAfter <= actor.solveAttemptsBefore || actor.repeatedSolve !== true
    || actor.solverStatus !== 'pass' || actor.postSolveContactPass !== true) {
    failures.push(`${label}: identity, reposition, repeated solve, or post-solve floor oracle failed`);
  }
  validateRawSoleSample(actor.soleEvidence, label);
}

for (const [npcId, activity] of activities) {
  const samples = activity?.nativeShoeContactEvidence;
  if (!Array.isArray(samples) || samples.length !== expectedPhases.length) {
    failures.push(`${npcId}: expected three native shoe contact samples`);
    continue;
  }
  if (samples.map((sample) => sample.phase).join('|') !== expectedPhases.join('|')) {
    failures.push(`${npcId}: contact phases do not cover placement idle, interaction, and returned idle`);
  }
  const solveAttempts = samples.map((sample) => sample.nativeVenueFootContactSolve?.attempts);
  if (!solveAttempts.every(finite) || !(solveAttempts[0] < solveAttempts[1] && solveAttempts[1] < solveAttempts[2])) {
    failures.push(`${npcId}: same identity refresh and pose changes did not produce repeated native solves`);
  }
  for (const sample of samples) {
    if (sample.npcId !== npcId) failures.push(`${npcId}/${sample.phase}: sample identity mismatch`);
    if (sample.contactCallback !== 'SceneEntry.walk.contactHeightAt') failures.push(`${npcId}/${sample.phase}: wrong host surface callback`);
    const hostSolve = sample.nativeVenueFootContactSolve;
    const expectedPose = sample.phase === 'during-interaction' ? 'interact' : 'idle';
    if (!hostSolve || hostSolve.pose !== expectedPose || !finite(hostSolve.sampledPointCount)
      || hostSolve.sampledPointCount <= 0 || !finite(hostSolve.maxError)
      || hostSolve.corrected !== 2 || hostSolve.limited !== false
      || hostSolve.status !== 'pass' || hostSolve.physicalOraclePass !== true
      || hostSolve.targetClearanceMeters !== 0.016) {
      failures.push(`${npcId}/${sample.phase}: missing post-mount native host solve evidence`);
    }
    if (hostSolve) {
      const measured = validateRawSoleSample(sample, `${npcId}/${sample.phase}/fixture`);
      const hostSides = hostSolve.sides;
      if (!Array.isArray(hostSides) || hostSides.length !== 2) {
        failures.push(`${npcId}/${sample.phase}: native helper omitted post-solve shoe oracle sides`);
      } else for (const hostSide of hostSides) {
        const fixtureSide = sample.sides?.find((side) => side.side === hostSide.side);
        if (!fixtureSide || hostSide.coverageComplete !== true || hostSide.withinPhysicalTolerance !== true
          || hostSide.withinReach !== true || !finite(hostSide.nearestAbsolutePhysicalGap)
          || !finite(hostSide.minimumSignedPhysicalGap)
          || hostSide.candidateCount !== fixtureSide.deformedSoleSamples?.length) {
          failures.push(`${npcId}/${sample.phase}/${hostSide.side}: native helper post-solve oracle failed`);
          continue;
        }
        const fixtureGaps = fixtureSide.deformedSoleSamples.map((point) => point.gapToSceneFloor);
        const nearest = Math.min(...fixtureGaps.map(Math.abs)), minimum = Math.min(...fixtureGaps);
        if (Math.abs(nearest - hostSide.nearestAbsolutePhysicalGap) > 1e-9
          || Math.abs(minimum - hostSide.minimumSignedPhysicalGap) > 1e-9) {
          failures.push(`${npcId}/${sample.phase}/${hostSide.side}: helper oracle differs from actual deformed-shoe fixture samples`);
        }
      }
      if (!measured) failures.push(`${npcId}/${sample.phase}: fixture post-solve oracle failed`);
    }
    if (!finite(sample.contactTargetClearanceMeters) || sample.contactTargetClearanceMeters < 0) {
      failures.push(`${npcId}/${sample.phase}: missing callback target clearance`);
    }
    if (!Array.isArray(sample.sides) || sample.sides.length !== 2) {
      failures.push(`${npcId}/${sample.phase}: expected both shoe sides`);
      continue;
    }
    const sideIds = sample.sides.map((side) => side.side);
    if (new Set(sideIds).size !== 2 || !['left', 'right'].every((side) => sideIds.includes(side))) {
      failures.push(`${npcId}/${sample.phase}: expected exactly left and right shoe IDs`);
    }
    for (const side of sample.sides) {
      const label = `${npcId}/${sample.phase}/${side.side}`;
      const points = side.deformedSoleSamples;
      if (!Array.isArray(points) || points.length === 0 || points.length !== side.soleCandidateCount) {
        failures.push(`${label}: missing complete deformed sole samples`);
        continue;
      }
      let supportCoverageComplete = true;
      const physicalGaps = [];
      const callbackResiduals = [];
      for (const point of points) {
        if (![point.x, point.y, point.z].every(finite)) {
          failures.push(`${label}: non-finite deformed sole vertex`);
          supportCoverageComplete = false;
          continue;
        }
        if (!finite(point.callbackTargetY) || !finite(point.sceneFloorY)
          || !finite(point.errorToCallbackTarget) || !finite(point.gapToSceneFloor)) {
          supportCoverageComplete = false;
          continue;
        }
        const expectedFloorY = point.callbackTargetY - sample.contactTargetClearanceMeters;
        if (Math.abs(point.sceneFloorY - expectedFloorY) > 1e-9) failures.push(`${label}: reported floor does not match callback offset`);
        if (Math.abs(point.errorToCallbackTarget - (point.y - point.callbackTargetY)) > 1e-9) {
          failures.push(`${label}: callback residual is inconsistent with sampled geometry`);
        }
        if (Math.abs(point.gapToSceneFloor - (point.y - point.sceneFloorY)) > 1e-9) {
          failures.push(`${label}: physical floor gap is inconsistent with sampled geometry`);
        }
        physicalGaps.push(point.gapToSceneFloor);
        callbackResiduals.push(point.errorToCallbackTarget);
      }
      if (!supportCoverageComplete) failures.push(`${label}: host surface support coverage is incomplete or non-finite`);
      const nearestAbsolutePhysicalGap = physicalGaps.length ? Math.min(...physicalGaps.map(Math.abs)) : null;
      const minimumSignedPhysicalGap = physicalGaps.length ? Math.min(...physicalGaps) : null;
      const nearestAbsoluteCallbackResidual = callbackResiduals.length ? Math.min(...callbackResiduals.map(Math.abs)) : null;
      const legReach = side.nativeLegReach;
      const legReachPass = finite(legReach?.physicalVerticalCorrection) && finite(legReach?.physicalRequestedAnkleReach)
        && finite(legReach?.maximumLegReach)
        && legReach.physicalRequestedAnkleReach <= legReach.maximumLegReach + 0.002;
      if (!legReachPass) failures.push(`${label}: floor-corrected ankle exceeds measured native leg reach`);
      if (nearestAbsolutePhysicalGap === null || nearestAbsolutePhysicalGap > 0.004) {
        failures.push(`${label}: no sole candidate lies within 4 mm of the callback-derived scene floor`);
      }
      if (minimumSignedPhysicalGap === null || minimumSignedPhysicalGap < -0.004) {
        failures.push(`${label}: a deformed sole candidate penetrates the scene floor by more than 4 mm`);
      }
      summary.push({ npcId, phase: sample.phase, side: side.side,
        candidateCount: points.length, callbackCoverageComplete: supportCoverageComplete,
        nearestAbsoluteCallbackResidual, nearestAbsolutePhysicalGap, minimumSignedPhysicalGap,
        withinFourMillimeters: nearestAbsolutePhysicalGap !== null && nearestAbsolutePhysicalGap <= 0.004
          && minimumSignedPhysicalGap !== null && minimumSignedPhysicalGap >= -0.004,
        physicalVerticalCorrection: legReach?.physicalVerticalCorrection,
        physicalRequestedAnkleReach: legReach?.physicalRequestedAnkleReach,
        callbackVerticalCorrection: legReach?.callbackVerticalCorrection,
        callbackRequestedAnkleReach: legReach?.callbackRequestedAnkleReach,
        maximumLegReach: legReach?.maximumLegReach,
        nativeLegReachPass: legReachPass });
    }
  }
}

const result = { schema: 'joinallworld.native-npc-shoe-contact-check.v1', status: failures.length ? 'fail' : 'pass', reportPath, summary, failures };
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
