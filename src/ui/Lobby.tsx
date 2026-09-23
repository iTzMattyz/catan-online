import { PLAYER_COLORS } from '../../shared/rules';
import { MAPS, isMapId } from '../../shared/scenario';
import type { GameApi } from '../net/useGame';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;

export function Lobby({ api }: { api: GameApi }) {
  const room = api.room!;
  const isHost = room.hostId === api.me;
  const online = room.players.filter((p) => p.connected).length;
  const enough = online >= MIN_PLAYERS;

  return (
    <div className="entrance">
      <div className="entrance-card">
        <div className="wordmark" style={{ fontSize: 30 }}>
          Cat<span>a</span>n
        </div>
        <div className="lobby-code">{room.code}</div>
        <p className="lobby-hint">Share this code. Up to {MAX_PLAYERS} players.</p>

        <ul className="seat-list">
          {room.players.map((p, i) => (
            <li key={p.id} className="seat" style={{ ['--seat-color' as string]: PLAYER_COLORS[i] }}>
              <span className="seat-name">{p.name}</span>
              {p.id === room.hostId && <span className="seat-tag">host</span>}
              {p.id === api.me && <span className="seat-tag">you</span>}
              {!p.connected && <span className="seat-tag">offline</span>}
            </li>
          ))}
          {Array.from({ length: MAX_PLAYERS - room.players.length }, (_, i) => (
            <li key={`empty-${i}`} className="seat" style={{ opacity: 0.4 }}>
              <span className="seat-name" style={{ color: 'var(--text-faint)' }}>
                Waiting for a player
              </span>
            </li>
          ))}
        </ul>

        <label className="field">
          <span className="field-label">Map</span>
          <select
            value={room.map}
            disabled={!isHost}
            onChange={(e) => isMapId(e.target.value) && api.setMap(e.target.value)}
          >
            {Object.values(MAPS).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <span className="lobby-hint">{MAPS[room.map].blurb}</span>
        </label>

        {isHost ? (
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={!enough} onClick={api.startGame}>
            {enough ? 'Deal the board' : `Waiting for ${MIN_PLAYERS - online} more`}
          </button>
        ) : (
          <div className="notice" style={{ background: 'var(--sea-abyss)', borderColor: 'var(--panel-line)', color: 'var(--text-dim)' }}>
            Waiting for the host to start.
          </div>
        )}
        <button className="btn" style={{ width: '100%', marginTop: 10 }} onClick={api.leave}>
          Leave lobby
        </button>
      </div>
    </div>
  );
}
