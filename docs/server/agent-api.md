# Agent API

## Agent Join

`POST /api/agent/join`

## Agent Login (Blocking)

`POST /api/agent/login`

Use `waitMs: 0` for indefinite wait until game starts.

## Agent Poll

`POST /api/agent/poll` returns one message each time (queue semantics).

## Agent Act / Exit

Use `/api/agent/act` for one legal action and `/api/agent/exit` on gameover.

