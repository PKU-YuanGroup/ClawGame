import {
  GAME_CATALOG,
  getGameRules,
  type AgentActRequest,
  type AgentActResponse,
  type AgentExitRequest,
  type AgentExitResponse,
  type AgentJoinRequest,
  type AgentJoinResponse,
  type AgentLoginRequest,
  type AgentLoginResponse,
  type AgentPollRequest,
  type AgentPollResponse,
  type ProtocolEnvelope,
  type RoomCommandRequest,
  type RoomCommandResponse,
} from "../../packages/game-protocol/src/index.ts";

declare const process: { exit(code?: number): void };

type Assertion = {
  name: string;
  ok: boolean;
  detail?: string;
};

function pass(name: string): Assertion {
  return { name, ok: true };
}

function fail(name: string, detail: string): Assertion {
  return { name, ok: false, detail };
}

function hasKeys(input: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => Object.prototype.hasOwnProperty.call(input, key));
}

function runTypeContractChecks(): Assertion[] {
  const checks: Assertion[] = [];

  const joinReq: AgentJoinRequest = {
    roomId: "ROOM1234",
    credential: "credential-token",
    inviteCode: "ABCD12",
  };
  checks.push(hasKeys(joinReq as unknown as Record<string, unknown>, ["roomId", "credential"]) ? pass("AgentJoinRequest.required-fields") : fail("AgentJoinRequest.required-fields", "missing roomId/credential"));

  const joinRes: AgentJoinResponse = {
    protocolVersion: "v1",
    roomId: "ROOM1234",
    agentId: "agent-a",
    playerId: "openclaw:agent-a",
    seat: "black",
    playerToken: "ptk",
  };
  checks.push(hasKeys(joinRes as unknown as Record<string, unknown>, ["protocolVersion", "playerToken", "seat"]) ? pass("AgentJoinResponse.required-fields") : fail("AgentJoinResponse.required-fields", "missing required fields"));

  const loginReq: AgentLoginRequest = {
    roomId: "ROOM1234",
    credential: "credential-token",
    waitMs: 30000,
  };
  checks.push(hasKeys(loginReq as unknown as Record<string, unknown>, ["roomId", "credential"]) ? pass("AgentLoginRequest.required-fields") : fail("AgentLoginRequest.required-fields", "missing roomId/credential"));

  const loginRes: AgentLoginResponse = {
    protocolVersion: "v1",
    roomId: "ROOM1234",
    gameType: "gomoku",
    seat: "black",
    playerToken: "ptk",
    status: "playing",
    ready: true,
    players: {
      me: { id: "openclaw:agent-a", seat: "black", clawName: "Agent A" },
      opponent: { id: "human-b", seat: "white", name: "Human B", openclawName: "Agent B" },
    },
  };
  checks.push(loginRes.ready === true ? pass("AgentLoginResponse.ready") : fail("AgentLoginResponse.ready", "expected ready=true"));

  const pollReq: AgentPollRequest = {
    roomId: "ROOM1234",
    credential: "credential-token",
    agentId: "agent-a",
    sinceSeq: 10,
    sinceTs: Date.now(),
    waitMs: 25000,
    playerToken: "ptk",
  };
  checks.push(hasKeys(pollReq as unknown as Record<string, unknown>, ["roomId", "credential"]) ? pass("AgentPollRequest.required-fields") : fail("AgentPollRequest.required-fields", "missing roomId/credential"));

  const pollRes: AgentPollResponse = {
    protocolVersion: "v1",
    roomId: "ROOM1234",
    ts: Date.now(),
    seq: 11,
    message: { type: "yourturn", seat: "black", state: { state: { status: "playing" } } },
    supportedMessageTypes: ["yourturn", "gameover"],
    turn: {
      yourTurn: true,
      gameOver: false,
      haltForLlm: true,
      seat: "black",
      nextTurn: "black",
      status: "playing",
    },
    connection: {
      keepAlive: true,
      shouldDisconnect: false,
      reason: "active",
    },
  };
  checks.push(pollRes.turn.haltForLlm ? pass("AgentPollResponse.turn") : fail("AgentPollResponse.turn", "expected haltForLlm=true"));

  const actReq: AgentActRequest = {
    roomId: "ROOM1234",
    credential: "credential-token",
    playerToken: "ptk",
    move: { x: 7, y: 7 },
    chatText: "hello",
    actionId: "action-1",
  };
  checks.push(hasKeys(actReq as unknown as Record<string, unknown>, ["roomId"]) ? pass("AgentActRequest.required-fields") : fail("AgentActRequest.required-fields", "missing roomId"));

  const actRes: AgentActResponse = {
    protocolVersion: "v1",
    roomId: "ROOM1234",
    actionId: "action-1",
    move: { ok: true },
    chat: null,
  };
  checks.push(actRes.actionId === "action-1" ? pass("AgentActResponse.action-id") : fail("AgentActResponse.action-id", "missing actionId"));

  const exitReq: AgentExitRequest = {
    roomId: "ROOM1234",
    credential: "credential-token",
    playerToken: "ptk",
    waitMs: 20000,
  };
  checks.push(hasKeys(exitReq as unknown as Record<string, unknown>, ["roomId", "credential"]) ? pass("AgentExitRequest.required-fields") : fail("AgentExitRequest.required-fields", "missing roomId/credential"));

  const exitRes: AgentExitResponse = {
    ok: true,
    next: "continue_poll",
    reason: "rematch_pending",
  };
  checks.push(exitRes.next === "continue_poll" ? pass("AgentExitResponse.next") : fail("AgentExitResponse.next", "unexpected next"));

  const roomCommand: RoomCommandRequest = {
    protocolVersion: "v1",
    roomId: "ROOM1234",
    actorType: "openclaw",
    actorId: "openclaw:agent-a",
    playerToken: "ptk",
    actionId: "action-1",
    command: {
      kind: "move",
      move: { x: 7, y: 7 },
    },
  };
  checks.push(roomCommand.command.kind === "move" ? pass("RoomCommandRequest.kind") : fail("RoomCommandRequest.kind", "unexpected command kind"));

  const roomResponse: RoomCommandResponse = {
    protocolVersion: "v1",
    roomId: "ROOM1234",
    ok: true,
    seq: 11,
    state: { status: "playing" },
  };
  checks.push(roomResponse.protocolVersion === "v1" ? pass("RoomCommandResponse.protocol-version") : fail("RoomCommandResponse.protocol-version", "protocol version mismatch"));

  const envelope: ProtocolEnvelope<{ event: string }> = {
    type: "state_update",
    roomId: "ROOM1234",
    gameType: "gomoku",
    protocolVersion: "v1",
    seq: 12,
    ts: Date.now(),
    payload: { event: "state_update" },
  };
  checks.push(envelope.protocolVersion === "v1" ? pass("ProtocolEnvelope.protocol-version") : fail("ProtocolEnvelope.protocol-version", "protocol version mismatch"));

  return checks;
}

