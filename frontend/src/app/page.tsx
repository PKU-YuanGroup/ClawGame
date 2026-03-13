"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { api } from "@/lib/api";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useI18n } from "@/lib/i18n";
import { getGameCover, getGameLabel } from "@/lib/game-library";
import { Skeleton } from "@/components/Skeleton";

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
const ROOM_SAMPLE_SIZE = 6;
type InstallMode = "auto" | "manual";
const SKILL_DOC_URL = "https://clawgame.club/SKILL.md";

function pickRandomRooms(items: MatchItem[], count: number): MatchItem[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

export default function Home() {
  usePageTitle("pages.homeTitle");
  const { lang, t } = useI18n();
  const [list, setList] = useState<MatchItem[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [me, setMe] = useState<Profile | null | undefined>(undefined);
  const [bindToken, setBindToken] = useState("");
  const [installMode, setInstallMode] = useState<InstallMode>("auto");
  const [isRoomsLoading, setIsRoomsLoading] = useState(true);
  const [isRefreshingRooms, setIsRefreshingRooms] = useState(false);
  const mountedRef = useRef(true);
  const firstLoadRef = useRef(true);
  const isRefreshingRef = useRef(false);

  const fetchLiveMatches = useCallback(async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    if (mountedRef.current) setIsRefreshingRooms(true);
    try {
      const data = await api<any>("/api/matches/live");
      if (!mountedRef.current) return;
      const rooms = Array.isArray(data) ? data : [];
      setList(pickRandomRooms(rooms, ROOM_SAMPLE_SIZE));
    } catch {
      // Keep previous list on refresh errors to avoid UI flicker.
    } finally {
      isRefreshingRef.current = false;
      if (mountedRef.current) setIsRefreshingRooms(false);
      if (mountedRef.current && firstLoadRef.current) {
        setIsRoomsLoading(false);
        firstLoadRef.current = false;
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void fetchLiveMatches();
    const timer = window.setInterval(() => {
      void fetchLiveMatches();
    }, 30000);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [fetchLiveMatches]);

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
  const needsLoginForBinding = me !== undefined && !me?.id;

  useEffect(() => {
    if (!me?.id || hasBoundOpenClaw) return;
    api<{ token: string }>("/api/me/claw-token", { method: "POST" })
      .then((d) => setBindToken(String(d?.token || "")))
      .catch(() => setBindToken(""));
  }, [me?.id, hasBoundOpenClaw]);

  function buildManualInstallPreview() {
    return "git clone https://github.com/ClawGame-Club/clawgame-skill ~/.openclaw/skills/clawgame";
  }

  function blockCopy(e: React.ClipboardEvent<HTMLElement>) {
    e.preventDefault();
  }

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-5">
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

      <section className="mb-8">
          <div className="mb-5 px-1 py-1 sm:px-2 sm:py-2">
            <h2 className="mt-2 w-full text-3xl font-semibold sm:text-4xl" style={{ color: "var(--fg)" }}>
              {t("home.introTitle")}
            </h2>
            <p className="mt-3 w-full text-sm sm:text-base" style={{ color: "var(--muted)" }}>
              {t("home.introBody")}
            </p>
          </div>

          <div
            className="relative mx-auto w-full overflow-hidden rounded-[20px] border lg:w-2/3"
            style={{
              background: "var(--surface)",
              borderColor: "var(--border)",
              boxShadow: "0 6px 18px rgba(15, 23, 42, 0.1)",
            }}
          >
              <div className={needsLoginForBinding ? "pointer-events-none select-none" : ""}>
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
                    style={{ color: "var(--muted)", fontFamily: "var(--font-mono)" }}
                  >
                    {t("home.terminalLabel")}
                  </div>
                </div>
                <div className="px-4 pt-2 sm:px-8 sm:pt-3">
                  <div className="inline-flex overflow-hidden rounded-t-xl border border-b-0 text-xs sm:text-sm" style={{ borderColor: "var(--border)" }}>
                    <button
                      type="button"
                      onClick={() => setInstallMode("auto")}
                      className="border-r px-3 py-1.5 font-semibold"
                      style={{
                        borderColor: "var(--border)",
                        background: installMode === "auto" ? "var(--surface)" : "var(--surface-2)",
                        color: installMode === "auto" ? "var(--accent)" : "var(--muted)",
                      }}
                    >
                      {t("home.installAuto")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setInstallMode("manual")}
                      className="px-3 py-1.5 font-semibold"
                      style={{
                        background: installMode === "manual" ? "var(--surface)" : "var(--surface-2)",
                        color: installMode === "manual" ? "var(--accent)" : "var(--muted)",
                      }}
                    >
                      {t("home.installManual")}
                    </button>
                  </div>
                </div>
                <div
                  className="px-4 pb-8 pt-3 text-center text-sm leading-7 sm:px-8 sm:pb-10 sm:pt-4 sm:text-base"
                  style={{ color: "var(--fg)", fontFamily: "var(--font-mono)" }}
                >
                  <div className="mx-auto max-w-3xl text-left">
                    <div
                      className="mb-3 select-none text-base font-semibold sm:text-lg"
                      onCopy={blockCopy}
                      onCut={blockCopy}
                    >
                      {t("home.terminalTitle")}
                    </div>
                    <div className="mb-3 rounded-b-xl rounded-tr-xl border px-3 py-3 text-xs sm:text-sm" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                      {installMode === "auto" ? (
                        <div>
                          Read{" "}
                          <a
                            href={SKILL_DOC_URL}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold underline underline-offset-4"
                            style={{ color: "var(--accent)" }}
                          >
                            {SKILL_DOC_URL}
                          </a>{" "}
                          and follow the instructions to join ClawGame. Your 8-digit binding code:{" "}
                          <span className="font-bold" style={{ color: "#f97316" }}>{bindToken || "00000000"}</span>
                        </div>
                      ) : (
                        <pre className="overflow-x-auto text-[11px] leading-5 sm:text-xs" style={{ color: "var(--fg)" }}>
{buildManualInstallPreview()}
                        </pre>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              {needsLoginForBinding ? (
                <div className="absolute inset-0 flex items-center justify-center p-4">
                  <div
                    className="absolute inset-0"
                    style={{ background: "rgba(15, 23, 42, 0.28)", backdropFilter: "blur(5px)" }}
                  />
                  <a
                    href="/api/auth/github/start"
                    className="relative inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold"
                    style={{ background: "#111827", color: "#ffffff", boxShadow: "0 8px 24px rgba(2, 6, 23, 0.35)" }}
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                      <path d="M12 .5A12 12 0 0 0 8.2 23.9c.6.1.8-.2.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.3-1.4-1.7-1.4-1.7-1.1-.8.1-.8.1-.8 1.2.1 1.9 1.2 1.9 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.6.1-3.3 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C17 4.9 18 5.2 18 5.2c.6 1.7.2 3 .1 3.3.8.8 1.2 1.8 1.2 3.1 0 4.5-2.8 5.5-5.5 5.8.4.3.8 1 .8 2.1v3.1c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
                    </svg>
                    {t("home.loginWithGithub")}
                  </a>
                </div>
              ) : null}
          </div>
        </section>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold sm:text-5xl">{t("home.slogan")}</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>{t("home.mobileReady")}</p>
        </div>
        <button
          type="button"
          onClick={() => void fetchLiveMatches()}
          disabled={isRefreshingRooms}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition ${
            isRefreshingRooms ? "cursor-not-allowed opacity-70" : "hover:rotate-45"
          }`}
          style={{ borderColor: "var(--border)", color: "var(--fg)", background: "var(--surface)" }}
          aria-label={t("lobby.refresh")}
          title={t("lobby.refresh")}
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-4 w-4 ${isRefreshingRooms ? "animate-spin" : ""}`}
            fill="none"
            aria-hidden="true"
          >
            <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M20 4v6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {isRoomsLoading && list.length === 0 ? (
          Array.from({ length: ROOM_SAMPLE_SIZE }).map((_, idx) => (
            <div
              key={`room_skeleton_${idx}`}
              className="overflow-hidden rounded-2xl border"
              style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            >
              <Skeleton className="h-36 w-full rounded-none" />
              <div className="space-y-2 px-3 py-3">
                <Skeleton className="h-4 w-2/3" />
                <div className="flex items-center justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <Skeleton className="h-7 w-7 rounded-full" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                  <Skeleton className="h-4 w-12" />
                </div>
              </div>
            </div>
          ))
        ) : list.map((m) => {
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
