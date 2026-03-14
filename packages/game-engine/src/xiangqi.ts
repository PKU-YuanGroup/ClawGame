import type { GameEngine, MatchState, Seat } from "./types.ts";

const WIDTH = 9;
const HEIGHT = 10;
const FILES = "abcdefghi";
const RANKS = "0123456789";
const PIECE_VALUE: Record<XiangqiKind, number> = {
  general: 1000,
  advisor: 2,
  elephant: 2,
  horse: 4,
  rook: 9,
  cannon: 5,
  soldier: 1,
};

type XiangqiKind = "general" | "advisor" | "elephant" | "horse" | "rook" | "cannon" | "soldier";
type XiangqiPiece = `${Seat}_${XiangqiKind}`;
type XiangqiCell = XiangqiPiece | null;
type XiangqiBoard = XiangqiCell[][];

interface XiangqiCoords {
  x: number;
  y: number;
}

interface XiangqiMoveInput {
  from: string;
  to: string;
}

interface XiangqiMove {
  from: XiangqiCoords;
  to: XiangqiCoords;
  piece: XiangqiPiece;
  capture?: XiangqiPiece;
}

interface XiangqiState extends MatchState {
  board: XiangqiBoard;
  lastMove?: { from: string; to: string; piece: XiangqiPiece; capture?: XiangqiPiece };
}

function createInitialBoard(): XiangqiBoard {
  const board: XiangqiBoard = Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => null));
  board[0] = ["black_rook", "black_horse", "black_elephant", "black_advisor", "black_general", "black_advisor", "black_elephant", "black_horse", "black_rook"];
  board[2][1] = "black_cannon";
  board[2][7] = "black_cannon";
  board[3][0] = "black_soldier";
  board[3][2] = "black_soldier";
  board[3][4] = "black_soldier";
  board[3][6] = "black_soldier";
  board[3][8] = "black_soldier";

  board[9] = ["white_rook", "white_horse", "white_elephant", "white_advisor", "white_general", "white_advisor", "white_elephant", "white_horse", "white_rook"];
  board[7][1] = "white_cannon";
  board[7][7] = "white_cannon";
  board[6][0] = "white_soldier";
  board[6][2] = "white_soldier";
  board[6][4] = "white_soldier";
  board[6][6] = "white_soldier";
  board[6][8] = "white_soldier";
  return board;
}

function cloneBoard(board: XiangqiBoard): XiangqiBoard {
  return board.map((row) => [...row]);
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
}

function otherSeat(seat: Seat): Seat {
  return seat === "black" ? "white" : "black";
}

function pieceSeat(piece: XiangqiPiece | null): Seat | null {
  return piece ? (piece.split("_", 1)[0] as Seat) : null;
}

function pieceKind(piece: XiangqiPiece): XiangqiKind {
  return piece.split("_")[1] as XiangqiKind;
}

function inPalace(seat: Seat, x: number, y: number): boolean {
  if (x < 3 || x > 5) return false;
  return seat === "black" ? y >= 0 && y <= 2 : y >= 7 && y <= 9;
}

function crossedRiver(seat: Seat, y: number): boolean {
  return seat === "black" ? y >= 5 : y <= 4;
}

function toSquare({ x, y }: XiangqiCoords): string {
  return `${FILES[x]}${RANKS[y]}`;
}

function parseSquare(square: string): XiangqiCoords | null {
  const text = String(square || "").trim().toLowerCase();
  if (!/^[a-i][0-9]$/.test(text)) return null;
  const x = FILES.indexOf(text[0]);
  const y = Number(text[1]);
  if (!inBounds(x, y)) return null;
  return { x, y };
}

