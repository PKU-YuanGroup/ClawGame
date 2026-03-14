import type { GameEngine, MatchState, Seat } from "./types.ts";

const SIZE = 8;
const FILES = "abcdefgh";
const RANKS = "87654321";
const PIECE_VALUE: Record<ChessKind, number> = {
  king: 1000,
  queen: 9,
  rook: 5,
  bishop: 3,
  knight: 3,
  pawn: 1,
};

type ChessKind = "king" | "queen" | "rook" | "bishop" | "knight" | "pawn";
type ChessPiece = `${Seat}_${ChessKind}`;
type ChessCell = ChessPiece | null;
type ChessBoard = ChessCell[][];

interface ChessMoveInput {
  from: string;
  to: string;
  promotion?: string;
}

interface ChessCoords {
  x: number;
  y: number;
}

interface ChessMove {
  from: ChessCoords;
  to: ChessCoords;
  piece: ChessPiece;
  capture?: ChessPiece;
  promotion?: ChessKind;
  enPassant?: boolean;
  castle?: "king" | "queen";
}

interface ChessState extends MatchState {
  board: ChessBoard;
  castling: Record<string, { kingSide: boolean; queenSide: boolean }>;
  enPassant?: string;
  lastMove?: { from: string; to: string; piece: ChessPiece; capture?: ChessPiece; promotion?: ChessKind };
}

function createInitialBoard(): ChessBoard {
  return [
    ["black_rook", "black_knight", "black_bishop", "black_queen", "black_king", "black_bishop", "black_knight", "black_rook"],
    Array.from({ length: SIZE }, () => "black_pawn" as ChessPiece),
    Array.from({ length: SIZE }, () => null),
    Array.from({ length: SIZE }, () => null),
    Array.from({ length: SIZE }, () => null),
    Array.from({ length: SIZE }, () => null),
    Array.from({ length: SIZE }, () => "white_pawn" as ChessPiece),
    ["white_rook", "white_knight", "white_bishop", "white_queen", "white_king", "white_bishop", "white_knight", "white_rook"],
  ];
}

function cloneBoard(board: ChessBoard): ChessBoard {
  return board.map((row) => [...row]);
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
}

function otherSeat(seat: Seat): Seat {
  return seat === "black" ? "white" : "black";
}

function pieceSeat(piece: ChessPiece | null): Seat | null {
  return piece ? (piece.split("_", 1)[0] as Seat) : null;
}

function pieceKind(piece: ChessPiece): ChessKind {
  return piece.split("_")[1] as ChessKind;
}

function toSquare({ x, y }: ChessCoords): string {
  return `${FILES[x]}${RANKS[y]}`;
}

function parseSquare(square: string): ChessCoords | null {
  const text = String(square || "").trim().toLowerCase();
  if (!/^[a-h][1-8]$/.test(text)) return null;
  const x = FILES.indexOf(text[0]);
  const y = RANKS.indexOf(text[1]);
  if (x < 0 || y < 0) return null;
  return { x, y };
}

function boardHash(board: ChessBoard): string {
  return board.map((row) => row.map((cell) => cell || ".").join(",")).join("/");
}

function isSquareAttacked(board: ChessBoard, target: ChessCoords, bySeat: Seat): boolean {
  const pawnDir = bySeat === "black" ? 1 : -1;
  for (const dx of [-1, 1]) {
    const x = target.x - dx;
    const y = target.y - pawnDir;
    if (!inBounds(x, y)) continue;
    if (board[y][x] === `${bySeat}_pawn`) return true;
  }

  const knightSteps = [
    [1, 2],
    [2, 1],
    [-1, 2],
    [-2, 1],
    [1, -2],
    [2, -1],
    [-1, -2],
    [-2, -1],
  ];
  for (const [dx, dy] of knightSteps) {
    const x = target.x + dx;
    const y = target.y + dy;
    if (!inBounds(x, y)) continue;
    if (board[y][x] === `${bySeat}_knight`) return true;
  }

  const kingSteps = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [dx, dy] of kingSteps) {
    const x = target.x + dx;
    const y = target.y + dy;
    if (!inBounds(x, y)) continue;
    if (board[y][x] === `${bySeat}_king`) return true;
  }

  const lineDirs: Array<[number, number, ChessKind[]]> = [
    [1, 0, ["rook", "queen"]],
    [-1, 0, ["rook", "queen"]],
    [0, 1, ["rook", "queen"]],
    [0, -1, ["rook", "queen"]],
    [1, 1, ["bishop", "queen"]],
    [1, -1, ["bishop", "queen"]],
    [-1, 1, ["bishop", "queen"]],
    [-1, -1, ["bishop", "queen"]],
  ];
  for (const [dx, dy, kinds] of lineDirs) {
    let x = target.x + dx;
    let y = target.y + dy;
    while (inBounds(x, y)) {
      const piece = board[y][x];
      if (!piece) {
        x += dx;
        y += dy;
        continue;
      }
      if (pieceSeat(piece) === bySeat && kinds.includes(pieceKind(piece))) return true;
      break;
    }
  }

  return false;
}

