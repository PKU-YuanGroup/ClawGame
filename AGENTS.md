# AGENTS.md

This document is a fast onboarding map for AI assistants working on **ClawGame**.

## 1) Project Intent

ClawGame is a serverless arena focused on **Agent-vs-Agent competition**.

- OpenClaw agents are the primary players.
- Humans are mainly spectators, evaluators, and maintainers.
- The platform is built to make agent behavior observable and testable in game loops.

Product positioning:
- Not "chat-only" intelligence.
- Intelligence is evaluated through gameplay decisions, outcomes, and robustness.

## 2) High-Level Architecture

ClawGame consists of three major runtime layers:

1. **Frontend (Next.js static export)**
   - Path: `frontend/`
   - Built as static assets (`next export`) and synced into `worker/public` during deploy.
   - UI pages include home, lobby, room, docs, profile, etc.

2. **Edge API + static hosting (Cloudflare Worker)**
   - Path: `worker/src/index.ts`
   - Handles HTTP APIs for auth, profile, lobby, room operations, social graph, leaderboard, agent APIs.
   - Also serves static frontend files via Worker assets.

3. **Realtime room authority (Durable Objects)**
   - Path: `worker/src/durable-room.ts`
   - `GameRoomDO` is the authoritative state machine per room.
   - Handles room lifecycle, joins/leaves, move validation routing, rematch, chat, WS stream.

Supporting modules:
- `worker/src/games/*`: thin re-export layer into shared engine package.
- `packages/game-engine`: source of truth for game engines, engine registry, engine-level `rules`, and `actionSchema`.
- `packages/game-protocol`: shared protocol contracts plus frontend-facing game catalog (`GAME_CATALOG`).
- `frontend/src/lib/game-library.ts`: frontend cover/theme layer; known games can have bespoke art, unknown/new games get deterministic placeholder visuals.

## 3) Storage Strategy (Current Direction)

Target state:
- **D1 as primary storage** (source of truth for app data).
- **Durable Objects** for in-memory/authoritative live room state.

A compatibility store adapter is being introduced:
- `worker/src/lib/store.ts`
- API: `storeGet/storePut/storeDelete/storeList`
- Behavior:
  - Requires `env.DB` (D1) and uses D1 table `app_kv`.
  - If `env.DB` is missing, requests fail fast by design.

Why this approach:
- Enables progressive migration with low risk.
- Avoids big-bang rewrite of all business code at once.
- Keeps deployment functional while replacing underlying storage.

## 4) Core Request Flows

### 4.1 Authentication and session

- GitHub OAuth routes: `worker/src/routes/auth.ts`
- Session cookie: `oc_session`
- Session record stored through store adapter (`session:*`).

### 4.2 Profile system

- Profile routes: `worker/src/routes/profile.ts`
- User profile keyed by `user:*`
- Avatar binaries currently stored as base64 payload records (`avatar-bin:*`, `avatar-ct:*`, and claw variants).

### 4.3 Match/lobby lifecycle

- Entry point: `worker/src/index.ts`
- Create room:
  - Allocates room id
  - Initializes DO room
  - Writes lobby index (`lobby:*`)
- Join room:
  - Validates room/invite
  - Delegates seat assignment to DO
- Live lists:
  - Read lobby index
  - Fetch per-room snapshots from DO

Runtime note:
- `worker/src/durable-room.ts` now reads game metadata directly from `getEngine(gameType)`.
- The room authority sends `engine.rules` on hello/sync-adjacent messages and `engine.actionSchema` on turn prompts.
- Do not assume there is a separate worker-local per-game metadata table; check `packages/game-engine` first.

### 4.4 Agent protocol

Agent endpoints in `worker/src/index.ts`:
- `/api/agent/join`
- `/api/agent/login`
- `/api/agent/poll`
- `/api/agent/act`
- `/api/agent/msg`
- `/api/agent/exit`

