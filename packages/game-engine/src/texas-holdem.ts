import type { GameEngine, MatchState, Seat } from "./types.ts";

const SUITS = ["S", "H", "D", "C"] as const;
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
const HOLD_EM_SEATS = ["dealer", "small_blind", "big_blind", "utg", "hijack"] as const;
const SMALL_BLIND = 5;
const BIG_BLIND = 10;
const STARTING_STACK = 1000;
const TOTAL_HANDS = 3;

type Card = `${typeof RANKS[number]}${typeof SUITS[number]}`;
type Street = "preflop" | "flop" | "turn" | "river" | "showdown";

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

export interface HoldemState extends MatchState {
  board: {
    community: Card[];
    pot: number;
    deckCount: number;
    street: Street;
    button: Seat;
    currentBet: number;
    actorOrder: Seat[];
    handNo: number;
    totalHands: number;
  };
  playersState: Record<Seat, PlayerState>;
  activeSeats: Seat[];
  foldedSeats: Seat[];
  deck: Card[];
  actionQueue: Seat[];
  matchWins: Record<Seat, number>;
  lastAggressor?: Seat;
  lastMove?: { seat: Seat; action: string; amount?: number };
  winnerSummary?: { winners: Seat[]; label: string };
  finishReason?: string;
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

function nextStreet(street: Street): Street {
  if (street === "preflop") return "flop";
  if (street === "flop") return "turn";
  if (street === "turn") return "river";
  return "showdown";
}

function nextCommunityCount(street: Street): number {
  if (street === "preflop") return 3;
  if (street === "flop") return 4;
  if (street === "turn") return 5;
  return 5;
}

function canAct(player: PlayerState | undefined): boolean {
  if (!player) return false;
  return !player.folded && !player.allIn;
}

function circularFrom<T>(items: T[], startIndex: number): T[] {
  if (!items.length) return [];
  const normalized = ((startIndex % items.length) + items.length) % items.length;
  return [...items.slice(normalized), ...items.slice(0, normalized)];
}

function normalizeSeats(inputSeats: Seat[]): Seat[] {
  const unique = Array.from(new Set(inputSeats.filter(Boolean)));
  const ordered = HOLD_EM_SEATS.filter((seat) => unique.includes(seat));
  return ordered.length ? ordered : unique;
}

function cloneState(state: HoldemState): HoldemState {
  return {
    ...state,
    board: { ...state.board, community: [...state.board.community], actorOrder: [...state.board.actorOrder] },
    playersState: Object.fromEntries(Object.entries(state.playersState).map(([k, v]) => [k, { ...v, cards: [...v.cards] }])),
    activeSeats: [...state.activeSeats],
    foldedSeats: [...state.foldedSeats],
    deck: [...state.deck],
    actionQueue: [...state.actionQueue],
    matchWins: { ...state.matchWins },
    winnerSummary: state.winnerSummary ? { ...state.winnerSummary, winners: [...state.winnerSummary.winners] } : undefined,
  } as HoldemState;
}

function buildWaitingState(): HoldemState {
  return {
    gameType: "texas_holdem",
    board: {
      community: [],
      pot: 0,
      deckCount: 0,
      street: "preflop",
      button: "dealer",
      currentBet: 0,
      actorOrder: [],
      handNo: 0,
      totalHands: TOTAL_HANDS,
    },
    nextTurn: "",
    status: "waiting",
    moveCount: 0,
    playersState: {},
    activeSeats: [],
    foldedSeats: [],
    deck: [],
    actionQueue: [],
    matchWins: {},
  };
}

function startHand(
  seats: Seat[],
  handNo: number,
  totalHands: number,
  wins: Record<Seat, number>,
  moveCount: number,
): HoldemState {
  const activeSeats = normalizeSeats(seats);
  if (activeSeats.length < 2) return buildWaitingState();

  const deck = deterministicShuffle(`texas-holdem-v2:${handNo}:${activeSeats.join(",")}`);
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

  const buttonIndex = (handNo - 1) % activeSeats.length;
  const button = activeSeats[buttonIndex];
  const smallBlindSeat = activeSeats[(buttonIndex + (activeSeats.length === 2 ? 0 : 1)) % activeSeats.length];
  const bigBlindSeat = activeSeats[(buttonIndex + (activeSeats.length === 2 ? 1 : 2)) % activeSeats.length];

  const sbCommit = Math.min(SMALL_BLIND, playersState[smallBlindSeat].stack);
  playersState[smallBlindSeat].stack -= sbCommit;
  playersState[smallBlindSeat].committed = sbCommit;
  playersState[smallBlindSeat].totalCommitted = sbCommit;
  if (playersState[smallBlindSeat].stack === 0) playersState[smallBlindSeat].allIn = true;

  const bbCommit = Math.min(BIG_BLIND, playersState[bigBlindSeat].stack);
  playersState[bigBlindSeat].stack -= bbCommit;
  playersState[bigBlindSeat].committed = bbCommit;
  playersState[bigBlindSeat].totalCommitted = bbCommit;
  if (playersState[bigBlindSeat].stack === 0) playersState[bigBlindSeat].allIn = true;

  const firstActorIndex = activeSeats.length === 2
    ? buttonIndex
    : (activeSeats.indexOf(bigBlindSeat) + 1) % activeSeats.length;

  const actionQueue = circularFrom(activeSeats, firstActorIndex).filter((seat) => canAct(playersState[seat]));

  return {
    gameType: "texas_holdem",
    board: {
      community: [],
      pot: sbCommit + bbCommit,
      deckCount: deck.length,
      street: "preflop",
      button,
      currentBet: bbCommit,
      actorOrder: circularFrom(activeSeats, buttonIndex),
      handNo,
      totalHands,
    },
    nextTurn: actionQueue[0] || smallBlindSeat,
    status: "playing",
    moveCount,
    playersState,
    activeSeats,
    foldedSeats: [],
    deck,
    actionQueue,
    matchWins: { ...wins },
    winnerSummary: undefined,
    finishReason: undefined,
  };
}

function settleMatchWinner(state: HoldemState): { winners: Seat[]; winner: Seat | "draw" } {
  const trackedSeats = state.activeSeats;
  if (!trackedSeats.length) return { winners: [], winner: "draw" };
  let maxWins = -1;
  for (const seat of trackedSeats) {
    maxWins = Math.max(maxWins, Number(state.matchWins[seat] || 0));
  }
  const winners = trackedSeats.filter((seat) => Number(state.matchWins[seat] || 0) === maxWins);
  if (!winners.length) return { winners: [], winner: "draw" };
  return { winners, winner: winners.length === 1 ? winners[0] : "draw" };
}

function settleHand(state: HoldemState, winners: Seat[], label: string, finishReason: string): HoldemState {
  const nextWins = { ...state.matchWins };
  for (const seat of winners) {
    nextWins[seat] = Number(nextWins[seat] || 0) + 1;
  }

  if (state.board.handNo >= state.board.totalHands) {
    const settled = {
      ...state,
      status: "finished" as const,
      board: { ...state.board, street: "showdown" as Street },
      matchWins: nextWins,
      finishReason,
      winnerSummary: { winners: [...winners], label },
    };
    const match = settleMatchWinner(settled);
    settled.winner = match.winner;
    settled.nextTurn = match.winners[0] || settled.nextTurn;
    return settled;
  }

  // Keep a real showdown phase between hands so clients can reveal all cards
  // and winner info before the next hand starts.
  return {
    ...state,
    status: "playing" as const,
    board: { ...state.board, street: "showdown" as Street },
    nextTurn: "",
    actionQueue: [],
    matchWins: nextWins,
    winnerSummary: { winners: [...winners], label },
    finishReason,
    winner: undefined,
  };
}

function advanceQueue(state: HoldemState): HoldemState {
  let s = cloneState(state);

  while (true) {
    s.actionQueue = s.actionQueue.filter((seat) => canAct(s.playersState[seat]));
    if (s.actionQueue.length > 0) {
      s.nextTurn = s.actionQueue[0];
      return s;
    }

    const remaining = s.activeSeats.filter((seat) => !s.playersState[seat]?.folded);
    if (remaining.length <= 1) {
      const winnerSeat = remaining[0] || s.activeSeats[0];
      return settleHand(s, winnerSeat ? [winnerSeat] : [], "Last player standing", "last_player");
    }

    const next = nextStreet(s.board.street);
    if (next === "showdown") {
      const scores = remaining.map((seat) => ({
        seat,
        hand: evaluateBest([...s.board.community, ...s.playersState[seat].cards]),
      }));
      scores.sort((a, b) => compareScore(b.hand.score, a.hand.score));
      const best = scores[0];
      const winners = scores.filter((item) => compareScore(item.hand.score, best.hand.score) === 0).map((item) => item.seat);
      s.board.street = "showdown";
      return settleHand(s, winners, best.hand.label, "showdown");
    }

    while (s.board.community.length < nextCommunityCount(s.board.street)) {
      s.board.community.push(s.deck.shift() as Card);
    }
    s.board.street = next;
    s.board.deckCount = s.deck.length;
    s.board.currentBet = 0;
    for (const seat of s.activeSeats) {
      if (s.playersState[seat]) s.playersState[seat].committed = 0;
    }

    const buttonIndex = s.activeSeats.indexOf(s.board.button);
    const firstToAct = circularFrom(s.activeSeats, buttonIndex + 1);
    s.actionQueue = firstToAct.filter((seat) => canAct(s.playersState[seat]) && !s.playersState[seat].folded);
    if (s.actionQueue.length === 0) {
      continue;
    }
    s.nextTurn = s.actionQueue[0];
    return s;
  }
}

function isHoldemState(state: MatchState): state is HoldemState {
  const candidate = state as HoldemState;
  return candidate?.gameType === "texas_holdem" && Array.isArray(candidate?.activeSeats) && !!candidate?.playersState;
}

export function initTexasHoldemMatchState(seats: Seat[], totalHands = TOTAL_HANDS): MatchState {
  const normalized = normalizeSeats(seats);
  if (normalized.length < 2) return buildWaitingState();
  return startHand(normalized, 1, Math.max(1, totalHands), {}, 0);
}

export function texasHoldemHandleSeatLeave(state: MatchState, seat: Seat): MatchState {
  if (!isHoldemState(state)) return state;
  const s = cloneState(state);
  if (!s.activeSeats.includes(seat)) return s;

  s.activeSeats = s.activeSeats.filter((x) => x !== seat);
  delete s.playersState[seat];
  s.foldedSeats = s.foldedSeats.filter((x) => x !== seat);
  s.actionQueue = s.actionQueue.filter((x) => x !== seat);
  s.board.actorOrder = s.board.actorOrder.filter((x) => x !== seat);

  if (s.activeSeats.length < 2) {
    s.status = "waiting";
    s.nextTurn = s.activeSeats[0] || "";
    s.winner = undefined;
    s.winnerSummary = undefined;
    s.finishReason = undefined;
    return s;
  }

  if (s.status !== "playing") {
    if (!s.activeSeats.includes(s.nextTurn)) s.nextTurn = s.activeSeats[0];
    return s;
  }

  if (!s.activeSeats.includes(s.board.button)) {
    s.board.button = s.activeSeats[0];
  }

  if (s.nextTurn === seat || !s.activeSeats.includes(s.nextTurn)) {
    s.nextTurn = s.actionQueue[0] || s.activeSeats[0];
  }

  return advanceQueue(s);
}

export function texasHoldemAdvanceShowdown(state: MatchState): MatchState {
  if (!isHoldemState(state)) return state;
  const s = cloneState(state);
  if (s.status !== "playing") return s;
  if (s.board.street !== "showdown") return s;
  if (s.winner) return s;
  if (s.board.handNo >= s.board.totalHands) return s;
  return startHand(s.activeSeats, s.board.handNo + 1, s.board.totalHands, s.matchWins, s.moveCount);
}

export const texasHoldemEngine: GameEngine = {
  gameType: "texas_holdem",
  seats: HOLD_EM_SEATS,
  minPlayers: 2,
  maxPlayers: HOLD_EM_SEATS.length,
  rules: {
    seats: 5,
    blinds: { small: SMALL_BLIND, big: BIG_BLIND },
    roundsPerMatch: TOTAL_HANDS,
    startingStack: STARTING_STACK,
    streets: ["preflop", "flop", "turn", "river", "showdown"],
  },
  actionSchema: { type: "action", payload: { action: "fold|check|call|raise", amount: "number?" } },

  initState(): MatchState {
    return buildWaitingState();
  },

  validateMove(state, seat, move): void {
    if (!isHoldemState(state)) throw new Error("Invalid texas state");
    const s = state;
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
      if (target <= s.board.currentBet) throw new Error("Raise must increase current bet");
      if (target - player.committed > player.stack) throw new Error("Insufficient chips");
    }
  },

