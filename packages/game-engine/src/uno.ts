import type { GameEngine, MatchState, Seat } from "./types.ts";

const UNO_SEATS: readonly Seat[] = ["north", "east", "south", "west"] as const;
const UNO_COLORS = ["R", "Y", "G", "B"] as const;
type UnoColor = (typeof UNO_COLORS)[number];
type TurnDirection = 1 | -1;

interface UnoMove {
  action: "play" | "draw";
  card?: string;
  color?: UnoColor;
}

interface UnoState extends MatchState {
  board: {
    activeSeats: Seat[];
    direction: TurnDirection;
    hands: Record<Seat, string[]>;
    handCounts: Record<Seat, number>;
    drawPile: string[];
    discardPile: string[];
    currentColor: UnoColor;
    pendingDraw: number;
    lastAction?: {
      seat: Seat;
      action: "play" | "draw";
      card?: string;
      color?: UnoColor;
      drawCount?: number;
    };
  };
}

function emptyHands(): Record<Seat, string[]> {
  return { north: [], east: [], south: [], west: [] };
}

function deterministicShuffle(seed: string, cards: string[]): string[] {
  const deck = [...cards];
  let acc = 2166136261;
  for (const ch of seed) {
    acc ^= ch.charCodeAt(0);
    acc = Math.imul(acc, 16777619);
  }
  for (let i = deck.length - 1; i > 0; i--) {
    acc = Math.imul(acc ^ (i + 19), 1103515245) + 12345;
    const j = Math.abs(acc) % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function normalizeSeats(input: Seat[]): Seat[] {
  const unique = Array.from(new Set(input.filter(Boolean)));
  return UNO_SEATS.filter((seat) => unique.includes(seat));
}

function createUnoDeck(): string[] {
  const deck: string[] = [];
  for (const color of UNO_COLORS) {
    deck.push(`${color}0`);
    for (let i = 1; i <= 9; i++) {
      deck.push(`${color}${i}`);
      deck.push(`${color}${i}`);
    }
    for (let i = 0; i < 2; i++) {
      deck.push(`${color}S`);
      deck.push(`${color}R`);
      deck.push(`${color}D2`);
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push("W");
    deck.push("W4");
  }
  return deck;
}

function cardColor(card: string): UnoColor | null {
  const c = String(card || "");
  return (UNO_COLORS as readonly string[]).includes(c[0]) ? (c[0] as UnoColor) : null;
}

function cardRank(card: string): string {
  const c = String(card || "");
  if (c === "W" || c === "W4") return c;
  return c.slice(1);
}

function isWild(card: string): boolean {
  return card === "W" || card === "W4";
}

function isCardPlayable(card: string, topCard: string, currentColor: UnoColor): boolean {
  if (isWild(card)) return true;
  const c = cardColor(card);
  if (c === currentColor) return true;
  return cardRank(card) === cardRank(topCard);
}

function dominantColor(cards: string[], fallback: UnoColor = "R"): UnoColor {
  const counts: Record<UnoColor, number> = { R: 0, Y: 0, G: 0, B: 0 };
  for (const card of cards) {
    const color = cardColor(card);
    if (!color) continue;
    counts[color] += 1;
  }
  let best = fallback;
  for (const color of UNO_COLORS) {
    if (counts[color] > counts[best]) best = color;
  }
  return best;
}

function advanceSeat(state: UnoState, from: Seat, steps = 1, direction = state.board.direction): Seat {
  const active = state.board.activeSeats;
  if (!active.length) return from;
  const baseIndex = active.indexOf(from);
  const start = baseIndex >= 0 ? baseIndex : 0;
  const offset = ((direction * steps) % active.length + active.length) % active.length;
  return active[(start + offset) % active.length];
}

function drawCards(state: UnoState, seat: Seat, count: number): number {
  let drawn = 0;
  while (drawn < count) {
    if (state.board.drawPile.length === 0) {
      if (state.board.discardPile.length <= 1) break;
      const top = state.board.discardPile[state.board.discardPile.length - 1];
      const rest = state.board.discardPile.slice(0, -1);
      state.board.drawPile = deterministicShuffle(`uno-refill:${state.moveCount}:${rest.join(",")}`, rest);
      state.board.discardPile = [top];
    }
    const next = state.board.drawPile.shift();
    if (!next) break;
    state.board.hands[seat].push(next);
    drawn += 1;
  }
  return drawn;
}

function asUnoState(state: MatchState): UnoState {
  return state as UnoState;
}

function buildWaitingState(): UnoState {
  return {
    gameType: "uno",
    board: {
      activeSeats: [],
      direction: 1,
      hands: emptyHands(),
      handCounts: { north: 0, east: 0, south: 0, west: 0 },
      drawPile: [],
      discardPile: [],
      currentColor: "R",
      pendingDraw: 0,
    },
    nextTurn: "north",
    status: "waiting",
    moveCount: 0,
  };
}

export function initUnoMatchState(seats: Seat[]): MatchState {
  const activeSeats = normalizeSeats(seats);
  if (activeSeats.length < 2) return buildWaitingState();

  const deck = deterministicShuffle("uno-v1", createUnoDeck());
  const hands = emptyHands();

  for (let i = 0; i < 7; i++) {
    for (const seat of activeSeats) {
      hands[seat].push(deck.shift() as string);
    }
  }

  let starter = deck.shift() || "R0";
  while (isWild(starter) && deck.length > 0) {
    deck.push(starter);
    starter = deck.shift() as string;
  }

  const state: UnoState = {
    gameType: "uno",
    board: {
      activeSeats,
      direction: 1,
      hands,
      handCounts: { north: 0, east: 0, south: 0, west: 0 },
      drawPile: deck,
      discardPile: [starter],
      currentColor: cardColor(starter) || "R",
      pendingDraw: 0,
    },
    nextTurn: activeSeats[0],
    status: "playing",
    moveCount: 0,
  };
  syncHandCounts(state);
  return state;
}

function syncHandCounts(state: UnoState): void {
  for (const seat of UNO_SEATS) {
    state.board.handCounts[seat] = state.board.hands[seat].length;
  }
}

function cloneUnoState(state: UnoState): UnoState {
  return {
    ...state,
    board: {
      ...state.board,
      activeSeats: [...state.board.activeSeats],
      hands: {
        north: [...state.board.hands.north],
        east: [...state.board.hands.east],
        south: [...state.board.hands.south],
        west: [...state.board.hands.west],
      },
      handCounts: { ...state.board.handCounts },
      drawPile: [...state.board.drawPile],
      discardPile: [...state.board.discardPile],
      lastAction: state.board.lastAction ? { ...state.board.lastAction } : undefined,
    },
  };
}

export const unoEngine: GameEngine = {
  gameType: "uno",
  seats: UNO_SEATS,
  minPlayers: 2,
  maxPlayers: 4,
  rules: {
    objective: "discard_all_cards",
    seats: ["north", "east", "south", "west"],
    drawStacking: false,
    wildDraw4RequiresNoMatchingColor: true,
    phases: ["playing", "finished"],
  },
  actionSchema: {
    type: "action",
    payload: {
      action: "play|draw",
      card: "string?",
      color: "R|Y|G|B?",
    },
  },

  initState(): MatchState {
    return buildWaitingState();
  },

  validateMove(state, seat, move): void {
    const s = asUnoState(state);
    if (s.status !== "playing") throw new Error("Match is not in playing status");
    if (s.nextTurn !== seat) throw new Error("Not your turn");
    if (!s.board.activeSeats.includes(seat)) throw new Error("Seat is not active");

    const action = String((move as UnoMove)?.action || "");
    if (action !== "play" && action !== "draw") throw new Error("Invalid action");

    if (action === "draw") return;

    const card = String((move as UnoMove)?.card || "");
    if (!card) throw new Error("card is required for play action");
    if (!s.board.hands[seat].includes(card)) throw new Error("card not in hand");
    if (s.board.pendingDraw > 0) throw new Error("must draw pending cards");

    const top = s.board.discardPile[s.board.discardPile.length - 1] || "R0";
    if (!isCardPlayable(card, top, s.board.currentColor)) throw new Error("card is not playable");

    if (card === "W" || card === "W4") {
      const color = String((move as UnoMove)?.color || "");
      if (!(UNO_COLORS as readonly string[]).includes(color)) throw new Error("wild card requires color");
      if (card === "W4") {
        const hasCurrentColorCard = s.board.hands[seat].some((handCard) => !isWild(handCard) && cardColor(handCard) === s.board.currentColor);
        if (hasCurrentColorCard) throw new Error("wild draw four is illegal when matching color card exists");
      }
    }
  },

  applyMove(state, seat, move): MatchState {
    const s = cloneUnoState(state as UnoState);

    const action = String((move as UnoMove).action);
    s.moveCount += 1;

    if (action === "draw") {
      const drawCount = s.board.pendingDraw > 0 ? s.board.pendingDraw : 1;
      const actual = drawCards(s, seat, drawCount);
      s.board.pendingDraw = 0;
      s.nextTurn = advanceSeat(s, seat, 1);
      s.board.lastAction = { seat, action: "draw", drawCount: actual };
      syncHandCounts(s);
      return s;
    }

    const card = String((move as UnoMove).card || "");
    const index = s.board.hands[seat].indexOf(card);
    if (index < 0) throw new Error("card not in hand");
    s.board.hands[seat].splice(index, 1);
    s.board.discardPile.push(card);

    const chosenColor = String((move as UnoMove).color || "") as UnoColor;
    const nextColor = isWild(card) ? chosenColor : (cardColor(card) || s.board.currentColor);
    s.board.currentColor = nextColor;
    s.board.lastAction = { seat, action: "play", card, color: nextColor };

    if (s.board.hands[seat].length === 0) {
      s.status = "finished";
      s.winner = seat;
      syncHandCounts(s);
      return s;
    }

    let direction = s.board.direction;
    let steps = 1;
    if (card === "W4") {
      s.board.pendingDraw = 4;
    } else if (card.endsWith("D2")) {
      s.board.pendingDraw = 2;
    } else if (card.endsWith("S")) {
      steps = 2;
    } else if (card.endsWith("R")) {
      if (s.board.activeSeats.length === 2) {
        steps = 2;
      } else {
        direction = s.board.direction === 1 ? -1 : 1;
      }
    }

    s.board.direction = direction;
    s.nextTurn = advanceSeat(s, seat, steps, direction);
    syncHandCounts(s);
    return s;
  },

  chooseBotMove(state, seat) {
    const s = asUnoState(state);
    if (s.status !== "playing" || s.nextTurn !== seat) return null;
    if (s.board.pendingDraw > 0) return { action: "draw" };

    const hand = s.board.hands[seat] || [];
    const top = s.board.discardPile[s.board.discardPile.length - 1] || "R0";
    const playable = hand.filter((card) => {
      if (!isCardPlayable(card, top, s.board.currentColor)) return false;
      if (card !== "W4") return true;
      return !hand.some((handCard) => !isWild(handCard) && cardColor(handCard) === s.board.currentColor);
    });
    if (!playable.length) return { action: "draw" };

    const nonWild = playable.find((card) => !isWild(card));
    if (nonWild) return { action: "play", card: nonWild };

    const preferred = dominantColor(hand, s.board.currentColor);
    const wild = playable.includes("W") ? "W" : playable.includes("W4") ? "W4" : playable[0];
    return { action: "play", card: wild, color: preferred };
  },

  snapshot(state) {
    const s = asUnoState(state);
    return {
      ...s,
      board: {
        ...s.board,
        topCard: s.board.discardPile[s.board.discardPile.length - 1] || null,
        drawCount: s.board.drawPile.length,
      },
      theme: "sunburst-party",
    };
  },
};
