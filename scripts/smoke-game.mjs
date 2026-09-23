import assert from "node:assert/strict";

const origin = process.env.GAME_ORIGIN ?? "http://localhost:5173";
async function call(body, token) {
  const response = await fetch(`${origin}/api/game`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
async function read(code, token) {
  const response = await fetch(`${origin}/api/game?code=${code}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: response.status, data: await response.json() };
}

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
assert.equal((await read(code, playerToken)).data.game.side, "player");
assert.equal((await read(code, monsterToken)).data.game.side, "monster");
assert.equal((await call({ type: "action", code, action: { type: "blackout", zone: 0 } }, playerToken)).status, 400);
assert.equal((await call({ type: "action", code, action: { type: "flare" } }, monsterToken)).status, 400);
const blackout = await call({ type: "action", code, action: { type: "blackout", zone: 0 } }, monsterToken);
assert.equal(blackout.status, 200);
assert.equal(blackout.data.game.self.energy, 72);
assert.equal((await call({ type: "action", code, action: { type: "blackout", zone: 1 } }, monsterToken)).status, 400);
const player = await read(code, playerToken);
assert.ok(player.data.game.lightsUntil[0] > Date.now());
assert.equal(player.data.game.rival, null);
console.log("PASS: two seats, authentication, role isolation, shared D1 state, cooldown, reconnect read");
