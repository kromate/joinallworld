// What `#city-map/<id>` resolves to where neither the `browser` nor the `node` condition applies: the Worker script, bundled
// with esbuild's neutral platform. The server never draws a map, and leaving every city's geometry out keeps the script under the
// platform's per-file limit (deploy/words.edge.test.ts). The page (Vite, `browser`) and Node (tests, scripts, `node`) get the real map.
throw new Error('City maps are not part of the server bundle')
