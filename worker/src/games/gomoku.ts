import type { GameEngine, MatchState, Seat } from "./types";

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

  snapshot(state) {
    return {
      size: SIZE,
      ...state,
    };
  },
};
