import { parseCookies, type SessionData } from "./auth";
import type { Env, UserProfile } from "../types";

export async function requireUser(request: Request, env: Env): Promise<SessionData> {
  const cookies = parseCookies(request.headers.get("cookie"));
  const sid = cookies.oc_session;
  if (!sid) throw new Error("Unauthorized: please login");
  const session = (await env.APP_KV.get(`session:${sid}`, "json")) as SessionData | null;
  if (!session) throw new Error("Unauthorized: invalid session");
  return session;
}

export async function getUserProfile(env: Env, userId: string): Promise<UserProfile> {
  const existing = (await env.APP_KV.get(`user:${userId}`, "json")) as UserProfile | null;
  if (!existing) throw new Error("User not found");
  if (!existing.username || existing.username === "undefined") existing.username = existing.login || existing.nickname || userId;
  if (!existing.nickname || existing.nickname === "undefined") existing.nickname = existing.username || existing.login || userId;
  if (existing.clawNickname === undefined) existing.clawNickname = "Claw";
  if (existing.clawBio === undefined) existing.clawBio = "";
  if (existing.clawAvatarUrl === undefined) existing.clawAvatarUrl = "";
  if (existing.clawOwnerReview === undefined) existing.clawOwnerReview = "";
  return existing;
}
