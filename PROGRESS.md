# Progress

State as of 18 September 2026. The game is playable end to end: two to four
people open the page, one starts a game and shares a four-letter code, and they
play a full match of base-game Catan in the browser.

Everything below has been run, not just written. 59 tests pass, the production
build is clean, and the whole flow has been driven through two real browser tabs.

---

## What exists

### Rules engine — `shared/` · complete

One pure reducer, `applyAction(state, playerId, action)`, is the only
implementation of the rules anywhere in the project. It clones, validates,
mutates the clone and hands it back, so it is trivially testable and completely
free of DOM or network concerns.

Covered: snake-draft setup with the second settlement paying out · rolling and
production including the bank-shortage rule · the robber, discarding down to half
above seven cards, and stealing · roads, settlements and cities with piece limits
· all five development cards, one per turn, never on the turn bought · harbours
at 2:1 and 3:1 · bank trading and player-to-player offers with responses ·
longest road and largest army, including losing them · hidden victory point cards
· ten points to win.

Two rules that implementations usually get wrong are handled explicitly: a road
cannot be extended *through* an opponent's building, and a Knight played before
the roll still leaves the roll to be made.

| file | lines | what |
|---|---|---|
| `shared/rules.ts` | 916 | the reducer, `legalMoves()`, scoring, awards |
| `shared/layout.ts` | 226 | hex/vertex/edge graph |
| `shared/types.ts` | 164 | the whole data model |
| `shared/redact.ts` | 130 | full state → what one player may see |
| `shared/setup.ts` | 57 | shuffling, balanced board generation |
| `shared/scenario.ts` | — | the board recipe |
| `shared/rng.ts` | — | seeded PRNG |

**The board graph is derived, not hand-listed.** A vertex is identified by the
sorted triple of hexes touching it, an edge by the sorted pair of its vertices.
Both sets come out canonical and de-duplicated: exactly 19 hexes, 54 vertices, 72
edges, with the coastline walkable as a 30-edge ring. The distance rule then
reduces to "no neighbouring vertex is occupied", and longest road to a
depth-first walk that stops at an opponent's building.

### Multiplayer — `server/` · complete

Server-authoritative. The browser never decides what is legal: it sends an
action, the server runs the reducer, and broadcasts each player a *redacted* view
plus the exact list of moves they may legally make. There is no second rules
implementation on the client to drift out of sync, and a crafted message is
rejected the same as any other illegal move.

- Rooms are one in-memory `Map<code, Room>`; games are isolated from each other.
- Seats carry a secret token in `sessionStorage`, so a refresh puts a player back
  in their seat with their hand intact — and a second tab gets its own seat
  instead of stealing the first one's.
- A seat that no longer exists sends the player back to the entrance with a
  message rather than leaving a dead board on screen.
- Rooms are freed when the last player leaves the lobby, and swept four hours
  after everyone disconnects.
- `GET /api/rooms` reports the live store: codes and counts, no names or tokens.

### Client — `src/` · complete

Vite + React + TypeScript, plain CSS. The UI renders `legalMoves` and nothing
else, so it can never offer a move the server would refuse.

Board, player rail with victory points and awards, game log, hand, dice, build
buttons with cost hints, trade panel (player offers and bank/harbour trades),
development cards, discard modal, robber and steal prompts, win screen.

### Graphics — `src/board/` · rebuilt, second pass

Everything is SVG; there are no image assets.

Two rules carry the look. **Light always comes from the upper left** — every
tile, chit, house, road and tree has a lit face, a shaded face and a shadow cast
down and to the right. And **every tile seeds a PRNG from its own coordinates**,
so no two forests have their trees in the same place, while the board still
renders identically for every player and on every reload.

- `terrain.tsx` (472 lines) — painted artwork per terrain: conifers with trunks
  and a hazier back row for depth, bound wheat sheaves with grain heads, sheep
  with fleece lobes and heads, a dug clay pit with cut terraces and brick stacks,
  snow-capped peaks with rock striations and scree, dunes with cacti and rocks.
- `pieces.tsx` — tiles with real cardboard thickness, bevelled number chits with
  paper grain and letterpressed numerals, houses and cities as 3D volumes, wooden
  roads, a turned pawn for the robber, harbour pennants.
- `Board.tsx` — lighting gradients, the wooden frame as a lit slab, sea swells.

The tiles are about eight hundred SVG nodes, so they are memoised on the terrain
and token *values* — not on object identity, because the server hands the client
a brand new state object on every action.

---

## How it was verified

