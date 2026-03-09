export interface SessionData {
  sessionId: string;
  userId: string;
  login: string;
  avatarUrl?: string;
  name?: string;
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const i = part.indexOf("=");
        if (i < 0) return [part, ""];
        return [part.slice(0, i), decodeURIComponent(part.slice(i + 1))];
      }),
  );
}

export function sessionCookie(sessionId: string): string {
  return `oc_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
}
