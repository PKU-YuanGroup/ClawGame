"use client";

import { useEffect, useState } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useI18n } from "@/lib/i18n";
import { getGameCover, getGameLabel, listConfiguredGames } from "@/lib/game-library";
import { api } from "@/lib/api";

type LobbyOverviewResponse = {
  rooms?: unknown[];
};

export default function Game() {
  usePageTitle("pages.gameTitle");
  const { lang, t } = useI18n();
  const games = listConfiguredGames();
  const [onlineRoomCounts, setOnlineRoomCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    async function fetchRoomCounts() {
      const pairs = await Promise.all(games.map(async (gameType) => {
        try {
          const data = await api<LobbyOverviewResponse>(`/api/lobby/overview?gameType=${encodeURIComponent(gameType)}`);
          return [gameType, Array.isArray(data?.rooms) ? data.rooms.length : 0] as const;
        } catch {
          return [gameType, 0] as const;
        }
      }));
      if (!cancelled) {
        setOnlineRoomCounts(Object.fromEntries(pairs));
      }
    }
    void fetchRoomCounts();
    const timer = window.setInterval(() => {
      void fetchRoomCounts();
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-3 py-6 sm:px-5 sm:py-8">
      <section className="px-1 py-1 sm:px-2 sm:py-2">
        <div className="max-w-3xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.35em]" style={{ color: "#fdba74" }}>
            CLAWGAME
          </div>
          <h1
            className="mt-3 text-4xl font-semibold sm:text-5xl"
          >
            {t("game.title")}
          </h1>
          <p className="mt-3 max-w-2xl text-sm sm:text-base" style={{ color: "color-mix(in oklab, var(--fg) 78%, white)" }}>
            {t("game.subtitle")}
          </p>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((gameType) => {
          const roomCount = Number(onlineRoomCounts[gameType] || 0);
          return (
            <a
              key={gameType}
              href={`/lobby?gameType=${encodeURIComponent(gameType)}`}
              className="group overflow-hidden rounded-[28px] border transition duration-300 hover:-translate-y-1"
              style={{
                borderColor: "color-mix(in oklab, var(--border) 88%, transparent)",
                background: "color-mix(in oklab, var(--surface) 96%, white)",
                boxShadow: "0 4px 12px rgba(15, 23, 42, 0.1)",
              }}
            >
              <div className="relative h-52 w-full overflow-hidden">
                <img
                  src={getGameCover(gameType)}
                  alt={getGameLabel(gameType, lang)}
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 10%, rgba(15, 23, 42, 0.22) 52%, rgba(15, 23, 42, 0.86) 100%)" }} />
                <div className="absolute bottom-4 left-4 right-4">
                  <div
                    className="text-2xl font-semibold"
                    style={{ color: "white", fontFamily: "var(--font-display)" }}
                  >
                    {getGameLabel(gameType, lang)}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between px-4 py-4 sm:px-5">
                <div className="text-sm" style={{ color: "var(--muted)" }}>
                  {lang === "zh" ? `${roomCount} 个在线房间` : `${roomCount} rooms online`}
                </div>
                <div
                  className="shrink-0 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em]"
                  style={{ background: "color-mix(in oklab, var(--surface-2) 90%, transparent)", color: "var(--fg)", border: "1px solid var(--border)" }}
                >
                  {t("game.enterLobby")}
                </div>
              </div>
            </a>
          );
        })}
      </section>
    </main>
  );
}
