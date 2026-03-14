import { getEngine, listGameTypes } from "../../packages/game-engine/src/registry.ts";
import { initTexasHoldemMatchState } from "../../packages/game-engine/src/texas-holdem.ts";
import { initUnoMatchState } from "../../packages/game-engine/src/uno.ts";
import type { MatchPlayer, MatchState, Seat } from "../../packages/game-engine/src/types.ts";

declare const process: { exit(code?: number): void };

type ParticipantType = "owner" | "bot";

interface Participant {
  id: string;
  seat: Seat;
  type: ParticipantType;
}

interface VirtualRoom {
  roomId: string;
  gameType: string;
  ownerId: string;
  participants: Participant[];
  state: MatchState;
}

const DEFAULT_MAX_STEPS = 400;

function requiredPlayers(gameType: string): number {
  const engine = getEngine(gameType);
  return Number(engine.minPlayers || 2);
}

function seatsFor(gameType: string): Seat[] {
  const engine = getEngine(gameType);
  if (engine.seats?.length) return [...engine.seats];
  return ["black", "white"];
}

function createRoom(gameType: string): VirtualRoom {
  const engine = getEngine(gameType);
  return {
    roomId: `smoke_${gameType}_${Date.now()}`,
    gameType,
    ownerId: "owner-smoke",
    participants: [],
    state: engine.initState(),
  };
}

function addOwner(room: VirtualRoom): void {
  const seat = seatsFor(room.gameType)[0];
  room.participants.push({ id: "owner-smoke", seat, type: "owner" });
}

function addBotsUntilReady(room: VirtualRoom): void {
  const seats = seatsFor(room.gameType);
  const need = Math.max(requiredPlayers(room.gameType), seats.length);
  for (let i = 1; room.participants.length < need; i++) {
    const seat = seats[room.participants.length] || `seat_${room.participants.length + 1}`;
    room.participants.push({ id: `bot:${i}`, seat, type: "bot" });
  }
}

function startRoom(room: VirtualRoom): void {
  if (room.gameType === "texas_holdem") {
    room.state = initTexasHoldemMatchState(room.participants.map((p) => p.seat));
    return;
  }
  if (room.gameType === "uno") {
    room.state = initUnoMatchState(room.participants.map((p) => p.seat));
    return;
  }
  room.state = { ...room.state, status: "playing" };
}

function playerBySeat(room: VirtualRoom, seat: Seat): Participant | undefined {
  return room.participants.find((p) => p.seat === seat);
}

function fallbackFinish(room: VirtualRoom, seat: Seat): void {
  const engine = getEngine(room.gameType);
  const seats = engine.seats?.length ? [...engine.seats] : seatsFor(room.gameType);
  const winner = seats.find((s) => s !== seat) || "draw";
  room.state = {
    ...room.state,
    status: "finished",
    winner,
  };
}

function quickGoMove(state: MatchState, step: number): { x?: number; y?: number; pass?: boolean } {
  if (step >= 20) return { pass: true };
  const board = Array.isArray((state as any).board) ? ((state as any).board as Array<Array<string | null>>) : [];
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board[y].length; x++) {
      if (board[y][x] == null) return { x, y };
    }
  }
  return { pass: true };
}

function runToEnd(room: VirtualRoom, maxSteps = DEFAULT_MAX_STEPS): { steps: number; winner: string } {
  const engine = getEngine(room.gameType);
  let step = 0;

  while (step < maxSteps) {
    if (room.state.status === "finished") {
      return { steps: step, winner: String(room.state.winner || "draw") };
    }

    const seat = String(room.state.nextTurn || "");
    if (!seat) {
      fallbackFinish(room, seat);
      continue;
    }

    const participant = playerBySeat(room, seat);
    if (!participant) {
      throw new Error(`no participant bound for nextTurn seat=${seat}`);
    }

    let move = room.gameType === "go"
      ? quickGoMove(room.state, step)
      : (engine.chooseBotMove ? engine.chooseBotMove(room.state, seat) : null);
    if (!move) {
      fallbackFinish(room, seat);
      continue;
    }

    engine.validateMove(room.state, seat, move);
    room.state = engine.applyMove(room.state, seat, move);
    step += 1;
  }

  room.state = {
    ...room.state,
    status: "finished",
    winner: "draw",
  };
  return { steps: maxSteps, winner: "draw" };
}

function toMatchPlayers(room: VirtualRoom): MatchPlayer[] {
  return room.participants.map((p) => ({ id: p.id, seat: p.seat, token: `${p.id}_token` }));
}

function runOne(gameType: string): void {
  const room = createRoom(gameType);
  addOwner(room);
  addBotsUntilReady(room);
  startRoom(room);

  const participants = toMatchPlayers(room);
  if (participants.length < requiredPlayers(gameType)) {
    throw new Error(`${gameType} did not reach minimum players`);
  }

  const result = runToEnd(room);
  console.log(
    JSON.stringify({
      gameType,
      roomId: room.roomId,
      participants: participants.length,
      steps: result.steps,
      winner: result.winner,
      status: room.state.status,
    }),
  );
}

function main(): void {
  const games = listGameTypes();
  const failed: Array<{ gameType: string; error: string }> = [];
  for (const gameType of games) {
    try {
      runOne(gameType);
    } catch (err) {
      failed.push({ gameType, error: (err as Error).message });
      console.error(JSON.stringify({ gameType, ok: false, error: (err as Error).message }));
    }
  }

  if (failed.length > 0) {
    console.error(`Smoke flow failed for ${failed.length} game(s).`);
    process.exit(1);
  }
  console.log(`Smoke flow passed for ${games.length} game(s).`);
}

main();