  applyMove(state, seat, move): MatchState {
    if (!isHoldemState(state)) return state;
    const s = cloneState(state);
    const player = s.playersState[seat];
    if (!player) return s;
    const action = String((move as HoldemMove).action);

    if (action === "fold") {
      player.folded = true;
      if (!s.foldedSeats.includes(seat)) s.foldedSeats.push(seat);
    } else if (action === "call") {
      const diff = Math.min(player.stack, Math.max(0, s.board.currentBet - player.committed));
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
      s.actionQueue = s.activeSeats.filter((candidate) => candidate !== seat && canAct(s.playersState[candidate]) && !s.playersState[candidate].folded);
    }

    s.moveCount += 1;
    s.lastMove = { seat, action, amount: Number((move as HoldemMove).amount || 0) || undefined };
    if (action !== "raise") s.actionQueue = s.actionQueue.filter((candidate) => candidate !== seat);

    return advanceQueue(s);
  },

  chooseBotMove(state, seat) {
    if (!isHoldemState(state)) return null;
    const s = state;
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
    if (!isHoldemState(state)) return state;
    const s = state;
    return {
      ...s,
      theme: "casino-noir",
      blinds: { small: SMALL_BLIND, big: BIG_BLIND },
      startingStack: STARTING_STACK,
      totalHands: s.board.totalHands,
      currentHand: s.board.handNo,
    };
  },
};
