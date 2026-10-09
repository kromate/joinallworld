# Clothing/body/shoe A/B V6: motion-payload snapshot diagnostic

This is a separate diagnostic clone of the V5 fixture. The sampled clothing/body/shoe candidate is unchanged. The only runtime hypothesis is clip-pack loading: V5's CDP trace showed a 338,060-byte `clip-pack.glb` response delivered in full (`encodedBodySize` and `decodedBodySize` both 338,060; transfer 338,360; HTTP 200), followed by `net::ERR_ABORTED` on several request IDs after the actor factory and 31 image comparisons completed. The V5 source uses Three's `FileLoader`, which wraps `Response.body` in a progress-reporting `ReadableStream` and then consumes a new `Response(stream).arrayBuffer()`.

V6 instead makes one `cache: "no-store"` clip-pack `ArrayBuffer` fetch shared across independent Kits and calls `GLTFLoader.parseAsync` separately for each Kit. Each Kit still gets its own parsed scene, skeleton, clips, and disposal ownership. Failed fetches evict the byte promise for retry. Closed Kits reject before parsing or release a just-parsed scene. The renderer still treats every failed network request as a hard failure; it also requires one successful full-byte fetch and five successful per-Kit parses, so this is not an error waiver.

The result distinguishes `requests`, `bytesRead`, `cacheHits`, `parseSuccesses`, and `kitsParsed`. Expected payload size is pinned to 338,060 bytes. If the browser still reports a cancellation despite the single fetch and completed parses, the V6 hypothesis is rejected and the request trace remains a hard failure.

Run the V6 pin verifier, V6 typecheck config, V6 bundle script, then V6 bounded render script. This remains an ignored diagnostic: no gameplay integration, mobile claim, or clothing-fix acceptance is implied.
