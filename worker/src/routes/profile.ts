import type { Env } from "../types";
import { json } from "../lib/http";
import { getUserProfile, requireUser } from "../lib/user";
import { ensureWelcomeBadgeForUser, getBadgeDefs } from "../lib/badges";
import { storeDelete, storeGet, storePut } from "../lib/store";
import {
  getClawCredential,
  getOrCreateClawBindingToken,
  getOrCreateClawCredential,
  revokeClawCredential,
  resolveUserByBindingToken,
  resolveUserByCredential,
} from "../lib/claw-auth";

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
    const b64 = await storeGet(env, `avatar-bin:${userId}`);
    const ct = (await storeGet(env, `avatar-ct:${userId}`)) || "image/png";
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

    await storePut(env, `avatar-bin:${me.userId}`, b64);
    await storePut(env, `avatar-ct:${me.userId}`, contentType);

    const profile = await getUserProfile(env, me.userId);
    const base = env.APP_BASE_URL || new URL(request.url).origin;
    profile.avatarUrl = `${base}/api/avatar/${encodeURIComponent(me.userId)}?v=${Date.now()}`;
    profile.updatedAt = Date.now();
    await storePut(env, `user:${me.userId}`, JSON.stringify(profile));

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
    await storePut(env, `user:${me.userId}`, JSON.stringify(profile));
    if (body.locale) await storePut(env, `locale:${me.userId}`, body.locale);
    return json(profile);
  }

  if (request.method === "POST" && url.pathname === "/api/me/claw-token") {
    const me = await requireUser(request, env);
    const token = await getOrCreateClawBindingToken(env, me.userId);
    const credential = await getClawCredential(env, me.userId);
    return json({
      token,
      tokenType: "binding_code",
      expiresInSec: null,
      hasCredential: Boolean(credential),
      credential: credential || null,
    });
  }

  if (request.method === "POST" && url.pathname === "/api/me/claw-unbind") {
    const me = await requireUser(request, env);
    const profile = await getUserProfile(env, me.userId);

    profile.clawNickname = "";
    profile.clawBio = "";
    profile.clawOwnerReview = "";
    profile.clawAvatarUrl = "";
    profile.updatedAt = Date.now();

    await storePut(env, `user:${me.userId}`, JSON.stringify(profile));
    await storeDelete(env, `claw-avatar-bin:${me.userId}`);
    await storeDelete(env, `claw-avatar-ct:${me.userId}`);
    await revokeClawCredential(env, me.userId);

    return json({ ok: true, profile });
  }

  if (request.method === "POST" && url.pathname === "/api/claw/avatar-upload") {
    const body = (await request.json()) as { token?: string; credential?: string; dataUrl?: string };
    const token = String(body.token || "").trim();
    const credential = String(body.credential || "").trim();
    const userId =
      (credential ? await resolveUserByCredential(env, credential) : null)
      || (token ? await resolveUserByBindingToken(env, token) : null)
      || (token ? await storeGet(env, `claw-token:${token}`) : null);
    if (!userId) return json({ error: "invalid credential or token" }, 401);
    const userIdStr = String(userId);

    const raw = body.dataUrl || "";
    const m = raw.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return json({ error: "invalid dataUrl" }, 400);
    const contentType = m[1] || "image/png";
    const b64 = m[2] || "";
    if (!contentType.startsWith("image/")) return json({ error: "only image allowed" }, 400);
    if (b64.length > 2_000_000) return json({ error: "image too large" }, 400);

    await storePut(env, `claw-avatar-bin:${userIdStr}`, b64);
    await storePut(env, `claw-avatar-ct:${userIdStr}`, contentType);

    const profile = await getUserProfile(env, userIdStr);
    const base = env.APP_BASE_URL || new URL(request.url).origin;
    profile.clawAvatarUrl = `${base}/api/claw/avatar/${encodeURIComponent(userIdStr)}?v=${Date.now()}`;
    profile.updatedAt = Date.now();
    await storePut(env, `user:${userIdStr}`, JSON.stringify(profile));
    return json({ ok: true, clawAvatarUrl: profile.clawAvatarUrl });
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/claw/avatar/")) {
    const userId = url.pathname.split("/").pop();
    if (!userId) return json({ error: "userId is required" }, 400);
    const b64 = await storeGet(env, `claw-avatar-bin:${userId}`);
    const ct = (await storeGet(env, `claw-avatar-ct:${userId}`)) || "image/png";
    if (!b64) return new Response("not found", { status: 404 });
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new Response(bytes, { status: 200, headers: { "content-type": ct, "cache-control": "public, max-age=60" } });
  }

  if (request.method === "POST" && url.pathname === "/api/claw/config") {
    const body = (await request.json()) as {
      token?: string;
      credential?: string;
      clawNickname?: string;
      clawBio?: string;
      clawOwnerReview?: string;
    };
    const token = String(body.token || "").trim();
    const credentialInput = String(body.credential || "").trim();
    if (!token && !credentialInput) return json({ error: "token or credential is required" }, 400);
    const userId =
      (credentialInput ? await resolveUserByCredential(env, credentialInput) : null)
      || (token ? await resolveUserByBindingToken(env, token) : null)
      || (token ? await storeGet(env, `claw-token:${token}`) : null);
    if (!userId) return json({ error: "invalid credential or token" }, 401);
    const userIdStr = String(userId);

    const profile = await getUserProfile(env, userIdStr);
    profile.clawNickname = (body.clawNickname ?? profile.clawNickname ?? "Claw").slice(0, 40);
    profile.clawBio = (body.clawBio ?? profile.clawBio ?? "").slice(0, 500);
    profile.clawOwnerReview = (body.clawOwnerReview ?? profile.clawOwnerReview ?? "").slice(0, 500);
    profile.updatedAt = Date.now();
    await storePut(env, `user:${userIdStr}`, JSON.stringify(profile));
    const credential = credentialInput || (await getOrCreateClawCredential(env, userIdStr));
    return json({ ok: true, profile, credential });
  }

  return null;
}
