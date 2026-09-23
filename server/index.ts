import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import {
  act,
  createRoom,
  enablePersistence,
  getRoom,
  joinRoom,
  leaveRoom,
  markDisconnected,
  rejoinRoom,
  roomView,
  startGame,
  setMap,
  roomCount,
  roomsSnapshot,
  saveRooms,
  sweepStaleRooms,
  viewForSeat,
  type Room,
  type Seat,
} from './rooms';
import type { Action } from '../shared/types';

const PORT = Number(process.env.PORT ?? 3001);
const here = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: true } });

/** Which seat each live socket is sitting in. */
const sockets = new Map<string, { room: Room; seat: Seat }>();

/** Push everyone in a room their own view — each player sees only their own hand. */
function broadcast(room: Room): void {
  // Every change ends in a broadcast, so this is where the store hits the disk.
  saveRooms();
  for (const seat of room.seats) {
    if (!seat.socketId) continue;
    io.to(seat.socketId).emit('sync', {
      room: roomView(room),
      view: viewForSeat(room, seat),
      you: { id: seat.playerId, name: seat.name },
    });
  }
}

type Ack = (response: { ok: true; code: string; token: string; playerId: string } | { ok: false; error: string }) => void;

function seatSocket(socket: Socket, room: Room, seat: Seat, ack?: Ack): void {
  sockets.set(socket.id, { room, seat });
  ack?.({ ok: true, code: room.code, token: seat.token, playerId: seat.playerId });
  broadcast(room);
}

io.on('connection', (socket) => {
  socket.on('room:create', ({ name }: { name?: string } = {}, ack?: Ack) => {
    const { room, seat } = createRoom(name, socket.id);
    seatSocket(socket, room, seat, ack);
  });

  socket.on('room:join', ({ code, name }: { code?: string; name?: string } = {}, ack?: Ack) => {
    const result = joinRoom(code, name, socket.id);
    if (typeof result === 'string') return ack?.({ ok: false, error: result });
    seatSocket(socket, result.room, result.seat, ack);
  });

  socket.on('room:rejoin', ({ code, token }: { code?: string; token?: string } = {}, ack?: Ack) => {
    const result = rejoinRoom(code, token, socket.id);
    if (typeof result === 'string') return ack?.({ ok: false, error: result });
    seatSocket(socket, result.room, result.seat, ack);
  });

  socket.on('room:leave', () => {
    const seated = sockets.get(socket.id);
    if (!seated) return;
    sockets.delete(socket.id);
    leaveRoom(seated.room, seated.seat);
    broadcast(seated.room);
  });

  socket.on('game:start', () => {
    const seated = sockets.get(socket.id);
    if (!seated) return;
    const error = startGame(seated.room, seated.seat.playerId);
    if (error) return socket.emit('error:message', error);
    broadcast(seated.room);
  });

  socket.on('room:map', (map: unknown) => {
    const seated = sockets.get(socket.id);
    if (!seated) return;
    const error = setMap(seated.room, seated.seat.playerId, map);
    if (error) return socket.emit('error:message', error);
    broadcast(seated.room);
  });

  socket.on('game:action', (action: Action) => {
    const seated = sockets.get(socket.id);
    if (!seated) return socket.emit('error:message', 'You are not in a game.');
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') return;

    // The engine is the only authority: the client's opinion of legality is
    // irrelevant, and a rejected action changes nothing.
    const error = act(seated.room, seated.seat.playerId, action);
    if (error) return socket.emit('error:message', error);
    broadcast(seated.room);
  });

  socket.on('disconnect', () => {
    sockets.delete(socket.id);
    for (const room of markDisconnected(socket.id)) broadcast(room);
  });
});

// Every game lives in one in-memory Map keyed by room code; this reports what
// is currently in it. No player names or seat tokens, so it is safe to expose.
app.get('/api/rooms', (_req, res) => {
  res.json({ count: roomCount(), rooms: roomsSnapshot() });
});

app.get('/api/room/:code', (req, res) => {
  const room = getRoom(req.params.code);
  res.json(room ? roomView(room) : { error: 'not found' });
});

// In production the built client is served from the same process, so there is
// one thing to run and one port to open.
if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(here, '..', 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

setInterval(() => {
  sweepStaleRooms();
  saveRooms();
}, 15 * 60 * 1000).unref();

/** Exported so tests can run the real server on an ephemeral port. */
export function start(port: number = PORT): Promise<number> {
  return new Promise((resolve) => {
    http.listen(port, () => {
      const address = http.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      resolve(actual);
    });
  });
}

export function stop(): Promise<void> {
  return new Promise((resolve) => {
    io.close(() => resolve());
  });
}

// Only listen when run directly, so importing this module in a test does not
// grab the production port.
const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  enablePersistence(process.env.CATAN_DATA ?? path.resolve(here, '..', 'data', 'rooms.json'));
  void start().then((port) => console.log(`Catan server listening on http://localhost:${port}`));
}