function generalsFacing(board: XiangqiBoard): boolean {
  let black: XiangqiCoords | null = null;
  let white: XiangqiCoords | null = null;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (board[y][x] === "black_general") black = { x, y };
      if (board[y][x] === "white_general") white = { x, y };
    }
  }
  if (!black || !white || black.x !== white.x) return false;
  const x = black.x;
  const [start, end] = black.y < white.y ? [black.y + 1, white.y] : [white.y + 1, black.y];
  for (let y = start; y < end; y++) {
    if (board[y][x]) return false;
  }
  return true;
}

function findGeneral(board: XiangqiBoard, seat: Seat): XiangqiCoords | null {
  const target = `${seat}_general`;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (board[y][x] === target) return { x, y };
    }
  }
  return null;
}

function makeMove(from: XiangqiCoords, to: XiangqiCoords, piece: XiangqiPiece, capture?: XiangqiPiece): XiangqiMove {
  return { from, to, piece, capture };
}

function addSlidingMoves(board: XiangqiBoard, from: XiangqiCoords, seat: Seat, dirs: Array<[number, number]>, moves: XiangqiMove[], piece: XiangqiPiece): void {
  for (const [dx, dy] of dirs) {
    let x = from.x + dx;
    let y = from.y + dy;
    while (inBounds(x, y)) {
      const target = board[y][x];
      if (!target) {
        moves.push(makeMove(from, { x, y }, piece));
      } else {
        if (pieceSeat(target) !== seat) {
          moves.push(makeMove(from, { x, y }, piece, target));
        }
        break;
      }
      x += dx;
      y += dy;
    }
  }
}

function getPseudoMoves(state: XiangqiState, from: XiangqiCoords): XiangqiMove[] {
  const piece = state.board[from.y][from.x];
  if (!piece) return [];
  const seat = pieceSeat(piece) as Seat;
  const kind = pieceKind(piece);
  const moves: XiangqiMove[] = [];

  if (kind === "rook") {
    addSlidingMoves(state.board, from, seat, [[1, 0], [-1, 0], [0, 1], [0, -1]], moves, piece);
    return moves;
  }

  if (kind === "cannon") {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      let x = from.x + dx;
      let y = from.y + dy;
      let jumped = false;
      while (inBounds(x, y)) {
        const target = state.board[y][x];
        if (!jumped) {
          if (!target) {
            moves.push(makeMove(from, { x, y }, piece));
          } else {
            jumped = true;
          }
        } else if (target) {
          if (pieceSeat(target) !== seat) {
            moves.push(makeMove(from, { x, y }, piece, target));
          }
          break;
        }
        x += dx;
        y += dy;
      }
    }
    return moves;
  }

  if (kind === "horse") {
    const steps = [
      { leg: [0, -1], to: [-1, -2] },
      { leg: [0, -1], to: [1, -2] },
      { leg: [1, 0], to: [2, -1] },
      { leg: [1, 0], to: [2, 1] },
      { leg: [0, 1], to: [-1, 2] },
      { leg: [0, 1], to: [1, 2] },
      { leg: [-1, 0], to: [-2, -1] },
      { leg: [-1, 0], to: [-2, 1] },
    ] as const;
    for (const step of steps) {
      const legX = from.x + step.leg[0];
      const legY = from.y + step.leg[1];
      if (!inBounds(legX, legY) || state.board[legY][legX]) continue;
      const x = from.x + step.to[0];
      const y = from.y + step.to[1];
      if (!inBounds(x, y)) continue;
      const target = state.board[y][x];
      if (!target || pieceSeat(target) !== seat) {
        moves.push(makeMove(from, { x, y }, piece, target || undefined));
      }
    }
    return moves;
  }

  if (kind === "elephant") {
    for (const [dx, dy] of [[2, 2], [2, -2], [-2, 2], [-2, -2]] as const) {
      const eyeX = from.x + dx / 2;
      const eyeY = from.y + dy / 2;
      const x = from.x + dx;
      const y = from.y + dy;
      if (!inBounds(x, y) || state.board[eyeY][eyeX]) continue;
      if (seat === "black" && y > 4) continue;
      if (seat === "white" && y < 5) continue;
      const target = state.board[y][x];
      if (!target || pieceSeat(target) !== seat) {
        moves.push(makeMove(from, { x, y }, piece, target || undefined));
      }
    }
    return moves;
  }

  if (kind === "advisor") {
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const x = from.x + dx;
      const y = from.y + dy;
      if (!inBounds(x, y) || !inPalace(seat, x, y)) continue;
      const target = state.board[y][x];
      if (!target || pieceSeat(target) !== seat) {
        moves.push(makeMove(from, { x, y }, piece, target || undefined));
      }
    }
    return moves;
  }

  if (kind === "general") {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = from.x + dx;
      const y = from.y + dy;
      if (!inBounds(x, y) || !inPalace(seat, x, y)) continue;
      const target = state.board[y][x];
      if (!target || pieceSeat(target) !== seat) {
        moves.push(makeMove(from, { x, y }, piece, target || undefined));
      }
    }

    const enemyGeneral = findGeneral(state.board, otherSeat(seat));
    if (enemyGeneral && enemyGeneral.x === from.x) {
      let clear = true;
      const [start, end] = from.y < enemyGeneral.y ? [from.y + 1, enemyGeneral.y] : [enemyGeneral.y + 1, from.y];
      for (let y = start; y < end; y++) {
        if (state.board[y][from.x]) {
          clear = false;
          break;
        }
      }
      if (clear) {
        moves.push(makeMove(from, enemyGeneral, piece, `${otherSeat(seat)}_general`));
      }
    }
    return moves;
  }

  const forward = seat === "black" ? 1 : -1;
  const candidates: Array<[number, number]> = [[0, forward]];
  if (crossedRiver(seat, from.y)) {
    candidates.push([1, 0], [-1, 0]);
  }
  for (const [dx, dy] of candidates) {
    const x = from.x + dx;
    const y = from.y + dy;
    if (!inBounds(x, y)) continue;
    const target = state.board[y][x];
    if (!target || pieceSeat(target) !== seat) {
      moves.push(makeMove(from, { x, y }, piece, target || undefined));
    }
  }
  return moves;
}

