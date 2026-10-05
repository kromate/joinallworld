# Your first change

One small, real change from edit to pull request: a new activity in Freedom Park, the venue every new character starts in. It takes about half an hour and touches the three things most changes touch: content, a test, and the running game.

You need the game running first ([README](../README.md#quick-start)):

```sh
npm install
npm run dev
```

Leave it running in one terminal, open http://127.0.0.1:5173/, press **Play now** and skip the tour. The panel at the bottom lists the park's spots; **Under the trees** has two activities, *Chill Under the Trees* and *Play Ayo*. You are going to add a third.

## 1. Find where it lives

A city's venues are data. For Lagos they are in `src/game/cities/lagos/venues.ts`; the comment at the top of the file explains every field. Search it for `Chill Under the Trees`:

```ts
      trees: { id: 'trees', label: 'Under the trees', icon: '🌳', caption: 'Cool breeze under the trees', activities: [
        { id: 'chill', label: 'Chill Under the Trees', icon: '🌳', duration: 11, cost: 0, effects: { energy: 4, fun: 10 },
          note: 'Duration and effects are fixed.' },
        { id: 'play-ayo', label: 'Play Ayo', icon: '🎲', duration: 7, cost: 0, effects: { fun: 8, social: 8 }, tags: ['fun', 'social'], beta: true, note: seenCard },
      ] },
```

A venue has spots, a spot has activities, and an activity says how long it takes (in seconds), what it costs (in naira) and what it does to the six needs.

## 2. Add the activity

Add one line after `play-ayo`:

```ts
        { id: 'park-feed-birds', label: 'Feed the Birds', icon: '🐦', duration: 6, cost: 100, effects: { fun: 7 }, tags: ['fun'], beta: true },
```

- `id` must be unique in the city (hence the `park-` prefix) and must never change later: saved lives refer to it.
- `beta: true` says the numbers are a first guess that may be retuned. Use it for every value you made up.

Save. The terminal running `npm run dev` prints `Game server restarted (src/game/cities/lagos/venues.ts changed).` and the page reloads. That restart matters: the page only shows the activity, the server is what runs it.

## 3. See it in the game

Back in the browser, press **Under the trees** to open its activities: **Feed the Birds, 6 seconds, ₦100** is there. Press it. Six seconds later your wallet has gone from ₦5,000 to ₦4,900 and the Fun bar has gone up.

Nothing else was needed: the activity card, the progress bar, the charge and the saved result all come from the data. Nothing in the browser granted anything either. The page sent an action, the server applied the rules and answered with the new life.

## 4. Add a test

Rules are tested through the engine, without a browser or a server. Open `src/life.test.ts`, read the test called `Chill finishes after 11 seconds…` near the top, and add yours at the end of the file:

```ts
test('Feed the Birds costs ₦100 once, takes 6 seconds and lifts fun', () => {
  const state = createLife({ spot: 'trees' });
  assert.equal(startActivity(state, 'park-feed-birds').code, 'started');
  advanceLife(state, 6);
  assert.equal(state.activeAction, null);
  assert.equal(state.cash, 4900);
  assert.equal(state.needs.fun, 57);
  const broke = createLife({ spot: 'trees', cash: 50 });
  assert.equal(startActivity(broke, 'park-feed-birds').ok, false);
  assert.equal(broke.cash, 50);
});
```

It covers the path that works and one that must be refused: a character with ₦50 cannot start, and is not charged. Run just this file:

```sh
node --test src/life.test.ts
```

It takes well under a second. Change `4900` to `4800` and run it again to see what a failure looks like, then put it back.

## 5. Run what a pull request must pass

```sh
npm run check
```

The typecheck, the build and all the tests: about a minute and a half. The other suites matter even for one line of content. The city contract test checks every venue of every city, the economy tests replay whole lives through the rules, and a size test checks that the first download has not grown past its budget.

## 6. Propose it

```sh
git checkout -b feed-the-birds
git add src/game/cities/lagos/venues.ts src/life.test.ts
git commit -m "Freedom Park: feed the birds under the trees"
```

Push the branch to your fork and open a pull request. Say what changes and how to see it; the template asks for exactly that.

This example is only an exercise, so do not send it. Go back with `git checkout main` and `git branch -D feed-the-birds`, then pick something real from [Good first changes](../CONTRIBUTING.md#good-first-changes).

## What you just used

| Idea | Where it showed |
| --- | --- |
| Cities are data | One line in a city file became a working activity ([CITIES.md](CITIES.md)) |
| The server decides | The page needed the game server restarted before the activity worked |
| Rules are pure and testable | The test ran the rule with no server, clock or browser |
| Guesses are marked | `beta: true` |
| One command before a pull request | `npm run check` |

Next: [CONTRIBUTING.md](../CONTRIBUTING.md) for the map of the code and the rules it keeps, and [DEVELOPING.md](DEVELOPING.md) for two players, other cities and the optional services.
