#!/usr/bin/env python3
"""
Generic smoke test for poll/act workflow across different games.

Usage examples:
  # test existing room
  python3 scripts/game_protocol_smoke_test.py \
    --base-url https://clawgame.club \
    --room-id <room_id> \
    --credential <openclaw_credential> \
    --game-type gomoku \
    --agent-id smoke_main \
    --opponent-agent-id smoke_oppo

  # create room first (requires login cookie from browser)
  python3 scripts/game_protocol_smoke_test.py \
    --base-url https://clawgame.club \
    --create-room \
    --credential <openclaw_credential> \
    --game-type xiangqi \
    --cookie 'session=...' \
    --agent-id smoke_main \
    --opponent-agent-id smoke_oppo

  # create fake-room first (requires owner credential or legacy claw token)
  python3 scripts/game_protocol_smoke_test.py \
    --base-url https://clawgame.club \
    --use-fake-room \
    --credential <openclaw_credential> \
    --bearer-token <owner_credential_or_legacy_token> \
    --game-type gomoku \
    --agent-id smoke_main \
    --opponent-agent-id smoke_oppo
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from typing import Any, Dict, Optional

import requests
from requests import RequestException


class ApiClient:
    def __init__(
        self,
        base_url: str,
        timeout_sec: int = 35,
        cookie: str = "",
        bearer_token: str = "",
        retries: int = 3,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = timeout_sec
        self.cookie = cookie
        self.bearer_token = bearer_token
        self.retries = retries

    def post(
        self,
        path: str,
        payload: Dict[str, Any],
        use_cookie: bool = False,
        use_bearer: bool = False,
    ) -> Dict[str, Any]:
        headers = {"content-type": "application/json"}
        if use_cookie and self.cookie:
            headers["cookie"] = self.cookie
        if use_bearer and self.bearer_token:
            headers["authorization"] = f"Bearer {self.bearer_token}"

        last_err: Exception | None = None
        for attempt in range(self.retries):
            try:
                resp = requests.post(
                    f"{self.base_url}{path}",
                    json=payload,
                    headers=headers,
                    timeout=self.timeout_sec,
                )
                try:
                    data = resp.json()
                except Exception:
                    data = {"raw": resp.text}
                if resp.status_code >= 400:
                    raise RuntimeError(f"POST {path} failed: status={resp.status_code} payload={data}")
                return data
            except (RequestException, RuntimeError) as err:
                last_err = err
                if attempt + 1 >= self.retries:
                    break
                time.sleep(1.2 * (attempt + 1))

        raise RuntimeError(f"POST {path} failed after retries: {last_err}")


def create_fake_room(api: ApiClient, game_type: str, agent_a: str, agent_b: str) -> Dict[str, Any]:
    return api.post(
        "/api/test/fake-room",
        {"gameType": game_type, "agentA": agent_a, "agentB": agent_b},
        use_bearer=True,
    )


def create_room(api: ApiClient, game_type: str) -> str:
    data = api.post(
        "/api/match/create",
        {"gameType": game_type, "visibility": "public"},
        use_cookie=True,
    )
    room_id = str(data.get("roomId") or "")
    if not room_id:
        raise RuntimeError(f"create room failed: {data}")
    return room_id


def join_agent(api: ApiClient, room_id: str, credential: str, agent_id: str) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"roomId": room_id, "credential": credential}
    if agent_id:
        payload["agentId"] = agent_id
    return api.post("/api/agent/join", payload)


def login_agent(api: ApiClient, room_id: str, credential: str, agent_id: str, wait_ms: int = 5000) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"roomId": room_id, "credential": credential, "waitMs": wait_ms}
    if agent_id:
        payload["agentId"] = agent_id
    return api.post("/api/agent/login", payload)


def poll_agent(
    api: ApiClient,
    room_id: str,
    credential: str,
    agent_id: str,
    since_seq: int,
    wait_ms: int = 5000,
    player_token: str = "",
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "roomId": room_id,
        "credential": credential,
        "sinceSeq": since_seq,
        "waitMs": wait_ms,
    }
    if agent_id:
        payload["agentId"] = agent_id
    if player_token:
        payload["playerToken"] = player_token
    data = api.post("/api/agent/poll", payload)
    return data


def act_agent(
    api: ApiClient,
    room_id: str,
    credential: str,
    agent_id: str,
    player_token: str,
    action_id: str,
    move: Optional[Dict[str, Any]] = None,
    chat_text: str = "",
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "roomId": room_id,
        "credential": credential,
        "actionId": action_id,
    }
    if agent_id:
        payload["senderId"] = agent_id
    if player_token:
        payload["playerToken"] = player_token
    if move is not None:
        payload["move"] = move
    if chat_text:
        payload["chatText"] = chat_text
    return api.post("/api/agent/act", payload)


def sample_move(game_type: str, state: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    # Generic fallback strategy. If unknown, return None and we send chat-only act.
    if game_type == "gomoku":
        board = (state.get("state") or {}).get("board") or []
        size = int((state.get("state") or {}).get("size") or 15)
        for y in range(min(len(board), size)):
            row = board[y] or []
            for x in range(min(len(row), size)):
                if row[x] is None:
                    return {"x": x, "y": y}
        return None

    if game_type in {"xiangqi", "chess"}:
        # Placeholder engines often accept from/to shape.
        return {"from": "a0", "to": "a1"}

    if game_type == "go":
        return {"x": random.randint(0, 18), "y": random.randint(0, 18)}

    return None


def assert_poll_shape(poll_data: Dict[str, Any]) -> None:
    for k in ["protocolVersion", "roomId", "seq", "message", "turn", "connection"]:
        if k not in poll_data:
            raise RuntimeError(f"poll missing key: {k}, data={poll_data}")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--base-url", required=True)
    p.add_argument("--room-id", default="")
    p.add_argument("--create-room", action="store_true")
    p.add_argument("--use-fake-room", action="store_true")
    p.add_argument("--game-type", default="gomoku")
    p.add_argument("--cookie", default="")
    p.add_argument("--credential", default="")
    p.add_argument("--bearer-token", default="")
    p.add_argument("--agent-id", default="smoke_main")
    p.add_argument("--opponent-agent-id", default="")
    p.add_argument("--max-polls", type=int, default=6)
    args = p.parse_args()

    if not args.credential:
        raise RuntimeError("--credential is required")

    api = ApiClient(args.base_url, cookie=args.cookie, bearer_token=args.bearer_token)

    room_id = args.room_id
    fake_room: Dict[str, Any] = {}
    if args.use_fake_room:
        if not args.bearer_token:
            raise RuntimeError("--use-fake-room requires --bearer-token")
        fake_room = create_fake_room(api, args.game_type, args.agent_id, args.opponent_agent_id or "smoke_oppo")
        room_id = str(fake_room.get("roomId") or "")
    elif args.create_room:
        if not args.cookie:
            raise RuntimeError("--create-room requires --cookie")
        room_id = create_room(api, args.game_type)
    if not room_id:
        raise RuntimeError("provide --room-id or --create-room or --use-fake-room")

    print(f"[smoke] room={room_id} game={args.game_type}")

    if fake_room:
        plist = fake_room.get("players") or []
        me = next((p for p in plist if p.get("agentId") == args.agent_id), {})
        opp = next((p for p in plist if p.get("agentId") != args.agent_id), {})
    else:
        me = join_agent(api, room_id, args.credential, args.agent_id)
        opp = {}
        if args.opponent_agent_id:
            opp = join_agent(api, room_id, args.credential, args.opponent_agent_id)
    print("[smoke] join ok", json.dumps({"me": me.get("seat"), "opp": opp.get("seat") if opp else None}, ensure_ascii=True))

    login_data = login_agent(api, room_id, args.credential, args.agent_id, wait_ms=8000)
    print("[smoke] login", json.dumps({"ready": login_data.get("ready"), "status": login_data.get("status")}, ensure_ascii=True))

    player_token = str(me.get("playerToken") or login_data.get("playerToken") or "")
    if not player_token:
        raise RuntimeError("missing playerToken from join/login")

    opp_token = str((opp or {}).get("playerToken") or "")
    if opp_token and str(me.get("seat") or "") == "white" and args.game_type == "gomoku":
        # Kick one opponent move so white can get a turn in smoke test.
        _ = act_agent(
            api,
            room_id,
            args.credential,
            str((opp or {}).get("agentId") or args.opponent_agent_id or "smoke_oppo"),
            opp_token,
            f"smoke-open-{int(time.time())}",
            move={"x": 7, "y": 7},
        )
        print("[smoke] seeded opening move by opponent")

    seq = 0
    acted = False
    observed_types = []

    for i in range(args.max_polls):
        poll_data = poll_agent(api, room_id, args.credential, args.agent_id, since_seq=seq, wait_ms=5000, player_token=player_token)
        assert_poll_shape(poll_data)
        seq = max(seq, int(poll_data.get("seq") or 0))
        msg = poll_data.get("message") or {}
        msg_type = str(msg.get("type") or "")
        if msg_type:
            observed_types.append(msg_type)

        print(f"[smoke] poll#{i+1} type={msg_type} seq={seq}")

        turn = poll_data.get("turn") or {}
        if bool((poll_data.get("connection") or {}).get("shouldDisconnect")):
            print("[smoke] disconnected")
            break

        if bool(turn.get("yourTurn")) and not acted:
            move = sample_move(args.game_type, (msg.get("state") or poll_data.get("state") or {}))
            action_id = f"smoke-{int(time.time())}"
            if move is not None:
                act = act_agent(api, room_id, args.credential, args.agent_id, player_token, action_id, move=move)
                print("[smoke] act(move) ok", json.dumps({"actionId": action_id}, ensure_ascii=True))
            else:
                act = act_agent(
                    api,
                    room_id,
                    args.credential,
                    args.agent_id,
                    player_token,
                    action_id,
                    chat_text="smoke test act",
                )
                print("[smoke] act(chat) ok", json.dumps({"actionId": action_id}, ensure_ascii=True))
            _ = act
            acted = True

    if not observed_types:
        raise RuntimeError("no message types observed")

    summary = {
        "ok": True,
        "roomId": room_id,
        "gameType": args.game_type,
        "acted": acted,
        "observedMessageTypes": sorted(set(observed_types)),
    }
    print("[smoke] summary", json.dumps(summary, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[smoke] failed: {exc}", file=sys.stderr)
        raise
