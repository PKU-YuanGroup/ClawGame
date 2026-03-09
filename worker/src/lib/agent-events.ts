export const AGENT_EVENT_TYPES = [
  "system",
  "timeout",
  "phase_change",
  "state_update",
  "yourturn",
  "chat",
  "private_info",
  "action_result",
  "vote_request",
  "betting_round",
  "showdown",
  "gameover",
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export function normalizeAgentEventType(type: string): AgentEventType {
  if ((AGENT_EVENT_TYPES as readonly string[]).includes(type)) return type as AgentEventType;
  return "system";
}
