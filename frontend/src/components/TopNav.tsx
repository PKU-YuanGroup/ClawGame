"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { getLang, setLang, useI18n, type Lang } from "@/lib/i18n";

type Me = { id?: string; avatarUrl?: string };
const ME_CACHE_KEY = "me_cache_v1";

export function TopNav() {
  const [me, setMe] = useState<Me | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const { t } = useI18n();
  const [lang, setLangState] = useState<Lang>("en");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const menuRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cachedRaw = localStorage.getItem(ME_CACHE_KEY);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as Me;
        if (cached?.id) setMe(cached);
      } catch {}
    }

    api<Me>("/api/me")
      .then((d) => {
        setMe(d || null);
        if (d?.id) localStorage.setItem(ME_CACHE_KEY, JSON.stringify(d));
        else localStorage.removeItem(ME_CACHE_KEY);
      })
      .catch(() => {
        // Keep cached session on transient network failures.
      });

    setLangState(getLang());
    const current = (localStorage.getItem("theme_mode") as "light" | "dark" | "system" | null) || "system";
    const preferDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const actual = current === "system" ? (preferDark ? "dark" : "light") : current;
    setTheme(actual);
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (navRef.current && !navRef.current.contains(e.target as Node)) setNavOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme_mode", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  return (
    <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur">
      <div className="mx-auto grid max-w-6xl grid-cols-[1fr_auto] items-center px-3 py-3 sm:grid-cols-[1fr_auto_1fr] sm:px-5">
        <div className="flex items-center gap-2 justify-self-start">
          <Link href="/" className="flex items-center gap-2 font-bold">
            <img src="/logo.jpg" className="h-7 w-7 rounded object-cover" alt="logo" />
            ClawGame
          </Link>

          {/* Mobile nav button */}
          <div className="relative sm:hidden" ref={navRef}>
            <button
              type="button"
              onClick={() => setNavOpen((v) => !v)}
              className="rounded-xl bg-slate-800/80 p-2 hover:bg-slate-700"
              aria-label="navigation menu"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="5" width="18" height="2.2" rx="1.1" fill="#fb923c"/>
                <rect x="3" y="11" width="18" height="2.2" rx="1.1" fill="#fdba74"/>
                <rect x="3" y="17" width="18" height="2.2" rx="1.1" fill="#fed7aa"/>
              </svg>
            </button>
            <div className={`absolute left-0 mt-2 w-40 origin-top-left overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-xl transition-all duration-200 ${navOpen ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"}`}>
              <Link href="/" className="block px-3 py-2 text-sm hover:bg-slate-800" onClick={() => setNavOpen(false)}>{t("nav.home")}</Link>
              <Link href="/lobby/" className="block px-3 py-2 text-sm hover:bg-slate-800" onClick={() => setNavOpen(false)}>{t("nav.lobby")}</Link>
              <Link href="/game/" className="block px-3 py-2 text-sm hover:bg-slate-800" onClick={() => setNavOpen(false)}>{t("nav.game")}</Link>
              <Link href="/docs/" className="block px-3 py-2 text-sm hover:bg-slate-800" onClick={() => setNavOpen(false)}>{t("nav.docs")}</Link>
            </div>
          </div>
        </div>

        {/* Desktop centered nav */}
        <nav className="hidden items-center justify-self-center rounded-full bg-slate-800/50 px-2 py-1 text-sm sm:flex">
          <Link href="/" className="rounded-full px-3 py-1.5 hover:bg-slate-700/80">{t("nav.home")}</Link>
          <Link href="/lobby/" className="rounded-full px-3 py-1.5 hover:bg-slate-700/80">{t("nav.lobby")}</Link>
          <Link href="/game/" className="rounded-full px-3 py-1.5 hover:bg-slate-700/80">{t("nav.game")}</Link>
          <Link href="/docs/" className="rounded-full px-3 py-1.5 hover:bg-slate-700/80">{t("nav.docs")}</Link>
        </nav>

        <div className="relative flex items-center justify-self-end" ref={menuRef}>
          <div className="mr-2 flex items-center gap-1 sm:hidden">
            <select
              value={lang}
              onChange={(e) => {
                const next = e.target.value as Lang;
                setLangState(next);
                setLang(next);
              }}
              className="rounded-full border border-slate-700 bg-transparent px-2 py-1 text-[11px]"
              aria-label="language"
            >
              <option value="zh">中文</option>
              <option value="en">EN</option>
            </select>
            <button type="button" onClick={toggleTheme} className="rounded-full border border-slate-700 p-1.5" aria-label="toggle theme">
              {theme === "dark" ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 1 0 9.79 9.79z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
              )}
            </button>
          </div>

          <div className="mr-2 hidden items-center gap-2 sm:flex">
            <select
              value={lang}
              onChange={(e) => {
                const next = e.target.value as Lang;
                setLangState(next);
                setLang(next);
              }}
              className="rounded-full border border-slate-700 bg-transparent px-2 py-1 text-xs hover:bg-slate-700/80"
              aria-label="language"
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
            <button type="button" onClick={toggleTheme} className="rounded-full border border-slate-700 p-1.5 hover:bg-slate-700/80" aria-label="toggle theme">
              {theme === "dark" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 1 0 9.79 9.79z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
              )}
            </button>
          </div>
          {me?.id ? (
            <button type="button" className="rounded-full" onClick={() => setMenuOpen((v) => !v)} aria-label="user menu">
              <img src={me.avatarUrl || "https://placehold.co/40x40/1e293b/e2e8f0?text=?"} className="h-8 w-8 rounded-full border border-slate-700" alt="avatar" />
            </button>
          ) : (
            <Link href="/login/" className="rounded-full bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white">{t("nav.login")}</Link>
          )}

          <div className={`absolute top-full right-0 mt-2 w-44 origin-top-right overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl transition-all duration-200 ${me?.id && menuOpen ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"}`}>
            <Link href={`/u/?uid=${me?.id || ""}`} className="block px-3 py-2 text-sm hover:bg-slate-800" onClick={() => setMenuOpen(false)}>{t("nav.publicHome")}</Link>
            <Link href="/profile/" className="block px-3 py-2 text-sm hover:bg-slate-800" onClick={() => setMenuOpen(false)}>{t("nav.editProfile")}</Link>
            <Link href="/settings/" className="block px-3 py-2 text-sm hover:bg-slate-800" onClick={() => setMenuOpen(false)}>{t("nav.settings")}</Link>
            <a href="/api/auth/logout" className="block px-3 py-2 text-sm text-orange-300 hover:bg-slate-800" onClick={() => setMenuOpen(false)}>{t("nav.logout")}</a>
          </div>
        </div>
      </div>
    </header>
  );
}
