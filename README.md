# Catan Online

The full base game of Catan, playable in the browser with friends over the
network — 2 to 4 players, a painted 2D board or an animated 3D one, and a server
that enforces every rule.

## Features

- Complete base-game rules: setup draft, robber, trading, all development cards,
  longest road, largest army, ten points to win
- Real-time multiplayer over Socket.IO with four-letter room codes
- 3D board (three.js / react-three-fiber) with a 2D SVG fallback, switchable in-game
- Reconnect by token: refresh or drop and you keep your seat and hand
- Games persist to disk, so a server restart doesn't end them
- Server-authoritative: the client can only offer moves the server says are legal

## Getting started

Requires Node.js 20+.

```bash
npm install
npm run dev          # client on :5173, server on :3001
```

One player opens the page and picks **Start a new game**, then shares the
four-letter code. Everyone else joins with it. Two to four players.

```bash
npm test             # 68 tests: rules, board generation, rooms, sockets, rendering
npm run simulate     # play a whole game bot-vs-bot and narrate it
npm run build        # type-check + bundle the client
npm start            # one process serving the built client and the sockets
```

`npm run simulate -- <seed> <players>` replays the same game every time for a
given seed. It is the quickest way to see whether a change to the rules broke
something: it prints the play-by-play, the final scoreboard, and checks that no
resource or development card was conjured up or lost along the way.

## How it is put together

**The server decides everything.** One pure reducer in `shared/rules.ts` is the
only implementation of the rules. The server runs it and sends each player a
*redacted* view of the game plus the exact list of moves they may legally make
right now. The browser renders that list and nothing else, so it cannot show an
illegal move, cannot drift out of sync, and cannot cheat by sending a crafted
message — the server re-checks every action regardless.

```
shared/     the whole game, pure TypeScript, no DOM and no node
  layout.ts   hex/vertex/edge graph, derived rather than hand-listed
  scenario.ts the board recipe (terrain supply, tokens, harbours)
  setup.ts    shuffling and balanced board generation
  rules.ts    applyAction() + legalMoves()  <- the rules live here and nowhere else
  redact.ts   full state -> what one player is allowed to see
  rng.ts      seeded PRNG, so every transition is reproducible
server/     socket.io rooms, seat assignment, reconnect by token
              rooms.ts holds every game in one in-memory Map keyed by room code
src/        React client
  board/      the painted SVG board (the 2D view, and the fallback without WebGL)
    terrain.tsx   the artwork for each terrain
    pieces.tsx    tiles, chits, houses, roads, the robber, harbours
  board3d/    the 3D board (three.js via react-three-fiber), loaded lazily
    Board3D.tsx   canvas, lights, camera limits, win-screen orbit
    Tiles.tsx     bevelled tiles, chits, the wooden frame; glow on production
    Decor.tsx     instanced low-poly scenery per terrain, swaying in the wind
    Pieces.tsx    settlements, cities, roads and robber, with their animations
    Dice.tsx      the thrown dice   Spots.tsx  clickable legal-move markers
    Harbours.tsx  jetties out to docks in the water, signs, moored boats
    anim.ts       easing and the opening sequence, all timed off the canvas clock
  fx/         events.ts turns two consecutive views into "what just happened"
```

The 3D board takes exactly the same props as the SVG one and only ever offers
the legal moves the server listed. Animations are derived on the client by
comparing each view with the previous one; the server sends no extra events.
Players can switch between 2D and 3D from the top bar, and anyone with
`prefers-reduced-motion` gets the state changes without the motion.

### The board graph

Hexes are axial coordinates within distance 2 of the origin. A vertex is
identified by the sorted triple of hexes touching it, and an edge by the sorted
pair of its vertices, so both sets come out canonical and de-duplicated: exactly
19 hexes, 54 vertices, 72 edges, with the coastline walkable as a 30-edge ring.

That graph makes the rules that implementations usually get wrong fall out
directly. The distance rule is "no neighbouring vertex is occupied". Longest
road is a depth-first walk that refuses to pass *through* a vertex holding an
opponent's building, which is exactly how a road gets broken.

### What the rules cover

Snake-draft setup with the second settlement paying out; rolling and production
with the bank-shortage rule; the robber, discarding down to half above seven
cards, and stealing; roads, settlements and cities with piece limits; all five
development cards, one per turn and never on the turn it was bought; harbours at
2:1 and 3:1; bank and player trading with offers and counter-responses; longest
road and largest army including losing them; hidden victory point cards; ten
points to win.

### Reconnecting

Each seat gets a secret token kept in `sessionStorage`. Refreshing the page puts
that player back in their seat with their hand intact. It is `sessionStorage`
rather than `localStorage` on purpose: a second tab then gets its own seat
instead of stealing the first one's, which is how most people try the game out.

### The board

Everything is drawn as SVG, no image assets. Two rules keep it from looking like
clipart. Light always comes from the upper left, so every tile, chit and piece
has a lit face, a shaded face and a shadow cast down and to the right. And every
tile seeds a small PRNG from its own coordinates, so two forests never have their
trees in the same places while the board still renders identically for every
player and on every reload.

The tiles are the heavy part of the scene, so they are memoised on the terrain
and number tokens themselves rather than on object identity — the server hands
the client a brand new state object on every single action.

### Rooms

Every game lives in one `Map<code, Room>` in `server/rooms.ts`, mirrored to disk.
The entrance lists live lobbies from `GET /api/rooms` (codes, map and counts, no
names or seat tokens). A dropped connection keeps its seat, lobby or game; the
**Menu** / **Leave lobby** buttons give a lobby seat up but keep a game seat, which
the entrance then offers to resume (tokens remembered in `localStorage`). Rooms
are dropped when the last player leaves the lobby or a week after the last person
disconnects.

## Notes

- `npm run dev` starts Vite with `--host`, so the game is reachable from other
  machines on your network — which is the point, but it does mean anyone on the
  same Wi-Fi can open it. Drop the flag in `package.json` if you'd rather it
  stayed on localhost.
- Rooms are written to `data/rooms.json` (or `$CATAN_DATA`) after every change
  and loaded on start, so restarting the server no longer ends games: clients
  reconnect and rejoin by token.
- `HexType` already includes `sea` and `gold`, the board comes from a `Scenario`
  object, and the development deck is a data table — the three hooks an
  expansion would need. Nothing else is generalised until one is actually built.

## Disclaimer

Unofficial fan project for personal use. CATAN is a trademark of CATAN GmbH;
this project is not affiliated with or endorsed by them.
