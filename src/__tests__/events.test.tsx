import { describe, expect, it } from 'vitest';
import { viewFor } from '../../shared/redact';
import { applyAction, createGame, legalMoves } from '../../shared/rules';
import { RESOURCES, type GameState } from '../../shared/types';
import { detectRoll } from '../fx/events';

const SEATS = [
  { id: 'A', name: 'Ann' },
  { id: 'B', name: 'Bob' },
];

function draft(state: GameState): GameState {
  let s = state;
  while (s.phase === 'setup') {
    const who = s.players[s.current].id;
    const m = legalMoves(s, who);
    const r = applyAction(
      s,
      who,
      s.setup!.placing === 'settlement'
        ? { type: 'placeSetupSettlement', vertex: m.settlementSpots[0] }
        : { type: 'placeSetupRoad', edge: m.roadSpots[0] },
    );
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  return s;
}

describe('detectRoll', () => {
  it('reports each roll once, with flights matching exactly what each hand gained', () => {
    let rolls = 0;
    let producingRolls = 0;
    for (let seed = 1; seed <= 40; seed++) {
      let s = draft(createGame(SEATS, seed));
      for (let turn = 0; turn < 12 && s.phase === 'rolling'; turn++) {
        const who = s.players[s.current].id;
        const r = applyAction(s, who, { type: 'rollDice' });
        if (!r.ok) throw new Error(r.error);

        for (const viewer of ['A', 'B']) {
          const before = viewFor(s, viewer);
          const after = viewFor(r.state, viewer);
          const ev = detectRoll(before, after)!;
          expect(ev).not.toBeNull();
          expect(ev.dice).toEqual(r.state.dice);
          const total = ev.dice[0] + ev.dice[1];
          for (const h of ev.producing) expect(r.state.board.hexes[h].token).toBe(total);

          // Every other player: flights == cards gained.
          for (const p of after.players) {
            const gained = p.handSize - before.players.find((q) => q.id === p.id)!.handSize;
            expect(ev.flights.filter((f) => f.player === p.id)).toHaveLength(gained);
          }
          // The viewer: flights == cards gained, per resource.
          for (const res of RESOURCES) {
            const gained = after.you!.resources[res] - before.you!.resources[res];
            expect(ev.flights.filter((f) => f.player === viewer && f.resource === res)).toHaveLength(gained);
          }
          // A view with nothing new is not a roll.
          expect(detectRoll(after, after)).toBeNull();
        }
        rolls++;
        if (r.state.dice![0] + r.state.dice![1] !== 7 && r.state.phase === 'main') producingRolls++;

        // Move on: resolve a 7 crudely, then end the turn.
        s = r.state;
        if (s.phase !== 'main') break;
        const end = applyAction(s, who, { type: 'endTurn' });
        if (!end.ok) throw new Error(end.error);
        s = end.state;
      }
    }
    expect(rolls).toBeGreaterThan(100);
    expect(producingRolls).toBeGreaterThan(50);
  });
});