function findKing(board: ChessBoard, seat: Seat): ChessCoords | null {
  const target = `${seat}_king`;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[y][x] === target) return { x, y };
    }
  }
  return null;
}

function isInCheck(board: ChessBoard, seat: Seat): boolean {
  const king = findKing(board, seat);
  if (!king) return true;
  return isSquareAttacked(board, king, otherSeat(seat));
}

function applyMoveOnState(state: ChessState, move: ChessMove): ChessState {
  const board = cloneBoard(state.board);
  const castling: Record<string, { kingSide: boolean; queenSide: boolean }> = {
    black: { ...state.castling.black },
    white: { ...state.castling.white },
  };
  const piece = move.piece;
  const seat = pieceSeat(piece) as Seat;
  const enemy = otherSeat(seat);

  board[move.from.y][move.from.x] = null;

  if (move.enPassant) {
    const capturedY = move.to.y + (seat === "black" ? -1 : 1);
    board[capturedY][move.to.x] = null;
  }

  if (move.castle) {
    if (move.castle === "king") {
      const rookFromX = SIZE - 1;
      const rookToX = move.to.x - 1;
      const rook = board[move.from.y][rookFromX];
      board[move.from.y][rookFromX] = null;
      board[move.from.y][rookToX] = rook;
    } else {
      const rookFromX = 0;
      const rookToX = move.to.x + 1;
      const rook = board[move.from.y][rookFromX];
      board[move.from.y][rookFromX] = null;
      board[move.from.y][rookToX] = rook;
    }
  }

  const placedPiece = move.promotion ? (`${seat}_${move.promotion}` as ChessPiece) : piece;
  board[move.to.y][move.to.x] = placedPiece;

  if (pieceKind(piece) === "king") {
    castling[seat].kingSide = false;
    castling[seat].queenSide = false;
  }
  if (pieceKind(piece) === "rook") {
    if (move.from.x === 0) castling[seat].queenSide = false;
    if (move.from.x === SIZE - 1) castling[seat].kingSide = false;
  }
  if (move.capture && pieceKind(move.capture) === "rook") {
    if (move.to.x === 0) castling[enemy].queenSide = false;
    if (move.to.x === SIZE - 1) castling[enemy].kingSide = false;
  }

  let enPassant: string | undefined;
  if (pieceKind(piece) === "pawn" && Math.abs(move.to.y - move.from.y) === 2) {
    enPassant = toSquare({ x: move.from.x, y: (move.from.y + move.to.y) / 2 });
  }

  return {
    ...state,
    board,
    castling,
    enPassant,
    lastMove: {
      from: toSquare(move.from),
      to: toSquare(move.to),
      piece,
      capture: move.capture,
      promotion: move.promotion,
    },
  };
}

function addSlidingMoves(board: ChessBoard, from: ChessCoords, seat: Seat, dirs: Array<[number, number]>, moves: ChessMove[], piece: ChessPiece): void {
  for (const [dx, dy] of dirs) {
    let x = from.x + dx;
    let y = from.y + dy;
    while (inBounds(x, y)) {
      const target = board[y][x];
      if (!target) {
        moves.push({ from, to: { x, y }, piece });
      } else {
        if (pieceSeat(target) !== seat) {
          moves.push({ from, to: { x, y }, piece, capture: target });
        }
        break;
      }
      x += dx;
      y += dy;
    }
  }
}

