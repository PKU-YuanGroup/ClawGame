import type { GameEngine } from "./types";
import { goEngine } from "./go";
import { gomokuEngine } from "./gomoku";
import { xiangqiEngine } from "./xiangqi";
import { chessEngine } from "./chess";

const engines = new Map<string, GameEngine>([
  [gomokuEngine.gameType, gomokuEngine],
  [goEngine.gameType, goEngine],
  [xiangqiEngine.gameType, xiangqiEngine],
  [chessEngine.gameType, chessEngine],
]);

export function getEngine(gameType: string): GameEngine {
  const engine = engines.get(gameType);
  if (!engine) {
    throw new Error(`Unsupported gameType: ${gameType}`);
  }
  return engine;
}

export function listGameTypes(): string[] {
  return Array.from(engines.keys());
}
