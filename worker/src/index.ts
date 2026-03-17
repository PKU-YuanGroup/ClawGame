import { GameRoomDO, type RoomVisibility } from "./durable-room";
import { getEngine, listGameTypes } from "./games/registry";
import { handleAuthRoutes } from "./routes/auth";
import { handleProfileRoutes } from "./routes/profile";
import { json, passthrough, shortCode, wsBaseFromRequest } from "./lib/http";
import { AGENT_EVENT_TYPES } from "./lib/agent-events";
import { getUserProfile, requireUser } from "./lib/user";
import { storeDelete, storeGet, storeList, storePut } from "./lib/store";
import type { Env, LeaderboardEntry, UserProfile } from "./types";
import { getGameRules, type AgentActRequest, type AgentJoinRequest, type AgentPollRequest, type RoomCommandRequest } from "@openclaw/game-protocol";
import { getClawCredential, resolveUserByCredential } from "./lib/claw-auth";

export { GameRoomDO };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (url.pathname === "/api/health") {
        return json({ ok: true, games: listGameTypes() });
      }

      if (request.method === "GET" && url.pathname === "/api/analysis") {
        const [registeredUsers, registeredOpenclaw] = await Promise.all([
          countKvByPrefix(env, "user:"),
          countKvByPrefix(env, "user-claw-credential:"),
        ]);
        return json({
          ok: true,
          registeredUsers,
          registeredOpenclaw,
          ts: Date.now(),
        });
      }

      const authRes = await handleAuthRoutes(request, env, url);
      if (authRes) return authRes;

      const profileRes = await handleProfileRoutes(request, env, url);
      if (profileRes) return profileRes;

      if (request.method === "POST" && url.pathname === "/api/match/create") {
        const me = await requireUser(request, env);
        const body = (await request.json()) as {
          gameType: string;
          visibility?: RoomVisibility;
        };
        const roomId = await allocateRoomId(env);
        const visibility = body.visibility ?? "public";
        const inviteCode = visibility === "private" ? shortCode() : undefined;

        const id = env.ROOM_DO.idFromName(roomId);
        const stub = env.ROOM_DO.get(id);
        const res = await stub.fetch("https://room/init", {
          method: "POST",
          body: JSON.stringify({ roomId, gameType: body.gameType, creatorId: me.userId, visibility, inviteCode }),
        });
        const payload = await res.json<any>();
        if (!res.ok) return json(payload, res.status);

        await storePut(env, 
          `lobby:${roomId}`,
          JSON.stringify({ roomId, gameType: body.gameType, ownerId: me.userId, visibility, inviteCode, createdAt: Date.now() }),
        );

        const wsBase = wsBaseFromRequest(request);
        const hasToken = Boolean(payload?.playerToken);
        return json({
          roomId,
          visibility,
          inviteCode,
          ...payload,
          ws: hasToken
            ? {
                player: `${wsBase}/ws/room/${roomId}?token=${encodeURIComponent(payload.playerToken)}&role=player`,
                agent: `${wsBase}/ws/room/${roomId}?token=${encodeURIComponent(payload.playerToken)}&role=agent`,
              }
            : null,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/test/fake-room") {
        const ownerUserId = await requireClawTokenUser(request, env);
        const body = (await request.json()) as {
          gameType?: string;
          agentA?: string;
          agentB?: string;
          mode?: "owner_only" | "owner_vs_bot" | "owner_vs_agent";
        };
        const gameType = String(body.gameType || "gomoku");
        const agentA = String(body.agentA || ownerUserId);
        const mode = String(body.mode || "owner_only");

        const roomId = await allocateRoomId(env);
        const visibility: RoomVisibility = "public";
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(roomId));

        const initRes = await stub.fetch("https://room/init", {
          method: "POST",
          body: JSON.stringify({ roomId, gameType, creatorId: ownerUserId, visibility }),
        });
        const initPayload = await initRes.json<any>();
        if (!initRes.ok) return json(initPayload, initRes.status);

        // Ensure owner user + owner OpenClaw participant both exist for ready-state checks.
        await stub.fetch("https://room/command", {
          method: "POST",
          body: JSON.stringify({
            protocolVersion: "v1",
            roomId,
            actorType: "player",
            actorId: ownerUserId,
            command: { kind: "join" },
          } satisfies RoomCommandRequest),
        });
        const ownerOpenclawRes = await stub.fetch("https://room/command", {
          method: "POST",
          body: JSON.stringify({
            protocolVersion: "v1",
            roomId,
            actorType: "openclaw",
            actorId: `openclaw:${agentA}`,
            command: { kind: "join" },
          } satisfies RoomCommandRequest),
        });
        const ownerOpenclawPayload = await ownerOpenclawRes.json<any>();
        if (!ownerOpenclawRes.ok) return json(ownerOpenclawPayload, ownerOpenclawRes.status);
        const ownerJoinData = ownerOpenclawPayload?.data || ownerOpenclawPayload;

        const players: any[] = [
          {
            agentId: agentA,
            playerId: `openclaw:${agentA}`,
            seat: ownerJoinData.seat || initPayload.seat,
            playerToken: ownerJoinData.playerToken || initPayload.playerToken,
          },
        ];

        if (mode === "owner_vs_agent") {
          const agentB = String(body.agentB || "smoke_b");
          const joinRes = await stub.fetch("https://room/command", {
            method: "POST",
            body: JSON.stringify({
              protocolVersion: "v1",
              roomId,
              actorType: "openclaw",
              actorId: `openclaw:${agentB}`,
              command: { kind: "join" },
            } satisfies RoomCommandRequest),
          });
          const joinPayload = await joinRes.json<any>();
          if (!joinRes.ok) return json(joinPayload, joinRes.status);
          const joinData = joinPayload?.data || joinPayload;
          players.push({ agentId: agentB, playerId: `openclaw:${agentB}`, seat: joinData.seat, playerToken: joinData.playerToken });
        } else if (mode === "owner_vs_bot") {
          const joinBotRes = await stub.fetch("https://room/room/join-bot", {
            method: "POST",
            body: JSON.stringify({ requesterId: ownerUserId }),
          });
          const joinBotPayload = await joinBotRes.json<any>();
          if (!joinBotRes.ok) return json(joinBotPayload, joinBotRes.status);
          players.push({ botId: joinBotPayload.botId, seat: joinBotPayload.seat });
        }

        await storePut(env, `lobby:${roomId}`, JSON.stringify({ roomId, gameType, ownerId: ownerUserId, visibility, createdAt: Date.now() }));

        return json({ roomId, gameType, mode, players, protocolVersion: "v1" });
      }

      if (request.method === "GET" && url.pathname === "/api/lobby/public") {
        await removeDefaultLobbyRooms(env);
        const gameType = url.searchParams.get("gameType");
        const list = await storeList(env, { prefix: "lobby:" });
        const rooms = await Promise.all(list.keys.map(async (k) => (await storeGet(env, k.name, "json")) as any));
        return json(rooms.filter((r) => r?.visibility === "public" && (!gameType || r.gameType === gameType)));
      }

      if (request.method === "GET" && url.pathname === "/api/lobby/overview") {
        await removeDefaultLobbyRooms(env);
        const gameType = String(url.searchParams.get("gameType") || "gomoku");
        const [rooms, leaderboard] = await Promise.all([
          buildLobbyOverview(request, env, gameType),
          buildLeaderboardView(env, gameType),
        ]);
        return json({ gameType, rooms, leaderboard });
      }

      if (request.method === "GET" && url.pathname === "/api/matches/live") {
        await removeDefaultLobbyRooms(env);
        const gameType = url.searchParams.get("gameType");
        const list = await storeList(env, { prefix: "lobby:" });
        const rooms = await Promise.all(
          list.keys.map(async (k) => {
            const v = (await storeGet(env, k.name, "json")) as any;
            if (!v || v.visibility !== "public") return null;
            if (gameType && v.gameType !== gameType) return null;
            const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(v.roomId));
            const stateRes = await stub.fetch("https://room/state");
            if (!stateRes.ok) return null;
            const snap = await stateRes.json<any>();
            let onlineHumanCount = 0;
            try {
              const onlineRes = await stub.fetch("https://room/online");
              if (onlineRes.ok) {
                const online = await onlineRes.json<any>();
                const users = Array.isArray(online?.users) ? online.users : [];
                onlineHumanCount = users.filter((u: any) => {
                  const id = String(u?.id || "");
                  return id && !id.startsWith("openclaw:") && !id.startsWith("bot:") && !id.startsWith("guest");
                }).length;
              }
            } catch {}
            return {
              roomId: v.roomId,
              gameType: v.gameType,
              ownerId: String(snap?.ownerId || v.ownerId || ""),
              players: snap.players,
              status: snap.state?.status,
              moveCount: snap.state?.moveCount ?? 0,
              onlineHumanCount,
              spectateWs: `${wsBaseFromRequest(request)}/ws/room/${v.roomId}?role=spectator`,
            };
          }),
        );
        return json(rooms.filter(Boolean));
      }

      if (request.method === "POST" && url.pathname === "/api/match/join") {
        const me = await requireUser(request, env);
        const body = (await request.json()) as { roomId: string; inviteCode?: string };
        const lobby = (await storeGet(env, `lobby:${body.roomId}`, "json")) as any;
        if (!lobby) return json({ error: "room not found" }, 404);
        if (lobby.visibility === "private" && lobby.inviteCode !== body.inviteCode) return json({ error: "invalid invite code" }, 403);

        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        const command: RoomCommandRequest = {
          protocolVersion: "v1",
          roomId: body.roomId,
          actorType: "player",
          actorId: me.userId,
          command: { kind: "join", inviteCode: body.inviteCode },
        };
        const res = await stub.fetch("https://room/command", {
          method: "POST",
          body: JSON.stringify(command),
        });
        const payload = await res.json<any>();
        if (!res.ok) return json(payload, res.status);
        const joined = payload?.data || payload;
        const wsBase = wsBaseFromRequest(request);
        return json({
          ...joined,
          ws: {
            player: `${wsBase}/ws/room/${body.roomId}?token=${encodeURIComponent(joined.playerToken)}&role=player`,
            agent: `${wsBase}/ws/room/${body.roomId}?token=${encodeURIComponent(joined.playerToken)}&role=agent`,
          },
        });
      }

      if (request.method === "POST" && url.pathname === "/api/match/join-openclaw") {
        const me = await requireUser(request, env);
        const credential = await getClawCredential(env, me.userId);
        if (!credential) return json({ error: "openclaw is not bound" }, 403);
        const body = (await request.json()) as { roomId: string; inviteCode?: string };
        const lobby = (await storeGet(env, `lobby:${body.roomId}`, "json")) as any;
        if (!lobby) return json({ error: "room not found" }, 404);
        if (lobby.visibility === "private" && lobby.inviteCode !== body.inviteCode) return json({ error: "invalid invite code" }, 403);

        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        const command: RoomCommandRequest = {
          protocolVersion: "v1",
          roomId: body.roomId,
          actorType: "openclaw",
          actorId: `openclaw:${me.userId}`,
          command: { kind: "join", inviteCode: body.inviteCode },
        };
        const res = await stub.fetch("https://room/command", {
          method: "POST",
          body: JSON.stringify(command),
        });
        const payload = await res.json<any>();
        if (!res.ok) return json(payload, res.status);
        return json(payload?.data || payload);
      }

      if (request.method === "POST" && url.pathname === "/api/match/move") {
        const body = (await request.json()) as { roomId: string; playerToken: string; move: any };
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        const command: RoomCommandRequest = {
          protocolVersion: "v1",
          roomId: body.roomId,
          actorType: "player",
          playerToken: body.playerToken,
          command: { kind: "move", move: body.move },
        };
        const res = await stub.fetch("https://room/command", { method: "POST", body: JSON.stringify(command) });
        return passthrough(res);
      }

      if (request.method === "POST" && url.pathname === "/api/match/leave") {
        const body = (await request.json()) as { roomId: string; playerToken: string };
        if (!body.roomId || !body.playerToken) return json({ error: "roomId and playerToken are required" }, 400);
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        const res = await stub.fetch("https://room/leave", { method: "POST", body: JSON.stringify({ playerToken: body.playerToken }) });
        return passthrough(res);
      }

      if (request.method === "POST" && url.pathname === "/api/match/rematch") {
        const body = (await request.json()) as { roomId: string; playerToken: string; accept: boolean };
        if (!body.roomId || !body.playerToken) return json({ error: "roomId and playerToken are required" }, 400);
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        const res = await stub.fetch("https://room/rematch", {
          method: "POST",
          body: JSON.stringify({ playerToken: body.playerToken, accept: Boolean(body.accept) }),
        });
        return passthrough(res);
      }

      if (request.method === "POST" && url.pathname === "/api/room/reset") {
        const me = await requireUser(request, env);
        const body = (await request.json()) as { roomId: string };
        if (!body.roomId) return json({ error: "roomId is required" }, 400);
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        const res = await stub.fetch("https://room/room/reset", {
          method: "POST",
          body: JSON.stringify({ requesterId: me.userId }),
        });
        return passthrough(res);
      }

      if (request.method === "POST" && url.pathname === "/api/room/transfer-owner") {
        const me = await requireUser(request, env);
        const body = (await request.json()) as { roomId: string; targetUserId: string };
        if (!body.roomId || !body.targetUserId) return json({ error: "roomId and targetUserId are required" }, 400);
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        const res = await stub.fetch("https://room/owner/transfer", {
          method: "POST",
          body: JSON.stringify({ requesterId: me.userId, targetUserId: body.targetUserId }),
        });
        return passthrough(res);
      }

      if (request.method === "POST" && url.pathname === "/api/room/leave") {
        const me = await requireUser(request, env);
        const body = (await request.json()) as { roomId: string };
        if (!body.roomId) return json({ error: "roomId is required" }, 400);
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        const res = await stub.fetch("https://room/room/leave", {
          method: "POST",
          body: JSON.stringify({ requesterId: me.userId }),
        });
        return passthrough(res);
      }

      if (request.method === "POST" && url.pathname === "/api/room/join-bot") {
        const body = (await request.json()) as { roomId: string };
        if (!body.roomId) return json({ error: "roomId is required" }, 400);

        const ownerUserId = await requireClawTokenUser(request, env);
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        const stateRes = await stub.fetch("https://room/state");
        if (!stateRes.ok) return passthrough(stateRes);
        const state = await stateRes.json<any>();
        if (String(state?.ownerId || "") !== ownerUserId) {
          return json({ error: "only room owner can add bot" }, 403);
        }

        const res = await stub.fetch("https://room/room/join-bot", {
          method: "POST",
          body: JSON.stringify({ requesterId: ownerUserId }),
        });
        return passthrough(res);
      }

      if (request.method === "POST" && url.pathname === "/api/social/follow") {
        const me = await requireUser(request, env);
        const body = (await request.json()) as { targetUserId: string; follow?: boolean };
        const target = String(body.targetUserId || "");
        if (!target) return json({ error: "targetUserId is required" }, 400);
        if (target === me.userId) return json({ error: "cannot follow yourself" }, 400);
        const key = `follow:following:${me.userId}`;
        const current = ((await storeGet(env, key, "json")) as string[] | null) || [];
        const next = body.follow === false ? current.filter((id) => id !== target) : Array.from(new Set([...current, target]));
        await storePut(env, key, JSON.stringify(next));
        return json({ ok: true, following: next });
      }

      if (request.method === "GET" && url.pathname === "/api/social/following") {
        const me = await requireUser(request, env);
        const key = `follow:following:${me.userId}`;
        const following = ((await storeGet(env, key, "json")) as string[] | null) || [];
        return json({ following });
      }

      if (request.method === "GET" && url.pathname === "/api/social/followers") {
        const me = await requireUser(request, env);
        const list = await storeList(env, { prefix: "follow:following:" });
        const followers: string[] = [];
        for (const k of list.keys) {
          const fromUser = k.name.replace("follow:following:", "");
          const arr = ((await storeGet(env, k.name, "json")) as string[] | null) || [];
          if (arr.includes(me.userId)) followers.push(fromUser);
        }
        return json({ followers });
      }

      if (request.method === "GET" && url.pathname === "/api/social/followers-count") {
        const me = await requireUser(request, env);
        const targetUserId = String(url.searchParams.get("userId") || me.userId);
        const list = await storeList(env, { prefix: "follow:following:" });
        let count = 0;
        for (const k of list.keys) {
          const arr = ((await storeGet(env, k.name, "json")) as string[] | null) || [];
          if (arr.includes(targetUserId)) count += 1;
        }
        return json({ userId: targetUserId, followersCount: count });
      }

      if (request.method === "POST" && url.pathname === "/api/agent/join") {
        const body = (await request.json()) as AgentJoinRequest;
        if (!body.roomId) return json({ error: "roomId is required" }, 400);
        const credential = String(body.credential || "").trim();
        if (!credential) return json({ error: "credential is required" }, 400);
        const boundUserId = await resolveUserByCredential(env, credential);
        if (!boundUserId) return json({ error: "invalid credential" }, 401);

        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        const canonicalAgentId = String(boundUserId);
        const playerId = `openclaw:${canonicalAgentId}`;
        const joinRes = await stub.fetch("https://room/command", {
          method: "POST",
          body: JSON.stringify({
            protocolVersion: "v1",
            roomId: body.roomId,
            actorType: "openclaw",
            actorId: playerId,
            command: { kind: "join", inviteCode: body.inviteCode },
          } satisfies RoomCommandRequest),
        });
        const joinPayload = await joinRes.json<any>();
        if (!joinRes.ok) return json(joinPayload, joinRes.status);
        const joinData = joinPayload?.data || joinPayload;

        return json({
          roomId: body.roomId,
          agentId: canonicalAgentId,
          playerId,
          seat: joinData.seat,
          playerToken: joinData.playerToken,
          protocolVersion: "v1",
        });
      }

      if (request.method === "POST" && url.pathname === "/api/agent/login") {
        const body = (await request.json()) as AgentJoinRequest & { waitMs?: number };
        if (!body.roomId) return json({ error: "roomId is required" }, 400);
        const credential = String(body.credential || "").trim();
        if (!credential) return json({ error: "credential is required" }, 400);
        const boundUserId = await resolveUserByCredential(env, credential);
        if (!boundUserId) return json({ error: "invalid credential" }, 401);
        const canonicalAgentId = String(boundUserId);

        const joinReq = new Request("https://self/api/agent/join", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...body, agentId: canonicalAgentId }),
        });
        const joinResp = await this.fetch(joinReq, env);
        const joinData = await joinResp.json<any>();
        if (!joinResp.ok) return json(joinData, joinResp.status);

        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));

        const waitMs = Math.max(0, Math.min(60000, Number(body.waitMs ?? 30000)));
        const startedAt = Date.now();
        let state: any = null;

        const myPlayerId = String(joinData?.playerId || `openclaw:${canonicalAgentId}`);
        let seenHumanPlayer = false;
        while (Date.now() - startedAt < waitMs) {
          const stateRes = await stub.fetch("https://room/state");
          if (!stateRes.ok) return passthrough(stateRes);
          state = await stateRes.json<any>();

          const playersInLoop = Array.isArray(state?.players) ? state.players : [];
          const stillInRoom = playersInLoop.some((p: any) => p?.id === myPlayerId);
          if (!stillInRoom) {
            return json({
              protocolVersion: "v1",
              roomId: body.roomId,
              signal: "exit",
              reason: "player_left_room",
              ready: false,
            });
          }

          const status = String(state?.state?.status || "waiting");
          if (status !== "playing") {
            const humanPlayersInLoop = playersInLoop.filter((p: any) => !String(p?.id || "").startsWith("openclaw:"));
            if (humanPlayersInLoop.length > 0) {
              seenHumanPlayer = true;
            } else if (seenHumanPlayer) {
              return json({
                protocolVersion: "v1",
                roomId: body.roomId,
                signal: "exit",
                reason: "player_left_room",
                ready: false,
              });
            }
          }
          if (status === "playing" || status === "finished") break;
          await sleep(1000);
        }

        const players = Array.isArray(state?.players) ? state.players : [];
        const profileById: Record<string, any> = {};
        for (const p of players) {
          const key = p?.id?.startsWith("openclaw:") ? p.id.slice("openclaw:".length) : p?.id;
          if (!key) continue;
          profileById[p.id] = (await storeGet(env, `user:${key}`, "json")) || {};
        }

        const normalizeParticipantId = (id: string) => (id.startsWith("openclaw:") ? id.slice("openclaw:".length) : id);
        const myParticipantId = normalizeParticipantId(myPlayerId);
        const me = players.find((p: any) => p?.id === myPlayerId);
        const opponent = players.find((p: any) => {
          const id = String(p?.id || "");
          if (!id || id.startsWith("openclaw:")) return false;
          return normalizeParticipantId(id) !== myParticipantId;
        });
        const opponentOpenclaw = opponent ? players.find((p: any) => p?.id === `openclaw:${opponent.id}`) : null;
        const normalizedStatus = String(state?.state?.status || "waiting");
        const pollTimeoutsMs = agentPollTimeoutsForGame(String(state?.gameType || ""));

        return json({
          protocolVersion: "v1",
          roomId: body.roomId,
          gameType: state?.gameType || null,
          seat: me?.seat || joinData?.seat || null,
          playerToken: joinData?.playerToken || null,
          status: normalizedStatus,
          rules: buildAgentRules(String(state?.gameType || "")),
          pollConfig: {
            gameStarted: normalizedStatus === "playing" || normalizedStatus === "finished",
            pollTimeoutsMs,
          },
          players: {
            me: {
              id: myPlayerId,
              seat: me?.seat || joinData?.seat || null,
              clawName: profileById[myPlayerId]?.clawNickname || canonicalAgentId,
              credential,
            },
            opponent: opponent
              ? {
                  id: opponent.id,
                  seat: opponent.seat,
                  name: profileById[opponent.id]?.nickname || profileById[opponent.id]?.name || opponent.id,
                  openclawName: opponentOpenclaw ? (profileById[opponentOpenclaw.id]?.clawNickname || opponentOpenclaw.id) : null,
                }
              : null,
          },
          ready: normalizedStatus === "playing",
        });
      }

      if (request.method === "POST" && url.pathname === "/api/agent/msg") {
        const body = (await request.json()) as { roomId: string; senderId?: string; chatText?: string; credential?: string };
        if (!body.roomId) return json({ error: "roomId is required" }, 400);
        const credential = String(body.credential || "").trim();
        if (!credential) return json({ error: "credential is required" }, 400);
        const boundUserId = await resolveUserByCredential(env, credential);
        if (!boundUserId) return json({ error: "invalid credential" }, 401);
        const chatText = String(body.chatText || "").trim();
        if (!chatText) return json({ error: "chatText is required" }, 400);
        const senderId = `openclaw:${boundUserId}`;
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        const chatCommand: RoomCommandRequest = {
          protocolVersion: "v1",
          roomId: body.roomId,
          actorType: "openclaw",
          actorId: senderId,
          command: { kind: "chat", text: chatText },
        };
        const chatRes = await stub.fetch("https://room/command", {
          method: "POST",
          body: JSON.stringify(chatCommand),
        });
        return passthrough(chatRes);
      }

      if (request.method === "POST" && url.pathname === "/api/agent/exit") {
        const body = (await request.json()) as { roomId: string; playerToken?: string; waitMs?: number; credential?: string };
        if (!body.roomId) return json({ error: "roomId is required" }, 400);
        const credential = String(body.credential || "").trim();
        if (!credential) return json({ error: "credential is required" }, 400);
        const boundUserId = await resolveUserByCredential(env, credential);
        if (!boundUserId) return json({ error: "invalid credential" }, 401);
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        const playerId = `openclaw:${boundUserId}`;
        const leaveRes = await stub.fetch("https://room/agent/leave", {
          method: "POST",
          body: JSON.stringify({ playerId }),
        });
        if (!leaveRes.ok) return passthrough(leaveRes);
        return json({ ok: true, next: "end_session", reason: "exited" });
      }

      if (request.method === "POST" && url.pathname === "/api/agent/poll") {
        const body = (await request.json()) as AgentPollRequest & { agentId?: string; waitMs?: number; credential?: string };
        if (!body.roomId) return json({ error: "roomId is required" }, 400);
        const credential = String(body.credential || "").trim();
        if (!credential) return json({ error: "credential is required" }, 400);
        const boundUserId = await resolveUserByCredential(env, credential);
        if (!boundUserId) return json({ error: "invalid credential" }, 401);
        const agentPlayerId = `openclaw:${boundUserId}`;
        const canonicalAgentId = String(boundUserId);
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        await stub.fetch("https://room/agent/touch", { method: "POST" });
        const cursor = Number(body.sinceSeq || 0);
        const stateRes = await stub.fetch("https://room/state-for-player", {
          method: "POST",
          body: JSON.stringify({ playerId: agentPlayerId }),
        });
        const chatRes = await stub.fetch("https://room/chat");
        if (!stateRes.ok) return passthrough(stateRes);
        if (!chatRes.ok) return passthrough(chatRes);
        const state = await stateRes.json<any>();
        const chat = await chatRes.json<any>();

        const currentSeq = Number(state?.seq || chat?.seq || 0);
        const status = String(state?.state?.status || "waiting");
        const nextTurn = String(state?.state?.nextTurn || "");
        const players = Array.isArray(state?.players) ? state.players : [];

        const me = players.find((p: any) => p?.id === agentPlayerId) || null;

        const yourTurn = Boolean(me?.seat) && status === "playing" && nextTurn === me.seat;
        const gameOver = status === "finished";
        const keepAlive = Boolean(me);

        const messages = Array.isArray(chat?.messages)
          ? chat.messages.filter((m: any) => Number(m?.seq || 0) > cursor)
          : [];

        let message: any = null;
        if (gameOver) {
          message = {
            type: "gameover",
            status,
            winner: state?.state?.winner ?? "draw",
            moveCount: Number(state?.state?.moveCount || 0),
            state,
          };
        } else if (yourTurn) {
          message = {
            type: "yourturn",
            seat: me?.seat || null,
            state,
          };
        } else if (messages.length > 0) {
          const first = messages[0];
          message = {
            type: first.senderType === "system" ? "system" : "chat",
            payload: first,
          };
        } else if (currentSeq > cursor) {
          message = {
            type: status === "playing" ? "state_update" : "phase_change",
            nextTurn: nextTurn || null,
            status,
            state,
          };
        }

        const nextSeq = Math.max(cursor, currentSeq, ...messages.map((m: any) => Number(m?.seq || 0)));
        const finalMessage = message || {
          type: "idle",
          payload: { reason: keepAlive ? "no_event" : "agent_not_in_room" },
        };

        return json({
          protocolVersion: "v1",
          roomId: body.roomId,
          ts: Date.now(),
          seq: nextSeq,
          message: finalMessage,
          rules: buildAgentRules(String(state?.gameType || "")),
          supportedMessageTypes: AGENT_EVENT_TYPES,
          turn: {
            yourTurn,
            gameOver,
            haltForLlm: yourTurn,
            seat: me?.seat || null,
            nextTurn: nextTurn || null,
            status,
          },
          connection: {
            keepAlive,
            shouldDisconnect: !keepAlive || gameOver,
            reason: gameOver ? "game_over" : keepAlive ? "active" : "agent_not_in_room",
          },
        });
      }

      if (request.method === "POST" && url.pathname === "/api/agent/act") {
        const body = (await request.json()) as AgentActRequest;
        if (!body.roomId) return json({ error: "roomId is required" }, 400);
        const credential = String(body.credential || "").trim();
        if (!credential) return json({ error: "credential is required" }, 400);
        const boundUserId = await resolveUserByCredential(env, credential);
        if (!boundUserId) return json({ error: "invalid credential" }, 401);

        const actionId = String(body.actionId || "").trim();
        const dedupeKey = actionId ? `agent:act:${body.roomId}:${actionId}` : "";
        if (dedupeKey) {
          const existed = await storeGet(env, dedupeKey, "json");
          if (existed) return json(existed);
        }

        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        await stub.fetch("https://room/agent/touch", { method: "POST" });

        let moveResult: any = null;
        let chatResult: any = null;

        const playerId = `openclaw:${boundUserId}`;

        if (body.move !== undefined) {
          const buildCommand = (): RoomCommandRequest => ({
            protocolVersion: "v1",
            roomId: body.roomId,
            actorType: "openclaw",
            actorId: playerId,
            actionId: actionId || undefined,
            command: { kind: "move", move: body.move },
          });

          const moveRes = await stub.fetch("https://room/command", {
            method: "POST",
            body: JSON.stringify(buildCommand()),
          });

          if (!moveRes.ok) return passthrough(moveRes);
          moveResult = await moveRes.json<any>();
        }

        const chatText = String(body.chatText || "").trim();
        if (chatText) {
          const chatCommand: RoomCommandRequest = {
            protocolVersion: "v1",
            roomId: body.roomId,
            actorType: "openclaw",
            actorId: playerId,
            actionId: actionId || undefined,
            command: { kind: "chat", text: chatText },
          };
          const chatRes = await stub.fetch("https://room/command", {
            method: "POST",
            body: JSON.stringify(chatCommand),
          });
          if (!chatRes.ok) return passthrough(chatRes);
          chatResult = await chatRes.json<any>();
        }

        if (body.move === undefined && !chatText) {
          return json({ error: "either move or chatText is required" }, 400);
        }

        const result = { protocolVersion: "v1", roomId: body.roomId, actionId: actionId || undefined, move: moveResult, chat: chatResult };
        if (dedupeKey) {
          await storePut(env, dedupeKey, JSON.stringify(result), { expirationTtl: 60 * 60 });
        }
        return json(result);
      }

      if (request.method === "GET" && url.pathname.startsWith("/ws/room/")) {
        const roomId = url.pathname.split("/").pop();
        if (!roomId) return json({ error: "roomId is required" }, 400);
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(roomId));
        const wsReq = new Request(`https://room/ws${url.search}`, request);
        return stub.fetch(wsReq);
      }

      if (request.method === "GET" && url.pathname === "/api/match/state") {
        const roomId = url.searchParams.get("roomId");
        if (!roomId) return json({ error: "roomId is required" }, 400);
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(roomId));
        return passthrough(await stub.fetch("https://room/state"));
      }

      if (request.method === "GET" && url.pathname === "/api/room/state") {
        const roomId = url.searchParams.get("roomId");
        if (!roomId) return json({ error: "roomId is required" }, 400);
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(roomId));

        try {
          const me = await requireUser(request, env);
          const playerIds = [me.userId, `openclaw:${me.userId}`];
          for (const playerId of playerIds) {
            const res = await stub.fetch("https://room/state-for-player", {
              method: "POST",
              body: JSON.stringify({ playerId }),
            });
            if (!res.ok) continue;
            const payload = await res.json<any>();
            const players = Array.isArray(payload?.players) ? payload.players : [];
            if (players.some((player: any) => String(player?.id || "") === playerId)) {
              return json(payload, res.status);
            }
          }
        } catch {}

        return passthrough(await stub.fetch("https://room/state"));
      }

      if (request.method === "GET" && url.pathname === "/api/room/online") {
        const roomId = url.searchParams.get("roomId");
        if (!roomId) return json({ error: "roomId is required" }, 400);
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(roomId));
        return passthrough(await stub.fetch("https://room/online"));
      }

      if (request.method === "GET" && url.pathname === "/api/room/chat") {
        const roomId = url.searchParams.get("roomId");
        if (!roomId) return json({ error: "roomId is required" }, 400);
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(roomId));
        return passthrough(await stub.fetch("https://room/chat"));
      }

      if (request.method === "POST" && url.pathname === "/api/room/presence") {
        const me = await requireUser(request, env);
        const body = (await request.json()) as { roomId?: string };
        const roomId = String(body?.roomId || "").trim();
        if (!roomId) return json({ error: "roomId is required" }, 400);
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(roomId));
        return passthrough(await stub.fetch("https://room/presence/touch", {
          method: "POST",
          body: JSON.stringify({ userId: me.userId }),
        }));
      }

      if (request.method === "POST" && url.pathname === "/api/room/chat") {
        const body = (await request.json()) as { roomId: string; senderType: "user" | "openclaw" | "spectator"; senderId: string; text: string };
        if (!body.roomId) return json({ error: "roomId is required" }, 400);
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        const command: RoomCommandRequest = {
          protocolVersion: "v1",
          roomId: body.roomId,
          actorType: body.senderType === "openclaw" ? "openclaw" : "player",
          actorId: String(body.senderId || ""),
          command: { kind: "chat", text: String(body.text || "") },
        };
        const res = await stub.fetch("https://room/command", {
          method: "POST",
          body: JSON.stringify(command),
        });
        return passthrough(res);
      }

      if (request.method === "GET" && url.pathname === "/api/leaderboard") {
        const gameType = url.searchParams.get("gameType") || "gomoku";
        return json(await buildLeaderboardView(env, gameType));
      }

      if (request.method === "POST" && url.pathname === "/api/leaderboard/report") {
        const body = (await request.json()) as {
          gameType: string;
          winnerUserId?: string;
          loserUserId?: string;
          draw?: boolean;
          playerUserIds?: string[];
        };
        await updateLeaderboard(env, body.gameType, body.winnerUserId, body.loserUserId, {
          draw: Boolean(body.draw),
          playerUserIds: Array.isArray(body.playerUserIds) ? body.playerUserIds.map((x) => String(x || "")).filter(Boolean) : [],
        });
        return json({ ok: true });
      }

      if (request.method === "GET" || request.method === "HEAD") {
        const p = url.pathname;
        const needsSlash = new Set(["/login", "/lobby", "/settings", "/profile", "/game", "/u"]);
        if (needsSlash.has(p)) {
          const u = new URL(request.url);
          u.pathname = `${p}/`;
          return Response.redirect(u.toString(), 302);
        }
        if (p.startsWith("/u/") && p !== "/u/") {
          const u = new URL(request.url);
          u.pathname = "/u/";
          u.searchParams.set("uid", p.slice(3));
          return Response.redirect(u.toString(), 302);
        }
      }

      return fetch(request);
    } catch (err) {
      const msg = (err as Error).message || "internal error";
      const status = msg.startsWith("Unauthorized") ? 401 : 400;
      return json({ error: msg }, status);
    }
  },
};

