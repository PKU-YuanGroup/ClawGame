import type { GameEngine, MatchState, Seat } from "./types.ts";

const WEREWOLF_SEATS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"] as const;

type Role = "villager" | "seer" | "doctor" | "werewolf";

interface WerewolfMove {
  action: "vote" | "night_kill" | "inspect" | "save" | "ready";
  target?: Seat;
}

interface WerewolfState extends MatchState {
  board: {
    phase: "night" | "day" | "vote" | "finished";
    round: number;
    alive: Seat[];
    eliminated: Seat[];
    rolesAssigned: boolean;
    votes: Record<Seat, Seat>;
    roleMap: Record<Seat, Role>;
    inspected?: Seat;
    protected?: Seat;
    nightKill?: Seat;
    lastReveal?: string;
  };
}

function buildRoles(seats: Seat[]): Record<Seat, Role> {
  const roles = ["werewolf", "werewolf", "seer", "doctor", "villager", "villager", "villager", "villager"] as Role[];
  const map: Record<Seat, Role> = {};
  seats.forEach((seat, index) => { map[seat] = roles[index] || "villager"; });
  return map;
}

function tallyVotes(votes: Record<string, string>, allowed: Seat[]): Seat | null {
  const tally = new Map<Seat, number>();
  for (const seat of Object.values(votes)) {
    if (!allowed.includes(seat)) continue;
    tally.set(seat, (tally.get(seat) || 0) + 1);
  }
  const ranked = [...tally.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
  return ranked[0]?.[0] || null;
}

function aliveRoleCount(state: WerewolfState, role: Role): number {
  return state.board.alive.filter((seat) => state.board.roleMap[seat] === role).length;
}

function nextAlive(state: WerewolfState, current: Seat): Seat {
  const list = state.board.alive;
  const index = list.indexOf(current);
  if (index < 0) return list[0];
  return list[(index + 1) % list.length];
}

function checkWinner(state: WerewolfState): { winner?: Seat | "draw"; status: MatchState["status"]; reveal?: string } {
  const wolves = aliveRoleCount(state, "werewolf");
  const villagers = state.board.alive.length - wolves;
  if (wolves <= 0) return { winner: "villagers", status: "finished", reveal: "Villagers eliminated every werewolf." };
  if (wolves >= villagers) return { winner: "werewolves", status: "finished", reveal: "Werewolves control the village." };
  return { status: "playing" };
}

function buildState(seats: Seat[] = []): WerewolfState {
  const activeSeats = seats.length > 0 ? [...seats] : [...WEREWOLF_SEATS];
  return {
    gameType: "werewolf",
    board: {
      phase: "night",
      round: 1,
      alive: [...activeSeats],
      eliminated: [],
      rolesAssigned: true,
      votes: {},
      roleMap: buildRoles(activeSeats),
    },
    nextTurn: activeSeats[0] || WEREWOLF_SEATS[0],
    status: activeSeats.length >= 5 ? "playing" : "waiting",
    moveCount: 0,
  };
}

export const werewolfEngine: GameEngine = {
  gameType: "werewolf",
  seats: WEREWOLF_SEATS,
  minPlayers: 5,
  maxPlayers: WEREWOLF_SEATS.length,
  rules: { seats: 8, phases: ["night", "day", "vote"], hiddenRoles: true },
  actionSchema: { type: "action", payload: { action: "night_kill|inspect|save|vote|ready", target: "string?" } },

  initState(): MatchState {
    return buildState();
  },

  validateMove(state, seat, move): void {
    const s = state as WerewolfState;
    const action = String((move as WerewolfMove)?.action || "");
    if (s.status !== "playing") throw new Error("Match is not in playing status");
    if (!s.board.alive.includes(seat)) throw new Error("Seat is eliminated");
    if (!["vote", "night_kill", "inspect", "save", "ready"].includes(action)) throw new Error("Invalid action");
    if (action !== "ready" && !String((move as WerewolfMove)?.target || "")) throw new Error("Target is required");
  },

  applyMove(state, seat, move): MatchState {
    const s = {
      ...(state as WerewolfState),
      board: {
        ...((state as WerewolfState).board),
        alive: [...((state as WerewolfState).board.alive)],
        eliminated: [...((state as WerewolfState).board.eliminated)],
        votes: { ...((state as WerewolfState).board.votes) },
        roleMap: { ...((state as WerewolfState).board.roleMap) },
      },
    } as WerewolfState;
    const action = String((move as WerewolfMove).action);
    const target = String((move as WerewolfMove).target || "") as Seat;

    if (s.board.phase === "night") {
      const role = s.board.roleMap[seat];
      if (role === "werewolf" && action === "night_kill") s.board.nightKill = target;
      if (role === "seer" && action === "inspect") s.board.inspected = target;
      if (role === "doctor" && action === "save") s.board.protected = target;
      s.board.votes[seat] = target;
      const requiredActors = s.board.alive.filter((aliveSeat) => {
        const r = s.board.roleMap[aliveSeat];
        return r === "werewolf" || r === "seer" || r === "doctor";
      });
      const done = requiredActors.every((aliveSeat) => s.board.votes[aliveSeat]);
      if (done) {
        if (s.board.nightKill && s.board.nightKill !== s.board.protected) {
          s.board.alive = s.board.alive.filter((aliveSeat) => aliveSeat !== s.board.nightKill);
          s.board.eliminated.push(s.board.nightKill);
          s.board.lastReveal = `${s.board.nightKill} was taken during the night.`;
        } else {
          s.board.lastReveal = "Dawn breaks. Everyone survives the night.";
        }
        s.board.phase = "day";
        s.board.votes = {};
        s.nextTurn = s.board.alive[0];
      } else {
        s.nextTurn = nextAlive(s, seat);
      }
    } else if (s.board.phase === "day") {
      s.board.phase = "vote";
      s.board.votes = {};
      s.nextTurn = s.board.alive[0];
    } else if (s.board.phase === "vote") {
      s.board.votes[seat] = target;
      const done = s.board.alive.every((aliveSeat) => s.board.votes[aliveSeat]);
      if (done) {
        const eliminated = tallyVotes(s.board.votes, s.board.alive);
        if (eliminated) {
          s.board.alive = s.board.alive.filter((aliveSeat) => aliveSeat !== eliminated);
          s.board.eliminated.push(eliminated);
          s.board.lastReveal = `${eliminated} was voted out. Role: ${s.board.roleMap[eliminated]}.`;
        }
        s.board.phase = "night";
        s.board.round += 1;
        s.board.votes = {};
        s.board.inspected = undefined;
        s.board.protected = undefined;
        s.board.nightKill = undefined;
        s.nextTurn = s.board.alive[0];
      } else {
        s.nextTurn = nextAlive(s, seat);
      }
    }

    s.moveCount += 1;
    const verdict = checkWinner(s);
    s.status = verdict.status;
    s.winner = verdict.winner;
    if (verdict.reveal) s.board.lastReveal = verdict.reveal;
    return s;
  },

  chooseBotMove(state, seat) {
    const s = state as WerewolfState;
    if (s.status !== "playing" || !s.board.alive.includes(seat)) return null;
    const role = s.board.roleMap[seat];
    const livingOthers = s.board.alive.filter((aliveSeat) => aliveSeat !== seat);
    if (s.board.phase === "night") {
      if (role === "werewolf") return { action: "night_kill", target: livingOthers.find((aliveSeat) => s.board.roleMap[aliveSeat] !== "werewolf") || livingOthers[0] };
      if (role === "seer") return { action: "inspect", target: livingOthers[0] };
      if (role === "doctor") return { action: "save", target: s.board.alive[s.board.alive.length - 1] };
      return { action: "ready", target: seat };
    }
    if (s.board.phase === "day") return { action: "ready", target: seat };
    return { action: "vote", target: livingOthers[0] };
  },

  snapshot(state) {
    const s = state as WerewolfState;
    return {
      ...s,
      theme: "moonlit-gothic",
    };
  },
};

export function initWerewolfMatchState(seats: Seat[]): MatchState {
  return buildState(seats);
}
