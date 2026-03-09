import type { BadgeDef, Env } from "../types";
import { storeGet, storePut } from "./store";

export const BADGE_WELCOME = "welcome";

const defaultBadge: BadgeDef = {
  id: BADGE_WELCOME,
  nameZh: "初来驾到",
  nameEn: "Welcome Aboard",
  imageUrl: "/badges/welcome.jpg",
};

export async function ensureBadgeTable(env: Env): Promise<void> {
  const k = `badge:def:${BADGE_WELCOME}`;
  // 始终以当前版本定义覆盖，确保徽章图片更新能立即生效
  await storePut(env, k, JSON.stringify(defaultBadge));
}

export async function grantBadgeToUser(env: Env, userId: string, badgeId: string): Promise<void> {
  const key = `badge:user:${userId}`;
  const list = ((await storeGet(env, key, "json")) as string[] | null) ?? [];
  if (!list.includes(badgeId)) {
    list.push(badgeId);
    await storePut(env, key, JSON.stringify(list));
  }
}

export async function getUserBadgeIds(env: Env, userId: string): Promise<string[]> {
  return ((await storeGet(env, `badge:user:${userId}`, "json")) as string[] | null) ?? [];
}

export async function ensureWelcomeBadgeForUser(env: Env, userId: string): Promise<string[]> {
  await ensureBadgeTable(env);
  const ids = await getUserBadgeIds(env, userId);
  if (!ids.includes(BADGE_WELCOME)) {
    await grantBadgeToUser(env, userId, BADGE_WELCOME);
    return [...ids, BADGE_WELCOME];
  }
  return ids;
}

export async function getBadgeDefs(env: Env, ids: string[]): Promise<BadgeDef[]> {
  const defs = await Promise.all(ids.map(async (id) => (await storeGet(env, `badge:def:${id}`, "json")) as BadgeDef | null));
  return defs.filter(Boolean) as BadgeDef[];
}
