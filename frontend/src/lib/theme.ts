export type ThemeMode = "system" | "light" | "dark";
export type ThemeActual = "light" | "dark";

export const THEME_MODE_KEY = "theme_mode";

export function getThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const raw = localStorage.getItem(THEME_MODE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

export function resolveTheme(mode: ThemeMode): ThemeActual {
  if (mode === "light" || mode === "dark") return mode;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(mode: ThemeMode): ThemeActual {
  const actual = resolveTheme(mode);
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", actual);
    document.documentElement.style.colorScheme = actual;
  }
  return actual;
}

export function setThemeMode(mode: ThemeMode): ThemeActual {
  if (typeof window !== "undefined") localStorage.setItem(THEME_MODE_KEY, mode);
  return applyTheme(mode);
}
