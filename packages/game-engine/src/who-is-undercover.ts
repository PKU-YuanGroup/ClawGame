import type { GameEngine, MatchState, Seat } from "./types.ts";

const UNDERCOVER_SEATS = ["one", "two", "three", "four", "five", "six", "seven", "eight"] as const;
const WORD_BANK = [
  { civilian: "aurora", undercover: "nebula" },
  { civilian: "coffee", undercover: "tea" },
  { civilian: "piano", undercover: "violin" },
  { civilian: "robot", undercover: "android" },
  { civilian: "volcano", undercover: "geyser" },
  { civilian: "ocean", undercover: "lake" },
  { civilian: "apple", undercover: "pear" },
  { civilian: "cat", undercover: "fox" },
  { civilian: "train", undercover: "subway" },
  { civilian: "doctor", undercover: "nurse" },
  { civilian: "moon", undercover: "planet" },
  { civilian: "sword", undercover: "dagger" },
  { civilian: "notebook", undercover: "tablet" },
  { civilian: "spring", undercover: "autumn" },
  { civilian: "rain", undercover: "snow" },
  { civilian: "soccer", undercover: "basketball" },
  { civilian: "camera", undercover: "camcorder" },
  { civilian: "pancake", undercover: "waffle" },
  { civilian: "forest", undercover: "jungle" },
  { civilian: "bridge", undercover: "tunnel" },
  { civilian: "bread", undercover: "cake" },
  { civilian: "burger", undercover: "sandwich" },
  { civilian: "noodles", undercover: "pasta" },
  { civilian: "rice", undercover: "porridge" },
  { civilian: "bicycle", undercover: "motorcycle" },
  { civilian: "airplane", undercover: "helicopter" },
  { civilian: "ship", undercover: "submarine" },
  { civilian: "bus", undercover: "coach" },
  { civilian: "lion", undercover: "tiger" },
  { civilian: "wolf", undercover: "dog" },
  { civilian: "eagle", undercover: "hawk" },
  { civilian: "shark", undercover: "dolphin" },
  { civilian: "teacher", undercover: "professor" },
  { civilian: "police", undercover: "detective" },
  { civilian: "chef", undercover: "baker" },
  { civilian: "pilot", undercover: "captain" },
  { civilian: "desert", undercover: "beach" },
  { civilian: "mountain", undercover: "hill" },
  { civilian: "river", undercover: "waterfall" },
  { civilian: "island", undercover: "peninsula" },
  { civilian: "computer", undercover: "server" },
  { civilian: "keyboard", undercover: "mouse" },
  { civilian: "browser", undercover: "search_engine" },
  { civilian: "wifi", undercover: "bluetooth" },
  { civilian: "movie", undercover: "tv_series" },
  { civilian: "novel", undercover: "comic" },
  { civilian: "guitar", undercover: "ukulele" },
  { civilian: "drum", undercover: "tambourine" },
  { civilian: "hospital", undercover: "clinic" },
  { civilian: "school", undercover: "library" },
  { civilian: "bank", undercover: "vault" },
  { civilian: "museum", undercover: "gallery" },
  { civilian: "shirt", undercover: "jacket" },
  { civilian: "shoes", undercover: "boots" },
  { civilian: "hat", undercover: "helmet" },
  { civilian: "glasses", undercover: "goggles" },
] as const;

interface UndercoverMove {
  action: "clue" | "vote";
  text?: string;
  target?: Seat;
}

interface UndercoverState extends MatchState {
  board: {
    round: number;
    phase: "clue" | "vote" | "finished";
    alive: Seat[];
    eliminated: Seat[];
    words: Record<Seat, string>;
    roles: Record<Seat, "civilian" | "undercover">;
    clues: Record<Seat, string>;
    votes: Record<Seat, Seat>;
    reveal?: string;
  };
}

function normalizeSeats(input: Seat[]): Seat[] {
  const unique = Array.from(new Set(input.filter(Boolean)));
  return UNDERCOVER_SEATS.filter((seat) => unique.includes(seat));
}

function pickWordPair(seats: Seat[]): { civilian: string; undercover: string } {
  const seed = seats.join("|");
  let acc = 0;
  for (const ch of seed) acc = (acc * 33 + ch.charCodeAt(0)) >>> 0;
  return WORD_BANK[acc % WORD_BANK.length];
}

function buildState(seats: Seat[] = []): UndercoverState {
  const activeSeats = normalizeSeats(seats);
  const roles: Record<Seat, "civilian" | "undercover"> = {};
  const words: Record<Seat, string> = {};
  const pair = pickWordPair(activeSeats);
  const undercoverCount = activeSeats.length >= 6 ? 2 : 1;
  activeSeats.forEach((seat, index) => {
    const undercover = index < undercoverCount;
    roles[seat] = undercover ? "undercover" : "civilian";
    words[seat] = undercover ? pair.undercover : pair.civilian;
  });
  return {
    gameType: "who_is_undercover",
    board: {
      round: 1,
      phase: "clue",
      alive: [...activeSeats],
      eliminated: [],
      words,
      roles,
      clues: {},
      votes: {},
    },
    nextTurn: activeSeats[0] || UNDERCOVER_SEATS[0],
    status: activeSeats.length >= 3 ? "playing" : "waiting",
    moveCount: 0,
  };
}

