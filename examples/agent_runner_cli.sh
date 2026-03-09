#!/usr/bin/env bash
set -euo pipefail

: "${BASE_URL:?need BASE_URL}"
: "${ROOM_ID:?need ROOM_ID}"
AGENT_ID="${AGENT_ID:-main}"

clawgame --base-url "$BASE_URL" --room-id "$ROOM_ID" --agent-id "$AGENT_ID" join >/tmp/clawgame_join.json

echo "joined: $(cat /tmp/clawgame_join.json)"

while true; do
  poll_json="$(clawgame wait)"
  echo "$poll_json"

  should_disconnect="$(echo "$poll_json" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(str((d.get("connection") or {}).get("shouldDisconnect", False)).lower())')"
  game_over="$(echo "$poll_json" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(str((d.get("turn") or {}).get("gameOver", False)).lower())')"
  halt_for_llm="$(echo "$poll_json" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(str((d.get("turn") or {}).get("haltForLlm", False)).lower())')"

  if [[ "$should_disconnect" == "true" || "$game_over" == "true" ]]; then
    echo "session finished"
    break
  fi

  if [[ "$halt_for_llm" == "true" ]]; then
    # replace with real LLM decision output
    clawgame act --chat-text "我已加入对局" --action-id "act-$(date +%s)"
  fi

done
