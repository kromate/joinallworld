#!/usr/bin/env python3
"""Static workflow/runner checkpoint audit; never launches build or browser processes."""
import ast
from pathlib import Path
import re

root = Path(__file__).resolve().parents[5]
fixture = Path('evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1')
cpu = fixture / 'remote-cpu-v5'
render = fixture / 'remote-render-v5'
workflow = (render / 'workflow-integrated-sofa-v5.yml').read_text()
runner_path = cpu / 'run-bounded-linux-package-sofa-v5.py'
runner = runner_path.read_text()
sealer_path = cpu / 'seal-source-pins-sofa-v5.mjs'
sealer = sealer_path.read_text()

# The source manifest is a wx checkpoint. The workflow must not call its sealer;
# only the CPU PHASES list may create it, exactly once.
assert "{ flag: 'wx' }" in sealer and "source-pins-sofa-v1.json" in sealer
assert 'seal-source-pins-sofa-v5.mjs' not in workflow
assert runner.count('seal-source-pins-sofa-v5.mjs') == 1
module = ast.parse(runner)
phases = next(node.value for node in module.body if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'PHASES' for t in node.targets))
assert isinstance(phases, ast.List)
source_seal_phases = [row for row in phases.elts if isinstance(row, ast.Tuple) and ast.literal_eval(row.elts[0]) == 'source-seal']
assert len(source_seal_phases) == 1
assert 'seal-source-pins-sofa-v5.mjs' in ast.unparse(source_seal_phases[0])

# Every CPU helper invoked by the runner exists, and the standalone workflow dispatches only that runner.
helper_paths = re.findall(r"REVIEWED / '([^']+\.mjs)'", runner)
for relative in helper_paths:
    assert (root / fixture / 'remote-cpu-v1' / relative).is_file(), relative
assert workflow.count('run-bounded-linux-package-sofa-v5.py') == 1
assert workflow.count('seal-review-sources-sofa-v5.mjs') == 2  # one per isolated job checkout
assert 'source-pins-sofa-v1.json' in workflow  # uploaded package checkpoint only

# Branch, active/staged workflow path, runner, CPU results and artifact all agree.
branch = 'codex/graphics-sofa-upholstery-v1-integrated-v5'
active = Path('.github/workflows/graphics-sofa-upholstery-v1-integrated-v5.yml')
assert branch in workflow and branch in runner
assert f'cmp {render / "workflow-integrated-sofa-v5.yml"} {active}' in workflow
assert str(active) in sealer
assert (root / render / 'run-bounded-linux-render-sofa-v5.py').is_file()
assert (root / cpu / 'run-bounded-linux-package-sofa-v5.py').is_file()
assert 'environment-sofa-upholstery-cpu-v5-${{ github.run_id }}' in workflow
assert 'environment-sofa-upholstery-render-v5-${{ github.run_id }}' in workflow
assert "RESULTS = HERE / 'remote-cpu-v5' / 'remote-results'" in runner

print('single source-seal invocation and v5 CPU/render checkpoint paths: PASS')
