import { env } from "cloudflare:workers";
import { act, cleanName, makeGame, move, other, start, tick, view, type Game, type PoseState, type Side } from "../../../lib/game";

export const dynamic = "force-dynamic";

type Row = {
  code: string; host_hash: string; invite_hash: string; guest_hash: string | null;
  state: string; player_pose: string | null; monster_pose: string | null;
  version: number; host_seen: number; guest_seen: number | null;
};
type Seat = { row: Row; game: Game; side: Side; role: "host" | "guest" };

const COLUMNS = "code,host_hash,invite_hash,guest_hash,state,player_pose,monster_pose,version,host_seen,guest_seen";
const TOKEN = /^[A-Za-z0-9_-]{25,100}$/;
const CODE = /^[A-Z0-9]{6,8}$/;

function db() {
  if (!env.DB) throw new Error("База комнат временно недоступна.");
  return env.DB;
}
let schemaReady: Promise<void> | undefined;
function ensureSchema() {
  schemaReady ??= (async () => {
    const existing = await db().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hospital_rooms'").first();
    if (existing) return;
    await db().prepare(`CREATE TABLE IF NOT EXISTS hospital_rooms (
      code TEXT PRIMARY KEY NOT NULL,
      host_hash TEXT NOT NULL,
      invite_hash TEXT NOT NULL,
      guest_hash TEXT,
      state TEXT NOT NULL,
      player_pose TEXT,
      monster_pose TEXT,
      version INTEGER DEFAULT 0 NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      host_seen INTEGER NOT NULL,
      guest_seen INTEGER
    )`).run();
  })().catch(error => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}
function fail(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Ошибка комнаты.";
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
function random(bytes = 24) {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
async function hash(s: string) {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(data), x => x.toString(16).padStart(2, "0")).join("");
}
function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(7); crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
}
async function load(code: string) {
  return db().prepare(`SELECT ${COLUMNS} FROM hospital_rooms WHERE code=?`).bind(code).first<Row>();
}
function hydrate(r: Row): Game {
  const g = JSON.parse(r.state) as Game;
  if (r.player_pose) g.pose.player = JSON.parse(r.player_pose) as PoseState;
  if (r.monster_pose) g.pose.monster = JSON.parse(r.monster_pose) as PoseState;
  return g;
}
async function authorize(request: Request, code: string): Promise<Seat> {
  if (!CODE.test(code)) throw new Error("Неверный код комнаты.");
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!TOKEN.test(token)) throw new Error("Сохранённый доступ не найден. Откройте своё приглашение.");
  const r = await load(code);
  if (!r) throw new Error("Комната не найдена.");
  const digest = await hash(token);
  const role = digest === r.host_hash ? "host" : digest === r.guest_hash ? "guest" : null;
  if (!role) throw new Error("Нет доступа к этой роли.");
  const game = hydrate(r);
  return { row: r, game, role, side: role === "host" ? game.hostSide : other(game.hostSide) };
}
function connected(seat: Seat, now: number) {
  const seen = seat.role === "host" ? seat.row.guest_seen : seat.row.host_seen;
  return !!seen && now - seen < 8000;
}
async function saveAll(code: string, g: Game, version: number, now: number) {
  const { pose, ...rest } = g;
  const state = JSON.stringify({ ...rest, pose });
  const result = await db().prepare("UPDATE hospital_rooms SET state=?,player_pose=?,monster_pose=?,version=version+1,updated_at=? WHERE code=? AND version=?")
    .bind(state, JSON.stringify(pose.player), JSON.stringify(pose.monster), now, code, version).run();
  return result.meta.changes === 1;
}

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const code = new URL(request.url).searchParams.get("code")?.toUpperCase() ?? "";
    const seat = await authorize(request, code);
    const now = Date.now();
    const field = seat.role === "host" ? "host_seen" : "guest_seen";
    const lastSeen = seat.role === "host" ? seat.row.host_seen : seat.row.guest_seen;
    // Fast state reads should not turn into a D1 write on every poll.
    if (!lastSeen || now - lastSeen >= 4000) {
      await db().prepare(`UPDATE hospital_rooms SET ${field}=? WHERE code=?`).bind(now, code).run();
    }
    tick(seat.game, now);
    return Response.json({ game: view(seat.game, seat.side, now, connected(seat, now), seat.row.version) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error, 403); }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = await request.json() as Record<string, unknown>;
    const type = body.type;
    if (type === "create") {
      const now = Date.now();
      const hostSide: Side = body.side === "player" ? "player" : "monster";
      const name = cleanName(body.name, hostSide === "monster" ? "Друг" : "Гость");
      const names = hostSide === "monster" ? { monster: name, player: "Гость" } : { player: name, monster: "Друг" };
      const hostToken = random(), invite = random();
      const g = makeGame(hostSide, names, 1, now);
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = roomCode();
        const { pose, ...rest } = g;
        const result = await db().prepare(`INSERT OR IGNORE INTO hospital_rooms (code,host_hash,invite_hash,guest_hash,state,player_pose,monster_pose,version,created_at,updated_at,host_seen,guest_seen) VALUES (?,?,?,NULL,?,?,?,0,?,?,?,NULL)`)
          .bind(code, await hash(hostToken), await hash(invite), JSON.stringify({ ...rest, pose }), JSON.stringify(pose.player), JSON.stringify(pose.monster), now, now, now).run();
        if (result.meta.changes === 1) return Response.json({ code, token: hostToken, invite, side: hostSide }, { status: 201 });
      }
      throw new Error("Не удалось выделить комнату. Попробуйте снова.");
    }
    if (type === "peek" || type === "join") {
      const code = String(body.code ?? "").trim().toUpperCase();
      const invite = String(body.invite ?? "");
      if (!CODE.test(code) || !TOKEN.test(invite)) throw new Error("Приглашение повреждено. Попросите новую ссылку.");
      const r = await load(code);
      if (!r) throw new Error("Комната не найдена или уже закрыта.");
      if (await hash(invite) !== r.invite_hash) throw new Error("Приглашение не подходит к этой комнате.");
      if (r.guest_hash) throw new Error("В эту комнату уже вошли. Вернуться можно из того же браузера.");
      const g = hydrate(r);
      const guestSide = other(g.hostSide);
      if (type === "peek") return Response.json({ code, host: g.names[g.hostSide], side: guestSide });
      const token = random(), now = Date.now();
      g.names[guestSide] = cleanName(body.name, guestSide === "player" ? "Гость" : "Друг");
      start(g, now);
      const { pose, ...rest } = g;
      const result = await db().prepare("UPDATE hospital_rooms SET guest_hash=?,state=?,player_pose=?,monster_pose=?,version=version+1,updated_at=?,guest_seen=? WHERE code=? AND version=? AND guest_hash IS NULL")
        .bind(await hash(token), JSON.stringify({ ...rest, pose }), JSON.stringify(pose.player), JSON.stringify(pose.monster), now, now, code, r.version).run();
      if (result.meta.changes !== 1) throw new Error("Комнату заняли одновременно. Обновите страницу.");
      return Response.json({ code, token, side: guestSide });
    }
    const code = String(body.code ?? "").trim().toUpperCase();
    if (type === "move") {
      const input = body.move;
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Неизвестное движение.");
      for (let attempt = 0; attempt < 5; attempt++) {
        const seat = await authorize(request, code);
        const now = Date.now();
        const g = seat.game;
        const dirty = tick(g, now);
        const changed = move(g, seat.side, input as Record<string, unknown>, now);
        let ok: boolean;
        let version = seat.row.version;
        if (dirty || changed) {
          ok = await saveAll(code, g, version, now);
          version++;
        } else {
          // Pose-only write: never bumps the version, so both players can move freely.
          const column = seat.side === "player" ? "player_pose" : "monster_pose";
          const seen = seat.role === "host" ? "host_seen" : "guest_seen";
          const result = await db().prepare(`UPDATE hospital_rooms SET ${column}=?,${seen}=? WHERE code=? AND version=?`)
            .bind(JSON.stringify(g.pose[seat.side]), now, code, version).run();
          ok = result.meta.changes === 1;
        }
        if (ok) return Response.json({ game: view(g, seat.side, now, true, version) }, { headers: { "Cache-Control": "no-store" } });
      }
      throw new Error("Сервер перегружен. Повторите движение.");
    }
    if (type === "action") {
      const action = body.action;
      if (!action || typeof action !== "object" || Array.isArray(action)) throw new Error("Неизвестное действие.");
      for (let attempt = 0; attempt < 5; attempt++) {
        const seat = await authorize(request, code);
        const now = Date.now();
        const { game } = act(seat.game, seat.side, action as Record<string, unknown>, now);
        const side = seat.role === "host" ? game.hostSide : other(game.hostSide);
        if (await saveAll(code, game, seat.row.version, now)) {
          return Response.json({ game: view(game, side, now, true, seat.row.version + 1) }, { headers: { "Cache-Control": "no-store" } });
        }
      }
      throw new Error("Слишком много одновременных ходов. Повторите действие.");
    }
    throw new Error("Неизвестный запрос.");
  } catch (error) { return fail(error); }
}
