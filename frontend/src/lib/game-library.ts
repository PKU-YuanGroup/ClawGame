import type { Lang } from "@/lib/i18n";
import {
  getGameCover as protocolGetGameCover,
  getGameLabel as protocolGetGameLabel,
  listConfiguredGames as protocolListConfiguredGames,
} from "@openclaw/game-protocol";

export type GameTheme = {
  cardBackground: string;
  roomBackground: string;
  accent: string;
  ink: string;
  atmosphere: string;
};

function svgCover(title: string, subtitle: string, colors: [string, string, string], motif: string): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 640">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${colors[0]}"/>
          <stop offset="55%" stop-color="${colors[1]}"/>
          <stop offset="100%" stop-color="${colors[2]}"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="640" fill="url(#g)"/>
      <circle cx="980" cy="110" r="180" fill="rgba(255,255,255,0.08)"/>
      <circle cx="180" cy="520" r="240" fill="rgba(255,255,255,0.08)"/>
      <text x="88" y="148" fill="rgba(255,255,255,0.7)" font-size="28" font-family="Georgia, serif" letter-spacing="8">${subtitle}</text>
      <text x="84" y="330" fill="#fff8ef" font-size="96" font-weight="700" font-family="'Trebuchet MS', Arial, sans-serif">${title}</text>
      <text x="86" y="500" fill="rgba(255,248,239,0.82)" font-size="220" font-family="Georgia, serif">${motif}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function getGameLabel(gameType: string, lang: Lang): string {
  return protocolGetGameLabel(gameType, lang);
}

export function getGameCover(gameType: string): string {
  if (gameType === "texas_holdem") return svgCover("Texas Hold'em", "HIGH STAKES", ["#07111d", "#0f5132", "#d4af37"], "A♠");
  if (gameType === "werewolf") return svgCover("Werewolf", "FULL MOON", ["#0b1021", "#2b1848", "#7088c8"], "☾");
  if (gameType === "junqi") return svgCover("Junqi", "TACTICAL FRONT", ["#23150e", "#4b2e16", "#a56a2d"], "♜");
  if (gameType === "who_is_undercover") return svgCover("Undercover", "HIDDEN WORD", ["#1d0d33", "#9d174d", "#f97316"], "◈");
  if (gameType === "guandan") return svgCover("Guandan", "DOUBLE DECK", ["#271008", "#7a2d10", "#e2a647"], "🂡");
  return protocolGetGameCover(gameType);
}

export function listConfiguredGames(): string[] {
  return protocolListConfiguredGames();
}

export function getGameTheme(gameType: string): GameTheme {
  if (gameType === "texas_holdem") {
    return {
      cardBackground: "linear-gradient(145deg, #06131a 0%, #0f3d2e 55%, #d4a93a 100%)",
      roomBackground: "radial-gradient(circle at top right, rgba(212,169,58,0.2), transparent 34%), linear-gradient(180deg, #041016 0%, #09261f 48%, #041016 100%)",
      accent: "#d4a93a",
      ink: "#f6f1dd",
      atmosphere: "Velvet casino lighting, polished felt, high-stakes tension",
    };
  }
  if (gameType === "werewolf") {
    return {
      cardBackground: "linear-gradient(135deg, #070b18 0%, #1c1034 48%, #5367b7 100%)",
      roomBackground: "radial-gradient(circle at 20% 20%, rgba(150,170,255,0.22), transparent 24%), linear-gradient(180deg, #050812 0%, #12162b 60%, #050812 100%)",
      accent: "#9cb0ff",
      ink: "#edf1ff",
      atmosphere: "Moonlit fog, silver edges, tense village paranoia",
    };
  }
  if (gameType === "junqi") {
    return {
      cardBackground: "linear-gradient(135deg, #1d140d 0%, #5c3718 52%, #ba8a47 100%)",
      roomBackground: "radial-gradient(circle at 80% 10%, rgba(255,203,113,0.15), transparent 20%), linear-gradient(180deg, #140f0b 0%, #2b1d12 50%, #140f0b 100%)",
      accent: "#d9a55a",
      ink: "#fff1d5",
      atmosphere: "Command bunker warmth, brass markers, campaign map mood",
    };
  }
  if (gameType === "who_is_undercover") {
    return {
      cardBackground: "linear-gradient(135deg, #1d0a2f 0%, #b31e69 52%, #ff8b2c 100%)",
      roomBackground: "radial-gradient(circle at 10% 10%, rgba(255,135,59,0.18), transparent 20%), linear-gradient(180deg, #160921 0%, #2a0f36 48%, #14071f 100%)",
      accent: "#ff8b2c",
      ink: "#fff1f6",
      atmosphere: "Late-night party energy, neon glow, suspicious smiles",
    };
  }
  if (gameType === "chess") {
    return {
      cardBackground: "linear-gradient(135deg, #22140f 0%, #7a5432 52%, #ead3af 100%)",
      roomBackground: "linear-gradient(180deg, #1c120f 0%, #3a261a 52%, #22140f 100%)",
      accent: "#e4bf88",
      ink: "#fff2db",
      atmosphere: "Classic woodgrain, tournament calm, focused elegance",
    };
  }
  if (gameType === "xiangqi") {
    return {
      cardBackground: "linear-gradient(135deg, #3a150f 0%, #8d2b22 52%, #d6a461 100%)",
      roomBackground: "linear-gradient(180deg, #2b0d0b 0%, #5f1e14 50%, #2b0d0b 100%)",
      accent: "#efb35d",
      ink: "#fff0d0",
      atmosphere: "Lacquer red, carved wood, ceremonial table presence",
    };
  }
  if (gameType === "go") {
    return {
      cardBackground: "linear-gradient(135deg, #352311 0%, #c08d4c 60%, #f0d6a8 100%)",
      roomBackground: "linear-gradient(180deg, #26170b 0%, #5a3b1d 52%, #26170b 100%)",
      accent: "#f0d6a8",
      ink: "#fff6e7",
      atmosphere: "Quiet cedar board, meditative space, strategic stillness",
    };
  }
  if (gameType === "guandan") {
    return {
      cardBackground: "linear-gradient(135deg, #2a1309 0%, #8d3718 52%, #f0b85c 100%)",
      roomBackground: "linear-gradient(180deg, #1c0d07 0%, #4a1f10 52%, #1c0d07 100%)",
      accent: "#f0b85c",
      ink: "#fff2de",
      atmosphere: "Heated card table, partner tempo, explosive bombs",
    };
  }
  return {
    cardBackground: "linear-gradient(135deg, #111827 0%, #334155 55%, #94a3b8 100%)",
    roomBackground: "linear-gradient(180deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)",
    accent: "#fb923c",
    ink: "#f8fafc",
    atmosphere: "Competitive arena",
  };
}
