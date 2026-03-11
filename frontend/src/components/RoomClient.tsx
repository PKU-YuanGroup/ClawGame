"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, API_BASE } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { getGameLabel, getGameTheme } from "@/lib/game-library";
import type { ProtocolEnvelope } from "@openclaw/game-protocol";

type ChatMessage = {
  id?: string;
  senderType?: "user" | "openclaw" | "spectator" | "system";
  senderId?: string;
  text?: string;
  ts?: number;
};

type OnlineItem = { id: string; seat?: string };
type OnlineData = { users: OnlineItem[]; openclaw: OnlineItem[]; spectators: OnlineItem[] };
type UserProfile = {
  id: string;
  nickname?: string;
  name?: string;
  avatarUrl?: string;
  clawNickname?: string;
  clawAvatarUrl?: string;
  badgeDetails?: Array<{ id?: string; nameZh?: string; nameEn?: string; imageUrl?: string }>;
};
type Me = {
  id: string;
  nickname?: string;
  name?: string;
  avatarUrl?: string;
  clawNickname?: string;
  clawAvatarUrl?: string;
  clawBio?: string;
  clawOwnerReview?: string;
  badgeDetails?: Array<{ id?: string; nameZh?: string; nameEn?: string; imageUrl?: string }>;
};
type RoomEvent = ProtocolEnvelope<{ messages?: ChatMessage[]; users?: OnlineItem[]; openclaw?: OnlineItem[]; spectators?: OnlineItem[] } | ChatMessage>;

const DEFAULT_AVATAR = "https://placehold.co/40x40/1e293b/e2e8f0?text=?";
const ME_CACHE_KEY = "me_cache_v1";

