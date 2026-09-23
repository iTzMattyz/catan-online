import fs from 'node:fs';
import path from 'node:path';
import { applyAction, createGame } from '../shared/rules';
import { viewFor, type PlayerView } from '../shared/redact';
import { MAPS, isMapId, type MapId } from '../shared/scenario';
import type { Action, GameState, PlayerId } from '../shared/types';

export const MAX_SEATS = 4;
export const MIN_SEATS = 2;

export type Seat = {
  /** Public identity, safe to broadcast. */
  playerId: PlayerId;
  /** Private reconnect secret — never leaves the seat's own socket. */
  token: string;
  name: string;
  socketId: string | null;
};

export type Room = {
  code: string;
  hostId: PlayerId;
  seats: Seat[];
  /** Picked by the host in the lobby. */
  map: MapId;
  state: GameState | null;
  updatedAt: number;
};

export type RoomView = {
  code: string;
  hostId: PlayerId;
  started: boolean;
  map: MapId;
  players: { id: PlayerId; name: string; connected: boolean }[];
};

const rooms = new Map<string, Room>();

// -- persistence -------------------------------------------------------------

let dataFile: string | null = null;

/**
 * Load rooms from disk and write them back after every change, so a server
 * restart no longer ends games. Only the real server turns this on; tests keep
 * the store in memory.
 */
export function enablePersistence(file: string): void {
  dataFile = file;
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as Room[];
    for (const room of saved) {
      // Nobody is connected to a server that has just started.
      for (const seat of room.seats) seat.socketId = null;
      for (const p of room.state?.players ?? []) p.connected = false;
      rooms.set(room.code, room);
    }
  } catch {
    // No file yet, or unreadable: start empty.
  }
}

