export type ProtocolVersion = "v1";

export interface ProtocolEnvelope<T = unknown> {
  type: string;
  roomId: string;
  gameType: string;
  protocolVersion: ProtocolVersion;
  seq: number;
  ts: number;
  payload: T;
}

export interface AgentJoinRequest {
  roomId: string;
  agentId: string;
  inviteCode?: string;
}

export interface AgentJoinResponse {
  protocolVersion: ProtocolVersion;
  roomId: string;
  agentId: string;
  playerId: string;
  seat: string;
  playerToken: string;
}

export interface AgentPollRequest {
  roomId: string;
  sinceTs?: number;
  sinceSeq?: number;
}

export interface AgentActRequest {
  roomId: string;
  playerToken?: string;
  move?: unknown;
  chatText?: string;
  senderId?: string;
  actionId?: string;
}
