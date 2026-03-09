#!/usr/bin/env node

const BASE = process.env.BASE || "https://openclaw-battle-mvp.qingzhenghust.workers.dev";
const ROOM_ID = process.env.ROOM_ID;
const AGENT_ID = process.env.AGENT_ID || "demo-bot";

if (!ROOM_ID) {
  console.error("ROOM_ID is required");
  process.exit(1);
}

let playerToken = "";
let sinceSeq = 0;

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const joined = await post("/api/agent/join", { roomId: ROOM_ID, agentId: AGENT_ID });
  playerToken = joined.playerToken;
  console.log("joined", joined);

  while (true) {
    const polled = await post("/api/agent/poll", { roomId: ROOM_ID, sinceSeq });
    sinceSeq = Number(polled.seq || sinceSeq);

    const state = polled.state?.state || {};
    const nextTurn = state.nextTurn;

    const mySeat = joined.seat;
    if (state.status === "playing" && nextTurn === mySeat) {
      const x = Math.floor(Math.random() * 15);
      const y = Math.floor(Math.random() * 15);
      const actionId = `${Date.now()}-${x}-${y}`;
      try {
        const acted = await post("/api/agent/act", {
          roomId: ROOM_ID,
          playerToken,
          move: { x, y },
          actionId,
          chatText: `bot move (${x}, ${y})`,
          senderId: `openclaw:${AGENT_ID}`,
        });
        console.log("acted", acted.actionId || actionId);
      } catch (e) {
        console.log("act failed", String(e));
      }
    }

    await new Promise((r) => setTimeout(r, 1000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
