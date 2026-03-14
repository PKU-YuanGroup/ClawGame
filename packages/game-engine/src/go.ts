import type { GameEngine, MatchState, Seat } from "./types.ts";

const SIZE = 19;
const KOMI = 6.5;

type GoCell = Seat | null;
type GoBoard = GoCell[][];

interface GoMoveInput {
  x?: number;
  y?: number;
  pass?: boolean;
}

interface GoState extends MatchState {
  board: GoBoard;
  boardSize: number;
  komi: number;
  consecutivePasses: number;
  history: string[];
  lastMove?: { x?: number; y?: number; pass?: boolean; captures?: number };
  score?: { black: number; white: number };
}

interface Coords {
  x: number;
  y: number;
}

function emptyBoard(size = SIZE): GoBoard {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

function inBounds(x: number, y: number, size = SIZE): boolean {
  return x >= 0 && x < size && y >= 0 && y < size;
}

function otherSeat(seat: Seat): Seat {
  return seat === "black" ? "white" : "black";
}

function cloneBoard(board: GoBoard): GoBoard {
  return board.map((row) => [...row]);
}

function boardHash(board: GoBoard): string {
  return board.map((row) => row.map((cell) => cell || ".").join("")).join("/");
}

function neighbors(x: number, y: number, size = SIZE): Coords[] {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ].filter((p) => inBounds(p.x, p.y, size));
}

