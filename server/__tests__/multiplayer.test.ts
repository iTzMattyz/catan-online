import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { start, stop } from '../index';
import type { PlayerView } from '../../shared/redact';
import type { Action, PlayerId } from '../../shared/types';

type Sync = {
  room: { code: string; hostId: PlayerId; started: boolean; players: { id: PlayerId; name: string }[] };
  view: PlayerView | null;
  you: { id: PlayerId; name: string };
};

/** A test client that mirrors what the browser does over the wire. */
class Client {
  socket: Socket;
  sync: Sync | null = null;
  errors: string[] = [];
  code = '';
  token = '';
  id: PlayerId = '';

  constructor(private url: string) {
    this.socket = connect(this.url, { transports: ['websocket'], forceNew: true });
    this.socket.on('sync', (payload: Sync) => (this.sync = payload));
    this.socket.on('error:message', (message: string) => this.errors.push(message));
  }

  ready(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket.connected) return resolve();
      this.socket.once('connect', () => resolve());
    });
  }

  private emitWithAck(event: string, payload: object): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      this.socket.emit(event, payload, (res: { ok: true; code: string; token: string; playerId: string } | { ok: false; error: string }) => {
        if (res.ok) {
          this.code = res.code;
          this.token = res.token;
          this.id = res.playerId;
        }
        resolve(res.ok ? { ok: true } : { ok: false, error: res.error });
      });
    });
  }

  create(name: string) {
    return this.emitWithAck('room:create', { name });
  }

  join(code: string, name: string) {
    return this.emitWithAck('room:join', { code, name });
  }

  rejoin(code: string, token: string) {
    return this.emitWithAck('room:rejoin', { code, token });
  }

  send(action: Action) {
    this.socket.emit('game:action', action);
  }

  get view(): PlayerView {
    if (!this.sync?.view) throw new Error('no game state yet');
    return this.sync.view;
  }

  /** Wait until the server has pushed a state matching `predicate`. */
  async until(predicate: (sync: Sync) => boolean, label: string, timeoutMs = 4000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.sync && predicate(this.sync)) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out waiting for ${label}; last errors: ${this.errors.join(' | ')}`);
  }

  close() {
    this.socket.close();
  }
}

let url = '';
const clients: Client[] = [];

function makeClient(): Client {
  const c = new Client(url);
  clients.push(c);
  return c;
}

beforeAll(async () => {
  const port = await start(0);
  url = `http://localhost:${port}`;
});

afterAll(async () => {
  for (const c of clients) c.close();
  await stop();
});

