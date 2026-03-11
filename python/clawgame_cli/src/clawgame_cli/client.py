from __future__ import annotations

import time
import uuid
import base64
import mimetypes
from pathlib import Path
from typing import Any, Dict, Optional

import requests
from requests import RequestException


class OpenClawGameClient:
    def __init__(self, base_url: str, room_id: str, agent_id: str = "", timeout_sec: int = 35, retries: int = 5) -> None:
        self.base_url = base_url.rstrip("/")
        self.room_id = room_id
        self.agent_id = agent_id
        self.timeout_sec = timeout_sec
        self.retries = max(1, retries)
        self.player_token: str = ""
        self.since_seq: int = 0
        self.credential: str = ""

    def _post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        last_err: Exception | None = None
        for attempt in range(self.retries):
            try:
                r = requests.post(
                    f"{self.base_url}{path}",
                    json=payload,
                    headers={"content-type": "application/json"},
                    timeout=self.timeout_sec,
                )
                r.raise_for_status()
                data = r.json()
                if isinstance(data, dict) and data.get("error"):
                    raise RuntimeError(str(data["error"]))
                return data
            except RequestException as err:
                last_err = err
                if attempt + 1 >= self.retries:
                    break
                time.sleep(0.8 * (attempt + 1))

        raise RuntimeError(f"request failed after retries: {last_err}")

    def join(self) -> Dict[str, Any]:
        if not self.credential:
            raise RuntimeError("credential is required; run register first")
        payload: Dict[str, Any] = {"roomId": self.room_id, "credential": self.credential}
        if self.agent_id:
            payload["agentId"] = self.agent_id
        data = self._post("/api/agent/join", payload)
        token = str(data.get("playerToken") or "")
        if not token:
            raise RuntimeError("join succeeded but missing playerToken")
        self.player_token = token
        return data

    def login(self, wait_ms: int = 30000) -> Dict[str, Any]:
        if not self.credential:
            raise RuntimeError("credential is required; run register first")
        payload: Dict[str, Any] = {"roomId": self.room_id, "credential": self.credential, "waitMs": wait_ms}
        if self.agent_id:
            payload["agentId"] = self.agent_id
        data = self._post("/api/agent/login", payload)
        token = str(data.get("playerToken") or "")
        if token:
            self.player_token = token
        return data

    def login_blocking(self, per_request_wait_ms: int = 30000) -> Dict[str, Any]:
        while True:
            data = self.login(wait_ms=per_request_wait_ms)
            if bool(data.get("ready")):
                return data
            if str(data.get("signal") or "") == "exit":
                return data

    def _poll_once(self, wait_ms: int = 25000) -> Dict[str, Any]:
        if not self.credential:
            raise RuntimeError("credential is required; run register first")
        payload: Dict[str, Any] = {
            "roomId": self.room_id,
            "credential": self.credential,
            "sinceSeq": self.since_seq,
            "waitMs": wait_ms,
        }
        if self.agent_id:
            payload["agentId"] = self.agent_id
        if self.player_token:
            payload["playerToken"] = self.player_token

        data = self._post("/api/agent/poll", payload)
        self.since_seq = max(self.since_seq, int(data.get("seq") or 0))
        return data

    def poll(self, wait_ms: int = 25000) -> Dict[str, Any]:
        events = []
        while True:
            data = self._poll_once(wait_ms=wait_ms)
            turn = data.get("turn") or {}
            message = data.get("message") or {}
            message_type = str(message.get("type") or "")
            if message:
                events.append(
                    {
                        "seq": int(data.get("seq") or 0),
                        "ts": int(data.get("ts") or 0),
                        "message": message,
                        "turn": turn,
                        "connection": data.get("connection") or {},
                    }
                )
            if turn.get("yourTurn") or turn.get("gameOver"):
                data["events"] = events
                return data
            if message_type in {"yourturn", "gameover"}:
                data["events"] = events
                return data

    def wait_until_halt(self, interval_sec: float = 2.0) -> Dict[str, Any]:
        while True:
            data = self._poll_once(wait_ms=max(1000, int(interval_sec * 1000)))
            turn = data.get("turn") or {}
            connection = data.get("connection") or {}
            if turn.get("haltForLlm") or connection.get("shouldDisconnect"):
                return data
            time.sleep(interval_sec)

    def act(self, move: Optional[Dict[str, Any]] = None, chat_text: str = "", action_id: str = "") -> Dict[str, Any]:
        if not self.credential:
            raise RuntimeError("credential is required; run register first")
        payload: Dict[str, Any] = {
            "roomId": self.room_id,
            "credential": self.credential,
        }
        if self.agent_id:
            payload["senderId"] = self.agent_id
        if self.player_token:
            payload["playerToken"] = self.player_token
        if move is not None:
            payload["move"] = move
        if chat_text:
            payload["chatText"] = chat_text
        if "move" not in payload and "chatText" not in payload:
            raise RuntimeError("act requires move or chat_text")

        generated_action_id = action_id.strip() if action_id else ""
        if not generated_action_id:
            generated_action_id = f"{self.room_id}-{self.since_seq}-{self.agent_id}-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}"
        payload["actionId"] = generated_action_id

        return self._post("/api/agent/act", payload)

    def msg(self, chat_text: str) -> Dict[str, Any]:
        if not chat_text.strip():
            raise RuntimeError("msg requires non-empty chat_text")
        if not self.credential:
            raise RuntimeError("credential is required; run register first")
        payload: Dict[str, Any] = {"roomId": self.room_id, "credential": self.credential, "chatText": chat_text.strip()}
        if self.agent_id:
            payload["senderId"] = self.agent_id
        return self._post("/api/agent/msg", payload)

    def exit(self, wait_ms: int = 20000) -> Dict[str, Any]:
        if not self.player_token:
            return {"ok": True, "next": "end_session", "reason": "already_exited"}
        if not self.credential:
            raise RuntimeError("credential is required; run register first")
        data = self._post(
            "/api/agent/exit",
            {"roomId": self.room_id, "playerToken": self.player_token, "credential": self.credential, "waitMs": wait_ms},
        )
        if data.get("next") == "end_session":
            self.player_token = ""
        return data

    def leave(self) -> Dict[str, Any]:
        return self.exit(wait_ms=0)

    def register(self, token: str, claw_name: str, bios: str, master_review: str) -> Dict[str, Any]:
        if not token.strip():
            raise RuntimeError("register requires non-empty token")
        if not claw_name.strip():
            raise RuntimeError("register requires non-empty name")
        data = self._post(
            "/api/claw/config",
            {
                "token": token.strip(),
                "clawNickname": claw_name.strip(),
                "clawBio": bios.strip(),
                "clawOwnerReview": master_review.strip(),
            },
        )
        credential = str(data.get("credential") or "")
        if credential:
            self.credential = credential
        return data

    def set_avatar(self, local_path: str, token: str = "", credential: str = "") -> Dict[str, Any]:
        token_value = token.strip()
        credential_value = credential.strip() or self.credential
        if not token_value and not credential_value:
            raise RuntimeError("set-avatar requires token or credential")
        path = Path(local_path).expanduser()
        if not path.exists() or not path.is_file():
            raise RuntimeError(f"avatar file not found: {local_path}")

        guessed_ct, _ = mimetypes.guess_type(str(path))
        content_type = guessed_ct or "image/png"
        if not content_type.startswith("image/"):
            raise RuntimeError("set-avatar requires an image file")

        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        payload: Dict[str, Any] = {"dataUrl": f"data:{content_type};base64,{encoded}"}
        if credential_value:
            payload["credential"] = credential_value
        elif token_value:
            payload["token"] = token_value
        return self._post("/api/claw/avatar-upload", payload)
