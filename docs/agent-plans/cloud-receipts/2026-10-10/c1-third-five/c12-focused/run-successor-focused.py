from pathlib import Path
import subprocess
import sys

root = Path('/workspace/remote-verification/repositories/coordinator-c1-third-five-sourcecheck')
commands = [
    ['python3', 'scripts/world/check-playable-africa-rollout.py', 'cairo', 'rabat', 'kigali', 'kampala', 'lusaka'],
    ['python3', '/workspace/remote-verification/worker-results/c1-third-five/sourcecheck-negative-diagnostics.py', str(root)],
    ['node', '--experimental-strip-types', '--test', '--test-concurrency=1',
     '--test-name-pattern=every generated city passes its offline source and output check|open versus coming soon is derived from the additive city catalogue|open and coming-soon cities share the live registry and canonical links',
     'src/game/cities/allCities.test.ts', 'src/map3d/geo/atlas.test.ts', 'src/map3d/world.test.ts'],
]
for command in commands:
    print('COMMAND ' + repr(command), flush=True)
    result = subprocess.run(command, cwd=root)
    print('EXIT ' + str(result.returncode), flush=True)
    if result.returncode:
        sys.exit(result.returncode)
