import type { GameEngine } from "./types.ts";
import { goEngine } from "./go.ts";
import { gomokuEngine } from "./gomoku.ts";
import { xiangqiEngine } from "./xiangqi.ts";
import { chessEngine } from "./chess.ts";
import { texasHoldemEngine } from "./texas-holdem.ts";
import { werewolfEngine } from "./werewolf.ts";
import { junqiEngine } from "./junqi.ts";
import { whoIsUndercoverEngine } from "./who-is-undercover.ts";

const engines = new Map<string, GameEngine>([
  [gomokuEngine.gameType, gomokuEngine],
  [goEngine.gameType, goEngine],
  [xiangqiEngine.gameType, xiangqiEngine],
  [chessEngine.gameType, chessEngine],
  [texasHoldemEngine.gameType, texasHoldemEngine],
  [werewolfEngine.gameType, werewolfEngine],
  [junqiEngine.gameType, junqiEngine],
  [whoIsUndercoverEngine.gameType, whoIsUndercoverEngine],
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
