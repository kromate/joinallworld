import { createGame } from './game.js';

const PROGRESS_KEY = 'allworld-progress-v1';
const DEFAULT_NAME = 'New Lagosian';
const START = { x: 0, z: 16 };
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function read(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function parse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function cleanName(value) {
  return typeof value === 'string' ? value.trim().slice(0, 24) || DEFAULT_NAME : DEFAULT_NAME;
}

function cleanPosition(value) {
  if (!isRecord(value) || !Number.isFinite(value.x) || !Number.isFinite(value.z)
    || value.x < -55 || value.x > 55 || value.z < -40 || value.z > 40) {
    return { ...START };
  }
  const inWater = value.z >= -3.3 && value.z <= 7.2;
  const onBridge = Math.abs(value.x + 15) <= 2.1 || Math.abs(value.x - 20) <= 2.1;
  return inWater && !onBridge ? { ...START } : { x: value.x, z: value.z };
}

/** Read current progress or legacy keys without writing; storage failures return safe defaults. */
export function loadProgress(storage) {
  const parsed = parse(read(storage, PROGRESS_KEY));
  const envelope = isRecord(parsed) ? parsed : {};
  const legacyGame = parse(read(storage, 'allworld-save-v1'));
  const game = isRecord(envelope.game) ? envelope.game : legacyGame;
  const name = typeof envelope.name === 'string' ? envelope.name : read(storage, 'allworld-name');
  return {
    game: createGame(game),
    name: cleanName(name),
    position: cleanPosition(envelope.position),
  };
}

/** Save one validated envelope atomically. Return false if storage cannot accept it. */
export function saveProgress(storage, progress) {
  try {
    const input = isRecord(progress) ? progress : {};
    const envelope = {
      game: createGame(input.game),
      name: cleanName(input.name),
      position: cleanPosition(input.position),
    };
    storage.setItem(PROGRESS_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}
