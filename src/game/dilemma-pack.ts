/**
 * OWNER: career + social
 * The kit of work dilemmas and place actions (type DilemmaKit, src/game/features.ts), installed when this file is imported. It is the only way the
 * words and rules of src/game/{dilemmas,place-actions}.ts and src/game/content/{dilemmas,place-actions}.ts reach the engine, and the engine never
 * imports it: vite.config.ts builds those files as one lazy `dilemmas` chunk, so a page that does not use them downloads none of it.
 *
 *   servers, Worker, tests   import this file (a bare import is enough); the DILEMMAS switch then decides whether the kit is used
 *   browser                  `?models=dilemmas` fetches it and calls switchOnDilemmas() (src/app/startExtras.ts); the Career tab's card fetches the words alone
 */
import { DILEMMA_CHANCE, dilemmaById } from './content/dilemmas.ts';
import { choiceOf, pickDilemma, resolveDilemma } from './dilemmas.ts';
import { installDilemmaKit, setFeature } from './features.ts';
import type { DilemmaKit } from './features.ts';
import { isAfterService, placeActionById, placeActionsFor, placeKindOf } from './place-actions.ts';

export const DILEMMA_KIT: DilemmaKit = {
  chance: DILEMMA_CHANCE,
  byId: dilemmaById,
  pick: pickDilemma,
  resolve: resolveDilemma,
  choiceOf,
  placeKindOf,
  placeActionsFor: (npc, cityId, now) => placeActionsFor(npc, placeKindOf(cityId, npc.venue), now),
  placeActionById,
  isAfterService,
};

installDilemmaKit(DILEMMA_KIT);

/** The browser, once the kit has loaded: turn the switch on for this page. */
export const switchOnDilemmas = (): void => { setFeature('dilemmas', true); };