function applyMoveOnState(state: XiangqiState, move: XiangqiMove): XiangqiState {
  const board = cloneBoard(state.board);
  board[move.from.y][move.from.x] = null;
  board[move.to.y][move.to.x] = move.piece;
  return {
    ...state,
    board,
    lastMove: {
      from: toSquare(move.from),
      to: toSquare(move.to),
      piece: move.piece,
      capture: move.capture,
    },
  };
}

function isInCheck(board: XiangqiBoard, seat: Seat): boolean {
  const general = findGeneral(board, seat);
  if (!general) return true;
  if (generalsFacing(board)) return true;

  const enemy = otherSeat(seat);
  const tmpState = {
    gameType: "xiangqi",
    board,
    nextTurn: enemy,
    status: "playing",
    moveCount: 0,
  } as XiangqiState;

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const piece = board[y][x];
      if (!piece || pieceSeat(piece) !== enemy) continue;
      if (getPseudoMoves(tmpState, { x, y }).some((move) => move.to.x === general.x && move.to.y === general.y)) {
        return true;
      }
    }
  }
  return false;
}

function getLegalMoves(state: XiangqiState, seat: Seat): XiangqiMove[] {
  const moves: XiangqiMove[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const piece = state.board[y][x];
      if (!piece || pieceSeat(piece) !== seat) continue;
      for (const move of getPseudoMoves(state, { x, y })) {
        const next = applyMoveOnState(state, move);
        if (!generalsFacing(next.board) && !isInCheck(next.board, seat)) {
          moves.push(move);
        }
      }
    }
  }
  return moves;
}

