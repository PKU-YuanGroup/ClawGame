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
  agentId?: string;
  credential?: string;
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

export interface AgentLoginRequest extends AgentJoinRequest {
  waitMs?: number;
}

export interface AgentPlayerSummary {
  id: string;
  seat: string | null;
  clawName?: string;
  credential?: string;
  name?: string;
  openclawName?: string | null;
}

export interface AgentLoginResponse {
  protocolVersion: ProtocolVersion;
  roomId: string;
  gameType?: string | null;
  seat?: string | null;
  playerToken?: string | null;
  status?: string;
  rules?: Record<string, unknown>;
  players?: {
    me: AgentPlayerSummary;
    opponent: AgentPlayerSummary | null;
  };
  ready: boolean;
  signal?: "exit";
  reason?: string;
}

export interface AgentPollRequest {
  roomId: string;
  credential?: string;
  agentId?: string;
  playerToken?: string;
  sinceTs?: number;
  sinceSeq?: number;
  waitMs?: number;
}

export interface AgentPollMessage {
  type: string;
  payload?: unknown;
  seat?: string | null;
  status?: string;
  nextTurn?: string | null;
  winner?: string;
  moveCount?: number;
  state?: unknown;
}

export interface AgentPollResponse {
  protocolVersion: ProtocolVersion;
  roomId: string;
  ts: number;
  seq: number;
  message: AgentPollMessage;
  rules?: Record<string, unknown>;
  supportedMessageTypes: string[];
  turn: {
    yourTurn: boolean;
    gameOver: boolean;
    haltForLlm: boolean;
    seat: string | null;
    nextTurn: string | null;
    status: string;
  };
  connection: {
    keepAlive: boolean;
    shouldDisconnect: boolean;
    reason: string;
  };
}

export interface AgentActRequest {
  roomId: string;
  credential?: string;
  playerToken?: string;
  move?: unknown;
  chatText?: string;
  senderId?: string;
  actionId?: string;
}

export interface AgentActResponse {
  protocolVersion: ProtocolVersion;
  roomId: string;
  actionId?: string;
  move?: unknown;
  chat?: unknown;
}

export interface AgentMessageRequest {
  roomId: string;
  senderId?: string;
  chatText: string;
  credential?: string;
}

export interface AgentExitRequest {
  roomId: string;
  playerToken?: string;
  waitMs?: number;
  credential?: string;
}

export interface AgentExitResponse {
  ok: boolean;
  next: "continue_poll" | "end_session";
  reason: string;
}

export type RoomActorType = "player" | "openclaw" | "system";
export type RoomCommandKind = "join" | "move" | "chat";

export interface RoomCommandRequest {
  protocolVersion: ProtocolVersion;
  roomId: string;
  actorType: RoomActorType;
  actorId?: string;
  playerToken?: string;
  actionId?: string;
  command: {
    kind: RoomCommandKind;
    inviteCode?: string;
    move?: unknown;
    text?: string;
  };
}

export interface RoomCommandResponse {
  protocolVersion: ProtocolVersion;
  roomId: string;
  ok: boolean;
  seq: number;
  actionId?: string;
  error?: string;
  state?: unknown;
  data?: unknown;
}

export type GameLocale = "en" | "zh";

export interface GameCatalogItem {
  key: string;
  name: { en: string; zh: string };
  cover?: string;
  rules: Record<string, unknown>;
  roomRules?: Record<string, unknown>;
  actionSchema?: Record<string, unknown>;
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
      moveProtocol: {
        command: "act",
        moveField: "move",
        format: { from: "a0-i9", to: "a0-i9" },
        example: { move: { from: "b0", to: "c2" } },
        notes: [
          "from/to must be algebraic board squares like a0, e2, i9",
          "call act only after poll returns yourturn",
          "submit exactly one legal move per turn",
        ],
      },
    },
    actionSchema: {
      type: "move",
      payload: {
        from: "string (a0-i9)",
        to: "string (a0-i9)",
      },
      example: { from: "b0", to: "c2" },
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
      moveProtocol: {
        command: "act",
        moveField: "move",
        format: { from: "a1-h8", to: "a1-h8", promotion: "queen|rook|bishop|knight(optional)" },
        example: { move: { from: "e2", to: "e4" } },
        notes: [
          "from/to must be algebraic squares like a1, e4, h8",
          "promotion is required only when a pawn reaches the last rank",
          "call act only after poll returns yourturn",
          "submit exactly one legal move per turn",
        ],
      },
    },
    actionSchema: {
      type: "move",
      payload: {
        from: "string (a1-h8)",
        to: "string (a1-h8)",
        promotion: "string? (queen|rook|bishop|knight)",
      },
      example: { from: "e2", to: "e4" },
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
  who_is_undercover: {
    key: "who_is_undercover",
    name: { en: "Who Is Undercover", zh: "谁是卧底" },
    rules: {
      objective: "identify_hidden_word_holders",
      phases: ["clue", "vote", "finished"],
      recommendedEvents: ["phase_change", "private_info", "yourturn", "vote_request", "gameover"],
    },
  },
  guandan: {
    key: "guandan",
    name: { en: "Guandan", zh: "掼蛋" },
    rules: {
      objective: "teammate_pair_finishes_first",
      seats: ["north", "east", "south", "west"],
      deck: "double_54_with_jokers",
      phases: ["trick_play", "finished"],
      recommendedEvents: ["yourturn", "action_result", "state_update", "gameover"],
    },
  },
  uno: {
    key: "uno",
    name: { en: "UNO", zh: "UNO" },
    rules: {
      objective: "discard_all_cards",
      seats: ["north", "east", "south", "west"],
      phases: ["playing", "finished"],
      drawStacking: false,
      manualStartByOwner: true,
      recommendedEvents: ["yourturn", "state_update", "action_result", "gameover"],
    },
    roomRules: {
      seats: ["north", "east", "south", "west"],
      minPlayers: 2,
      maxPlayers: 4,
      first: "north",
    },
    actionSchema: {
      type: "action",
      payload: {
        action: "play|draw",
        card: "string?",
        color: "R|Y|G|B?",
      },
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
  if (item) {
    if (item.actionSchema) return { ...item.rules, actionSchema: item.actionSchema };
    return item.rules;
  }
  return {
    objective: "follow_room_rules",
    phases: ["waiting", "playing", "finished"],
    recommendedEvents: fallbackEvents,
  };
}

export function getGameRoomRules(gameType: string): Record<string, unknown> {
  const key = String(gameType || "").trim();
  const item = GAME_CATALOG[key];
  if (item?.roomRules) return item.roomRules;
  return {};
}

export function getGameActionSchema(gameType: string): Record<string, unknown> {
  const key = String(gameType || "").trim();
  const item = GAME_CATALOG[key];
  if (item?.actionSchema) return item.actionSchema;
  return { type: "move", payload: {} };
}

export function listConfiguredGames(): string[] {
  return Object.keys(GAME_CATALOG);
}