describe('two players over sockets', () => {
  it('creates a room, joins it, plays the draft and keeps hands private', async () => {
    const host = makeClient();
    const guest = makeClient();
    await Promise.all([host.ready(), guest.ready()]);

    expect((await host.create('Ann')).ok).toBe(true);
    expect(host.code).toHaveLength(4);

    expect((await guest.join(host.code, 'Bob')).ok).toBe(true);
    await host.until((s) => s.room.players.length === 2, 'the guest to appear');
    expect(host.sync!.room.players.map((p) => p.name)).toEqual(['Ann', 'Bob']);

    // Only the host may start.
    guest.socket.emit('game:start');
    await new Promise((r) => setTimeout(r, 120));
    expect(guest.errors.some((e) => /only the host/i.test(e))).toBe(true);
    expect(host.sync!.room.started).toBe(false);

    host.socket.emit('game:start');
    await host.until((s) => s.view !== null, 'the board to be dealt');
    await guest.until((s) => s.view !== null, 'the board to be dealt');

    // The board is identical for both, and the deck stays on the server.
    expect(guest.view.board.hexes).toEqual(host.view.board.hexes);
    expect(Object.keys(host.view.board.hexes)).toHaveLength(19);
    expect(host.view.board.ports).toHaveLength(9);
    expect(host.view.devDeckSize).toBe(25);
    expect(host.view).not.toHaveProperty('devDeck');
    expect(host.view).not.toHaveProperty('rng');

    // Play out the whole snake draft through the real socket transport.
    for (let i = 0; i < 8; i++) {
      const actor = host.view.moves.isMyTurn ? host : guest;
      const before = actor.view.log.length;
      const moves = actor.view.moves;
      if (actor.view.setup?.placing === 'settlement') {
        actor.send({ type: 'placeSetupSettlement', vertex: moves.settlementSpots[0] });
      } else {
        actor.send({ type: 'placeSetupRoad', edge: moves.roadSpots[0] });
      }
      await actor.until((s) => (s.view?.log.length ?? 0) > before, `placement ${i + 1}`);
    }

    expect(host.view.phase).toBe('rolling');
    expect(Object.keys(host.view.board.buildings)).toHaveLength(4);
    expect(Object.keys(host.view.board.roads)).toHaveLength(4);

    // Each player sees their own cards and only a count for the other.
    expect(host.view.you!.id).toBe(host.id);
    expect(guest.view.you!.id).toBe(guest.id);
    const guestAsSeenByHost = host.view.players.find((p) => p.id === guest.id)!;
    expect(guestAsSeenByHost).not.toHaveProperty('resources');
    expect(typeof guestAsSeenByHost.handSize).toBe('number');

    // The server refuses an out-of-turn action no matter what the client sends.
    const offTurn = host.view.moves.isMyTurn ? guest : host;
    offTurn.errors.length = 0;
    offTurn.send({ type: 'rollDice' });
    await new Promise((r) => setTimeout(r, 120));
    expect(offTurn.errors.some((e) => /not your turn/i.test(e))).toBe(true);

    // ...and rolling works for whoever's turn it actually is.
    const onTurn = host.view.moves.isMyTurn ? host : guest;
    onTurn.send({ type: 'rollDice' });
    await onTurn.until((s) => s.view?.dice !== null, 'the dice');
    expect(onTurn.view.dice![0]).toBeGreaterThanOrEqual(1);
    expect(onTurn.view.dice![1]).toBeLessThanOrEqual(6);
  });

  it('gives a refreshed player their seat and hand back', async () => {
    const host = makeClient();
    const guest = makeClient();
    await Promise.all([host.ready(), guest.ready()]);
    await host.create('Ann');
    await guest.join(host.code, 'Bob');
    await host.until((s) => s.room.players.length === 2, 'the guest');
    host.socket.emit('game:start');
    await guest.until((s) => s.view !== null, 'the board');

    const seatBefore = guest.id;
    const handBefore = guest.view.you!.resources;
    const { code, token } = guest;

    // Simulate a browser refresh: the socket dies, a new one arrives with the
    // saved token.
    guest.close();
    await new Promise((r) => setTimeout(r, 150));
    await host.until((s) => s.room.players.some((p) => p.id === seatBefore), 'the seat to be held');

    const returning = makeClient();
    await returning.ready();
    const result = await returning.rejoin(code, token);
    expect(result.ok).toBe(true);
    expect(returning.id).toBe(seatBefore);

    await returning.until((s) => s.view !== null, 'the restored game');
    expect(returning.view.you!.resources).toEqual(handBefore);
    expect(returning.view.players.find((p) => p.id === seatBefore)!.connected).toBe(true);
  });

  it('refuses a bad code and a full or started room', async () => {
    const stranger = makeClient();
    await stranger.ready();
    expect(await stranger.join('ZZZZ', 'Nobody')).toEqual({ ok: false, error: 'No game with that code.' });

    const host = makeClient();
    const guest = makeClient();
    await Promise.all([host.ready(), guest.ready()]);
    await host.create('Ann');
    await guest.join(host.code, 'Bob');
    await host.until((s) => s.room.players.length === 2, 'the guest');
    host.socket.emit('game:start');
    await host.until((s) => s.view !== null, 'the board');

    const latecomer = makeClient();
    await latecomer.ready();
    expect(await latecomer.join(host.code, 'Cid')).toEqual({
      ok: false,
      error: 'That game has already started.',
    });
  });

  it('ignores malformed action payloads without crashing', async () => {
    const host = makeClient();
    const guest = makeClient();
    await Promise.all([host.ready(), guest.ready()]);
    await host.create('Ann');
    await guest.join(host.code, 'Bob');
    await host.until((s) => s.room.players.length === 2, 'the guest');
    host.socket.emit('game:start');
    await host.until((s) => s.view !== null, 'the board');

    const onTurn = host.view.moves.isMyTurn ? host : guest;
    for (const junk of [null, 'hello', 42, {}, { type: 'nonsense' }, { type: 'buildRoad' }]) {
      onTurn.socket.emit('game:action', junk);
    }
    await new Promise((r) => setTimeout(r, 200));

    // Still alive, still in the draft, nothing built.
    expect(onTurn.view.phase).toBe('setup');
    expect(Object.keys(onTurn.view.board.roads)).toHaveLength(0);
    onTurn.send({ type: 'placeSetupSettlement', vertex: onTurn.view.moves.settlementSpots[0] });
    await onTurn.until((s) => Object.keys(s.view!.board.buildings).length === 1, 'the settlement');
  });
});
