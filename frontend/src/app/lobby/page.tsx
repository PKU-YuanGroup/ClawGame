"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useI18n } from "@/lib/i18n";
import { getGameCover, getGameLabel, getGameTheme, listConfiguredGames } from "@/lib/game-library";

type LobbyOverviewRoom = {
  roomId: string;
  gameType: string;
  status: string;
  ownerId: string;
  owner: {
    userId: string;
    username: string;
    avatarUrl?: string;
    openclawName?: string;
    openclawAvatarUrl?: string;
  };
  onlineCount: number;
  spectatorCount: number;
  onlinePlayers: Array<{
    id: string;
    type: "user" | "openclaw" | "spectator";
    seat: string;
    displayName: string;
    avatarUrl?: string;
  }>;
};

type LeaderboardItem = {
  userId: string;
  rating: number;
  wins: number;
  totalGames: number;
  overallWins: number;
  overallTotalGames: number;
  profile: {
    userId: string;
    username: string;
    avatarUrl?: string;
    openclawName?: string;
    openclawAvatarUrl?: string;
  };
};

type LobbyOverviewResponse = {
  gameType: string;
  rooms: LobbyOverviewRoom[];
  leaderboard: LeaderboardItem[];
};

type MeProfile = {
  id?: string;
  clawBio?: string;
  clawOwnerReview?: string;
};

const DEFAULT_AVATAR = "https://placehold.co/64x64/1e293b/e2e8f0?text=?";

function botLabel(id: string, t: (key: string) => string): string {
  const raw = id.startsWith("openclaw:") ? id.slice("openclaw:".length) : id;
  if (!raw.startsWith("bot:")) return "";
  const suffix = raw.split(":").pop() || "";
  const n = Number(suffix);
  return Number.isFinite(n) ? `${t("room.botName")} ${n + 1}` : t("room.botName");
}