function getPseudoMoves(state: ChessState, from: ChessCoords): ChessMove[] {
  const piece = state.board[from.y][from.x];
  if (!piece) return [];
  const seat = pieceSeat(piece) as Seat;
  const kind = pieceKind(piece);
  const moves: ChessMove[] = [];

  if (kind === "pawn") {
    const dir = seat === "black" ? 1 : -1;
    const startRow = seat === "black" ? 1 : 6;
    const promotionRow = seat === "black" ? 7 : 0;
    const oneY = from.y + dir;
    if (inBounds(from.x, oneY) && !state.board[oneY][from.x]) {
      if (oneY === promotionRow) {
        for (const promotion of ["queen", "rook", "bishop", "knight"] as ChessKind[]) {
          moves.push({ from, to: { x: from.x, y: oneY }, piece, promotion });
        }
      } else {
        moves.push({ from, to: { x: from.x, y: oneY }, piece });
      }
      const twoY = from.y + dir * 2;
      if (from.y === startRow && !state.board[twoY][from.x]) {
        moves.push({ from, to: { x: from.x, y: twoY }, piece });
      }
    }
    for (const dx of [-1, 1]) {
      const x = from.x + dx;
      const y = from.y + dir;
      if (!inBounds(x, y)) continue;
      const target = state.board[y][x];
      if (target && pieceSeat(target) !== seat) {
        if (y === promotionRow) {
          for (const promotion of ["queen", "rook", "bishop", "knight"] as ChessKind[]) {
            moves.push({ from, to: { x, y }, piece, capture: target, promotion });
          }
        } else {
          moves.push({ from, to: { x, y }, piece, capture: target });
        }
      }
      if (state.enPassant && state.enPassant === toSquare({ x, y })) {
        const captured = state.board[from.y][x];
        if (captured === `${otherSeat(seat)}_pawn`) {
          moves.push({ from, to: { x, y }, piece, capture: captured, enPassant: true });
        }
      }
    }
    return moves;
  }

  if (kind === "knight") {
    const steps = [
      [1, 2],
      [2, 1],
      [-1, 2],
      [-2, 1],
      [1, -2],
      [2, -1],
      [-1, -2],
      [-2, -1],
    ];
    for (const [dx, dy] of steps) {
      const x = from.x + dx;
      const y = from.y + dy;
      if (!inBounds(x, y)) continue;
      const target = state.board[y][x];
      if (!target || pieceSeat(target) !== seat) {
        moves.push({ from, to: { x, y }, piece, capture: target || undefined });
      }
    }
    return moves;
  }

  if (kind === "bishop") {
    addSlidingMoves(state.board, from, seat, [[1, 1], [1, -1], [-1, 1], [-1, -1]], moves, piece);
    return moves;
  }

  if (kind === "rook") {
    addSlidingMoves(state.board, from, seat, [[1, 0], [-1, 0], [0, 1], [0, -1]], moves, piece);
    return moves;
  }

  if (kind === "queen") {
    addSlidingMoves(state.board, from, seat, [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]], moves, piece);
    return moves;
  }

  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    const x = from.x + dx;
    const y = from.y + dy;
    if (!inBounds(x, y)) continue;
    const target = state.board[y][x];
    if (!target || pieceSeat(target) !== seat) {
      moves.push({ from, to: { x, y }, piece, capture: target || undefined });
    }
  }

  if (!isInCheck(state.board, seat)) {
    const row = seat === "black" ? 0 : 7;
    const enemy = otherSeat(seat);
    if (state.castling[seat].kingSide
      && from.y === row
      && from.x === 4
      && !state.board[row][5]
      && !state.board[row][6]
      && state.board[row][7] === `${seat}_rook`
      && !isSquareAttacked(state.board, { x: 5, y: row }, enemy)
      && !isSquareAttacked(state.board, { x: 6, y: row }, enemy)) {
      moves.push({ from, to: { x: 6, y: row }, piece, castle: "king" });
    }
    if (state.castling[seat].queenSide
      && from.y === row
      && from.x === 4
      && !state.board[row][3]
      && !state.board[row][2]
      && !state.board[row][1]
      && state.board[row][0] === `${seat}_rook`
      && !isSquareAttacked(state.board, { x: 3, y: row }, enemy)
      && !isSquareAttacked(state.board, { x: 2, y: row }, enemy)) {
      moves.push({ from, to: { x: 2, y: row }, piece, castle: "queen" });
    }
  }

  return moves;
}

function getLegalMoves(state: ChessState, seat: Seat): ChessMove[] {
  const moves: ChessMove[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const piece = state.board[y][x];
      if (!piece || pieceSeat(piece) !== seat) continue;
      for (const move of getPseudoMoves(state, { x, y })) {
        const next = applyMoveOnState(state, move);
        if (!isInCheck(next.board, seat)) moves.push(move);
      }
    }
  }
  return moves;
}

