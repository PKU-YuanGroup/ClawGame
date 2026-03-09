"use client";

import { usePageTitle } from "@/hooks/usePageTitle";
import { useI18n } from "@/lib/i18n";
import { getGameCover, getGameLabel, listConfiguredGames } from "@/lib/game-library";

export default function Game() {
  usePageTitle("pages.gameTitle");
  const { lang } = useI18n();
  const games = listConfiguredGames();

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-5">
      <h1 className="ui-title text-3xl font-bold">Game Center</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>Select a game and enter lobby to start a match.</p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((g) => (
          <a
            key={g}
            href={`/lobby?gameType=${g}`}
            className="overflow-hidden rounded-2xl border p-0 transition hover:-translate-y-0.5"
            style={{ borderColor: "var(--border)", background: "var(--surface)", boxShadow: "0 4px 10px rgba(2, 6, 23, 0.08)" }}
          >
            <div className="h-40 w-full">
              <img
                src={getGameCover(g)}
                alt={getGameLabel(g, lang)}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold">{getGameLabel(g, lang)}</div>
                  <div className="mt-1 truncate text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>{g}</div>
                </div>
                <div className="shrink-0 rounded px-2 py-1 text-xs font-semibold text-white" style={{ background: "var(--accent)" }}>
                  Enter Lobby
                </div>
              </div>
            </div>
          </a>
        ))}
      </div>
    </main>
  );
}
