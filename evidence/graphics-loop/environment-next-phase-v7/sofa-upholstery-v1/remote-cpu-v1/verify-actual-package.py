from pathlib import Path
import hashlib, json

base = Path(__file__).parent / 'downloaded-37902739360'
def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1048576), b''):
            h.update(chunk)
    return h.hexdigest()
def read(name):
    return json.loads((base / name).read_text())

pins = read('source-pins-sofa-v1.json')
pinsha = sha(base / 'source-pins-sofa-v1.json')
manifest = read('static-sofa-v1/build-manifest.json')
compiled = read('compile-sofa-v1-record.json')
final = read('finalization-sofa-v1-observed.json')
receipt = read('remote-cpu-v1/remote-results/sofa-cpu-v1.receipt.json')
assert pins['gitCommit'] == receipt['commitSha'] == 'c4d15a72f6df56b28535579380819bdaf2fad8a1'
assert receipt['status'] == 'completed' and receipt['childExitCode'] == 0 and receipt['cleanupVerified']
assert receipt['peakOwnedGroupRssBytes'] < receipt['rssLimitBytes'] and receipt['elapsedSeconds'] < receipt['totalTimeoutSeconds']
for record in [manifest, compiled, final, receipt]:
    assert record['sourcePinsSha256'] == pinsha
for phase in ['precompile', 'postcompile']:
    record = read('source-' + phase + '-v7.json')
    assert record['status'] == 'VERIFIED' and record['sourcePinsSha256'] == pinsha and record['fileCount'] == len(pins['files'])
assert manifest['compileRecordSha256'] == final['compileRecordSha256'] == sha(base / 'compile-sofa-v1-record.json')
assert final['manifestSha256'] == sha(base / 'static-sofa-v1/build-manifest.json')
assert final['finalizerPinsSha256'] == sha(base / 'finalizer-pins-sofa-v1.json')
assert manifest['importClosureVerified'] and manifest['cityMapSourceCount'] == manifest['cityMapChunkCount'] == 40
assert manifest['outputFileCount'] == len(manifest['outputs']) == 5626
assert manifest['publicFileCount'] == len(manifest['publicFiles']) == 5392
for item in manifest['outputs']:
    path = base / 'static-sofa-v1' / item['path']
    assert path.stat().st_size == item['bytes'] and sha(path) == item['sha256'], path
for item in manifest['publicFiles']:
    path = base / 'static-sofa-v1' / item['output']
    assert path.stat().st_size == item['bytes'] and sha(path) == item['sha256'], path
source = {item['path']: item['sha256'] for item in pins['files']}
for item in compiled['consumedInputs']:
    assert source[item['path']] == item['sha256']
viewer = 'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/viewer.ts'
assert source[viewer] == sha(Path(viewer))
assert any(item['path'] == viewer and item['sha256'] == source[viewer] for item in compiled['consumedInputs'])
prefix = 'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/'
for item in read('finalizer-pins-sofa-v1.json')['files']:
    path = base / item['path'][len(prefix):] if item['path'].startswith(prefix) else Path(item['path'])
    if not path.exists():
        path = Path(item['path'])
    assert sha(path) == item['sha256'], path
host = read('static-fixture-sofa-v1/build-manifest.json')
staged = read('review-host-sofa-v1-staged.json')
assert host['schema'] == 'fixture-hosting-v2-manifest/1' and host['fixtureSourcePinsSha256'] == pinsha
assert staged['sourcePinsSha256'] == pinsha and staged['hostManifestSha256'] == sha(base / 'static-fixture-sofa-v1/build-manifest.json')
assert staged['inputCount'] == len(pins['files']) and staged['outputCount'] == len(manifest['outputs'])
assert {item['path']: item['sha256'] for item in host['outputs']} == {item['path']: item['sha256'] for item in manifest['outputs']}
result = {'run': '37902739360', 'commit': pins['gitCommit'], 'status': 'root-verified-diagnostic-package', 'sourcePinsSHA256': pinsha, 'outputFilesVerified': 5626, 'publicFilesVerified': 5392, 'rawDiagnosticBytes': manifest['outputRawBytes'], 'importReferenceCount': manifest['importReferenceCount'], 'cityChunks': 40, 'finalizerPinsVerified': 238, 'actualNewViewerCompiled': True, 'viewerSHA256': source[viewer], 'elapsedSeconds': receipt['elapsedSeconds'], 'peakOwnedGroupRssBytes': receipt['peakOwnedGroupRssBytes'], 'cleanupVerified': True, 'visualOrMobileAccepted': False, 'productionSizeCertificate': False}
(base.parent / 'root-actual-artifact-review.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
