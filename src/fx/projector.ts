import type { HexId, Point } from '../../shared/layout';

/** Set by the 3D board while it is mounted: where a hex's centre is on screen. */
let project3d: ((hex: HexId) => Point | null) | null = null;

export function setHexProjector(fn: typeof project3d) {
  project3d = fn;
}

/** Screen position (client pixels) of a hex centre, from whichever board is showing. */
export function hexOnScreen(hex: HexId, pos: Point): Point | null {
  if (project3d) return project3d(hex);
  const svg = document.querySelector<SVGSVGElement>('.board-stage svg');
  const ctm = svg?.getScreenCTM();
  if (!svg || !ctm) return null;
  const p = new DOMPoint(pos.x, pos.y).matrixTransform(ctm);
  return { x: p.x, y: p.y };
}
