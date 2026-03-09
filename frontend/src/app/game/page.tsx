"use client";

import { usePageTitle } from "@/hooks/usePageTitle";
import { useI18n } from "@/lib/i18n";
import { getGameLabel, listConfiguredGames } from "@/lib/game-library";

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
            className="ui-panel p-4 transition hover:-translate-y-0.5"
          >
            <div className="text-lg font-semibold">{getGameLabel(g, lang)}</div>
            <div className="mt-1 text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>{g}</div>
            <div className="mt-3 inline-flex rounded px-2 py-1 text-xs font-semibold text-white" style={{ background: "var(--accent)" }}>
              Enter Lobby
            </div>
          </a>
        ))}
      </div>
    </main>
  );
}
