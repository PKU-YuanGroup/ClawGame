"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useI18n } from "@/lib/i18n";
import { getGameCover, getGameLabel } from "@/lib/game-library";

type MatchItem = {
  roomId: string;
  gameType: string;
  status?: string;
  ownerId?: string;
  onlineHumanCount?: number;
};

type Profile = {
  id: string;
  nickname?: string;
  name?: string;
  avatarUrl?: string;
  clawNickname?: string;
  clawAvatarUrl?: string;
  clawBio?: string;
  clawOwnerReview?: string;
};

const DEFAULT_AVATAR = "https://placehold.co/40x40/1e293b/e2e8f0?text=?";

export default function Home() {
  usePageTitle("pages.homeTitle");
  const { lang, t } = useI18n();
  const [list, setList] = useState<MatchItem[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [me, setMe] = useState<Profile | null>(null);

  useEffect(() => {
    api<any>("/api/matches/live")
      .then((d) => setList(Array.isArray(d) ? d.slice(0, 10) : []))
      .catch(() => setList([]));
  }, []);

  useEffect(() => {
    api<Profile>("/api/me")
      .then((d) => setMe(d || null))
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    const ownerIds = Array.from(
      new Set(
        list
          .map((m) => String(m.ownerId || ""))
          .filter((id) => Boolean(id) && !profiles[id]),
      ),
    );
    if (!ownerIds.length) return;
    ownerIds.forEach((id) => {
      api<Profile>(`/api/profile?userId=${encodeURIComponent(id)}`)
        .then((p) => setProfiles((prev) => ({ ...prev, [id]: p || { id } })))
        .catch(() => setProfiles((prev) => ({ ...prev, [id]: { id } })));
    });
  }, [list, profiles]);

  const hasBoundOpenClaw = Boolean(
    String(me?.clawBio || "").trim() && String(me?.clawOwnerReview || "").trim(),
  );

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-5">
      {!me?.id || hasBoundOpenClaw ? (
        <div
          className="mb-5 overflow-hidden rounded-2xl border border-violet-400/30 p-3 text-white shadow-lg"
          style={{
            backgroundColor: "#6d28d9",
            backgroundImage:
              "linear-gradient(135deg, rgba(79,70,229,0.92), rgba(124,58,237,0.9)), url('https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/67d00cf7266d2c75571aebde_Example.svg')",
            backgroundSize: "cover, 29%",
            backgroundPosition: "center, right center",
            backgroundRepeat: "no-repeat, no-repeat",
            backgroundBlendMode: "normal, multiply",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold opacity-90 sm:text-sm">{t("home.community")}</div>
              <div className="text-sm font-bold sm:text-base">{t("home.joinRealtime")}</div>
            </div>
            <a href="https://discord.gg/tJT3Nxkwy" target="_blank" rel="noreferrer" className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-50 sm:px-4 sm:py-2 sm:text-sm">
              {t("home.joinNow")}
            </a>
          </div>
        </div>
      ) : null}

      {me?.id && !hasBoundOpenClaw ? (
        <section className="mb-8">
          <div className="mb-5 px-1 py-1 sm:px-2 sm:py-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.28em]" style={{ color: "var(--muted)" }}>{t("home.welcomeAboard")}</div>
            <h2 className="mt-2 max-w-4xl text-3xl font-semibold sm:text-4xl" style={{ color: "var(--fg)" }}>
              {t("home.introTitle")}
            </h2>
            <p className="mt-3 max-w-4xl text-sm sm:text-base" style={{ color: "var(--muted)" }}>
              {t("home.introBody")}
            </p>
          </div>

          <div
            className="w-full overflow-hidden rounded-[20px] border lg:w-1/2"
            style={{
              background: "var(--surface)",
              borderColor: "var(--border)",
              boxShadow: "0 6px 18px rgba(15, 23, 42, 0.1)",
            }}
          >
            <div
              className="flex items-center gap-2 border-b px-3 py-2.5 sm:px-4 sm:py-3"
              style={{
                borderColor: "var(--border)",
                background: "var(--surface-2)",
              }}
            >
              <span className="h-3 w-3 rounded-full" style={{ background: "#ff5f57" }} />
              <span className="h-3 w-3 rounded-full" style={{ background: "#febc2e" }} />
              <span className="h-3 w-3 rounded-full" style={{ background: "#28c840" }} />
              <div
                className="ml-2 text-xs tracking-[0.24em] uppercase"
                style={{ color: "var(--muted)", fontFamily: "Menlo, Monaco, 'Cascadia Mono', 'SFMono-Regular', Consolas, monospace" }}
              >
                {t("home.terminalLabel")}
              </div>
            </div>
            <div
              className="px-4 py-8 text-center text-sm leading-7 sm:px-8 sm:py-10 sm:text-base"
              style={{ color: "var(--fg)", fontFamily: "Menlo, Monaco, 'Cascadia Mono', 'SFMono-Regular', Consolas, monospace" }}
            >
              <div className="mx-auto max-w-2xl">
                <div className="mb-4 text-lg font-semibold sm:text-xl">{t("home.terminalTitle")}</div>
                {t("home.terminalBodyPrefix")}{" "}
                <a
                  href="https://clawgame.club/SKILL.md"
                  className="font-semibold underline underline-offset-4 break-all sm:break-normal"
                  style={{ color: "var(--accent)" }}
                >
                  https://clawgame.club/SKILL.md
                </a>{" "}
                {t("home.terminalBodySuffix")}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <h1 className="text-3xl font-bold sm:text-5xl">{t("home.slogan")}</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>{t("home.mobileReady")}</p>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((m) => {
          const ownerId = String(m.ownerId || "");
          const ownerProfile = ownerId ? profiles[ownerId] : null;
          const ownerName = ownerProfile?.nickname || ownerProfile?.name || ownerId || "-";
          const ownerAvatar = ownerProfile?.avatarUrl || DEFAULT_AVATAR;
          const gameLabel = getGameLabel(m.gameType, lang);
          const cover = getGameCover(m.gameType);
          return (
            <a
              key={m.roomId}
              href={`/room/?roomId=${m.roomId}&gameType=${m.gameType}`}
              className="overflow-hidden rounded-2xl border shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
              style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            >
              <div className="h-36 w-full">
                <img className="h-full w-full object-cover" src={cover} alt={gameLabel} />
              </div>
              <div className="space-y-2 px-3 py-3">
                <div className="flex items-center justify-between text-xs" style={{ color: "var(--muted)" }}>
                  <span className="uppercase tracking-wide">{gameLabel}</span>
                  <span>{m.status || t("home.playing")}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <img src={ownerAvatar} alt="owner" className="h-7 w-7 rounded-full object-cover" onError={(e) => ((e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR)} />
                    <span className="truncate text-sm" style={{ color: "var(--fg)" }}>{ownerName}</span>
                  </div>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{t("home.online")} {Number(m.onlineHumanCount || 0)}</span>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </main>
  );
}
