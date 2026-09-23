import type { Resource } from '../../shared/types';

/**
 * Small hand-drawn glyphs for the five resources. Emoji would render differently
 * on every machine and read as filler; these are drawn once and stay consistent.
 */

// Chunky strokes: these are read at 22px on a card and at 28px on a harbour
// pennant, where anything finer turns to mush.
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.4,
  strokeLinejoin: 'round' as const,
  strokeLinecap: 'round' as const,
};

export function BrickIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...stroke}>
        <rect x="2.5" y="6" width="19" height="5" rx="1" />
        <rect x="2.5" y="13" width="19" height="5" rx="1" />
        <path d="M9 6v5M16 6v5M6 13v5M13 13v5" />
      </g>
    </svg>
  );
}

export function LumberIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...stroke}>
        <circle cx="7.5" cy="15.5" r="4.8" />
        <circle cx="16.5" cy="15.5" r="4.8" />
        <circle cx="12" cy="7.2" r="4.8" />
        <circle cx="7.5" cy="15.5" r="1.3" />
        <circle cx="16.5" cy="15.5" r="1.3" />
        <circle cx="12" cy="7.2" r="1.3" />
      </g>
    </svg>
  );
}

export function WoolIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...stroke}>
        <path d="M6 13.5a3 3 0 0 1-.2-5.9A3 3 0 0 1 10.6 5.6a3 3 0 0 1 4.6 1.6 3 3 0 0 1 .2 6z" />
        <path d="M7.5 13.8v3.4M12 14v3.8" />
        <path d="M17.2 10.2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z" />
        <path d="M17.4 15.4v2.2" />
      </g>
    </svg>
  );
}

export function GrainIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...stroke}>
        <path d="M12 21V8" />
        <path d="M12 8c0-2.4 1.6-4.4 3.6-5-.2 2.6-1.5 4.5-3.6 5z" />
        <path d="M12 8c0-2.4-1.6-4.4-3.6-5 .2 2.6 1.5 4.5 3.6 5z" />
        <path d="M12 14c0-2.2 1.5-4 3.4-4.6C15.2 11.8 14 13.5 12 14z" />
        <path d="M12 14c0-2.2-1.5-4-3.4-4.6C8.8 11.8 10 13.5 12 14z" />
      </g>
    </svg>
  );
}

export function OreIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...stroke}>
        <path d="M12 3.6 20 11 12 20.4 4 11z" />
        <path d="M4 11h16" />
        <path d="M12 3.6 8.4 11 12 20.4M12 3.6 15.6 11 12 20.4" />
      </g>
    </svg>
  );
}

export const RESOURCE_ICON: Record<Resource, () => JSX.Element> = {
  brick: BrickIcon,
  lumber: LumberIcon,
  wool: WoolIcon,
  grain: GrainIcon,
  ore: OreIcon,
};

export const RESOURCE_NAME: Record<Resource, string> = {
  brick: 'Brick',
  lumber: 'Lumber',
  wool: 'Wool',
  grain: 'Grain',
  ore: 'Ore',
};

export const RESOURCE_COLOR: Record<Resource, string> = {
  brick: 'var(--brick)',
  lumber: 'var(--lumber)',
  wool: 'var(--wool)',
  grain: 'var(--grain)',
  ore: 'var(--ore)',
};

export function ResourceGlyph({ resource }: { resource: Resource }) {
  const Icon = RESOURCE_ICON[resource];
  return <Icon />;
}
