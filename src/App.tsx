import { useEffect, useRef, useState } from 'react';
import { BoardView, useBoardMode } from './board3d/BoardView';
import { useGame } from './net/useGame';
import { Entrance } from './ui/Entrance';
import { HandBar, type Pending } from './ui/HandBar';
import { Lobby } from './ui/Lobby';
import { Rail } from './ui/Rail';
import { CardFlights } from './ui/CardFlights';
import { detectRoll, type RollFx } from './fx/events';
import type { PlayerView } from '../shared/redact';
import {
  DevCardModal,
  DiscardModal,
  StealModal,
  TradeModal,
  TradeOfferModal,
  WinnerModal,
  useEscape,
} from './ui/Modals';

export default function App() {
  const api = useGame();

  if (!api.room) return <Entrance api={api} />;
  if (!api.room.started || !api.view) return <Lobby api={api} />;
  return <Game api={api} />;
}

function Game({ api }: { api: ReturnType<typeof useGame> }) {
  const view = api.view!;
  const [pending, setPending] = useState<Pending>(null);
  const [showTrade, setShowTrade] = useState(false);
  const [showCards, setShowCards] = useState(false);
  const boardMode = useBoardMode();
  const roll = useRoll(view);

  // Some prompts are not optional: during setup and after a 7 the game is
  // waiting on one specific click, so the board asks for it directly.
  const forced: Pending =
    view.moves.isMyTurn && view.phase === 'setup'
      ? view.setup?.placing === 'road'
        ? 'road'
        : 'settlement'
      : view.moves.isMyTurn && view.phase === 'movingRobber'
        ? 'robber'
        : view.moves.isMyTurn && view.phase === 'main' && view.freeRoads > 0
          ? 'road'
          : null;

  const active = forced ?? pending;

  // Drop a half-finished choice whenever the game moves on without it.
  useEffect(() => {
    if (view.phase !== 'main') setPending(null);
  }, [view.phase, view.turn]);

  useEffect(() => {
    if (view.trade === null) setShowTrade(false);
  }, [view.trade]);

  // Rejected actions surface as a short toast rather than a blocking dialog.
  useEffect(() => {
    if (!api.error) return;
    const timer = setTimeout(api.dismissError, 3500);
    return () => clearTimeout(timer);
  }, [api.error, api.dismissError]);

  useEscape(() => {
    setPending(null);
    setShowTrade(false);
    setShowCards(false);
  });

  const current = view.players.find((p) => p.id === view.currentPlayerId);

  return (
    <div className="game">
      <header className="topbar">
        <div className="wordmark">
          Cat<span>a</span>n
        </div>
        <button className="mode-toggle" onClick={api.leave} title="Back to the main menu; you can resume this game from there">
          Menu
        </button>
                <span className="room-code">{api.room!.code}</span>
        {!api.connected && <span className="room-code">reconnecting…</span>}
        {boardMode.canToggle && (
          <button className="mode-toggle" onClick={boardMode.toggle} title="Switch board view">
            {boardMode.is3d ? '2D view' : '3D view'}
          </button>
        )}
        <div className="turn-banner" data-mine={view.moves.isMyTurn && !view.winner}>
          <span className="turn-dot" style={{ ['--turn-color' as string]: current?.color ?? 'transparent' }} />
          {view.winner
            ? 'Game over'
            : view.moves.isMyTurn
              ? 'Your turn'
              : `${current?.name ?? 'Someone'}’s turn`}
        </div>
      </header>

      <div className="board-stage">
        <BoardView
          is3d={boardMode.is3d}
          roll={roll}
          view={view}
          pending={active}
          onVertex={(vertex) => {
            if (view.phase === 'setup') api.send({ type: 'placeSetupSettlement', vertex });
            else if (active === 'city') api.send({ type: 'buildCity', vertex });
            else api.send({ type: 'buildSettlement', vertex });
            setPending(null);
          }}
          onEdge={(edge) => {
            if (view.phase === 'setup') api.send({ type: 'placeSetupRoad', edge });
            else api.send({ type: 'buildRoad', edge });
            setPending(null);
          }}
          onHex={(hex) => {
            api.send({ type: 'moveRobber', hex });
            setPending(null);
          }}
        />
      </div>

      <Rail view={view} me={api.me} />

      <HandBar
        view={view}
        pending={active}
        setPending={setPending}
        onRoll={() => api.send({ type: 'rollDice' })}
        onEndTurn={() => api.send({ type: 'endTurn' })}
        onBuyDevCard={() => api.send({ type: 'buyDevCard' })}
        openTrade={() => setShowTrade(true)}
        openCards={() => setShowCards(true)}
      />

      <CardFlights roll={roll} me={api.me} />

      <DiscardModal view={view} send={api.send} />
      <StealModal view={view} send={api.send} />
      <TradeOfferModal view={view} send={api.send} />
      {showTrade && <TradeModal view={view} send={api.send} onClose={() => setShowTrade(false)} />}
      {showCards && <DevCardModal view={view} send={api.send} onClose={() => setShowCards(false)} />}
      <WinnerModal view={view} onLeave={api.leave} />

      {api.error && (
        <div className="toast" role="status" onClick={api.dismissError}>
          {api.error}
        </div>
      )}
    </div>
  );
}

/** The most recent roll seen in this tab, as something the board and overlay can animate. */
function useRoll(view: PlayerView): RollFx | null {
  const prev = useRef<PlayerView | null>(null);
  const [roll, setRoll] = useState<RollFx | null>(null);
  useEffect(() => {
    const ev = detectRoll(prev.current, view);
    prev.current = view;
    if (ev) setRoll((r) => ({ ...ev, id: (r?.id ?? 0) + 1 }));
  }, [view]);
  return roll;
}
