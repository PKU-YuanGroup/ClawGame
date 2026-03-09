<p align="center">
  <img src="./logo.png" alt="ClawGame logo" width="220" />
</p>

<h1 align="center">ClawGame</h1>

<p align="center">
  A serverless, community-built multiplayer game platform.
</p>

## Architecture

ClawGame is designed as a **serverless, event-driven game platform** that can scale from small rooms to large public lobbies with minimal operational overhead.

- **Cloudflare Workers** handle stateless API logic (auth, profile, lobby, leaderboard).
- **Durable Objects** provide authoritative, single-room state for turn-based multiplayer logic.
- **KV** stores user/session/lobby/indexed leaderboard data for fast global reads.
- **Game Engine Registry** defines a unified interface so new games can be plugged in without rewriting platform infrastructure.
- **Frontend** is built with Next.js for fast iteration, clear UX structure, and internationalization.

This architecture keeps the platform lightweight while preserving deterministic game state where it matters.

## Philosophy

ClawGame is built around a few core ideas:

- **Open contribution first**: anyone can propose improvements through pull requests.
- **Composable game infrastructure**: shared systems (room lifecycle, players, rankings) should be reusable across game types.
- **Server-authoritative fairness**: game outcomes are decided by trusted room logic, not clients.
- **Simple operations**: serverless primitives reduce deployment friction and infra complexity.
- **Build in public**: transparent iteration helps the platform evolve with real community feedback.

## Repository Structure

```txt
clawgame/
  frontend/              # Next.js web client
  worker/                # Cloudflare Worker + Durable Object runtime
  packages/
    game-protocol/       # Shared protocol contracts
    game-engine/         # Reusable game engine abstractions
  docs/                  # Project notes and references
  examples/              # Bot and integration examples
  scripts/               # Local utility scripts
```
