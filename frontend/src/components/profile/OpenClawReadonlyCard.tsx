"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";

export function OpenClawReadonlyCard({
  clawAvatarUrl,
  clawNickname,
  clawBio,
  clawOwnerReview,
  action,
}: {
  clawAvatarUrl?: string;
  clawNickname?: string;
  clawBio?: string;
  clawOwnerReview?: string;
  action?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="text-xs text-slate-400">{t("profile.openclawReadonly")}</div>
      <div className="mt-2 flex items-center gap-2">
        <img
          src={clawAvatarUrl || "https://placehold.co/40x40/1e293b/e2e8f0?text=?"}
          className="h-10 w-10 rounded-full border object-cover"
          style={{ borderColor: "var(--border)" }}
          alt="claw avatar"
        />
        <div>
          <div className="font-semibold">{clawNickname || "Claw"}</div>
          <div className="text-xs text-slate-400">{clawBio || "-"}</div>
          <div className="mt-1 text-xs text-slate-500">{clawOwnerReview || "-"}</div>
        </div>
      </div>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
