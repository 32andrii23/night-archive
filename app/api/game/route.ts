import { env } from "cloudflare:workers";
import { act, makeGame, start, tick, view, type Game, type Side } from "../../../lib/game";

export const dynamic = "force-dynamic";

type Row = {
  code: string; player_hash: string; monster_invite_hash: string; monster_hash: string | null;
  state: string; version: number; player_seen: number; monster_seen: number | null;
};

function db() {
  if (!env.DB) throw new Error("База комнат временно недоступна.");
  return env.DB;
}
function fail(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Ошибка комнаты.";
  return Response.json({ error: message }, { status });
}
function random(bytes = 24) {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
async function hash(s: string) {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(data), x => x.toString(16).padStart(2, "0")).join("");
}
function code() { const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const bytes = new Uint8Array(7); crypto.getRandomValues(bytes); return Array.from(bytes, b => alphabet[b % alphabet.length]).join(""); }
async function row(codeValue: string) {
  return db().prepare("SELECT code,player_hash,monster_invite_hash,monster_hash,state,version,player_seen,monster_seen FROM rooms WHERE code=?")
    .bind(codeValue).first<Row>();
}
async function authorize(request: Request, codeValue: string): Promise<{ row: Row; side: Side }> {
  if (!/^[A-Z0-9]{6,8}$/.test(codeValue)) throw new Error("Неверный код комнаты.");
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!/^[A-Za-z0-9_-]{25,100}$/.test(token)) throw new Error("Сохранённый доступ не найден. Откройте своё приглашение.");
  const r = await row(codeValue);
  if (!r) throw new Error("Комната не найдена.");
  const digest = await hash(token);
  const side: Side = digest === r.player_hash ? "player" : digest === r.monster_hash ? "monster" : (() => { throw new Error("Нет доступа к этой роли."); })();
  return { row: r, side };
}

export async function GET(request: Request) {
  try {
    const codeValue = new URL(request.url).searchParams.get("code")?.toUpperCase() ?? "";
    const { row: r, side } = await authorize(request, codeValue);
    const now = Date.now();
    const field = side === "player" ? "player_seen" : "monster_seen";
    await db().prepare(`UPDATE rooms SET ${field}=? WHERE code=?`).bind(now, codeValue).run();
    const g = JSON.parse(r.state) as Game;
    tick(g, now);
    const otherSeen = side === "player" ? r.monster_seen : r.player_seen;
    return Response.json({ game: view(g, side, now, !!otherSeen && now - otherSeen < 8000, r.version) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error, 403); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const type = body.type;
    if (type === "create") {
      const now = Date.now();
      const playerToken = random();
      const monsterInvite = random();
      const playerHash = await hash(playerToken), inviteHash = await hash(monsterInvite);
      for (let attempt = 0; attempt < 5; attempt++) {
        const roomCode = code();
        const result = await db().prepare("INSERT OR IGNORE INTO rooms (code,player_hash,monster_invite_hash,monster_hash,state,version,created_at,updated_at,player_seen,monster_seen) VALUES (?,?,?,?,?,0,?,?,?,NULL)")
          .bind(roomCode, playerHash, inviteHash, null, JSON.stringify(makeGame(1, now)), now, now, now).run();
        if (result.meta.changes === 1) return Response.json({ code: roomCode, token: playerToken, monsterInvite }, { status: 201 });
      }
      throw new Error("Не удалось выделить комнату. Попробуйте снова.");
    }
    if (type === "join") {
      const roomCode = String(body.code ?? "").trim().toUpperCase();
      const invite = String(body.invite ?? "");
      if (!/^[A-Z0-9]{6,8}$/.test(roomCode) || !/^[A-Za-z0-9_-]{25,100}$/.test(invite)) throw new Error("Проверьте код и приглашение.");
      const r = await row(roomCode);
      if (!r) throw new Error("Комната не найдена.");
      if (r.monster_hash) throw new Error("Роль архивариуса уже занята. Для возвращения откройте этот браузер.");
      if (await hash(invite) !== r.monster_invite_hash) throw new Error("Приглашение архивариуса не подходит к комнате.");
      const token = random(), now = Date.now();
      const g = JSON.parse(r.state) as Game;
      start(g, now);
      const result = await db().prepare("UPDATE rooms SET monster_hash=?,state=?,version=version+1,updated_at=?,monster_seen=? WHERE code=? AND version=? AND monster_hash IS NULL")
        .bind(await hash(token), JSON.stringify(g), now, now, roomCode, r.version).run();
      if (result.meta.changes !== 1) throw new Error("Комнату заняли одновременно. Обновите страницу.");
      return Response.json({ code: roomCode, token });
    }
    if (type === "action") {
      const roomCode = String(body.code ?? "").trim().toUpperCase();
      const action = body.action;
      if (!action || typeof action !== "object" || Array.isArray(action)) throw new Error("Неизвестное действие.");
      for (let attempt = 0; attempt < 5; attempt++) {
        const { row: r, side } = await authorize(request, roomCode);
        const now = Date.now();
        const g = act(JSON.parse(r.state) as Game, side, action as Record<string, unknown>, now);
        const result = await db().prepare("UPDATE rooms SET state=?,version=version+1,updated_at=? WHERE code=? AND version=?")
          .bind(JSON.stringify(g), now, roomCode, r.version).run();
        if (result.meta.changes === 1) return Response.json({ game: view(g, side, now, true, r.version + 1) });
      }
      throw new Error("Слишком много одновременных ходов. Повторите действие.");
    }
    throw new Error("Неизвестный запрос.");
  } catch (error) { return fail(error); }
}
