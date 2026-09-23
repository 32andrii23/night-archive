"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FirstPerson from "./first-person";

type Pt = { x: number; y: number };
type Ev = Pt & { id: string; type: string; at: number; until: number; variant?: number };
type View = {
  phase: "waiting" | "playing" | "ended"; side: "player" | "monster"; round: number; now: number; endsAt: number;
  winner: "player" | "monster" | null; reason: string; map: string[]; power: boolean; found: number;
  switch: Pt; exit: Pt; lockers: Pt[]; cameras: Pt[]; lightsUntil: number[]; lockUntil: number;
  events: Ev[]; votes: { player: boolean; monster: boolean }; otherConnected: boolean;
  self: Pt & { hidden?: boolean; flares?: number; energy?: number; stunnedUntil?: number };
  rival: Pt | null; fuses: Array<{ x: number | null; y: number | null; found: boolean }>;
  flareReadyAt?: number; cooldowns?: Record<string, number>; cameraSignals?: boolean[];
};
const API = "/api/game", W = 19, H = 13;
const sectors = ["ЗАПАД", "ЦЕНТР", "ВОСТОК"];
const scareWords = ["НЕ СМОТРИ НАЗАД", "ОН УЖЕ РЯДОМ", "АРХИВ ПОМНИТ"];
const distance = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const clockText = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const message = (e: unknown) => e instanceof Error ? e.message : "Связь с архивом прервана.";
const storageKey = (room: string) => `night-archive:${room}`;

function useSound() {
  const ctx = useRef<AudioContext | null>(null);
  const [muted, setMuted] = useState(false), [volume, setVolume] = useState(.42);
  const unlock = useCallback(() => { if (!ctx.current) ctx.current = new AudioContext(); void ctx.current.resume(); }, []);
  const play = useCallback((type: string, pan: number) => {
    if (!ctx.current || muted || volume === 0) return;
    const c = ctx.current, t = c.currentTime, gain = c.createGain(), stereo = c.createStereoPanner(), osc = c.createOscillator();
    const freq: Record<string, number> = { step: 82, heavy: 55, knock: 140, blackout: 47, lock: 105, scare: 73, caught: 42, fuse: 620, power: 310, flare: 890, escape: 520, search: 76, start: 80 };
    const f = freq[type] ?? 110, long = type === "scare" || type === "caught";
    osc.type = ["fuse", "power", "flare", "escape"].includes(type) ? "sine" : "sawtooth";
    osc.frequency.setValueAtTime(f, t); if (long) osc.frequency.exponentialRampToValueAtTime(f * 2.4, t + .4);
    gain.gain.setValueAtTime(.0001, t); gain.gain.exponentialRampToValueAtTime(Math.max(.001, volume * .15), t + .02); gain.gain.exponentialRampToValueAtTime(.0001, t + (long ? .75 : .3));
    stereo.pan.value = Math.max(-1, Math.min(1, pan)); osc.connect(gain); gain.connect(stereo); stereo.connect(c.destination); osc.start(t); osc.stop(t + (long ? .78 : .32));
  }, [muted, volume]);
  return useMemo(() => ({ unlock, play, muted, setMuted, volume, setVolume }), [unlock, play, muted, volume]);
}

function route(map: string[], from: Pt, to: Pt) {
  const key = (p: Pt) => `${p.x},${p.y}`, q = [from], seen = new Map<string, Pt | null>([[key(from), null]]);
  for (let i = 0; i < q.length; i++) {
    const p = q[i]; if (key(p) === key(to)) break;
    for (const d of [[1,0],[-1,0],[0,1],[0,-1]]) { const n = { x: p.x + d[0], y: p.y + d[1] };
      if (map[n.y]?.[n.x] === "." && !seen.has(key(n))) { seen.set(key(n), p); q.push(n); }
    }
  }
  if (!seen.has(key(to))) return [];
  const out: Pt[] = []; let p: Pt | null = to;
  while (p && key(p) !== key(from)) { out.unshift(p); p = seen.get(key(p)) ?? null; }
  return out;
}

