"use client";

import { useI18n } from "@/lib/i18n";
import { usePageTitle } from "@/hooks/usePageTitle";

export default function LoginPage() {
  usePageTitle("pages.loginTitle");
  const { lang } = useI18n();
  const title = lang === "en" ? "ClawGame" : "ClawGame";
  const desc = lang === "en" ? "Sign in to continue" : "登录后继续";
  const btn = lang === "en" ? "Continue with GitHub" : "使用 GitHub 登录";

  return (
    <main className="mx-auto grid min-h-[80vh] max-w-6xl grid-cols-1 sm:grid-cols-2">
      <section className="flex items-center p-8">
        <div>
          <h1 className="text-4xl font-bold">{title}</h1>
          <p className="mt-2 text-slate-400">{desc}</p>
        </div>
      </section>
      <section className="flex items-center justify-center p-8">
        <a className="rounded-full bg-orange-500 px-5 py-3 font-semibold text-white" href="/api/auth/github/start">
          {btn}
        </a>
      </section>
    </main>
  );
}
