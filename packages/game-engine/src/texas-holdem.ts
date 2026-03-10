import type { GameEngine, MatchState, Seat } from "./types.ts";

const SUITS = ["S", "H", "D", "C"] as const;
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
const HOLD_EM_SEATS = ["dealer", "small_blind", "big_blind", "utg", "hijack", "cutoff"] as const;
const SMALL_BLIND = 5;
const BIG_BLIND = 10;
const STARTING_STACK = 500;

type Card = `${typeof RANKS[number]}${typeof SUITS[number]}`;

interface PlayerState {
  seat: Seat;
  stack: number;
  folded: boolean;
  allIn: boolean;
  committed: number;
  totalCommitted: number;
  cards: Card[];
}

interface HoldemMove {
  action: "fold" | "check" | "call" | "raise";
  amount?: number;
}

interface HoldemState extends MatchState {
  board: {
    community: Card[];
    pot: number;
    deckCount: number;
    street: "preflop" | "flop" | "turn" | "river" | "showdown";
    button: Seat;
    currentBet: number;
    actorOrder: Seat[];
    handNo: number;
  };
  playersState: Record<Seat, PlayerState>;
  activeSeats: Seat[];
  foldedSeats: Seat[];
  deck: Card[];
  actionQueue: Seat[];
  lastAggressor?: Seat;
  lastMove?: { seat: Seat; action: string; amount?: number };
  winnerSummary?: { winners: Seat[]; label: string };
}

function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

function deterministicShuffle(seed: string): Card[] {
  const deck = createDeck();
  let acc = 2166136261;
  for (const ch of seed) {
    acc ^= ch.charCodeAt(0);
    acc = Math.imul(acc, 16777619);
  }
  for (let i = deck.length - 1; i > 0; i--) {
    acc = Math.imul(acc ^ (i + 11), 1103515245) + 12345;
    const j = Math.abs(acc) % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function otherActivePlayers(state: HoldemState, seat: Seat): Seat[] {
  return state.activeSeats.filter((s) => s !== seat && !state.playersState[s].folded);
}

function rankValue(rank: string): number {
  return RANKS.indexOf(rank as typeof RANKS[number]) + 2;
}

function combinations<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  const current: T[] = [];
  function walk(start: number): void {
    if (current.length === size) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      current.push(items[i]);
      walk(i + 1);
      current.pop();
    }
  }
  walk(0);
  return result;
}

function evaluateFive(cards: Card[]): { score: number[]; label: string } {
  const values = cards.map((c) => rankValue(c[0])).sort((a, b) => b - a);
  const suits = cards.map((c) => c[1]);
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]));
  const uniqueAsc = [...new Set(values)].sort((a, b) => a - b);
  let straightHigh = 0;
  if (uniqueAsc.length === 5 && uniqueAsc[4] - uniqueAsc[0] === 4) straightHigh = uniqueAsc[4];
  if (JSON.stringify(uniqueAsc) === JSON.stringify([2, 3, 4, 5, 14])) straightHigh = 5;
  const flush = suits.every((s) => s === suits[0]);

  if (straightHigh && flush) return { score: [8, straightHigh], label: "Straight Flush" };
  if (groups[0][1] === 4) return { score: [7, groups[0][0], groups[1][0]], label: "Four of a Kind" };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { score: [6, groups[0][0], groups[1][0]], label: "Full House" };
  if (flush) return { score: [5, ...values], label: "Flush" };
  if (straightHigh) return { score: [4, straightHigh], label: "Straight" };
  if (groups[0][1] === 3) return { score: [3, groups[0][0], ...groups.slice(1).map((g) => g[0]).sort((a, b) => b - a)], label: "Three of a Kind" };
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    return { score: [2, ...pairs, groups[2][0]], label: "Two Pair" };
  }
  if (groups[0][1] === 2) return { score: [1, groups[0][0], ...groups.slice(1).map((g) => g[0]).sort((a, b) => b - a)], label: "One Pair" };
  return { score: [0, ...values], label: "High Card" };
}

