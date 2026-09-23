import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { PlayerView } from '../../shared/redact';
import type { MapId } from '../../shared/scenario';
import type { Action, PlayerId } from '../../shared/types';

export type RoomView = {
  code: string;
  hostId: PlayerId;
  started: boolean;
  map: MapId;
  players: { id: PlayerId; name: string; connected: boolean }[];
};

type Sync = { room: RoomView; view: PlayerView | null; you: { id: PlayerId; name: string } };

type Session = { code: string; token: string };

const SESSION_KEY = 'catan.session';

/**
 * Per-tab, not per-browser. sessionStorage survives a refresh — which is what
 * reconnecting needs — but a second tab gets its own seat instead of stealing
 * the first one's, which is how people usually try the game out.
 */
const store = () => sessionStorage;

function loadSession(): Session | null {
  try {
    const raw = store().getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(session: Session | null): void {
  try {
    if (session) store().setItem(SESSION_KEY, JSON.stringify(session));
    else store().removeItem(SESSION_KEY);
  } catch {
    // Private browsing can refuse storage; the game still works, a refresh just
    // loses the seat.
  }
}

/**
 * Every seat this browser has held, by room code, so a game left for the menu
 * can be resumed later. localStorage on purpose: it outlives the tab.
 */
const SEATS_KEY = 'catan.seats';

export function savedSeats(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SEATS_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function saveSeat(code: string, token: string | null): void {
  try {
    const seats = savedSeats();
    if (token) seats[code] = token;
    else delete seats[code];
    localStorage.setItem(SEATS_KEY, JSON.stringify(seats));
  } catch {
    // Storage refused: resuming from the menu just is not offered.
  }
}

export type GameApi = {
  connected: boolean;
  room: RoomView | null;
  view: PlayerView | null;
  me: PlayerId | null;
  error: string | null;
  dismissError: () => void;
  createRoom: (name: string) => Promise<string | null>;
  joinRoom: (code: string, name: string) => Promise<string | null>;
  resume: (code: string) => Promise<string | null>;
  startGame: () => void;
  setMap: (map: MapId) => void;
  send: (action: Action) => void;
  leave: () => void;
};

export function useGame(): GameApi {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [view, setView] = useState<PlayerView | null>(null);
  const [me, setMe] = useState<PlayerId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const socket = io({ path: '/socket.io' });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      // Reclaim the seat after a refresh or a dropped connection.
      const session = loadSession();
      if (!session) return;
      socket.emit('room:rejoin', session, (res: { ok: boolean; playerId?: PlayerId; error?: string }) => {
        if (res.ok && res.playerId) {
          setMe(res.playerId);
          return;
        }
        // The seat is gone — the game was swept or the seat given up. Drop back
        // to the entrance rather than leaving a board on screen that no longer
        // exists anywhere.
        saveSession(null);
        saveSeat(session.code, null);
        setRoom(null);
        setView(null);
        setMe(null);
        setError(res.error ?? 'That game is no longer available.');
      });
    });

    socket.on('disconnect', () => setConnected(false));
    socket.on('sync', (payload: Sync) => {
      setRoom(payload.room);
      setView(payload.view);
      setMe(payload.you.id);
    });
    socket.on('error:message', (message: string) => setError(message));

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, []);

  const enter = useCallback((event: 'room:create' | 'room:join' | 'room:rejoin', payload: object): Promise<string | null> => {
    return new Promise((resolve) => {
      const socket = socketRef.current;
      if (!socket) return resolve('Not connected yet.');
      socket.emit(
        event,
        payload,
        (res: { ok: true; code: string; token: string; playerId: PlayerId } | { ok: false; error: string }) => {
          if (!res.ok) return resolve(res.error);
          saveSession({ code: res.code, token: res.token });
          saveSeat(res.code, res.token);
          setMe(res.playerId);
          resolve(null);
        },
      );
    });
  }, []);

  return {
    connected,
    room,
    view,
    me,
    error,
    dismissError: useCallback(() => setError(null), []),
    createRoom: useCallback((name: string) => enter('room:create', { name }), [enter]),
    joinRoom: useCallback((code: string, name: string) => enter('room:join', { code, name }), [enter]),
    resume: useCallback(
      async (code: string) => {
        const error = await enter('room:rejoin', { code, token: savedSeats()[code] });
        if (error) saveSeat(code, null);
        return error;
      },
      [enter],
    ),
    startGame: useCallback(() => socketRef.current?.emit('game:start'), []),
    setMap: useCallback((map: MapId) => socketRef.current?.emit('room:map', map), []),
    send: useCallback((action: Action) => socketRef.current?.emit('game:action', action), []),
    // A lobby seat is given up; a game seat is kept on the server and in
    // savedSeats, so the menu can offer to resume it.
    leave: useCallback(() => {
      socketRef.current?.emit('room:leave');
      const session = loadSession();
      if (session && !room?.started) saveSeat(session.code, null);
      saveSession(null);
      setRoom(null);
      setView(null);
      setMe(null);
    }, [room?.started]),
  };
}
