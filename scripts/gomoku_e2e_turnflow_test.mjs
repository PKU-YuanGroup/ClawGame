#!/usr/bin/env node

const baseUrl = (process.argv[2] || "https://openclaw-battle-mvp.qingzhenghust.workers.dev").replace(/\/$/, "");
const agentA = "turnflow_a";
const agentB = "turnflow_b";

async function post(path, payload) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`POST ${path} ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function waitForYourTurn(roomId, a, maxPolls = 20) {
  for (let i = 0; i < maxPolls; i += 1) {
    const poll = await post("/api/agent/poll", {
      roomId,
      agentId: a.agentId,
      playerToken: a.token,
      sinceSeq: a.seq,
      waitMs: 3000,
    });
    a.seq = Math.max(a.seq, Number(poll.seq || 0));
    const msg = poll.message || {};
    const turn = poll.turn || {};
    if (msg.type === "gameover") return poll;
    if (turn.yourTurn || msg.type === "yourturn") return poll;
  }
  throw new Error(`no yourturn for ${a.agentId}`);
}

async function waitForGameover(roomId, a, maxPolls = 20) {
  for (let i = 0; i < maxPolls; i += 1) {
    const poll = await post("/api/agent/poll", {
      roomId,
      agentId: a.agentId,
      playerToken: a.token,
      sinceSeq: a.seq,
      waitMs: 3000,
    });
    a.seq = Math.max(a.seq, Number(poll.seq || 0));
    if ((poll.message || {}).type === "gameover") return poll;
  }
  throw new Error(`no gameover for ${a.agentId}`);
}

async function main() {
  const fake = await post("/api/test/fake-room", { gameType: "gomoku", agentA, agentB });
  const roomId = String(fake.roomId || "");
  if (!roomId) throw new Error("missing roomId");

  const loginA = await post("/api/agent/login", { roomId, agentId: agentA, waitMs: 5000 });
  const loginB = await post("/api/agent/login", { roomId, agentId: agentB, waitMs: 5000 });

  const a = { agentId: agentA, seat: String(loginA.seat || ""), token: String(loginA.playerToken || ""), seq: 0 };
  const b = { agentId: agentB, seat: String(loginB.seat || ""), token: String(loginB.playerToken || ""), seq: 0 };
  if (!a.token || !b.token) throw new Error("missing token");

  const black = a.seat === "black" ? a : b;
  const white = black === a ? b : a;

  const blackMoves = [[7, 7], [8, 7], [9, 7], [10, 7], [11, 7]];
  const whiteMoves = [[7, 8], [8, 8], [9, 8], [10, 8]];

  console.log(JSON.stringify({ event: "start", roomId, black: black.agentId, white: white.agentId }));

  for (let i = 0; i < 9; i += 1) {
    const cur = i % 2 === 0 ? black : white;
    const move = i % 2 === 0 ? blackMoves[Math.floor(i / 2)] : whiteMoves[Math.floor(i / 2)];
    const poll = await waitForYourTurn(roomId, cur);
    const msgType = (poll.message || {}).type;
    const yourTurn = Boolean((poll.turn || {}).yourTurn);
    if (!yourTurn && msgType !== "yourturn") throw new Error(`unexpected poll before move ${i + 1}`);

    const actionId = `turnflow-${i}-${Date.now()}`;
    const act = await post("/api/agent/act", {
      roomId,
      senderId: cur.agentId,
      playerToken: cur.token,
      actionId,
      move: { x: move[0], y: move[1] },
    });
    if (act.ok === false) throw new Error(`act failed ${JSON.stringify(act)}`);
    console.log(JSON.stringify({ event: "move", i: i + 1, agent: cur.agentId, seat: cur.seat, move }));
  }

  const ga = await waitForGameover(roomId, a);
  const gb = await waitForGameover(roomId, b);
  const wa = (ga.message || {}).winner;
  const wb = (gb.message || {}).winner;
  if (wa !== "black" || wb !== "black") throw new Error(`winner mismatch a=${wa} b=${wb}`);

  console.log(JSON.stringify({ ok: true, roomId, winner: "black" }));
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
