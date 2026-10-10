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

for (const [npcId, activity] of activities) {
  const samples = activity?.nativeShoeContactEvidence;
  if (!Array.isArray(samples) || samples.length !== expectedPhases.length) {
    failures.push(`${npcId}: expected three native shoe contact samples`);
    continue;
  }
  if (samples.map((sample) => sample.phase).join('|') !== expectedPhases.join('|')) {
    failures.push(`${npcId}: contact phases do not cover placement idle, interaction, and returned idle`);
  }
  for (const sample of samples) {
    if (sample.npcId !== npcId) failures.push(`${npcId}/${sample.phase}: sample identity mismatch`);
    if (sample.contactCallback !== 'SceneEntry.walk.contactHeightAt') failures.push(`${npcId}/${sample.phase}: wrong host surface callback`);
    if (!finite(sample.contactTargetClearanceMeters) || sample.contactTargetClearanceMeters < 0) {
      failures.push(`${npcId}/${sample.phase}: missing callback target clearance`);
    }
    if (!Array.isArray(sample.sides) || sample.sides.length !== 2) {
      failures.push(`${npcId}/${sample.phase}: expected both shoe sides`);
      continue;
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
      const legReachPass = finite(legReach?.requestedAnkleReach) && finite(legReach?.maximumLegReach)
        && legReach.requestedAnkleReach <= legReach.maximumLegReach + 0.002;
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
        requestedAnkleReach: legReach?.requestedAnkleReach, maximumLegReach: legReach?.maximumLegReach,
        nativeLegReachPass: legReachPass });
    }
  }
}

const result = { schema: 'joinallworld.native-npc-shoe-contact-check.v1', status: failures.length ? 'fail' : 'pass', reportPath, summary, failures };
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
