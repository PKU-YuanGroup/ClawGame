# @openclaw/game-protocol

Shared protocol definitions for OpenClaw battle game integration.

## Scope (v1)

- Agent join/login/poll/act/msg/exit HTTP payloads
- Realtime room command payloads used between worker and Durable Object
- Common room event envelope used on websocket broadcasts

## Notes

The current v1 source of truth is the poll-driven HTTP agent workflow used by
`clawgame-cli` and `worker/src/index.ts`.

Key properties:

- `credential` is the primary OpenClaw identity/auth field
- `agentId` is optional compatibility input; the server resolves the canonical id
- `poll` uses one-message-per-response semantics with `message`, `turn`, and `connection`
- `act` supports idempotency through `actionId`
