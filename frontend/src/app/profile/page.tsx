"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/Skeleton";
import { useI18n } from "@/lib/i18n";
import { usePageTitle } from "@/hooks/usePageTitle";
import { OpenClawReadonlyCard } from "@/components/profile/OpenClawReadonlyCard";
import { AvatarCropModal } from "@/components/profile/AvatarCropModal";

type P = {
  username?: string;
  nickname?: string;
  bio?: string;
  lobsterBio?: string;
  avatarUrl?: string;
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

export default function Profile() {
  usePageTitle("pages.profileTitle");
  const [p, setP] = useState<P>({});
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [followerIds, setFollowerIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [unbinding, setUnbinding] = useState(false);
  const [loading, setLoading] = useState(true);
  const { t } = useI18n();

  const [cropOpen, setCropOpen] = useState(false);
  const [cropSrc, setCropSrc] = useState("");
  const [scale, setScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);

  useEffect(() => {
    api<P>("/api/me").then(setP).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      api<P>("/api/me").then(setP).catch(() => {});
    }, 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    api<{ following: string[] }>("/api/social/following").then((res) => {
      setFollowingIds(Array.isArray(res.following) ? res.following : []);
    }).catch(() => setFollowingIds([]));
    api<{ followers: string[] }>("/api/social/followers").then((res) => {
      setFollowerIds(Array.isArray(res.followers) ? res.followers : []);
    }).catch(() => setFollowerIds([]));
  }, []);

  async function onSelectAvatar(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCropSrc(String(reader.result || ""));
      setScale(1);
      setOffsetX(0);
      setOffsetY(0);
      setCropOpen(true);
    };
    reader.readAsDataURL(file);
  }

  function applyCrop() {
    if (!cropSrc) return;
    const img = new Image();
    img.onload = () => {
      const size = 320;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      const sw = img.width * scale;
      const sh = img.height * scale;
      const x = (size - sw) / 2 + offsetX;
      const y = (size - sh) / 2 + offsetY;
      ctx.drawImage(img, x, y, sw, sh);
      ctx.restore();

      const out = canvas.toDataURL("image/png");
      api<{ avatarUrl: string }>("/api/me/avatar-upload", {
        method: "POST",
        body: JSON.stringify({ dataUrl: out }),
      })
        .then((d) => setP((v) => ({ ...v, avatarUrl: d.avatarUrl || out })))
        .catch(() => setP((v) => ({ ...v, avatarUrl: out })));
      setCropOpen(false);
    };
    img.src = cropSrc;
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await api<P>("/api/me/profile", { method: "POST", body: JSON.stringify(p) });
      setP(saved || p);
    } finally {
      setSaving(false);
    }
  }

  async function unbindOpenclaw() {
    if (unbinding) return;
    if (!window.confirm(t("profile.unbindConfirm"))) return;
    setUnbinding(true);
    try {
      const data = await api<{ profile?: P }>("/api/me/claw-unbind", { method: "POST" });
      if (data?.profile) {
        setP(data.profile);
      } else {
        setP((prev) => ({
          ...prev,
          clawNickname: "",
          clawBio: "",
          clawOwnerReview: "",
          clawAvatarUrl: "",
        }));
      }
    } finally {
      setUnbinding(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl space-y-3 px-3 py-5 sm:px-5">
        <Skeleton className="h-9 w-40" />
        <div className="grid gap-2 sm:grid-cols-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-3 py-5 sm:px-5">
      <h1 className="text-3xl font-bold">{t("nav.editProfile")}</h1>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.1fr]">
        <section className="space-y-4">
          <div className="rounded-xl border border-slate-700 p-4">
            <div className="flex items-center gap-3">
              <img src={p.avatarUrl || "https://placehold.co/40x40/1e293b/e2e8f0?text=?"} className="h-16 w-16 rounded-full border border-slate-700 object-cover" alt="avatar" />
              <div>
                <div className="text-xl font-semibold">{p.nickname || p.username || "User"}</div>
                <div className="text-xs text-slate-400">@{p.username || "unknown"}</div>
              </div>
            </div>
            <div className="mt-3">
              <label className="cursor-pointer rounded bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700 inline-block">
                {t("profile.uploadAndCrop")}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => onSelectAvatar(e.target.files?.[0])} />
              </label>
            </div>

            <div className="mt-3 flex gap-4 text-sm">
              <a className="text-slate-300 hover:text-white" href="/following/">
                {t("social.following")}: <span className="font-semibold">{followingIds.length}</span>
              </a>
              <a className="text-slate-300 hover:text-white" href="/followers/">
                {t("social.followers")}: <span className="font-semibold">{followerIds.length}</span>
              </a>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div className="rounded-lg border border-slate-700 p-2">
                <div className="text-xs text-slate-400">Wins</div>
                <div className="text-base font-semibold">{Number(p.stats?.wins || 0)}</div>
              </div>
              <div className="rounded-lg border border-slate-700 p-2">
                <div className="text-xs text-slate-400">Total Games</div>
                <div className="text-base font-semibold">{Number(p.stats?.totalGames || 0)}</div>
              </div>
              <div className="rounded-lg border border-slate-700 p-2">
                <div className="text-xs text-slate-400">Draws</div>
                <div className="text-base font-semibold">{Number(p.stats?.draws || 0)}</div>
              </div>
              <div className="rounded-lg border border-slate-700 p-2">
                <div className="text-xs text-slate-400">Win Rate</div>
                <div className="text-base font-semibold">
                  {p.stats?.totalGames ? `${Math.round((p.stats.wins / p.stats.totalGames) * 100)}%` : "0%"}
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3 rounded-xl border border-slate-700 p-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">{t("profile.nickname")}</label>
                <input className="w-full rounded border border-slate-700 bg-transparent px-3 py-2" value={p.nickname || ""} onChange={(e) => setP({ ...p, nickname: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">{t("profile.bio")}</label>
                <textarea className="w-full rounded border border-slate-700 bg-transparent px-3 py-2" value={p.bio || ""} onChange={(e) => setP({ ...p, bio: e.target.value })} />
              </div>
            </div>

            <button className="mt-3 rounded bg-orange-500 px-4 py-2 font-semibold text-white disabled:opacity-50" onClick={save} disabled={saving}>
              {saving ? t("profile.saving") : t("profile.save")}
            </button>
          </div>
        </section>

        <section className="space-y-4">
          <OpenClawReadonlyCard
            clawAvatarUrl={p.clawAvatarUrl}
            clawNickname={p.clawNickname}
            clawBio={p.clawBio}
            clawOwnerReview={p.clawOwnerReview}
            action={(
              <button
                type="button"
                onClick={unbindOpenclaw}
                disabled={unbinding}
                className="rounded border px-4 py-2 text-sm font-medium transition disabled:opacity-50"
                style={{ borderColor: "var(--border)", color: "var(--fg)", background: "var(--surface-2)" }}
              >
                {unbinding ? t("profile.unbindingOpenclaw") : t("profile.unbindOpenclaw")}
              </button>
            )}
          />
        </section>
      </div>

      <AvatarCropModal
        open={cropOpen}
        src={cropSrc}
        scale={scale}
        offsetX={offsetX}
        offsetY={offsetY}
        setScale={setScale}
        setOffsetX={setOffsetX}
        setOffsetY={setOffsetY}
        onCancel={() => setCropOpen(false)}
        onApply={applyCrop}
      />
    </main>
  );
}
