import { useEffect, useState } from 'react';
import type { PlayerView } from '../../shared/redact';
import { RESOURCES, type Action, type DevCardType, type PlayerId, type Resource, type ResourceCounts } from '../../shared/types';
import { RESOURCE_COLOR, RESOURCE_NAME, ResourceGlyph } from '../board/icons';
import { emptyCounts, totalOf } from './HandBar';
import { Confetti } from './Confetti';

function Scrim({ children }: { children: React.ReactNode }) {
  return (
    <div className="scrim" role="dialog" aria-modal="true">
      <div className="modal">{children}</div>
    </div>
  );
}

/** A row of five resources with +/- steppers, bounded by `max`. */
function CountPicker({
  counts,
  max,
  onChange,
  showHeld = true,
}: {
  counts: ResourceCounts;
  max: ResourceCounts;
  onChange: (next: ResourceCounts) => void;
  /** Off when `max` is just a cap rather than the player's actual hand. */
  showHeld?: boolean;
}) {
  const step = (r: Resource, delta: number) => {
    const next = { ...counts, [r]: Math.max(0, Math.min(max[r], counts[r] + delta)) };
    onChange(next);
  };

  return (
    <div className="picker">
      {RESOURCES.map((r) => (
        <div key={r} className="picker-cell" data-selected={counts[r] > 0}>
          <span style={{ color: RESOURCE_COLOR[r] }}>
            <ResourceGlyph resource={r} />
          </span>
          <div className="stepper">
            <button onClick={() => step(r, -1)} disabled={counts[r] === 0} aria-label={`One less ${RESOURCE_NAME[r]}`}>
              −
            </button>
            <span>{counts[r]}</span>
            <button
              onClick={() => step(r, 1)}
              disabled={counts[r] >= max[r]}
              aria-label={`One more ${RESOURCE_NAME[r]}`}
            >
              +
            </button>
          </div>
          {showHeld && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{max[r]} held</span>}
        </div>
      ))}
    </div>
  );
}

export function DiscardModal({ view, send }: { view: PlayerView; send: (a: Action) => void }) {
  const owed = view.moves.mustDiscard;
  const held = view.you?.resources ?? emptyCounts();
  const [picked, setPicked] = useState<ResourceCounts>(emptyCounts);
  const chosen = totalOf(picked);

  if (owed === 0) return null;

  return (
    <Scrim>
      <h2>The robber takes his cut</h2>
      <p className="modal-lede">
        You are holding {totalOf(held)} cards, so {owed} of them go back to the bank. Pick which.
      </p>
      <CountPicker counts={picked} max={held} onChange={setPicked} />
      <div className="modal-actions">
        <span style={{ marginRight: 'auto', color: chosen === owed ? 'var(--good)' : 'var(--text-dim)', fontSize: 14 }}>
          {chosen} of {owed} chosen
        </span>
        <button
          className="btn btn-primary"
          disabled={chosen !== owed}
          onClick={() => {
            send({ type: 'discard', resources: picked });
            setPicked(emptyCounts());
          }}
        >
          Discard
        </button>
      </div>
    </Scrim>
  );
}

export function StealModal({ view, send }: { view: PlayerView; send: (a: Action) => void }) {
  const targets = view.moves.stealTargets;
  if (view.phase !== 'stealing' || targets.length === 0) return null;

  return (
    <Scrim>
      <h2>Take a card</h2>
      <p className="modal-lede">The robber lets you take one card, unseen, from a player on that hex.</p>
      <div className="responses">
        {targets.map((id) => {
          const p = view.players.find((x) => x.id === id)!;
          return (
            <button key={id} className="response" onClick={() => send({ type: 'steal', target: id })}>
              <span className="turn-dot" style={{ ['--turn-color' as string]: p.color }} />
              <span>{p.name}</span>
              <span className="response-state">{p.handSize} cards</span>
            </button>
          );
        })}
      </div>
    </Scrim>
  );
}

const DEV_CARD_COPY: Record<DevCardType, { title: string; text: string }> = {
  knight: { title: 'Knight', text: 'Move the robber and take a card from someone on that hex.' },
  roadBuilding: { title: 'Road Building', text: 'Build two roads for free.' },
  yearOfPlenty: { title: 'Year of Plenty', text: 'Take any two resources from the bank.' },
  monopoly: { title: 'Monopoly', text: 'Name a resource; every other player hands you all of theirs.' },
  victoryPoint: { title: 'Victory Point', text: 'Worth one point. Stays hidden until someone wins.' },
};

