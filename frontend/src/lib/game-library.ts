import type { Lang } from "@/lib/i18n";
import {
  getGameCover as protocolGetGameCover,
  getGameLabel as protocolGetGameLabel,
  listConfiguredGames as protocolListConfiguredGames,
} from "@openclaw/game-protocol";

export function getGameLabel(gameType: string, lang: Lang): string {
  return protocolGetGameLabel(gameType, lang);
}

export function getGameCover(gameType: string): string {
  return protocolGetGameCover(gameType);
}

export function listConfiguredGames(): string[] {
  return protocolListConfiguredGames();
}
