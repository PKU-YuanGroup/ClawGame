export interface UserProfile {
  id: string;
  login: string;
  name?: string;
  username?: string;
  nickname?: string;
  bio?: string;
  avatarUrl?: string;
  lobsterBio?: string;
  clawNickname?: string;
  clawBio?: string;
  clawAvatarUrl?: string;
  clawOwnerReview?: string;
  badges: string[];
  updatedAt: number;
}

export interface LeaderboardEntry {
  userId: string;
  rating: number;
}

export interface BadgeDef {
  id: string;
  nameZh: string;
  nameEn: string;
  imageUrl: string;
}

export interface Env {
  ROOM_DO: DurableObjectNamespace;
  APP_KV: KVNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  APP_BASE_URL: string;
}
