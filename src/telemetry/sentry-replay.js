/**
 * Session replay for sessions that hit an error — OFF by default, and its code is a separate chunk
 * that is downloaded only when the server sets TELEMETRY_REPLAY_ON_ERROR=1. Everything a player
 * could have typed or read is masked, media is blocked, and the game canvases are never recorded
 * (the canvas-recording integration is not installed, and canvases are blocked as elements too).
 */
import { replayIntegration } from '@sentry/browser';

export const replay = () => replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true, block: ['canvas'], networkDetailAllowUrls: [] });