function getViewerId(userId?: string) {
  if (userId) return userId;
  if (typeof window === "undefined") return "guest";
  const key = "claw_viewer_id";
  try {
    const existed = window.localStorage?.getItem(key);
    if (existed) return existed;
    const v = `guest_${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage?.setItem(key, v);
    return v;
  } catch {
    return `guest_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function normalizeProfileId(id?: string) {
  if (!id) return "";
  if (id.startsWith("openclaw:")) return id.slice("openclaw:".length);
  return id;
}

function isBotId(id?: string) {
  return Boolean(id && (id.startsWith("bot:") || id.startsWith("openclaw:bot:")));
}

const CHESS_GLYPHS: Record<string, string> = {
  black_king: "♚",
  black_queen: "♛",
  black_rook: "♜",
  black_bishop: "♝",
  black_knight: "♞",
  black_pawn: "♟",
  white_king: "♔",
  white_queen: "♕",
  white_rook: "♖",
  white_bishop: "♗",
  white_knight: "♘",
  white_pawn: "♙",
};

const XIANGQI_GLYPHS: Record<string, string> = {
  black_general: "将",
  black_advisor: "士",
  black_elephant: "象",
  black_horse: "马",
  black_rook: "车",
  black_cannon: "炮",
  black_soldier: "卒",
  white_general: "帅",
  white_advisor: "仕",
  white_elephant: "相",
  white_horse: "马",
  white_rook: "车",
  white_cannon: "炮",
  white_soldier: "兵",
};

export function RoomClient({ roomId }: { roomId: string }) {
  const [me, setMe] = useState<Me | null>(null);
  const [meChecked, setMeChecked] = useState(false);
  const { lang, t } = useI18n();
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatOpenMobile, setChatOpenMobile] = useState(false);
  const [chatUnreadMobile, setChatUnreadMobile] = useState(false);
  const [online, setOnline] = useState<OnlineData>({ users: [], openclaw: [], spectators: [] });
  const [text, setText] = useState("");
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [snapshot, setSnapshot] = useState<any>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [wsReady, setWsReady] = useState(false);
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false);
  const [wsLatencyMs, setWsLatencyMs] = useState<number | null>(null);
  const [wsPacketLossPct, setWsPacketLossPct] = useState(0);
  const [joinRequested, setJoinRequested] = useState(false);
  const [playerToken, setPlayerToken] = useState("");
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [botJoining, setBotJoining] = useState(false);
  const [botRemoving, setBotRemoving] = useState(false);
  const joinGameTimerRef = useRef<number | null>(null);
  const joinBotTimerRef = useRef<number | null>(null);
  const removeBotLockRef = useRef(false);
  const removeBotTimerRef = useRef<number | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: string; text: string; level: "error" | "info" }>>([]);
  const [gameOverWinner, setGameOverWinner] = useState<string>("");
  const [moveHistory, setMoveHistory] = useState<Array<{ id: string; actorId: string; seat: string; text: string }>>([]);
  const [nowTs, setNowTs] = useState(Date.now());
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [followSubmittingId, setFollowSubmittingId] = useState("");
  const [profileCard, setProfileCard] = useState<{ id: string; type: "user" | "openclaw" } | null>(null);
  const [profileFollowersCount, setProfileFollowersCount] = useState(0);
  const [rematchSubmitting, setRematchSubmitting] = useState(false);
  const [roomResetting, setRoomResetting] = useState(false);
  const [roomLeaving, setRoomLeaving] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [showBindGuard, setShowBindGuard] = useState(false);
  const myOpenclawId = me?.id ? `openclaw:${me.id}` : "";
  const myOpenclawJoined = Boolean(myOpenclawId)
    && Array.isArray(snapshot?.players)
    && snapshot.players.some((p: any) => p?.id === myOpenclawId);
  const hasBoundOpenClaw = Boolean(
    me?.id && String(me?.clawBio || "").trim() && String(me?.clawOwnerReview || "").trim(),
  );
  const reconnectTimerRef = useRef<number | null>(null);
  const retryRef = useRef(0);
  const pingTimerRef = useRef<number | null>(null);
  const pingSentAtRef = useRef<number | null>(null);
  const pingSentRef = useRef(0);
  const pingAckRef = useRef(0);
  const pingLostRef = useRef(0);

  useEffect(() => {
    let hasCached = false;
    try {
      const cachedRaw = localStorage.getItem(ME_CACHE_KEY);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw) as Me;
        if (cached?.id) {
          setMe(cached);
          setMeChecked(true);
          hasCached = true;
        }
      }
    } catch {}

    api<Me>("/api/me")
      .then((d) => {
        setMe(d || null);
        if (d?.id) localStorage.setItem(ME_CACHE_KEY, JSON.stringify(d));
        else localStorage.removeItem(ME_CACHE_KEY);
      })
      .catch(() => {
        if (!hasCached) setMe(null);
      })
      .finally(() => setMeChecked(true));
  }, []);

  useEffect(() => {
    if (!me?.id) return;
    setProfiles((prev) => ({
      ...prev,
      [me.id]: {
        ...(prev[me.id] || { id: me.id }),
        id: me.id,
        nickname: me.nickname ?? prev[me.id]?.nickname,
        name: me.name ?? prev[me.id]?.name,
        avatarUrl: me.avatarUrl ?? prev[me.id]?.avatarUrl,
        clawNickname: me.clawNickname ?? prev[me.id]?.clawNickname,
        clawAvatarUrl: me.clawAvatarUrl ?? prev[me.id]?.clawAvatarUrl,
        badgeDetails: me.badgeDetails ?? prev[me.id]?.badgeDetails,
      },
    }));
  }, [me]);

  useEffect(() => {
    if (!me?.id) {
      setFollowingIds([]);
      return;
    }
    api<{ following: string[] }>("/api/social/following").then((res) => {
      setFollowingIds(Array.isArray(res.following) ? res.following : []);
    }).catch(() => setFollowingIds([]));
  }, [me?.id]);

  useEffect(() => {
    if (!roomId || !meChecked) return;
    let cancelled = false;
    let w: WebSocket | null = null;

    const scheduleReconnect = () => {
      if (cancelled) return;
      const delay = Math.min(5000, 600 + retryRef.current * 700);
      retryRef.current += 1;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = window.setTimeout(() => {
        void connect();
      }, delay);
    };

    async function connect() {
      try {
        const base = new URL(API_BASE || window.location.origin, window.location.origin);
        const wsProtocol = base.protocol === "https:" ? "wss:" : "ws:";
        const url = `${wsProtocol}//${base.host}/ws/room/${roomId}?role=spectator&viewerId=${encodeURIComponent(getViewerId(me?.id))}`;

        if (cancelled) return;
        w = new WebSocket(url);
        setWs(w);

        w.onopen = () => {
          retryRef.current = 0;
          pingSentRef.current = 0;
          pingAckRef.current = 0;
          pingLostRef.current = 0;
          pingSentAtRef.current = null;
          setWsLatencyMs(null);
          setWsPacketLossPct(0);
          setWsReady(true);
          setHasConnectedOnce(true);
          if (pingTimerRef.current) window.clearInterval(pingTimerRef.current);
          pingTimerRef.current = window.setInterval(() => {
            if (!w || w.readyState !== WebSocket.OPEN) return;
            const now = Date.now();
            if (pingSentAtRef.current && now - pingSentAtRef.current > 5000) {
              pingLostRef.current += 1;
              pingSentAtRef.current = null;
              const total = pingAckRef.current + pingLostRef.current;
              setWsPacketLossPct(total > 0 ? Number(((pingLostRef.current / total) * 100).toFixed(1)) : 0);
            }
            if (pingSentAtRef.current) return;
            pingSentRef.current += 1;
            pingSentAtRef.current = now;
            w.send(JSON.stringify({ type: "ping" }));
          }, 2000);
        };
        w.onclose = () => {
          setWsReady(false);
          setWsLatencyMs(null);
          setJoining(false);
          setBotJoining(false);
          setBotRemoving(false);
          removeBotLockRef.current = false;
          if (joinGameTimerRef.current) {
            window.clearTimeout(joinGameTimerRef.current);
            joinGameTimerRef.current = null;
          }
          if (joinBotTimerRef.current) {
            window.clearTimeout(joinBotTimerRef.current);
            joinBotTimerRef.current = null;
          }
          if (removeBotTimerRef.current) {
            window.clearTimeout(removeBotTimerRef.current);
            removeBotTimerRef.current = null;
          }
          if (pingTimerRef.current) {
            window.clearInterval(pingTimerRef.current);
            pingTimerRef.current = null;
          }
          pingSentAtRef.current = null;
          scheduleReconnect();
        };
        w.onerror = () => {
          setWsReady(false);
          setJoining(false);
          setBotJoining(false);
          setBotRemoving(false);
          removeBotLockRef.current = false;
          if (joinGameTimerRef.current) {
            window.clearTimeout(joinGameTimerRef.current);
            joinGameTimerRef.current = null;
          }
          if (joinBotTimerRef.current) {
            window.clearTimeout(joinBotTimerRef.current);
            joinBotTimerRef.current = null;
          }
          if (removeBotTimerRef.current) {
            window.clearTimeout(removeBotTimerRef.current);
            removeBotTimerRef.current = null;
          }
        };

        w.onmessage = (e) => {
          const m = JSON.parse(e.data || "{}") as Partial<RoomEvent>;
          const eventType = String((m as any)?.type || "");
          if (eventType === "pong") {
            if (pingSentAtRef.current) {
              const rtt = Date.now() - pingSentAtRef.current;
              setWsLatencyMs(rtt);
              pingAckRef.current += 1;
              pingSentAtRef.current = null;
              const total = pingAckRef.current + pingLostRef.current;
              setWsPacketLossPct(total > 0 ? Number(((pingLostRef.current / total) * 100).toFixed(1)) : 0);
            }
            return;
          }
          if (eventType === "chat") {
            const incoming = (m.payload || {}) as ChatMessage;
            setChat((v) => {
              const exists = Boolean(incoming.id && v.some((x) => x.id === incoming.id));
              if (!exists && !chatOpenMobile) setChatUnreadMobile(true);
              return exists ? v : [...v, incoming];
            });
          }
          if (eventType === "error") {
            setJoining(false);
            setBotJoining(false);
            setBotRemoving(false);
            removeBotLockRef.current = false;
            if (joinGameTimerRef.current) {
              window.clearTimeout(joinGameTimerRef.current);
              joinGameTimerRef.current = null;
            }
            if (joinBotTimerRef.current) {
              window.clearTimeout(joinBotTimerRef.current);
              joinBotTimerRef.current = null;
            }
            if (removeBotTimerRef.current) {
              window.clearTimeout(removeBotTimerRef.current);
              removeBotTimerRef.current = null;
            }
          }
          if (eventType === "action_result") {
            const payload = (m.payload || {}) as any;
            if (payload.kind === "join_game") {
              setJoining(false);
              if (joinGameTimerRef.current) {
                window.clearTimeout(joinGameTimerRef.current);
                joinGameTimerRef.current = null;
              }
              if (payload.ok && payload.playerToken) {
                setPlayerToken(String(payload.playerToken));
                setJoinRequested(true);
              }
            }
            if (payload.kind === "leave_game") {
              setLeaving(false);
              if (payload.ok) {
                setPlayerToken("");
                setJoinRequested(false);
                setText("");
              }
            }
            if (payload.kind === "join_bot") {
              setBotJoining(false);
              if (joinBotTimerRef.current) {
                window.clearTimeout(joinBotTimerRef.current);
                joinBotTimerRef.current = null;
              }
              if (!payload.ok) {
                pushToast(String(payload.error || t("room.toastJoinBotFailed")), "error");
              }
            }
            if (payload.kind === "remove_bot") {
              setBotRemoving(false);
              removeBotLockRef.current = false;
              if (removeBotTimerRef.current) {
                window.clearTimeout(removeBotTimerRef.current);
                removeBotTimerRef.current = null;
              }
              void refreshRoomPresence();
              if (!payload.ok) {
                pushToast(String(payload.error || t("room.toastRemoveBotFailed")), "error");
              }
            }
            if (payload?.ok && payload?.actor && payload?.move) {
              let moveText = "-";
              if (typeof payload.move?.x === "number" && typeof payload.move?.y === "number") {
                moveText = `(${payload.move.x + 1}, ${payload.move.y + 1})`;
              } else if (typeof payload.move?.from === "string" && typeof payload.move?.to === "string") {
                moveText = `${payload.move.from} -> ${payload.move.to}`;
              } else if (typeof payload.move?.action === "string") {
                moveText = payload.move.amount ? `${payload.move.action} ${payload.move.amount}` : payload.move.action;
              } else if (typeof payload.move === "string") {
                moveText = payload.move;
              } else {
                moveText = JSON.stringify(payload.move);
              }
              const entry = {
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                actorId: String(payload.actor),
                seat: String(payload.seat || "-"),
                text: moveText,
              };
              setMoveHistory((prev) => [...prev.slice(-11), entry]);
            }
          }
          if (eventType === "game_over") {
            setMoveHistory([]);
            const payload = (m.payload || {}) as any;
            setGameOverWinner(String(payload?.winner || "draw"));
          }
          if (eventType === "chat_history") {
            const p = (m.payload || {}) as { messages?: ChatMessage[] };
            setChat(Array.isArray(p.messages) ? p.messages : []);
          }
          if (eventType === "sync_state" || eventType === "state_update") {
            setSnapshot(m.payload || null);
          }
          if (eventType === "online_update") {
            const p = (m.payload || {}) as { users?: OnlineItem[]; openclaw?: OnlineItem[]; spectators?: OnlineItem[] };
            setOnline({
              users: Array.isArray(p.users) ? p.users : [],
              openclaw: Array.isArray(p.openclaw) ? p.openclaw : [],
              spectators: Array.isArray(p.spectators) ? p.spectators : [],
            });
          }
        };
      } catch {
        setWsReady(false);
        scheduleReconnect();
      }
    }

    void connect();
    return () => {
      cancelled = true;
      setWsReady(false);
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (pingTimerRef.current) {
        window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      if (joinGameTimerRef.current) {
        window.clearTimeout(joinGameTimerRef.current);
        joinGameTimerRef.current = null;
      }
      if (joinBotTimerRef.current) {
        window.clearTimeout(joinBotTimerRef.current);
        joinBotTimerRef.current = null;
      }
      if (removeBotTimerRef.current) {
        window.clearTimeout(removeBotTimerRef.current);
        removeBotTimerRef.current = null;
      }
      pingSentAtRef.current = null;
      if (w && (w.readyState === WebSocket.OPEN || w.readyState === WebSocket.CONNECTING)) w.close();
    };
  }, [roomId, meChecked, me?.id]);

  useEffect(() => {
    const ids = Array.from(
      new Set([
        ...online.users,
        ...online.openclaw,
        ...online.spectators,
        ...chat.map((m) => ({ id: m.senderId || "" })),
      ]
        .map((u: any) => normalizeProfileId(u.id))
        .filter((id) => id && !id.startsWith("guest") && (!profiles[id] || !Array.isArray(profiles[id]?.badgeDetails)))),
    );
    if (!ids.length) return;
    ids.forEach((id) => {
      api(`/api/profile?userId=${encodeURIComponent(id)}`)
        .then((p: any) => setProfiles((prev) => ({ ...prev, [id]: p || { id } })))
        .catch(() => setProfiles((prev) => ({ ...prev, [id]: { id } })));
    });
  }, [online, chat, profiles]);

  function pushToast(text: string, level: "error" | "info" = "info") {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { id, text, level }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4600);
  }

  async function joinGame() {
    if (!me?.id || !roomId || joining) return;
    if (!hasBoundOpenClaw) {
      setShowBindGuard(true);
      return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      pushToast(t("room.toastWsNotConnected"), "error");
      return;
    }
    setJoining(true);
    if (joinGameTimerRef.current) window.clearTimeout(joinGameTimerRef.current);
    joinGameTimerRef.current = window.setTimeout(() => {
      setJoining(false);
      joinGameTimerRef.current = null;
      pushToast("Join timeout, please try again.", "error");
      void refreshRoomPresence();
    }, 8000);
    ws.send(JSON.stringify({ type: "join_game", payload: { playerId: me.id } }));
  }

  async function submitRematch(accept: boolean) {
    if (!roomId || !playerToken || rematchSubmitting) return;
    setRematchSubmitting(true);
    try {
      await api("/api/match/rematch", {
        method: "POST",
        body: JSON.stringify({ roomId, playerToken, accept }),
      });
      if (!accept) {
        await leaveGame();
      }
    } finally {
      setRematchSubmitting(false);
    }
  }

  async function leaveGame() {
    if (leaving) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    setLeaving(true);
    ws.send(JSON.stringify({ type: "leave_game" }));
  }

  async function resetRoom() {
    if (!roomId || roomResetting) return;
    setRoomResetting(true);
    try {
      await api("/api/room/reset", {
        method: "POST",
        body: JSON.stringify({ roomId }),
      });
      pushToast(t("room.toastRoomResetSuccess"), "info");
    } catch (err) {
      pushToast((err as Error).message || t("room.toastRoomResetFailed"), "error");
    } finally {
      setRoomResetting(false);
    }
  }

  async function leaveRoomAsOwner() {
    if (!roomId || roomLeaving) return;
    setRoomLeaving(true);
    try {
      await api("/api/room/leave", {
        method: "POST",
        body: JSON.stringify({ roomId }),
      });
      setPlayerToken("");
      setJoinRequested(false);
      setText("");
      pushToast(t("room.toastLeaveRoomSuccess"), "info");
    } catch (err) {
      pushToast((err as Error).message || t("room.toastLeaveRoomFailed"), "error");
    } finally {
      setRoomLeaving(false);
    }
  }

  async function transferOwner(targetUserId: string) {
    if (!roomId || !targetUserId) return;
    try {
      await api("/api/room/transfer-owner", {
        method: "POST",
        body: JSON.stringify({ roomId, targetUserId }),
      });
      pushToast(t("room.toastTransferOwnerSuccess"), "info");
    } catch (err) {
      pushToast((err as Error).message || t("room.toastTransferOwnerFailed"), "error");
    }
  }

  async function toggleFollow(targetUserId: string) {
    if (!targetUserId || !me?.id || followSubmittingId) return;
    const isFollowing = followingIds.includes(targetUserId);
    setFollowSubmittingId(targetUserId);
    try {
      const res = await api<{ following: string[] }>("/api/social/follow", {
        method: "POST",
        body: JSON.stringify({ targetUserId, follow: !isFollowing }),
      });
      setFollowingIds(Array.isArray(res.following) ? res.following : []);
    } catch (err) {
      pushToast((err as Error).message || t("room.toastFollowFailed"), "error");
    } finally {
      setFollowSubmittingId("");
    }
  }

  async function openProfileCard(id: string, type: "user" | "openclaw") {
    if (!id) return;
    setProfileCard({ id, type });
    if (type === "openclaw") {
      setProfileFollowersCount(0);
      return;
    }
    try {
      const res = await api<{ followersCount: number }>(`/api/social/followers-count?userId=${encodeURIComponent(id)}`);
      setProfileFollowersCount(Number(res.followersCount || 0));
    } catch {
      setProfileFollowersCount(0);
    }
  }

  function joinBot() {
    if (botJoining) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      pushToast(t("room.toastWsNotConnected"), "error");
      return;
    }
    setBotJoining(true);
    if (joinBotTimerRef.current) window.clearTimeout(joinBotTimerRef.current);
    joinBotTimerRef.current = window.setTimeout(() => {
      setBotJoining(false);
      joinBotTimerRef.current = null;
      pushToast(t("room.toastJoinBotTimeout"), "error");
      void refreshRoomPresence();
    }, 8000);
    ws.send(JSON.stringify({ type: "join_bot" }));
  }

  async function refreshRoomPresence() {
    try {
      const [state, onlineRes] = await Promise.all([
        api<any>(`/api/room/state?roomId=${encodeURIComponent(roomId)}`),
        api<any>(`/api/room/online?roomId=${encodeURIComponent(roomId)}`),
      ]);
      if (state) setSnapshot(state);
      if (onlineRes) {
        setOnline({
          users: Array.isArray(onlineRes?.users) ? onlineRes.users : [],
          openclaw: Array.isArray(onlineRes?.openclaw) ? onlineRes.openclaw : [],
          spectators: Array.isArray(onlineRes?.spectators) ? onlineRes.spectators : [],
        });
      }
    } catch {}
  }

  function removeBot(botId?: string) {
    if (botRemoving || removeBotLockRef.current || statusText !== "waiting") return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      pushToast(t("room.toastWsNotConnected"), "error");
      return;
    }
    removeBotLockRef.current = true;
    setBotRemoving(true);
    if (removeBotTimerRef.current) window.clearTimeout(removeBotTimerRef.current);
    removeBotTimerRef.current = window.setTimeout(() => {
      removeBotLockRef.current = false;
      setBotRemoving(false);
      void refreshRoomPresence();
    }, 6000);
    ws.send(JSON.stringify({ type: "remove_bot", payload: botId ? { botId } : {} }));
  }

  function sendChat() {
    const v = text.trim();
    if (!me?.id || !canChat) return;
    if (!v || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "chat_send", payload: { text: v } }));
    setText("");
  }

  const openclawPrompt = useMemo(() => {
    if (!roomId) return "";
    // For CLI connectivity, prefer the page origin so copied prompt matches the active deployment.
    const base = typeof window !== "undefined" ? window.location.origin : (API_BASE || "");
    const suggestedAgentId = String(me?.id || "your-openclaw-agent-id");

    if (lang === "en") {
      return [
        "Quick Start (clawgame-cli)",
        `BASE_URL=${base}`,
        `ROOM_ID=${roomId}`,
        `AGENT_ID=${suggestedAgentId}`,
        "",
        "1) login (wait until match starts)",
        'clawgame-cli --base-url "$BASE_URL" --room-id "$ROOM_ID" --agent-id "$AGENT_ID" login --wait-ms 0',
        "",
        "2) poll loop",
        'clawgame-cli --base-url "$BASE_URL" --room-id "$ROOM_ID" --agent-id "$AGENT_ID" poll --wait-ms 25000',
        "",
        "3) on yourturn -> act once",
        'clawgame-cli --base-url "$BASE_URL" --room-id "$ROOM_ID" --agent-id "$AGENT_ID" act --move-json ...',
        "",
        "4) on gameover -> exit",
        'clawgame-cli --base-url "$BASE_URL" --room-id "$ROOM_ID" --agent-id "$AGENT_ID" exit --wait-ms 20000',
      ].join("\n");
    }

    return [
      "快速开始（clawgame-cli）",
      `BASE_URL=${base}`,
      `ROOM_ID=${roomId}`,
      `AGENT_ID=${suggestedAgentId}`,
      "",
      "1）登录并等待开局",
      'clawgame-cli --base-url "$BASE_URL" --room-id "$ROOM_ID" --agent-id "$AGENT_ID" login --wait-ms 0',
      "",
      "2）进入 poll 循环",
      'clawgame-cli --base-url "$BASE_URL" --room-id "$ROOM_ID" --agent-id "$AGENT_ID" poll --wait-ms 25000',
      "",
      "3）收到 yourturn 后执行一步 act",
      'clawgame-cli --base-url "$BASE_URL" --room-id "$ROOM_ID" --agent-id "$AGENT_ID" act --move-json ...',
      "",
      "4）收到 gameover 后执行 exit",
      'clawgame-cli --base-url "$BASE_URL" --room-id "$ROOM_ID" --agent-id "$AGENT_ID" exit --wait-ms 20000',
    ].join("\n");
  }, [lang, roomId, me?.id]);

  async function copyOpenclawPrompt() {
    if (!openclawPrompt) return;
    await navigator.clipboard.writeText(openclawPrompt);
    setPromptCopied(true);
    window.setTimeout(() => setPromptCopied(false), 1500);
  }

  function profileByAnyId(id?: string) {
    const profileId = normalizeProfileId(id);
    return profiles[id || ""] || profiles[profileId] || null;
  }

  function displayNameById(id?: string, senderType?: ChatMessage["senderType"]) {
    const profileId = normalizeProfileId(id);
    if (!profileId || profileId.startsWith("guest")) return t("room.guest");
    if (isBotId(id) || isBotId(profileId)) return t("room.botName");
    const p = profileByAnyId(id);
    if (senderType === "openclaw") {
      return p?.clawNickname || me?.clawNickname || p?.nickname || me?.nickname || p?.name || me?.name || profileId;
    }
    return p?.nickname || p?.name || profileId;
  }

  function avatarById(id?: string, senderType?: ChatMessage["senderType"]) {
    const profileId = normalizeProfileId(id);
    if (!profileId || profileId.startsWith("guest")) return DEFAULT_AVATAR;
    if (isBotId(id) || isBotId(profileId)) return "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f916.png";
    const p = profileByAnyId(id);
    if (senderType === "openclaw") {
      return p?.clawAvatarUrl || me?.clawAvatarUrl || p?.avatarUrl || me?.avatarUrl || DEFAULT_AVATAR;
    }
    return p?.avatarUrl || DEFAULT_AVATAR;
  }

  const allOnlineCount = online.users.length + online.openclaw.length + online.spectators.length;
  const joinedAsPlayer = Boolean(playerToken) && myOpenclawJoined;
  const gameState = snapshot?.state || {};
  const ownerId = String(snapshot?.ownerId || "");
  const isOwner = Boolean(me?.id)
    && (ownerId === me?.id || normalizeProfileId(ownerId) === normalizeProfileId(me?.id));
  const canChat = joinedAsPlayer || isOwner;
  const openclawParticipantIds = new Set<string>(
    (Array.isArray(snapshot?.players) ? snapshot.players : [])
      .map((p: any) => String(p?.id || ""))
      .filter((id: string) => id.startsWith("openclaw:"))
      .map((id: string) => id.slice("openclaw:".length)),
  );
  const realPlayers: Array<{ id: string }> = Array.from<string>(new Set(
    (Array.isArray(snapshot?.players) ? snapshot.players : [])
      .map((p: any) => String(p?.id || ""))
      .filter((id: string) => Boolean(id)
        && !id.startsWith("openclaw:")
        && !id.startsWith("bot:")
        && !id.startsWith("guest")
        && openclawParticipantIds.has(id)),
  )).map((id: string) => ({ id }));
  const botPlayers: Array<{ id: string }> = Array.from<string>(new Set(
    (Array.isArray(snapshot?.players) ? snapshot.players : [])
      .map((p: any) => String(p?.id || ""))
      .filter((id: string) => Boolean(id) && id.startsWith("bot:")),
  )).map((id: string) => ({ id }));
  const gameType = snapshot?.gameType || gameState?.gameType || "gomoku";
  const gameLabel = getGameLabel(gameType, lang);
  const gameTheme = getGameTheme(gameType);
  const supportsBot = ["gomoku", "go", "xiangqi", "chess", "texas_holdem", "werewolf", "junqi", "who_is_undercover"].includes(gameType);
  const boardSize = Number(gameState?.size || gameState?.boardSize || (Array.isArray(gameState?.board) ? gameState.board.length : 15));
  const board = Array.isArray(gameState?.board) ? gameState.board : [];
  const boardHeight = Number(gameState?.height || board.length || boardSize);
  const boardWidth = Number(gameState?.width || board[0]?.length || boardSize);
  const statusText = gameState?.status || "waiting";
  const isGameFinished = statusText === "finished" || Boolean((gameState as any)?.winner) || Boolean(gameOverWinner);
  const turnText = gameState?.nextTurn || "-";
  const openclawBySeat = Array.isArray(snapshot?.players)
    ? snapshot.players.reduce((acc: Record<string, string>, player: any) => {
      if (player?.seat && player?.id?.startsWith("openclaw:") && !acc[player.seat]) {
        acc[player.seat] = player.id;
      }
      return acc;
    }, {})
    : {};
  const hasOpenclawSeat = Object.keys(openclawBySeat).length > 0;
  const clockState = (gameState as any)?.clock || {};
  const clockRemaining = clockState?.remainingMs || {};
  const turnStartedAt = Number(clockState?.turnStartedAt || 0);
  const turnSeat = String((gameState as any)?.nextTurn || "");
  const formatMs = (ms: number) => {
    const clamped = Math.max(0, Math.floor(ms));
    const totalSec = Math.floor(clamped / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };
  const seatRemainMs = (seat: string) => {
    const base = Number(clockRemaining?.[seat] ?? 30_000);
    if (statusText === "playing" && turnSeat === seat && turnStartedAt > 0) {
      return base - (nowTs - turnStartedAt);
    }
    return base;
  };
  const turnPlayerName = turnText === "-" ? "-" : (displayNameById(openclawBySeat[turnText]) || t("room.hudNoSeatYet"));
  const seatRows = ["black", "white"].map((seat) => ({
    seat,
    playerId: openclawBySeat[seat] || "",
    name: displayNameById(openclawBySeat[seat]) || t("room.hudNoSeatYet"),
    avatar: avatarById(openclawBySeat[seat], "openclaw"),
    remainText: formatMs(seatRemainMs(seat)),
  }));
  const winnerSeat = String((gameState as any)?.winner || gameOverWinner || "");
  const winnerIds = winnerSeat === "draw" || !winnerSeat
    ? []
    : (Array.isArray(snapshot?.players) ? snapshot.players : [])
      .filter((p: any) => String(p?.seat || "") === winnerSeat)
      .map((p: any) => String(p?.id || ""))
      .filter(Boolean);
  const allPlayerIds = (Array.isArray(snapshot?.players) ? snapshot.players : [])
    .map((p: any) => String(p?.id || ""))
    .filter((id: string) => Boolean(id));
  const loserIds = winnerSeat === "draw"
    ? []
    : allPlayerIds.filter((id: string) => !winnerIds.includes(id));
  const isOwnerId = (id?: string) => {
    if (!id || !ownerId) return false;
    if (id === ownerId) return true;
    const normalized = normalizeProfileId(id);
    const normalizedOwner = normalizeProfileId(ownerId);
    return normalized && normalizedOwner && normalized === normalizedOwner;
  };
  const profileCardNormalizedId = profileCard ? normalizeProfileId(profileCard.id) : "";
  const profileCardProfile = profileCard ? profileByAnyId(profileCard.id) : null;
  const profileCardBadges = Array.isArray((profileCardProfile as any)?.badgeDetails) ? (profileCardProfile as any).badgeDetails : [];
  const profileCardOwnerId = profileCard?.type === "openclaw" ? normalizeProfileId(profileCard.id) : "";
  const canFollowProfile = Boolean(profileCard && profileCard.type === "user" && me?.id && profileCardNormalizedId && profileCardNormalizedId !== me.id);
  const isFollowingProfile = Boolean(profileCardNormalizedId) && followingIds.includes(profileCardNormalizedId);
  const canRemoveProfileBot = Boolean(
    profileCard
      && isBotId(profileCard.id)
      && me?.id
      && statusText === "waiting"
      && (isOwner || profileCard.id.startsWith(`bot:${me.id}:`)),
  );
  const syncFields = [
    { key: "game", label: "Game", value: gameLabel },
    { key: "status", label: "Status", value: statusText },
    { key: "turn", label: "Turn", value: `${turnPlayerName} (${turnText})` },
  ];
  const genericSeatList: string[] = Array.from(new Set((Array.isArray(snapshot?.players) ? snapshot.players : []).map((p: any) => String(p?.seat || "")).filter(Boolean)));
  const isDuelHud = genericSeatList.length <= 2 && genericSeatList.every((seat) => seat === "black" || seat === "white");

  useEffect(() => {
    if (statusText !== "playing") return;
    const timer = window.setInterval(() => setNowTs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [statusText]);

  useEffect(() => {
    if (statusText === "finished" || (gameState as any)?.winner) return;
    if (gameOverWinner) setGameOverWinner("");
  }, [statusText, (gameState as any)?.winner, gameOverWinner]);
  const isReconnecting = !wsReady && hasConnectedOnce;
  const lowSignal = wsReady && (wsPacketLossPct > 0 || (wsLatencyMs ?? 0) >= 400);
  const wsStatusText = !wsReady
    ? isReconnecting
      ? "reconnecting"
      : "connecting"
    : lowSignal
      ? "unstable"
      : "online";

  function renderStone(v: unknown) {
    if (v === "black") return <span className="stone stone-black" />;
    if (v === "white") return <span className="stone stone-white" />;
    return null;
  }

  function renderPiece(v: unknown, kind: "chess" | "xiangqi") {
    const key = String(v || "");
    if (!key) return null;
    const glyph = kind === "chess" ? CHESS_GLYPHS[key] : XIANGQI_GLYPHS[key];
    if (!glyph) return <span className="text-xs opacity-60">{key}</span>;
    const isBlack = key.startsWith("black_");
    return (
      <span
        className="flex h-full w-full items-center justify-center text-lg font-semibold sm:text-2xl"
        style={{
          color: isBlack ? "#111827" : "#8b1e1e",
          textShadow: isBlack ? "0 1px 0 rgba(255,255,255,0.22)" : "0 1px 0 rgba(255,255,255,0.3)",
        }}
      >
        {glyph}
      </span>
    );
  }

  function renderSeatBadge(seat: string) {
    return (
      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ background: "rgba(255,255,255,0.12)", color: gameTheme.ink }}>
        {seat.replace(/_/g, " ")}
      </span>
    );
  }

  function renderPlayerRail() {
    const players = Array.isArray(snapshot?.players) ? snapshot.players : [];
    return (
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {players.map((player: any, index: number) => {
          const id = String(player?.id || "");
          return (
            <button
              key={`${id}_${index}`}
              className="flex items-center gap-3 rounded-2xl border px-3 py-3 text-left"
              style={{ borderColor: "rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)" }}
              onClick={() => openProfileCard(id, id.startsWith("openclaw:") ? "openclaw" : "user")}
            >
              <img src={avatarById(id, id.startsWith("openclaw:") ? "openclaw" : "user")} onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)} className="h-11 w-11 rounded-full border object-cover" style={{ borderColor: "rgba(255,255,255,0.18)" }} alt={id} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold" style={{ color: gameTheme.ink }}>{displayNameById(id, id.startsWith("openclaw:") ? "openclaw" : "user")}</div>
                <div className="mt-1 flex items-center gap-2">
                  {renderSeatBadge(String(player?.seat || `seat-${index + 1}`))}
                  <span className="text-[11px]" style={{ color: "color-mix(in oklab, white 72%, transparent)" }}>{id.startsWith("openclaw:") ? "OpenClaw" : "Player"}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  function formatChatTime(ts?: number) {
    if (!ts || Number.isNaN(ts)) return "";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  if (!meChecked) {
    return (
      <main className="grid min-h-[calc(100vh-60px)] grid-cols-1 lg:grid-cols-[320px_1fr_280px]" />
    );
  }


  return (
    <main className="relative grid min-h-[calc(100vh-60px)] grid-cols-1 lg:grid-cols-[320px_1fr_280px]">
      <aside className={`${chatOpenMobile ? "fixed inset-0 z-30 flex bg-black/50 p-3" : "hidden"} lg:static lg:z-auto lg:flex lg:h-[calc(100vh-60px)] lg:bg-transparent lg:p-3 lg:border-r lg:border-b-0`} style={{ borderColor: "var(--border)" }}>
        <div className="flex h-full w-full flex-col rounded-xl border border-slate-800 bg-[var(--surface)] p-3 lg:h-auto lg:w-auto lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0">
          <div className="mb-2 flex items-center justify-between">
            <b>Room Chat</b>
            <button className="rounded border border-slate-700 px-2 py-1 text-xs lg:hidden" onClick={() => setChatOpenMobile(false)}>Close</button>
          </div>
        <div className="mt-2 h-64 flex-1 space-y-2 overflow-auto lg:h-auto">
          {chat.map((m, i) => (
            <div key={m.id || i} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border)", background: "color-mix(in oklab, var(--surface) 86%, transparent)" }}>
              <div className="mb-1 flex items-center gap-2">
                <img src={avatarById(m.senderId, m.senderType)} onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)} className="h-6 w-6 rounded-full border border-slate-700 object-cover" alt="avatar" />
                <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <div className="truncate text-xs text-slate-400">{displayNameById(m.senderId, m.senderType)}</div>
                  <div className="shrink-0 text-[11px] text-slate-500">{formatChatTime(m.ts)}</div>
                </div>
              </div>
              <div>{m.text || ""}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            className="flex-1 rounded border border-slate-700 bg-transparent px-2 py-1.5"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendChat()}
            placeholder={!me?.id ? t("room.loginToJoin") : !canChat ? t("room.joinToChat") : wsReady ? t("room.chatPlaceholder") : t("room.connecting")}
            disabled={!me?.id || !canChat}
          />
          <button className="rounded px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--accent)" }} onClick={sendChat} disabled={!wsReady || !me?.id || !canChat}>
            {t("room.send")}
          </button>
        </div>
        </div>
      </aside>

      {!chatOpenMobile ? (
        <button
          className="fixed z-40 inline-flex h-11 w-11 items-center justify-center rounded-full text-white shadow-lg lg:hidden"
          style={{ background: "var(--accent)", right: 16, bottom: 16, position: "fixed" }}
          onClick={() => {
            setChatOpenMobile(true);
            setChatUnreadMobile(false);
          }}
          aria-label="Open chat"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M4 5.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-5 4v-4H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {chatUnreadMobile ? <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-orange-500" /> : null}
        </button>
      ) : null}

      <section className="flex flex-col p-3">
        <div className="mb-3 lg:hidden">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {realPlayers.length + botPlayers.length > 0 ? (
              <div className="w-max max-w-[55vw] shrink-0 p-1">
                <div className="mb-1 text-[11px] text-slate-400">{t("room.players")}</div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {realPlayers.map((u) => (
                    <button key={`m_player_${u.id}`} className="shrink-0" onClick={() => openProfileCard(u.id, "user")} title={displayNameById(u.id)}>
                      <img src={avatarById(u.id)} onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)} className="h-9 w-9 rounded-full border border-slate-700 object-cover" alt="avatar" />
                    </button>
                  ))}
                  {botPlayers.map((u) => (
                    <button key={`m_bot_${u.id}`} className="shrink-0" onClick={() => openProfileCard(u.id, "user")} title={displayNameById(u.id)}>
                      <img src={avatarById(u.id)} onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)} className="h-9 w-9 rounded-full border border-slate-700 object-cover" alt="bot" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {(online.openclaw?.length || 0) > 0 ? (
              <div className="w-max max-w-[55vw] shrink-0 p-1">
                <div className="mb-1 text-[11px] text-slate-400">{t("room.openclaw")}</div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {online.openclaw?.map((u) => (
                    <button key={`m_openclaw_${u.id}`} className="shrink-0" onClick={() => openProfileCard(u.id, "openclaw")} title={displayNameById(u.id, "openclaw")}>
                      <img src={avatarById(u.id, "openclaw")} onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)} className="h-9 w-9 rounded-full border border-slate-700 object-cover" alt="openclaw" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {(online.spectators?.length || 0) > 0 ? (
              <div className="w-max max-w-[55vw] shrink-0 p-1">
                <div className="mb-1 text-[11px] text-slate-400">{t("room.spectators")}</div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {online.spectators?.map((u, idx) => (
                    <button key={`m_spec_${u.id}_${idx}`} className="shrink-0" onClick={() => openProfileCard(u.id, "user")} title={displayNameById(u.id)}>
                      <img src={avatarById(u.id)} onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)} className="h-9 w-9 rounded-full border border-slate-700 object-cover" alt="spectator" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--surface)", boxShadow: "0 4px 10px rgba(2, 6, 23, 0.08)" }}>
          <div className="text-xs" style={{ color: "var(--fg)" }}>{t("room.roomId")}: {roomId} · {gameLabel} · {statusText}</div>
          <div className="flex items-center gap-2">
            <div className="group relative">
              <button
                className="inline-flex h-8 w-8 items-center justify-center rounded text-white disabled:opacity-50"
                style={{ background: "var(--accent)" }}
                onClick={joinGame}
                disabled={!me?.id || joining || joinRequested}
                aria-label={joinedAsPlayer ? t("room.joined") : joining ? t("room.joining") : joinRequested ? t("room.waitingOpenclaw") : t("room.joinGame")}
                title={joinedAsPlayer ? t("room.joined") : joining ? t("room.joining") : joinRequested ? t("room.waitingOpenclaw") : t("room.joinGame")}
              >
              {joining ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.35" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : joinedAsPlayer || joinRequested ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
              </button>
              <div className="pointer-events-none absolute -top-8 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[10px] opacity-0 shadow transition group-hover:opacity-100" style={{ background: "color-mix(in oklab, var(--surface) 96%, transparent)", color: "var(--fg)", border: "1px solid var(--border)" }}>
                {joinedAsPlayer ? t("room.joined") : joining ? t("room.joining") : joinRequested ? t("room.waitingOpenclaw") : t("room.joinGame")}
              </div>
            </div>
            {joinRequested && !myOpenclawJoined ? (
              <div className="group relative">
                <button
                  className="inline-flex h-8 w-8 items-center justify-center rounded border border-[var(--border)]"
                  style={{ color: "var(--fg)" }}
                  onClick={copyOpenclawPrompt}
                  aria-label={t("room.copyOpenclawPrompt")}
                  title={t("room.copyOpenclawPrompt")}
                >
                  {promptCopied ? (
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <path d="M7 10c-1.7 0-3 1.3-3 3s1.3 3 3 3c.7 0 1.3-.2 1.8-.6M17 10c1.7 0 3 1.3 3 3s-1.3 3-3 3c-.7 0-1.3-.2-1.8-.6M9 9c0-1.1.9-2 2-2h2c1.1 0 2 .9 2 2v6a3 3 0 0 1-3 3h0a3 3 0 0 1-3-3V9ZM10 5h4M8.5 12h1M14.5 12h1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
                <div className="pointer-events-none absolute -top-8 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[10px] opacity-0 shadow transition group-hover:opacity-100" style={{ background: "color-mix(in oklab, var(--surface) 96%, transparent)", color: "var(--fg)", border: "1px solid var(--border)" }}>
                  {promptCopied ? t("room.copied") : t("room.copyOpenclawPrompt")}
                </div>
              </div>
            ) : null}
            {supportsBot ? (
            <>
              <div className="group relative">
                <button
                  className="inline-flex h-8 w-8 items-center justify-center rounded border border-[var(--border)] text-xs font-semibold disabled:opacity-50"
                  style={{ color: "var(--fg)" }}
                  onClick={joinBot}
                  disabled={botJoining || botRemoving || !me?.id}
                  aria-label={botJoining ? t("room.addingBot") : t("room.addBot")}
                  title={botJoining ? t("room.addingBot") : t("room.addBot")}
                >
                {botJoining ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.35" />
                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="6" y="8" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                    <path d="M12 4v3M9 13h.01M15 13h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
                </button>
                <div className="pointer-events-none absolute -top-8 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[10px] opacity-0 shadow transition group-hover:opacity-100" style={{ background: "color-mix(in oklab, var(--surface) 96%, transparent)", color: "var(--fg)", border: "1px solid var(--border)" }}>
                  {botJoining ? t("room.addingBot") : t("room.addBot")}
                </div>
              </div>

            </>
            ) : null}
            {joinRequested ? (
              <div className="group relative">
                <button
                  className="inline-flex h-8 w-8 items-center justify-center rounded border border-[var(--border)] text-xs font-semibold disabled:opacity-50"
                  style={{ color: "var(--fg)" }}
                  onClick={leaveGame}
                  disabled={leaving}
                  aria-label={leaving ? t("room.leaving") : t("room.leaveGame")}
                  title={leaving ? t("room.leaving") : t("room.leaveGame")}
                >
                {leaving ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.35" />
                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M15 8l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M5 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
                </button>
                <div className="pointer-events-none absolute -top-8 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[10px] opacity-0 shadow transition group-hover:opacity-100" style={{ background: "color-mix(in oklab, var(--surface) 96%, transparent)", color: "var(--fg)", border: "1px solid var(--border)" }}>
                  {leaving ? t("room.leaving") : t("room.leaveGame")}
                </div>
              </div>
            ) : null}
            <span className="text-xs text-slate-400">{me?.id ? (joinedAsPlayer ? "" : joinRequested ? t("room.waitingOpenclawToJoin") : "") : t("room.loginToJoin")}</span>
          </div>
        </div>
        <div className="grid flex-1 grid-cols-1 gap-3 xl:grid-cols-[1fr_260px]">
          <div className="flex items-center justify-center">
          {wsReady ? (
            isGameFinished ? (
              <div className="flex w-full items-center justify-center">
                <div className="w-[min(100%,42rem)] rounded-2xl border p-6 text-center" style={{ borderColor: "var(--border)", background: "color-mix(in oklab, var(--surface) 94%, transparent)", color: "var(--fg)" }}>
                  <div className="text-lg font-semibold">{t("room.settlementTitle")}</div>
                {winnerSeat === "draw" ? (
                  <div className="mt-2 text-sm">{t("room.drawResult")}</div>
                ) : (
                  <>
                    <div className="mt-2 text-sm">{t("room.winners")}:</div>
                    <div className="mt-1 flex flex-wrap justify-center gap-2">
                      {winnerIds.length ? winnerIds.map((id: string) => (
                        <div key={`win_${id}`} className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs">
                          <img src={avatarById(id)} onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)} className="h-5 w-5 rounded-full object-cover" alt="winner" />
                          <span className="max-w-[120px] truncate">{displayNameById(id)}</span>
                        </div>
                      )) : <span className="text-xs text-slate-500">-</span>}
                    </div>
                    <div className="mt-2 text-sm">{t("room.losers")}:</div>
                    <div className="mt-1 flex flex-wrap justify-center gap-2">
                      {loserIds.length ? loserIds.map((id: string) => (
                        <div key={`lose_${id}`} className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs">
                          <img src={avatarById(id)} onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)} className="h-5 w-5 rounded-full object-cover" alt="loser" />
                          <span className="max-w-[120px] truncate">{displayNameById(id)}</span>
                        </div>
                      )) : <span className="text-xs text-slate-500">-</span>}
                    </div>
                  </>
                )}
                <div className="mt-1 text-xs" style={{ color: "color-mix(in oklab, var(--fg) 72%, transparent)" }}>{t("room.totalMoves")}: {Number((gameState as any)?.moveCount || 0)}</div>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {joinedAsPlayer ? (
                    <>
                      <button
                        className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        onClick={() => submitRematch(true)}
                        disabled={rematchSubmitting}
                      >
                        {rematchSubmitting ? t("room.submitting") : t("room.playAgain")}
                      </button>
                      <button
                        className="rounded bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        onClick={() => submitRematch(false)}
                        disabled={rematchSubmitting}
                      >
                        {t("room.stopPlaying")}
                      </button>
                    </>
                  ) : null}
                  {isOwner ? (
                    <>
                      <button className="rounded border border-[var(--border)] px-3 py-1.5 text-xs font-semibold" style={{ color: "var(--fg)" }} onClick={resetRoom} disabled={roomResetting}>
                        {roomResetting ? t("room.resetting") : t("room.resetRoom")}
                      </button>
                      <button className="rounded border border-[var(--border)] px-3 py-1.5 text-xs font-semibold" style={{ color: "var(--fg)" }} onClick={leaveRoomAsOwner} disabled={roomLeaving}>
                        {roomLeaving ? t("room.leavingRoom") : t("room.leaveRoom")}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
            ) : gameType === "gomoku" ? (
              <div className="board-wrap w-full max-w-xl">
                <div className="gomoku-board" style={{ gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))` }}>
                  {Array.from({ length: boardSize * boardSize }).map((_, i) => {
                    const x = i % boardSize;
                    const y = Math.floor(i / boardSize);
                    const v = board?.[y]?.[x];
                    return (
                      <div className="gomoku-cell" key={i}>
                        {renderStone(v)}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : gameType === "go" ? (
              <div className="w-full max-w-3xl overflow-auto rounded-2xl border p-4" style={{ borderColor: "color-mix(in oklab, var(--border) 88%, transparent)", background: "linear-gradient(180deg, #d5a766 0%, #c69356 100%)" }}>
                <div className="mx-auto grid gap-[1px]" style={{ gridTemplateColumns: `repeat(${boardSize}, minmax(22px, 1fr))`, maxWidth: 760 }}>
                  {Array.from({ length: boardSize * boardSize }).map((_, i) => {
                    const x = i % boardSize;
                    const y = Math.floor(i / boardSize);
                    const v = board?.[y]?.[x];
                    return (
                      <div key={i} className="relative aspect-square min-h-[22px] min-w-[22px]" style={{ background: "rgba(117, 76, 36, 0.18)" }}>
                        <div className="absolute inset-x-[8%] top-1/2 h-px -translate-y-1/2 bg-[rgba(92,56,22,0.55)]" />
                        <div className="absolute inset-y-[8%] left-1/2 w-px -translate-x-1/2 bg-[rgba(92,56,22,0.55)]" />
                        <div className="absolute inset-[13%] flex items-center justify-center">{renderStone(v)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : gameType === "chess" ? (
              <div className="w-full max-w-2xl overflow-auto rounded-2xl border p-3" style={{ borderColor: "color-mix(in oklab, var(--border) 88%, transparent)", background: "#24170f" }}>
                <div className="mx-auto grid gap-0.5" style={{ gridTemplateColumns: `repeat(${boardWidth}, minmax(34px, 1fr))`, maxWidth: 560 }}>
                  {Array.from({ length: boardWidth * boardHeight }).map((_, i) => {
                    const x = i % boardWidth;
                    const y = Math.floor(i / boardWidth);
                    const v = board?.[y]?.[x];
                    const isDark = (x + y) % 2 === 1;
                    return (
                      <div
                        key={i}
                        className="aspect-square min-h-[34px] min-w-[34px]"
                        style={{ background: isDark ? "#b77940" : "#f2d7b0" }}
                        title={typeof v === "string" ? v : ""}
                      >
                        {renderPiece(v, "chess")}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : gameType === "xiangqi" ? (
              <div className="w-full max-w-3xl overflow-auto rounded-2xl border p-4" style={{ borderColor: "color-mix(in oklab, var(--border) 88%, transparent)", background: "linear-gradient(180deg, #d9b278 0%, #c69356 100%)" }}>
                <div className="mx-auto grid gap-1" style={{ gridTemplateColumns: `repeat(${boardWidth}, minmax(34px, 1fr))`, maxWidth: 620 }}>
                  {Array.from({ length: boardWidth * boardHeight }).map((_, i) => {
                    const x = i % boardWidth;
                    const y = Math.floor(i / boardWidth);
                    const v = board?.[y]?.[x];
                    return (
                      <div key={i} className="relative aspect-square min-h-[34px] min-w-[34px]" title={typeof v === "string" ? v : ""}>
                        <div className="absolute inset-x-[8%] top-1/2 h-px -translate-y-1/2 bg-[rgba(92,56,22,0.55)]" />
                        <div className="absolute inset-y-[8%] left-1/2 w-px -translate-x-1/2 bg-[rgba(92,56,22,0.55)]" />
                        {v ? (
                          <div className="absolute inset-[10%] rounded-full border shadow-sm" style={{ borderColor: "#7c5326", background: "radial-gradient(circle at 35% 30%, #fff3d6 0%, #efd39f 62%, #d7a35f 100%)" }}>
                            {renderPiece(v, "xiangqi")}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : gameType === "texas_holdem" ? (
              <div className="w-full max-w-5xl rounded-[30px] border p-5" style={{ borderColor: "rgba(212,169,58,0.25)", background: "radial-gradient(circle at center, rgba(27,94,63,0.96) 0%, rgba(8,33,27,0.96) 72%)", boxShadow: "0 22px 70px rgba(0,0,0,0.38)" }}>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.28em]" style={{ color: "rgba(255,241,221,0.66)" }}>Casino Noir</div>
                    <div className="text-xl font-semibold" style={{ color: "#f6f1dd" }}>Table Pot: {Number((gameState as any)?.board?.pot || 0)}</div>
                  </div>
                  <div className="rounded-full px-4 py-1.5 text-xs font-semibold" style={{ background: "rgba(255,255,255,0.08)", color: "#f6f1dd", border: "1px solid rgba(255,255,255,0.14)" }}>
                    Street: {String((gameState as any)?.board?.street || "preflop")}
                  </div>
                </div>
                <div className="rounded-[999px] border p-6" style={{ borderColor: "rgba(255,255,255,0.14)", background: "radial-gradient(circle at center, rgba(21,117,84,0.42) 0%, rgba(10,60,42,0.4) 100%)" }}>
                  <div className="mb-5 flex flex-wrap justify-center gap-3">
                    {(Array.isArray((gameState as any)?.board?.community) ? (gameState as any).board.community : []).map((card: string, idx: number) => (
                      <div key={`${card}_${idx}`} className="flex h-24 w-16 items-center justify-center rounded-2xl border text-xl font-bold shadow-sm" style={{ borderColor: "rgba(212,169,58,0.38)", background: "linear-gradient(180deg, #fffcf6 0%, #f3e7cf 100%)", color: "#121212" }}>
                        {card}
                      </div>
                    ))}
                  </div>
                  {renderPlayerRail()}
                </div>
              </div>
            ) : gameType === "werewolf" ? (
              <div className="w-full max-w-5xl rounded-[30px] border p-6" style={{ borderColor: "rgba(156,176,255,0.26)", background: "linear-gradient(180deg, rgba(11,16,33,0.96) 0%, rgba(26,20,50,0.96) 100%)", boxShadow: "0 24px 80px rgba(2,6,23,0.45)" }}>
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.28em]" style={{ color: "rgba(237,241,255,0.62)" }}>Moonlit Village</div>
                    <div className="text-xl font-semibold" style={{ color: "#edf1ff" }}>Phase: {String((gameState as any)?.board?.phase || "night")}</div>
                  </div>
                  <div className="text-sm" style={{ color: "rgba(237,241,255,0.72)" }}>Round {Number((gameState as any)?.board?.round || 1)}</div>
                </div>
                <div className="mb-4 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#edf1ff" }}>
                  {String((gameState as any)?.board?.lastReveal || "The village is waiting for the next reveal.")}
                </div>
                {renderPlayerRail()}
              </div>
            ) : gameType === "junqi" ? (
              <div className="w-full max-w-3xl rounded-[28px] border p-4" style={{ borderColor: "rgba(217,165,90,0.24)", background: "linear-gradient(180deg, #342216 0%, #20150f 100%)", boxShadow: "0 24px 70px rgba(0,0,0,0.34)" }}>
                <div className="mb-4 flex items-center justify-between">
                  <div className="text-[11px] uppercase tracking-[0.28em]" style={{ color: "rgba(255,241,213,0.65)" }}>War Room</div>
                  <div className="text-sm" style={{ color: "#fff1d5" }}>Frontline {turnText}</div>
                </div>
                <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${boardWidth}, minmax(44px, 1fr))` }}>
                  {Array.from({ length: boardWidth * boardHeight }).map((_, i) => {
                    const x = i % boardWidth;
                    const y = Math.floor(i / boardWidth);
                    const v = board?.[y]?.[x];
                    return (
                      <div key={i} className="flex aspect-square min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border text-center text-[11px] font-semibold uppercase" style={{ borderColor: "rgba(255,255,255,0.08)", background: v ? "linear-gradient(180deg, rgba(217,165,90,0.18) 0%, rgba(255,255,255,0.04) 100%)" : "rgba(255,255,255,0.03)", color: "#fff1d5" }}>
                        {typeof v === "string" ? v.replace("_", "\n") : ""}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : gameType === "who_is_undercover" ? (
              <div className="w-full max-w-5xl rounded-[30px] border p-6" style={{ borderColor: "rgba(255,139,44,0.26)", background: "linear-gradient(180deg, rgba(29,10,47,0.96) 0%, rgba(179,30,105,0.76) 100%)", boxShadow: "0 24px 80px rgba(18,4,28,0.42)" }}>
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.28em]" style={{ color: "rgba(255,241,246,0.68)" }}>Neon Party</div>
                    <div className="text-xl font-semibold" style={{ color: "#fff1f6" }}>Phase: {String((gameState as any)?.board?.phase || "clue")}</div>
                  </div>
                  <div className="text-sm" style={{ color: "rgba(255,241,246,0.72)" }}>Round {Number((gameState as any)?.board?.round || 1)}</div>
                </div>
                <div className="mb-4 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: "rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.08)", color: "#fff1f6" }}>
                  {String((gameState as any)?.board?.reveal || "Clues are circulating. Someone at the table is off by one word.")}
                </div>
                {renderPlayerRail()}
              </div>
            ) : (
              <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900/50 p-6 text-center text-slate-300">
                {gameType} board unavailable
              </div>
            )
          ) : (
            <div className="w-full max-w-xl rounded-xl border p-8 text-center" style={{ borderColor: "var(--border)", background: "color-mix(in oklab, var(--surface) 92%, transparent)", color: "var(--fg)" }}>
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: "color-mix(in oklab, var(--fg) 35%, transparent)", borderTopColor: "#fb923c" }} />
              <div className="text-sm font-medium">{t("room.connectingRoom")}</div>
            </div>
          )}
          </div>

          {!isGameFinished ? (
          <div className="rounded-2xl border p-3" style={{ borderColor: "var(--border)", background: "color-mix(in oklab, var(--surface) 94%, transparent)", boxShadow: "none" }}>
            <div className="mb-2 text-xs font-semibold tracking-wide" style={{ color: "var(--fg)" }}>Match Sync HUD</div>
            <div className="space-y-1.5">
              {syncFields.map((field) => (
                <div key={field.key} className="flex items-center justify-between rounded-md px-2 py-1 text-xs" style={{ background: "color-mix(in oklab, var(--surface) 86%, transparent)" }}>
                  <span style={{ color: "color-mix(in oklab, var(--fg) 68%, transparent)" }}>{field.label}</span>
                  <span style={{ color: "var(--fg)" }}>{field.value}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--border)" }}>
              <div className="mb-2 text-xs" style={{ color: "color-mix(in oklab, var(--fg) 68%, transparent)" }}>OpenClaw Seats</div>
              {!hasOpenclawSeat ? (
                <div className="rounded-md px-2 py-2 text-xs" style={{ background: "color-mix(in oklab, var(--surface) 86%, transparent)", color: "var(--fg)" }}>
                  {t("room.hudAwaitingOpenclaw")}
                </div>
              ) : !isDuelHud ? (
                <>
                  <div className="grid gap-2 rounded-xl px-2 py-2" style={{ background: "color-mix(in oklab, var(--surface) 86%, transparent)" }}>
                    {genericSeatList.map((seat) => {
                      const playerId = openclawBySeat[seat] || "";
                      return (
                        <div key={seat} className="flex items-center justify-between gap-2 rounded-lg border px-2 py-2" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                          <div className="flex items-center gap-2">
                            <img src={avatarById(playerId, "openclaw")} onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)} className="h-9 w-9 rounded-full border object-cover" style={{ borderColor: "rgba(255,255,255,0.14)" }} alt={seat} />
                            <div>
                              <div className="text-[11px]" style={{ color: "var(--fg)" }}>{displayNameById(playerId, "openclaw") || t("room.hudNoSeatYet")}</div>
                              <div className="text-[10px]" style={{ color: "color-mix(in oklab, var(--fg) 68%, transparent)" }}>{seat}</div>
                            </div>
                          </div>
                          <div className="text-[10px] font-semibold" style={{ color: "var(--fg)" }}>{formatMs(seatRemainMs(seat))}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 rounded-xl px-2 py-2" style={{ background: "color-mix(in oklab, var(--surface) 86%, transparent)" }}>
                    <div className="mb-1 text-[11px]" style={{ color: "color-mix(in oklab, var(--fg) 68%, transparent)" }}>{t("room.actionHistory")}</div>
                    <div className="max-h-28 space-y-1 overflow-auto pr-1">
                      {moveHistory.length === 0 ? (
                        <div className="text-[11px]" style={{ color: "color-mix(in oklab, var(--fg) 62%, transparent)" }}>-</div>
                      ) : [...moveHistory].reverse().map((mv, idx) => (
                        <div key={mv.id} className="flex items-center justify-between text-[11px]" style={{ color: "var(--fg)" }}>
                          <span className="truncate">{moveHistory.length - idx}. {displayNameById(mv.actorId, "openclaw")}</span>
                          <span className="ml-2 shrink-0">{mv.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl px-2 py-2" style={{ background: "color-mix(in oklab, var(--surface) 86%, transparent)" }}>
                    <div className="flex flex-col items-center gap-1">
                      <img src={seatRows[0]?.avatar || DEFAULT_AVATAR} onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)} className="h-10 w-10 rounded-full border object-cover" style={{ borderColor: "color-mix(in oklab, var(--border) 80%, #000)" }} alt="black" />
                      <div className="text-[11px]" style={{ color: "var(--fg)" }}>{seatRows[0]?.name || t("room.hudNoSeatYet")}</div>
                      <div className="text-[10px] font-semibold" style={{ color: "var(--fg)" }}>{seatRows[0]?.remainText || "00:30"}</div>
                      <div className="flex items-center gap-1 text-[10px]" style={{ color: "color-mix(in oklab, var(--fg) 74%, transparent)" }}>
                        <span className="inline-block h-2.5 w-2.5 rounded-full border border-slate-300 bg-black" /> Black
                      </div>
                    </div>
                    <div className="text-xs font-semibold" style={{ color: "color-mix(in oklab, var(--fg) 78%, transparent)" }}>VS</div>
                    <div className="flex flex-col items-center gap-1">
                      <img src={seatRows[1]?.avatar || DEFAULT_AVATAR} onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)} className="h-10 w-10 rounded-full border object-cover" style={{ borderColor: "color-mix(in oklab, var(--border) 80%, #fff)" }} alt="white" />
                      <div className="text-[11px]" style={{ color: "var(--fg)" }}>{seatRows[1]?.name || t("room.hudNoSeatYet")}</div>
                      <div className="text-[10px] font-semibold" style={{ color: "var(--fg)" }}>{seatRows[1]?.remainText || "00:30"}</div>
                      <div className="flex items-center gap-1 text-[10px]" style={{ color: "color-mix(in oklab, var(--fg) 74%, transparent)" }}>
                        <span className="inline-block h-2.5 w-2.5 rounded-full border border-slate-400 bg-white" /> {t("room.hudWhite")}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 rounded-xl px-2 py-2" style={{ background: "color-mix(in oklab, var(--surface) 86%, transparent)" }}>
                    <div className="mb-1 text-[11px]" style={{ color: "color-mix(in oklab, var(--fg) 68%, transparent)" }}>{t("room.actionHistory")}</div>
                    <div className="max-h-28 space-y-1 overflow-auto pr-1">
                      {moveHistory.length === 0 ? (
                        <div className="text-[11px]" style={{ color: "color-mix(in oklab, var(--fg) 62%, transparent)" }}>-</div>
                      ) : [...moveHistory].reverse().map((mv, idx) => (
                        <div key={mv.id} className="flex items-center justify-between text-[11px]" style={{ color: "var(--fg)" }}>
                          <span className="truncate">{moveHistory.length - idx}. {displayNameById(mv.actorId, "openclaw")}</span>
                          <span className="ml-2 shrink-0">{mv.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          ) : null}
        </div>
      </section>

      <aside className="hidden border-t p-3 lg:block lg:border-t-0 lg:border-l" style={{ borderColor: "var(--border)" }}>
        <div className="mb-2 flex items-center justify-between">
          <b>{t("room.online")}</b>
          <span className="text-xs text-slate-400">{allOnlineCount}</span>
        </div>

        <b className="text-xs text-slate-400">{t("room.players")}</b>
        <div className="mt-1 space-y-2">
          {realPlayers.map((u) => {
            const rowIsOwner = isOwnerId(u.id);
            return (
              <div className="flex items-center gap-2 text-sm" key={`u_${u.id}`}>
                <img src={avatarById(u.id)} onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)} className="h-7 w-7 cursor-pointer rounded-full border border-slate-700 object-cover" alt="avatar" onClick={() => openProfileCard(u.id, "user")} />
                <span className="group relative min-w-0 flex-1 truncate cursor-pointer" title={rowIsOwner ? t("room.owner") : undefined} onClick={() => openProfileCard(u.id, "user")}>
                  {displayNameById(u.id)}
                  {rowIsOwner ? <span className="ml-1 inline-flex items-center rounded px-1 py-0.5 text-[10px] align-middle" style={{ background: "color-mix(in oklab, #f59e0b 22%, transparent)", color: "var(--fg)" }}>{t("room.owner")}</span> : null}
                  {rowIsOwner ? <span className="pointer-events-none absolute -top-6 left-0 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-200 opacity-0 transition group-hover:opacity-100">{t("room.owner")}</span> : null}
                </span>
              </div>
            );
          })}
          {botPlayers.map((u) => {
            const canRemoveThisBot = Boolean(me?.id)
              && statusText === "waiting"
              && (isOwner || u.id.startsWith(`bot:${me?.id}:`));
            return (
              <div className="flex items-center gap-2 text-sm" key={`bot_${u.id}`}>
                <img src={avatarById(u.id)} onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)} className="h-7 w-7 rounded-full border border-slate-700 object-cover" alt="bot" />
                <span className="min-w-0 flex-1 truncate">{displayNameById(u.id)}</span>
                {canRemoveThisBot ? (
                  <button
                    className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                    onClick={() => removeBot(u.id)}
                    disabled={botRemoving}
                    aria-label={botRemoving ? t("room.removingBot") : t("room.removeBot")}
                    title={botRemoving ? t("room.removingBot") : t("room.removeBot")}
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 6h18" />
                      <path d="M8 6V4h8v2" />
                      <path d="M18 6l-1 14H7L6 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                    </svg>
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <b className="mt-3 block text-xs text-slate-400">{t("room.openclaw")}</b>
        <div className="mt-1 space-y-2">
          {online.openclaw?.map((u) => (
            <div className="flex items-center gap-2 text-sm" key={`o_${u.id}`}>
              <img src={avatarById(u.id, "openclaw")} onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)} className="h-7 w-7 cursor-pointer rounded-full border border-slate-700 object-cover" alt="avatar" onClick={() => openProfileCard(u.id, "openclaw")} />
              <span className="truncate cursor-pointer" title={isOwnerId(u.id) ? t("room.owner") : undefined} onClick={() => openProfileCard(u.id, "openclaw")}>
                {displayNameById(u.id, "openclaw")}
                {isOwnerId(u.id) ? <span className="ml-1 inline-flex items-center rounded px-1 py-0.5 text-[10px] align-middle" style={{ background: "color-mix(in oklab, #f59e0b 22%, transparent)", color: "var(--fg)" }}>{t("room.owner")}</span> : null}
              </span>
            </div>
          ))}
        </div>

        <b className="mt-3 block text-xs text-slate-400">{t("room.spectators")}</b>
        <div className="mt-1 space-y-2">
          {online.spectators?.map((u, idx) => (
            <div className="flex items-center gap-2 text-sm" key={`s_${u.id}_${idx}`}>
              <img src={avatarById(u.id)} onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)} className="h-7 w-7 cursor-pointer rounded-full border border-slate-700 object-cover" alt="avatar" onClick={() => openProfileCard(u.id, "user")} />
              <span className="truncate cursor-pointer" title={isOwnerId(u.id) ? t("room.owner") : undefined} onClick={() => openProfileCard(u.id, "user")}>
                {displayNameById(u.id)}
                {isOwnerId(u.id) ? <span className="ml-1 inline-flex items-center rounded px-1 py-0.5 text-[10px] align-middle" style={{ background: "color-mix(in oklab, #f59e0b 22%, transparent)", color: "var(--fg)" }}>{t("room.owner")}</span> : null}
              </span>
            </div>
          ))}
        </div>
      </aside>

      {profileCard ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4" onClick={() => setProfileCard(null)}>
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <img src={avatarById(profileCard.id, profileCard.type === "openclaw" ? "openclaw" : "user")} className="h-12 w-12 rounded-full border border-slate-700 object-cover" alt="avatar" onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)} />
                <div>
                  <div className="text-base font-semibold">{displayNameById(profileCard.id, profileCard.type === "openclaw" ? "openclaw" : "user")}</div>
                  <div className="text-xs text-slate-400">{profileCard.type === "openclaw" ? t("room.profileTypeOpenclaw") : t("room.profileTypePlayer")}</div>
                </div>
              </div>
              <button className="rounded border border-slate-700 px-2 py-1 text-xs" onClick={() => setProfileCard(null)}>{t("room.close")}</button>
            </div>

            <div className="mt-3 text-sm text-slate-300">{String((profileCardProfile as any)?.bio || (profileCardProfile as any)?.clawBio || "") || "-"}</div>

            {canRemoveProfileBot ? (
              <button
                className="mt-3 inline-flex h-8 items-center justify-center rounded border border-slate-700 px-3 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                onClick={() => removeBot(profileCard.id)}
                disabled={botRemoving}
              >
                {botRemoving ? t("room.removingBot") : t("room.removeBot")}
              </button>
            ) : null}

            {profileCard.type === "user" ? (
              <>
                <div className="mt-3 text-xs text-slate-400">{t("room.followedByCount")}: {profileFollowersCount}</div>
                <div className="mt-2 overflow-x-auto">
                  <div className="flex min-w-max gap-2 pr-1">
                    {profileCardBadges.length ? profileCardBadges.map((b: any) => (
                      <div key={String(b?.id || Math.random())} className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800/70 px-2 py-1">
                        <img
                          src={String(b?.imageUrl || "https://placehold.co/24x24/1e293b/e2e8f0?text=?")}
                          onError={(e) => ((e.currentTarget as HTMLImageElement).src = "https://placehold.co/24x24/1e293b/e2e8f0?text=?")}
                          className="h-5 w-5 rounded-full object-cover"
                          alt={String(b?.id || "badge")}
                        />
                        <span className="whitespace-nowrap text-[11px] text-slate-300">{String((lang === "en" ? (b?.nameEn || b?.nameZh) : (b?.nameZh || b?.nameEn)) || b?.id || t("room.badgeFallback"))}</span>
                      </div>
                    )) : <span className="text-xs text-slate-500">{t("room.noBadges")}</span>}
                  </div>
                </div>
                {canFollowProfile ? (
                  <button
                    className="mt-3 rounded bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    disabled={followSubmittingId === profileCardNormalizedId}
                    onClick={() => toggleFollow(profileCardNormalizedId)}
                  >
                    {isFollowingProfile ? t("room.unfollowPlayer") : t("room.followPlayer")}
                  </button>
                ) : null}
              </>
            ) : (
              <div className="mt-3 text-xs text-slate-400">{t("room.master")}: {profileCardOwnerId ? displayNameById(profileCardOwnerId) : "-"}</div>
            )}
          </div>
        </div>
      ) : null}

      {showBindGuard ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4" onClick={() => setShowBindGuard(false)}>
          <div
            className="w-full max-w-md rounded-2xl border p-5"
            style={{ borderColor: "var(--border)", background: "color-mix(in oklab, var(--surface) 96%, transparent)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-base font-semibold" style={{ color: "var(--fg)" }}>
              {t("bindGuard.title")}
            </div>
            <div className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              {t("bindGuard.desc")}
            </div>
            <div className="mt-4 flex gap-2">
              <a
                href="/"
                className="inline-flex rounded-full px-4 py-2 text-sm font-semibold"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                {t("bindGuard.backHome")}
              </a>
              <button
                type="button"
                className="inline-flex rounded-full border px-4 py-2 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--fg)" }}
                onClick={() => setShowBindGuard(false)}
              >
                {t("bindGuard.skip")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {!wsReady && !hasConnectedOnce ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center" style={{ background: "color-mix(in oklab, #020617 28%, transparent)" }}>
          <div className="rounded-2xl border px-8 py-6 text-center shadow-2xl" style={{ borderColor: "var(--border)", background: "color-mix(in oklab, var(--surface) 96%, transparent)", color: "var(--fg)" }}>
            <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2" style={{ borderColor: "color-mix(in oklab, var(--fg) 35%, transparent)", borderTopColor: "#fb923c" }} />
            <div className="text-sm">{t("room.loading")}</div>
            <div className="mt-1 text-xs" style={{ color: "color-mix(in oklab, var(--fg) 70%, transparent)" }}>{t("room.connectingRoom")}</div>
          </div>
        </div>
      ) : null}

      <div className="fixed right-4 top-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="min-w-[260px] max-w-[340px] rounded-xl border px-3 py-2 text-xs shadow-lg transition-all duration-500"
            style={{
              borderColor: toast.level === "error" ? "color-mix(in oklab, #ef4444 52%, var(--border))" : "color-mix(in oklab, #22c55e 40%, var(--border))",
              background: toast.level === "error"
                ? "linear-gradient(135deg, color-mix(in oklab, #ef4444 12%, var(--surface)) 0%, color-mix(in oklab, var(--surface) 95%, transparent) 100%)"
                : "linear-gradient(135deg, color-mix(in oklab, #22c55e 10%, var(--surface)) 0%, color-mix(in oklab, var(--surface) 95%, transparent) 100%)",
              color: "var(--fg)",
            }}
          >
            <div className="flex items-start gap-2">
              <span className="mt-[1px] text-[11px]">{toast.level === "error" ? "⚠" : "✓"}</span>
              <span className="leading-5">{toast.text}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="absolute bottom-2 right-2 z-10 rounded-lg border px-2 py-1 text-[10px] leading-none lg:fixed lg:z-30" style={{ borderColor: "var(--border)", background: "color-mix(in oklab, var(--surface) 86%, transparent)", color: "var(--fg)" }}>
        <div className="flex items-center gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 ${isReconnecting ? "border-red-500/70 text-red-400" : lowSignal ? "border-amber-500/70 text-amber-500" : wsReady ? "border-emerald-500/70 text-emerald-500" : ""}`} style={!isReconnecting && !lowSignal && !wsReady ? { borderColor: "color-mix(in oklab, var(--fg) 28%, transparent)", color: "color-mix(in oklab, var(--fg) 72%, transparent)" } : undefined}>
            <svg viewBox="0 0 24 24" className={`h-3 w-3 ${lowSignal ? "animate-spin" : ""}`} fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 18C5.5 15.5 8.5 14.25 12 14.25C15.5 14.25 18.5 15.5 21 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M6.5 14.5C8 13 9.833 12.25 12 12.25C14.167 12.25 16 13 17.5 14.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M10.5 11C11 10.5 11.5 10.25 12 10.25C12.5 10.25 13 10.5 13.5 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="19.5" r="1.5" fill="currentColor" />
              {lowSignal ? <path d="M3 3L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /> : null}
            </svg>
            WS {wsStatusText}
          </span>
          <span>{wsLatencyMs == null ? "--" : `${wsLatencyMs}ms`}</span>
          <span>{wsPacketLossPct.toFixed(1)}%</span>
        </div>
      </div>
    </main>
  );
}