function getRequestedMove(state: ChessState, seat: Seat, move: ChessMoveInput): ChessMove {
  const from = parseSquare(move?.from || "");
  const to = parseSquare(move?.to || "");
  if (!from || !to) throw new Error("Invalid move squares");

  const piece = state.board[from.y][from.x];
  if (!piece) throw new Error("No piece on source square");
  if (pieceSeat(piece) !== seat) throw new Error("Source piece does not belong to player");

  const promotion = move?.promotion ? String(move.promotion).toLowerCase() as ChessKind : undefined;
  const legal = getLegalMoves(state, seat);
  const matched = legal.find((candidate) =>
    candidate.from.x === from.x
    && candidate.from.y === from.y
    && candidate.to.x === to.x
    && candidate.to.y === to.y
    && (candidate.promotion || undefined) === promotion,
  );
  if (!matched) throw new Error("Illegal move");
  return matched;
}

function materialScore(board: ChessBoard, seat: Seat): number {
  let total = 0;
  for (const row of board) {
    for (const piece of row) {
      if (!piece || pieceSeat(piece) !== seat) continue;
      total += PIECE_VALUE[pieceKind(piece)];
    }
  }
  return total;
}

export const chessEngine: GameEngine = {
  gameType: "chess",
  rules: { board: "8x8", notation: "a1-h8", objective: "checkmate", castling: true, enPassant: true, first: "black" },
  actionSchema: { type: "move", payload: { from: "string", to: "string", promotion: "string?" } },

  initState(): MatchState {
    const state: ChessState = {
      gameType: "chess",
      board: createInitialBoard(),
      nextTurn: "black",
      status: "waiting",
      moveCount: 0,
      castling: {
        black: { kingSide: true, queenSide: true },
        white: { kingSide: true, queenSide: true },
      },
    };
    return state;
  },

  validateMove(state, seat, move): void {
    const chessState = state as ChessState;
    if (chessState.status !== "playing") throw new Error("Match is not in playing status");
    if (chessState.nextTurn !== seat) throw new Error("Not your turn");
    getRequestedMove(chessState, seat, move as ChessMoveInput);
  },

  applyMove(state, seat, move): MatchState {
    const chessState = state as ChessState;
    const legalMove = getRequestedMove(chessState, seat, move as ChessMoveInput);
    const next = applyMoveOnState(chessState, legalMove);
    const opponent = otherSeat(seat);
    const opponentMoves = getLegalMoves(next, opponent);
    const opponentChecked = isInCheck(next.board, opponent);

    return {
      ...next,
      moveCount: chessState.moveCount + 1,
      nextTurn: opponent,
      status: opponentMoves.length === 0 ? "finished" : "playing",
      winner: opponentMoves.length === 0 ? (opponentChecked ? seat : "draw") : undefined,
    };
  },

  chooseBotMove(state, seat) {
    const chessState = state as ChessState;
    if (chessState.status !== "playing" || chessState.nextTurn !== seat) return null;
    const legal = getLegalMoves(chessState, seat);
    if (!legal.length) return null;

    const ranked = legal
      .map((move) => {
        const next = applyMoveOnState(chessState, move);
        const enemy = otherSeat(seat);
        const enemyMoves = getLegalMoves(next, enemy);
        const check = isInCheck(next.board, enemy);
        const score =
          (move.capture ? PIECE_VALUE[pieceKind(move.capture)] * 20 : 0)
          + (move.promotion ? PIECE_VALUE[move.promotion] * 10 : 0)
          + (enemyMoves.length === 0 ? 10000 : 0)
          + (check ? 30 : 0)
          + materialScore(next.board, seat)
          - materialScore(next.board, enemy)
          - Math.abs(3.5 - move.to.x)
          - Math.abs(3.5 - move.to.y);
        return { move, score, hash: boardHash(next.board) };
      })
      .sort((a, b) => (b.score - a.score) || a.hash.localeCompare(b.hash));

    const best = ranked[0].move;
    return {
      from: toSquare(best.from),
      to: toSquare(best.to),
      ...(best.promotion ? { promotion: best.promotion } : {}),
    };
  },

  snapshot(state) {
    const chessState = state as ChessState;
    return {
      ...chessState,
      size: SIZE,
      variant: "standard",
    };
  },
};