const ROOM_ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_ID_LENGTH = 8;
const DEFAULT_AGENT_POLL_TIMEOUTS_MS = { waiting: 8000, playing: 8000, finished: 4000 } as const;
const AGENT_POLL_TIMEOUTS_BY_GAME: Record<string, { waiting: number; playing: number; finished: number }> = {
  gomoku: { waiting: 8000, playing: 8000, finished: 4000 },
  go: { waiting: 9000, playing: 9000, finished: 4000 },
  chess: { waiting: 9000, playing: 9000, finished: 4000 },
  xiangqi: { waiting: 9000, playing: 9000, finished: 4000 },
  texas_holdem: { waiting: 7000, playing: 7000, finished: 4000 },
  werewolf: { waiting: 7000, playing: 7000, finished: 4000 },
  junqi: { waiting: 9000, playing: 9000, finished: 4000 },
  who_is_undercover: { waiting: 7000, playing: 7000, finished: 4000 },
  guandan: { waiting: 8000, playing: 8000, finished: 4000 },
};

function agentPollTimeoutsForGame(gameType: string): { waiting: number; playing: number; finished: number } {
  const key = String(gameType || "").trim();
  return AGENT_POLL_TIMEOUTS_BY_GAME[key] || DEFAULT_AGENT_POLL_TIMEOUTS_MS;
}

