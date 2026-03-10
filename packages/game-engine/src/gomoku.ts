import type { GameEngine, MatchState, Seat } from "./types.ts";

const SIZE = 15;
type Cell = Seat | null;

function emptyBoard(): Cell[][] {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
}

function inRange(v: number): boolean {
  return v >= 0 && v < SIZE;
}

function checkWin(board: Cell[][], x: number, y: number, seat: Seat): boolean {
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];

  for (const [dx, dy] of dirs) {
    let count = 1;
    for (const s of [-1, 1]) {
      let nx = x + dx * s;
      let ny = y + dy * s;
      while (inRange(nx) && inRange(ny) && board[ny][nx] === seat) {
        count++;
        nx += dx * s;
        ny += dy * s;
      }
    }
    if (count >= 5) return true;
  }

  return false;
}

function hasNeighbor(board: Cell[][], x: number, y: number, distance = 2): boolean {
  for (let dy = -distance; dy <= distance; dy++) {
    for (let dx = -distance; dx <= distance; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!inRange(nx) || !inRange(ny)) continue;
      if (board[ny][nx] !== null) return true;
    }
  }
  return false;
}

function scorePoint(board: Cell[][], x: number, y: number, seat: Seat): number {
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  let score = 0;
  for (const [dx, dy] of dirs) {
    let count = 1;
    for (const s of [-1, 1]) {
      let nx = x + dx * s;
      let ny = y + dy * s;
      while (inRange(nx) && inRange(ny) && board[ny][nx] === seat) {
        count++;
        nx += dx * s;
        ny += dy * s;
      }
    }
    score += count * count;
  }
  return score;
}

function chooseMove(board: Cell[][], seat: Seat): { x: number; y: number } | null {
  const opponent: Seat = seat === "black" ? "white" : "black";

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[y][x] !== null) continue;
      board[y][x] = seat;
      const win = checkWin(board, x, y, seat);
      board[y][x] = null;
      if (win) return { x, y };
    }
  }

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[y][x] !== null) continue;
      board[y][x] = opponent;
      const enemyWin = checkWin(board, x, y, opponent);
      board[y][x] = null;
      if (enemyWin) return { x, y };
    }
  }

  const center = Math.floor(SIZE / 2);
  if (board[center][center] === null) return { x: center, y: center };

  let best: { x: number; y: number; score: number } | null = null;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[y][x] !== null) continue;
      if (!hasNeighbor(board, x, y)) continue;
      const own = scorePoint(board, x, y, seat);
      const block = scorePoint(board, x, y, opponent);
      const score = own * 2 + block;
      if (!best || score > best.score) best = { x, y, score };
    }
  }

  if (best) return { x: best.x, y: best.y };

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[y][x] === null) return { x, y };
    }
  }
  return null;
}

export const gomokuEngine: GameEngine = {
  gameType: "gomoku",

  initState(): MatchState {
    return {
      gameType: "gomoku",
      board: emptyBoard(),
      nextTurn: "black",
      status: "waiting",
      moveCount: 0,
    };
  },

  validateMove(state, seat, move: { x: number; y: number }): void {
    if (state.status !== "playing") throw new Error("Match is not in playing status");
    if (state.nextTurn !== seat) throw new Error("Not your turn");

    const { x, y } = move ?? {};
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error("Invalid move payload");
    if (!inRange(x) || !inRange(y)) throw new Error("Move out of board");

    const board = state.board as Cell[][];
    if (board[y][x] !== null) throw new Error("Cell already occupied");
  },

  applyMove(state, seat, move: { x: number; y: number }): MatchState {
    const board = (state.board as Cell[][]).map((row) => [...row]);
    const { x, y } = move;
    board[y][x] = seat;

    const won = checkWin(board, x, y, seat);
    const full = state.moveCount + 1 >= SIZE * SIZE;

    return {
      ...state,
      board,
      moveCount: state.moveCount + 1,
      nextTurn: seat === "black" ? "white" : "black",
      status: won || full ? "finished" : "playing",
      winner: won ? seat : full ? "draw" : undefined,
    };
  },

  chooseBotMove(state, seat) {
    if (state.status !== "playing") return null;
    const board = (state.board as Cell[][]).map((row) => [...row]);
    return chooseMove(board, seat);
  },

  snapshot(state) {
    return {
      size: SIZE,
      ...state,
    };
  },
};
