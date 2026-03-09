"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useI18n } from "@/lib/i18n";
import { getGameLabel, listConfiguredGames } from "@/lib/game-library";

type LobbyRoom = {
  roomId: string;
  gameType: string;
};

export default function Lobby() {
  usePageTitle("pages.lobbyTitle");
  const { lang, t } = useI18n();
  const gameTypes = listConfiguredGames();
  const [gameType, setGameType] = useState(gameTypes[0] || "gomoku");
  const [visibility, setVisibility] = useState("public");
  const [rooms, setRooms] = useState<LobbyRoom[]>([]);
  const [creating, setCreating] = useState(false);

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-5">
      <h1 className="ui-title text-3xl font-bold">{t("nav.lobby")}</h1>

      <div className="mt-4 flex flex-wrap gap-2 rounded-2xl border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)", boxShadow: "0 4px 10px rgba(2, 6, 23, 0.08)" }}>
        <select className="cursor-pointer rounded border px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--elevated)" }} value={gameType} onChange={(e) => setGameType(e.target.value)}>
          {gameTypes.map((gt) => (
            <option key={gt} value={gt}>{getGameLabel(gt, lang)}</option>
          ))}
        </select>

        <select className="cursor-pointer rounded border px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--elevated)" }} value={visibility} onChange={(e) => setVisibility(e.target.value)}>
          <option value="public">{t("lobby.public")}</option>
          <option value="private">{t("lobby.private")}</option>
        </select>

        <button
          className="rounded px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
          style={{ background: "var(--accent)" }}
          disabled={creating}
          onClick={async () => {
            if (creating) return;
            setCreating(true);
            try {
              const d = await api<any>("/api/match/create", { method: "POST", body: JSON.stringify({ gameType, visibility }) });
              location.href = `/room?roomId=${d.roomId}&gameType=${gameType}`;
            } finally {
              setCreating(false);
            }
          }}
        >
          {creating ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
              Creating...
            </span>
          ) : (
            t("lobby.create")
          )}
        </button>

        <button
          className="cursor-pointer rounded border px-4 py-2"
          style={{ borderColor: "var(--border)", background: "var(--elevated)" }}
          onClick={async () => {
            const d = await api<any>(`/api/lobby/public?gameType=${gameType}`);
            setRooms(Array.isArray(d) ? d : []);
          }}
        >
          {t("lobby.refresh")}
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {rooms.map((room) => (
          <a className="block cursor-pointer rounded-2xl border p-3 transition hover:-translate-y-0.5" style={{ borderColor: "var(--border)", background: "var(--surface)", boxShadow: "0 4px 10px rgba(2, 6, 23, 0.08)" }} key={room.roomId} href={`/room/?roomId=${room.roomId}&gameType=${room.gameType}`}>
            {getGameLabel(room.gameType, lang)} · {room.roomId.slice(0, 8)}
          </a>
        ))}
      </div>
    </main>
  );
}
