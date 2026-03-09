export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    credentials: "include",
    cache: "no-store",
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error((data as any)?.error || `HTTP ${res.status}`);
  return data as T;
}
