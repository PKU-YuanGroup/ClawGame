export type ProtocolVersion = "v1";

export interface ProtocolEnvelope<T = unknown> {
  type: string;
  roomId: string;
  gameType: string;
  protocolVersion: ProtocolVersion;
  seq: number;
  ts: number;
  payload: T;
}

export interface AgentJoinRequest {
  roomId: string;
  agentId: string;
  inviteCode?: string;
}

export interface AgentJoinResponse {
  protocolVersion: ProtocolVersion;
  roomId: string;
  agentId: string;
  playerId: string;
  seat: string;
  playerToken: string;
}

export interface AgentPollRequest {
  roomId: string;
  sinceTs?: number;
  sinceSeq?: number;
}

export interface AgentActRequest {
  roomId: string;
  playerToken?: string;
  move?: unknown;
  chatText?: string;
  senderId?: string;
  actionId?: string;
}

export type GameLocale = "en" | "zh";

export interface GameCatalogItem {
  key: string;
  name: { en: string; zh: string };
  cover?: string;
  rules: Record<string, unknown>;
}

export const GAME_CATALOG: Record<string, GameCatalogItem> = {
  gomoku: {
    key: "gomoku",
    name: { en: "Gomoku", zh: "五子棋" },
    cover: "/gomoku-cover.jpg",
    rules: {
      objective: "five_in_a_row",
      boardSize: 15,
      turnOrder: ["black", "white"],
      phases: ["playing", "finished"],
      recommendedEvents: ["yourturn", "state_update", "gameover"],
    },
  },
  go: {
    key: "go",
    name: { en: "Go", zh: "围棋" },
    rules: {
      objective: "territory",
      boardSize: 19,
      phases: ["playing", "finished"],
      recommendedEvents: ["yourturn", "state_update", "gameover"],
    },
  },
  xiangqi: {
    key: "xiangqi",
    name: { en: "Xiangqi", zh: "象棋" },
    rules: {
      objective: "checkmate",
      board: "9x10",
      phases: ["playing", "finished"],
      recommendedEvents: ["yourturn", "state_update", "gameover"],
    },
  },
  chess: {
    key: "chess",
    name: { en: "Chess", zh: "国际象棋" },
    rules: {
      objective: "checkmate",
      board: "8x8",
      phases: ["playing", "finished"],
      recommendedEvents: ["yourturn", "state_update", "gameover"],
    },
  },
  werewolf: {
    key: "werewolf",
    name: { en: "Werewolf", zh: "狼人杀" },
    rules: {
      objective: "eliminate_opponents",
      phases: ["night", "day_discussion", "vote", "resolution", "finished"],
      recommendedEvents: ["phase_change", "private_info", "vote_request", "chat", "gameover"],
    },
  },
  texas_holdem: {
    key: "texas_holdem",
    name: { en: "Texas Hold'em", zh: "德州扑克" },
    rules: {
      objective: "maximize_chip_ev",
      phases: ["preflop", "flop", "turn", "river", "showdown", "finished"],
      recommendedEvents: ["phase_change", "private_info", "betting_round", "action_result", "showdown", "gameover"],
    },
  },
  junqi: {
    key: "junqi",
    name: { en: "Junqi", zh: "军棋" },
    rules: {
      objective: "capture_flag",
      phases: ["deploy", "march", "battle_resolution", "finished"],
      recommendedEvents: ["phase_change", "private_info", "yourturn", "action_result", "gameover"],
    },
  },
};

function humanizeGameType(gameType: string): string {
  return gameType
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
    .join(" ");
}

export function getGameLabel(gameType: string, locale: GameLocale = "en"): string {
  const key = String(gameType || "").trim();
  const item = GAME_CATALOG[key];
  if (!item) return humanizeGameType(key || "Game");
  return item.name[locale] || item.name.en;
}

export function getGameCover(gameType: string): string {
  const key = String(gameType || "").trim();
  const item = GAME_CATALOG[key];
  if (item?.cover) return item.cover;
  return `https://placehold.co/600x320/0f1a33/aec2ff?text=${encodeURIComponent(key || "game")}`;
}

export function getGameRules(gameType: string, fallbackEvents: readonly string[] = []): Record<string, unknown> {
  const key = String(gameType || "").trim();
  const item = GAME_CATALOG[key];
  if (item) return item.rules;
  return {
    objective: "follow_room_rules",
    phases: ["waiting", "playing", "finished"],
    recommendedEvents: fallbackEvents,
  };
}

export function listConfiguredGames(): string[] {
  return Object.keys(GAME_CATALOG);
}
