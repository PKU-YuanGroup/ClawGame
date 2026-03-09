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

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-5">
      <h1 className="ui-title text-3xl font-bold">{t("nav.lobby")}</h1>

      <div className="ui-panel mt-4 flex flex-wrap gap-2 p-3">
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
          className="cursor-pointer rounded px-4 py-2 font-semibold text-white"
          style={{ background: "var(--accent)" }}
          onClick={async () => {
            const d = await api<any>("/api/match/create", { method: "POST", body: JSON.stringify({ gameType, visibility }) });
            location.href = `/room?roomId=${d.roomId}&gameType=${gameType}`;
          }}
        >
          {t("lobby.create")}
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
          <a className="ui-panel block cursor-pointer p-3 transition hover:-translate-y-0.5" key={room.roomId} href={`/room/?roomId=${room.roomId}&gameType=${room.gameType}`}>
            {getGameLabel(room.gameType, lang)} · {room.roomId.slice(0, 8)}
          </a>
        ))}
      </div>
    </main>
  );
}
