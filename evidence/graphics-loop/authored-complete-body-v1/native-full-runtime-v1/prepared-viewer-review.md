# Prepared native factory playground

This page is an isolated browser harness for the real `prepareNativeSkinnedBody` factory. It prepares the casual male player and office female NPC from one shared Kit, mounts both into one lit Three.js scene, and drives the factory's idle/walk/interact pose APIs. The NPC can receive a same-family face and palette change, while a host loop cycles its authored neutral/smile/grin expressions through the factory's same-family `wear` bridge.

The page reports current actor metrics through `window.nativePreparedReview.sample()` and exposes `ready`, `setPose`, `toggleWalking`, `toggleExpressionCycle`, `interact`, `changeNpcIdentityAndPalette`, and `probeUnsupportedPose`. Failed API calls appear in the page error log and in the sample's `errors` field. The contact-limit probe reports its residual and the factory's declared limitations; it does not claim prone body support. The setup panel lists the source warning and known contact constraints.

Run the browser review on a remote Linux runner with Node 24, `npm ci` dependencies, and preinstalled Chrome/Chromium. From the repository root:

```sh
npm ci --no-audit --no-fund
node --max-old-space-size=96 evidence/graphics-loop/authored-complete-body-v1/native-full-runtime-v1/bundle-prepared-viewer.mjs
CHROME_BIN="$(command -v google-chrome || command -v google-chrome-stable || command -v chromium)" \
  node --max-old-space-size=48 evidence/graphics-loop/authored-complete-body-v1/native-full-runtime-v1/render-prepared-viewer.mjs
```

The isolated strict TypeScript check is `node_modules/.bin/vue-tsc --noEmit --pretty false -p evidence/graphics-loop/authored-complete-body-v1/native-full-runtime-v1/native-prepared-viewer.typecheck.json`.

The render script serves the repository on loopback, opens the page in headless Chrome with SwiftShader WebGL, applies the same-family NPC face/color update, exercises the explicit interaction animation, captures a 1440×1120 PNG and pre-probe JSON metrics, then probes the declared lie/contact limit separately and verifies the NPC returns to idle. The pre-probe gate requires zero page errors, zero shader/browser console errors, and per-actor sampled contact residuals at or below 4 mm. Distinct contact-limit events retain residual values in the UI and report. The bundle is removed after capture. Upload `evidence/graphics-loop/authored-complete-body-v1/native-full-runtime-v1/remote-results/<run-id>/` as the CI artifact. The runner writes `prepared-viewer.png` and `prepared-review.json`.

The local task does not build this page or launch a browser. The harness is not production integration and its screenshot is a review artifact, not visual acceptance. Verify the browser console, interaction outcome, screenshot, current contact residuals, and `preparedMetrics` in the uploaded JSON before adopting the page's result.
