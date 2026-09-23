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
const move = (code, input) => ({ type: "move", code, move: input });

// The host picks the creature; the invite makes the guest the visitor.
const created = await call({ type: "create", side: "monster", name: "Андрей" });
assert.equal(created.status, 201);
const { code, token: monsterToken, invite } = created.data;
assert.equal(created.data.side, "monster");
assert.match(code, /^[A-Z0-9]{7}$/);
assert.equal((await read(code)).status, 403);
const peek = await call({ type: "peek", code, invite });
assert.equal(peek.status, 200);
assert.deepEqual({ host: peek.data.host, side: peek.data.side }, { host: "Андрей", side: "player" });
assert.equal((await call({ type: "join", code, invite: "x".repeat(32) })).status, 400);
const joined = await call({ type: "join", code, invite, name: "Макс" });
assert.equal(joined.status, 200);
assert.equal(joined.data.side, "player");
const playerToken = joined.data.token;
assert.equal((await call({ type: "join", code, invite })).status, 400);
assert.equal((await read(code, "not-a-token")).status, 403);

const playerIntro = (await read(code, playerToken)).data.game;
const monsterIntro = (await read(code, monsterToken)).data.game;
assert.equal(playerIntro.phase, "intro");
assert.equal(playerIntro.side, "player");
assert.equal(monsterIntro.side, "monster");
assert.equal(playerIntro.hostSide, "monster");
assert.deepEqual(playerIntro.names, { monster: "Андрей", player: "Макс" });
assert.equal(playerIntro.total, 4);
assert.equal("map" in playerIntro, false, "the map ships with the client, not every poll");
assert.equal("spectate" in playerIntro, false);
assert.ok(monsterIntro.spectate);
assert.ok(playerIntro.rival, "the companion is visible during the arrival");
assert.equal(playerIntro.rival.disguised, true);
assert.deepEqual({ x: playerIntro.self.x, y: playerIntro.self.y }, { x: 21, y: 31 });
assert.equal((await call(action(code, "disguise"), playerToken)).status, 400);
assert.equal((await call(action(code, "whisper"), monsterToken)).status, 400, "tricks wait for the separation");

// Nobody leaves the car during the first five seconds.
const seated = await call(move(code, { x: 21, y: 30.6, yaw: -Math.PI / 2, pitch: 3, seq: 1 }), playerToken);
assert.equal(seated.status, 200);
assert.equal(seated.data.game.self.y, 31);
assert.equal(seated.data.game.self.pitch, 1.5);

await sleep(Math.max(0, playerIntro.startedAt + 5300 - Date.now()));
await call(move(code, { x: 21, y: 31, seq: 2 }), playerToken);
await sleep(400);
const walked = await call(move(code, { x: 21, y: 30.4, yaw: -Math.PI / 2, pitch: 0, seq: 3 }), playerToken);
assert.equal(walked.status, 200);
assert.ok(Math.abs(walked.data.game.self.y - 30.4) < .01, "a plausible step is accepted as sent");
assert.equal(walked.data.game.self.seq, 3);
const teleport = await call(move(code, { x: 22, y: 20, seq: 4 }), playerToken);
assert.ok(Math.abs(teleport.data.game.self.y - 30.4) < .01, "an implausible jump is ignored");
const burst = await call(move(code, { x: 17, y: 30.4, seq: 5 }), playerToken);
const moved = 21 - burst.data.game.self.x;
assert.ok(moved > 0 && moved < 2.2, `movement is limited by the allowance (moved ${moved.toFixed(2)} of 4)`);
await sleep(700);
const wall = await call(move(code, { x: burst.data.game.self.x, y: 28, seq: 6 }), playerToken);
assert.ok(wall.data.game.self.y >= 28.72, `walls stop the body (y ${wall.data.game.self.y.toFixed(2)})`);

await sleep(Math.max(0, playerIntro.introEndsAt - Date.now() + 150));
const afterIntro = (await read(code, playerToken)).data.game;
assert.equal(afterIntro.phase, "playing");
assert.deepEqual({ x: afterIntro.self.x, y: afterIntro.self.y }, { x: 22, y: 25 });
assert.ok(afterIntro.self.warp > walked.data.game.self.warp, "the separation is a teleport");
assert.equal(afterIntro.rival, null, "the creature vanishes after the lights go out");
const monsterPlaying = (await read(code, monsterToken)).data.game;
assert.deepEqual({ x: monsterPlaying.self.x, y: monsterPlaying.self.y }, { x: 5, y: 5 });
assert.equal(monsterPlaying.clues.length, 4);

// Both sides moving at once never conflicts.
const w = afterIntro.self.warp, mw = monsterPlaying.self.warp;
const [a, b] = await Promise.all([
  call(move(code, { x: 22, y: 24.8, yaw: Math.PI / 2, seq: 10, warp: w }), playerToken),
  call(move(code, { x: 5, y: 5.2, yaw: Math.PI / 2, seq: 10, warp: mw }), monsterToken),
]);
assert.equal(a.status, 200); assert.equal(b.status, 200);

const radio = await call(action(code, "radio", { text: "Я нашёл выход, иди в морг" }), monsterToken);
assert.equal(radio.status, 200, JSON.stringify(radio.data));
assert.ok((await read(code, playerToken)).data.game.events.some(e => e.type === "radio" && e.text === "Я нашёл выход, иди в морг"));
assert.equal((await call(action(code, "radio", { text: "ещё" }), monsterToken)).status, 400, "cooldown");
const writing = await call(action(code, "write", { text: "обернись" }), monsterToken);
assert.equal(writing.status, 200, JSON.stringify(writing.data));
assert.equal(writing.data.game.writings[0].text, "ОБЕРНИСЬ");
assert.equal((await call(action(code, "interact"), playerToken)).status, 400, "nothing to use in the middle of the lobby");
const flare = await call(action(code, "flare"), playerToken);
assert.equal(flare.status, 200);
assert.equal(flare.data.game.self.flares, 2);

await sleep(Math.max(0, monsterPlaying.self.formReadyAt - Date.now() + 100));
const revealed = await call(action(code, "disguise"), monsterToken);
assert.equal(revealed.status, 200, JSON.stringify(revealed.data));
assert.equal(revealed.data.game.self.disguised, false);
assert.equal((await call(action(code, "disguise"), monsterToken)).status, 400, "the form needs time to settle");

console.log("PASS: host picks creature, neutral invite, arrival lock, allowance-limited client movement, walls, separation teleport, contention-free moves, radio, blood writing, flare, reveal cooldown");