function buildAgentRules(gameType: string): Record<string, unknown> {
  const key = String(gameType || "").trim();
  const rules = getGameRules(key, AGENT_EVENT_TYPES);
  try {
    const engine = getEngine(key);
    if (rules && typeof rules === "object" && !Array.isArray(rules)) {
      if (!("actionSchema" in rules) || !rules.actionSchema) {
        return { ...rules, actionSchema: engine.actionSchema };
      }
      return rules;
    }
    return { actionSchema: engine.actionSchema };
  } catch {
    return rules;
  }
}

function randomRoomId(): string {
  let value = "";
  for (let i = 0; i < ROOM_ID_LENGTH; i += 1) {
    const idx = Math.floor(Math.random() * ROOM_ID_CHARS.length);
    value += ROOM_ID_CHARS[idx];
  }
  return value;
}

async function allocateRoomId(env: Env): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const roomId = randomRoomId();
    const exists = await storeGet(env, `lobby:${roomId}`);
    if (!exists) return roomId;
  }
  throw new Error("failed to allocate room id");
}

async function removeDefaultLobbyRooms(env: Env): Promise<void> {
  const list = await storeList(env, { prefix: "lobby:" });
  await Promise.all(
    list.keys.map(async (k) => {
      const room = (await storeGet(env, k.name, "json")) as any;
      const roomId = String(room?.roomId || "");
      const isDefault = roomId.startsWith("DEFAULT-") || Boolean(room?.systemDefault);
      if (isDefault) {
        await storeDelete(env, k.name);
      }
    }),
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requireClawTokenUser(request: Request, env: Env): Promise<string> {
  const auth = String(request.headers.get("authorization") || "").trim();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1]?.trim() || "";
  if (!token) throw new Error("Unauthorized: missing bearer token");

  const credentialUserId = await resolveUserByCredential(env, token);
  if (credentialUserId) return credentialUserId;

  // Legacy compatibility for old UUID tokens only.
  const legacyUserId = await storeGet(env, `claw-token:${token}`);
  if (legacyUserId) return String(legacyUserId);

  throw new Error("Unauthorized: invalid credential or token");
}

function emptyStats() {
  return { wins: 0, losses: 0, draws: 0, totalGames: 0 };
}

function normalizeProfileName(profile: UserProfile | null, userId: string): string {
  if (!profile) return userId;
  return String(profile.nickname || profile.username || profile.name || profile.login || userId);
}

function summarizeProfile(profile: UserProfile | null, userId: string) {
  if (!profile) {
    return {
      userId,
      username: userId,
      avatarUrl: "",
      openclawName: "Claw",
      openclawAvatarUrl: "",
    };
  }
  return {
    userId,
    username: normalizeProfileName(profile, userId),
    avatarUrl: String(profile.avatarUrl || ""),
    openclawName: String(profile.clawNickname || "Claw"),
    openclawAvatarUrl: String(profile.clawAvatarUrl || ""),
  };
}

function getGameStats(profile: UserProfile | null, gameType: string) {
  if (!profile?.statsByGame?.[gameType]) return emptyStats();
  return {
    wins: Number(profile.statsByGame[gameType].wins || 0),
    losses: Number(profile.statsByGame[gameType].losses || 0),
    draws: Number(profile.statsByGame[gameType].draws || 0),
    totalGames: Number(profile.statsByGame[gameType].totalGames || 0),
  };
}

async function getProfileOrNull(env: Env, userId: string): Promise<UserProfile | null> {
  if (!userId) return null;
  try {
    return await getUserProfile(env, userId);
  } catch {
    return null;
  }
}

async function buildLeaderboardView(env: Env, gameType: string) {
  const data = ((await storeGet(env, `lb:${gameType}`, "json")) as LeaderboardEntry[]) ?? [];
  const rows = await Promise.all(
    data.map(async (entry) => {
      const profile = await getProfileOrNull(env, entry.userId);
      const overall = profile?.stats ?? emptyStats();
      const gameStats = getGameStats(profile, gameType);
      return {
        userId: entry.userId,
        rating: entry.rating,
        wins: gameStats.wins,
        losses: gameStats.losses,
        draws: gameStats.draws,
        totalGames: gameStats.totalGames,
        overallWins: Number(overall.wins || 0),
        overallTotalGames: Number(overall.totalGames || 0),
        profile: summarizeProfile(profile, entry.userId),
      };
    }),
  );

  return rows
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.totalGames !== a.totalGames) return b.totalGames - a.totalGames;
      return b.rating - a.rating;
    })
    .slice(0, 100);
}

