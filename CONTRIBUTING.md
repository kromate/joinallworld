# Contributing

Thanks for helping. The project is small and moving quickly, so the most useful contributions are small too.

## Before you start

```sh
npm install
npm test
npm run build
```

Both must pass before you open a pull request. CI runs the same two commands.

## Keep changes small and scoped

- One concern per pull request. A bug fix, one activity, one venue — not a rewrite.
- For anything larger (a new city pack, a storage change, a new protocol message), open an issue first and describe the plan.
- Do not add dependencies without discussing it. The client is Three.js and Vite; the server is Node built-ins and `ws`. Staying lightweight is a feature.
- Match the surrounding code's style rather than reformatting it.

## Tests

Tests use the built-in runner (`node --test`) and live next to the code as `*.test.js` or `*.test.ts`, in both `src/` and `server/`.

Add or update tests whenever you touch:

- **State changes** — cash, needs, location, active actions. Cover the rejected paths (busy, unaffordable, invalid input) as well as the successful one.
- **Idempotency** — anything keyed by an action ID or client message ID. Show that a repeat does not apply twice, and that the same ID with different contents is rejected.
- **Saved data** — loading must tolerate missing, old or malformed values.

Game rules belong in plain modules such as `src/life.ts` that run without a browser, so they can be tested and shared with the server.

## Accessibility

- Every control must work with a keyboard and have an accessible name.
- Use real `<button>`, `<dialog>` and `<meter>` elements before reaching for ARIA.
- Announce results that are not otherwise visible through the existing live region.
- Never rely on colour, sound or 3D position alone to convey state.
- Check the layout on a narrow phone screen.

## Originality

- **No copied code or assets** from the older Allworld project or from any other game — no extracted scripts, models, textures, audio, icons or text.
- Values that are guesses are marked as provisional (`beta: true` in content, or a placeholder note in code, the way `src/life.ts` does). Do not present guesses as verified.
- Only contribute work you have the right to license under MIT. Note the licence of anything third-party you add.

## Keep these out of the repository

- Secrets: keys, tokens, passwords, `.env` files, cookies.
- The server's data directory (`.data/`).
- Private research material: screenshots or recordings of other services, account details, personal data, and raw audit notes. Summarise the finding in the code comment or pull request instead.

## Cities

Lagos, Ibadan and the four cities of Ogun State are the first open cities. If you add or change city content, keep it as data — venues, spots, fares, map positions — rather than city-specific logic, so the next city can reuse it. The pack format is not final; raise an issue before investing heavily.

## Security issues

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
