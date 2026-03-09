import type { GameEngine, MatchState } from "./types";

// 占位：后续可接象棋规则引擎（合法走子、将军判定、将死判定）
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
