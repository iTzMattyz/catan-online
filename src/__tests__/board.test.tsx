import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Board } from '../board/Board';
import { BOARD } from '../../shared/layout';
import { viewFor } from '../../shared/redact';
import { applyAction, createGame, legalMoves } from '../../shared/rules';
import type { GameState } from '../../shared/types';

const SEATS = [
  { id: 'A', name: 'Ann' },
  { id: 'B', name: 'Bob' },
];

function draft(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (s.phase === 'setup' && guard++ < 40) {
    const who = s.players[s.current].id;
    const moves = legalMoves(s, who);
    const action =
      s.setup!.placing === 'settlement'
        ? ({ type: 'placeSetupSettlement', vertex: moves.settlementSpots[0] } as const)
        : ({ type: 'placeSetupRoad', edge: moves.roadSpots[0] } as const);
    const r = applyAction(s, who, action);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  return s;
}

const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const noop = () => {};

describe('board rendering', () => {
  const state = draft(createGame(SEATS, 7));
  const view = viewFor(state, 'A');

  const markup = renderToStaticMarkup(
    <Board view={view} pending={null} onVertex={noop} onEdge={noop} onHex={noop} />,
  );

  it('draws all 19 hexes and 18 number tokens', () => {
    expect(occurrences(markup, 'class="hex-tile"')).toBe(19);
    // One token per producing hex; the desert has none.
    const tokens = BOARD.hexes.filter((h) => state.board.hexes[h].token !== null);
    expect(tokens).toHaveLength(18);
    for (const h of tokens) expect(markup).toContain(`>${state.board.hexes[h].token}</text>`);
  });

  it('draws nine harbours and the robber on the desert', () => {
    expect(occurrences(markup, 'Harbour:')).toBe(9);
    expect(markup).toContain('robber-piece');
    expect(state.board.hexes[state.board.robber].terrain).toBe('desert');
  });

  it('draws every placed settlement and road from the draft', () => {
    const buildings = Object.keys(state.board.buildings).length;
    const roads = Object.keys(state.board.roads).length;
    expect(buildings).toBe(4);
    expect(roads).toBe(4);
    // Each player's colour appears on their pieces.
    for (const p of view.players) expect(markup).toContain(p.color);
  });

  it('shows no clickable spots until the game asks for one', () => {
    expect(occurrences(markup, 'class="spot"')).toBe(0);
  });

  it('shows exactly the legal spots when a placement is pending', () => {
    const rolled = { ...state, phase: 'main' as const, mustRoll: false };
    const rich = structuredClone(rolled);
    rich.players[0].resources = { brick: 4, lumber: 4, wool: 2, grain: 2, ore: 0 };
    const richView = viewFor(rich, 'A');

    const roadMarkup = renderToStaticMarkup(
      <Board view={richView} pending="road" onVertex={noop} onEdge={noop} onHex={noop} />,
    );
    expect(richView.moves.roadSpots.length).toBeGreaterThan(0);
    expect(occurrences(roadMarkup, 'class="spot"')).toBe(richView.moves.roadSpots.length);

    const robberView = viewFor({ ...rich, phase: 'movingRobber' }, 'A');
    const robberMarkup = renderToStaticMarkup(
      <Board view={robberView} pending="robber" onVertex={noop} onEdge={noop} onHex={noop} />,
    );
    // Every hex except the one the robber already occupies.
    expect(occurrences(robberMarkup, 'class="spot"')).toBe(18);
  });
});