function collectGroup(board: GoBoard, start: Coords): { stones: Coords[]; liberties: Set<string> } {
  const seat = board[start.y][start.x];
  const seen = new Set<string>();
  const liberties = new Set<string>();
  const stones: Coords[] = [];
  const queue = [start];

  while (queue.length) {
    const current = queue.pop() as Coords;
    const key = `${current.x},${current.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stones.push(current);
    for (const next of neighbors(current.x, current.y, board.length)) {
      const value = board[next.y][next.x];
      if (value === null) {
        liberties.add(`${next.x},${next.y}`);
      } else if (value === seat) {
        queue.push(next);
      }
    }
  }

  return { stones, liberties };
}

function removeGroup(board: GoBoard, group: Coords[]): number {
  for (const stone of group) {
    board[stone.y][stone.x] = null;
  }
  return group.length;
}

function countStones(board: GoBoard): { black: number; white: number } {
  let black = 0;
  let white = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell === "black") black += 1;
      if (cell === "white") white += 1;
    }
  }
  return { black, white };
}

function scoreBoard(board: GoBoard, komi: number): { black: number; white: number } {
  const stones = countStones(board);
  let black = stones.black;
  let white = stones.white + komi;
  const seen = new Set<string>();

  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board.length; x++) {
      const key = `${x},${y}`;
      if (seen.has(key) || board[y][x] !== null) continue;

      const queue = [{ x, y }];
      const region: Coords[] = [];
      const borders = new Set<Seat>();
      while (queue.length) {
        const current = queue.pop() as Coords;
        const currentKey = `${current.x},${current.y}`;
        if (seen.has(currentKey)) continue;
        seen.add(currentKey);
        region.push(current);
        for (const next of neighbors(current.x, current.y, board.length)) {
          const value = board[next.y][next.x];
          if (value === null) {
            if (!seen.has(`${next.x},${next.y}`)) queue.push(next);
          } else {
            borders.add(value);
          }
        }
      }

      if (borders.size === 1) {
        const owner = Array.from(borders)[0];
        if (owner === "black") black += region.length;
        else white += region.length;
      }
    }
  }

  return {
    black: Number(black.toFixed(1)),
    white: Number(white.toFixed(1)),
  };
}

function applyPlacement(state: GoState, seat: Seat, x: number, y: number): GoState {
  const board = cloneBoard(state.board);
  if (board[y][x] !== null) throw new Error("Intersection already occupied");
  board[y][x] = seat;

  let captured = 0;
  for (const point of neighbors(x, y, board.length)) {
    if (board[point.y][point.x] !== otherSeat(seat)) continue;
    const group = collectGroup(board, point);
    if (group.liberties.size === 0) {
      captured += removeGroup(board, group.stones);
    }
  }

  const ownGroup = collectGroup(board, { x, y });
  if (ownGroup.liberties.size === 0) {
    throw new Error("Suicide move is not allowed");
  }

  const hash = boardHash(board);
  if (state.history.includes(hash)) {
    throw new Error("Ko repetition is not allowed");
  }

  return {
    ...state,
    board,
    lastMove: { x, y, captures: captured },
    history: [...state.history, hash],
    consecutivePasses: 0,
  };
}

function getLegalPlacements(state: GoState, seat: Seat): Array<{ x: number; y: number }> {
  const legal: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < state.board.length; y++) {
    for (let x = 0; x < state.board.length; x++) {
      if (state.board[y][x] !== null) continue;
      try {
        applyPlacement(state, seat, x, y);
        legal.push({ x, y });
      } catch {}
    }
  }
  return legal;
}

function normalizeMove(move: GoMoveInput): { pass: boolean; x?: number; y?: number } {
  const pass = Boolean(move?.pass);
  if (pass) return { pass: true };
  const x = Number(move?.x);
  const y = Number(move?.y);
  if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error("Invalid move payload");
  if (!inBounds(x, y)) throw new Error("Move out of board");
  return { pass: false, x, y };
}

export const goEngine: GameEngine = {
  gameType: "go",
  rules: { boardSize: 19, komi: 6.5, objective: "territory", passEndsAfter: 2, first: "black" },
  actionSchema: { type: "move", payload: { x: "number", y: "number", pass: "boolean?" } },

  initState(): MatchState {
    const board = emptyBoard();
    const hash = boardHash(board);
    const state: GoState = {
      gameType: "go",
      board,
      boardSize: SIZE,
      komi: KOMI,
      nextTurn: "black",
      status: "waiting",
      moveCount: 0,
      consecutivePasses: 0,
      history: [hash],
    };
    return state;
  },

  validateMove(state, seat, move): void {
    const goState = state as GoState;
    if (goState.status !== "playing") throw new Error("Match is not in playing status");
    if (goState.nextTurn !== seat) throw new Error("Not your turn");
    const normalized = normalizeMove(move as GoMoveInput);
    if (normalized.pass) return;
    applyPlacement(goState, seat, normalized.x as number, normalized.y as number);
  },

  applyMove(state, seat, move): MatchState {
    const goState = state as GoState;
    const normalized = normalizeMove(move as GoMoveInput);
    let next: GoState;

    if (normalized.pass) {
      next = {
        ...goState,
        consecutivePasses: goState.consecutivePasses + 1,
        lastMove: { pass: true },
      };
    } else {
      next = applyPlacement(goState, seat, normalized.x as number, normalized.y as number);
    }

    const opponent = otherSeat(seat);
    const finished = next.consecutivePasses >= 2;
    const score = finished ? scoreBoard(next.board, next.komi) : undefined;
    const winner = finished
      ? score!.black === score!.white
        ? "draw"
        : score!.black > score!.white
          ? "black"
          : "white"
      : undefined;

    const result: GoState = {
      ...next,
      moveCount: goState.moveCount + 1,
      nextTurn: opponent,
      status: finished ? "finished" : "playing",
      winner,
      score,
    };
    return result;
  },

  chooseBotMove(state, seat) {
    const goState = state as GoState;
    if (goState.status !== "playing" || goState.nextTurn !== seat) return null;
    const legal = getLegalPlacements(goState, seat);
    if (!legal.length) return { pass: true };
    const enemy = otherSeat(seat);

    const ranked = legal
      .map((move) => {
        const next = applyPlacement(goState, seat, move.x, move.y);
        const score = scoreBoard(next.board, next.komi);
        const own = seat === "black" ? score.black : score.white;
        const opp = seat === "black" ? score.white : score.black;
        const captureBonus = Number(next.lastMove?.captures || 0) * 10;
        const enemyReplies = getLegalPlacements(next, enemy).length;
        const centerBias = -Math.abs((SIZE - 1) / 2 - move.x) - Math.abs((SIZE - 1) / 2 - move.y);
        return {
          move,
          score: (own - opp) * 5 + captureBonus + centerBias - enemyReplies * 0.05,
        };
      })
      .sort((a, b) => b.score - a.score);

    const best = ranked[0]?.move;
    if (!best) return { pass: true };
    return best;
  },

  snapshot(state) {
    const goState = state as GoState;
    return {
      ...goState,
      size: goState.boardSize,
      boardSize: goState.boardSize,
    };
  },
};
