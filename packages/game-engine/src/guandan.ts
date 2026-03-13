import type { GameEngine, MatchState, Seat } from "./types.ts";

const GUANDAN_SEATS = ["north", "east", "south", "west"] as const;
const TEAM_NS = new Set<Seat>(["north", "south"]);
const TEAM_EW = new Set<Seat>(["east", "west"]);

const NON_JOKER_RANKS = ["3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A", "2"] as const;
const SUITS = ["S", "H", "D", "C"] as const;
const JOKERS = ["SJ", "BJ"] as const;

type ComboType = "single" | "pair" | "triple" | "straight" | "bomb";

interface GuandanMove {
  action: "play" | "pass";
  cards?: string[];
}

interface Combo {
  type: ComboType;
  rank: number;
  length: number;
}

interface GuandanState extends MatchState {
  board: {
    hands: Record<Seat, string[]>;
    handCounts: Record<Seat, number>;
    finishedOrder: Seat[];
    lastPlay?: {
      seat: Seat;
      cards: string[];
      combo: Combo;
    };
    trickPasses: number;
    trickLeader?: Seat;
    lastAction?: { seat: Seat; action: "play" | "pass"; cards?: string[] };
    winnerTeam?: "NS" | "EW";
  };
}

function rankValue(rank: string): number {
  if (rank === "SJ") return 18;
  if (rank === "BJ") return 19;
  const idx = NON_JOKER_RANKS.indexOf(rank as (typeof NON_JOKER_RANKS)[number]);
  return idx >= 0 ? idx + 3 : 0;
}

function extractRank(cardId: string): string {
  const idx = cardId.indexOf("-");
  if (idx < 0) return "";
  return cardId.slice(idx + 1, idx + 3) === "SJ" || cardId.slice(idx + 1, idx + 3) === "BJ"
    ? cardId.slice(idx + 1, idx + 3)
    : cardId.slice(idx + 1, idx + 2);
}