async function buildLobbyOverview(request: Request, env: Env, gameType: string) {
  const list = await storeList(env, { prefix: "lobby:" });
  const lobbies = await Promise.all(list.keys.map(async (k) => (await storeGet(env, k.name, "json")) as any));
  const rooms = await Promise.all(
    lobbies
      .filter((room) => room?.visibility === "public" && room?.gameType === gameType)
      .map(async (room) => {
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(room.roomId));
        const [stateRes, onlineRes] = await Promise.all([
          stub.fetch("https://room/state"),
          stub.fetch("https://room/online"),
        ]);
        if (!stateRes.ok || !onlineRes.ok) return null;

        const snapshot = await stateRes.json<any>();
        const online = await onlineRes.json<any>();
        const ownerId = String(snapshot?.ownerId || room.ownerId || "");
        const ownerProfile = ownerId ? await getProfileOrNull(env, ownerId) : null;
        const onlineUsers = Array.isArray(online?.users) ? online.users : [];
        const onlineOpenclaw = Array.isArray(online?.openclaw) ? online.openclaw : [];
        const onlineSpectators = Array.isArray(online?.spectators) ? online.spectators : [];
        const participantIds = Array.from(
          new Set(
            [
              ...onlineUsers.map((item: any) => String(item?.id || "")),
              ...onlineOpenclaw.map((item: any) => String(item?.id || "").replace(/^openclaw:/, "")),
              ...onlineSpectators.map((item: any) => String(item?.id || "")),
            ]
              .filter(Boolean),
          ),
        );
        const profileMap = new Map(
          (await Promise.all(participantIds.map(async (id) => [id, await getProfileOrNull(env, id)] as const))),
        );

        const onlinePlayers = [
          ...onlineUsers.map((item: any) => {
            const userId = String(item?.id || "");
            const profile = profileMap.get(userId) || null;
            return {
              id: userId,
              type: "user",
              seat: String(item?.seat || ""),
              displayName: normalizeProfileName(profile, userId),
              avatarUrl: String(profile?.avatarUrl || ""),
            };
          }),
          ...onlineOpenclaw.map((item: any) => {
            const rawId = String(item?.id || "");
            const userId = rawId.replace(/^openclaw:/, "");
            const profile = profileMap.get(userId) || null;
            return {
              id: rawId,
              type: "openclaw",
              seat: String(item?.seat || ""),
              displayName: String(profile?.clawNickname || normalizeProfileName(profile, userId)),
              avatarUrl: String(profile?.clawAvatarUrl || profile?.avatarUrl || ""),
            };
          }),
          ...onlineSpectators.map((item: any) => {
            const userId = String(item?.id || "");
            const profile = profileMap.get(userId) || null;
            return {
              id: `spectator:${userId}`,
              type: "spectator",
              seat: "",
              displayName: normalizeProfileName(profile, userId),
              avatarUrl: String(profile?.avatarUrl || ""),
            };
          }),
        ];

        return {
          roomId: String(room.roomId),
          gameType: String(room.gameType),
          createdAt: Number(room.createdAt || 0),
          status: String(snapshot?.state?.status || "waiting"),
          ownerId,
          owner: summarizeProfile(ownerProfile, ownerId),
          onlineCount: onlinePlayers.length,
          spectatorCount: onlineSpectators.length,
          onlinePlayers,
        };
      }),
  );

  return rooms
    .filter(Boolean)
    .sort((a: any, b: any) => {
      const aPlaying = a.status === "playing" ? 1 : 0;
      const bPlaying = b.status === "playing" ? 1 : 0;
      if (bPlaying !== aPlaying) return bPlaying - aPlaying;
      if (b.onlineCount !== a.onlineCount) return b.onlineCount - a.onlineCount;
      return b.createdAt - a.createdAt;
    });
}

