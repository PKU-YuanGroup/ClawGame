import type { Env } from "../types";
import { json } from "../lib/http";
import { getUserProfile, requireUser } from "../lib/user";
import { ensureWelcomeBadgeForUser, getBadgeDefs } from "../lib/badges";

export async function handleProfileRoutes(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname === "/api/me") {
    const me = await requireUser(request, env);
    const profile = await getUserProfile(env, me.userId);
    const badgeIds = await ensureWelcomeBadgeForUser(env, me.userId);
    const badgeDetails = await getBadgeDefs(env, badgeIds);
    profile.badges = badgeIds;
    return json({ ...profile, badgeDetails });
  }

  if (url.pathname === "/api/profile") {
    const userId = url.searchParams.get("userId");
    if (!userId) return json({ error: "userId is required" }, 400);
    const profile = await getUserProfile(env, userId);
    const badgeIds = await ensureWelcomeBadgeForUser(env, userId);
    const badgeDetails = await getBadgeDefs(env, badgeIds);
    profile.badges = badgeIds;
    return json({ ...profile, badgeDetails });
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/avatar/")) {
    const userId = url.pathname.split("/").pop();
    if (!userId) return json({ error: "userId is required" }, 400);
    const b64 = await env.APP_KV.get(`avatar-bin:${userId}`);
    const ct = (await env.APP_KV.get(`avatar-ct:${userId}`)) || "image/png";
    if (!b64) return new Response("not found", { status: 404 });
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": ct,
        "cache-control": "public, max-age=60",
      },
    });
  }

  if (request.method === "POST" && url.pathname === "/api/me/avatar-upload") {
    const me = await requireUser(request, env);
    const body = (await request.json()) as { dataUrl?: string };
    const raw = body.dataUrl || "";
    const m = raw.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return json({ error: "invalid dataUrl" }, 400);
    const contentType = m[1] || "image/png";
    const b64 = m[2] || "";
    if (!contentType.startsWith("image/")) return json({ error: "only image allowed" }, 400);
    if (b64.length > 2_000_000) return json({ error: "image too large" }, 400);

    await env.APP_KV.put(`avatar-bin:${me.userId}`, b64);
    await env.APP_KV.put(`avatar-ct:${me.userId}`, contentType);

    const profile = await getUserProfile(env, me.userId);
    const base = env.APP_BASE_URL || new URL(request.url).origin;
    profile.avatarUrl = `${base}/api/avatar/${encodeURIComponent(me.userId)}?v=${Date.now()}`;
    profile.updatedAt = Date.now();
    await env.APP_KV.put(`user:${me.userId}`, JSON.stringify(profile));

    return json({ ok: true, avatarUrl: profile.avatarUrl });
  }

  if (request.method === "POST" && url.pathname === "/api/me/profile") {
    const me = await requireUser(request, env);
    const body = (await request.json()) as {
      lobsterBio?: string;
      bio?: string;
      nickname?: string;
      avatarUrl?: string;
      locale?: string;
    };
    const profile = await getUserProfile(env, me.userId);
    profile.lobsterBio = (body.lobsterBio ?? profile.lobsterBio ?? "").slice(0, 500);
    profile.bio = (body.bio ?? profile.bio ?? "").slice(0, 200);
    profile.nickname = (body.nickname ?? profile.nickname ?? profile.login).slice(0, 40);
    profile.avatarUrl = (body.avatarUrl ?? profile.avatarUrl ?? "").slice(0, 200000);
    profile.updatedAt = Date.now();
    await env.APP_KV.put(`user:${me.userId}`, JSON.stringify(profile));
    if (body.locale) await env.APP_KV.put(`locale:${me.userId}`, body.locale);
    return json(profile);
  }

  if (request.method === "POST" && url.pathname === "/api/me/claw-token") {
    const me = await requireUser(request, env);
    const token = crypto.randomUUID();
    await env.APP_KV.put(`claw-token:${token}`, me.userId, { expirationTtl: 60 * 10 });
    return json({ token, expiresInSec: 600 });
  }

  if (request.method === "POST" && url.pathname === "/api/claw/avatar-upload") {
    const body = (await request.json()) as { token?: string; dataUrl?: string };
    const token = body.token || "";
    if (!token) return json({ error: "token is required" }, 400);
    const userId = await env.APP_KV.get(`claw-token:${token}`);
    if (!userId) return json({ error: "invalid or expired token" }, 401);

    const raw = body.dataUrl || "";
    const m = raw.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return json({ error: "invalid dataUrl" }, 400);
    const contentType = m[1] || "image/png";
    const b64 = m[2] || "";
    if (!contentType.startsWith("image/")) return json({ error: "only image allowed" }, 400);
    if (b64.length > 2_000_000) return json({ error: "image too large" }, 400);

    await env.APP_KV.put(`claw-avatar-bin:${userId}`, b64);
    await env.APP_KV.put(`claw-avatar-ct:${userId}`, contentType);

    const profile = await getUserProfile(env, userId);
    const base = env.APP_BASE_URL || new URL(request.url).origin;
    profile.clawAvatarUrl = `${base}/api/claw/avatar/${encodeURIComponent(userId)}?v=${Date.now()}`;
    profile.updatedAt = Date.now();
    await env.APP_KV.put(`user:${userId}`, JSON.stringify(profile));
    return json({ ok: true, clawAvatarUrl: profile.clawAvatarUrl });
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/claw/avatar/")) {
    const userId = url.pathname.split("/").pop();
    if (!userId) return json({ error: "userId is required" }, 400);
    const b64 = await env.APP_KV.get(`claw-avatar-bin:${userId}`);
    const ct = (await env.APP_KV.get(`claw-avatar-ct:${userId}`)) || "image/png";
    if (!b64) return new Response("not found", { status: 404 });
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new Response(bytes, { status: 200, headers: { "content-type": ct, "cache-control": "public, max-age=60" } });
  }

  if (request.method === "POST" && url.pathname === "/api/claw/config") {
    const body = (await request.json()) as { token?: string; clawNickname?: string; clawBio?: string; clawOwnerReview?: string };
    const token = body.token || "";
    if (!token) return json({ error: "token is required" }, 400);
    const userId = await env.APP_KV.get(`claw-token:${token}`);
    if (!userId) return json({ error: "invalid or expired token" }, 401);

    const profile = await getUserProfile(env, userId);
    profile.clawNickname = (body.clawNickname ?? profile.clawNickname ?? "Claw").slice(0, 40);
    profile.clawBio = (body.clawBio ?? profile.clawBio ?? "").slice(0, 500);
    profile.clawOwnerReview = (body.clawOwnerReview ?? profile.clawOwnerReview ?? "").slice(0, 500);
    profile.updatedAt = Date.now();
    await env.APP_KV.put(`user:${userId}`, JSON.stringify(profile));
    return json({ ok: true, profile });
  }

  return null;
}
