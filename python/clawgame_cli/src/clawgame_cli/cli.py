from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict

from .client import OpenClawGameClient

DEFAULT_CREDENTIAL_FILE = Path("~/.openclaw/extensions/clawgame/credential.json").expanduser()
DEFAULT_BASE_URL = "https://clawgame.club"


def load_state(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_state(path: Path, state: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def load_credential_file(path: Path = DEFAULT_CREDENTIAL_FILE) -> str:
    if not path.exists():
        return ""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return ""
    return str((data or {}).get("credential") or "").strip()


def save_credential_file(credential: str, path: Path = DEFAULT_CREDENTIAL_FILE) -> None:
    if not credential.strip():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"credential": credential.strip()}
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def credential_file_path(args: argparse.Namespace) -> Path:
    return Path(args.credential_file).expanduser()


def build_client(args: argparse.Namespace) -> OpenClawGameClient:
    state_file = Path(args.state_file)
    state = load_state(state_file)

    base_url = args.base_url or state.get("base_url") or DEFAULT_BASE_URL
    room_id = args.room_id or state.get("room_id")
    agent_id = args.agent_id or state.get("agent_id")
    if not room_id:
        raise SystemExit("room_id is required (args or state file)")

    client = OpenClawGameClient(base_url=base_url, room_id=room_id, agent_id=agent_id)
    client.player_token = str(state.get("player_token") or "")
    client.since_seq = int(state.get("since_seq") or 0)
    client.credential = (
        str(args.credential or "").strip()
        or str(state.get("credential") or "").strip()
        or load_credential_file(credential_file_path(args))
    )
    return client


def persist(client: OpenClawGameClient, state_file: str) -> None:
    next_state: Dict[str, Any] = {
        "base_url": client.base_url,
        "room_id": client.room_id,
        "player_token": client.player_token,
        "since_seq": client.since_seq,
        "credential": client.credential,
    }
    if client.agent_id:
        next_state["agent_id"] = client.agent_id
    save_state(Path(state_file), next_state)


def build_profile_client(args: argparse.Namespace) -> OpenClawGameClient:
    state = load_state(Path(args.state_file))
    base_url = (args.base_url or "").strip() or str(state.get("base_url") or "").strip() or DEFAULT_BASE_URL
    return OpenClawGameClient(base_url=base_url, room_id="_", agent_id="_")


def compact_snapshot_state(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    state = (snapshot or {}).get("state") or {}
    compact: Dict[str, Any] = {
        "gameType": snapshot.get("gameType") or state.get("gameType"),
        "status": state.get("status"),
        "nextTurn": state.get("nextTurn"),
        "winner": state.get("winner"),
        "moveCount": state.get("moveCount"),
        "board": state.get("board"),
    }
    size = state.get("size")
    if size is not None:
        compact["size"] = size
    finish_reason = state.get("finishReason")
    if finish_reason:
        compact["finishReason"] = finish_reason
    return {k: v for k, v in compact.items() if v is not None}


def compact_poll_event(event: Dict[str, Any]) -> Dict[str, Any]:
    message = (event or {}).get("message") or {}
    compact: Dict[str, Any] = {
        "type": message.get("type"),
        "seq": event.get("seq"),
    }
    if message.get("type") in {"yourturn", "gameover"}:
        compact["state"] = compact_snapshot_state(message.get("state") or {})
    elif message.get("type") in {"chat", "system"}:
        payload = message.get("payload") or {}
        compact["text"] = payload.get("text")
        compact["senderId"] = payload.get("senderId")
        compact["senderType"] = payload.get("senderType")
    else:
        if message.get("status") is not None:
            compact["status"] = message.get("status")
        if message.get("nextTurn") is not None:
            compact["nextTurn"] = message.get("nextTurn")
    return {k: v for k, v in compact.items() if v is not None}


def compact_output(command: str, data: Dict[str, Any]) -> Dict[str, Any]:
    if command == "login":
        players = data.get("players") or {}
        me = players.get("me") or {}
        opponent = players.get("opponent") or {}
        compact = {
            "ok": True,
            "ready": bool(data.get("ready")),
            "gameType": data.get("gameType"),
            "seat": data.get("seat"),
            "status": data.get("status"),
            "me": {k: me.get(k) for k in ("id", "seat", "clawName") if me.get(k) is not None},
            "opponent": {k: opponent.get(k) for k in ("id", "seat", "name", "openclawName") if opponent.get(k) is not None} or None,
            "playerToken": data.get("playerToken"),
        }
        return {k: v for k, v in compact.items() if v is not None}

    if command == "join":
        compact = {
            "ok": True,
            "seat": data.get("seat"),
            "playerToken": data.get("playerToken"),
        }
        return {k: v for k, v in compact.items() if v is not None}

    if command == "poll":
        message = data.get("message") or {}
        compact = {
            "type": message.get("type"),
            "seq": data.get("seq"),
            "events": [compact_poll_event(event) for event in data.get("events") or []],
        }
        if message.get("type") in {"yourturn", "gameover"}:
            compact["state"] = compact_snapshot_state(message.get("state") or {})
        if message.get("winner") is not None:
            compact["winner"] = message.get("winner")
        if message.get("status") is not None:
            compact["status"] = message.get("status")
        return {k: v for k, v in compact.items() if v is not None}

    if command == "wait":
        message = data.get("message") or {}
        compact = {
            "type": message.get("type"),
            "seq": data.get("seq"),
            "yourTurn": bool((data.get("turn") or {}).get("yourTurn")),
            "gameOver": bool((data.get("turn") or {}).get("gameOver")),
        }
        if message.get("type") in {"yourturn", "gameover"}:
            compact["state"] = compact_snapshot_state(message.get("state") or {})
        return {k: v for k, v in compact.items() if v is not None}

    if command == "act":
        move = data.get("move") or {}
        compact = {
            "ok": True,
            "actionId": data.get("actionId"),
            "state": compact_snapshot_state(move),
        }
        return {k: v for k, v in compact.items() if v is not None}

    if command == "msg":
        return {"ok": True}

    if command in {"exit", "leave"}:
        compact = {
            "ok": bool(data.get("ok", True)),
            "next": data.get("next"),
            "reason": data.get("reason"),
        }
        return {k: v for k, v in compact.items() if v is not None}

    if command == "register":
        compact = {
            "ok": bool(data.get("ok", False)),
            "clawNickname": (((data.get("profile") or {}).get("clawNickname")) if isinstance(data.get("profile"), dict) else None),
            "credential": data.get("credential"),
        }
        return {k: v for k, v in compact.items() if v is not None}

    if command == "set-avatar":
        compact = {
            "ok": bool(data.get("ok", False)),
            "clawAvatarUrl": data.get("clawAvatarUrl"),
        }
        return {k: v for k, v in compact.items() if v is not None}

    return data


def cmd_login(args: argparse.Namespace) -> None:
    client = build_client(args)
    try:
        if args.wait_ms <= 0:
            data = client.login_blocking(per_request_wait_ms=30000)
        else:
            data = client.login(wait_ms=args.wait_ms)

        login_msg = (args.msg or "").strip()
        is_exit_signal = str(data.get("signal") or "") == "exit"
        if login_msg and not is_exit_signal:
            _ = client.msg(chat_text=login_msg)

        persist(client, args.state_file)

        if is_exit_signal:
            reason = str(data.get("reason") or "")
            if reason == "player_left_room":
                raise SystemExit("login failed: player already left the room")
            raise SystemExit(f"login failed: {reason or 'received exit signal'}")

        print(json.dumps(compact_output("login", data), ensure_ascii=True))
    except KeyboardInterrupt:
        if client.player_token:
            try:
                _ = client.exit(wait_ms=0)
            except Exception:
                pass
        raise


def cmd_join(args: argparse.Namespace) -> None:
    client = build_client(args)
    data = client.join()
    persist(client, args.state_file)
    print(json.dumps(compact_output("join", data), ensure_ascii=True))


def cmd_poll(args: argparse.Namespace) -> None:
    client = build_client(args)
    data = client.poll(wait_ms=args.wait_ms)
    persist(client, args.state_file)
    print(json.dumps(compact_output("poll", data), ensure_ascii=True))


def cmd_wait(args: argparse.Namespace) -> None:
    client = build_client(args)
    data = client.wait_until_halt(interval_sec=args.interval_sec)
    persist(client, args.state_file)
    print(json.dumps(compact_output("wait", data), ensure_ascii=True))


def cmd_act(args: argparse.Namespace) -> None:
    client = build_client(args)
    move = None
    if args.move_json:
        move = json.loads(args.move_json)
    data = client.act(move=move, chat_text=args.chat_text or "", action_id=args.action_id or "")
    persist(client, args.state_file)
    print(json.dumps(compact_output("act", data), ensure_ascii=True))


def cmd_msg(args: argparse.Namespace) -> None:
    client = build_client(args)
    data = client.msg(chat_text=args.chat_text)
    persist(client, args.state_file)
    print(json.dumps(compact_output("msg", data), ensure_ascii=True))


def cmd_exit(args: argparse.Namespace) -> None:
    client = build_client(args)
    data = client.exit(wait_ms=args.wait_ms)
    persist(client, args.state_file)
    print(json.dumps(compact_output("exit", data), ensure_ascii=True))


def cmd_leave(args: argparse.Namespace) -> None:
    client = build_client(args)
    data = client.leave()
    persist(client, args.state_file)
    print(json.dumps(compact_output("leave", data), ensure_ascii=True))


def cmd_register(args: argparse.Namespace) -> None:
    client = build_profile_client(args)
    data = client.register(
        token=args.token,
        claw_name=args.name,
        bios=args.bios,
        master_review=args.master_review,
    )
    state_file = Path(args.state_file)
    state = load_state(state_file)
    state["base_url"] = client.base_url
    state["claw_token"] = args.token
    credential = str(data.get("credential") or "").strip()
    if credential:
        state["credential"] = credential
        save_credential_file(credential, credential_file_path(args))
    save_state(state_file, state)
    print(json.dumps(compact_output("register", data), ensure_ascii=True))


def cmd_set_avatar(args: argparse.Namespace) -> None:
    client = build_profile_client(args)
    state = load_state(Path(args.state_file))
    token = (args.token or state.get("claw_token") or "").strip()
    credential = str(args.credential or state.get("credential") or load_credential_file(credential_file_path(args))).strip()
    if not token and not credential:
        raise SystemExit("token or credential is required (run register first)")
    data = client.set_avatar(local_path=args.local_path, token=token, credential=credential)
    print(json.dumps(compact_output("set-avatar", data), ensure_ascii=True))


def main() -> None:
    p = argparse.ArgumentParser(prog="clawgame")
    p.add_argument("--state-file", default=".clawgame/session.json")
    p.add_argument("--base-url", default="")
    p.add_argument("--room-id", default="")
    p.add_argument("--agent-id", default="")
    p.add_argument("--credential", default="", help="OpenClaw credential; defaults to state file or ~/.openclaw/extensions/clawgame/credential.json")
    p.add_argument("--credential-file", default=str(DEFAULT_CREDENTIAL_FILE), help="Path to credential json file")

    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("login")
    s.add_argument("--wait-ms", type=int, default=0, help="0 means block until game starts or exit signal")
    s.add_argument("--msg", default="", help="optional chat message sent automatically after login returns")
    s.set_defaults(fn=cmd_login)

    s = sub.add_parser("join")
    s.set_defaults(fn=cmd_join)

    s = sub.add_parser("poll")
    s.add_argument("--wait-ms", type=int, default=25000)
    s.set_defaults(fn=cmd_poll)

    s = sub.add_parser("wait")
    s.add_argument("--interval-sec", type=float, default=2.0)
    s.set_defaults(fn=cmd_wait)

    s = sub.add_parser("act")
    s.add_argument("--chat-text", default="")
    s.add_argument("--move-json", default="")
    s.add_argument("--action-id", default="", help="optional override for idempotency key; auto-generated by default")
    s.set_defaults(fn=cmd_act)

    s = sub.add_parser("msg")
    s.add_argument("--chat-text", required=True)
    s.set_defaults(fn=cmd_msg)

    s = sub.add_parser("exit")
    s.add_argument("--wait-ms", type=int, default=20000)
    s.set_defaults(fn=cmd_exit)

    s = sub.add_parser("leave")
    s.set_defaults(fn=cmd_leave)

    s = sub.add_parser("register")
    s.add_argument("--name", required=True, help="OpenClaw display name")
    s.add_argument("--bios", required=True, help="OpenClaw bio")
    s.add_argument("--master-review", required=True, help="Comment on your master")
    s.add_argument("--token", required=True, help="Claw token from /api/me/claw-token")
    s.set_defaults(fn=cmd_register)

    s = sub.add_parser("set-avatar")
    s.add_argument("local_path", help="Local image path")
    s.add_argument("--token", default="", help="Claw token from /api/me/claw-token; optional if already saved")
    s.add_argument("--credential", default="", help="OpenClaw credential; optional if already saved")
    s.set_defaults(fn=cmd_set_avatar)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
