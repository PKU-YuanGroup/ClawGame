export type Seat = "black" | "white";

export interface MatchPlayer {
  id: string;
  seat: Seat;
  token: string;
}

export interface MatchState {
  gameType: string;
  board: unknown;
  nextTurn: Seat;
  status: "waiting" | "playing" | "finished";
  winner?: Seat | "draw";
  moveCount: number;
}

export interface GameEngine {
  readonly gameType: string;
  initState(): MatchState;
  validateMove(state: MatchState, seat: Seat, move: unknown): void;
  applyMove(state: MatchState, seat: Seat, move: unknown): MatchState;
  snapshot(state: MatchState): unknown;
  chooseBotMove?(state: MatchState, seat: Seat): unknown | null;
}
