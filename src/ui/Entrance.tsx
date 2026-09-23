import { useEffect, useState, type FormEvent } from 'react';
import { MAPS } from '../../shared/scenario';
import { savedSeats, type GameApi } from '../net/useGame';
import type { RoomSummary } from '../../server/rooms';

const MAX_PLAYERS = 4;

/** ponytail: polls every few seconds; push over the socket if lobby churn ever matters. */
function useLobbies(): RoomSummary[] {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch('/api/rooms')
        .then((r) => r.json())
        .then((body: { rooms: RoomSummary[] }) => live && setRooms(body.rooms))
        .catch(() => {});
    void load();
    const timer = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return rooms;
}

export function Entrance({ api }: { api: GameApi }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = savedSeats();
  // Rooms nobody is sitting in stay hidden, unless this browser holds a seat there.
  const lobbies = useLobbies().filter((r) => r.code in mine || (r.connected > 0 && !r.finished));

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setProblem(await fn());
    setBusy(false);
  }

  function host(e: FormEvent) {
    e.preventDefault();
    void run(() => api.createRoom(name));
  }

  function join(e: FormEvent) {
    e.preventDefault();
    if (code.trim().length < 4) {
      setProblem('Enter the four-letter code from your host.');
      return;
    }
    void run(() => api.joinRoom(code, name));
  }

  return (
    <div className="entrance">
      <div className="entrance-card">
        <div className="wordmark">
          Cat<span>a</span>n
        </div>
        <p className="entrance-lede">
          Settle the island with friends. One of you starts a game and shares the code; everyone else joins with it.
        </p>

        <form onSubmit={host}>
          <label className="field">
            <span className="field-label">Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ann"
              maxLength={16}
              autoComplete="nickname"
            />
          </label>

          <button className="btn btn-primary" type="submit" disabled={busy || !api.connected} style={{ width: '100%' }}>
            Start a new game
          </button>
        </form>

        <div className="divider">or join one</div>

        <form onSubmit={join}>
          <label className="field">
            <span className="field-label">Game code</span>
            <input
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="XKPQ"
              maxLength={4}
              autoCapitalize="characters"
              spellCheck={false}
            />
          </label>
          <button className="btn" type="submit" disabled={busy || !api.connected} style={{ width: '100%' }}>
            Join game
          </button>
        </form>

        {lobbies.length > 0 && (
          <>
            <div className="divider">lobbies</div>
            <ul className="seat-list">
              {lobbies.map((r) => {
                const open = !r.started && (r.players < MAX_PLAYERS || r.connected < r.players);
                return (
                  <li key={r.code} className="seat">
                    <span className="seat-name">
                      <span className="room-code">{r.code}</span> {MAPS[r.map]?.name}
                    </span>
                    <span className="seat-tag">
                      {r.finished ? 'finished' : r.started ? 'playing' : `${r.connected}/${MAX_PLAYERS}`}
                    </span>
                    {r.code in mine ? (
                      <button className="btn" disabled={busy || !api.connected} onClick={() => void run(() => api.resume(r.code))}>
                        Resume
                      </button>
                    ) : (
                      <button
                        className="btn"
                        disabled={busy || !api.connected || !open}
                        onClick={() => void run(() => api.joinRoom(r.code, name))}
                      >
                        Join
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {!api.connected && <div className="notice">Connecting to the server…</div>}
        {(problem ?? api.error) && <div className="notice">{problem ?? api.error}</div>}
      </div>
    </div>
  );
}