function compareScore(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function evaluateBest(cards: Card[]): { score: number[]; label: string } {
  let best = { score: [-1], label: "High Card" };
  for (const combo of combinations(cards, 5)) {
    const scored = evaluateFive(combo);
    if (compareScore(scored.score, best.score) > 0) best = scored;
  }
  return best;
}

function nextStreet(street: HoldemState["board"]["street"]): HoldemState["board"]["street"] {
  if (street === "preflop") return "flop";
  if (street === "flop") return "turn";
  if (street === "turn") return "river";
  return "showdown";
}

function nextCommunityCount(street: HoldemState["board"]["street"]): number {
  if (street === "preflop") return 3;
  if (street === "flop") return 4;
  if (street === "turn") return 5;
  return 5;
}

function buildInitialState(): HoldemState {
  const activeSeats = [...HOLD_EM_SEATS];
  const deck = deterministicShuffle("texas-holdem-v1");
  const playersState: Record<Seat, PlayerState> = {};
  for (const seat of activeSeats) {
    playersState[seat] = {
      seat,
      stack: STARTING_STACK,
      folded: false,
      allIn: false,
      committed: 0,
      totalCommitted: 0,
      cards: [deck.shift() as Card, deck.shift() as Card],
    };
  }

  playersState.small_blind.stack -= SMALL_BLIND;
  playersState.small_blind.committed = SMALL_BLIND;
  playersState.small_blind.totalCommitted = SMALL_BLIND;
  playersState.big_blind.stack -= BIG_BLIND;
  playersState.big_blind.committed = BIG_BLIND;
  playersState.big_blind.totalCommitted = BIG_BLIND;

  return {
    gameType: "texas_holdem",
    board: {
      community: [],
      pot: SMALL_BLIND + BIG_BLIND,
      deckCount: deck.length,
      street: "preflop",
      button: "dealer",
      currentBet: BIG_BLIND,
      actorOrder: [...activeSeats],
      handNo: 1,
    },
    nextTurn: "utg",
    status: "waiting",
    moveCount: 0,
    playersState,
    activeSeats,
    foldedSeats: [],
    deck,
    actionQueue: ["utg", "hijack", "cutoff", "dealer", "small_blind", "big_blind"],
  };
}

function canAct(player: PlayerState): boolean {
  return !player.folded && !player.allIn;
}

function advanceQueue(state: HoldemState): HoldemState {
  let queue = state.actionQueue.filter((seat) => canAct(state.playersState[seat]));
  while (queue.length && !canAct(state.playersState[queue[0]])) queue = queue.slice(1);
  if (queue.length > 0) {
    return { ...state, actionQueue: queue, nextTurn: queue[0] };
  }

  const remaining = state.activeSeats.filter((seat) => !state.playersState[seat].folded);
  if (remaining.length <= 1) {
    const winnerSeat = remaining[0] || state.activeSeats[0];
    return {
      ...state,
      status: "finished",
      winner: winnerSeat,
      winnerSummary: { winners: [winnerSeat], label: "Last player standing" },
      nextTurn: winnerSeat,
    };
  }

  const street = nextStreet(state.board.street);
  if (street === "showdown") {
    const scores = remaining.map((seat) => ({
      seat,
      hand: evaluateBest([...state.board.community, ...state.playersState[seat].cards]),
    }));
    scores.sort((a, b) => compareScore(b.hand.score, a.hand.score));
    const best = scores[0];
    const winners = scores.filter((s) => compareScore(s.hand.score, best.hand.score) === 0).map((s) => s.seat);
    return {
      ...state,
      board: { ...state.board, street },
      status: "finished",
      winner: winners.length === 1 ? winners[0] : "draw",
      nextTurn: winners[0],
      winnerSummary: { winners, label: best.hand.label },
    };
  }

  const deck = [...state.deck];
  const community = [...state.board.community];
  while (community.length < nextCommunityCount(state.board.street)) {
    community.push(deck.shift() as Card);
  }
  for (const seat of state.activeSeats) state.playersState[seat].committed = 0;
  const newQueue = state.activeSeats.filter((seat) => canAct(state.playersState[seat]) && !state.playersState[seat].folded);
  return {
    ...state,
    deck,
    actionQueue: newQueue,
    nextTurn: newQueue[0],
    board: {
      ...state.board,
      community,
      deckCount: deck.length,
      street,
      currentBet: 0,
    },
  };
}

export const texasHoldemEngine: GameEngine = {
  gameType: "texas_holdem",
  seats: HOLD_EM_SEATS,
  minPlayers: 2,
  maxPlayers: HOLD_EM_SEATS.length,

  initState(): MatchState {
    return buildInitialState();
  },

  validateMove(state, seat, move): void {
    const s = state as HoldemState;
    const player = s.playersState[seat];
    if (s.status !== "playing") throw new Error("Match is not in playing status");
    if (s.nextTurn !== seat) throw new Error("Not your turn");
    if (!player || player.folded || player.allIn) throw new Error("Seat cannot act");
    const action = String((move as HoldemMove)?.action || "");
    if (!["fold", "check", "call", "raise"].includes(action)) throw new Error("Invalid action");
    if (action === "check" && s.board.currentBet !== player.committed) throw new Error("Cannot check facing a bet");
    if (action === "call" && s.board.currentBet <= player.committed) throw new Error("Nothing to call");
    if (action === "raise") {
      const amount = Number((move as HoldemMove)?.amount || 0);
      if (!Number.isFinite(amount) || amount < BIG_BLIND) throw new Error("Raise too small");
      const target = s.board.currentBet + amount;
      if (target - player.committed > player.stack) throw new Error("Insufficient chips");
    }
  },

  applyMove(state, seat, move): MatchState {
    const s = {
      ...(state as HoldemState),
      playersState: Object.fromEntries(Object.entries((state as HoldemState).playersState).map(([k, v]) => [k, { ...v }])),
      board: { ...(state as HoldemState).board },
      actionQueue: [...(state as HoldemState).actionQueue],
      foldedSeats: [...(state as HoldemState).foldedSeats],
    } as HoldemState;
    const player = s.playersState[seat];
    const action = String((move as HoldemMove).action);

    if (action === "fold") {
      player.folded = true;
      s.foldedSeats.push(seat);
    } else if (action === "call") {
      const diff = Math.min(player.stack, s.board.currentBet - player.committed);
      player.stack -= diff;
      player.committed += diff;
      player.totalCommitted += diff;
      s.board.pot += diff;
      if (player.stack === 0) player.allIn = true;
    } else if (action === "raise") {
      const amount = Number((move as HoldemMove).amount || 0);
      const target = s.board.currentBet + amount;
      const diff = target - player.committed;
      player.stack -= diff;
      player.committed = target;
      player.totalCommitted += diff;
      s.board.currentBet = target;
      s.board.pot += diff;
      s.lastAggressor = seat;
      if (player.stack === 0) player.allIn = true;
      s.actionQueue = s.activeSeats.filter((candidate) => candidate !== seat && !s.playersState[candidate].folded && !s.playersState[candidate].allIn);
    }

    s.moveCount += 1;
    s.lastMove = { seat, action, amount: Number((move as HoldemMove).amount || 0) || undefined };
    if (action !== "raise") s.actionQueue = s.actionQueue.filter((candidate) => candidate !== seat);
    return advanceQueue(s);
  },

  chooseBotMove(state, seat) {
    const s = state as HoldemState;
    const player = s.playersState[seat];
    if (!player || s.status !== "playing" || s.nextTurn !== seat) return null;
    const ranks = player.cards.map((card) => rankValue(card[0]));
    const suited = player.cards[0][1] === player.cards[1][1];
    const pair = ranks[0] === ranks[1];
    const high = Math.max(...ranks);
    const diff = s.board.currentBet - player.committed;
    if (pair && high >= 10 && player.stack > diff + BIG_BLIND) return { action: "raise", amount: BIG_BLIND };
    if ((high >= 13 && suited) || pair || s.board.street !== "preflop") {
      return diff > 0 ? { action: "call" } : { action: "check" };
    }
    if (diff === 0) return { action: "check" };
    if (diff <= BIG_BLIND) return { action: "call" };
    return { action: "fold" };
  },

  snapshot(state) {
    const s = state as HoldemState;
    return {
      ...s,
      theme: "casino-noir",
      blinds: { small: SMALL_BLIND, big: BIG_BLIND },
      startingStack: STARTING_STACK,
    };
  },
};
