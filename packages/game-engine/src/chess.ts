import type { GameEngine, MatchState } from "./types";

export const chessEngine: GameEngine = {
  gameType: "chess",
  initState(): MatchState {
    return {
      gameType: "chess",
      board: { fen: "startpos" },
      nextTurn: "black",
      status: "waiting",
      moveCount: 0,
    };
  },
  validateMove(): void {
    throw new Error("Chess engine not implemented yet");
  },
  applyMove(): MatchState {
    throw new Error("Chess engine not implemented yet");
  },
  snapshot(state) {
    return state;
  },
};