function draw(ctx: CanvasRenderingContext2D, v: View, t: number, reduced: boolean) {
  const cw = ctx.canvas.width / W, ch = ctx.canvas.height / H, dark = v.side === "player";
  ctx.fillStyle = "#0c1316"; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const px = x * cw, py = y * ch, wall = v.map[y]?.[x] === "#", grain = ((x * 73 + y * 41 + x * y * 7) % 13) / 13;
    ctx.fillStyle = wall ? x % 2 ? "#28302f" : "#222a2b" : grain > .5 ? "#26302e" : "#222b2a"; ctx.fillRect(px, py, cw, ch);
    if (wall) { ctx.fillStyle = "#414a42"; ctx.fillRect(px + 1, py + 1, cw - 2, 2); ctx.fillStyle = "#172022"; ctx.fillRect(px + cw - 3, py + 3, 2, ch - 3); }
    else { ctx.strokeStyle = "rgba(180,160,120,.06)"; ctx.strokeRect(px + .5, py + .5, cw - 1, ch - 1); ctx.fillStyle = "rgba(196,187,152,.06)"; ctx.fillRect(px + 3 + grain * 5, py + 7, cw * .35, 1); }
  }
  const mark = (p: Pt, color: string, label = "", square = false) => {
    const x = (p.x + .5) * cw, y = (p.y + .5) * ch;
    ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 11; ctx.fillStyle = color;
    if (square) ctx.fillRect(x - cw * .18, y - ch * .18, cw * .36, ch * .36);
    else { ctx.beginPath(); ctx.arc(x, y, Math.min(cw, ch) * .19, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore(); if (label) { ctx.font = `bold ${Math.max(9, ch * .25)}px ui-monospace`; ctx.textAlign = "center"; ctx.fillStyle = "#e6e3d2"; ctx.fillText(label, x, y - ch * .27); }
  };
  v.cameras.forEach((p, i) => mark(p, v.cameraSignals?.[i] ? "#d9be7b" : "#607e83", "", true));
  v.lockers.forEach(p => mark(p, "#68786a", "", true));
  v.fuses.forEach(f => { if (!f.found && f.x !== null && f.y !== null) mark(f as Pt, "#edc775", "П", true); });
  mark(v.switch, v.power ? "#83bea7" : "#9d825a", "РУБ", true);
  mark(v.exit, v.power ? "#a8cdb8" : "#8b6159", "ВЫХ", true);
  for (const e of v.events) if (["knock", "flare", "blackout"].includes(e.type)) {
    const alpha = Math.max(0, Math.min(1, (e.until - Date.now()) / (e.until - e.at)));
    ctx.strokeStyle = e.type === "flare" ? `rgba(235,226,176,${alpha})` : `rgba(185,80,70,${alpha * .8})`;
    ctx.lineWidth = 2; ctx.beginPath(); ctx.arc((e.x + .5) * cw, (e.y + .5) * ch, Math.min(cw, ch) * (1.1 - alpha * .7), 0, Math.PI * 2); ctx.stroke();
  }
  if (v.rival) mark(v.rival, dark ? "#bf4d3f" : "#e5d9a5", dark ? "" : "ЦЕЛЬ");
  mark(v.self, dark ? "#d8d3af" : "#bc5145", v.self.hidden ? "УКР" : "");
  if (dark) {
    const sx = (v.self.x + .5) * cw, sy = (v.self.y + .5) * ch, black = v.lightsUntil[v.self.x < 7 ? 0 : v.self.x < 13 ? 1 : 2] > v.now;
    const radius = Math.min(cw, ch) * (black ? 2.6 : 4.4) + (reduced ? 0 : Math.sin(t / 450) * 3);
    const grad = ctx.createRadialGradient(sx, sy, Math.min(cw, ch) * .65, sx, sy, radius);
    grad.addColorStop(0, "rgba(2,8,10,0)"); grad.addColorStop(.35, "rgba(2,8,10,.22)"); grad.addColorStop(1, "rgba(2,8,10,.92)");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (black) { ctx.fillStyle = "rgba(4,9,11,.16)"; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); }
    mark(v.self, "#f2e7b8", v.self.hidden ? "УКР" : "");
    if (v.rival && distance(v.self, v.rival) <= 2) mark(v.rival, "#d4564b");
  }
  ctx.strokeStyle = "#8a8061"; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, ctx.canvas.width - 3, ctx.canvas.height - 3);
}