export function DevCardModal({
  view,
  send,
  onClose,
}: {
  view: PlayerView;
  send: (a: Action) => void;
  onClose: () => void;
}) {
  const [choosing, setChoosing] = useState<'yearOfPlenty' | 'monopoly' | null>(null);
  const [picks, setPicks] = useState<Resource[]>([]);
  const cards = (view.you?.devCards ?? []).filter((c) => !c.played);

  const play = (type: DevCardType) => {
    if (type === 'knight') {
      send({ type: 'playKnight' });
      onClose();
    } else if (type === 'roadBuilding') {
      send({ type: 'playRoadBuilding' });
      onClose();
    } else if (type === 'yearOfPlenty' || type === 'monopoly') {
      setPicks([]);
      setChoosing(type);
    }
  };

  if (choosing === 'monopoly') {
    return (
      <Scrim>
        <h2>Monopoly</h2>
        <p className="modal-lede">Every other player hands you all of this resource.</p>
        <div className="picker">
          {RESOURCES.map((r) => (
            <button
              key={r}
              className="picker-cell"
              data-selected={picks[0] === r}
              onClick={() => setPicks([r])}
            >
              <span style={{ color: RESOURCE_COLOR[r] }}>
                <ResourceGlyph resource={r} />
              </span>
              <span style={{ fontSize: 12 }}>{RESOURCE_NAME[r]}</span>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={() => setChoosing(null)}>
            Back
          </button>
          <button
            className="btn btn-primary"
            disabled={picks.length !== 1}
            onClick={() => {
              send({ type: 'playMonopoly', resource: picks[0] });
              onClose();
            }}
          >
            Take them
          </button>
        </div>
      </Scrim>
    );
  }

  if (choosing === 'yearOfPlenty') {
    return (
      <Scrim>
        <h2>Year of Plenty</h2>
        <p className="modal-lede">Take any two resources from the bank. You can take two of the same.</p>
        <div className="picker">
          {RESOURCES.map((r) => (
            <button
              key={r}
              className="picker-cell"
              data-selected={picks.includes(r)}
              disabled={picks.length >= 2}
              onClick={() => setPicks([...picks, r])}
            >
              <span style={{ color: RESOURCE_COLOR[r] }}>
                <ResourceGlyph resource={r} />
              </span>
              <span style={{ fontSize: 12 }}>{RESOURCE_NAME[r]}</span>
            </button>
          ))}
        </div>
        <p className="modal-lede">
          Chosen: {picks.length ? picks.map((r) => RESOURCE_NAME[r]).join(' and ') : 'nothing yet'}
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={() => setPicks([])}>
            Clear
          </button>
          <button className="btn" onClick={() => setChoosing(null)}>
            Back
          </button>
          <button
            className="btn btn-primary"
            disabled={picks.length !== 2}
            onClick={() => {
              send({ type: 'playYearOfPlenty', resources: [picks[0], picks[1]] });
              onClose();
            }}
          >
            Take them
          </button>
        </div>
      </Scrim>
    );
  }

  return (
    <Scrim>
      <h2>Your development cards</h2>
      <p className="modal-lede">One card per turn, and never on the turn you bought it.</p>
      <div className="dev-list">
        {cards.length === 0 && <p className="log-empty">You have no cards yet.</p>}
        {cards.map((card, i) => {
          const copy = DEV_CARD_COPY[card.type];
          return (
            <div key={i} className="dev-card" data-playable={card.playable}>
              <div>
                <h3>{copy.title}</h3>
                <p>{copy.text}</p>
              </div>
              {card.type !== 'victoryPoint' && (
                <button
                  className="btn"
                  disabled={!card.playable || !view.moves.playableDevCards.includes(card.type)}
                  onClick={() => play(card.type)}
                >
                  Play
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Scrim>
  );
}

export function TradeModal({
  view,
  send,
  onClose,
}: {
  view: PlayerView;
  send: (a: Action) => void;
  onClose: () => void;
}) {
  const held = view.you?.resources ?? emptyCounts();
  const [give, setGive] = useState<ResourceCounts>(emptyCounts);
  const [want, setWant] = useState<ResourceCounts>(emptyCounts);

  const offer = view.trade;
  const mine = offer?.from === view.you?.id;

  // Once an offer is on the table the form is replaced by the responses.
  if (offer && mine) {
    return (
      <Scrim>
        <h2>Offer on the table</h2>
        <p className="modal-lede">
          You give {describe(offer.give)} for {describe(offer.want)}.
        </p>
        <div className="responses">
          {view.players
            .filter((p) => p.id !== view.you?.id)
            .map((p) => {
              const state = offer.responses[p.id] ?? 'pending';
              return (
                <div key={p.id} className="response">
                  <span className="turn-dot" style={{ ['--turn-color' as string]: p.color }} />
                  <span>{p.name}</span>
                  <span className="response-state" data-state={state}>
                    {state === 'accept' ? 'accepted' : state === 'reject' ? 'declined' : 'thinking…'}
                  </span>
                  {state === 'accept' && (
                    <button
                      className="btn btn-primary"
                      style={{ padding: '5px 12px' }}
                      onClick={() => {
                        send({ type: 'acceptTradeWith', player: p.id });
                        onClose();
                      }}
                    >
                      Trade
                    </button>
                  )}
                </div>
              );
            })}
        </div>
        <div className="modal-actions">
          <button
            className="btn"
            onClick={() => {
              send({ type: 'cancelTrade' });
              onClose();
            }}
          >
            Withdraw offer
          </button>
        </div>
      </Scrim>
    );
  }

  const bankable = RESOURCES.filter((r) => held[r] >= view.moves.bankRates[r]);

  return (
    <Scrim>
      <h2>Trade</h2>
      <p className="modal-lede">Offer a swap to the table, or trade straight with the bank.</p>

      <div className="trade-sides">
        <div className="trade-side">
          <h3>You give</h3>
          <CountPicker counts={give} max={held} onChange={setGive} />
        </div>
        <div className="trade-swap">↓ in exchange for ↓</div>
        <div className="trade-side">
          <h3>You want</h3>
          <CountPicker counts={want} max={view.moves.tradeWantMax} onChange={setWant} showHeld={false} />
        </div>
      </div>

      <div className="modal-actions" style={{ marginBottom: 22 }}>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={totalOf(give) === 0 || totalOf(want) === 0 || !view.moves.canOfferTrade}
          onClick={() => send({ type: 'offerTrade', give, want })}
        >
          Offer it
        </button>
      </div>

      <h3 style={{ fontSize: 15, marginBottom: 8 }}>Bank and harbours</h3>
      {bankable.length === 0 ? (
        <p className="log-empty">
          You need {Math.min(...RESOURCES.map((r) => view.moves.bankRates[r]))} of one resource to trade with the bank.
        </p>
      ) : (
        <div className="responses">
          {bankable.map((from) => (
            <div key={from} className="response">
              <span style={{ color: RESOURCE_COLOR[from], width: 22, height: 22 }}>
                <ResourceGlyph resource={from} />
              </span>
              <span>
                {view.moves.bankRates[from]} {RESOURCE_NAME[from].toLowerCase()} for
              </span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {RESOURCES.filter((to) => to !== from).map((to) => (
                  <button
                    key={to}
                    className="btn"
                    style={{ padding: '4px 8px' }}
                    title={`Trade for ${RESOURCE_NAME[to].toLowerCase()}`}
                    onClick={() => send({ type: 'bankTrade', give: from, want: to })}
                  >
                    <span style={{ color: RESOURCE_COLOR[to], width: 18, height: 18, display: 'block' }}>
                      <ResourceGlyph resource={to} />
                    </span>
                  </button>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </Scrim>
  );
}

/** Shown to everyone who is not the offering player. */
export function TradeOfferModal({ view, send }: { view: PlayerView; send: (a: Action) => void }) {
  const offer = view.trade;
  if (!offer || !view.moves.mustAnswerTrade) return null;
  const from = view.players.find((p) => p.id === offer.from);

  return (
    <Scrim>
      <h2>{from?.name} wants to trade</h2>
      <p className="modal-lede">
        They give {describe(offer.give)} and want {describe(offer.want)} back.
      </p>
      <div className="modal-actions">
        <button className="btn" onClick={() => send({ type: 'respondTrade', accept: false })}>
          No thanks
        </button>
        <button
          className="btn btn-primary"
          disabled={!view.moves.canAcceptTrade}
          onClick={() => send({ type: 'respondTrade', accept: true })}
        >
          Accept
        </button>
      </div>
      {!view.moves.canAcceptTrade && <p className="log-empty">You do not hold what they want.</p>}
    </Scrim>
  );
}

/** Held back briefly so the board's victory lap and the confetti get seen first. */
const WINNER_DELAY_MS = 2600;

export function WinnerModal({ view, onLeave }: { view: PlayerView; onLeave: () => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!view.winner) return setShown(false);
    const quiet = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => setShown(true), quiet ? 0 : WINNER_DELAY_MS);
    return () => clearTimeout(t);
  }, [view.winner]);

  if (!view.winner) return null;
  const winner = view.players.find((p) => p.id === view.winner);
  const ranked = [...view.players].sort(
    (a, b) => b.victoryPoints + (b.hiddenVictoryPoints ?? 0) - (a.victoryPoints + (a.hiddenVictoryPoints ?? 0)),
  );

  // The confetti stays mounted when the banner arrives, so it fires only once.
  return (
    <>
      <Confetti colors={view.players.map((p) => p.color)} />
      {shown && (
        <Scrim>
          <div className="winner">
            <div className="wordmark">{winner?.name} wins</div>
            <p className="modal-lede">Ten victory points. The island is settled.</p>
            <ul className="scoreboard">
              {ranked.map((p) => (
                <li key={p.id} style={{ ['--player-color' as string]: p.color }}>
                  <span>{p.name}</span>
                  <b>{p.victoryPoints + (p.hiddenVictoryPoints ?? 0)}</b>
                </li>
              ))}
            </ul>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={onLeave}>
              Back to the start
            </button>
          </div>
        </Scrim>
      )}
    </>
  );
}

function describe(counts: ResourceCounts): string {
  const parts = RESOURCES.filter((r) => counts[r] > 0).map((r) => `${counts[r]} ${RESOURCE_NAME[r].toLowerCase()}`);
  return parts.length ? parts.join(' and ') : 'nothing';
}

/** Close a modal on Escape — expected of anything that covers the board. */
export function useEscape(onEscape: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onEscape]);
}

export type { PlayerId };
