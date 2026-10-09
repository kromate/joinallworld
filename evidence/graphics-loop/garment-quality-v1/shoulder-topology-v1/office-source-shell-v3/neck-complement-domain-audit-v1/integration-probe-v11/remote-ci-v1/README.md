# Remote GLB loader cancellation diagnostic

The exact SHA-pinned male, female, and animation GLBs are exercised with browser `fetch` + `GLTFLoader.parseAsync`, `GLTFLoader.loadAsync`, and two concurrent male `loadAsync` calls. CDP preserves each GLB request's initiator, redirect chain, response, data chunks, terminal event, and failure. The browser fixture records `AbortController.abort()` and `XMLHttpRequest.abort()` stacks, the active case, and XHR URL/state.

The strict gate rejects any failed, canceled, or pending GLB request, runtime exception, console error, or HTTP error. Asset hashes are checked on the fetched reference bytes before each FileLoader call. No network failure is forgiven. The browser fixture does not load the avatar renderer or claim to reproduce production avatar disposal/template-cache lifecycle.

Run only on the dedicated branch trigger in `workflow.yml`. Build and synthetic processes remain capped at 220 MiB / 25 seconds; the browser process group remains capped at 2 GiB / 60 seconds. Chrome uses the same normal process topology as v10 under headless SwiftShader, not a single-process variant or mobile/browser performance validation. All outputs upload under the unique workflow run id. This v11 recipe is prepared but unpublished and unexecuted.
