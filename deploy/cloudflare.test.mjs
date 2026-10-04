// Release compatibility shim: the release policy (kromate/allworld, release workflow) runs `node --test deploy/cloudflare.test.mjs`.
// The tests live in cloudflare.test.ts, which Node runs by type stripping (on by default since Node 22.18); importing it registers
// them in this file's run, so a failing test fails the process. It can go when the policy names cloudflare.test.ts.
import './cloudflare.test.ts';
