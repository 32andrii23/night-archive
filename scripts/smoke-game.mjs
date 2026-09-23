import assert from "node:assert/strict";

const origin = process.env.GAME_ORIGIN ?? "http://localhost:5173";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function call(body, token) {
  const response = await fetch(`${origin}/api/game`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
async function read(code, token) {
  const response = await fetch(`${origin}/api/game?code=${code}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: response.status, data: await response.json() };
}
const action = (code, type, input = {}) => ({ type: "action", code, action: { type, ...input } });

const created = await call({ type: "create" });
assert.equal(created.status, 201);
const { code, token: playerToken, monsterInvite } = created.data;
assert.match(code, /^[A-Z0-9]{7}$/);
assert.equal((await read(code)).status, 403);
assert.equal((await call({ type: "join", code, invite: "wrong" })).status, 400);
const joined = await call({ type: "join", code, invite: monsterInvite });
assert.equal(joined.status, 200);
const monsterToken = joined.data.token;
assert.notEqual(monsterToken, playerToken);
assert.equal((await call({ type: "join", code, invite: monsterInvite })).status, 400);
assert.equal((await read(code, "not-a-token")).status, 403);

const playerIntro = (await read(code, playerToken)).data.game;
const monsterIntro = (await read(code, monsterToken)).data.game;
assert.equal(playerIntro.phase, "intro");
assert.equal(playerIntro.side, "player");
assert.equal(monsterIntro.side, "monster");
assert.equal(playerIntro.map.length, 19);
assert.ok(playerIntro.map.every(row => row.length === 27));
assert.equal(playerIntro.fuses.length, 4);
assert.equal(monsterIntro.fuses.length, 4);
assert.equal(playerIntro.introEndsAt - playerIntro.startedAt, 18_000);
assert.equal(playerIntro.endsAt - playerIntro.introEndsAt, 12 * 60_000);
assert.deepEqual({ x: playerIntro.self.x, y: playerIntro.self.y }, { x: 12, y: 17 });
assert.deepEqual({ x: monsterIntro.self.x, y: monsterIntro.self.y }, { x: 14, y: 17 });
assert.equal("spectate" in playerIntro, false);
assert.ok(monsterIntro.spectate);
assert.equal((await call(action(code, "disguise"), playerToken)).status, 400);
assert.equal((await call(action(code, "sound"), playerToken)).status, 400);
assert.equal((await call(action(code, "move", { forward: 2 }), playerToken)).status, 400);

// The client may send intent and camera angles, never an authoritative position.
const introLook = await call(action(code, "move", { forward: 1, strafe: 0, yaw: -Math.PI / 2, pitch: 3, x: 999, y: 999 }), playerToken);
assert.equal(introLook.status, 200);
assert.equal(introLook.data.game.self.x, 12);
assert.equal(introLook.data.game.self.y, 17);
assert.equal(introLook.data.game.self.pitch, 1.48);

await sleep(Math.max(0, playerIntro.startedAt + 5200 - Date.now()));
const arrivalMove = await call(action(code, "move", { forward: 1, strafe: 0, yaw: -Math.PI / 2, pitch: 0 }), playerToken);
assert.equal(arrivalMove.status, 200);
assert.equal(arrivalMove.data.game.phase, "intro");
assert.ok(arrivalMove.data.game.self.y < 17 && arrivalMove.data.game.self.y > 16.6, "arrival becomes walkable after five seconds");

await sleep(Math.max(0, playerIntro.introEndsAt - Date.now() + 100));
const afterIntro = (await read(code, playerToken)).data.game;
assert.equal(afterIntro.phase, "playing");
assert.deepEqual({ x: afterIntro.self.x, y: afterIntro.self.y }, { x: 12, y: 16 });
const monsterPlaying = (await read(code, monsterToken)).data.game;
assert.deepEqual({ x: monsterPlaying.self.x, y: monsterPlaying.self.y }, { x: 23, y: 3 });

const first = await call(action(code, "move", { forward: 1, strafe: 0, yaw: -Math.PI / 2, pitch: 0, x: 999 }), playerToken);
assert.equal(first.status, 200);
await sleep(135);
const second = await call(action(code, "move", { forward: 1, strafe: 0, yaw: -Math.PI / 2, pitch: 0, x: 999 }), playerToken);
assert.equal(second.status, 200);
assert.equal(second.data.game.self.x, 12);
assert.ok(second.data.game.self.y < 16 && second.data.game.self.y > 15.55, "movement is fractional and speed limited");
assert.equal((await read(code, monsterToken)).data.game.spectate.y, second.data.game.self.y);
assert.equal("spectate" in (await read(code, playerToken)).data.game, false);

const revealed = await call(action(code, "disguise"), monsterToken);
assert.equal(revealed.status, 200);
assert.equal(revealed.data.game.self.disguised, false);
const hidden = await call(action(code, "disguise"), monsterToken);
assert.equal(hidden.status, 200);
assert.equal(hidden.data.game.self.disguised, true);
const sound = await call(action(code, "sound"), monsterToken);
assert.equal(sound.status, 200);
assert.ok(sound.data.game.events.some(e => e.type === "sound"));
assert.ok((await read(code, playerToken)).data.game.events.some(e => e.type === "sound"));
assert.equal((await call(action(code, "sound"), monsterToken)).status, 400);

console.log("PASS: two authenticated roles, timed shared intro, hospital map, fractional server movement, no client teleport, monster POV, disguise and troll cooldown");
