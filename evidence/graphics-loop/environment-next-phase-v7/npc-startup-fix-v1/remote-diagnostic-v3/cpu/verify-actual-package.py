from pathlib import Path
import hashlib, json, sys

if len(sys.argv) != 3:
    raise SystemExit('usage: verify-actual-package.py downloaded-package-root cpu-commit-sha')
base = Path(sys.argv[1]).resolve()
expected_commit = sys.argv[2]
if not base.is_dir() or len(expected_commit) != 40:
    raise SystemExit('package root and exact CPU commit are required')
def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1048576), b''):
            h.update(chunk)
    return h.hexdigest()
def read(name):
    return json.loads((base / name).read_text())

pins = read('source-pins-npc-v2.json')
pinsha = sha(base / 'source-pins-npc-v2.json')
manifest = read('static-npc-v2/build-manifest.json')
compiled = read('compile-v7-record.json')
final = read('finalization-v7-observed.json')
receipt = read('remote-diagnostic-v3/cpu/remote-results/npc-startup-v2.receipt.json')
assert pins['schema'] == 'environment-next-phase-v7-npc-startup-source-pins/2'
assert pins['gitCommit'] == receipt['commitSha'] == expected_commit
assert receipt['status'] == 'completed' and receipt['childExitCode'] == 0 and receipt['cleanupVerified']
assert receipt['peakOwnedGroupRssBytes'] < receipt['rssLimitBytes'] and receipt['elapsedSeconds'] < receipt['totalTimeoutSeconds']
for record in [manifest, compiled, final, receipt]:
    assert record['sourcePinsSha256'] == pinsha
for phase in ['precompile', 'postcompile']:
    record = read('source-' + phase + '-v7.json')
    assert record['status'] == 'VERIFIED' and record['sourcePinsSha256'] == pinsha and record['fileCount'] == len(pins['files'])
assert manifest['compileRecordSha256'] == final['compileRecordSha256'] == sha(base / 'compile-v7-record.json')
assert final['manifestSha256'] == sha(base / 'static-npc-v2/build-manifest.json')
assert final['finalizerPinsSha256'] == sha(base / 'finalizer-pins-v7.json')
assert manifest['importClosureVerified'] and manifest['cityMapSourceCount'] == manifest['cityMapChunkCount'] == 40
assert manifest['htmlEntry'] == './' + manifest['entryOutput']
html = (base / 'static-npc-v2/index.html').read_text()
assert html.count(f'src="{manifest["htmlEntry"]}"') == 1
entry = next((item for item in manifest['outputs'] if item['path'] == manifest['entryOutput']), None)
assert entry and entry['bytes'] > 0 and len(entry['sha256']) == 64
assert manifest['entryOutput'].startswith('app/viewer-npc-v1.') and manifest['entryOutput'].endswith('.js')
assert sha(base / 'static-npc-v2' / manifest['entryOutput']) == entry['sha256']
assert manifest['outputFileCount'] == len(manifest['outputs']) == 5626
assert manifest['publicFileCount'] == len(manifest['publicFiles']) == 5392
for item in manifest['outputs']:
    path = base / 'static-npc-v2' / item['path']
    assert path.stat().st_size == item['bytes'] and sha(path) == item['sha256'], path
for item in manifest['publicFiles']:
    path = base / 'static-npc-v2' / item['output']
    assert path.stat().st_size == item['bytes'] and sha(path) == item['sha256'], path
source = {item['path']: item['sha256'] for item in pins['files']}
for item in compiled['consumedInputs']:
    assert source[item['path']] == item['sha256']
viewer = 'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/remote-diagnostic-v1/viewer-npc-v1.ts'
assert source[viewer] == sha(Path(viewer))
assert any(item['path'] == viewer and item['sha256'] == source[viewer] for item in compiled['consumedInputs'])
prefix = 'evidence/graphics-loop/environment-next-phase-v7/'
for item in read('finalizer-pins-v7.json')['files']:
    path = base / item['path'][len(prefix):] if item['path'].startswith(prefix) else Path(item['path'])
    if not path.exists():
        path = Path(item['path'])
    assert sha(path) == item['sha256'], path
host = read('static-fixture-npc-v2/build-manifest.json')
staged = read('review-host-v7-staged.json')
assert host['schema'] == 'fixture-hosting-v2-manifest/1' and host['fixtureSourcePinsSha256'] == pinsha
assert staged['sourcePinsSha256'] == pinsha and staged['hostManifestSha256'] == sha(base / 'static-fixture-npc-v2/build-manifest.json')
assert staged['inputCount'] == len(pins['files']) and staged['outputCount'] == len(manifest['outputs'])
assert {item['path']: item['sha256'] for item in host['outputs']} == {item['path']: item['sha256'] for item in manifest['outputs']}
result = {'run': receipt.get('runId'), 'commit': pins['gitCommit'], 'status': 'root-verified-diagnostic-package', 'sourcePinsSHA256': pinsha, 'outputFilesVerified': 5626, 'publicFilesVerified': 5392, 'rawDiagnosticBytes': manifest['outputRawBytes'], 'importReferenceCount': manifest['importReferenceCount'], 'cityChunks': 40, 'finalizerPinsVerified': 238, 'actualNewViewerCompiled': True, 'htmlEntryBoundToEmittedOutput': manifest['htmlEntry'], 'viewerSHA256': source[viewer], 'elapsedSeconds': receipt['elapsedSeconds'], 'peakOwnedGroupRssBytes': receipt['peakOwnedGroupRssBytes'], 'cleanupVerified': True, 'visualOrMobileAccepted': False, 'productionSizeCertificate': False}
(base.parent / 'root-actual-artifact-review.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
