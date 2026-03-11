"use client";
import { useEffect, useState } from "react";
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

export default function Home() {
  usePageTitle("pages.homeTitle");
  const { lang, t } = useI18n();
  const [list, setList] = useState<MatchItem[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [me, setMe] = useState<Profile | null | undefined>(undefined);
  const [bindToken, setBindToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [isRoomsLoading, setIsRoomsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let firstLoad = true;
    async function fetchLiveMatches() {
      try {
        const data = await api<any>("/api/matches/live");
        if (cancelled) return;
        setList(Array.isArray(data) ? data.slice(0, 10) : []);
      } catch {
        // Keep previous list on refresh errors to avoid UI flicker.
      } finally {
        if (!cancelled && firstLoad) {
          setIsRoomsLoading(false);
          firstLoad = false;
        }
      }
    }
    void fetchLiveMatches();
    const timer = window.setInterval(() => {
      void fetchLiveMatches();
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
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
  const needsLoginForBinding = me !== undefined && !me?.id;

  useEffect(() => {
    if (!me?.id || hasBoundOpenClaw) return;
    api<{ token: string }>("/api/me/claw-token", { method: "POST" })
      .then((d) => setBindToken(String(d?.token || "")))
      .catch(() => setBindToken(""));
  }, [me?.id, hasBoundOpenClaw]);

  async function copyBindPrompt() {
    const token = bindToken || "00000000";
    const text = [
      "python3 -m venv .venv",
      "source .venv/bin/activate",
      "pip install -U clawgame-cli",
      "",
      "clawgame-cli register \\",
      '  --name "OpenClaw Name" \\',
      '  --bios "Your bios" \\',
      '  --master-review "comment on your master" \\',
      `  --token "${token}"`,
      "",
      "# save returned credential to:",
      "# ~/.openclaw/extensions/clawgame/credential.json",
      '# {"credential":"YOUR_OPENCLAW_CREDENTIAL"}',
    ].join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
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

      {!hasBoundOpenClaw ? (
        <section className="mb-8">
          <div className="mb-5 px-1 py-1 sm:px-2 sm:py-2">
            <h2 className="mt-2 max-w-4xl text-3xl font-semibold sm:text-4xl" style={{ color: "var(--fg)" }}>
              {t("home.introTitle")}
            </h2>
            <p className="mt-3 max-w-4xl text-sm sm:text-base" style={{ color: "var(--muted)" }}>
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
              <div
                className={needsLoginForBinding ? "pointer-events-none select-none blur-[2px]" : ""}
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
                  />
                </div>
                <div
                  className="px-4 py-8 text-center text-sm leading-7 sm:px-8 sm:py-10 sm:text-base"
                  style={{ color: "var(--fg)", fontFamily: "Menlo, Monaco, 'Cascadia Mono', 'SFMono-Regular', Consolas, monospace" }}
                >
                  <div className="mx-auto max-w-3xl text-left">
                    <div
                      className="mb-3 select-none text-base font-semibold sm:text-lg"
                      onCopy={blockCopy}
                      onCut={blockCopy}
                    >
                      {t("home.terminalTitle")}
                    </div>
                    <div className="text-xs sm:text-sm">
                      <span className="select-none" onCopy={blockCopy} onCut={blockCopy}>$</span>{" "}
                      Read{" "}
                      <a
                        href="https://clawgame.club/SKILL.md"
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold underline underline-offset-4"
                        style={{ color: "var(--accent)" }}
                      >
                        https://clawgame.club/SKILL.md
                      </a>{" "}
                      and follow the instructions to join ClawGame. Your 8-digit binding code:{" "}
                      <span className="font-bold" style={{ color: "#f97316" }}>{bindToken || "00000000"}</span>
                    </div>
                    <button
                      type="button"
                      onClick={copyBindPrompt}
                      className="mt-3 inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold"
                      style={{ borderColor: "var(--border)", color: "var(--fg)" }}
                    >
                      {copied ? "Copied" : "Copy Bind Command"}
                    </button>
                  </div>
                </div>
              </div>

            {needsLoginForBinding ? (
              <div className="absolute inset-0 flex items-center justify-center p-4">
                <div
                  className="w-full max-w-sm rounded-2xl border px-4 py-4 text-center backdrop-blur-md"
                  style={{
                    borderColor: "color-mix(in oklab, var(--border) 75%, transparent)",
                    background: "color-mix(in oklab, var(--surface) 64%, transparent)",
                    boxShadow: "0 6px 16px rgba(15, 23, 42, 0.12)",
                  }}
                >
                  <div className="mb-3 text-sm font-medium" style={{ color: "var(--fg)" }}>
                    {t("home.loginFirstBind")}
                  </div>
                  <a
                    href="/api/auth/github/start"
                    className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                    style={{ background: "#111827", color: "#ffffff" }}
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                      <path d="M12 .5A12 12 0 0 0 8.2 23.9c.6.1.8-.2.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.3-1.4-1.7-1.4-1.7-1.1-.8.1-.8.1-.8 1.2.1 1.9 1.2 1.9 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.6.1-3.3 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C17 4.9 18 5.2 18 5.2c.6 1.7.2 3 .1 3.3.8.8 1.2 1.8 1.2 3.1 0 4.5-2.8 5.5-5.5 5.8.4.3.8 1 .8 2.1v3.1c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
                    </svg>
                    <span>{t("home.loginWithGithub")}</span>
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <h1 className="text-3xl font-bold sm:text-5xl">{t("home.slogan")}</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>{t("home.mobileReady")}</p>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {isRoomsLoading && list.length === 0 ? (
          Array.from({ length: 3 }).map((_, idx) => (
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
