import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PlayerId, Resource } from '../../shared/types';
import { RESOURCE_COLOR, ResourceGlyph } from '../board/icons';
import type { RollFx } from '../fx/events';
import { hexOnScreen } from '../fx/projector';

/** Cards leave their tiles once the dice have landed and the tiles have lit up. */
const FIRST_FLIGHT_MS = 1500;
const STAGGER_MS = 120;
const FLIGHT_MS = 900;

type Point = { x: number; y: number };
type FlyingCard = { key: string; resource: Resource; from: Point; to: Point; target: Element };

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Where a card for this player lands: your own hand, or that player's seat on the rail. */
function targetFor(player: PlayerId, resource: Resource, me: PlayerId | null): Element | null {
  return player === me
    ? document.querySelector(`.handbar .card[data-resource="${resource}"]`)
    : document.querySelector(`.player-card[data-player="${player}"]`);
}

/**
 * Resource cards flying from producing tiles to whoever collected them. Pure
 * decoration over the real UI: the counts have already updated, the flight just
 * shows where they came from, and each landing gives its target a small bump.
 */
export function CardFlights({ roll, me }: { roll: RollFx | null; me: PlayerId | null }) {
  const [cards, setCards] = useState<FlyingCard[]>([]);

  useEffect(() => {
    if (!roll || reducedMotion()) return;
    const timers = roll.flights.map((f, i) =>
      setTimeout(() => {
        const from = hexOnScreen(f.hex, f.pos);
        const target = targetFor(f.player, f.resource, me);
        if (!from || !target) return;
        const r = target.getBoundingClientRect();
        const card = { key: `${roll.id}-${i}`, resource: f.resource, from, to: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, target };
        setCards((list) => [...list, card]);
      }, FIRST_FLIGHT_MS + i * STAGGER_MS),
    );
    return () => timers.forEach(clearTimeout);
    // Keyed on the roll alone: `me` never changes mid-game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll?.id]);

  const land = (key: string) => setCards((list) => list.filter((c) => c.key !== key));

  return (
    <div className="flights" aria-hidden="true">
      {cards.map((c) => (
        <Flight key={c.key} card={c} onDone={() => land(c.key)} />
      ))}
    </div>
  );
}

function Flight({ card, onDone }: { card: FlyingCard; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useLayoutEffect(() => {
    const { from, to } = card;
    const at = (p: Point, extra: string) => `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) ${extra}`;
    const peak = { x: from.x + (to.x - from.x) * 0.45, y: Math.min(from.y, to.y) - 110 };
    const anim = ref.current!.animate(
      [
        { transform: at(from, 'scale(0.3) rotate(-25deg)'), opacity: 0 },
        { transform: at({ x: from.x, y: from.y - 50 }, 'scale(1.15) rotate(-10deg)'), opacity: 1, offset: 0.22 },
        { transform: at(peak, 'scale(1) rotate(8deg)'), offset: 0.6 },
        { transform: at(to, 'scale(0.55) rotate(0deg)'), opacity: 0.85 },
      ],
      { duration: FLIGHT_MS, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' },
    );
    anim.onfinish = () => {
      card.target.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.16)' }, { transform: 'scale(1)' }], {
        duration: 300,
        easing: 'ease-out',
      });
      done.current();
    };
    return () => anim.cancel();
  }, [card]);

  return (
    <div ref={ref} className="flying-card" style={{ ['--card-color' as string]: RESOURCE_COLOR[card.resource] }}>
      <ResourceGlyph resource={card.resource} />
    </div>
  );
}