function Board({ game, onCell, reduced }: { game: View; onCell: (p: Pt) => void; reduced: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const c = canvas.current?.getContext("2d", { alpha: false }); if (!c) return; let frame = 0;
    const render = (t: number) => { draw(c, game, t, reduced); frame = requestAnimationFrame(render); };
    frame = requestAnimationFrame(render); return () => cancelAnimationFrame(frame);
  }, [game, reduced]);
  return <canvas ref={canvas} className="board" width={950} height={650} role="img" aria-label="Карта ночного архива"
    onClick={e => { const r = e.currentTarget.getBoundingClientRect(); onCell({ x: Math.floor((e.clientX - r.left) / r.width * W), y: Math.floor((e.clientY - r.top) / r.height * H) }); }} />;
}

export default function Home() {
  const [game, setGame] = useState<View | null>(null), [code, setCode] = useState(""), [token, setToken] = useState("");
  const [monsterInvite, setMonsterInvite] = useState(""), [showMonster, setShowMonster] = useState(false);
  const [joinCode, setJoinCode] = useState(""), [joinInvite, setJoinInvite] = useState("");
  const [error, setError] = useState(""), [note, setNote] = useState(""), [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(0), [reduced, setReduced] = useState(false), [tool, setTool] = useState<"walk" | "knock">("walk"), [plan, setPlan] = useState(false);
  const sound = useSound(), gameRef = useRef<View | null>(null), tokenRef = useRef(""), codeRef = useRef("");
  const yaw = useRef(0);
  const sending = useRef(false), seen = useRef(new Set<string>()), queue = useRef<Pt[]>([]);
  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => { tokenRef.current = token; codeRef.current = code; }, [token, code]);
  const request = useCallback(async (body?: Record<string, unknown>, auth = tokenRef.current, room = codeRef.current) => {
    const response = await fetch(body ? API : `${API}?code=${encodeURIComponent(room)}`, { method: body ? "POST" : "GET",
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    const data = await response.json() as { game: View; code: string; token: string; monsterInvite: string; error?: string };
    if (!response.ok) throw new Error(data.error || "Архив не отвечает."); return data;
  }, []);
  const accept = useCallback((v: View) => {
    for (const e of v.events) if (!seen.current.has(e.id)) { seen.current.add(e.id);
      if (gameRef.current) { if ((v.side === "player" || e.type !== "step") && !(reduced && ["scare", "caught"].includes(e.type))) sound.play(e.type, (e.x - v.self.x) / 6);
        if (["scare", "caught"].includes(e.type) && v.side === "player") setNote(scareWords[e.variant ?? 0]); }
    }
    if (seen.current.size > 200) seen.current = new Set(v.events.map(e => e.id));
    gameRef.current = v; setGame(v);
  }, [sound, reduced]);
  useEffect(() => { let active = true;
    queueMicrotask(() => { if (!active) return;
      const url = new URL(location.href), monster = url.searchParams.get("monster");
      if (monster) { const dot = monster.indexOf("."); if (dot > 0) { setShowMonster(true); setJoinCode(monster.slice(0, dot)); setJoinInvite(monster.slice(dot + 1)); } history.replaceState(null, "", url.pathname); }
      const resume = !monster && (url.searchParams.get("room") || localStorage.getItem("night-archive:latest"));
      if (resume) { const saved = localStorage.getItem(storageKey(resume)); if (saved) { setCode(resume); setToken(saved); setMonsterInvite(localStorage.getItem(`night-archive:invite:${resume}`) ?? ""); codeRef.current = resume; tokenRef.current = saved; } }
      setReduced(matchMedia("(prefers-reduced-motion: reduce)").matches);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => { if (!code || !token) return; let active = true;
    const poll = async () => { try { const data = await request(undefined, token, code); if (active) accept(data.game); } catch (e) { if (active) setError(message(e)); } };
    void poll(); const id = setInterval(poll, 900); return () => { active = false; clearInterval(id); };
  }, [code, token, request, accept]);
  useEffect(() => { const tick = () => setClock(Date.now()); const id = setInterval(tick, 250); tick(); return () => clearInterval(id); }, []);
  useEffect(() => { if (!note) return; const id = setTimeout(() => setNote(""), reduced ? 1100 : 2400); return () => clearTimeout(id); }, [note, reduced]);
  useEffect(() => { if (!error) return; const id = setTimeout(() => setError(""), 4500); return () => clearTimeout(id); }, [error]);
  const enter = useCallback((room: string, seat: string) => { localStorage.setItem(storageKey(room), seat); localStorage.setItem("night-archive:latest", room);
    codeRef.current = room; tokenRef.current = seat; setCode(room); setToken(seat); setError(""); setShowMonster(false); setPlan(false);
    history.replaceState(null, "", `${location.pathname}?room=${encodeURIComponent(room)}`);
  }, []);
  const create = useCallback(async () => { sound.unlock(); setBusy(true); setError(""); try { const d = await request({ type: "create" }, "", ""); localStorage.setItem(`night-archive:invite:${d.code}`, d.monsterInvite); setMonsterInvite(d.monsterInvite); enter(d.code, d.token); } catch (e) { setError(message(e)); } finally { setBusy(false); } }, [request, enter, sound]);
  const join = useCallback(async () => { sound.unlock(); setBusy(true); setError(""); try { const d = await request({ type: "join", code: joinCode.trim().toUpperCase(), invite: joinInvite.trim() }, "", ""); enter(d.code, d.token); } catch (e) { setError(message(e)); } finally { setBusy(false); } }, [request, joinCode, joinInvite, enter, sound]);
  const action = useCallback(async (a: Record<string, unknown>, quiet = false) => { if (!codeRef.current || sending.current) return false; sending.current = true; sound.unlock();
    try { const d = await request({ type: "action", code: codeRef.current, action: a }); accept(d.game); if (!quiet) setError(""); return true; }
    catch (e) { if (!quiet || !["Слишком быстро.", "Здесь стена."].includes(message(e))) setError(message(e)); return false; }
    finally { sending.current = false; }
  }, [request, accept, sound]);
  const move = useCallback((dx: number, dy: number) => { queue.current = []; void action({ type: "move", dx, dy }, true); }, [action]);
  const relativeMove = useCallback((offset: number) => { const a = yaw.current + offset, x = Math.cos(a), y = Math.sin(a);
    move(Math.abs(x) >= Math.abs(y) ? Math.sign(x) : 0, Math.abs(y) > Math.abs(x) ? Math.sign(y) : 0);
  }, [move]);
  useEffect(() => { const key = (e: KeyboardEvent) => { const g = gameRef.current; if (!g || g.phase !== "playing" || e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase(), dirs: Record<string, [number, number]> = { w: [0,-1], arrowup: [0,-1], s: [0,1], arrowdown: [0,1], a: [-1,0], arrowleft: [-1,0], d: [1,0], arrowright: [1,0] };
      if (g.side === "player" && ["arrowleft", "arrowright", "q", "r"].includes(k)) { e.preventDefault(); yaw.current += (k === "arrowleft" || k === "q" ? -1 : 1) * .18; }
      else if (g.side === "player" && ["w", "arrowup", "s", "arrowdown", "a", "d"].includes(k)) { e.preventDefault(); const offsets: Record<string, number> = { w: 0, arrowup: 0, s: Math.PI, arrowdown: Math.PI, a: -Math.PI / 2, d: Math.PI / 2 }; relativeMove(offsets[k]); }
      else if (dirs[k]) { e.preventDefault(); move(...dirs[k]); }
      else if (k === "e" && !e.repeat) { e.preventDefault(); void action({ type: g.side === "player" ? "interact" : "search" }); }
      else if (k === "f" && g.side === "player" && !e.repeat) { e.preventDefault(); void action({ type: "flare" }); }
      else if (g.side === "monster" && ["1", "2", "3"].includes(k) && !e.repeat) { e.preventDefault(); void action({ type: "blackout", zone: Number(k) - 1 }); }
      else if (g.side === "monster" && k === "4" && !e.repeat) { e.preventDefault(); void action({ type: "lock" }); }
      else if (g.side === "monster" && k === "5" && !e.repeat) { e.preventDefault(); void action({ type: "scare" }); }
      else if (g.side === "player" && k === "m" && !e.repeat) { e.preventDefault(); setPlan(p => !p); }
    }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [move, relativeMove, action]);
  const onCell = useCallback((p: Pt) => { const g = gameRef.current; if (!g || g.phase !== "playing" || g.map[p.y]?.[p.x] !== ".") return;
    if (g.side === "monster" && tool === "knock") { void action({ type: "knock", x: p.x, y: p.y }); setTool("walk"); return; }
    if (g.self.hidden) return; queue.current = route(g.map, g.self, p).slice(0, 28);
    const run = async () => { while (queue.current.length) { const cur = gameRef.current?.self, next = queue.current.shift(); if (!cur || !next) break;
        if (!await action({ type: "move", dx: next.x - cur.x, dy: next.y - cur.y }, true)) break;
        await new Promise(r => setTimeout(r, g.side === "player" ? 200 : 330));
      } }; void run();
  }, [action, tool]);
  useEffect(() => {
    type Tool = { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean }; execute: (input: unknown) => Promise<unknown> };
    const context = (document as Document & { modelContext?: { registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Tool) => { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); };
    register({ name: "create_archive_room", title: "Создать комнату", description: "Создать матч за посетителя и получить отдельное приглашение для архивариуса.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false },
      async execute() { const d = await request({ type: "create" }, "", ""); localStorage.setItem(`night-archive:invite:${d.code}`, d.monsterInvite); setMonsterInvite(d.monsterInvite); enter(d.code, d.token);
        return { code: d.code, monsterInviteUrl: `${location.origin}${location.pathname}?monster=${d.code}.${d.monsterInvite}` }; } });
    register({ name: "join_archive_as_monster", title: "Войти архивариусом", description: "Занять роль архивариуса по коду комнаты и личному приглашению.",
      inputSchema: { type: "object", properties: { code: { type: "string" }, invite: { type: "string" } }, required: ["code", "invite"], additionalProperties: false }, annotations: { readOnlyHint: false },
      async execute(input) { const data = input as { code?: string; invite?: string }; if (typeof data?.code !== "string" || typeof data?.invite !== "string") throw new Error("Нужны код и приглашение.");
        const d = await request({ type: "join", code: data.code.toUpperCase(), invite: data.invite }, "", ""); enter(d.code, d.token); return { code: d.code, role: "monster" }; } });
    register({ name: "perform_archive_action", title: "Сделать ход", description: "Выполнить игровое действие текущей роли. Сервер проверяет роль, расстояние, ресурс и время восстановления.",
      inputSchema: { type: "object", properties: { type: { type: "string", enum: ["move", "interact", "flare", "search", "blackout", "knock", "lock", "scare", "rematch"] }, dx: { type: "integer" }, dy: { type: "integer" }, zone: { type: "integer" }, x: { type: "integer" }, y: { type: "integer" } }, required: ["type"], additionalProperties: false }, annotations: { readOnlyHint: false },
      async execute(input) { const a = input as Record<string, unknown>; if (!a || typeof a.type !== "string") throw new Error("Нужен тип действия.");
        if (!codeRef.current || !tokenRef.current) throw new Error("Сначала войдите в комнату.");
        const d = await request({ type: "action", code: codeRef.current, action: a }); accept(d.game); return { phase: d.game.phase, found: d.game.found, winner: d.game.winner, position: d.game.self }; } });
    return () => lifecycle.abort();
  }, [request, accept, enter]);
  const copy = async (value: string, text: string) => { try { await navigator.clipboard.writeText(value); setNote(text); } catch { setError("Не удалось скопировать. Выделите ссылку вручную."); } };
  const leave = () => { localStorage.removeItem("night-archive:latest"); setGame(null); setCode(""); setToken(""); setMonsterInvite(""); codeRef.current = ""; tokenRef.current = ""; seen.current.clear(); history.replaceState(null, "", location.pathname); };
  const inviteLink = monsterInvite && code ? `${typeof location !== "undefined" ? location.origin + location.pathname : ""}?monster=${code}.${monsterInvite}` : "";
  const isMonster = game?.side === "monster", scare = game?.side === "player" && game.events.find(e => ["scare", "caught"].includes(e.type) && e.until > game.now);

  return <main className="shell" onPointerDown={() => sound.unlock()}><div className="grain" aria-hidden="true" />
    {!game && <section className="entry"><div className="entry-mark"><span>Н.А.</span><small>ДЕЛО № 017</small></div>
      <div className="entry-content"><p className="eyebrow">ДУЭЛЬ ДЛЯ ДВОИХ · 4 МИНУТЫ</p><h1>НОЧНОЙ<br /><em>АРХИВ</em></h1>
        <p className="entry-lead">В архиве погас свет. Три предохранителя рассыпаны между стеллажами. За вами наблюдают из комнаты камер.</p>
        {!showMonster ? <div className="entry-actions"><button className="primary" disabled={busy} onClick={create}>Создать комнату <span>↗</span></button><p>Вы станете посетителем. Пригласите второго человека по секретной ссылке.</p></div>
          : <div className="entry-actions join-form"><label>Код комнаты<input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} placeholder="7 СИМВОЛОВ" autoComplete="off" /></label>
            <label>Ключ архивариуса<input value={joinInvite} onChange={e => setJoinInvite(e.target.value)} placeholder="ИЗ ПРИГЛАШЕНИЯ" autoComplete="off" /></label>
            <button className="primary" disabled={busy} onClick={join}>Войти в архив <span>↗</span></button><button className="text-button" onClick={() => setShowMonster(false)}>← Вернуться</button></div>}
      </div><div className="entry-footer"><span>ПОСЕТИТЕЛЬ: НАЙТИ ПИТАНИЕ И ВЫЙТИ</span><span>АРХИВАРИУС: НЕ ВЫПУСТИТЬ</span></div>
      <button className="secret" onClick={() => setShowMonster(true)} aria-label="Вход архивариуса" title="Вход архивариуса">✣</button></section>}
    {game && <section className="game-layout"><header className="topbar"><div className="brand"><span className="brand-mark">Н.А.</span><span>НОЧНОЙ АРХИВ <small>/ ПАРТИЯ {String(game.round).padStart(2, "0")}</small></span></div>
      <div className="top-mid"><span className={game.phase === "playing" ? "live-dot" : ""} /> {game.phase === "waiting" ? "ОЖИДАНИЕ" : game.phase === "ended" ? "ДЕЛО ЗАКРЫТО" : "АРХИВ ЗАПЕРТ"}</div><div className="top-timer">{game.phase === "playing" ? clockText(game.endsAt - clock) : "4:00"}<small>ДО РАССВЕТА</small></div></header>
      <div className="play-columns"><div className="map-column"><div className="map-heading"><div><span className="eyebrow">{isMonster ? "ПЛАН ЗДАНИЯ" : "АРХИВ · КОРИДОРЫ"} · 03:17</span><h2>{isMonster ? "Комната наблюдения" : "Не останавливайтесь"}</h2></div><span className="map-mode">{isMonster ? "АРХИВАРИУС" : "ПОСЕТИТЕЛЬ"}</span></div>
        <div className={`board-wrap ${isMonster ? "" : "player-view"} ${game.phase !== "playing" ? "board-inactive" : ""}`}>{isMonster ? <Board game={game} onCell={onCell} reduced={reduced} /> : <><FirstPerson game={game} yaw={yaw} reduced={reduced} /><div className="view-hud"><span>{game.self.hidden ? "В УКРЫТИИ" : game.lightsUntil[game.self.x < 7 ? 0 : game.self.x < 13 ? 1 : 2] > clock ? "СВЕТ ОТКЛЮЧЁН" : "ФОНАРЬ ВКЛЮЧЁН"}</span><span>НАЖМИТЕ ДЛЯ ОБЗОРА МЫШЬЮ · ESC ОСВОБОДИТ КУРСОР</span></div><button className="plan-toggle" onClick={() => setPlan(!plan)}>{plan ? "СВЕРНУТЬ ПЛАН" : "M · ОТКРЫТЬ ПЛАН"}</button>{plan && <div className="plan-popover"><Board game={game} onCell={onCell} reduced={reduced} /><small>Нажмите на проход, чтобы проложить маршрут</small></div>}</>}
          {game.phase === "waiting" && <div className="board-overlay"><div className="overlay-card"><p className="eyebrow">КОМНАТА {code}</p><h3>Ожидаем архивариуса</h3><p>Отправьте приглашение второму человеку. Игра начнётся, когда он войдёт.</p>{inviteLink && <><input readOnly value={inviteLink} aria-label="Ссылка для архивариуса" onFocus={e => e.currentTarget.select()} /><button className="primary" onClick={() => copy(inviteLink, "Приглашение скопировано")}>Скопировать приглашение</button></>}</div></div>}
          {game.phase === "ended" && <div className="board-overlay"><div className="overlay-card end-card"><p className="eyebrow">ПАРТИЯ {game.round} ЗАВЕРШЕНА</p><h3>{game.winner === game.side ? "Вы победили" : "Вы проиграли"}</h3><p>{game.reason}</p><button className="primary" onClick={() => void action({ type: "rematch" })} disabled={game.votes[game.side]}>{game.votes[game.side] ? "Ждём ответ соперника" : "Предложить реванш"}</button><button className="text-button" onClick={leave}>Начать новую комнату</button>{game.votes[game.side === "player" ? "monster" : "player"] && <small>Соперник уже готов к реваншу.</small>}</div></div>}
        </div><div className="map-bottom"><span>{game.otherConnected ? "● ВТОРОЙ УЧАСТНИК НА СВЯЗИ" : game.phase === "waiting" ? "○ ПРИГЛАШЕНИЕ НЕ ОТКРЫТО" : "○ СОПЕРНИК НЕ В СЕТИ"}</span><span>{isMonster ? "КЛИК: МАРШРУТ · WASD: ШАГ" : "WASD: ДВИЖЕНИЕ · МЫШЬ / ← →: ОБЗОР · E: ДЕЙСТВИЕ"}</span></div>
        <div className="touch-pad" aria-label="Управление движением">{isMonster ? <><span /><button onClick={() => move(0,-1)}>↑</button><span /><button onClick={() => move(-1,0)}>←</button><button onClick={() => move(0,1)}>↓</button><button onClick={() => move(1,0)}>→</button></> : <><span /><button onClick={() => relativeMove(0)}>↑</button><span /><button onClick={() => { yaw.current -= .3; }}>↶</button><button onClick={() => relativeMove(Math.PI)}>↓</button><button onClick={() => { yaw.current += .3; }}>↷</button></>}</div></div>
        <aside className="console"><div className="console-head"><p className="eyebrow">ЛИЧНОЕ ДЕЛО</p><h2>{isMonster ? "Протокол охоты" : "Путь к выходу"}</h2></div>
          <div className="objective"><div className="objective-count">{game.found}<span>/ 3</span></div><div><strong>Предохранители</strong><small>{game.found === 3 ? "Все найдены. Ищите рубильник." : "Исследуйте стеллажи, ищите жёлтые метки."}</small></div></div>
          <div className="status-row"><span>ПИТАНИЕ</span><strong className={game.power ? "good" : ""}>{game.power ? "ВОССТАНОВЛЕНО" : "ОТКЛЮЧЕНО"}</strong></div><div className="status-row"><span>ВЫХОД</span><strong className={game.lockUntil > clock ? "bad" : ""}>{game.lockUntil > clock ? `БЛОК ${clockText(game.lockUntil - clock)}` : game.power ? "ОТКРЫТ" : "ЗАПЕРТ"}</strong></div>
          {isMonster ? <><div className="meter-title"><span>ПОМЕХИ</span><strong>{Math.floor(game.self.energy ?? 0)} / 100</strong></div><div className="meter"><i style={{ width: `${game.self.energy ?? 0}%` }} /></div>
            <div className="section-label">КАМЕРЫ</div><div className="cameras">{game.cameras.map((_, i) => <div key={i} className={game.cameraSignals?.[i] ? "signal" : ""}><span>КАМ {String(i + 1).padStart(2, "0")}</span><strong>{game.cameraSignals?.[i] ? "ДВИЖЕНИЕ" : "ТИШИНА"}</strong></div>)}</div>
            <div className="section-label">ВМЕШАТЕЛЬСТВО</div><div className="ability-grid">{sectors.map((s, i) => <button key={s} disabled={game.phase !== "playing" || (game.self.energy ?? 0) < 28 || (game.cooldowns?.blackout ?? 0) > clock} onClick={() => void action({ type: "blackout", zone: i })}><small>{i + 1} · 28</small><strong>Погасить свет</strong><span>{s}</span></button>)}</div>
            <button className={`wide-ability ${tool === "knock" ? "armed" : ""}`} disabled={game.phase !== "playing" || (game.self.energy ?? 0) < 14 || (game.cooldowns?.knock ?? 0) > clock} onClick={() => setTool(tool === "knock" ? "walk" : "knock")}><span>14 ПОМЕХ</span><strong>{tool === "knock" ? "Выберите точку на карте" : "Ложный стук / голос"}</strong><small>Нацелить отвлекающий звук</small></button>
            <div className="ability-grid two"><button disabled={game.phase !== "playing" || !game.power || (game.self.energy ?? 0) < 32 || (game.cooldowns?.lock ?? 0) > clock} onClick={() => void action({ type: "lock" })}><small>4 · 32</small><strong>Заклинить выход</strong><span>8 секунд</span></button><button disabled={game.phase !== "playing" || (game.self.energy ?? 0) < 26 || (game.cooldowns?.scare ?? 0) > clock} onClick={() => void action({ type: "scare" })}><small>5 · 26</small><strong>Проявиться</strong><span>В радиусе 5 клеток</span></button></div><button className="console-action" disabled={game.phase !== "playing"} onClick={() => void action({ type: "search" })}>E · Обыскать шкаф рядом</button></>
          : <><div className="section-label">ДЕЙСТВИЯ</div><button className="console-action" disabled={game.phase !== "playing"} onClick={() => void action({ type: "interact" })}>E · Подобрать / включить / выйти / спрятаться</button><button className="console-action flare" disabled={game.phase !== "playing" || (game.self.flares ?? 0) === 0 || (game.flareReadyAt ?? 0) > clock} onClick={() => void action({ type: "flare" })}>F · Ослепить вспышкой <span>{game.self.flares} / 2</span></button><div className="field-note"><strong>ПОМНИТЕ</strong><p>Свет выдаёт вас камерам. В шкафу вы невидимы, пока вас не обыщут. Вспышка останавливает архивариуса на 4 секунды.</p></div></>}
          <div className="settings"><button onClick={() => { sound.unlock(); sound.setMuted(!sound.muted); }} aria-label={sound.muted ? "Включить звук" : "Выключить звук"}>{sound.muted ? "ЗВУК ВЫКЛ" : "ЗВУК ВКЛ"}</button><label>ГРОМКОСТЬ <input type="range" min="0" max="1" step="0.01" value={sound.volume} onChange={e => { sound.unlock(); sound.setVolume(Number(e.target.value)); }} /></label><button onClick={() => setReduced(!reduced)} aria-pressed={reduced}>{reduced ? "ЩАДЯЩИЙ РЕЖИМ ВКЛ" : "СНИЗИТЬ ЭФФЕКТЫ"}</button></div>
          <div className="room-code">КОМНАТА <button title="Скопировать код" onClick={() => copy(code, "Код скопирован")}>{code} ⧉</button></div></aside></div></section>}
    {error && <div className="error" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="Закрыть">×</button></div>}
    {note && <div className="toast" role="status">{note}</div>}
    {scare && !reduced && <div className={`scare scare-${scare.variant ?? 0}`} aria-hidden="true"><div className="scare-eye"/><strong>{scareWords[scare.variant ?? 0]}</strong></div>}
  </main>;
}
