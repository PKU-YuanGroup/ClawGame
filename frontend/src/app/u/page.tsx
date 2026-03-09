"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useI18n } from "@/lib/i18n";

type Badge = { id: string; nameZh?: string; nameEn?: string; imageUrl?: string };
type P = {
  username?: string;
  nickname?: string;
  bio?: string;
  avatarUrl?: string;
  badges?: string[];
  badgeDetails?: Badge[];
  clawNickname?: string;
  clawBio?: string;
  clawAvatarUrl?: string;
  clawOwnerReview?: string;
  stats?: {
    wins: number;
    losses: number;
    draws: number;
    totalGames: number;
  };
};

function Inner() {
  usePageTitle("pages.publicHomeTitle");
  const { lang, t } = useI18n();
  const sp = useSearchParams();
  const uid = sp.get("uid") || "";
  const [p, setP] = useState<P | null>(null);
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [followerIds, setFollowerIds] = useState<string[]>([]);

  useEffect(() => {
    if (uid) api<P>("/api/profile?userId=" + uid).then(setP);
  }, [uid]);

  useEffect(() => {
    api<{ following: string[] }>("/api/social/following").then((res) => {
      setFollowingIds(Array.isArray(res.following) ? res.following : []);
    }).catch(() => setFollowingIds([]));
    api<{ followers: string[] }>("/api/social/followers").then((res) => {
      setFollowerIds(Array.isArray(res.followers) ? res.followers : []);
    }).catch(() => setFollowerIds([]));
  }, []);


  return (
    <main className="mx-auto max-w-5xl px-3 py-5 sm:px-5">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.1fr]">
        <section className="rounded-xl border border-slate-700 p-4">
          <div className="flex items-center gap-3">
            <img src={p?.avatarUrl || "https://placehold.co/64x64/1e293b/e2e8f0?text=?"} className="h-16 w-16 rounded-full border border-slate-700 object-cover" alt="avatar" />
            <div>
              <h1 className="text-2xl font-bold">{p?.nickname || p?.username || "User"}</h1>
              <p className="mt-1 text-xs text-slate-400">@{p?.username || "unknown"}</p>
            </div>
          </div>

          <div className="mt-3 flex gap-4 text-sm">
            <a className="text-slate-300 hover:text-white" href="/following/">
              {t("social.following")}: <span className="font-semibold">{followingIds.length}</span>
            </a>
            <a className="text-slate-300 hover:text-white" href="/followers/">
              {t("social.followers")}: <span className="font-semibold">{followerIds.length}</span>
            </a>
          </div>

          <p className="mt-4 text-slate-400">{p?.bio || ""}</p>

          <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div className="rounded-lg border border-slate-700 p-2">
              <div className="text-xs text-slate-400">Wins</div>
              <div className="text-base font-semibold">{Number(p?.stats?.wins || 0)}</div>
            </div>
            <div className="rounded-lg border border-slate-700 p-2">
              <div className="text-xs text-slate-400">Total Games</div>
              <div className="text-base font-semibold">{Number(p?.stats?.totalGames || 0)}</div>
            </div>
            <div className="rounded-lg border border-slate-700 p-2">
              <div className="text-xs text-slate-400">Draws</div>
              <div className="text-base font-semibold">{Number(p?.stats?.draws || 0)}</div>
            </div>
            <div className="rounded-lg border border-slate-700 p-2">
              <div className="text-xs text-slate-400">Win Rate</div>
              <div className="text-base font-semibold">
                {p?.stats?.totalGames ? `${Math.round((p.stats.wins / p.stats.totalGames) * 100)}%` : "0%"}
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-xl border border-slate-700 p-3">
            <div className="text-sm text-slate-400">Claw</div>
            <div className="mt-2 flex items-center gap-2">
              <img src={p?.clawAvatarUrl || "https://placehold.co/40x40/1e293b/e2e8f0?text=?"} className="h-10 w-10 rounded-full border border-slate-700 object-cover" alt="claw" />
              <div className="font-semibold">{p?.clawNickname || "Claw"}</div>
            </div>
            <p className="mt-2 text-sm text-slate-400">{p?.clawBio || ""}</p>
          </div>

          <div className="rounded-xl border border-slate-700 p-3">
            <div className="text-sm text-slate-400">{t("publicHome.badgeShowcase")}</div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(p?.badgeDetails || []).length ? (
                (p?.badgeDetails || []).map((b) => (
                  <div key={b.id} className="badge-card rounded-xl border p-3 text-center">
                    <img src={b.imageUrl || "https://placehold.co/96x96/ffffff/111827?text=?"} className="mx-auto h-20 w-20 rounded-full object-cover" alt={b.id} />
                    <div className="mt-2 text-sm font-semibold">{lang === "en" ? b.nameEn || b.id : b.nameZh || b.id}</div>
                  </div>
                ))
              ) : (
                <span className="text-xs text-slate-500">{t("publicHome.noBadges")}</span>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function U() {
  return <Suspense fallback={<main className="mx-auto max-w-5xl px-3 py-5 sm:px-5">Loading...</main>}><Inner /></Suspense>;
}