function nextAlive(alive: Seat[], seat: Seat): Seat {
  const index = alive.indexOf(seat);
  return alive[(index + 1) % alive.length];
}

function result(state: UndercoverState): { winner?: Seat | "draw"; reveal?: string; finished: boolean } {
  const undercoverAlive = state.board.alive.filter((seat) => state.board.roles[seat] === "undercover").length;
  const civiliansAlive = state.board.alive.length - undercoverAlive;
  if (undercoverAlive === 0) return { winner: "civilians", reveal: "All undercover players were found.", finished: true };
  if (undercoverAlive >= civiliansAlive) return { winner: "undercover", reveal: "Undercover players reached parity.", finished: true };
  return { finished: false };
}

export const whoIsUndercoverEngine: GameEngine = {
  gameType: "who_is_undercover",
  seats: UNDERCOVER_SEATS,
  minPlayers: 3,
  maxPlayers: UNDERCOVER_SEATS.length,
  rules: { seats: 8, phases: ["clue", "vote"], hiddenWords: true, manualStartByOwner: true },
  actionSchema: { type: "action", payload: { action: "clue|vote", text: "string?", target: "string?" } },

  initState(): MatchState {
    return buildState();
  },

  validateMove(state, seat, move): void {
    const s = state as UndercoverState;
    if (s.status !== "playing") throw new Error("Match is not in playing status");
    if (!s.board.alive.includes(seat)) throw new Error("Seat is eliminated");
    if (s.nextTurn !== seat) throw new Error("Not your turn");
    const action = String((move as UndercoverMove)?.action || "");
    if (!["clue", "vote"].includes(action)) throw new Error("Invalid action");
    if (action === "clue" && !String((move as UndercoverMove)?.text || "").trim()) throw new Error("Clue text is required");
    if (action === "vote") {
      const target = String((move as UndercoverMove)?.target || "").trim();
      if (!target) throw new Error("Vote target is required");
      if (!s.board.alive.includes(target as Seat)) throw new Error("Vote target is not alive");
      if (target === seat) throw new Error("Cannot vote for yourself");
    }
  },

  applyMove(state, seat, move): MatchState {
    const s = {
      ...(state as UndercoverState),
      board: {
        ...((state as UndercoverState).board),
        alive: [...((state as UndercoverState).board.alive)],
        eliminated: [...((state as UndercoverState).board.eliminated)],
        clues: { ...((state as UndercoverState).board.clues) },
        votes: { ...((state as UndercoverState).board.votes) },
      },
    } as UndercoverState;

    const action = String((move as UndercoverMove).action);
    if (s.board.phase === "clue" && action === "clue") {
      s.board.clues[seat] = String((move as UndercoverMove).text || "").trim().slice(0, 80);
      const done = s.board.alive.every((aliveSeat) => Boolean(s.board.clues[aliveSeat]));
      s.nextTurn = done ? s.board.alive[0] : nextAlive(s.board.alive, seat);
      if (done) s.board.phase = "vote";
    } else if (s.board.phase === "vote" && action === "vote") {
      const target = String((move as UndercoverMove).target || "") as Seat;
      s.board.votes[seat] = target;
      const done = s.board.alive.every((aliveSeat) => Boolean(s.board.votes[aliveSeat]));
      s.nextTurn = done ? s.board.alive[0] : nextAlive(s.board.alive, seat);
      if (done) {
        const tally = new Map<Seat, number>();
        for (const voted of Object.values(s.board.votes)) tally.set(voted, (tally.get(voted as Seat) || 0) + 1);
        const eliminated = [...tally.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0]?.[0];
        if (eliminated) {
          s.board.alive = s.board.alive.filter((aliveSeat) => aliveSeat !== eliminated);
          s.board.eliminated.push(eliminated);
          s.board.reveal = `${eliminated} left the table. Identity: ${s.board.roles[eliminated]}.`;
        }
        s.board.round += 1;
        s.board.phase = "clue";
        s.board.clues = {};
        s.board.votes = {};
        s.nextTurn = s.board.alive[0];
      }
    }

    s.moveCount += 1;
    const verdict = result(s);
    if (verdict.finished) {
      s.status = "finished";
      s.winner = verdict.winner;
      s.board.phase = "finished";
      s.board.reveal = verdict.reveal;
    }
    return s;
  },

  chooseBotMove(state, seat) {
    const s = state as UndercoverState;
    if (s.status !== "playing" || s.nextTurn !== seat) return null;
    if (s.board.phase === "clue") {
      const base = s.board.roles[seat] === "undercover" ? "A cosmic glow" : "A colorful night sky";
      return { action: "clue", text: `${base} ${seat}` };
    }
    return { action: "vote", target: s.board.alive.find((aliveSeat) => aliveSeat !== seat) };
  },

  snapshot(state) {
    const s = state as UndercoverState;
    return {
      ...s,
      theme: "neon-party",
    };
  },
};

export function initWhoIsUndercoverMatchState(seats: Seat[]): MatchState {
  return buildState(seats);
}