async function updateLeaderboard(
  env: Env,
  gameType: string,
  winnerId?: string,
  loserId?: string,
  opts: { draw?: boolean; playerUserIds?: string[] } = {},
): Promise<void> {
  const key = `lb:${gameType}`;
  const list = ((await storeGet(env, key, "json")) as LeaderboardEntry[]) ?? [];
  const map = new Map(list.map((x) => [x.userId, x.rating]));

  const draw = Boolean(opts.draw);
  const playerIds = Array.from(new Set((opts.playerUserIds || []).filter(Boolean)));

  if (!draw && winnerId && loserId && winnerId !== loserId) {
    const w = map.get(winnerId) ?? 1200;
    const l = map.get(loserId) ?? 1200;
    map.set(winnerId, w + 12);
    map.set(loserId, Math.max(800, l - 10));
  } else if (draw && playerIds.length === 2) {
    const [a, b] = playerIds;
    const ra = map.get(a) ?? 1200;
    const rb = map.get(b) ?? 1200;
    map.set(a, ra);
    map.set(b, rb);
  }

  const sorted = Array.from(map.entries())
    .map(([userId, rating]) => ({ userId, rating }))
    .sort((a, b) => b.rating - a.rating);

  await storePut(env, key, JSON.stringify(sorted));

  await Promise.all(
    sorted.slice(0, 100).map(async (entry, idx) => {
      const profile = (await storeGet(env, `user:${entry.userId}`, "json")) as UserProfile | null;
      if (!profile) return;
      const badges = Array.isArray(profile.badges) ? profile.badges : [];
      const badge = `${gameType}榜 #${idx + 1}`;
      if (!badges.includes(badge)) {
        profile.badges = [...badges, badge].slice(-20);
        profile.updatedAt = Date.now();
        await storePut(env, `user:${entry.userId}`, JSON.stringify(profile));
      }
    }),
  );

  const touched = new Set<string>();
  if (winnerId) touched.add(winnerId);
  if (loserId) touched.add(loserId);
  playerIds.forEach((id) => touched.add(id));

  await Promise.all(
    Array.from(touched).map(async (userId) => {
      const profile = (await storeGet(env, `user:${userId}`, "json")) as UserProfile | null;
      if (!profile) return;
      const stats = profile.stats ?? emptyStats();
      const statsByGame = profile.statsByGame ?? {};
      const gameStats = statsByGame[gameType] ?? emptyStats();

      if (draw) {
        if (playerIds.includes(userId)) {
          stats.draws += 1;
          stats.totalGames += 1;
          gameStats.draws += 1;
          gameStats.totalGames += 1;
        }
      } else {
        if (winnerId && userId === winnerId) {
          stats.wins += 1;
          stats.totalGames += 1;
          gameStats.wins += 1;
          gameStats.totalGames += 1;
        } else if (loserId && userId === loserId) {
          stats.losses += 1;
          stats.totalGames += 1;
          gameStats.losses += 1;
          gameStats.totalGames += 1;
        }
      }

      profile.stats = stats;
      profile.statsByGame = { ...statsByGame, [gameType]: gameStats };
      profile.updatedAt = Date.now();
      await storePut(env, `user:${userId}`, JSON.stringify(profile));
    }),
  );
}

async function countKvByPrefix(env: Env, prefix: string): Promise<number> {
  if (!env.DB) throw new Error("D1 binding 'DB' is required");
  await env.DB
    .prepare("CREATE TABLE IF NOT EXISTS app_kv (k TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)")
    .run();
  await env.DB
    .prepare("CREATE INDEX IF NOT EXISTS idx_app_kv_expires_at ON app_kv(expires_at)")
    .run();
  const nowSec = Math.floor(Date.now() / 1000);
  const row = await env.DB
    .prepare("SELECT COUNT(1) AS c FROM app_kv WHERE k LIKE ? AND (expires_at IS NULL OR expires_at > ?)")
    .bind(`${prefix}%`, nowSec)
    .first<{ c: number }>();
  return Number(row?.c || 0);
}
