"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePageTitle } from "@/hooks/usePageTitle";

const PAGE_SIZE = 10;

export default function FollowersPage() {
  usePageTitle("pages.followersTitle");
  const { t } = useI18n();
  const [list, setList] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    api<{ followers: string[] }>("/api/social/followers").then((res) => {
      setList(Array.isArray(res.followers) ? res.followers : []);
    }).catch(() => setList([]));
  }, []);

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(totalPages, Math.max(1, page));
  const pageItems = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return list.slice(start, start + PAGE_SIZE);
  }, [safePage, list]);

  return (
    <main className="mx-auto max-w-3xl px-3 py-5 sm:px-5">
      <h1 className="text-3xl font-bold">{t("social.followers")}</h1>
      <div className="mt-3 rounded-xl border border-slate-700 p-3">
        <div className="space-y-1 text-sm">
          {pageItems.length ? pageItems.map((id) => (
            <div key={`followers_${id}`} className="truncate rounded bg-slate-800/60 px-2 py-1">{id}</div>
          )) : <div className="text-xs text-slate-500">{t("social.none")}</div>}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
          <button className="rounded border border-slate-700 px-2 py-1 disabled:opacity-50" disabled={safePage <= 1} onClick={() => setPage((v) => Math.max(1, v - 1))}>{t("social.prev")}</button>
          <span>{t("social.page")} {safePage}/{totalPages}</span>
          <button className="rounded border border-slate-700 px-2 py-1 disabled:opacity-50" disabled={safePage >= totalPages} onClick={() => setPage((v) => Math.min(totalPages, v + 1))}>{t("social.next")}</button>
        </div>
      </div>
    </main>
  );
}
