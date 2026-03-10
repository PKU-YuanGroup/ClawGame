import { getEngine } from "./games/registry";
import type { MatchPlayer, MatchState, Seat } from "./games/types";
import type { Env } from "./types";
import type { ProtocolEnvelope } from "@openclaw/game-protocol";
import { storeDelete } from "./lib/store";

export type RoomVisibility = "public" | "private";

export interface RoomSnapshot {
  roomId: string;
  gameType: string;
  visibility: RoomVisibility;
  ownerId?: string;
  players: Omit<MatchPlayer, "token">[];
  state: unknown;
  rematch?: {
    votes: Record<string, boolean>;
    closed?: boolean;
  };
}

interface ChatMessage {
  id: string;
  seq: number;
  senderType: "user" | "openclaw" | "spectator" | "system";
  senderId: string;
  text: string;
  ts: number;
}

interface RoomData {
  roomId: string;
  gameType: string;
  visibility: RoomVisibility;
  ownerId?: string;
  inviteCode?: string;
  players: MatchPlayer[];
  state: MatchState;
  chats: ChatMessage[];
  eventSeq: number;
  createdAt: number;
  agentLastSeenAt?: number;
  rematch?: {
    votes: Record<string, boolean>;
    closed?: boolean;
  };
}

interface WsMeta {
  role: "agent" | "player" | "spectator";
  player?: MatchPlayer;
  viewerId?: string;
}

const ROOM_KEY = "room:data";
const EMPTY_ROOM_TTL_MS = 2 * 60 * 1000;
const AGENT_IDLE_TTL_MS = 3 * 60 * 1000;
const TURN_TIMEOUT_MS = 30_000;
const BOT_MOVE_DELAY_MS = 1200;