function getRequestedMove(state: XiangqiState, seat: Seat, move: XiangqiMoveInput): XiangqiMove {
  const from = parseSquare(move?.from || "");
  const to = parseSquare(move?.to || "");
  if (!from || !to) throw new Error("Invalid move squares");
  const piece = state.board[from.y][from.x];
  if (!piece) throw new Error("No piece on source square");
  if (pieceSeat(piece) !== seat) throw new Error("Source piece does not belong to player");
  const legal = getLegalMoves(state, seat);
  const matched = legal.find((candidate) =>
    candidate.from.x === from.x
    && candidate.from.y === from.y
    && candidate.to.x === to.x
    && candidate.to.y === to.y,
  );
  if (!matched) throw new Error("Illegal move");
  return matched;
}

function boardHash(board: XiangqiBoard): string {
  return board.map((row) => row.map((cell) => cell || ".").join(",")).join("/");
}

function materialScore(board: XiangqiBoard, seat: Seat): number {
  let total = 0;
  for (const row of board) {
    for (const piece of row) {
      if (!piece || pieceSeat(piece) !== seat) continue;
      total += PIECE_VALUE[pieceKind(piece)];
    }
  }
  return total;
}

export const xiangqiEngine: GameEngine = {
  gameType: "xiangqi",
  rules: { board: "9x10", notation: "a0-i9", objective: "checkmate", first: "black" },
  actionSchema: { type: "move", payload: { from: "string", to: "string" } },

  initState(): MatchState {
    const state: XiangqiState = {
      gameType: "xiangqi",
      board: createInitialBoard(),
      nextTurn: "black",
      status: "waiting",
      moveCount: 0,
    };
    return state;
  },

  validateMove(state, seat, move): void {
    const xiangqiState = state as XiangqiState;
    if (xiangqiState.status !== "playing") throw new Error("Match is not in playing status");
    if (xiangqiState.nextTurn !== seat) throw new Error("Not your turn");
    getRequestedMove(xiangqiState, seat, move as XiangqiMoveInput);
  },

  applyMove(state, seat, move): MatchState {
    const xiangqiState = state as XiangqiState;
    const legalMove = getRequestedMove(xiangqiState, seat, move as XiangqiMoveInput);
    const next = applyMoveOnState(xiangqiState, legalMove);
    const opponent = otherSeat(seat);
    const opponentMoves = getLegalMoves(next, opponent);

    return {
      ...next,
      moveCount: xiangqiState.moveCount + 1,
      nextTurn: opponent,
      status: opponentMoves.length === 0 ? "finished" : "playing",
      winner: opponentMoves.length === 0 ? seat : undefined,
    };
  },

  chooseBotMove(state, seat) {
    const xiangqiState = state as XiangqiState;
    if (xiangqiState.status !== "playing" || xiangqiState.nextTurn !== seat) return null;
    const legal = getLegalMoves(xiangqiState, seat);
    if (!legal.length) return null;
    const enemy = otherSeat(seat);
    const ranked = legal
      .map((move) => {
        const next = applyMoveOnState(xiangqiState, move);
        const enemyMoves = getLegalMoves(next, enemy);
        const score =
          (move.capture ? PIECE_VALUE[pieceKind(move.capture)] * 20 : 0)
          + (enemyMoves.length === 0 ? 10000 : 0)
          + (isInCheck(next.board, enemy) ? 30 : 0)
          + materialScore(next.board, seat)
          - materialScore(next.board, enemy)
          - Math.abs(4 - move.to.x)
          - Math.abs(4.5 - move.to.y);
        return { move, score, hash: boardHash(next.board) };
      })
      .sort((a, b) => (b.score - a.score) || a.hash.localeCompare(b.hash));

    const best = ranked[0].move;
    return {
      from: toSquare(best.from),
      to: toSquare(best.to),
    };
  },

  snapshot(state) {
    const xiangqiState = state as XiangqiState;
    return {
      ...xiangqiState,
      width: WIDTH,
      height: HEIGHT,
      variant: "xiangqi",
    };
  },
};
