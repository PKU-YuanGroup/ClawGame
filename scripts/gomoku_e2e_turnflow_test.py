#!/usr/bin/env python3
"""End-to-end gomoku turn-flow test.

What it verifies:
1) Both agents can login and poll with playerToken.
2) `yourturn` is emitted to the correct side before each move.
3) A full game can be completed through alternating legal actions.
4) `gameover` is eventually observed.

Usage:
  python3 scripts/gomoku_e2e_turnflow_test.py \
    --base-url https://openclaw-battle-mvp.qingzhenghust.workers.dev
"""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

import requests


class Api:
    def __init__(self, base_url: str, timeout: int = 20) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        r = requests.post(
            f"{self.base_url}{path}",
            json=payload,
            headers={"content-type": "application/json"},
            timeout=self.timeout,
        )
        try:
            data = r.json()
        except Exception:
            data = {"raw": r.text}
        if r.status_code >= 400:
            raise RuntimeError(f"POST {path} failed: status={r.status_code} body={data}")
        return data


@dataclass
class Agent:
    agent_id: str
    seat: str
    token: str
    seq: int = 0


def wait_for_yourturn(api: Api, room_id: str, agent: Agent, max_polls: int = 20) -> Dict[str, Any]:
    for _ in range(max_polls):
        poll = api.post(
            "/api/agent/poll",
            {
                "roomId": room_id,
                "agentId": agent.agent_id,
                "playerToken": agent.token,
                "sinceSeq": agent.seq,
                "waitMs": 3000,
            },
        )
        agent.seq = max(agent.seq, int(poll.get("seq") or 0))
        turn = poll.get("turn") or {}
        msg = poll.get("message") or {}
        if msg.get("type") == "gameover":
            return poll
        if bool(turn.get("yourTurn")) or msg.get("type") == "yourturn":
            return poll
    raise RuntimeError(f"agent={agent.agent_id} did not receive yourturn within {max_polls} polls")


def wait_for_gameover(api: Api, room_id: str, agent: Agent, max_polls: int = 20) -> Dict[str, Any]:
    for _ in range(max_polls):
        poll = api.post(
            "/api/agent/poll",
            {
                "roomId": room_id,
                "agentId": agent.agent_id,
                "playerToken": agent.token,
                "sinceSeq": agent.seq,
                "waitMs": 3000,
            },
        )
        agent.seq = max(agent.seq, int(poll.get("seq") or 0))
        msg = poll.get("message") or {}
        if msg.get("type") == "gameover":
            return poll
    raise RuntimeError(f"agent={agent.agent_id} did not receive gameover")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--agent-a", default="turnflow_a")
    parser.add_argument("--agent-b", default="turnflow_b")
    args = parser.parse_args()

    api = Api(args.base_url)

    fake = api.post(
        "/api/test/fake-room",
        {"gameType": "gomoku", "agentA": args.agent_a, "agentB": args.agent_b},
    )
    room_id = str(fake.get("roomId") or "")
    if not room_id:
        raise RuntimeError(f"missing roomId from fake-room: {fake}")

    login_a = api.post("/api/agent/login", {"roomId": room_id, "agentId": args.agent_a, "waitMs": 5000})
    login_b = api.post("/api/agent/login", {"roomId": room_id, "agentId": args.agent_b, "waitMs": 5000})

    a = Agent(agent_id=args.agent_a, seat=str(login_a.get("seat") or ""), token=str(login_a.get("playerToken") or ""))
    b = Agent(agent_id=args.agent_b, seat=str(login_b.get("seat") or ""), token=str(login_b.get("playerToken") or ""))

    if not a.token or not b.token:
        raise RuntimeError(f"missing player token: a={bool(a.token)} b={bool(b.token)}")
    if not a.seat or not b.seat or a.seat == b.seat:
        raise RuntimeError(f"invalid seats: a={a.seat} b={b.seat}")

    # Deterministic 9-move line where black wins.
    black_moves: List[Tuple[int, int]] = [(7, 7), (8, 7), (9, 7), (10, 7), (11, 7)]
    white_moves: List[Tuple[int, int]] = [(7, 8), (8, 8), (9, 8), (10, 8)]

    black_agent = a if a.seat == "black" else b
    white_agent = b if black_agent is a else a

    print(json.dumps({"event": "start", "roomId": room_id, "black": black_agent.agent_id, "white": white_agent.agent_id}))

    for i in range(9):
        current = black_agent if i % 2 == 0 else white_agent
        move = black_moves[i // 2] if i % 2 == 0 else white_moves[i // 2]

        poll = wait_for_yourturn(api, room_id, current)
        msg_type = (poll.get("message") or {}).get("type")
        turn = poll.get("turn") or {}
        if not (bool(turn.get("yourTurn")) or msg_type == "yourturn"):
            raise RuntimeError(f"expected yourturn before act: agent={current.agent_id} poll={poll}")

        action_id = f"turnflow-{i}-{int(time.time() * 1000)}"
        act = api.post(
            "/api/agent/act",
            {
                "roomId": room_id,
                "senderId": current.agent_id,
                "playerToken": current.token,
                "actionId": action_id,
                "move": {"x": move[0], "y": move[1]},
            },
        )
        if not bool(act.get("ok", True)):
            raise RuntimeError(f"act failed: agent={current.agent_id} move={move} act={act}")
        print(json.dumps({"event": "move", "i": i + 1, "agent": current.agent_id, "seat": current.seat, "move": move}))

    ga = wait_for_gameover(api, room_id, a)
    gb = wait_for_gameover(api, room_id, b)

    winner_a = ((ga.get("message") or {}).get("winner"))
    winner_b = ((gb.get("message") or {}).get("winner"))
    if winner_a != "black" or winner_b != "black":
        raise RuntimeError(f"unexpected winner: a={winner_a} b={winner_b}")

    print(json.dumps({"ok": True, "roomId": room_id, "winner": "black"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