| check | result |
|---|---|
| `npm test` | **59 passing**, 6 files |
| `npm run build` | clean · 235 KB JS (74 KB gzipped), 12 KB CSS |
| `npm run simulate` | 10 games across 5 seeds and 2 player counts, all reached a winner |
| two browser tabs | full game driven by hand: draft, roll, a 7, robber, steal, build, refresh-and-rejoin |

**Test breakdown**

- `shared/__tests__/layout.test.ts` (8) — 19/54/72, Euler's formula, adjacency
  symmetry, a closed 30-edge coastline.
- `shared/__tests__/setup.test.ts` (5) — 300 generated boards: exact component
  supply, no two red tokens adjacent, no harbour sharing a vertex, determinism.
- `shared/__tests__/rules.test.ts` (26) — every rule, plus three full scripted
  games that must reach a winner without stalling, with conservation checks.
- `server/__tests__/rooms.test.ts` (11) — concurrent games stay isolated, unique
  codes and tokens, seat freeing, host handover, rejoin by token, stale sweeping.
- `server/__tests__/multiplayer.test.ts` (4) — real socket.io: room join,
  redaction, out-of-turn refusal, reconnect, malformed payloads.
- `src/__tests__/board.test.tsx` (5) — the board renders 19 tiles, 18 chits, 9
  harbours, and exactly the legal spots.

`npm run simulate -- <seed> <players>` plays a whole game bot-versus-bot and
narrates it. It is the fastest way to check a rules change did not break
something: it prints the play-by-play and verifies that no resource or
development card was conjured up or lost.

---

## Bugs found and fixed

All of these were caught by running the thing, not by reading it.

- A Knight played before rolling skipped the roll entirely.
- The seat token lived in `localStorage`, so a second tab on the same machine
  hijacked the first player's seat.
- The robber sat exactly on the number token, hiding the number you needed in
  order to choose where to put it.
- The trade modal's two resource pickers overflowed side by side, clipping the
  "want" side; the "want" side also mislabelled its cap as cards held.
- A client whose seat no longer existed sat on a zombie board forever.
- `/api` was not proxied in dev, so the rooms endpoint returned the Vite page.
- The ocean was a square patch with visible seams instead of filling the stage.
- Number chits were oversized and buried the terrain art.
- Harbour glyphs were illegible at size — ore read as a wastebin.
- Hills read as mud, wheat as fabric; trees and peaks were too small to register.
- The tile memoisation depended on `board.hexes` identity, which changes on every
  server push, so it was doing nothing.

---

## Maps (23 Sept 2026)

The host picks a map in the lobby: **Classic** (shuffled every game), **Beginner**
(the rulebook's fixed starter island), **Large island** (the 30-hex 5�6 player
board, 3-4-5-6-5-4-3, two deserts, 11 harbours). Recipes live in
`shared/scenario.ts`; the board state carries its map id and every rule looks the
graph up with `graphOf(board)`. The 3D scene reads the active shape from
`src/board3d/coords.ts` (`setActiveMap`), and its frame is a squashed hexagon
sized to the coast. `npm run simulate -- <seed> <players> <map>` plays any map.

## Not done

- **AI bots.** Online play was chosen instead. The simulation bot in
  `scripts/simulate.ts` is most of the logic if you want them.
- **Mobile layout is unverified.** The CSS is written and the breakpoints exist,
  but the browser tooling here would not honour a window resize, so it has never
  been seen at phone width. Desktop and tablet have been.
- **Deployment config.** It runs locally. It is one Node process serving static
  files plus websockets, so a host like Render or Fly is a short job.
- **Expansions.** Three hooks are in place — `HexType` already includes `sea` and
  `gold`, the board comes from a `Scenario` object, and the development deck is a
  data table. Nothing further is generalised until one is actually built.

## Known sharp edges

- `npm run dev` starts Vite with `--host`, so the game is reachable from every
  machine on your network. That is deliberate — it is how you play with people in
  the same room — but drop the flag in `package.json` if you would rather it
  stayed on localhost.
- Editing anything under `server/` restarts the server and therefore ends any
  game in progress.

## Lobbies, persistence, trade checks (23 Sept 2026)

- Rooms persist to `data/rooms.json`; a restart keeps every game.
- Entrance lists lobbies (join / resume); **Menu** in the top bar and **Leave lobby**
  return to it. Game seats are kept for resume, lobby seats freed.
- Offers must be payable by at least one opponent (the "want" picker is capped at
  the most any one opponent holds); Accept needs the cards in hand.
- The rail shows the bank's stock of each resource and the dev deck.
