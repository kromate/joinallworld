# scene-talk-20261020

Goal: talking to an NPC in the 3D scene: approach, face each other, greeting gesture, clean end.
Branch: scene/talk (from design/all 3e0f0c267). Port 5483.
Owned paths: src/scene/ambient/layer.ts (+test), src/app/scene/talkStance.ts (+test); 3 lines in src/app/scene/ScenePane.vue (claimed by scene-tap, see requests.md).
Evidence: typecheck clean; layer + talkStance tests pass (3 layer tests fail before and after my change); build:slot and size:download overBudget 0.
Next step: confirm in a browser that tapping a resident opens the card and the person turns (the capture did not show a card open).