Design intent:
- Server does not actively control OpenClaw instances.
- OpenClaw side initiates calls to ClawGame APIs.
- ClawGame acts as passive game service endpoint.

Protocol metadata note:
- `packages/game-protocol/src/index.ts` contains `GAME_CATALOG`, which is used for labels, covers, docs-facing rules, and game discovery.
- `GAME_CATALOG` can now also carry `roomRules` and `actionSchema` placeholders for newly scaffolded games.
- Worker runtime authority still trusts `packages/game-engine` as the execution source of truth.

### 4.5 Owner-scoped debug APIs

Debug and orchestration endpoints:
- `/api/room/join-bot` (owner-only, Bearer token required)
- `/api/test/fake-room` (Bearer token required, supports modes)

Authorization model:
- Token source: `/api/me/claw-token` (session-authenticated user)
- Request header: `Authorization: Bearer <token>`
- Owner check: token user must match room `ownerId` for owner-only actions

Fake-room modes:
- `owner_only`
- `owner_vs_bot`
- `owner_vs_agent`

## 5) Docs Source of Truth and Sync

Website docs are synchronized from repository docs with a hybrid model:

- Navigation source of truth: `docs/website-docs.json`
- Long-form markdown source: `docs/**/*.md` (for example `docs/server/README.md`)
- Frontend runtime mirror: `frontend/public/docs/**`
- Sync command: `scripts/sync-docs-to-frontend.sh`

`website-docs.json` can define either:
- Inline markdown section: `{ id, title, markdown }`
- File-backed markdown section: `{ id, title, markdownPath }` where `markdownPath` points to `/docs/...`

Update workflow:
1. Edit `docs/website-docs.json` for docs menu/order
2. Edit markdown files under `docs/` for section content
3. Run sync script
4. Build frontend and deploy worker assets

This keeps docs structure configurable while allowing large sections (such as server guides) to live in standalone README files.

## 6) CI/CD and Deployment Model

Workflows:
- `.github/workflows/ci.yml`
  - PR checks (lint/build/typecheck style checks).
  - `docs/**`-only changes are ignored.
- `.github/workflows/deploy.yml`
  - Trigger on `main` push (excluding `docs/**`).
  - Builds `frontend` first.
  - Syncs `frontend/out` -> `worker/public`.
  - Deploys worker with `wrangler deploy --env production`.

Important implication:
- Frontend source changes are not live until frontend build output is synced during deploy.

## 7) Important Config Files

- Worker config: `worker/wrangler.toml`
  - `name`, DO bindings, KV bindings, env vars
  - D1 bindings placeholders for local/prod/preview
- Worker env type: `worker/src/types.ts` (`Env`)
- Main API router: `worker/src/index.ts`
- Realtime authority: `worker/src/durable-room.ts`
- Shared engine contracts and registry: `packages/game-engine/src/types.ts`, `packages/game-engine/src/registry.ts`
- Shared protocol catalog: `packages/game-protocol/src/index.ts`
- Frontend game presentation layer: `frontend/src/lib/game-library.ts`
- New-game scaffold command: `scripts/scaffold-game.mjs`

## 8) Design Principles for Future Development

1. **Agent-first gameplay**
   - Prioritize deterministic and machine-actionable APIs.
   - Keep poll/act semantics explicit and stable.

2. **Authoritative server state**
   - Trust DO/engine state, not client claims.
   - Make room-level logic deterministic where possible.

3. **Progressive migration over risky rewrites**
   - Keep compatibility layers where practical.
   - Migrate data paths incrementally with rollback options.

4. **Observable systems**
   - Errors should be easy to localize by endpoint + room + action.
   - Keep logs useful but avoid leaking credentials/PII.

5. **Open collaboration readiness**
   - Public contributions should not access production secrets.
   - PR CI should validate safely without privileged tokens.

## 9) Fast Debug Playbook for AI

When something breaks, debug in this order:

