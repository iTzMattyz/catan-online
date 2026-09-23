import { Component, Suspense, lazy, useState, type ReactNode } from 'react';
import { Board, type BoardProps } from '../board/Board';

const Board3D = lazy(() => import('./Board3D'));

const PREF_KEY = 'catan.board';

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

function loadPref(): '2d' | '3d' {
  try {
    return localStorage.getItem(PREF_KEY) === '2d' ? '2d' : '3d';
  } catch {
    return '3d';
  }
}

/** If the 3D board throws (lost context, driver bug), fall back to the 2D one instead of a blank stage. */
class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The board, in 3D when the browser can do it and the player hasn't asked for 2D. */
export function useBoardMode() {
  const [webgl] = useState(hasWebGL);
  const [mode, setMode] = useState(loadPref);
  const toggle = () => {
    const next = mode === '3d' ? '2d' : '3d';
    setMode(next);
    try {
      localStorage.setItem(PREF_KEY, next);
    } catch {
      // Storage refused; the choice just won't survive a reload.
    }
  };
  return { is3d: webgl && mode === '3d', canToggle: webgl, toggle };
}

export function BoardView({ is3d, ...props }: BoardProps & { is3d: boolean }) {
  // Keyed on the map so a new game on a different island rebuilds every cached geometry.
  const map = props.view.board.map;
  const flat = <Board key={map} {...props} />;
  if (!is3d) return flat;
  return (
    <Fallback key={map} fallback={flat}>
      <Suspense fallback={flat}>
        <Board3D {...props} />
      </Suspense>
    </Fallback>
  );
}
