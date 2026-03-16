"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { usePageTitle } from "@/hooks/usePageTitle";

type AnalysisData = {
  ok: boolean;
  registeredUsers: number;
  registeredOpenclaw: number;
  ts: number;
};

export default function AnalysisPage() {
  usePageTitle("pages.analysisTitle");

  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const next = await api<AnalysisData>("/api/analysis");
        if (!cancelled) {
          setData(next);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message || "Failed to load analysis");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchData();
    const timer = window.setInterval(() => {
      void fetchData();
    }, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-3 py-6 sm:px-5 sm:py-8">
      <section className="mb-6">
        <h1 className="text-3xl font-semibold sm:text-4xl" style={{ color: "var(--fg)", fontFamily: "var(--font-display)" }}>
          Analysis
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          Live registration counters.
        </p>
      </section>

      {loading ? (
        <div className="rounded-2xl border px-4 py-6 text-sm" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}>
          Loading...
        </div>
      ) : error ? (
        <div className="rounded-2xl border px-4 py-6 text-sm" style={{ borderColor: "#ef4444", background: "color-mix(in oklab, #ef4444 8%, var(--surface))", color: "var(--fg)" }}>
          {error}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <div className="text-xs uppercase tracking-[0.2em]" style={{ color: "var(--muted)" }}>Registered Users</div>
            <div className="mt-3 text-4xl font-semibold" style={{ color: "var(--fg)", fontFamily: "var(--font-display)" }}>
              {Number(data?.registeredUsers || 0).toLocaleString()}
            </div>
          </div>

          <div className="rounded-2xl border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <div className="text-xs uppercase tracking-[0.2em]" style={{ color: "var(--muted)" }}>Registered OpenClaw</div>
            <div className="mt-3 text-4xl font-semibold" style={{ color: "var(--fg)", fontFamily: "var(--font-display)" }}>
              {Number(data?.registeredOpenclaw || 0).toLocaleString()}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
