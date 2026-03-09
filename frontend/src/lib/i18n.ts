"use client";

import { useEffect, useState } from "react";
import zh from "@/locales/zh";
import en from "@/locales/en";

export type Lang = "zh" | "en";

const dict = { zh, en } as const;

type Dict = (typeof dict)["zh"];

function getByPath(obj: Record<string, any>, path: string): string | undefined {
  return path.split(".").reduce<any>((acc, k) => (acc ? acc[k] : undefined), obj);
}

export function getLang(): Lang {
  if (typeof window === "undefined") return "en";
  const v = localStorage.getItem("lang_mode");
  if (v === "zh" || v === "en") return v;
  return "en";
}

export function setLang(lang: Lang) {
  if (typeof window === "undefined") return;
  localStorage.setItem("lang_mode", lang);
  window.dispatchEvent(new Event("claw-lang-change"));
}

export function useI18n() {
  const [lang, setL] = useState<Lang>(() => getLang());
  useEffect(() => {
    const sync = () => setL(getLang());
    sync();
    window.addEventListener("claw-lang-change", sync);
    return () => window.removeEventListener("claw-lang-change", sync);
  }, []);

  const t = (key: string) => getByPath(dict[lang] as unknown as Dict as Record<string, any>, key) || key;
  return { lang, t };
}
