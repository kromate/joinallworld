from pathlib import Path

root = Path(__file__).resolve().parents[6]
recipe = Path(__file__).resolve().parent
runner = (recipe / 'run-bounded-linux-render-npc-v1.py').read_text()
workflow = (recipe / 'workflow-review-npc-v1.yml').read_text()
controller = (recipe / 'review-render-cdp-npc-v1.mjs').read_text()
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
print('NPC remote capture runner source contracts: PASS')
