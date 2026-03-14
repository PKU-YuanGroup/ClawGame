#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function parseArgs(argv) {
  const out = {
    id: "",
    en: "",
    zh: "",
    minPlayers: 2,
    maxPlayers: 2,
    seats: "black,white",
    objective: "custom_objective",
    phases: "playing,finished",
    events: "yourturn,state_update,gameover",
    actionType: "action",
    actionPayload: '{"kind":"string"}',
    roomRules: "",
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for --${key}`);
    }
    i += 1;
    if (key === "id") out.id = value;
    else if (key === "en") out.en = value;
    else if (key === "zh") out.zh = value;
    else if (key === "min") out.minPlayers = Number(value);
    else if (key === "max") out.maxPlayers = Number(value);
    else if (key === "seats") out.seats = value;
    else if (key === "objective") out.objective = value;
    else if (key === "phases") out.phases = value;
    else if (key === "events") out.events = value;
    else if (key === "action-type") out.actionType = value;
    else if (key === "action-payload") out.actionPayload = value;
    else if (key === "room-rules") out.roomRules = value;
  }
  return out;
}

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function writeFile(rel, content, dryRun) {
  const full = path.join(ROOT, rel);
  if (dryRun) {
    console.log(`[dry-run] update ${rel}`);
    return;
  }
  fs.writeFileSync(full, content);
  console.log(`updated ${rel}`);
}

function createEngineTemplate({ id, seats, minPlayers, maxPlayers }) {
  const exportName = `${toPascal(id)}Engine`;
  const seatsArray = seats.map((s) => `"${s}"`).join(", ");
  const nextTurnExpr = seats.length > 1 ? `seats[(seats.indexOf(seat) + 1) % seats.length]` : "seat";
  const defaultMove = '{ kind: "pass" }';

  return `import type { GameEngine, MatchState, Seat } from "./types.ts";

const seats: Seat[] = [${seatsArray}];

export const ${exportName}: GameEngine = {
  gameType: "${id}",
  seats,
  minPlayers: ${minPlayers},
  maxPlayers: ${maxPlayers},

  initState(): MatchState {
    return {
      gameType: "${id}",
      board: { log: [] as unknown[] },
      nextTurn: seats[0],
      status: "waiting",
      moveCount: 0,
    };
  },

  validateMove(state, seat, move): void {
    if (state.status !== "playing") throw new Error("Match is not in playing status");
    if (state.nextTurn !== seat) throw new Error("Not your turn");
    if (!move || typeof move !== "object") throw new Error("Invalid move payload");
  },

  applyMove(state, seat, move): MatchState {
    const board = (state.board as { log: unknown[] }) || { log: [] };
    const log = [...board.log, { seat, move }];

    return {
      ...state,
      board: { ...board, log },
      moveCount: state.moveCount + 1,
      nextTurn: ${nextTurnExpr},
      status: "playing",
    };
  },

  chooseBotMove() {
    return ${defaultMove};
  },

  snapshot(state) {
    return state;
  },
};
`;
}

function toCamel(id) {
  const camel = id.replace(/[-_]+(.)/g, (_, c) => c.toUpperCase());
  return camel[0].toLowerCase() + camel.slice(1);
}

function toPascal(id) {
  const camel = toCamel(id);
  return camel[0].toUpperCase() + camel.slice(1);
}

function parseJsonFlag(value, key) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`invalid JSON for ${key}: ${error.message}`);
  }
}

function asTsLiteral(value, indent = 0) {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((item) => `${pad}  ${asTsLiteral(item, indent + 2)}`).join(",\n")}\n${pad}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return `{\n${entries.map(([key, item]) => `${pad}  ${JSON.stringify(key)}: ${asTsLiteral(item, indent + 2)}`).join(",\n")}\n${pad}}`;
  }
  return JSON.stringify(value);
}

function insertOnce(content, marker, insertText) {
  must(content.includes(marker), `marker not found: ${marker}`);
  if (content.includes(insertText.trim())) return content;
  return content.replace(marker, `${insertText}${marker}`);
}

function addGameToRegistry(registry, id) {
  const exportName = `${toPascal(id)}Engine`;
  const importLine = `import { ${exportName} } from "./${id}.ts";\n`;
  const mapLine = `  [${exportName}.gameType, ${exportName}],\n`;

  let out = insertOnce(registry, "const engines = new Map<string, GameEngine>([\n", importLine);
  out = insertOnce(out, "]);\n", mapLine);
  return out;
}

function addGameToEngineIndex(content, id) {
  const line = `export * from "./${id}.ts";\n`;
  if (content.includes(line)) return content;
  return `${content.trimEnd()}\n${line}`;
}

function addGameToCatalog(content, { id, en, zh, objective, phases, events, roomRules, actionType, actionPayload }) {
  const entry = `  ${id}: {\n    key: "${id}",\n    name: { en: "${en}", zh: "${zh}" },\n    rules: ${asTsLiteral({ objective, phases, recommendedEvents: events }, 4)},\n    roomRules: ${asTsLiteral(roomRules, 4)},\n    actionSchema: ${asTsLiteral({ type: actionType, payload: actionPayload }, 4)},\n  },\n`;
  if (content.includes(`  ${id}: {`)) return content;
  return content.replace("};\n\nfunction humanizeGameType", `${entry}};\n\nfunction humanizeGameType`);
}

function main() {
  const args = parseArgs(process.argv);
  must(args.id, "--id is required");
  must(/^[a-z][a-z0-9_\-]*$/.test(args.id), "--id must match ^[a-z][a-z0-9_-]*$");

  const id = args.id;
  const en = args.en || id.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const zh = args.zh || en;
  const seats = args.seats.split(",").map((x) => x.trim()).filter(Boolean);
  const phases = args.phases.split(",").map((x) => x.trim()).filter(Boolean);
  const events = args.events.split(",").map((x) => x.trim()).filter(Boolean);
  const actionPayload = parseJsonFlag(args.actionPayload, "--action-payload");
  const roomRules = args.roomRules
    ? parseJsonFlag(args.roomRules, "--room-rules")
    : {
        seats: seats.length <= 2 ? seats.length : seats,
        objective: args.objective,
        phases,
        first: seats[0],
      };

  must(Number.isInteger(args.minPlayers) && args.minPlayers > 0, "--min must be positive integer");
  must(Number.isInteger(args.maxPlayers) && args.maxPlayers >= args.minPlayers, "--max must be integer and >= --min");
  must(seats.length > 0, "--seats cannot be empty");
  must(phases.length > 0, "--phases cannot be empty");
  must(events.length > 0, "--events cannot be empty");
  must(actionPayload && typeof actionPayload === "object" && !Array.isArray(actionPayload), "--action-payload must be a JSON object");

  const enginePath = `packages/game-engine/src/${id}.ts`;
  const engineFullPath = path.join(ROOT, enginePath);
  must(!fs.existsSync(engineFullPath), `${enginePath} already exists`);

  const engineContent = createEngineTemplate({
    id,
    seats,
    minPlayers: args.minPlayers,
    maxPlayers: args.maxPlayers,
  });

  if (args.dryRun) {
    console.log(`[dry-run] create ${enginePath}`);
  } else {
    fs.writeFileSync(engineFullPath, engineContent);
    console.log(`created ${enginePath}`);
  }

  const registryPath = "packages/game-engine/src/registry.ts";
  const indexPath = "packages/game-engine/src/index.ts";
  const protocolPath = "packages/game-protocol/src/index.ts";

  writeFile(registryPath, addGameToRegistry(readFile(registryPath), id), args.dryRun);
  writeFile(indexPath, addGameToEngineIndex(readFile(indexPath), id), args.dryRun);
  writeFile(protocolPath, addGameToCatalog(readFile(protocolPath), {
    id,
    en,
    zh,
    objective: args.objective,
    phases,
    events,
    roomRules,
    actionType: args.actionType,
    actionPayload,
  }), args.dryRun);

  console.log("\nScaffold complete. Next steps:");
  console.log("1) Implement real game logic in packages/game-engine/src/" + id + ".ts");
  console.log("2) Tune protocol catalog metadata in packages/game-protocol/src/index.ts if placeholder defaults are not enough.");
  console.log("3) Add a dedicated frontend renderer if the generic placeholder view is no longer sufficient.");
  console.log("4) Run: cd worker && npm run test:game-flow && npm run test:protocol-contract");
}

main();