/** ponytail: rewrites the whole store on every change; fine for a few dozen rooms, per-room files if it grows. */
export function saveRooms(): void {
  if (!dataFile) return;
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const tmp = `${dataFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify([...rooms.values()]));
  fs.renameSync(tmp, dataFile);
}

// Unambiguous alphabet: no O/0, no I/1.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomString(length: number, alphabet: string): string {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function newCode(): string {
  let code = randomString(4, CODE_ALPHABET);
  while (rooms.has(code)) code = randomString(4, CODE_ALPHABET);
  return code;
}

function newToken(): string {
  return randomString(24, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
}

function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().slice(0, 16) : '';
  return name || 'Player';
}

export function roomView(room: Room): RoomView {
  return {
    code: room.code,
    hostId: room.hostId,
    started: room.state !== null,
    map: room.map,
    players: room.seats.map((s) => ({ id: s.playerId, name: s.name, connected: s.socketId !== null })),
  };
}

export function getRoom(code: unknown): Room | undefined {
  return typeof code === 'string' ? rooms.get(code.trim().toUpperCase()) : undefined;
}

export function createRoom(name: unknown, socketId: string): { room: Room; seat: Seat } {
  const seat: Seat = { playerId: 'p1', token: newToken(), name: cleanName(name), socketId };
  const room: Room = { code: newCode(), hostId: seat.playerId, seats: [seat], map: 'classic', state: null, updatedAt: Date.now() };
  rooms.set(room.code, room);
  return { room, seat };
}

/** Lobby seats of people who went away; a newcomer or the deal may clear them. */
function dropOfflineSeats(room: Room): void {
  room.seats = room.seats.filter((s) => s.socketId !== null);
}

/** Lowest free id, so a seat freed mid-lobby never leaves two players sharing one. */
function freePlayerId(room: Room): PlayerId {
  let i = 1;
  while (room.seats.some((s) => s.playerId === `p${i}`)) i++;
  return `p${i}`;
}

export function joinRoom(code: unknown, name: unknown, socketId: string): { room: Room; seat: Seat } | string {
  const room = getRoom(code);
  if (!room) return 'No game with that code.';
  if (room.state) return 'That game has already started.';
  if (room.seats.length >= MAX_SEATS) dropOfflineSeats(room);
  if (room.seats.length >= MAX_SEATS) return 'That game is full.';

  const seat: Seat = {
    playerId: freePlayerId(room),
    token: newToken(),
    name: cleanName(name),
    socketId,
  };
  room.seats.push(seat);
  room.updatedAt = Date.now();
  return { room, seat };
}

/**
 * Reconnect by secret token. This is what makes a browser refresh survivable:
 * the seat, the hand and the turn order are all still on the server.
 */
export function rejoinRoom(code: unknown, token: unknown, socketId: string): { room: Room; seat: Seat } | string {
  const room = getRoom(code);
  if (!room) return 'No game with that code.';
  const seat = room.seats.find((s) => s.token === token);
  if (!seat) return 'That seat is not in this game.';

  seat.socketId = socketId;
  if (room.state) {
    const player = room.state.players.find((p) => p.id === seat.playerId);
    if (player) player.connected = true;
  }
  room.updatedAt = Date.now();
  return { room, seat };
}

export function startGame(room: Room, playerId: PlayerId): string | null {
  if (room.hostId !== playerId) return 'Only the host can start the game.';
  if (room.state) return 'The game has already started.';
  if (room.seats.filter((s) => s.socketId !== null).length < MIN_SEATS) return `You need at least ${MIN_SEATS} players.`;
  dropOfflineSeats(room);

  room.state = createGame(
    room.seats.map((s) => ({ id: s.playerId, name: s.name })),
    undefined,
    MAPS[room.map],
  );
  room.updatedAt = Date.now();
  return null;
}

export function setMap(room: Room, playerId: PlayerId, map: unknown): string | null {
  if (room.hostId !== playerId) return 'Only the host can pick the map.';
  if (room.state) return 'The game has already started.';
  if (!isMapId(map)) return 'No such map.';
  room.map = map;
  room.updatedAt = Date.now();
  return null;
}

export function act(room: Room, playerId: PlayerId, action: Action): string | null {
  if (!room.state) return 'The game has not started.';
  const result = applyAction(room.state, playerId, action);
  if (!result.ok) return result.error;
  room.state = result.state;
  room.updatedAt = Date.now();
  return null;
}

/**
 * A dropped connection keeps the seat, in the lobby as well as in a game, so a
 * refresh or a server restart puts everyone back where they were.
 */
export function markDisconnected(socketId: string): Room[] {
  const touched: Room[] = [];
  for (const room of rooms.values()) {
    const seat = room.seats.find((s) => s.socketId === socketId);
    if (!seat) continue;
    seat.socketId = null;

    if (room.state) {
      const player = room.state.players.find((p) => p.id === seat.playerId);
      if (player) player.connected = false;
    } else if (room.hostId === seat.playerId) {
      // Someone still here has to be able to deal.
      const online = room.seats.find((s) => s.socketId !== null);
      if (online) room.hostId = online.playerId;
    }
    touched.push(room);
  }
  return touched;
}

/**
 * Going back to the menu on purpose. A lobby seat is given up; a seat in a game
 * is kept, so the player can resume it later.
 */
export function leaveRoom(room: Room, seat: Seat): void {
  markDisconnected(seat.socketId ?? '');
  if (room.state) return;
  room.seats = room.seats.filter((s) => s !== seat);
  if (room.seats.length === 0) rooms.delete(room.code);
  else if (room.hostId === seat.playerId) room.hostId = (room.seats.find((s) => s.socketId !== null) ?? room.seats[0]).playerId;
}

export function viewForSeat(room: Room, seat: Seat): PlayerView | null {
  return room.state ? viewFor(room.state, seat.playerId) : null;
}

/** Drop rooms nobody has touched in a week. */
export function sweepStaleRooms(maxAgeMs = 7 * 24 * 60 * 60 * 1000): void {
  const cutoff = Date.now() - maxAgeMs;
  for (const [code, room] of rooms) {
    const anyoneHere = room.seats.some((s) => s.socketId !== null);
    if (!anyoneHere && room.updatedAt < cutoff) rooms.delete(code);
  }
}

export function roomCount(): number {
  return rooms.size;
}

/** A read-only snapshot of the in-memory store, for the status endpoint. */
export type RoomSummary = {
  code: string;
  map: MapId;
  players: number;
  connected: number;
  started: boolean;
  finished: boolean;
  ageMs: number;
};

export function roomsSnapshot(): RoomSummary[] {
  return [...rooms.values()].map((room) => ({
    code: room.code,
    map: room.map,
    players: room.seats.length,
    connected: room.seats.filter((s) => s.socketId !== null).length,
    started: room.state !== null,
    finished: room.state?.phase === 'finished',
    ageMs: Date.now() - room.updatedAt,
  }));
}

/** Test seam: drop every room so one test file cannot leak into the next. */
export function resetRooms(): void {
  rooms.clear();
}
