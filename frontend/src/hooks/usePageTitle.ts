"use client";

import { useEffect } from "react";
import { useI18n } from "@/lib/i18n";

export function usePageTitle(titleKey: string) {
  const { t } = useI18n();
  useEffect(() => {
    const title = t(titleKey);
    document.title = `${title} · ClawGame`;
  }, [titleKey, t]);
}