function runCatalogChecks(): Assertion[] {
  const checks: Assertion[] = [];
  const games = Object.keys(GAME_CATALOG);

  if (games.length < 5) {
    checks.push(fail("GAME_CATALOG.min-size", `expected >=5 games, got ${games.length}`));
  } else {
    checks.push(pass("GAME_CATALOG.min-size"));
  }

  for (const gameType of games) {
    const rules = getGameRules(gameType, []);
    const hasObjective = typeof (rules as Record<string, unknown>).objective === "string";
    checks.push(hasObjective ? pass(`GAME_CATALOG.${gameType}.objective`) : fail(`GAME_CATALOG.${gameType}.objective`, "objective is missing"));

    const events = (rules as Record<string, unknown>).recommendedEvents;
    const isArray = Array.isArray(events);
    checks.push(isArray ? pass(`GAME_CATALOG.${gameType}.recommendedEvents`) : fail(`GAME_CATALOG.${gameType}.recommendedEvents`, "recommendedEvents must be array"));
  }

  return checks;
}

function main(): void {
  const checks = [...runTypeContractChecks(), ...runCatalogChecks()];
  const failed = checks.filter((item) => !item.ok);

  for (const check of checks) {
    if (check.ok) {
      console.log(`PASS ${check.name}`);
    } else {
      console.error(`FAIL ${check.name}: ${check.detail || "unknown error"}`);
    }
  }

  if (failed.length > 0) {
    console.error(`Protocol contract checks failed: ${failed.length}`);
    process.exit(1);
  }

  console.log(`Protocol contract checks passed: ${checks.length}`);
}

main();
