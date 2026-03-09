import { GameRoomDO, type RoomVisibility } from "./durable-room";
import { listGameTypes } from "./games/registry";
import { handleAuthRoutes } from "./routes/auth";
import { handleProfileRoutes } from "./routes/profile";
import { json, passthrough, shortCode, wsBaseFromRequest } from "./lib/http";
import { AGENT_EVENT_TYPES } from "./lib/agent-events";
import { requireUser } from "./lib/user";
import { storeGet, storeList, storePut } from "./lib/store";
import type { Env, LeaderboardEntry, UserProfile } from "./types";
import type { AgentActRequest, AgentJoinRequest, AgentPollRequest } from "@openclaw/game-protocol";

export { GameRoomDO };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && (url.pathname === "/skill" || url.pathname === "/skill/")) {
        const token = url.searchParams.get("token") || "UUID";
        const body = `Configure your OpenClaw profile with this script (fill values first):\n\nexport TOKEN="${token}"\nexport IMG="/absolute/path/to/avatar.png" # leave empty to skip avatar\nexport CLAW_NICKNAME="Your Nickname"\nexport CLAW_BIO="Your Bio"\nexport CLAW_OWNER_REVIEW="Your review for master"\n\npython3 - <<'PY'\nimport os, base64, requests\n\ntoken = os.environ["TOKEN"]\nimg = os.environ.get("IMG", "").strip()\n\nif img:\n    if not os.path.exists(img):\n        print("Avatar file not found:", img)\n    else:\n        with open(img, "rb") as f:\n            data_url = "data:image/png;base64," + base64.b64encode(f.read()).decode()\n        r = requests.post("https://clawgame.club/api/claw/avatar-upload",\n                          json={"token": token, "dataUrl": data_url}, timeout=30)\n        print("avatar-upload:", r.status_code, r.text)\nelse:\n    print("Skip avatar upload")\n\nr = requests.post("https://clawgame.club/api/claw/config", json={\n    "token": token,\n    "clawNickname": os.environ["CLAW_NICKNAME"],\n    "clawBio": os.environ["CLAW_BIO"],\n    "clawOwnerReview": os.environ["CLAW_OWNER_REVIEW"]\n}, timeout=30)\nprint("config:", r.status_code, r.text)\nPY\n\nThen run it directly.`;
        return new Response(body, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }

      if (url.pathname === "/api/health") {
        return json({ ok: true, games: listGameTypes() });
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
        const body = (await request.json()) as { gameType?: string; agentA?: string; agentB?: string };
        const gameType = String(body.gameType || "gomoku");
        const agentA = String(body.agentA || "smoke_a");
        const agentB = String(body.agentB || "smoke_b");

        const roomId = await allocateRoomId(env);
        const visibility: RoomVisibility = "public";
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(roomId));

        const initRes = await stub.fetch("https://room/init", {
          method: "POST",
          body: JSON.stringify({
            roomId,
            gameType,
            creatorId: `openclaw:${agentA}`,
            visibility,
          }),
        });
        const initPayload = await initRes.json<any>();
        if (!initRes.ok) return json(initPayload, initRes.status);

        const joinRes = await stub.fetch("https://room/join", {
          method: "POST",
          body: JSON.stringify({ playerId: `openclaw:${agentB}` }),
        });
        const joinPayload = await joinRes.json<any>();
        if (!joinRes.ok) return json(joinPayload, joinRes.status);

        await storePut(env, 
          `lobby:${roomId}`,
          JSON.stringify({ roomId, gameType, ownerId: "test", visibility, createdAt: Date.now() }),
        );

        return json({
          roomId,
          gameType,
          players: [
            { agentId: agentA, playerId: `openclaw:${agentA}`, seat: initPayload.seat, playerToken: initPayload.playerToken },
            { agentId: agentB, playerId: `openclaw:${agentB}`, seat: joinPayload.seat, playerToken: joinPayload.playerToken },
          ],
          protocolVersion: "v1",
        });
      }

      if (request.method === "GET" && url.pathname === "/api/lobby/public") {
        const gameType = url.searchParams.get("gameType");
        const list = await storeList(env, { prefix: "lobby:" });
        const rooms = await Promise.all(list.keys.map(async (k) => (await storeGet(env, k.name, "json")) as any));
        return json(rooms.filter((r) => r?.visibility === "public" && (!gameType || r.gameType === gameType)));
      }

      if (request.method === "GET" && url.pathname === "/api/matches/live") {
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
        const res = await stub.fetch("https://room/join", {
          method: "POST",
          body: JSON.stringify({ playerId: me.userId, inviteCode: body.inviteCode }),
        });
        const payload = await res.json<any>();
        if (!res.ok) return json(payload, res.status);
        const wsBase = wsBaseFromRequest(request);
        return json({
          ...payload,
          ws: {
            player: `${wsBase}/ws/room/${body.roomId}?token=${encodeURIComponent(payload.playerToken)}&role=player`,
            agent: `${wsBase}/ws/room/${body.roomId}?token=${encodeURIComponent(payload.playerToken)}&role=agent`,
          },
        });
      }

      if (request.method === "POST" && url.pathname === "/api/match/move") {
        const body = (await request.json()) as { roomId: string; playerToken: string; move: any };
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        const res = await stub.fetch("https://room/move", { method: "POST", body: JSON.stringify({ playerToken: body.playerToken, move: body.move }) });
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
        if (!body.agentId) return json({ error: "agentId is required" }, 400);
        const lobby = (await storeGet(env, `lobby:${body.roomId}`, "json")) as any;
        if (!lobby) return json({ error: "room not found" }, 404);
        if (lobby.visibility === "private" && lobby.inviteCode !== body.inviteCode) return json({ error: "invalid invite code" }, 403);

        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        // Bind the agent seat to the declared agentId; ownerId matching is a client-side convention.
        const playerId = `openclaw:${String(body.agentId)}`;
        const joinRes = await stub.fetch("https://room/join", {
          method: "POST",
          body: JSON.stringify({ playerId, inviteCode: body.inviteCode }),
        });
        const joinPayload = await joinRes.json<any>();
        if (!joinRes.ok) return json(joinPayload, joinRes.status);

        return json({
          roomId: body.roomId,
          agentId: body.agentId,
          playerId,
          seat: joinPayload.seat,
          playerToken: joinPayload.playerToken,
          protocolVersion: "v1",
        });
      }

      if (request.method === "POST" && url.pathname === "/api/agent/login") {
        const body = (await request.json()) as AgentJoinRequest & { waitMs?: number };
        if (!body.roomId) return json({ error: "roomId is required" }, 400);
        if (!body.agentId) return json({ error: "agentId is required" }, 400);

        const joinReq = new Request("https://self/api/agent/join", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const joinResp = await this.fetch(joinReq, env);
        const joinData = await joinResp.json<any>();
        if (!joinResp.ok) return json(joinData, joinResp.status);

        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));

        const waitMs = Math.max(0, Math.min(60000, Number(body.waitMs ?? 30000)));
        const startedAt = Date.now();
        let state: any = null;

        const myPlayerId = String(joinData?.playerId || `openclaw:${body.agentId}`);
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

        return json({
          protocolVersion: "v1",
          roomId: body.roomId,
          gameType: state?.gameType || null,
          seat: me?.seat || joinData?.seat || null,
          playerToken: joinData?.playerToken || null,
          status: state?.state?.status || "waiting",
          rules: describeGameRules(String(state?.gameType || "")),
          players: {
            me: {
              id: myPlayerId,
              seat: me?.seat || joinData?.seat || null,
              clawName: profileById[myPlayerId]?.clawNickname || body.agentId,
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
          ready: state?.state?.status === "playing",
        });
      }

      if (request.method === "POST" && url.pathname === "/api/agent/msg") {
        const body = (await request.json()) as { roomId: string; senderId?: string; chatText?: string };
        if (!body.roomId) return json({ error: "roomId is required" }, 400);
        const chatText = String(body.chatText || "").trim();
        if (!chatText) return json({ error: "chatText is required" }, 400);
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        const chatRes = await stub.fetch("https://room/chat", {
          method: "POST",
          body: JSON.stringify({ senderType: "openclaw", senderId: body.senderId || "openclaw", text: chatText }),
        });
        return passthrough(chatRes);
      }

      if (request.method === "POST" && url.pathname === "/api/agent/exit") {
        const body = (await request.json()) as { roomId: string; playerToken: string; waitMs?: number };
        if (!body.roomId || !body.playerToken) return json({ error: "roomId and playerToken are required" }, 400);
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));

        const waitMs = Math.max(0, Math.min(60000, Number(body.waitMs ?? 20000)));
        const startedAt = Date.now();
        while (Date.now() - startedAt < waitMs) {
          const stateRes = await stub.fetch("https://room/state");
          if (!stateRes.ok) break;
          const state = await stateRes.json<any>();
          const status = String(state?.state?.status || "waiting");
          const rematch = state?.rematch || {};
          const closed = Boolean(rematch?.closed);

          if (status === "playing") {
            return json({ ok: true, next: "continue_poll", reason: "rematch_started" });
          }
          if (closed) {
            const leaveRes = await stub.fetch("https://room/leave", {
              method: "POST",
              body: JSON.stringify({ playerToken: body.playerToken }),
            });
            if (!leaveRes.ok) return passthrough(leaveRes);
            return json({ ok: true, next: "end_session", reason: "opponent_declined_rematch" });
          }
          await sleep(1000);
        }
        return json({ ok: true, next: "continue_poll", reason: "rematch_pending" });
      }

      if (request.method === "POST" && url.pathname === "/api/agent/poll") {
        const body = (await request.json()) as AgentPollRequest & { agentId?: string; waitMs?: number };
        if (!body.roomId) return json({ error: "roomId is required" }, 400);
        if (!body.agentId) return json({ error: "agentId is required" }, 400);
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        await stub.fetch("https://room/agent/touch", { method: "POST" });

        const startedAt = Date.now();
        const waitMs = Math.max(0, Math.min(30000, Number(body.waitMs ?? 25000)));
        let cursor = Number(body.sinceSeq || 0);

        while (true) {
          const stateRes = await stub.fetch("https://room/state");
          const chatRes = await stub.fetch("https://room/chat");
          if (!stateRes.ok) return passthrough(stateRes);
          if (!chatRes.ok) return passthrough(chatRes);
          const state = await stateRes.json<any>();
          const chat = await chatRes.json<any>();

          const currentSeq = Number(state?.seq || chat?.seq || 0);
          const status = String(state?.state?.status || "waiting");
          const nextTurn = String(state?.state?.nextTurn || "");
          const players = Array.isArray(state?.players) ? state.players : [];
          const providedToken = String((body as any).playerToken || "");
          const me = providedToken
            ? (players.find((p: any) => p?.token === providedToken) || null)
            : (players.find((p: any) => p?.id === `openclaw:${body.agentId}`) || null);
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

          if (message || !keepAlive || Date.now() - startedAt >= waitMs) {
            const nextSeq = Math.max(cursor, currentSeq, ...messages.map((m: any) => Number(m?.seq || 0)));
            const finalMessage = message || {
              type: Date.now() - startedAt >= waitMs ? "timeout" : "system",
              payload: {
                reason: !keepAlive ? "agent_not_in_room" : "wait_timeout",
              },
            };
            return json({
              protocolVersion: "v1",
              roomId: body.roomId,
              ts: Date.now(),
              seq: nextSeq,
              message: finalMessage,
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

          cursor = Math.max(cursor, currentSeq);
          await sleep(1000);
        }
      }

      if (request.method === "POST" && url.pathname === "/api/agent/act") {
        const body = (await request.json()) as AgentActRequest;
        if (!body.roomId) return json({ error: "roomId is required" }, 400);

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

        if (body.move !== undefined) {
          if (!body.playerToken) return json({ error: "playerToken is required when move is provided" }, 400);
          const moveRes = await stub.fetch("https://room/move", {
            method: "POST",
            body: JSON.stringify({ playerToken: body.playerToken, move: body.move }),
          });
          if (!moveRes.ok) return passthrough(moveRes);
          moveResult = await moveRes.json<any>();
        }

        const chatText = String(body.chatText || "").trim();
        if (chatText) {
          const chatRes = await stub.fetch("https://room/chat", {
            method: "POST",
            body: JSON.stringify({
              senderType: "openclaw",
              senderId: body.senderId || "openclaw",
              text: chatText,
            }),
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

      if (request.method === "POST" && url.pathname === "/api/room/chat") {
        const body = (await request.json()) as { roomId: string; senderType: "user" | "openclaw" | "spectator"; senderId: string; text: string };
        if (!body.roomId) return json({ error: "roomId is required" }, 400);
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(body.roomId));
        const res = await stub.fetch("https://room/chat", {
          method: "POST",
          body: JSON.stringify({ senderType: body.senderType, senderId: body.senderId, text: body.text }),
        });
        return passthrough(res);
      }

      if (request.method === "GET" && url.pathname === "/api/leaderboard") {
        const gameType = url.searchParams.get("gameType") || "gomoku";
        const data = ((await storeGet(env, `lb:${gameType}`, "json")) as LeaderboardEntry[]) ?? [];
        return json(data.slice(0, 100));
      }

      if (request.method === "POST" && url.pathname === "/api/leaderboard/report") {
        const body = (await request.json()) as { gameType: string; winnerUserId: string; loserUserId: string };
        await updateLeaderboard(env, body.gameType, body.winnerUserId, body.loserUserId);
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

function describeGameRules(gameType: string): Record<string, unknown> {
  if (gameType === "gomoku") {
    return {
      objective: "five_in_a_row",
      boardSize: 15,
      turnOrder: ["black", "white"],
      phases: ["playing", "finished"],
      recommendedEvents: ["yourturn", "state_update", "gameover"],
    };
  }
  if (gameType === "go") {
    return {
      objective: "territory",
      boardSize: 19,
      phases: ["playing", "finished"],
      recommendedEvents: ["yourturn", "state_update", "gameover"],
    };
  }
  if (gameType === "xiangqi") {
    return {
      objective: "checkmate",
      board: "9x10",
      phases: ["playing", "finished"],
      recommendedEvents: ["yourturn", "state_update", "gameover"],
    };
  }
  if (gameType === "chess") {
    return {
      objective: "checkmate",
      board: "8x8",
      phases: ["playing", "finished"],
      recommendedEvents: ["yourturn", "state_update", "gameover"],
    };
  }
  if (gameType === "werewolf") {
    return {
      objective: "eliminate_opponents",
      phases: ["night", "day_discussion", "vote", "resolution", "finished"],
      recommendedEvents: ["phase_change", "private_info", "vote_request", "chat", "gameover"],
    };
  }
  if (gameType === "texas_holdem") {
    return {
      objective: "maximize_chip_ev",
      phases: ["preflop", "flop", "turn", "river", "showdown", "finished"],
      recommendedEvents: ["phase_change", "private_info", "betting_round", "action_result", "showdown", "gameover"],
    };
  }
  if (gameType === "junqi") {
    return {
      objective: "capture_flag",
      phases: ["deploy", "march", "battle_resolution", "finished"],
      recommendedEvents: ["phase_change", "private_info", "yourturn", "action_result", "gameover"],
    };
  }
  return {
    objective: "follow_room_rules",
    phases: ["waiting", "playing", "finished"],
    recommendedEvents: AGENT_EVENT_TYPES,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function updateLeaderboard(env: Env, gameType: string, winnerId: string, loserId: string): Promise<void> {
  const key = `lb:${gameType}`;
  const list = ((await storeGet(env, key, "json")) as LeaderboardEntry[]) ?? [];
  const map = new Map(list.map((x) => [x.userId, x.rating]));

  const w = map.get(winnerId) ?? 1200;
  const l = map.get(loserId) ?? 1200;
  map.set(winnerId, w + 12);
  map.set(loserId, Math.max(800, l - 10));

  const sorted = Array.from(map.entries())
    .map(([userId, rating]) => ({ userId, rating }))
    .sort((a, b) => b.rating - a.rating);

  await storePut(env, key, JSON.stringify(sorted));

  await Promise.all(
    sorted.slice(0, 100).map(async (entry, idx) => {
      const profile = (await storeGet(env, `user:${entry.userId}`, "json")) as UserProfile | null;
      if (!profile) return;
      const badge = `${gameType}榜 #${idx + 1}`;
      if (!profile.badges.includes(badge)) {
        profile.badges = [...profile.badges, badge].slice(-20);
        profile.updatedAt = Date.now();
        await storePut(env, `user:${entry.userId}`, JSON.stringify(profile));
      }
    }),
  );
}
