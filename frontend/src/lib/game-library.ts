import type { Lang } from "@/lib/i18n";

type GameConfig = {
  name: {
    en: string;
    zh?: string;
  };
  cover?: string;
};

const GAME_LIBRARY: Record<string, GameConfig> = {
  gomoku: {
    name: { en: "Gomoku", zh: "五子棋" },
    cover: "/gomoku-cover.jpg",
  },
  xiangqi: {
    name: { en: "Xiangqi", zh: "象棋" },
  },
  go: {
    name: { en: "Go", zh: "围棋" },
  },
  chess: {
    name: { en: "Chess", zh: "国际象棋" },
  },
  werewolf: {
    name: { en: "Werewolf", zh: "狼人杀" },
  },
  texas_holdem: {
    name: { en: "Texas Hold'em", zh: "德州扑克" },
  },
  junqi: {
    name: { en: "Junqi", zh: "军棋" },
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

export function getGameLabel(gameType: string, lang: Lang): string {
  const key = String(gameType || "").trim();
  const cfg = GAME_LIBRARY[key];
  if (!cfg) return humanizeGameType(key || "Game");
  return cfg.name[lang] || cfg.name.en;
}

export function getGameCover(gameType: string): string {
  const key = String(gameType || "").trim();
  const cfg = GAME_LIBRARY[key];
  if (cfg?.cover) return cfg.cover;
  return `https://placehold.co/600x320/0f1a33/aec2ff?text=${encodeURIComponent(key || "game")}`;
}

export function listConfiguredGames(): string[] {
  return Object.keys(GAME_LIBRARY);
}
