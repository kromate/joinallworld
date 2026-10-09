# GLB fetch/parse retention comparison (source only)

This isolated v11 fixture compares two paths for the same SHA-pinned body and clip GLBs. The direct path uses browser `fetch` followed by `GLTFLoader.parseAsync`; the second uses `GLTFLoader.loadAsync` (`FileLoader`). Prior CDP evidence showed that this pinned Three build's FileLoader request is fetch-backed, not XHR-backed. The global fetch observer therefore retains the exact `Response` returned to every GLB consumer, including FileLoader, without cloning or reading its stream.

Both paths use the production `createSharedResourceCache` and `cloneSkinnedBodyScene` helpers for body assets. Two concurrent cache reads must invoke the factory once. The fixture retains the response, byte buffer, parsed template, and resolved cache value through all cases; actor clone geometry and skeletons are disposed first, and cached templates are released only after the report is formed. It also records fetch response/body-consumption state, XHR ready-state/progress/load/abort/error events, and direct `AbortController`/XHR abort calls. These observers do not change retries or cancellation behavior.

The run can test whether the canceled FileLoader response persists while its exact Response and production-like cached template remain strongly reachable. It cannot prove that garbage collection caused a cancellation: browser collection timing is nondeterministic. The probe also does not run the full `loadBody` appearance/renderer lifecycle.

The strict controller still fails on every failed, canceled, or unfinished GLB request, HTTP error, runtime exception, or console error. No failed event is filtered. No production code is modified; a clean run would be diagnostic evidence only, not graphics, gameplay, or mobile-performance acceptance.

## Inputs and limits

The fixture checks the exact male, female, and clip-pack SHA-256 values. It uses normal Chrome process topology with headless SwiftShader. Build and synthetic processes remain capped at 220 MiB / 25 seconds; the browser group remains capped at 2 GiB / 60 seconds. It does not claim representative mobile performance or reproduce unrelated concurrent scene transitions/browser memory pressure.

The remote recipe is prepared but unpublished and unexecuted. Root review and remote execution are still required.