function deterministicShuffle(seed: string, cards: string[]): string[] {
  const deck = [...cards];
  let acc = 2166136261;
  for (const ch of seed) {
    acc ^= ch.charCodeAt(0);
    acc = Math.imul(acc, 16777619);
  }
  for (let i = deck.length - 1; i > 0; i--) {
    acc = Math.imul(acc ^ (i + 17), 1103515245) + 12345;
    const j = Math.abs(acc) % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function createDoubleDeck(): string[] {
  const deck: string[] = [];
  for (let d = 1; d <= 2; d++) {
    for (const rank of NON_JOKER_RANKS) {
      for (const suit of SUITS) {
        deck.push(`${d}-${rank}${suit}`);
      }
    }
    for (const joker of JOKERS) {
      deck.push(`${d}-${joker}`);
    }
  }
  return deck;
}

function nextActiveSeat(state: GuandanState, from: Seat): Seat {
  const finished = new Set(state.board.finishedOrder);
  const idx = GUANDAN_SEATS.indexOf(from as (typeof GUANDAN_SEATS)[number]);
  for (let offset = 1; offset <= GUANDAN_SEATS.length; offset++) {
    const seat = GUANDAN_SEATS[(idx + offset) % GUANDAN_SEATS.length];
    if (!finished.has(seat)) return seat;
  }
  return from;
}

function activeSeatCount(state: GuandanState): number {
  return GUANDAN_SEATS.filter((seat) => !state.board.finishedOrder.includes(seat)).length;
}

function countByRank(cardIds: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of cardIds) {
    const rank = extractRank(id);
    m.set(rank, (m.get(rank) || 0) + 1);
  }
  return m;
}

function analyzeCombo(cardIds: string[]): Combo {
  const cards = [...cardIds];
  if (cards.length === 0) throw new Error("cards are required");
  const ranks = cards.map((id) => extractRank(id));
  if (ranks.some((r) => !r)) throw new Error("invalid card id");
  const grouped = countByRank(cards);
  const unique = [...grouped.entries()];

  if (cards.length === 1) {
    const rank = rankValue(ranks[0]);
    return { type: "single", rank, length: 1 };
  }

  if (unique.length === 1) {
    const rank = rankValue(unique[0][0]);
    if (cards.length === 2) return { type: "pair", rank, length: 2 };
    if (cards.length === 3) return { type: "triple", rank, length: 3 };
    if (cards.length >= 4) return { type: "bomb", rank, length: cards.length };
  }

  const straightLen = cards.length;
  if (straightLen >= 5 && unique.length === straightLen) {
    const values = ranks.map((r) => rankValue(r)).sort((a, b) => a - b);
    if (values.some((v) => v >= 16)) throw new Error("straight cannot contain 2 or jokers");
    let consecutive = true;
    for (let i = 1; i < values.length; i++) {
      if (values[i] !== values[i - 1] + 1) {
        consecutive = false;
        break;
      }
    }
    if (consecutive) {
      return { type: "straight", rank: values[values.length - 1], length: straightLen };
    }
  }

  throw new Error("unsupported combo");
}

function canBeat(current: Combo | undefined, next: Combo): boolean {
  if (!current) return true;
  if (next.type === "bomb" && current.type !== "bomb") return true;
  if (current.type === "bomb" && next.type !== "bomb") return false;
  if (current.type !== next.type) return false;
  if (next.type === "bomb") {
    if (next.length !== current.length) return next.length > current.length;
    return next.rank > current.rank;
  }
  if (next.type === "straight") {
    if (next.length !== current.length) return false;
    return next.rank > current.rank;
  }
  if (next.length !== current.length) return false;
  return next.rank > current.rank;
}

function winnerTeam(finishedOrder: Seat[]): "NS" | "EW" | undefined {
  const done = new Set(finishedOrder);
  const nsDone = [...TEAM_NS].every((seat) => done.has(seat));
  const ewDone = [...TEAM_EW].every((seat) => done.has(seat));
  if (nsDone && !ewDone) return "NS";
  if (ewDone && !nsDone) return "EW";
  return undefined;
}

function setHandCounts(state: GuandanState): void {
  for (const seat of GUANDAN_SEATS) {
    state.board.handCounts[seat] = state.board.hands[seat].length;
  }
}

function removeCardsFromHand(hand: string[], cards: string[]): string[] {
  const next = [...hand];
  for (const id of cards) {
    const idx = next.indexOf(id);
    if (idx < 0) throw new Error("card not in hand");
    next.splice(idx, 1);
  }
  return next;
}

function buildInitialState(): GuandanState {
  const deck = deterministicShuffle("guandan-v1", createDoubleDeck());
  const hands: Record<Seat, string[]> = {
    north: [],
    east: [],
    south: [],
    west: [],
  };
  for (let i = 0; i < 27; i++) {
    for (const seat of GUANDAN_SEATS) {
      hands[seat].push(deck.shift() as string);
    }
  }
  for (const seat of GUANDAN_SEATS) {
    hands[seat].sort((a, b) => rankValue(extractRank(a)) - rankValue(extractRank(b)));
  }
  const state: GuandanState = {
    gameType: "guandan",
    board: {
      hands,
      handCounts: { north: 27, east: 27, south: 27, west: 27 },
      finishedOrder: [],
      trickPasses: 0,
      trickLeader: "north",
    },
    nextTurn: "north",
    status: "waiting",
    moveCount: 0,
  };
  return state;
}

function smallestPlayableMove(state: GuandanState, seat: Seat): GuandanMove | null {
  const hand = [...state.board.hands[seat]].sort((a, b) => rankValue(extractRank(a)) - rankValue(extractRank(b)));
  if (hand.length === 0) return null;
  const current = state.board.lastPlay?.combo;
  const rankGroups = countByRank(hand);
  const byRank = [...rankGroups.entries()].sort((a, b) => rankValue(a[0]) - rankValue(b[0]));

  if (!current) {
    return { action: "play", cards: [hand[0]] };
  }

  if (current.type === "single" || current.type === "pair" || current.type === "triple") {
    const need = current.length;
    for (const [rank, cnt] of byRank) {
      const r = rankValue(rank);
      if (cnt < need || r <= current.rank) continue;
      const cards = hand.filter((id) => extractRank(id) === rank).slice(0, need);
      return { action: "play", cards };
    }
  }

  if (current.type === "bomb") {
    for (const [rank, cnt] of byRank) {
      if (cnt < 4) continue;
      const candidate: Combo = { type: "bomb", rank: rankValue(rank), length: cnt };
      if (!canBeat(current, candidate)) continue;
      return { action: "play", cards: hand.filter((id) => extractRank(id) === rank) };
    }
  }

  if (current.type !== "bomb") {
    for (const [rank, cnt] of byRank) {
      if (cnt < 4) continue;
      return { action: "play", cards: hand.filter((id) => extractRank(id) === rank) };
    }
  }

  return { action: "pass" };
}

export const guandanEngine: GameEngine = {
  gameType: "guandan",
  seats: GUANDAN_SEATS,
  minPlayers: 4,
  maxPlayers: 4,

  initState(): MatchState {
    return buildInitialState();
  },

  validateMove(state, seat, move): void {
    const s = state as GuandanState;
    const payload = (move || {}) as GuandanMove;
    const action = String(payload.action || "");
    if (s.status !== "playing") throw new Error("Match is not in playing status");
    if (s.nextTurn !== seat) throw new Error("Not your turn");
    if (!["play", "pass"].includes(action)) throw new Error("invalid action");
    if (s.board.finishedOrder.includes(seat)) throw new Error("seat already finished");

    if (action === "pass") {
      if (!s.board.lastPlay) throw new Error("cannot pass without an active trick");
      if (s.board.lastPlay.seat === seat) throw new Error("trick leader cannot pass");
      return;
    }

    const cards = Array.isArray(payload.cards) ? payload.cards.map((v) => String(v)) : [];
    if (cards.length === 0) throw new Error("cards are required");
    const hand = s.board.hands[seat];
    const handSet = new Set(hand);
    for (const card of cards) {
      if (!handSet.has(card)) throw new Error("card not in hand");
      handSet.delete(card);
    }

    const combo = analyzeCombo(cards);
    if (!canBeat(s.board.lastPlay?.combo, combo)) {
      throw new Error("combo does not beat current trick");
    }
  },

  applyMove(state, seat, move): MatchState {
    const s = {
      ...(state as GuandanState),
      board: {
        ...((state as GuandanState).board),
        hands: {
          ...((state as GuandanState).board.hands),
          north: [...((state as GuandanState).board.hands.north)],
          east: [...((state as GuandanState).board.hands.east)],
          south: [...((state as GuandanState).board.hands.south)],
          west: [...((state as GuandanState).board.hands.west)],
        },
        handCounts: { ...((state as GuandanState).board.handCounts) },
        finishedOrder: [...((state as GuandanState).board.finishedOrder)],
        lastPlay: (state as GuandanState).board.lastPlay
          ? {
            seat: (state as GuandanState).board.lastPlay!.seat,
            cards: [...(state as GuandanState).board.lastPlay!.cards],
            combo: { ...(state as GuandanState).board.lastPlay!.combo },
          }
          : undefined,
      },
    } as GuandanState;
    const payload = move as GuandanMove;

    if (payload.action === "pass") {
      s.board.trickPasses += 1;
      s.board.lastAction = { seat, action: "pass" };
      const requiredPasses = Math.max(1, activeSeatCount(s) - 1);
      if (s.board.lastPlay && s.board.trickPasses >= requiredPasses) {
        const leadSeat = s.board.lastPlay.seat;
        s.board.lastPlay = undefined;
        s.board.trickPasses = 0;
        s.board.trickLeader = leadSeat;
        s.nextTurn = s.board.finishedOrder.includes(leadSeat) ? nextActiveSeat(s, leadSeat) : leadSeat;
      } else {
        s.nextTurn = nextActiveSeat(s, seat);
      }
      s.moveCount += 1;
      return s;
    }

    const cards = (payload.cards || []).map((id) => String(id));
    const combo = analyzeCombo(cards);
    s.board.hands[seat] = removeCardsFromHand(s.board.hands[seat], cards);
    setHandCounts(s);
    s.board.lastPlay = { seat, cards: [...cards], combo };
    s.board.trickPasses = 0;
    s.board.trickLeader = seat;
    s.board.lastAction = { seat, action: "play", cards: [...cards] };

    if (s.board.hands[seat].length === 0 && !s.board.finishedOrder.includes(seat)) {
      s.board.finishedOrder.push(seat);
    }

    const team = winnerTeam(s.board.finishedOrder);
    if (team) {
      s.status = "finished";
      s.board.winnerTeam = team;
      s.winner = s.board.finishedOrder[0] || seat;
      s.moveCount += 1;
      return s;
    }

    if (activeSeatCount(s) <= 1) {
      s.status = "finished";
      s.winner = s.board.finishedOrder[0] || seat;
      s.moveCount += 1;
      return s;
    }

    s.nextTurn = nextActiveSeat(s, seat);
    s.moveCount += 1;
    return s;
  },

  chooseBotMove(state, seat) {
    const s = state as GuandanState;
    if (s.status !== "playing" || s.nextTurn !== seat) return null;
    return smallestPlayableMove(s, seat);
  },

  snapshot(state) {
    const s = state as GuandanState;
    return {
      ...s,
      board: {
        ...s.board,
        handCounts: { ...s.board.handCounts },
        finishedOrder: [...s.board.finishedOrder],
      },
    };
  },
};