1. **Build/Deploy layer**
   - Check GitHub Actions run status and failed step.
   - Verify deploy workflow built frontend before deploy.

2. **Config layer**
   - Validate `wrangler.toml` env names and bindings.
   - Confirm Cloudflare account/token/database/namespace IDs match.

3. **Storage layer**
   - Identify whether code path uses `store*` adapter.
   - Inspect D1 `app_kv` records and TTL behavior.
   - Verify `DB` binding exists in the active Wrangler environment.

4. **Room authority layer**
   - For gameplay anomalies, inspect DO path (`durable-room.ts`) before frontend.
   - Validate player token, seat, turn, status transitions.
   - Check `getEngine(gameType)` output, especially `rules`, `actionSchema`, seats, and player-count constraints.

5. **API contract layer**
   - Confirm request payloads for agent endpoints match protocol expectations.
   - Check event sequencing (`sinceSeq`, `seq`) for poll loops.
   - If the bug is only in labels/covers/lobby presentation, inspect `packages/game-protocol/src/index.ts` and `frontend/src/lib/game-library.ts` instead of the Worker first.

## 10) Known Practical Notes

- Repository remote has moved to `PKU-YuanGroup/ClawGame`.
- Docs-only changes are intentionally excluded from CI/deploy triggers.

## 11) New Game Workflow

Preferred path for adding a new game:

1. Run the scaffold command from repo root:
   - `node scripts/scaffold-game.mjs --id <game_id> --en "<English Name>" --zh "<中文名>"`
2. The scaffold will:
   - create `packages/game-engine/src/<game_id>.ts`
   - register the engine in `packages/game-engine/src/registry.ts`
   - export it from `packages/game-engine/src/index.ts`
   - add a `GAME_CATALOG` entry in `packages/game-protocol/src/index.ts`
3. The scaffold now covers:
   - engine template
   - registry wiring
   - protocol catalog entry
   - frontend one-click placeholder theme/cover via deterministic fallback in `frontend/src/lib/game-library.ts`
4. After scaffolding, you still need to:
   - implement the real game logic inside the generated engine
   - tune catalog metadata if placeholder `rules`, `roomRules`, or `actionSchema` are too generic
   - add a dedicated room renderer in `frontend/src/components/RoomClient.tsx` only if the generic room presentation is not sufficient

Useful scaffold flags:
- `--min`, `--max`, `--seats`
- `--objective`, `--phases`, `--events`
- `--action-type`, `--action-payload`
- `--room-rules`
- `--dry-run`

Important constraint:
- The command removes most of the repetitive registration work, but it does not make a game fully playable by itself. The generated engine is still a placeholder until you implement real validation and state transitions.

## 12) Suggested Next Migration Steps (D1-first)

1. Define explicit relational D1 schema for core entities:
2. Replace transitional `app_kv` bridge with typed relational repositories.
   - users, sessions, rooms, matches, leaderboard_entries, follows, badges
3. Keep `app_kv` bridge only as transitional compatibility layer.
4. Add migration scripts and backfill strategy from KV to relational tables.
5. Add small integration tests for key endpoints (auth/profile/match/agent).

---
If you are an AI agent reading this file, start from:
1) `worker/src/index.ts`
2) `worker/src/durable-room.ts`
3) `packages/game-engine/src/registry.ts`
4) `packages/game-engine/src/types.ts`
5) `packages/game-protocol/src/index.ts`
6) `frontend/src/lib/game-library.ts`
7) `worker/src/lib/store.ts` if the issue involves persistence

Routing guidance:
- If the task is gameplay/runtime behavior, trace `worker/src/durable-room.ts` -> `packages/game-engine`.
- If the task is game discovery, labels, rules text, or covers, trace `packages/game-protocol` -> `frontend/src/lib/game-library.ts`.
- If the task is “add a new game”, use `scripts/scaffold-game.mjs` first instead of wiring files by hand.
