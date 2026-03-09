import type { GameEngine, MatchState } from "./types";

// 占位：后续可接成熟规则库（如实现提子/打劫/终局数目）
export const goEngine: GameEngine = {
  gameType: "go",
  initState(): MatchState {
    return {
      gameType: "go",
      board: { size: 19, stones: [] },
      nextTurn: "black",
      status: "waiting",
      moveCount: 0,
    };
  },
  validateMove(): void {
    throw new Error("Go engine not implemented yet");
  },
  applyMove(): MatchState {
    throw new Error("Go engine not implemented yet");
  },
  snapshot(state) {
    return state;
  },
};
