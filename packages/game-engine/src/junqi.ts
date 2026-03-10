import type { GameEngine, MatchState, Seat } from "./types.ts";

const WIDTH = 5;
const HEIGHT = 6;
const JUNQI_SEATS = ["red", "blue"] as const;
const RANK_ORDER = ["flag", "mine", "engineer", "lieutenant", "captain", "major", "colonel", "general", "marshal", "bomb"] as const;

type Rank = typeof RANK_ORDER[number];
type Piece = `${Seat}_${Rank}`;
type Cell = Piece | null;

interface JunqiState extends MatchState {
  board: Cell[][];
  lastMove?: { from: string; to: string; capture?: Piece };
}

interface JunqiMove {
  from: string;
  to: string;
}

function emptyBoard(): Cell[][] {
  return Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => null));
}

function parseCoord(value: string): { x: number; y: number } | null {
  const text = String(value || "").trim().toLowerCase();
  if (!/^[a-e][0-5]$/.test(text)) return null;
  return { x: text.charCodeAt(0) - 97, y: Number(text[1]) };
}

function toCoord(x: number, y: number): string {
  return `${String.fromCharCode(97 + x)}${y}`;
}

function initialBoard(): Cell[][] {
  const board = emptyBoard();
  board[0] = ["red_marshal", "red_general", "red_colonel", "red_bomb", "red_flag"];
  board[1] = ["red_major", "red_captain", "red_lieutenant", "red_engineer", "red_mine"];
  board[4] = ["blue_major", "blue_captain", "blue_lieutenant", "blue_engineer", "blue_mine"];
  board[5] = ["blue_marshal", "blue_general", "blue_colonel", "blue_bomb", "blue_flag"];
  return board;
}

function seatOf(piece: Piece | null): Seat | null {
  return piece ? (piece.split("_", 1)[0] as Seat) : null;
}

function rankOf(piece: Piece): Rank {
  return piece.split("_")[1] as Rank;
}

function rankScore(rank: Rank): number {
  return RANK_ORDER.indexOf(rank);
}

function clone(board: Cell[][]): Cell[][] {
  return board.map((row) => [...row]);
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
}

function otherSeat(seat: Seat): Seat {
  return seat === "red" ? "blue" : "red";
}

function resolveBattle(attacker: Piece, defender: Piece): "attacker" | "defender" | "both" {
  const a = rankOf(attacker);
  const d = rankOf(defender);
  if (d === "flag") return "attacker";
  if (d === "mine") return a === "engineer" ? "attacker" : "defender";
  if (a === "bomb" || d === "bomb") return "both";
  const aScore = rankScore(a);
  const dScore = rankScore(d);
  if (aScore > dScore) return "attacker";
  if (aScore < dScore) return "defender";
  return "both";
}

export const junqiEngine: GameEngine = {
  gameType: "junqi",
  seats: JUNQI_SEATS,
  minPlayers: 2,
  maxPlayers: 2,

  initState(): MatchState {
    return {
      gameType: "junqi",
      board: initialBoard(),
      nextTurn: "red",
      status: "waiting",
      moveCount: 0,
    } as JunqiState;
  },

  validateMove(state, seat, move): void {
    const s = state as JunqiState;
    if (s.status !== "playing") throw new Error("Match is not in playing status");
    if (s.nextTurn !== seat) throw new Error("Not your turn");
    const from = parseCoord((move as JunqiMove)?.from || "");
    const to = parseCoord((move as JunqiMove)?.to || "");
    if (!from || !to) throw new Error("Invalid coordinates");
    const piece = s.board[from.y][from.x];
    if (!piece || seatOf(piece) !== seat) throw new Error("Invalid source piece");
    if (["flag", "mine"].includes(rankOf(piece))) throw new Error("Piece cannot move");
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    if (dx + dy !== 1) throw new Error("Only adjacent orthogonal moves are allowed");
    const target = s.board[to.y][to.x];
    if (target && seatOf(target) === seat) throw new Error("Cannot capture your own piece");
  },

  applyMove(state, seat, move): MatchState {
    const s = {
      ...(state as JunqiState),
      board: clone((state as JunqiState).board),
    } as JunqiState;
    const from = parseCoord((move as JunqiMove).from) as { x: number; y: number };
    const to = parseCoord((move as JunqiMove).to) as { x: number; y: number };
    const piece = s.board[from.y][from.x] as Piece;
    const target = s.board[to.y][to.x] as Piece | null;
    s.board[from.y][from.x] = null;
    let winner: Seat | "draw" | undefined;

    if (!target) {
      s.board[to.y][to.x] = piece;
    } else {
      const outcome = resolveBattle(piece, target);
      if (outcome === "attacker") s.board[to.y][to.x] = piece;
      if (outcome === "defender") s.board[to.y][to.x] = target;
      if (outcome === "both") s.board[to.y][to.x] = null;
      if (rankOf(target) === "flag" && outcome === "attacker") winner = seat;
    }

    if (!winner) {
      const enemy = otherSeat(seat);
      const enemyFlagAlive = s.board.some((row) => row.some((cell) => cell === `${enemy}_flag`));
      if (!enemyFlagAlive) winner = seat;
    }

    s.moveCount += 1;
    s.nextTurn = otherSeat(seat);
    s.lastMove = { from: toCoord(from.x, from.y), to: toCoord(to.x, to.y), capture: target || undefined };
    if (winner) {
      s.status = "finished";
      s.winner = winner;
    }
    return s;
  },

  chooseBotMove(state, seat) {
    const s = state as JunqiState;
    if (s.status !== "playing" || s.nextTurn !== seat) return null;
    const moves: Array<{ from: string; to: string; score: number }> = [];
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const piece = s.board[y][x];
        if (!piece || seatOf(piece) !== seat) continue;
        const rank = rankOf(piece);
        if (rank === "flag" || rank === "mine") continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(nx, ny)) continue;
          const target = s.board[ny][nx];
          if (target && seatOf(target) === seat) continue;
          let score = 1;
          if (target) score += 20 + rankScore(rankOf(target));
          if (target && rankOf(target) === "flag") score += 1000;
          score -= Math.abs((seat === "red" ? HEIGHT - 1 : 0) - ny);
          moves.push({ from: toCoord(x, y), to: toCoord(nx, ny), score });
        }
      }
    }
    moves.sort((a, b) => b.score - a.score);
    return moves[0] ? { from: moves[0].from, to: moves[0].to } : null;
  },

  snapshot(state) {
    const s = state as JunqiState;
    return {
      ...s,
      width: WIDTH,
      height: HEIGHT,
      theme: "war-room",
    };
  },
};