export default function Lobby() {
  usePageTitle("pages.lobbyTitle");
  const { lang, t } = useI18n();
  const gameTypes = listConfiguredGames();
  const [gameType, setGameType] = useState(gameTypes[0] || "gomoku");
  const [visibility, setVisibility] = useState("public");
  const [rooms, setRooms] = useState<LobbyOverviewRoom[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [me, setMe] = useState<MeProfile | null>(null);
  const [showBindGuard, setShowBindGuard] = useState(false);
  const theme = getGameTheme(gameType);

  const fetchOverview = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) setLoading(true);
      try {
        const data = await api<LobbyOverviewResponse>(`/api/lobby/overview?gameType=${encodeURIComponent(gameType)}`);
        setRooms(Array.isArray(data?.rooms) ? data.rooms : []);
        setLeaderboard(Array.isArray(data?.leaderboard) ? data.leaderboard : []);
      } catch {
        // Keep previous data on refresh errors to avoid UI flicker.
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [gameType],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextGameType = new URLSearchParams(window.location.search).get("gameType") || gameTypes[0] || "gomoku";
    setGameType(nextGameType);
  }, [gameTypes]);

  useEffect(() => {
    api<MeProfile>("/api/me")
      .then((d) => setMe(d || null))
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchOverview();
    const timer = window.setInterval(() => {
      if (!cancelled) void fetchOverview({ silent: true });
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [fetchOverview]);

  async function refreshOverview() {
    await fetchOverview();
  }

  const hasBoundOpenClaw = Boolean(
    me?.id && String(me?.clawBio || "").trim() && String(me?.clawOwnerReview || "").trim(),
  );

  return (
    <main className="mx-auto max-w-7xl px-3 py-6 sm:px-5 sm:py-8">
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div
          className="overflow-hidden rounded-[32px] border p-5 sm:p-7"
          style={{
            borderColor: "color-mix(in oklab, var(--border) 78%, transparent)",
            background: theme.cardBackground,
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
          }}
        >
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-2xl">
                <div className="text-[11px] font-semibold uppercase tracking-[0.35em]" style={{ color: theme.accent }}>
                  {t("nav.lobby")}
                </div>
                <h1
                  className="mt-3 text-3xl font-semibold sm:text-5xl"
                  style={{ color: theme.ink, fontFamily: "Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia, serif" }}
                >
                  {getGameLabel(gameType, lang)}
                </h1>
                <p className="mt-3 text-sm sm:text-base" style={{ color: "rgba(255,255,255,0.78)" }}>
                  {theme.atmosphere}. {t("lobby.createHint")}
                </p>
              </div>

              <div className="flex h-28 w-full max-w-xs overflow-hidden rounded-[24px] border sm:h-32" style={{ borderColor: "rgba(255,255,255,0.16)" }}>
                <img src={getGameCover(gameType)} alt={getGameLabel(gameType, lang)} className="h-full w-full object-cover" />
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <select
                className="min-w-40 cursor-pointer rounded-full border px-4 py-3 text-sm"
                style={{ borderColor: "rgba(255,255,255,0.14)", background: "rgba(15,23,42,0.32)", color: theme.ink }}
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
              >
                <option value="public" style={{ color: "#0f172a" }}>{t("lobby.public")}</option>
                <option value="private" style={{ color: "#0f172a" }}>{t("lobby.private")}</option>
              </select>

              <button
                className="rounded-full px-5 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-70"
                style={{ background: `linear-gradient(135deg, ${theme.accent}, color-mix(in srgb, ${theme.accent} 58%, black))`, color: "#fff" }}
                disabled={creating}
                onClick={async () => {
                  if (creating) return;
                  if (me?.id && !hasBoundOpenClaw) {
                    setShowBindGuard(true);
                    return;
                  }
                  setCreating(true);
                  try {
                    const data = await api<any>("/api/match/create", { method: "POST", body: JSON.stringify({ gameType, visibility }) });
                    location.href = `/room?roomId=${data.roomId}&gameType=${gameType}`;
                  } finally {
                    setCreating(false);
                  }
                }}
              >
                {creating ? t("lobby.loading") : t("lobby.createRoom")}
              </button>

              <button
                className="rounded-full border px-5 py-3 text-sm"
                style={{ borderColor: "rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.08)", color: theme.ink }}
                onClick={refreshOverview}
              >
                {loading ? t("lobby.loading") : t("lobby.refresh")}
              </button>
            </div>
          </div>
        </div>

        <section
          className="rounded-[32px] border p-5 sm:p-6"
          style={{
            borderColor: "color-mix(in oklab, var(--border) 80%, transparent)",
            background: "color-mix(in oklab, var(--surface) 96%, white)",
            boxShadow: "0 3px 10px rgba(15, 23, 42, 0.06)",
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em]" style={{ color: "var(--muted)" }}>
                {t("lobby.leaderboard")}
              </div>
              <h2
                className="mt-2 text-2xl font-semibold"
                style={{ fontFamily: "Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia, serif" }}
              >
                {getGameLabel(gameType, lang)}
              </h2>
            </div>
            <div className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "color-mix(in oklab, var(--surface-2) 88%, transparent)", color: theme.accent }}>
              TOP {Math.max(leaderboard.length, 3)}
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {leaderboard.length ? leaderboard.slice(0, 8).map((entry, index) => (
              <div
                key={entry.userId}
                className="rounded-[22px] border p-3"
                style={{
                  borderColor: "color-mix(in oklab, var(--border) 82%, transparent)",
                  background: "color-mix(in oklab, var(--surface) 92%, var(--surface-2))",
                  boxShadow: "0 2px 8px rgba(15, 23, 42, 0.04)",
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                    style={{ background: "var(--surface-2)", color: index === 0 ? "var(--accent)" : "var(--fg)" }}
                  >
                    #{index + 1}
                  </div>

                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <img
                      src={entry.profile.avatarUrl || DEFAULT_AVATAR}
                      onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)}
                      alt="user avatar"
                      className="h-12 w-12 rounded-full object-cover"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{entry.profile.username}</div>
                      <div className="mt-1 flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
                        <img
                          src={entry.profile.openclawAvatarUrl || entry.profile.avatarUrl || DEFAULT_AVATAR}
                          onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)}
                          alt="openclaw avatar"
                          className="h-5 w-5 rounded-full object-cover"
                        />
                        <span className="truncate">{entry.profile.openclawName || "Claw"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-lg font-semibold" style={{ color: "var(--accent)" }}>{entry.wins}</div>
                    <div className="text-[11px]" style={{ color: "var(--muted)" }}>{t("lobby.wins")}</div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full px-2.5 py-1" style={{ background: "var(--surface-2)", color: "var(--fg)" }}>
                    {t("lobby.totalGames")} {entry.totalGames}
                  </span>
                  <span className="rounded-full px-2.5 py-1" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>
                    Elo {entry.rating}
                  </span>
                  <span className="rounded-full px-2.5 py-1" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>
                    {t("lobby.overall")} {entry.overallWins}/{entry.overallTotalGames}
                  </span>
                </div>
              </div>
            )) : (
              <div className="rounded-[22px] border px-4 py-6 text-sm" style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--muted)" }}>
                {t("lobby.noLeaderboard")}
              </div>
            )}
          </div>
        </section>
      </section>

      <section className="mt-6">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.28em]" style={{ color: "var(--muted)" }}>
              {t("lobby.activeRooms")}
            </div>
            <h2
              className="mt-2 text-2xl font-semibold sm:text-3xl"
              style={{ fontFamily: "Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia, serif" }}
            >
              {getGameLabel(gameType, lang)}
            </h2>
          </div>
          <div className="text-xs sm:text-sm" style={{ color: "var(--muted)" }}>
            {loading ? t("lobby.loading") : `${rooms.length} rooms`}
          </div>
        </div>

        {rooms.length ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {rooms.map((room) => {
              const roster = room.onlinePlayers;
              return (
                <a
                  key={room.roomId}
                  href={`/room/?roomId=${room.roomId}&gameType=${room.gameType}`}
                  className="group overflow-hidden rounded-2xl border transition duration-200 hover:-translate-y-0.5"
                  style={{
                    borderColor: "var(--border)",
                    background: "var(--surface)",
                    boxShadow: "0 3px 10px rgba(15, 23, 42, 0.06)",
                  }}
                >
                <div className="border-b px-4 py-3 sm:px-5" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-end gap-3">
                    <div
                      className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]"
                      style={{
                        background: room.status === "playing" ? "rgba(249,115,22,0.14)" : "var(--surface-2)",
                        color: room.status === "playing" ? "var(--accent)" : "var(--muted)",
                      }}
                    >
                      {room.status}
                    </div>
                  </div>
                </div>

                <div className="px-4 py-4 sm:px-5">
                  <div className="overflow-x-auto pb-1">
                    <div className="flex min-w-max gap-3">
                      {roster.length ? roster.map((player) => (
                        <div
                          key={player.id}
                          className="w-[4.25rem] shrink-0 text-center"
                        >
                          <img
                            src={player.avatarUrl || DEFAULT_AVATAR}
                            onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)}
                            alt={player.displayName}
                            className="mx-auto h-11 w-11 rounded-full border object-cover"
                            style={{
                              borderColor: player.type === "openclaw" ? "#f97316" : "var(--border)",
                              boxShadow: player.type === "openclaw" ? "0 0 0 2px rgba(249,115,22,0.15)" : "none",
                            }}
                          />
                          <div className="mt-1 truncate text-[11px] font-medium">
                            {botLabel(player.id, t) || player.displayName}
                          </div>
                        </div>
                      )) : (
                        <div className="rounded-xl border px-4 py-5 text-sm" style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--muted)" }}>
                          {t("lobby.noOnlinePlayers")}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <img
                        src={room.owner.avatarUrl || DEFAULT_AVATAR}
                        onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)}
                        alt="owner avatar"
                        className="h-8 w-8 rounded-full object-cover"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-xs" style={{ color: "var(--muted)" }}>{t("lobby.owner")}</div>
                        <div className="truncate text-sm font-semibold">{room.owner.username}</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full px-3 py-1" style={{ background: "var(--surface-2)", color: "var(--fg)" }}>
                        {room.roomId.slice(0, 8)}
                      </span>
                      <span className="rounded-full px-3 py-1" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>
                        {t("lobby.onlineCount")} {room.onlineCount}
                      </span>
                    </div>
                  </div>
                </div>
              </a>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[28px] border px-5 py-10 text-center text-sm" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}>
            {loading ? t("lobby.loading") : t("lobby.noRooms")}
          </div>
        )}
      </section>

      {showBindGuard ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setShowBindGuard(false)}>
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
    </main>
  );
}
