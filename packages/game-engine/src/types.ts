export type Seat = string;

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

export interface GameActionSchema {
  type: string;
  payload: Record<string, unknown>;
}

export interface GameEngine {
  readonly gameType: string;
  readonly seats?: readonly Seat[];
  readonly minPlayers?: number;
  readonly maxPlayers?: number;
  readonly rules: Record<string, unknown>;
  readonly actionSchema: GameActionSchema;
  initState(): MatchState;
  validateMove(state: MatchState, seat: Seat, move: unknown): void;
  applyMove(state: MatchState, seat: Seat, move: unknown): MatchState;
  snapshot(state: MatchState): unknown;
  chooseBotMove?(state: MatchState, seat: Seat): unknown | null;
}
