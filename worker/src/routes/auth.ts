import { sessionCookie, type SessionData } from "../lib/auth";
import { json } from "../lib/http";
import type { Env, UserProfile } from "../types";
import { BADGE_WELCOME, ensureBadgeTable, grantBadgeToUser, getUserBadgeIds } from "../lib/badges";
import { storeDelete, storeGet, storePut } from "../lib/store";

const DEFAULT_STARTER_COINS = 5000;

export async function handleAuthRoutes(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname === "/api/auth/github/start") {
    const state = crypto.randomUUID();
    await storePut(env, `oauth-state:${state}`, "1", { expirationTtl: 600 });
    const redirect = new URL("https://github.com/login/oauth/authorize");
    redirect.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
    redirect.searchParams.set("scope", "read:user user:email");
    redirect.searchParams.set("state", state);
    return Response.redirect(redirect.toString(), 302);
  }

  if (url.pathname === "/api/auth/github/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return json({ error: "missing code/state" }, 400);
    const okState = await storeGet(env, `oauth-state:${state}`);
    if (!okState) return json({ error: "invalid state" }, 400);
    await storeDelete(env, `oauth-state:${state}`);

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        state,
      }),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenJson.access_token) return json({ error: tokenJson.error ?? "oauth failed" }, 400);

    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${tokenJson.access_token}`,
        accept: "application/vnd.github+json",
        "user-agent": "openclaw-battle-mvp",
      },
    });
    const ghUser = (await userRes.json()) as any;
    const ghId = ghUser?.id ? String(ghUser.id) : crypto.randomUUID();
    const ghLogin = ghUser?.login ? String(ghUser.login) : `gh_${ghId}`;
    const ghName = ghUser?.name ? String(ghUser.name) : ghLogin;
    const userId = `gh_${ghId}`;

    const profile: UserProfile = {
      id: userId,
      login: ghLogin,
      name: ghName,
      username: ghLogin,
      nickname: ghLogin,
      bio: "",
      avatarUrl: ghUser.avatar_url,
      lobsterBio: "",
      clawNickname: "Claw",
      clawBio: "",
      clawAvatarUrl: "",
      clawOwnerReview: "",
      coins: DEFAULT_STARTER_COINS,
      stats: { wins: 0, losses: 0, draws: 0, totalGames: 0 },
      badges: [],
      updatedAt: Date.now(),
    };

    await ensureBadgeTable(env);
    const existing = await storeGet(env, `user:${userId}`, "json");
    if (existing) {
      const ex = existing as UserProfile;
      profile.username = ex.username ?? profile.username;
      profile.lobsterBio = ex.lobsterBio ?? "";
      profile.nickname = ex.nickname ?? profile.nickname;
      profile.bio = ex.bio ?? "";
      profile.clawNickname = ex.clawNickname ?? "Claw";
      profile.clawBio = ex.clawBio ?? "";
      profile.clawAvatarUrl = ex.clawAvatarUrl ?? "";
      profile.clawOwnerReview = ex.clawOwnerReview ?? "";
      profile.coins = ex.coins ?? DEFAULT_STARTER_COINS;
      profile.stats = ex.stats ?? { wins: 0, losses: 0, draws: 0, totalGames: 0 };
      profile.badges = ex.badges ?? [];
    } else {
      await grantBadgeToUser(env, userId, BADGE_WELCOME);
    }
    profile.badges = await getUserBadgeIds(env, userId);
    await storePut(env, `user:${userId}`, JSON.stringify(profile));

    const sessionId = crypto.randomUUID();
    const session: SessionData = {
      sessionId,
      userId,
      login: profile.login,
      avatarUrl: profile.avatarUrl,
      name: profile.name,
    };
    await storePut(env, `session:${sessionId}`, JSON.stringify(session), { expirationTtl: 60 * 60 * 24 * 30 });

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${env.APP_BASE_URL || ""}/`,
        "Set-Cookie": sessionCookie(sessionId),
      },
    });
  }

  if (url.pathname === "/api/auth/logout") {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${env.APP_BASE_URL || ""}/`,
        "Set-Cookie": "oc_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      },
    });
  }

  return null;
}
