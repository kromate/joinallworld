from pathlib import Path

root = Path(__file__).resolve().parents[6]
recipe = Path(__file__).resolve().parent
runner = (recipe / 'run-bounded-linux-render-npc-v3.py').read_text()
workflow = (recipe / 'workflow-review-npc-v3.yml').read_text()
controller = (recipe / 'review-render-cdp-npc-v3.mjs').read_text()
assert 'MAX_RSS_BYTES = 2048 * 1024 * 1024' in runner
assert 'TIMEOUT_SECONDS = 60' in runner
assert "NODE = ['node', '--max-old-space-size=96']" in runner
assert "max-parallel: 3" in workflow
assert all(f'{place}-{method}' in workflow for place in ('market', 'beach') for method in ('surface-true', 'surface-false', 'canvas-clip'))
assert 'pre-capture-readiness-proof' in controller
assert "'Page.captureScreenshot'" in controller
assert 'screenshot-method-failed' in controller
assert 'elapsedMs: Number(process.hrtime.bigint() - controllerStartedHrNs) / 1e6' in controller
assert 'transitionElapsedMs: transitioned.elapsedMs' in controller
assert "if (!identityChecks.productionRuntime || !strict.valid" in controller
assert "capture-start" in controller and "capture-return" in controller
assert "continuingToPeerTransition: true" in controller
assert "target-review-failed-peer-transition-observed" in controller
assert "requestedElapsedMs" in controller and "settledElapsedMs" in controller
preflight = (recipe / 'preflight-package-artifact-npc-v3.mjs').read_text()
workflow_active = '.github/workflows/graphics-environment-npc-startup-fix-v1-render-v3.yml'
assert f"WORKFLOW_ACTIVE = Path('{workflow_active}')" in runner
assert 'cpu-source-input' in workflow and "path: cpu-source-input" in workflow
assert 'ref: 0da02ca0f0e0c4350f2754615f58b2dcd6eaed37' in workflow
assert 'npm ci --prefix cpu-source-input --no-audit --no-fund' in workflow
assert 'CPU_SOURCE_ROOT: cpu-source-input' in workflow
assert 'preflight-package-artifact-npc-v3.mjs' in workflow
assert workflow.index('Download the explicitly selected CPU package artifact') < workflow.index('Verify every package output and all source pins against the sealed CPU checkout before Chrome') < workflow.index('Record runner Chrome identity')
assert 'PINNED_CPU_SOURCE_PINS_SHA' in preflight and 'root-local-integration.json' in preflight and 'root-integrated-startup-tests.log' in preflight
assert 'inside(CPU_SOURCE_ROOT, item.path)' in controller and 'inside(CPU_SOURCE_ROOT, startupIntegrationPath)' in controller
assert 'reviewPins.cpuSourceCheckout?.sourcePinsSha256 !== sourcePinsSha' in controller
print('NPC v3 source checkout, pre-Chrome package preflight, and renderer contracts: PASS')
