export function oldCharacterLanding(head = false) {
  const binding = { origin: 'https://v1.joinallworld.com', audience: 'https://logical-ins-pillow-ref.trycloudflare.com', siteId: '953074f15b9d05cfb72cc8024b2186653d5ff16b21fd005604f803abe019436c', packageId: 'cli-953074f15b9d05cfb72cc8024b2186653d5ff16b21fd005604f803abe019436c', channel: 'test' };
  const nonce = crypto.randomUUID().replaceAll('-', '')
  const target = binding.origin
  // This is the exact key used by src/platform/guestService.ts. The stable audience keeps the
  // guest's logical scope unchanged while this old origin hands the capability to the new one.
  const guestKey = `nw:guest:${JSON.stringify([binding.audience, binding.siteId, binding.packageId, binding.channel])}`
  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="referrer" content="no-referrer">
  <title>Your original Allworld character</title>
  <style nonce="${nonce}">
    :root { color-scheme: dark; font-family: ui-rounded, system-ui, sans-serif; background: #1c1a24; color: #f8f5ef; }
    body { min-height: 100vh; min-height: 100dvh; margin: 0; display: grid; place-items: center; padding: 20px; box-sizing: border-box; }
    main { width: min(100%, 430px); padding: 28px; box-sizing: border-box; border: 1px solid #3a3648; border-radius: 24px; background: #25222e; box-shadow: 0 20px 60px #0007; }
    h1 { margin: 0 0 12px; font-size: clamp(1.8rem, 8vw, 2.5rem); line-height: 1.05; }
    p { color: #cbc5d4; line-height: 1.55; }
    .actions { display: grid; gap: 12px; margin-top: 24px; }
    button, a { min-height: 48px; display: grid; place-items: center; box-sizing: border-box; border-radius: 999px; font: inherit; font-weight: 750; text-align: center; cursor: pointer; }
    button { border: 0; padding: 0 20px; background: #ffb020; color: #1c1a24; }
    button:disabled { cursor: wait; opacity: .65; }
    a { padding: 11px 20px; border: 1px solid #575064; color: #f8f5ef; text-decoration: none; }
    button:focus-visible, a:focus-visible { outline: 3px solid #72b8ff; outline-offset: 3px; }
    #guest, #none { display: none; }
    #status { min-height: 1.6em; color: #ffd28a; }
  </style>
</head>
<body>
  <main>
    <h1>Your original Allworld character</h1>
    <p>The original 3D world lives at v1.joinallworld.com. Your new city life is separate.</p>
    <section id="guest">
      <p>This browser has a guest character from the old address. Choose when you are ready to open that same character at the new address.</p>
      <div class="actions">
        <button id="move" type="button">Continue with my character</button>
        <a id="guest-new" rel="noreferrer">Go without moving it</a>
      </div>
      <p id="status" role="status" aria-live="polite"></p>
    </section>
    <section id="none">
      <p>No guest character is stored in this browser. If you saved yours to an account, sign in again at the new address.</p>
      <div class="actions"><a id="open-new" rel="noreferrer">Open Allworld</a></div>
    </section>
  </main>
  <script nonce="${nonce}">
    'use strict';
    const target = ${JSON.stringify(target)};
    const guestKey = ${JSON.stringify(guestKey)};
    const guest = document.getElementById('guest');
    const none = document.getElementById('none');
    const move = document.getElementById('move');
    const status = document.getElementById('status');
    const destination = target + '/';
    document.getElementById('guest-new').href = destination;
    document.getElementById('open-new').href = destination;
    let token = null;
    try { token = localStorage.getItem(guestKey); } catch {}
    if (typeof token === 'string' && /^gst_[A-Za-z0-9_-]{43}$/.test(token)) guest.style.display = 'block';
    else none.style.display = 'block';
    move.addEventListener('click', async () => {
      if (move.disabled || token === null) return;
      move.disabled = true;
      status.textContent = 'Preparing your character…';
      try {
        const response = await fetch(target + '/world/guest-transfer/start', {
          method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000),
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token })
        });
        const value = await response.json();
        if (!response.ok || value === null || typeof value !== 'object' || typeof value.next !== 'string') throw new Error('refused');
        const next = new URL(value.next);
        if (next.origin !== target || next.pathname !== '/' || next.search !== '' || !/^#transfer=gtx_[A-Za-z0-9_-]{43}$/.test(next.hash)) throw new Error('invalid');
        location.assign(next.href);
      } catch {
        status.textContent = 'Your character is still kept in this browser. Try again in a moment, or open the new address and sign in.';
        move.disabled = false;
      }
    });
  </script>
</body>
</html>`
  const headers = new Headers({
    'cache-control': 'private, no-store',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src ${target}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`,
    'content-type': 'text/html; charset=utf-8',
    'permissions-policy': 'camera=(), geolocation=(), microphone=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  return new Response(head ? null : body, { status: 200, headers })
}
