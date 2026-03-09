"use client";

import { useEffect, useState } from "react";
import { getLang, setLang, type Lang, useI18n } from "@/lib/i18n";
import { usePageTitle } from "@/hooks/usePageTitle";

type ThemeMode = "system" | "light" | "dark";

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  const preferDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const actual = mode === "system" ? (preferDark ? "dark" : "light") : mode;
  root.setAttribute("data-theme", actual);
}

export default function Settings() {
  usePageTitle("pages.settingsTitle");
  const [mode, setMode] = useState<ThemeMode>("system");
  const [langMode, setLangMode] = useState<Lang>("zh");
  const { t } = useI18n();

  useEffect(() => {
    const saved = (localStorage.getItem("theme_mode") as ThemeMode | null) || "system";
    setMode(saved);
    applyTheme(saved);
    setLangMode(getLang());

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const now = (localStorage.getItem("theme_mode") as ThemeMode | null) || "system";
      if (now === "system") applyTheme("system");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  function onChange(v: ThemeMode) {
    setMode(v);
    localStorage.setItem("theme_mode", v);
    applyTheme(v);
  }

  return (
    <main className="mx-auto max-w-3xl px-3 py-5 sm:px-5">
      <h1 className="text-3xl font-bold">{t("settings.title")}</h1>

      <div className="mt-5 rounded-xl border border-slate-700 p-4">
        <div className="text-sm text-slate-400">{t("settings.uiStyle")}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={`rounded px-3 py-1.5 text-sm ${mode === "light" ? "bg-orange-500 text-white" : "bg-slate-800"}`} onClick={() => onChange("light")}>{t("settings.light")}</button>
          <button className={`rounded px-3 py-1.5 text-sm ${mode === "dark" ? "bg-orange-500 text-white" : "bg-slate-800"}`} onClick={() => onChange("dark")}>{t("settings.dark")}</button>
          <button className={`rounded px-3 py-1.5 text-sm ${mode === "system" ? "bg-orange-500 text-white" : "bg-slate-800"}`} onClick={() => onChange("system")}>{t("settings.system")}</button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-700 p-4">
        <div className="text-sm text-slate-400">{t("settings.language")}</div>
        <div className="mt-3 flex gap-2">
          <button className={`rounded px-3 py-1.5 text-sm ${langMode === "zh" ? "bg-orange-500 text-white" : "bg-slate-800"}`} onClick={() => { setLangMode("zh"); setLang("zh"); }}>{t("settings.chinese")}</button>
          <button className={`rounded px-3 py-1.5 text-sm ${langMode === "en" ? "bg-orange-500 text-white" : "bg-slate-800"}`} onClick={() => { setLangMode("en"); setLang("en"); }}>{t("settings.english")}</button>
        </div>
      </div>

      <a className="mt-4 inline-block rounded border border-slate-700 px-4 py-2" href="/api/auth/logout">
        {t("nav.logout")}
      </a>
    </main>
  );
}
