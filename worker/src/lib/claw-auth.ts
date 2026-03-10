import type { Env } from "../types";
import { storeGet, storePut } from "./store";

const BINDING_TOKEN_KEY_PREFIX = "claw-bind-token:";
const USER_BINDING_TOKEN_KEY_PREFIX = "user-claw-bind-token:";
const CREDENTIAL_KEY_PREFIX = "claw-credential:";
const USER_CREDENTIAL_KEY_PREFIX = "user-claw-credential:";

const BINDING_TOKEN_LENGTH = 8;
const CREDENTIAL_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CREDENTIAL_LENGTH = 24;

function randomDigits(length: number): string {
  let value = "";
  for (let i = 0; i < length; i += 1) {
    value += String(Math.floor(Math.random() * 10));
  }
  return value;
}

function randomCredential(length: number): string {
  let value = "";
  for (let i = 0; i < length; i += 1) {
    const idx = Math.floor(Math.random() * CREDENTIAL_CHARS.length);
    value += CREDENTIAL_CHARS[idx];
  }
  return value;
}

export async function getOrCreateClawBindingToken(env: Env, userId: string): Promise<string> {
  const existing = await storeGet(env, `${USER_BINDING_TOKEN_KEY_PREFIX}${userId}`);
  if (existing) return String(existing);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const token = randomDigits(BINDING_TOKEN_LENGTH);
    const boundUser = await storeGet(env, `${BINDING_TOKEN_KEY_PREFIX}${token}`);
    if (boundUser) continue;
    await storePut(env, `${BINDING_TOKEN_KEY_PREFIX}${token}`, userId);
    await storePut(env, `${USER_BINDING_TOKEN_KEY_PREFIX}${userId}`, token);
    return token;
  }
  throw new Error("failed to allocate claw binding token");
}

export async function resolveUserByBindingToken(env: Env, token: string): Promise<string | null> {
  if (!/^\d{8}$/.test(token)) return null;
  const userId = await storeGet(env, `${BINDING_TOKEN_KEY_PREFIX}${token}`);
  return userId ? String(userId) : null;
}

export async function getOrCreateClawCredential(env: Env, userId: string): Promise<string> {
  const existing = await storeGet(env, `${USER_CREDENTIAL_KEY_PREFIX}${userId}`);
  if (existing) return String(existing);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const credential = randomCredential(CREDENTIAL_LENGTH);
    const boundUser = await storeGet(env, `${CREDENTIAL_KEY_PREFIX}${credential}`);
    if (boundUser) continue;
    await storePut(env, `${CREDENTIAL_KEY_PREFIX}${credential}`, userId);
    await storePut(env, `${USER_CREDENTIAL_KEY_PREFIX}${userId}`, credential);
    return credential;
  }
  throw new Error("failed to allocate claw credential");
}

export async function getClawCredential(env: Env, userId: string): Promise<string | null> {
  const credential = await storeGet(env, `${USER_CREDENTIAL_KEY_PREFIX}${userId}`);
  return credential ? String(credential) : null;
}

export async function resolveUserByCredential(env: Env, credential: string): Promise<string | null> {
  if (!credential) return null;
  const userId = await storeGet(env, `${CREDENTIAL_KEY_PREFIX}${credential}`);
  return userId ? String(userId) : null;
}
