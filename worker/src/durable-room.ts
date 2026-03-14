import { getEngine } from "./games/registry";
import type { MatchPlayer, MatchState, Seat } from "./games/types";
import type { Env } from "./types";
import type { ProtocolEnvelope, RoomCommandRequest, RoomCommandResponse } from "@openclaw/game-protocol";
import { storeDelete } from "./lib/store";
import {
  AGENT_IDLE_TTL_MS,
  BOT_MOVE_DELAY_MS,
  DEFAULT_ROOM_AUTO_RESET_MS,
  EMPTY_ROOM_TTL_MS,
  ROOM_KEY,
  TURN_TIMEOUT_MS,
} from "./room/constants";

export type RoomVisibility = "public" | "private";

export interface RoomSnapshot {
  roomId: string;
  gameType: string;
  visibility: RoomVisibility;
  ownerId?: string;
  persistent?: boolean;
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
  persistent?: boolean;
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

const PARTICIPANT_PRESENCE_TTL_MS = 30_000;

export class GameRoomDO {
  private sockets = new Map<WebSocket, WsMeta>();
  private seq = 0;
  private botLoopRunning = false;
  private participantPresenceSeenAt = new Map<string, number>();

  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (request.method === "POST" && url.pathname === "/init") return await this.init(request);
      if (request.method === "POST" && url.pathname === "/join") return await this.join(request);
      if (request.method === "POST" && url.pathname === "/command") return await this.command(request);
      if (request.method === "POST" && url.pathname === "/move") return await this.move(request);
      if (request.method === "POST" && url.pathname === "/leave") return await this.leave(request);
      if (request.method === "POST" && url.pathname === "/rematch") return await this.rematch(request);
      if (request.method === "POST" && url.pathname === "/owner/transfer") return await this.transferOwner(request);
      if (request.method === "POST" && url.pathname === "/room/ensure-default") return await this.ensureDefaultRoom(request);
      if (request.method === "POST" && url.pathname === "/room/default-reset") return await this.resetDefaultRoomNow();
      if (request.method === "POST" && url.pathname === "/room/reset") return await this.resetRoom(request);
      if (request.method === "POST" && url.pathname === "/room/leave") return await this.leaveRoomByRequester(request);
      if (request.method === "POST" && url.pathname === "/room/join-bot") return await this.joinBotByRequester(request);
      if (request.method === "POST" && url.pathname === "/presence/touch") return await this.touchParticipantPresence(request);
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
        return;
      }
      if (msg.type === "remove_openclaw") {
        void this.handleRemoveOpenclawWs(ws, msg.payload ?? {});
      }
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "invalid message" }));
    }
  }

  webSocketClose(ws: WebSocket): void {
    const closedMeta = this.sockets.get(ws);
    this.sockets.delete(ws);
    if (closedMeta?.player && !closedMeta.player.id.startsWith("openclaw:") && !this.isBotUserId(closedMeta.player.id)) {
      void this.releasePlayerOnSocketClose(closedMeta.player.id);
    }
    void this.pushOnlineUpdate();
    if (this.sockets.size === 0) {
      void this.cleanupWhenRoomEmpty();
    }
  }

  private hasActiveSocketForPlayer(playerId: string): boolean {
    for (const meta of this.sockets.values()) {
      const socketPlayerId = String(meta.player?.id || "");
      if (!socketPlayerId) continue;
      if (socketPlayerId === playerId) return true;
    }
    return false;
  }

  private async releasePlayerOnSocketClose(playerId: string): Promise<void> {
    if (this.hasActiveSocketForPlayer(playerId)) return;
    const data = await this.load();
    if (!data) return;
    const exists = data.players.some((p) => p.id === playerId);
    if (!exists) return;
    await this.removePlayerById(data, playerId);
  }

  async alarm(): Promise<void> {
    const data = await this.load();
    if (!data) return;
    if (await this.maybeAutoResetDefaultRoomOnAlarm(data)) return;
    if (this.sockets.size > 0) return;
    if (data.persistent) return;
    await this.state.storage.delete(ROOM_KEY);
    await storeDelete(this.env, `lobby:${data.roomId}`);
  }

  private async cleanupWhenRoomEmpty(): Promise<void> {
    if (this.sockets.size > 0) return;
    const data = await this.load();
    if (!data || data.persistent) return;
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
      rules: getEngine(data.gameType).rules,
    })));
    server.send(JSON.stringify(this.envelope(data, "sync_state", this.toSnapshot(data))));
    server.send(JSON.stringify(this.envelope(data, "chat_history", { messages: (data.chats || []).slice(-100) })));
    server.send(JSON.stringify(this.envelope(data, "online_update", this.currentOnline(data))));

    if (player && data.state.status === "playing" && data.state.nextTurn === player.seat) {
      server.send(JSON.stringify(this.envelope(data, "your_turn", {
        seat: player.seat,
        legalAction: getEngine(data.gameType).actionSchema,
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
        this.clearFinishedMarkers(data.state as any);
      }
      data.agentLastSeenAt = undefined;
      return true;
    }
    return false;
  }

  private async handleSubmitAction(ws: WebSocket, payload: any): Promise<void> {
    const meta = this.sockets.get(ws);
    if (!meta?.player) {
      ws.send(JSON.stringify({ type: "error", message: "unauthorized socket" }));
      return;
    }

    const data = await this.requireRoom();
    try {
      const result = await this.applyMoveCommand(data, meta.player, payload?.move, payload?.actionId);
      ws.send(JSON.stringify(this.envelope(data, "action_result", result)));
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
    const actorType = meta.role === "agent" ? "openclaw" : "player";
    const actorId = meta.player?.id ?? viewerId ?? "guest";
    await this.applyChatCommand(data, actorType, actorId, text, payload?.actionId);
  }

  private async handleJoinGameWs(ws: WebSocket, payload: any): Promise<void> {
    const meta = this.sockets.get(ws);
    if (!meta) return;
    const data = await this.requireRoom();

    const payloadPlayerId = String(payload?.playerId || "").trim();
    const viewerId = String(meta.viewerId || "").trim();
    const defaultId = viewerId;
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

    await this.removePlayerById(data, playerId);
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
    if (String(data.ownerId || "") !== ownerId) {
      ws.send(JSON.stringify(this.envelope(data, "action_result", { kind: "join_bot", ok: false, error: "only room owner can add bot" })));
      return;
    }
    if (String((data.state as any)?.status || "") !== "waiting") {
      ws.send(JSON.stringify(this.envelope(data, "action_result", { kind: "join_bot", ok: false, error: "can only add bot before game starts" })));
      return;
    }

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
      void this.runBotTurns(data);
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
        this.clearFinishedMarkers(data.state as any);
      }
      if (!data.players.some((p) => p.id.startsWith("openclaw:"))) {
        data.agentLastSeenAt = undefined;
      }

      if (data.players.length === 0 && !data.persistent) {
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

  private async handleRemoveOpenclawWs(ws: WebSocket, payload: any): Promise<void> {
    const meta = this.sockets.get(ws);
    if (!meta) return;
    const data = await this.requireRoom();
    const status = String((data.state as any)?.status || "waiting");

    const viewerId = String(meta.viewerId || "").trim();
    if (!viewerId || viewerId.startsWith("guest")) {
      ws.send(JSON.stringify(this.envelope(data, "action_result", { kind: "remove_openclaw", ok: false, error: "login required" })));
      return;
    }
    if (status !== "waiting") {
      ws.send(JSON.stringify(this.envelope(data, "action_result", { kind: "remove_openclaw", ok: false, error: "can only remove openclaw before game starts" })));
      return;
    }

    const ownOpenclawId = `openclaw:${viewerId}`;
    const requestedId = String(payload?.playerId || ownOpenclawId).trim() || ownOpenclawId;
    if (requestedId !== ownOpenclawId) {
      ws.send(JSON.stringify(this.envelope(data, "action_result", { kind: "remove_openclaw", ok: false, error: "forbidden openclaw" })));
      return;
    }

    const removed = await this.removePlayerById(data, requestedId);
    ws.send(JSON.stringify(this.envelope(data, "action_result", {
      kind: "remove_openclaw",
      ok: true,
      playerId: requestedId,
      removed,
    })));
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
      return true;
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
          legalAction: getEngine(data.gameType).actionSchema,
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
      persistent?: boolean;
    };
    const existing = await this.load();
    if (existing) return json({ error: "Room already initialized" }, 409);

    const engine = getEngine(body.gameType);

    const data: RoomData = {
      roomId: body.roomId,
      gameType: body.gameType,
      visibility: body.visibility ?? "public",
      persistent: Boolean(body.persistent),
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
    if (!data.persistent) {
      await this.scheduleEmptyRoomCleanup();
    }
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

  private humanPlayerCount(data: RoomData): number {
    return data.players.filter((p) => !p.id.startsWith("openclaw:")).length;
  }

  private isBotUserId(id: string): boolean {
    return id.startsWith("bot:");
  }

  private readyParticipantCount(data: RoomData): number {
    const participants = new Map<string, { hasUser: boolean; hasOpenclaw: boolean }>();
    for (const p of data.players) {
      const participantId = this.normalizeParticipantId(p.id);
      if (!participantId) continue;
      const prev = participants.get(participantId) || { hasUser: false, hasOpenclaw: false };
      if (p.id.startsWith("openclaw:")) prev.hasOpenclaw = true;
      else prev.hasUser = true;
      participants.set(participantId, prev);
    }

    let ready = 0;
    for (const [participantId, sides] of participants.entries()) {
      if (this.isBotUserId(participantId)) {
        ready += 1;
        continue;
      }
      if (sides.hasUser && sides.hasOpenclaw) {
        // Allow owner-vs-own-OpenClaw in the same room.
        ready += 2;
        continue;
      }
      if (sides.hasUser || sides.hasOpenclaw) ready += 1;
    }
    return ready;
  }

  private hasOpenclawOrBotParticipant(data: RoomData): boolean {
    for (const p of data.players) {
      const participantId = this.normalizeParticipantId(p.id);
      if (!participantId) continue;
      if (this.isBotUserId(participantId)) return true;
      if (p.id.startsWith("openclaw:")) return true;
    }
    return false;
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

  private moveAllPlayersToSpectators(data: RoomData): void {
    const state: any = data.state as any;
    if (data.players.length > 0) {
      state.settlementPlayers = data.players.map((p) => ({ id: p.id, seat: p.seat }));
    }
    if (data.players.length > 0) {
      data.players = [];
    }
    data.agentLastSeenAt = undefined;
    if (!data.rematch) data.rematch = { votes: {}, closed: false };
    data.rematch.votes = {};

    for (const [socket, socketMeta] of this.sockets.entries()) {
      socketMeta.player = undefined;
      socketMeta.role = "spectator";
      this.sockets.set(socket, socketMeta);
    }
  }

  private clearFinishedMarkers(state: any): void {
    if (!state || typeof state !== "object") return;
    delete state.winner;
    delete state.finishReason;
    delete state.autoResetAt;
  }

  private resetIfWaitingAndEmpty(data: RoomData): void {
    const state: any = data.state as any;
    if (String(state?.status || "") !== "waiting") return;
    if (Array.isArray(data.players) && data.players.length > 0) return;
    // Empty waiting rooms should not retain stale settlement markers.
    const hasStaleResult = typeof state?.winner !== "undefined" || typeof state?.finishReason !== "undefined" || Number(state?.moveCount || 0) > 0;
    if (!hasStaleResult) return;
    const engine = getEngine(data.gameType);
    data.state = engine.initState();
    this.clearDefaultRoomAutoReset(data);
  }

  private async applyTurnTimeout(data: RoomData): Promise<boolean> {
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
    this.markDefaultRoomAutoReset(data);
    data.rematch = { votes: {}, closed: false };
    const systemMsg = this.addSystemChat(data, `${currentSeat} timed out. ${state.winner} wins.`);
    if (systemMsg) this.broadcast(data, "chat", systemMsg);
    this.broadcast(data, "game_over", {
      winner: state.winner,
      reason: "timeout",
      moveCount: Number(state.moveCount || 0),
    });
    this.moveAllPlayersToSpectators(data);
    return true;
  }

  private async tickTimeoutByHeartbeat(): Promise<void> {
    const data = await this.load();
    if (!data) return;
    const changed = await this.applyTurnTimeout(data);
    if (!changed) return;
    await this.save(data);
    await this.maybeScheduleDefaultAutoReset(data);
    this.broadcast(data, "state_update", this.toSnapshot(data));
    this.broadcast(data, "online_update", this.currentOnline(data));
  }

  private async joinByPlayerId(data: RoomData, playerId: string, inviteCode?: string): Promise<{ playerToken: string; seat: Seat }> {
    this.resetIfWaitingAndEmpty(data);
    if (data.visibility === "private" && data.inviteCode && data.inviteCode !== inviteCode) {
      throw new Error("Invalid invite code");
    }
    const participantId = this.normalizeParticipantId(playerId);
    if (playerId.startsWith("openclaw:")) {
      if (!this.isParticipantOnlineInRoom(data, participantId)) {
        throw new Error("owner must be online in room (player or spectator)");
      }
    }

    const existed = data.players.find((p) => p.id === playerId);
    if (existed) {
      if (playerId.startsWith("openclaw:")) {
        data.agentLastSeenAt = Date.now();
        await this.save(data);
      }
      return { playerToken: existed.token, seat: existed.seat };
    }

    const maxParticipants = this.gameMaxParticipants(data.gameType);
    // Capacity is based on occupied seats/sides, not participant identity.
    if (data.players.length >= maxParticipants) throw new Error("Room is full");

    const seat = this.nextSeatFor(data);

    const token = crypto.randomUUID();
    data.players.push({ id: playerId, seat, token });
    if (playerId.startsWith("openclaw:")) data.agentLastSeenAt = Date.now();

    const readyParticipants = this.readyParticipantCount(data);
    const hasRequiredNonHuman = this.hasOpenclawOrBotParticipant(data);
    if (
      readyParticipants >= this.gameMinParticipants(data.gameType)
      && hasRequiredNonHuman
      && data.state.status === "waiting"
    ) {
      data.state.status = "playing";
      delete (data.state as any).settlementPlayers;
      this.clearDefaultRoomAutoReset(data);
      const clock = this.ensureClockState(data);
      clock.turnStartedAt = Date.now();
      const systemMsg = this.addSystemChat(data, "Game started. Public chat window opened for OpenClaw banter.");
      if (systemMsg) this.broadcast(data, "chat", systemMsg);
    }

    await this.save(data);
    this.broadcast(data, "state_update", this.toSnapshot(data));
    this.broadcast(data, "online_update", this.currentOnline(data));
    if ((data.state as any).status === "playing") {
      void this.runBotTurns(data);
    }
    return { playerToken: token, seat };
  }

  private isParticipantOnlineInRoom(data: RoomData, participantId: string): boolean {
    if (!participantId) return false;
    this.cleanupParticipantPresence();

    const online = this.currentOnline(data);
    const userOnline = online.users.some((u) => this.normalizeParticipantId(String(u.id || "")) === participantId);
    const spectatorOnline = online.spectators.some((u) => this.normalizeParticipantId(String(u.id || "")) === participantId);
    if (userOnline || spectatorOnline) return true;
    if (this.participantPresenceSeenAt.has(participantId)) return true;

    // Fallback: explicit socket metadata check for racey snapshots.
    return Array.from(this.sockets.values()).some((meta) => {
      const viewerId = String(meta.viewerId || "").trim();
      if (viewerId && !viewerId.startsWith("guest") && this.normalizeParticipantId(viewerId) === participantId) {
        return true;
      }
      const playerId = String(meta.player?.id || "").trim();
      if (playerId && this.normalizeParticipantId(playerId) === participantId) {
        return true;
      }
      return false;
    });
  }

  private cleanupParticipantPresence(): void {
    const now = Date.now();
    for (const [participantId, ts] of this.participantPresenceSeenAt.entries()) {
      if (now - ts > PARTICIPANT_PRESENCE_TTL_MS) {
        this.participantPresenceSeenAt.delete(participantId);
      }
    }
  }

  private async touchParticipantPresence(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => ({}))) as { userId?: string };
    const userId = String(body.userId || "").trim();
    if (!userId) throw new Error("userId is required");
    const participantId = this.normalizeParticipantId(userId);
    if (!participantId || participantId.startsWith("guest")) throw new Error("invalid userId");
    this.cleanupParticipantPresence();
    this.participantPresenceSeenAt.set(participantId, Date.now());
    return json({ ok: true, userId: participantId, ttlMs: PARTICIPANT_PRESENCE_TTL_MS });
  }

  private async removePlayerById(data: RoomData, playerId: string): Promise<boolean> {
    const leavingPlayer = data.players.find((p) => p.id === playerId);
    const existed = Boolean(leavingPlayer);
    if (!existed) return false;
    const wasPlaying = String((data.state as any)?.status || "") === "playing";
    const leavingSeat = String(leavingPlayer?.seat || "");

    const participantId = this.normalizeParticipantId(playerId);
    data.players = data.players.filter((p) => p.id !== playerId);
    if (!data.rematch) data.rematch = { votes: {}, closed: false };
    const hasParticipantSideLeft = data.players.some((p) => this.normalizeParticipantId(p.id) === participantId);
    if (!hasParticipantSideLeft) {
      delete data.rematch.votes[participantId];
    }

    for (const [socket, socketMeta] of this.sockets.entries()) {
      if (!socketMeta.player) continue;
      if (socketMeta.player.id !== playerId) continue;
      socketMeta.player = undefined;
      if (socketMeta.role !== "agent") socketMeta.role = "spectator";
      this.sockets.set(socket, socketMeta);
    }

    if (wasPlaying && leavingSeat) {
      const state: any = data.state as any;
      state.status = "finished";
      state.winner = this.getOpponentSeat(data, leavingSeat) || "draw";
      state.finishReason = "player_left";
      this.markDefaultRoomAutoReset(data);
      data.rematch = { votes: {}, closed: false };
      const systemMsg = this.addSystemChat(data, `${leavingSeat} left the room. ${state.winner} wins.`);
      if (systemMsg) this.broadcast(data, "chat", systemMsg);
      this.broadcast(data, "game_over", {
        winner: state.winner,
        reason: "player_left",
        moveCount: Number(state.moveCount || 0),
      });
      this.moveAllPlayersToSpectators(data);
    }

    const readyParticipants = this.readyParticipantCount(data);
    const hasRequiredNonHuman = this.hasOpenclawOrBotParticipant(data);
    if (!wasPlaying && (readyParticipants < this.gameMinParticipants(data.gameType) || !hasRequiredNonHuman)) {
      (data.state as any).status = "waiting";
      this.clearFinishedMarkers(data.state as any);
    }
    if (!data.players.some((p) => p.id.startsWith("openclaw:"))) {
      data.agentLastSeenAt = undefined;
    }

    if (data.players.length === 0 && !data.persistent) {
      // Keep an empty room snapshot for connected spectators; cleanup runs when sockets drain.
      await storeDelete(this.env, `lobby:${data.roomId}`);
    }

    await this.save(data);
    this.broadcast(data, "state_update", this.toSnapshot(data));
    this.broadcast(data, "online_update", this.currentOnline(data));
    return true;
  }

  private async removeParticipantById(data: RoomData, participantPlayerId: string): Promise<boolean> {
    const participantId = this.normalizeParticipantId(participantPlayerId);
    const leavingSeats = data.players
      .filter((p) => this.normalizeParticipantId(p.id) === participantId)
      .map((p) => String(p.seat || ""))
      .filter(Boolean);
    const existed = data.players.some((p) => this.normalizeParticipantId(p.id) === participantId);
    if (!existed) return false;
    const wasPlaying = String((data.state as any)?.status || "") === "playing";

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

    if (wasPlaying && leavingSeats.length > 0) {
      const state: any = data.state as any;
      const primarySeat = leavingSeats[0];
      state.status = "finished";
      state.winner = this.getOpponentSeat(data, primarySeat) || "draw";
      state.finishReason = "player_left";
      this.markDefaultRoomAutoReset(data);
      data.rematch = { votes: {}, closed: false };
      const systemMsg = this.addSystemChat(data, `${primarySeat} left the room. ${state.winner} wins.`);
      if (systemMsg) this.broadcast(data, "chat", systemMsg);
      this.broadcast(data, "game_over", {
        winner: state.winner,
        reason: "player_left",
        moveCount: Number(state.moveCount || 0),
      });
      this.moveAllPlayersToSpectators(data);
    }

    const readyParticipants = this.readyParticipantCount(data);
    const hasRequiredNonHuman = this.hasOpenclawOrBotParticipant(data);
    if (!wasPlaying && (readyParticipants < this.gameMinParticipants(data.gameType) || !hasRequiredNonHuman)) {
      (data.state as any).status = "waiting";
      this.clearFinishedMarkers(data.state as any);
    }
    if (!data.players.some((p) => p.id.startsWith("openclaw:"))) {
      data.agentLastSeenAt = undefined;
    }

    if (data.ownerId && this.normalizeParticipantId(data.ownerId) === participantId) {
      const nextOwner = data.players.find((p) => !p.id.startsWith("openclaw:") && !this.isBotUserId(p.id));
      data.ownerId = nextOwner?.id;
    }

    if (data.players.length === 0 && !data.persistent) {
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

      if (await this.applyTurnTimeout(data)) {
        this.broadcast(data, "state_update", this.toSnapshot(data));
        this.broadcast(data, "online_update", this.currentOnline(data));
        await this.save(data);
        await this.maybeScheduleDefaultAutoReset(data);
        return;
      }

      const nextSeat = (data.state as any).nextTurn as Seat;
      const bot = data.players.find((p) => p.id.startsWith("bot:") && p.seat === nextSeat);
      if (!bot) {
        await this.save(data);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, BOT_MOVE_DELAY_MS));

      if (await this.applyTurnTimeout(data)) {
        this.broadcast(data, "state_update", this.toSnapshot(data));
        this.broadcast(data, "online_update", this.currentOnline(data));
        await this.save(data);
        await this.maybeScheduleDefaultAutoReset(data);
        return;
      }

      const move = this.chooseBotMove(data, bot.seat);
      if (!move) {
        (data.state as any).status = "finished";
        (data.state as any).winner = this.getOpponentSeat(data, bot.seat) || "draw";
        (data.state as any).finishReason = "no_legal_move";
        this.markDefaultRoomAutoReset(data);
        data.rematch = { votes: {}, closed: false };
        const systemMsg = this.addSystemChat(data, "Game over. Bot has no legal move.");
        if (systemMsg) this.broadcast(data, "chat", systemMsg);
        this.broadcast(data, "game_over", {
          winner: (data.state as any).winner ?? "draw",
          reason: "no_legal_move",
          moveCount: (data.state as any).moveCount,
        });
        this.moveAllPlayersToSpectators(data);
        this.broadcast(data, "state_update", this.toSnapshot(data));
        this.broadcast(data, "online_update", this.currentOnline(data));
        await this.save(data);
        await this.maybeScheduleDefaultAutoReset(data);
        return;
      }

      try {
        engine.validateMove(data.state, bot.seat, move);
      } catch {
        (data.state as any).status = "finished";
        (data.state as any).winner = this.getOpponentSeat(data, bot.seat) || "draw";
        (data.state as any).finishReason = "illegal_bot_move";
        this.markDefaultRoomAutoReset(data);
        data.rematch = { votes: {}, closed: false };
        const systemMsg = this.addSystemChat(data, "Game over. Bot produced illegal move.");
        if (systemMsg) this.broadcast(data, "chat", systemMsg);
        this.broadcast(data, "game_over", {
          winner: (data.state as any).winner ?? "draw",
          reason: "illegal_bot_move",
          moveCount: (data.state as any).moveCount,
        });
        this.moveAllPlayersToSpectators(data);
        this.broadcast(data, "state_update", this.toSnapshot(data));
        this.broadcast(data, "online_update", this.currentOnline(data));
        await this.save(data);
        await this.maybeScheduleDefaultAutoReset(data);
        return;
      }

      data.state = engine.applyMove(data.state, bot.seat, move);
      this.resetTurnClockForNext(data);
      data.eventSeq = (data.eventSeq || 0) + 1;

      if ((data.state as any).status === "finished") {
        this.markDefaultRoomAutoReset(data);
        data.rematch = { votes: {}, closed: false };
        const systemMsg = this.addSystemChat(data, "Game over. Rematch voting is now open.");
        if (systemMsg) this.broadcast(data, "chat", systemMsg);
        this.broadcast(data, "game_over", {
          winner: (data.state as any).winner ?? "draw",
          moveCount: (data.state as any).moveCount,
        });
        this.moveAllPlayersToSpectators(data);
      }

      this.broadcast(data, "action_result", {
        ok: true,
        actor: bot.id,
        seat: bot.seat,
        move,
      });
      this.broadcast(data, "state_update", this.toSnapshot(data));
      this.broadcast(data, "online_update", this.currentOnline(data));

      await this.save(data);
      await this.maybeScheduleDefaultAutoReset(data);
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
    const legacyCommand: RoomCommandRequest = {
      protocolVersion: "v1",
      roomId: "",
      actorType: body.playerId?.startsWith("openclaw:") ? "openclaw" : "player",
      actorId: String(body.playerId || ""),
      command: { kind: "join", inviteCode: body.inviteCode },
    };
    return await this.commandFromPayload(legacyCommand);
  }

  private async leave(request: Request): Promise<Response> {
    const body = (await request.json()) as { playerToken: string };
    const data = await this.requireRoom();

    const leaving = data.players.find((p) => p.token === body.playerToken);
    if (!leaving) {
      return json({ ok: true, alreadyLeft: true });
    }

    await this.removePlayerById(data, leaving.id);
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
    const compositionSatisfied = this.hasOpenclawOrBotParticipant(data);
    const canRestart = everyoneAccepted && compositionSatisfied;
    if (canRestart) {
      const engine = getEngine(data.gameType);
      data.state = engine.initState();
      this.clearDefaultRoomAutoReset(data);
      this.resetTurnClockForNext(data);
      data.rematch = { votes: {}, closed: false };
      const systemMsg = this.addSystemChat(data, "Rematch started. Public chat window opened.");
      if (systemMsg) this.broadcast(data, "chat", systemMsg);
    }

    data.eventSeq = (data.eventSeq || 0) + 1;
    await this.save(data);
    this.broadcast(data, "state_update", this.toSnapshot(data));
    this.broadcast(data, "online_update", this.currentOnline(data));
    if (canRestart) {
      await this.runBotTurns(data);
    }

    return json({
      ok: true,
      rematch: data.rematch,
      restarted: canRestart,
      reason: everyoneAccepted && !compositionSatisfied ? "at_least_one_openclaw_or_bot_required" : undefined,
    });
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

  private markDefaultRoomAutoReset(data: RoomData): void {
    if (!data.persistent) return;
    const state: any = data.state as any;
    if (String(state?.status || "") !== "finished") return;
    const existed = Number(state?.autoResetAt || 0);
    if (existed > Date.now()) return;
    state.autoResetAt = Date.now() + DEFAULT_ROOM_AUTO_RESET_MS;
  }

  private clearDefaultRoomAutoReset(data: RoomData): void {
    const state: any = data.state as any;
    if (!state || typeof state !== "object") return;
    delete state.autoResetAt;
  }

  private async maybeScheduleDefaultAutoReset(data: RoomData): Promise<void> {
    if (!data.persistent) return;
    const state: any = data.state as any;
    const autoResetAt = Number(state?.autoResetAt || 0);
    if (autoResetAt > Date.now()) {
      await this.state.storage.setAlarm(autoResetAt);
    }
  }

  private async performRoomReset(data: RoomData, systemText: string): Promise<void> {
    const engine = getEngine(data.gameType);
    data.state = engine.initState();
    this.clearDefaultRoomAutoReset(data);
    data.players = [];
    data.rematch = { votes: {}, closed: false };

    for (const [ws, meta] of this.sockets.entries()) {
      meta.role = "spectator";
      meta.player = undefined;
      this.sockets.set(ws, meta);
    }

    const msg = this.addSystemChat(data, systemText);
    if (msg) this.broadcast(data, "chat", msg);
    await this.save(data);
    this.broadcast(data, "state_update", this.toSnapshot(data));
    this.broadcast(data, "online_update", this.currentOnline(data));
  }

  private async maybeAutoResetDefaultRoomOnAlarm(data: RoomData): Promise<boolean> {
    if (!data.persistent) return false;
    const state: any = data.state as any;
    const autoResetAt = Number(state?.autoResetAt || 0);
    if (!autoResetAt || String(state?.status || "") !== "finished") return false;
    if (Date.now() < autoResetAt) {
      await this.state.storage.setAlarm(autoResetAt);
      return false;
    }
    await this.performRoomReset(data, "Default room auto-reset after settlement.");
    return true;
  }

  private async resetRoom(request: Request): Promise<Response> {
    const body = (await request.json()) as { requesterId: string };
    const data = await this.requireRoom();
    if (!body.requesterId) throw new Error("requesterId is required");
    if (data.ownerId !== body.requesterId) throw new Error("only owner can reset room");
    if (data.persistent) throw new Error("default room resets automatically after settlement");
    await this.performRoomReset(data, "Room has been reset by owner.");
    return json({ ok: true, snapshot: this.toSnapshot(data) });
  }

  private async ensureDefaultRoom(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => ({}))) as { ownerId?: string };
    const data = await this.requireRoom();
    if (!String(data.roomId || "").startsWith("DEFAULT-")) throw new Error("only default rooms can be ensured");
    data.persistent = true;
    data.visibility = "public";
    data.ownerId = String(body.ownerId || data.ownerId || "clawgame");
    this.resetIfWaitingAndEmpty(data);
    const status = String((data.state as any)?.status || "");
    if (status === "finished") this.markDefaultRoomAutoReset(data);
    else this.clearDefaultRoomAutoReset(data);
    await this.save(data);
    await this.maybeScheduleDefaultAutoReset(data);
    return json({ ok: true, snapshot: this.toSnapshot(data) });
  }

  private async resetDefaultRoomNow(): Promise<Response> {
    const data = await this.requireRoom();
    if (!String(data.roomId || "").startsWith("DEFAULT-")) throw new Error("only default rooms can be reset via this endpoint");
    data.persistent = true;
    data.visibility = "public";
    data.ownerId = String(data.ownerId || "clawgame");
    await this.performRoomReset(data, "Default room has been reset.");
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
    const legacyCommand: RoomCommandRequest = {
      protocolVersion: "v1",
      roomId: "",
      actorType: "player",
      playerToken: body.playerToken,
      command: { kind: "move", move: body.move },
    };
    return await this.commandFromPayload(legacyCommand);
  }

  private async applyMoveCommand(data: RoomData, player: MatchPlayer, move: unknown, actionId?: string): Promise<RoomCommandResponse> {
    if (await this.applyTurnTimeout(data)) {
      await this.save(data);
      await this.maybeScheduleDefaultAutoReset(data);
      this.broadcast(data, "state_update", this.toSnapshot(data));
      this.broadcast(data, "online_update", this.currentOnline(data));
      return {
        protocolVersion: "v1",
        roomId: data.roomId,
        ok: true,
        seq: data.eventSeq || 0,
        actionId: actionId ? String(actionId) : undefined,
        state: this.toSnapshot(data),
      };
    }

    const engine = getEngine(data.gameType);
    engine.validateMove(data.state, player.seat, move);
    data.state = engine.applyMove(data.state, player.seat, move);
    this.resetTurnClockForNext(data);
    data.eventSeq = (data.eventSeq || 0) + 1;
    if ((data.state as any).status === "finished") {
      this.markDefaultRoomAutoReset(data);
      data.rematch = { votes: {}, closed: false };
      const systemMsg = this.addSystemChat(data, "Game over. Rematch voting is now open.");
      if (systemMsg) this.broadcast(data, "chat", systemMsg);
      this.broadcast(data, "game_over", {
        winner: (data.state as any).winner ?? "draw",
        moveCount: (data.state as any).moveCount,
      });
      this.moveAllPlayersToSpectators(data);
    } else {
      this.broadcastTurnPrompt(data);
    }

    this.broadcast(data, "action_result", {
      ok: true,
      actor: player.id,
      bySeat: player.seat,
      seat: player.seat,
      move,
      actionId: actionId ? String(actionId) : undefined,
    });
    this.broadcast(data, "state_update", this.toSnapshot(data));
    this.broadcast(data, "online_update", this.currentOnline(data));

    await this.save(data);
    await this.maybeScheduleDefaultAutoReset(data);
    await this.runBotTurns(data);
    return {
      protocolVersion: "v1",
      roomId: data.roomId,
      ok: true,
      seq: data.eventSeq || 0,
      actionId: actionId ? String(actionId) : undefined,
      state: this.toSnapshot(data),
    };
  }

  private async applyChatCommand(
    data: RoomData,
    actorType: "player" | "openclaw" | "system",
    actorId: string,
    text: string,
    actionId?: string,
  ): Promise<RoomCommandResponse> {
    const normalized = String(text || "").trim();
    if (!normalized) throw new Error("empty chat text");
    data.eventSeq = (data.eventSeq || 0) + 1;
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      seq: data.eventSeq,
      senderType: actorType === "openclaw" ? "openclaw" : actorType === "system" ? "system" : "user",
      senderId: String(actorId || "anonymous"),
      text: normalized.slice(0, 400),
      ts: Date.now(),
    };
    if (!Array.isArray(data.chats)) data.chats = [];
    data.chats.push(msg);
    data.chats = data.chats.slice(-100);
    await this.save(data);
    this.broadcast(data, "chat", msg);
    return {
      protocolVersion: "v1",
      roomId: data.roomId,
      ok: true,
      seq: data.eventSeq || 0,
      actionId: actionId ? String(actionId) : undefined,
    };
  }

  private async commandFromPayload(payload: RoomCommandRequest): Promise<Response> {
    const data = await this.requireRoom();
    const kind = String(payload?.command?.kind || "");

    if (kind === "join") {
      const actorId = String(payload?.actorId || "").trim();
      if (!actorId) throw new Error("actorId is required");
      const joined = await this.joinByPlayerId(data, actorId, payload?.command?.inviteCode);
      const res: RoomCommandResponse = {
        protocolVersion: "v1",
        roomId: data.roomId,
        ok: true,
        seq: data.eventSeq || 0,
        actionId: payload?.actionId ? String(payload.actionId) : undefined,
        data: { playerToken: joined.playerToken, seat: joined.seat, playerId: actorId },
        state: this.toSnapshot(data),
      };
      return json(res);
    }

    if (kind === "move") {
      const playerToken = String(payload?.playerToken || "").trim();
      if (!playerToken) throw new Error("playerToken is required");
      const player = data.players.find((p) => p.token === playerToken);
      if (!player) throw new Error("Invalid token");
      const result = await this.applyMoveCommand(data, player, payload?.command?.move, payload?.actionId);
      return json(result);
    }

    if (kind === "chat") {
      const res = await this.applyChatCommand(
        data,
        payload.actorType || "player",
        String(payload.actorId || "anonymous"),
        String(payload?.command?.text || ""),
        payload?.actionId ? String(payload.actionId) : undefined,
      );
      return json(res);
    }

    throw new Error("unsupported command kind");
  }

  private async command(request: Request): Promise<Response> {
    const payload = (await request.json()) as RoomCommandRequest;
    return await this.commandFromPayload(payload);
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
    const legacyCommand: RoomCommandRequest = {
      protocolVersion: "v1",
      roomId: "",
      actorType: body.senderType === "openclaw" ? "openclaw" : "player",
      actorId: String(body.senderId || "anonymous"),
      command: { kind: "chat", text: String(body.text || "") },
    };
    return await this.commandFromPayload(legacyCommand);
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
    const rawState: any = data.state as any;
    const stateSnapshot: any = engine.snapshot(data.state);
    if (stateSnapshot && typeof stateSnapshot === "object") {
      if (typeof rawState?.autoResetAt === "number" && rawState.autoResetAt > 0) {
        stateSnapshot.autoResetAt = rawState.autoResetAt;
      }
    }
    return {
      roomId: data.roomId,
      gameType: data.gameType,
      visibility: data.visibility,
      ownerId: data.ownerId,
      persistent: Boolean(data.persistent),
      players: data.players.map(({ token, ...rest }) => rest),
      state: stateSnapshot,
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
