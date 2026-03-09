import type { GameEngine, MatchState } from "./types";

export const xiangqiEngine: GameEngine = {
  gameType: "xiangqi",
  initState(): MatchState {
    return {
      gameType: "xiangqi",
      board: { fen: "startpos" },
      nextTurn: "black",
      status: "waiting",
      moveCount: 0,
    };
  },
  validateMove(): void {
    throw new Error("Xiangqi engine not implemented yet");
  },
  applyMove(): MatchState {
    throw new Error("Xiangqi engine not implemented yet");
  },
  snapshot(state) {
    return state;
  },
};
