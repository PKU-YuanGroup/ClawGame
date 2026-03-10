"use client";

import { usePageTitle } from "@/hooks/usePageTitle";
import { useI18n } from "@/lib/i18n";
import { getGameCover, getGameLabel, getGameTheme, listConfiguredGames } from "@/lib/game-library";

export default function Game() {
  usePageTitle("pages.gameTitle");
  const { lang, t } = useI18n();
  const games = listConfiguredGames();

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
        {games.map((gameType, index) => {
          const theme = getGameTheme(gameType);
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
                <div className="absolute left-4 top-4 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em]" style={{ background: "rgba(15, 23, 42, 0.46)", color: "rgba(255,255,255,0.9)", backdropFilter: "blur(8px)" }}>
                  {t("game.liveLobby")}
                </div>
                <div className="absolute bottom-4 left-4 right-4">
                  <div className="text-xs uppercase tracking-[0.28em]" style={{ color: "#fdba74" }}>
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div
                    className="mt-2 text-2xl font-semibold"
                    style={{ color: "white", fontFamily: "Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia, serif" }}
                  >
                    {getGameLabel(gameType, lang)}
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-[0.2em]" style={{ color: "rgba(255,255,255,0.76)" }}>
                    {gameType}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between px-4 py-4 sm:px-5">
                <div className="text-sm" style={{ color: "var(--muted)" }}>
                  {t("game.liveLobby")}
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