export class GameRoomDO {
  private sockets = new Map<WebSocket, WsMeta>();
  private seq = 0;
  private botLoopRunning = false;

  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (request.method === "POST" && url.pathname === "/init") return await this.init(request);
      if (request.method === "POST" && url.pathname === "/join") return await this.join(request);
      if (request.method === "POST" && url.pathname === "/move") return await this.move(request);
      if (request.method === "POST" && url.pathname === "/leave") return await this.leave(request);
      if (request.method === "POST" && url.pathname === "/rematch") return await this.rematch(request);
      if (request.method === "POST" && url.pathname === "/owner/transfer") return await this.transferOwner(request);
      if (request.method === "POST" && url.pathname === "/room/reset") return await this.resetRoom(request);
      if (request.method === "POST" && url.pathname === "/room/leave") return await this.leaveRoomByRequester(request);
      if (request.method === "POST" && url.pathname === "/room/join-bot") return await this.joinBotByRequester(request);
      if (request.method === "GET" && url.pathname === "/state") return await this.stateView();
      if (request.method === "GET" && url.pathname === "/online") return await this.onlineView();
      if (request.method === "GET" && url.pathname === "/chat") return await this.chatList();
      if (request.method === "POST" && url.pathname === "/chat") return await this.chatSend(request);
      if (request.method === "POST" && url.pathname === "/agent/touch") return await this.agentTouch();
      if (request.method === "POST" && url.pathname === "/agent/player-token") return await this.agentPlayerToken(request);
      if (request.method === "GET" && url.pathname === "/ws") return await this.connectWs(request);
      return json({ error: "Not Found" }, 404);
    } catch (err) {
      return json({ error: (err as Error).message }, 400);
    }
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    try {
      const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
      const msg = JSON.parse(raw) as { type: string; payload?: any };
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        void this.tickTimeoutByHeartbeat();
        return;
      }
      if (msg.type === "submit_action") {
        void this.handleSubmitAction(ws, msg.payload ?? {});
        return;
      }
      if (msg.type === "chat_send") {
        void this.handleChatSendWs(ws, msg.payload ?? {});
        return;
      }
      if (msg.type === "join_game") {
        void this.handleJoinGameWs(ws, msg.payload ?? {});
        return;
      }
      if (msg.type === "leave_game") {
        void this.handleLeaveGameWs(ws);
        return;
      }
      if (msg.type === "join_bot") {
        void this.handleJoinBotWs(ws);
        return;
      }
      if (msg.type === "remove_bot") {
        void this.handleRemoveBotWs(ws, msg.payload ?? {});
      }
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "invalid message" }));
    }
  }

  webSocketClose(ws: WebSocket): void {
    this.sockets.delete(ws);
    void this.pushOnlineUpdate();
    if (this.sockets.size === 0) {
      void this.cleanupWhenRoomEmpty();
    }
  }

  async alarm(): Promise<void> {
    if (this.sockets.size > 0) return;
    const data = await this.load();
    if (!data) return;
    await this.state.storage.delete(ROOM_KEY);
    await storeDelete(this.env, `lobby:${data.roomId}`);
  }

  private async cleanupWhenRoomEmpty(): Promise<void> {
    if (this.sockets.size > 0) return;
    await this.scheduleEmptyRoomCleanup();
  }

  private async connectWs(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const token = url.searchParams.get("token") || "";
    const role = (url.searchParams.get("role") as WsMeta["role"]) || "agent";
    const viewerId = url.searchParams.get("viewerId") || undefined;
    if (!["agent", "player", "spectator"].includes(role)) throw new Error("invalid role");

    const data = await this.requireRoom();
    const player = data.players.find((p) => p.token === token);
    if (role !== "spectator" && !player) throw new Error("invalid ws token");

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.state.acceptWebSocket(server);
    this.sockets.set(server, { role, player, viewerId });
    await this.cancelEmptyRoomCleanup();
    if (role === "agent") {
      data.agentLastSeenAt = Date.now();
      await this.save(data);
    }

    server.send(JSON.stringify(this.envelope(data, "hello", {
      role,
      seat: player?.seat,
      capabilities: ["submit_action", "ping"],
      rules: this.rulesFor(data.gameType),
    })));
    server.send(JSON.stringify(this.envelope(data, "sync_state", this.toSnapshot(data))));
    server.send(JSON.stringify(this.envelope(data, "chat_history", { messages: (data.chats || []).slice(-100) })));
    server.send(JSON.stringify(this.envelope(data, "online_update", this.currentOnline(data))));

    if (player && data.state.status === "playing" && data.state.nextTurn === player.seat) {
      server.send(JSON.stringify(this.envelope(data, "your_turn", {
        seat: player.seat,
        legalAction: this.actionSchema(data.gameType),
      })));
    }

    void this.pushOnlineUpdate();
    return new Response(null, { status: 101, webSocket: client });
  }

  private async scheduleEmptyRoomCleanup(): Promise<void> {
    await this.state.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS);
  }

  private async cancelEmptyRoomCleanup(): Promise<void> {
    const at = await this.state.storage.getAlarm();
    if (at !== null) await this.state.storage.deleteAlarm();
  }

  private async agentTouch(): Promise<Response> {
    const data = await this.requireRoom();
    this.pruneInactiveAgent(data);
    data.agentLastSeenAt = Date.now();
    await this.save(data);
    return json({ ok: true, ts: data.agentLastSeenAt });
  }

  private async agentPlayerToken(request: Request): Promise<Response> {
    const data = await this.requireRoom();
    const body = (await request.json()) as { playerId?: string };
    const playerId = String(body?.playerId || "").trim();
    if (!playerId) return json({ error: "playerId is required" }, 400);
    const player = data.players.find((p) => p.id === playerId);
    if (!player) return json({ error: "player not found" }, 404);
    return json({ ok: true, playerId: player.id, playerToken: player.token, seat: player.seat });
  }

  private pruneInactiveAgent(data: RoomData): boolean {
    if (!data.agentLastSeenAt) return false;
    if (Date.now() - data.agentLastSeenAt < AGENT_IDLE_TTL_MS) return false;

    const before = data.players.length;
    const inactiveParticipants = new Set(
      data.players
        .filter((p) => p.id.startsWith("openclaw:"))
        .map((p) => this.normalizeParticipantId(p.id)),
    );

    data.players = data.players.filter((p) => {
      if (p.id.startsWith("openclaw:")) return false;
      // If an OpenClaw bot side times out, also prune its paired bot player.
      if (this.isBotUserId(p.id) && inactiveParticipants.has(p.id)) return false;
      return true;
    });

    if (data.players.length < before) {
      if ((data.state as any).status === "playing" && this.humanPlayerCount(data) < 2) {
        (data.state as any).status = "waiting";
      }
      data.agentLastSeenAt = undefined;
      return true;
    }
    return false;
  }

  private rulesFor(gameType: string): unknown {
    if (gameType === "gomoku") {
      return { boardSize: 15, winCondition: "five_in_a_row", first: "black" };
    }
    if (gameType === "xiangqi") {
      return { board: "9x10", notation: "a0-i9", objective: "checkmate", first: "black" };
    }
    if (gameType === "go") {
      return { boardSize: 19, komi: 6.5, objective: "territory", passEndsAfter: 2, first: "black" };
    }
    if (gameType === "chess") {
      return { board: "8x8", notation: "a1-h8", objective: "checkmate", castling: true, enPassant: true, first: "black" };
    }
    if (gameType === "texas_holdem") {
      return { seats: 6, blinds: { small: 5, big: 10 }, streets: ["preflop", "flop", "turn", "river", "showdown"] };
    }
    if (gameType === "werewolf") {
      return { seats: 8, phases: ["night", "day", "vote"], hiddenRoles: true };
    }
    if (gameType === "junqi") {
      return { board: "5x6", objective: "capture_flag", first: "red" };
    }
    if (gameType === "who_is_undercover") {
      return { seats: 8, phases: ["clue", "vote"], hiddenWords: true };
    }
    return {};
  }

  private actionSchema(gameType: string): unknown {
    if (gameType === "gomoku") return { type: "move", payload: { x: "number", y: "number" } };
    if (gameType === "xiangqi") return { type: "move", payload: { from: "string", to: "string" } };
    if (gameType === "go") return { type: "move", payload: { x: "number", y: "number", pass: "boolean?" } };
    if (gameType === "chess") return { type: "move", payload: { from: "string", to: "string", promotion: "string?" } };
    if (gameType === "texas_holdem") return { type: "action", payload: { action: "fold|check|call|raise", amount: "number?" } };
    if (gameType === "werewolf") return { type: "action", payload: { action: "night_kill|inspect|save|vote|ready", target: "string?" } };
    if (gameType === "junqi") return { type: "move", payload: { from: "string", to: "string" } };
    if (gameType === "who_is_undercover") return { type: "action", payload: { action: "clue|vote", text: "string?", target: "string?" } };
    return { type: "move", payload: {} };
  }

  private async handleSubmitAction(ws: WebSocket, payload: any): Promise<void> {
    const meta = this.sockets.get(ws);
    if (!meta?.player) {
      ws.send(JSON.stringify({ type: "error", message: "unauthorized socket" }));
      return;
    }

    const data = await this.requireRoom();
    const engine = getEngine(data.gameType);

    try {
      engine.validateMove(data.state, meta.player.seat, payload.move);
      data.state = engine.applyMove(data.state, meta.player.seat, payload.move);
      data.eventSeq = (data.eventSeq || 0) + 1;
      await this.save(data);

      this.broadcast(data, "action_result", {
        ok: true,
        bySeat: meta.player.seat,
        move: payload.move,
      });
      this.broadcast(data, "state_update", this.toSnapshot(data));

      if (data.state.status === "finished") {
        this.broadcast(data, "game_over", {
          winner: data.state.winner ?? "draw",
          moveCount: data.state.moveCount,
        });
      } else {
        this.broadcastTurnPrompt(data);
      }
    } catch (err) {
      ws.send(JSON.stringify(this.envelope(data, "action_result", {
        ok: false,
        error: (err as Error).message,
      })));
    }
  }

  private async handleChatSendWs(ws: WebSocket, payload: any): Promise<void> {
    const meta = this.sockets.get(ws);
    if (!meta) return;
    const data = await this.requireRoom();
    const viewerId = String(meta.viewerId || "");
    const isOwnerSpectator = meta.role === "spectator" && Boolean(viewerId) && viewerId === data.ownerId;
    if (meta.role === "spectator" && !isOwnerSpectator) {
      ws.send(JSON.stringify({ type: "error", message: "spectator cannot chat" }));
      return;
    }
    const text = String(payload?.text ?? "").trim();
    if (!text) return;

    const senderType: ChatMessage["senderType"] = meta.role === "agent" ? "openclaw" : "user";
    const senderId = meta.player?.id ?? viewerId ?? "guest";

    data.eventSeq = (data.eventSeq || 0) + 1;
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      seq: data.eventSeq,
      senderType,
      senderId,
      text: text.slice(0, 400),
      ts: Date.now(),
    };
    if (!Array.isArray(data.chats)) data.chats = [];
    data.chats.push(msg);
    data.chats = data.chats.slice(-100);
    await this.save(data);
    this.broadcast(data, "chat", msg);
  }

  private async handleJoinGameWs(ws: WebSocket, payload: any): Promise<void> {
    const meta = this.sockets.get(ws);
    if (!meta) return;
    const data = await this.requireRoom();

    const payloadPlayerId = String(payload?.playerId || "").trim();
    const viewerId = String(meta.viewerId || "").trim();
    const defaultId = viewerId && !viewerId.startsWith("guest") ? `openclaw:${viewerId}` : viewerId;
    const candidateId = payloadPlayerId || meta.player?.id || defaultId;

    if (!candidateId || candidateId.startsWith("guest")) {
      ws.send(JSON.stringify(this.envelope(data, "action_result", { kind: "join_game", ok: false, error: "login required" })));
      return;
    }
    if (viewerId && !viewerId.startsWith("guest") && payloadPlayerId) {
      const allowedIds = new Set([viewerId, `openclaw:${viewerId}`]);
      if (!allowedIds.has(payloadPlayerId)) {
        ws.send(JSON.stringify(this.envelope(data, "action_result", { kind: "join_game", ok: false, error: "viewer mismatch" })));
        return;
      }
    }

    try {
      const joined = await this.joinByPlayerId(data, candidateId, payload?.inviteCode);
      meta.player = { id: candidateId, seat: joined.seat, token: joined.playerToken };
      if (!candidateId.startsWith("openclaw:")) {
        meta.role = "player";
      }
      this.sockets.set(ws, meta);
      ws.send(JSON.stringify(this.envelope(data, "action_result", {
        kind: "join_game",
        ok: true,
        playerToken: joined.playerToken,
        seat: joined.seat,
        playerId: candidateId,
      })));
    } catch (err) {
      ws.send(JSON.stringify(this.envelope(data, "action_result", { kind: "join_game", ok: false, error: (err as Error).message })));
    }
  }

  private async handleLeaveGameWs(ws: WebSocket): Promise<void> {
    const meta = this.sockets.get(ws);
    if (!meta) return;
    const data = await this.requireRoom();
    const playerId = meta.player?.id || meta.viewerId;
    if (!playerId) return;

    await this.removeParticipantById(data, playerId);
    meta.player = undefined;
    meta.role = "spectator";
    this.sockets.set(ws, meta);
    ws.send(JSON.stringify(this.envelope(data, "action_result", { kind: "leave_game", ok: true, playerId })));
  }

  private async handleJoinBotWs(ws: WebSocket): Promise<void> {
    const meta = this.sockets.get(ws);
    if (!meta) return;
    const data = await this.requireRoom();

    if (!meta.viewerId || meta.viewerId.startsWith("guest")) {
      ws.send(JSON.stringify(this.envelope(data, "action_result", { kind: "join_bot", ok: false, error: "login required" })));
      return;
    }

    const ownerId = meta.viewerId;

    const engine = getEngine(data.gameType);
    if (!engine.chooseBotMove) {
      ws.send(JSON.stringify(this.envelope(data, "action_result", { kind: "join_bot", ok: false, error: "bot not supported for this game yet" })));
      return;
    }

    // Keep the owner participant in room when adding bot; dropping owner+OpenClaw here
    // causes an unexpected disconnect from both player and agent lists.

    const existingBotIds = new Set(
      data.players
        .map((p) => p.id)
        .filter((id) => id.startsWith(`bot:${ownerId}:`)),
    );
    let index = 1;
    while (existingBotIds.has(`bot:${ownerId}:${index}`)) index += 1;

    const botUserId = `bot:${ownerId}:${index}`;
    const botOpenclawId = `openclaw:${botUserId}`;
    try {
      const joined = await this.joinByPlayerId(data, botUserId);
      await this.joinByPlayerId(data, botOpenclawId);
      if (meta.role !== "player") {
        meta.role = "spectator";
        meta.player = undefined;
        this.sockets.set(ws, meta);
      }
      ws.send(JSON.stringify(this.envelope(data, "action_result", {
        kind: "join_bot",
        ok: true,
        botId: botUserId,
        seat: joined.seat,
      })));
      await this.runBotTurns(data);
    } catch (err) {
      ws.send(JSON.stringify(this.envelope(data, "action_result", { kind: "join_bot", ok: false, error: (err as Error).message })));
    }
  }

  private async handleRemoveBotWs(ws: WebSocket, payload: any): Promise<void> {
    const meta = this.sockets.get(ws);
    if (!meta) return;
    const data = await this.requireRoom();

    try {
      const ownerId = String(meta.viewerId || "");
      if (!ownerId || ownerId.startsWith("guest")) {
        ws.send(JSON.stringify(this.envelope(data, "action_result", { kind: "remove_bot", ok: false, error: "login required" })));
        return;
      }

      if (String((data.state as any)?.status || "") !== "waiting") {
        ws.send(JSON.stringify(this.envelope(data, "action_result", { kind: "remove_bot", ok: false, error: "can only remove bot before game starts" })));
        return;
      }

      const isRoomOwner = ownerId === String(data.ownerId || "");
      const allBotIds = data.players
        .map((p) => p.id)
        .filter((id) => id.startsWith("bot:"));
      const ownedBotIds = allBotIds.filter((id) => id.startsWith(`bot:${ownerId}:`));
      const removableBotIds = isRoomOwner ? allBotIds : ownedBotIds;

      if (!removableBotIds.length) {
        ws.send(JSON.stringify(this.envelope(data, "action_result", { kind: "remove_bot", ok: false, error: "bot not found" })));
        return;
      }

      const requestedBotId = String(payload?.botId || "").trim();
      let targetBotId = "";
      if (requestedBotId) {
        const requestedParticipantId = this.normalizeParticipantId(requestedBotId);
        const matched = removableBotIds.find((id) => this.normalizeParticipantId(id) === requestedParticipantId);
        if (!matched) {
          ws.send(JSON.stringify(this.envelope(data, "action_result", { kind: "remove_bot", ok: false, error: "forbidden bot" })));
          return;
        }
        targetBotId = matched;
      } else {
        targetBotId = removableBotIds.sort((a, b) => {
          const ai = Number(a.split(":").pop() || 0);
          const bi = Number(b.split(":").pop() || 0);
          return bi - ai;
        })[0];
      }

      const participantId = this.normalizeParticipantId(targetBotId);
      const before = data.players.length;
      data.players = data.players.filter((p) => this.normalizeParticipantId(p.id) !== participantId);

      for (const [socket, socketMeta] of this.sockets.entries()) {
        if (!socketMeta.player) continue;
        if (this.normalizeParticipantId(socketMeta.player.id) !== participantId) continue;
        socketMeta.player = undefined;
        if (socketMeta.role !== "agent") socketMeta.role = "spectator";
        this.sockets.set(socket, socketMeta);
      }

      if (!data.rematch) data.rematch = { votes: {}, closed: false };
      delete data.rematch.votes[participantId];

      const readyParticipants = this.readyParticipantCount(data);
      if (readyParticipants < 2) {
        (data.state as any).status = "waiting";
      }
      if (!data.players.some((p) => p.id.startsWith("openclaw:"))) {
        data.agentLastSeenAt = undefined;
      }

      if (data.players.length === 0) {
        // Keep an empty room snapshot for connected spectators; cleanup runs when sockets drain.
        await storeDelete(this.env, `lobby:${data.roomId}`);
      }
      await this.save(data);
      this.broadcast(data, "state_update", this.toSnapshot(data));
      this.broadcast(data, "online_update", this.currentOnline(data));

      ws.send(JSON.stringify(this.envelope(data, "action_result", {
        kind: "remove_bot",
        ok: before !== data.players.length,
        botId: targetBotId,
        removedCount: Math.max(0, before - data.players.length),
      })));
    } catch (err) {
      ws.send(JSON.stringify(this.envelope(data, "action_result", { kind: "remove_bot", ok: false, error: (err as Error).message || "remove bot failed" })));
    }
  }

  private async pushOnlineUpdate(): Promise<void> {
    const data = await this.load();
    if (!data) return;
    this.broadcast(data, "online_update", this.currentOnline(data));
  }

  private currentOnline(data: RoomData): { users: Array<{ id: string; seat: string }>; openclaw: Array<{ id: string; seat: string }>; spectators: Array<{ id: string }> } {
    const userMap = new Map<string, { id: string; seat: string }>();
    const openclawMap = new Map<string, { id: string; seat: string }>();
    const spectatorMap = new Map<string, { id: string }>();
    const activePlayerIds = new Set(data.players.map((p) => p.id));
    const playerById = new Map(data.players.map((p) => [p.id, p] as const));
    const participantIsReady = (participantId: string): boolean => {
      if (!participantId || participantId.startsWith("openclaw:")) return false;
      if (!playerById.has(participantId)) return false;
      if (this.isBotUserId(participantId)) return true;
      return playerById.has(`openclaw:${participantId}`);
    };

    for (const p of data.players) {
      if (p.id.startsWith("openclaw:")) {
        openclawMap.set(p.id, { id: p.id, seat: p.seat });
      }
    }

    for (const [, meta] of this.sockets.entries()) {
      const viewerId = String(meta.viewerId || "");
      const activeSocketPlayer = meta.player?.id && activePlayerIds.has(meta.player.id) ? meta.player : undefined;
      const viewerParticipant = viewerId ? playerById.get(viewerId) : undefined;

      if (meta.role === "player" && activeSocketPlayer && participantIsReady(activeSocketPlayer.id)) {
        userMap.set(activeSocketPlayer.id, { id: activeSocketPlayer.id, seat: activeSocketPlayer.seat });
        spectatorMap.delete(activeSocketPlayer.id);
        continue;
      }

      if (meta.role === "agent" && activeSocketPlayer) {
        openclawMap.set(activeSocketPlayer.id, { id: activeSocketPlayer.id, seat: activeSocketPlayer.seat });
        spectatorMap.delete(activeSocketPlayer.id);
        continue;
      }

      // A seated human may temporarily reconnect as a spectator socket before
      // the UI finishes upgrading the role; keep them in the player list and
      // avoid showing them as their own spectator duplicate.
      if (viewerParticipant && !viewerParticipant.id.startsWith("openclaw:") && participantIsReady(viewerParticipant.id)) {
        userMap.set(viewerParticipant.id, { id: viewerParticipant.id, seat: viewerParticipant.seat });
        spectatorMap.delete(viewerParticipant.id);
        continue;
      }

      const id = viewerId || `guest_${Math.random().toString(36).slice(2, 8)}`;
      if (!userMap.has(id) && !openclawMap.has(id)) {
        spectatorMap.set(id, { id });
      }
    }

    return {
      users: [...userMap.values()],
      openclaw: [...openclawMap.values()],
      spectators: [...spectatorMap.values()].filter((u) => !userMap.has(u.id) && !openclawMap.has(u.id)),
    };
  }

  private broadcastTurnPrompt(data: RoomData): void {
    for (const [ws, meta] of this.sockets.entries()) {
      if (meta.player && meta.player.seat === data.state.nextTurn) {
        ws.send(JSON.stringify(this.envelope(data, "your_turn", {
          seat: data.state.nextTurn,
          legalAction: this.actionSchema(data.gameType),
        })));
      }
    }
  }

  private broadcast(data: RoomData, type: string, payload: unknown): void {
    const msg = JSON.stringify(this.envelope(data, type, payload));
    for (const ws of this.sockets.keys()) {
      ws.send(msg);
    }
  }

  private envelope<T>(data: RoomData, type: string, payload: T): ProtocolEnvelope<T> {
    this.seq += 1;
    return {
      type,
      roomId: data.roomId,
      gameType: data.gameType,
      protocolVersion: "v1",
      seq: this.seq,
      ts: Date.now(),
      payload,
    };
  }

  private async load(): Promise<RoomData | null> {
    return (await this.state.storage.get<RoomData>(ROOM_KEY)) ?? null;
  }

  private async save(data: RoomData): Promise<void> {
    await this.state.storage.put(ROOM_KEY, data);
  }

  private async init(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      roomId: string;
      gameType: string;
      creatorId: string;
      visibility?: RoomVisibility;
      inviteCode?: string;
    };
    const existing = await this.load();
    if (existing) return json({ error: "Room already initialized" }, 409);

    const engine = getEngine(body.gameType);

    const data: RoomData = {
      roomId: body.roomId,
      gameType: body.gameType,
      visibility: body.visibility ?? "public",
      ownerId: body.creatorId,
      inviteCode: body.inviteCode,
      players: [],
      state: engine.initState(),
      chats: [],
      eventSeq: 0,
      createdAt: Date.now(),
      rematch: { votes: {}, closed: false },
    };

    await this.save(data);
    await this.scheduleEmptyRoomCleanup();
    return json({ ok: true });
  }

  private gameMaxParticipants(gameType: string): number {
    const engine = getEngine(gameType);
    return Number(engine.maxPlayers || engine.seats?.length || 2);
  }

  private gameMinParticipants(gameType: string): number {
    const engine = getEngine(gameType);
    return Number(engine.minPlayers || 2);
  }

  private normalizeParticipantId(id: string): string {
    return id.startsWith("openclaw:") ? id.slice("openclaw:".length) : id;
  }

  private nextSeatFor(data: RoomData): Seat {
    const engine = getEngine(data.gameType);
    if (engine.seats?.length) {
      const used = new Set(data.players.map((p) => p.seat));
      const next = engine.seats.find((seat) => !used.has(seat));
      if (next) return next;
    }
    const used = new Set(data.players.map((p) => p.seat));
    return used.has("black") ? "white" : "black";
  }

  private participantCount(data: RoomData): number {
    return new Set(data.players.map((p) => this.normalizeParticipantId(p.id))).size;
  }

  private humanPlayerCount(data: RoomData): number {
    return data.players.filter((p) => !p.id.startsWith("openclaw:")).length;
  }

  private isBotUserId(id: string): boolean {
    return id.startsWith("bot:");
  }

  private readyParticipantCount(data: RoomData): number {
    const participants = new Set(
      data.players
        .filter((p) => !p.id.startsWith("openclaw:"))
        .map((p) => this.normalizeParticipantId(p.id)),
    );

    let ready = 0;
    for (const participantId of participants) {
      const hasUser = data.players.some((p) => p.id === participantId);
      const hasOpenclaw = data.players.some((p) => p.id === `openclaw:${participantId}`);
      if (!hasUser || !hasOpenclaw) continue;

      if (this.isBotUserId(participantId)) {
        ready += 1;
        continue;
      }

      const userSocketOnline = Array.from(this.sockets.values()).some((meta) => {
        const viewerId = String(meta.viewerId || "");
        if (viewerId && this.normalizeParticipantId(viewerId) === participantId) return true;
        if (meta.role === "player" && meta.player?.id) {
          return this.normalizeParticipantId(meta.player.id) === participantId;
        }
        return false;
      });

      // For agent-vs-agent/debug flows, a participant with bound OpenClaw seat
      // should be considered ready even without an active browser socket.
      if (userSocketOnline || hasOpenclaw) ready += 1;
    }

    return ready;
  }

  private addSystemChat(data: RoomData, text: string): ChatMessage | null {
    if (!text.trim()) return null;
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      seq: (data.eventSeq || 0) + 1,
      senderType: "system",
      senderId: "system",
      text,
      ts: Date.now(),
    };
    data.eventSeq = msg.seq;
    data.chats.push(msg);
    if (data.chats.length > 200) data.chats = data.chats.slice(-200);
    return msg;
  }

  private ensureClockState(data: RoomData): any {
    const state: any = data.state as any;
    if (!state.clock) state.clock = { turnTimeoutMs: TURN_TIMEOUT_MS, remainingMs: {}, turnStartedAt: Date.now() };
    if (!state.clock.remainingMs) state.clock.remainingMs = {};
    state.clock.turnTimeoutMs = Number(state.clock.turnTimeoutMs || TURN_TIMEOUT_MS);
    const seats = Array.from(new Set(data.players.map((p) => p.seat).filter(Boolean)));
    for (const seat of seats) {
      if (typeof state.clock.remainingMs[seat] !== "number") {
        state.clock.remainingMs[seat] = state.clock.turnTimeoutMs;
      }
    }
    if (typeof state.clock.turnStartedAt !== "number") {
      state.clock.turnStartedAt = Date.now();
    }
    return state.clock;
  }

  private getOpponentSeat(data: RoomData, seat: string): string | undefined {
    const seats = Array.from(new Set(data.players.map((p) => p.seat).filter(Boolean)));
    const engineSeats = getEngine(data.gameType).seats;
    if (engineSeats?.length) {
      const currentIndex = engineSeats.indexOf(seat);
      if (currentIndex >= 0) {
        for (let offset = 1; offset < engineSeats.length; offset++) {
          const candidate = engineSeats[(currentIndex + offset) % engineSeats.length];
          if (seats.includes(candidate)) return candidate;
        }
      }
    }
    return seats.find((s) => s !== seat);
  }

  private resetTurnClockForNext(data: RoomData): void {
    const state: any = data.state as any;
    const clock = this.ensureClockState(data);
    const nextSeat = String(state.nextTurn || "");
    if (!nextSeat) return;
    clock.remainingMs[nextSeat] = Number(clock.turnTimeoutMs || TURN_TIMEOUT_MS);
    clock.turnStartedAt = Date.now();
  }

  private applyTurnTimeout(data: RoomData): boolean {
    const state: any = data.state as any;
    if (state.status !== "playing") return false;

    const clock = this.ensureClockState(data);
    const currentSeat = String(state.nextTurn || "");
    if (!currentSeat) return false;

    const now = Date.now();
    const startedAt = Number(clock.turnStartedAt || now);
    const elapsed = Math.max(0, now - startedAt);
    const remaining = Number(clock.remainingMs[currentSeat] ?? clock.turnTimeoutMs ?? TURN_TIMEOUT_MS) - elapsed;
    clock.remainingMs[currentSeat] = remaining;
    clock.turnStartedAt = now;

    if (remaining > 0) return false;

    state.status = "finished";
    state.winner = this.getOpponentSeat(data, currentSeat) || "draw";
    state.finishReason = "timeout";
    data.rematch = { votes: {}, closed: false };
    const systemMsg = this.addSystemChat(data, `${currentSeat} timed out. ${state.winner} wins.`);
    if (systemMsg) this.broadcast(data, "chat", systemMsg);
    this.broadcast(data, "game_over", {
      winner: state.winner,
      reason: "timeout",
      moveCount: Number(state.moveCount || 0),
    });
    return true;
  }

  private async tickTimeoutByHeartbeat(): Promise<void> {
    const data = await this.load();
    if (!data) return;
    const changed = this.applyTurnTimeout(data);
    if (!changed) return;
    await this.save(data);
    this.broadcast(data, "state_update", this.toSnapshot(data));
  }

  private async joinByPlayerId(data: RoomData, playerId: string, inviteCode?: string): Promise<{ playerToken: string; seat: Seat }> {
    if (data.visibility === "private" && data.inviteCode && data.inviteCode !== inviteCode) {
      throw new Error("Invalid invite code");
    }

    const existed = data.players.find((p) => p.id === playerId);
    if (existed) {
      if (playerId.startsWith("openclaw:")) {
        data.agentLastSeenAt = Date.now();
        await this.save(data);
      }
      return { playerToken: existed.token, seat: existed.seat };
    }

    const participantId = this.normalizeParticipantId(playerId);
    const participantCount = this.participantCount(data);
    const hasParticipant = data.players.some((p) => this.normalizeParticipantId(p.id) === participantId);
    const maxParticipants = this.gameMaxParticipants(data.gameType);
    if (!hasParticipant && participantCount >= maxParticipants) throw new Error("Room is full");

    const seat = playerId.startsWith("openclaw:")
      ? (data.players.find((p) => this.normalizeParticipantId(p.id) === participantId)?.seat || this.nextSeatFor(data))
      : this.nextSeatFor(data);

    const token = crypto.randomUUID();
    data.players.push({ id: playerId, seat, token });
    if (playerId.startsWith("openclaw:")) data.agentLastSeenAt = Date.now();
    this.bindViewerParticipantIfPresent(data, playerId, seat);

    const readyParticipants = this.readyParticipantCount(data);
    if (readyParticipants >= this.gameMinParticipants(data.gameType) && data.state.status === "waiting") {
      data.state.status = "playing";
      const clock = this.ensureClockState(data);
      clock.turnStartedAt = Date.now();
      const systemMsg = this.addSystemChat(data, "Game started. Public chat window opened for OpenClaw banter.");
      if (systemMsg) this.broadcast(data, "chat", systemMsg);
    }

    await this.save(data);
    this.broadcast(data, "state_update", this.toSnapshot(data));
    this.broadcast(data, "online_update", this.currentOnline(data));
    if ((data.state as any).status === "playing") {
      await this.runBotTurns(data);
    }
    return { playerToken: token, seat };
  }

  private bindViewerParticipantIfPresent(data: RoomData, playerId: string, seat: Seat): void {
    if (!playerId.startsWith("openclaw:")) return;

    const participantId = this.normalizeParticipantId(playerId);
    if (!participantId || participantId.startsWith("bot:")) return;

    const matchingSockets = Array.from(this.sockets.entries()).filter(([, meta]) => String(meta.viewerId || "") === participantId);
    if (matchingSockets.length === 0) return;

    const hasHumanPlayer = data.players.some((p) => p.id === participantId);
    if (!hasHumanPlayer) {
      data.players.push({ id: participantId, seat, token: crypto.randomUUID() });
    }

    for (const [socket, meta] of matchingSockets) {
      meta.role = "player";
      if (!meta.player || meta.player.id !== participantId) {
        const player = data.players.find((p) => p.id === participantId);
        if (player) meta.player = player;
      }
      this.sockets.set(socket, meta);
    }
  }

  private async removeParticipantById(data: RoomData, participantPlayerId: string): Promise<boolean> {
    const participantId = this.normalizeParticipantId(participantPlayerId);
    const existed = data.players.some((p) => this.normalizeParticipantId(p.id) === participantId);
    if (!existed) return false;

    data.players = data.players.filter((p) => this.normalizeParticipantId(p.id) !== participantId);
    if (!data.rematch) data.rematch = { votes: {}, closed: false };
    delete data.rematch.votes[participantId];

    for (const [socket, socketMeta] of this.sockets.entries()) {
      if (!socketMeta.player) continue;
      if (this.normalizeParticipantId(socketMeta.player.id) !== participantId) continue;
      socketMeta.player = undefined;
      if (socketMeta.role !== "agent") socketMeta.role = "spectator";
      this.sockets.set(socket, socketMeta);
    }

    const readyParticipants = this.readyParticipantCount(data);
    if (readyParticipants < this.gameMinParticipants(data.gameType)) {
      (data.state as any).status = "waiting";
    }
    if (!data.players.some((p) => p.id.startsWith("openclaw:"))) {
      data.agentLastSeenAt = undefined;
    }

    if (data.ownerId && this.normalizeParticipantId(data.ownerId) === participantId) {
      const nextOwner = data.players.find((p) => !p.id.startsWith("openclaw:") && !this.isBotUserId(p.id));
      data.ownerId = nextOwner?.id;
    }

    if (data.players.length === 0) {
      // Keep an empty room snapshot for connected spectators; cleanup runs when sockets drain.
      await storeDelete(this.env, `lobby:${data.roomId}`);
    }

    await this.save(data);
    this.broadcast(data, "state_update", this.toSnapshot(data));
    this.broadcast(data, "online_update", this.currentOnline(data));
    return true;
  }

  private chooseBotMove(data: RoomData, seat: Seat): any {
    const engine = getEngine(data.gameType);
    if (engine.chooseBotMove) {
      return engine.chooseBotMove(data.state, seat);
    }
    if (data.gameType === "gomoku") {
      const state: any = data.state as any;
      const board = Array.isArray(state?.board) ? state.board : [];
      if (!Array.isArray(board) || board.length === 0) return null;
      const center = Math.floor(board.length / 2);
      if (board[center]?.[center] == null) return { x: center, y: center };
      for (let y = 0; y < board.length; y++) {
        for (let x = 0; x < board[y].length; x++) {
          if (board[y][x] == null) return { x, y };
        }
      }
    }
    return null;
  }

  private async runBotTurns(data: RoomData): Promise<void> {
    if (this.botLoopRunning) return;
    this.botLoopRunning = true;
    try {
      const engine = getEngine(data.gameType);
      if ((data.state as any).status !== "playing") {
        await this.save(data);
        return;
      }

      if (this.applyTurnTimeout(data)) {
        this.broadcast(data, "state_update", this.toSnapshot(data));
        await this.save(data);
        return;
      }

      const nextSeat = (data.state as any).nextTurn as Seat;
      const bot = data.players.find((p) => p.id.startsWith("bot:") && p.seat === nextSeat);
      if (!bot) {
        await this.save(data);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, BOT_MOVE_DELAY_MS));

      if (this.applyTurnTimeout(data)) {
        this.broadcast(data, "state_update", this.toSnapshot(data));
        await this.save(data);
        return;
      }

      const move = this.chooseBotMove(data, bot.seat);
      if (!move) {
        (data.state as any).status = "finished";
        (data.state as any).winner = this.getOpponentSeat(data, bot.seat) || "draw";
        (data.state as any).finishReason = "no_legal_move";
        data.rematch = { votes: {}, closed: false };
        const systemMsg = this.addSystemChat(data, "Game over. Bot has no legal move.");
        if (systemMsg) this.broadcast(data, "chat", systemMsg);
        this.broadcast(data, "game_over", {
          winner: (data.state as any).winner ?? "draw",
          reason: "no_legal_move",
          moveCount: (data.state as any).moveCount,
        });
        this.broadcast(data, "state_update", this.toSnapshot(data));
        await this.save(data);
        return;
      }

      try {
        engine.validateMove(data.state, bot.seat, move);
      } catch {
        (data.state as any).status = "finished";
        (data.state as any).winner = this.getOpponentSeat(data, bot.seat) || "draw";
        (data.state as any).finishReason = "illegal_bot_move";
        data.rematch = { votes: {}, closed: false };
        const systemMsg = this.addSystemChat(data, "Game over. Bot produced illegal move.");
        if (systemMsg) this.broadcast(data, "chat", systemMsg);
        this.broadcast(data, "game_over", {
          winner: (data.state as any).winner ?? "draw",
          reason: "illegal_bot_move",
          moveCount: (data.state as any).moveCount,
        });
        this.broadcast(data, "state_update", this.toSnapshot(data));
        await this.save(data);
        return;
      }

      data.state = engine.applyMove(data.state, bot.seat, move);
      this.resetTurnClockForNext(data);
      data.eventSeq = (data.eventSeq || 0) + 1;

      this.broadcast(data, "action_result", {
        ok: true,
        actor: bot.id,
        seat: bot.seat,
        move,
      });
      this.broadcast(data, "state_update", this.toSnapshot(data));

      if ((data.state as any).status === "finished") {
        data.rematch = { votes: {}, closed: false };
        const systemMsg = this.addSystemChat(data, "Game over. Rematch voting is now open.");
        if (systemMsg) this.broadcast(data, "chat", systemMsg);
        this.broadcast(data, "game_over", {
          winner: (data.state as any).winner ?? "draw",
          moveCount: (data.state as any).moveCount,
        });
      }

      await this.save(data);
      if ((data.state as any).status === "playing") {
        setTimeout(() => {
          void this.runBotTurns(data);
        }, 0);
      }
    } finally {
      this.botLoopRunning = false;
    }
  }

  private async join(request: Request): Promise<Response> {
    const body = (await request.json()) as { playerId: string; inviteCode?: string };
    const data = await this.requireRoom();
    const joined = await this.joinByPlayerId(data, body.playerId, body.inviteCode);
    return json(joined);
  }

  private async leave(request: Request): Promise<Response> {
    const body = (await request.json()) as { playerToken: string };
    const data = await this.requireRoom();

    const leaving = data.players.find((p) => p.token === body.playerToken);
    if (!leaving) {
      return json({ ok: true, alreadyLeft: true });
    }

    await this.removeParticipantById(data, leaving.id);
    return json({ ok: true });
  }

  private async rematch(request: Request): Promise<Response> {
    const body = (await request.json()) as { playerToken: string; accept: boolean };
    const data = await this.requireRoom();
    const player = data.players.find((p) => p.token === body.playerToken);
    if (!player) throw new Error("Invalid token");

    if (!data.rematch) data.rematch = { votes: {}, closed: false };
    const participantId = this.normalizeParticipantId(player.id);
    data.rematch.votes[participantId] = Boolean(body.accept);
    if (!body.accept) {
      data.rematch.closed = true;
    }

    const humanParticipants = Array.from(
      new Set(data.players.filter((p) => !p.id.startsWith("openclaw:") && !this.isBotUserId(p.id)).map((p) => p.id)),
    );
    const everyoneAccepted = humanParticipants.length >= 2 && humanParticipants.every((id) => data.rematch?.votes?.[id] === true);
    if (everyoneAccepted) {
      const engine = getEngine(data.gameType);
      data.state = engine.initState();
      this.resetTurnClockForNext(data);
      data.rematch = { votes: {}, closed: false };
      const systemMsg = this.addSystemChat(data, "Rematch started. Public chat window opened.");
      if (systemMsg) this.broadcast(data, "chat", systemMsg);
    }

    data.eventSeq = (data.eventSeq || 0) + 1;
    await this.save(data);
    this.broadcast(data, "state_update", this.toSnapshot(data));
    this.broadcast(data, "online_update", this.currentOnline(data));
    if (everyoneAccepted) {
      await this.runBotTurns(data);
    }

    return json({ ok: true, rematch: data.rematch, restarted: everyoneAccepted });
  }

  private async transferOwner(request: Request): Promise<Response> {
    const body = (await request.json()) as { requesterId: string; targetUserId: string };
    const data = await this.requireRoom();
    if (!body.requesterId || !body.targetUserId) throw new Error("requesterId and targetUserId are required");
    if (data.ownerId !== body.requesterId) throw new Error("only owner can transfer");
    if (body.targetUserId.startsWith("openclaw:") || this.isBotUserId(body.targetUserId)) {
      throw new Error("target must be a real player");
    }
    const exists = data.players.some((p) => p.id === body.targetUserId && !p.id.startsWith("openclaw:") && !this.isBotUserId(p.id));
    if (!exists) throw new Error("target not in players");
    data.ownerId = body.targetUserId;
    await this.save(data);
    this.broadcast(data, "state_update", this.toSnapshot(data));
    return json({ ok: true, ownerId: data.ownerId });
  }

  private async resetRoom(request: Request): Promise<Response> {
    const body = (await request.json()) as { requesterId: string };
    const data = await this.requireRoom();
    if (!body.requesterId) throw new Error("requesterId is required");
    if (data.ownerId !== body.requesterId) throw new Error("only owner can reset room");

    const engine = getEngine(data.gameType);
    data.state = engine.initState();
    data.players = [];
    data.rematch = { votes: {}, closed: false };

    for (const [ws, meta] of this.sockets.entries()) {
      meta.role = "spectator";
      meta.player = undefined;
      this.sockets.set(ws, meta);
    }

    const msg = this.addSystemChat(data, "Room has been reset by owner.");
    if (msg) this.broadcast(data, "chat", msg);
    await this.save(data);
    this.broadcast(data, "state_update", this.toSnapshot(data));
    this.broadcast(data, "online_update", this.currentOnline(data));
    return json({ ok: true, snapshot: this.toSnapshot(data) });
  }

  private async leaveRoomByRequester(request: Request): Promise<Response> {
    const body = (await request.json()) as { requesterId: string };
    if (!body.requesterId) throw new Error("requesterId is required");
    const data = await this.requireRoom();
    await this.removeParticipantById(data, body.requesterId);
    return json({ ok: true });
  }

  private async joinBotByRequester(request: Request): Promise<Response> {
    const body = (await request.json()) as { requesterId: string };
    const requesterId = String(body.requesterId || "").trim();
    if (!requesterId) throw new Error("requesterId is required");

    const data = await this.requireRoom();
    if (String(data.ownerId || "") !== requesterId) throw new Error("only owner can add bot");
    if (String((data.state as any)?.status || "") !== "waiting") throw new Error("can only add bot before game starts");
    const engine = getEngine(data.gameType);
    if (!engine.chooseBotMove) throw new Error("bot not supported for this game yet");

    const existingBotIds = new Set(
      data.players
        .map((p) => p.id)
        .filter((id) => id.startsWith(`bot:${requesterId}:`)),
    );
    let index = 1;
    while (existingBotIds.has(`bot:${requesterId}:${index}`)) index += 1;

    const botUserId = `bot:${requesterId}:${index}`;
    const botOpenclawId = `openclaw:${botUserId}`;
    const joined = await this.joinByPlayerId(data, botUserId);
    await this.joinByPlayerId(data, botOpenclawId);
    await this.runBotTurns(data);
    return json({ ok: true, botId: botUserId, seat: joined.seat });
  }

  private async move(request: Request): Promise<Response> {
    const body = (await request.json()) as { playerToken: string; move: any };
    const data = await this.requireRoom();

    const player = data.players.find((p) => p.token === body.playerToken);
    if (!player) throw new Error("Invalid token");

    if (this.applyTurnTimeout(data)) {
      await this.save(data);
      this.broadcast(data, "state_update", this.toSnapshot(data));
      return json({ ...this.toSnapshot(data), seq: data.eventSeq || 0 });
    }

    const engine = getEngine(data.gameType);
    engine.validateMove(data.state, player.seat, body.move);
    data.state = engine.applyMove(data.state, player.seat, body.move);
    this.resetTurnClockForNext(data);
    data.eventSeq = (data.eventSeq || 0) + 1;
    if ((data.state as any).status === "finished") {
      data.rematch = { votes: {}, closed: false };
      const systemMsg = this.addSystemChat(data, "Game over. Rematch voting is now open.");
      if (systemMsg) this.broadcast(data, "chat", systemMsg);
    }

    await this.save(data);
    await this.runBotTurns(data);
    return json({ ...this.toSnapshot(data), seq: data.eventSeq || 0 });
  }

  private async stateView(): Promise<Response> {
    const data = await this.requireRoom();
    return json({ ...this.toSnapshot(data), seq: data.eventSeq || 0 });
  }

  private async onlineView(): Promise<Response> {
    const data = await this.load();
    if (!data) return json({ users: [], openclaw: [], spectators: [] });
    return json(this.currentOnline(data));
  }

  private async chatList(): Promise<Response> {
    const data = await this.load();
    if (!data) return json({ messages: [], seq: 0 });
    return json({ messages: Array.isArray(data.chats) ? data.chats.slice(-100) : [], seq: data.eventSeq || 0 });
  }

  private async chatSend(request: Request): Promise<Response> {
    const body = (await request.json()) as { senderType?: "user" | "openclaw" | "spectator"; senderId?: string; text: string };
    const data = await this.requireRoom();
    const text = (body.text || "").trim();
    if (!text) throw new Error("empty chat text");
    data.eventSeq = (data.eventSeq || 0) + 1;
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      seq: data.eventSeq,
      senderType: body.senderType || ("user" as const),
      senderId: body.senderId || "anonymous",
      text: text.slice(0, 400),
      ts: Date.now(),
    };
    if (!Array.isArray(data.chats)) data.chats = [];
    data.chats.push(msg);
    data.chats = data.chats.slice(-100);
    await this.save(data);
    this.broadcast(data, "chat", msg);
    return json({ ok: true, message: msg });
  }

  private async requireRoom(): Promise<RoomData> {
    const data = await this.load();
    if (!data) throw new Error("Room not found");
    if (!Array.isArray(data.chats)) data.chats = [];
    if (!data.eventSeq) data.eventSeq = 0;
    if (!data.rematch) data.rematch = { votes: {}, closed: false };
    data.chats = data.chats.map((m, idx) => ({
      ...m,
      seq: Number((m as any).seq || idx + 1),
      ts: Number((m as any).ts || Date.now()),
    }));
    data.eventSeq = Math.max(data.eventSeq, ...data.chats.map((m) => m.seq || 0));
    if (this.pruneInactiveAgent(data)) {
      await this.save(data);
    }
    return data;
  }

  private toSnapshot(data: RoomData): RoomSnapshot {
    const engine = getEngine(data.gameType);
    return {
      roomId: data.roomId,
      gameType: data.gameType,
      visibility: data.visibility,
      ownerId: data.ownerId,
      players: data.players.map(({ token, ...rest }) => rest),
      state: engine.snapshot(data.state),
      rematch: data.rematch || { votes: {}, closed: false },
    };
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
