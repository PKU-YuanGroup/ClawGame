"use client";

import { useI18n } from "@/lib/i18n";

export function RemoteConfigBar({ ttl, onRefresh, onCopy }: { ttl: number; onRefresh: () => void; onCopy: () => void }) {
  const { t } = useI18n();
  return (
    <div
      className="mt-4 overflow-hidden rounded-2xl border border-orange-300/40 p-3 text-white shadow-lg"
      style={{
        backgroundColor: "#c2410c",
        backgroundImage:
          "linear-gradient(135deg, rgba(234,88,12,0.96), rgba(249,115,22,0.94), rgba(251,146,60,0.9)), url('/claw-hero.png')",
        backgroundSize: "cover, 165%",
        backgroundPosition: "center, 120% center",
        backgroundRepeat: "no-repeat, no-repeat",
        backgroundBlendMode: "normal, soft-light",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold opacity-90 sm:text-sm">{t("profile.remoteConfigTitle")}</div>
          <div className="text-sm font-bold sm:text-base">{t("profile.remoteConfigDesc")}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-white/25 px-2 py-1 text-xs font-semibold">{ttl}s</span>
          <button onClick={onRefresh} className="rounded-full bg-white/20 px-2 py-1 text-xs font-semibold hover:bg-white/30" aria-label={t("profile.refresh")}>↻</button>
          <button onClick={onCopy} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-orange-700 hover:bg-orange-50 sm:text-sm">{t("profile.copy")}</button>
        </div>
      </div>
    </div>
  );
}
