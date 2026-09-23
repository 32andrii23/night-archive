"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameView } from "./game-types";
import type { MotionInput } from "./three-first-person";

const ThreeFirstPerson = lazy(() => import("./three-first-person"));
const API = "/api/game";
const storageKey = (code: string, side: "player" | "monster") => `night-archive:seat:${code}:${side}`;
const tabSideKey = (code: string) => `night-archive:tab-side:${code}`;

const tricks = [
  { type: "sound", label: "Чужой голос", detail: "Шёпот и низкий звук прямо у друга за спиной.", key: "1", cost: 22 },
  { type: "scare", label: "Скример", detail: "На миг закрывает обзор пугающим видением. Нужно подойти ближе.", key: "2", cost: 26 },
  { type: "glitch", label: "Фальшивый лаг", detail: "Экран притворяется зависшим. Сеть и управление продолжают работать.", key: "3", cost: 18 },
  { type: "footsteps", label: "Шаги рядом", detail: "Друг слышит приближение того, кого нет.", key: "4", cost: 10 },
  { type: "doorSlam", label: "Хлопок двери", detail: "Резкий звук в коридоре заставит оглянуться.", key: "5", cost: 18 },
  { type: "shadow", label: "Тень пациента", detail: "Короткий силуэт на краю зрения.", key: "6", cost: 24 },
  { type: "blackout", label: "Погасить свет", detail: "На время оставляет друга с одним фонарём.", key: "7", cost: 28 },
  { type: "knock", label: "Стук в стене", detail: "Тихий стук рядом с другом, будто кто-то просится наружу.", key: "8", cost: 14 },
  { type: "lock", label: "Дверь заело", detail: "На восемь секунд блокирует открытый выход.", key: "9", cost: 32 },
] as const;

function parseInvite(value: string) {
  try {
    const url = new URL(value.trim());
    const ticket = url.searchParams.get("monster") ?? "";
    const dot = ticket.indexOf(".");
    if (dot < 0) return null;
    const code = ticket.slice(0, dot).toUpperCase();
    const invite = ticket.slice(dot + 1);
    return /^[A-Z0-9]{6,8}$/.test(code) && /^[A-Za-z0-9_-]{25,100}$/.test(invite) ? { code, invite } : null;
  } catch { return null; }
}

function timer(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Больница не отвечает. Попробуйте ещё раз.";
}

function nearbyHint(game: GameView) {
  if (game.phase !== "playing") return "";
  const distance = (point: { x: number; y: number }) => Math.hypot(game.self.x - point.x, game.self.y - point.y);
  if (game.side === "monster") {
    if (game.lockers.some(point => distance(point) <= 1.05)) return "E · ОБЫСКАТЬ ШКАФ";
    return "";
  }
  if (game.self.hidden) return "E · ВЫЙТИ ИЗ УКРЫТИЯ";
  if (game.fuses.some(clue => !clue.found && clue.x !== null && clue.y !== null && distance({ x: clue.x, y: clue.y }) <= 1.05)) return "E · ЗАБРАТЬ ИСТОРИЮ ПАЦИЕНТА";
  if (distance(game.switch) <= 1.05) return game.found === game.fuses.length ? "E · ВКЛЮЧИТЬ АВАРИЙНОЕ ПИТАНИЕ" : "СНАЧАЛА НАЙДИТЕ ЧЕТЫРЕ ИСТОРИИ";
  if (distance(game.exit) <= 1.05) return game.power ? "E · ВЫЙТИ ИЗ КОРПУСА" : "ВЫХОД ЗАПЕРТ · ИЩИТЕ УЛИКИ";
  if (game.lockers.some(point => distance(point) <= .85)) return "E · СПРЯТАТЬСЯ В ШКАФУ";
  return "";
}

function zoneName(game: GameView) {
  if (game.self.y >= 17) return "У ВХОДА";
  if (game.self.x < 9) return "ПАЛАТЫ";
  if (game.self.x < 18) return "ЛЕЧЕБНОЕ КРЫЛО";
  return "АРХИВ И ПОСТ ОХРАНЫ";
}

function useAudio(reduced: boolean) {
  const context = useRef<AudioContext | null>(null);
  const noiseBuffer = useRef<AudioBuffer | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(.42);
  const unlock = useCallback(() => {
    if (!context.current) {
      context.current = new AudioContext();
      const buffer = context.current.createBuffer(1, Math.round(context.current.sampleRate * .8), context.current.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * (i % 2 ? .8 : 1);
      noiseBuffer.current = buffer;
    }
    void context.current.resume();
  }, []);
  const play = useCallback((type: string) => {
    if (!context.current || muted || volume <= 0) return;
    const ctx = context.current;
    const now = ctx.currentTime;
    const level = volume * (reduced ? .35 : 1);
    const tone = (from: number, to: number, delay: number, duration: number, loudness: number, wave: OscillatorType = "sawtooth") => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      const at = now + delay;
      osc.type = wave;
      osc.frequency.setValueAtTime(from, at);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + duration);
      gain.gain.setValueAtTime(.0001, at);
      gain.gain.exponentialRampToValueAtTime(Math.max(.001, level * loudness), at + .018);
      gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
      osc.connect(gain); gain.connect(ctx.destination); osc.start(at); osc.stop(at + duration + .03);
    };
    const hiss = (delay: number, duration: number, loudness: number, frequency: number) => {
      if (!noiseBuffer.current) return;
      const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      const at = now + delay;
      source.buffer = noiseBuffer.current; source.loop = true;
      filter.type = "bandpass"; filter.frequency.value = frequency; filter.Q.value = .7;
      gain.gain.setValueAtTime(.0001, at);
      gain.gain.exponentialRampToValueAtTime(Math.max(.001, level * loudness), at + .025);
      gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
      source.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
      source.start(at); source.stop(at + duration + .03);
    };
    if (type === "sound") { tone(88, 39, 0, 1.05, .23); tone(310, 57, .12, .84, .11, "triangle"); hiss(.05, .95, .1, 780); }
    else if (type === "scare" || type === "caught") { tone(840, 54, 0, .72, .31); tone(92, 30, 0, 1, .2); hiss(0, .78, .22, 1650); }
    else if (type === "doorSlam") { hiss(0, .46, .22, 410); tone(115, 42, 0, .7, .22); }
    else if (type === "footsteps" || type === "step" || type === "heavy") {
      for (let i = 0; i < (type === "footsteps" ? 3 : 1); i++) { tone(125, 50, i * .21, .13, type === "heavy" ? .18 : .11, "triangle"); hiss(i * .21, .1, .065, 210); }
    } else if (type === "glitch") { hiss(0, .62, .11, 1200); tone(140, 69, .08, .5, .08, "square"); }
    else if (type === "knock") { for (let i = 0; i < 3; i++) tone(160, 72, i * .18, .1, .14, "triangle"); }
    else if (type === "shadow" || type === "blackout") { tone(82, 27, 0, 1.1, .17); hiss(.1, .8, .06, 280); }
    else if (type === "start") { tone(72, 43, 0, 1.4, .1, "triangle"); }
    else if (type === "fuse") { tone(420, 680, 0, .29, .1, "triangle"); }
    else if (type === "power") { tone(250, 590, 0, .65, .16, "triangle"); hiss(0, .6, .05, 1500); }
    else if (type === "flare") { hiss(0, .45, .19, 2400); tone(450, 800, 0, .34, .07, "triangle"); }
  }, [muted, volume, reduced]);
  return useMemo(() => ({ unlock, play, muted, setMuted, volume, setVolume }), [unlock, play, muted, volume]);
}

function introCopy(game: GameView, now: number) {
  const elapsed = now - game.startedAt;
  if (elapsed < 5_000) return { kicker: "ПОСЛЕДНЯЯ ПОЕЗДКА", title: "Мы приехали вместе.", text: "Заброшенный лечебный корпус. Внутри лежат истории, которые кто-то очень хотел забыть." };
  if (elapsed < 12_000) return { kicker: "У ВХОДА", title: "Двери открыты.", text: "Вы вышли из машины и вошли в вестибюль. Осмотритесь вместе. WASD — идти, мышь — смотреть." };
  return { kicker: "КОРПУС 13", title: "Двери закрываются.", text: "Войдите вместе. Через несколько секунд свет погаснет, и вы потеряете друг друга." };
}

export default function Home() {
  const [game, setGame] = useState<GameView | null>(null);
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [invite, setInvite] = useState("");
  const [joinLink, setJoinLink] = useState("");
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [chromeUrl, setChromeUrl] = useState("");
  const [panel, setPanel] = useState(false);
  const [pipLarge, setPipLarge] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [now, setNow] = useState(0);
  const gameRef = useRef<GameView | null>(null);
  const codeRef = useRef("");
  const tokenRef = useRef("");
  const motionBusy = useRef(false);
  const seen = useRef(new Set<string>());
  const introSound = useRef("");
  const audio = useAudio(reduced);

  const request = useCallback(async (body?: Record<string, unknown>, seat = tokenRef.current, room = codeRef.current) => {
    const response = await fetch(body ? API : `${API}?code=${encodeURIComponent(room)}`, {
      method: body ? "POST" : "GET",
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(seat ? { Authorization: `Bearer ${seat}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const data = await response.json() as { game?: GameView; code?: string; token?: string; monsterInvite?: string; error?: string };
    if (!response.ok) throw new Error(data.error || "Больница не отвечает.");
    return data;
  }, []);

  const accept = useCallback((view: GameView) => {
    const old = gameRef.current;
    if (old && (view.version < old.version || view.version === old.version && view.now < old.now)) return;
    if (old) for (const event of view.events) {
      if (seen.current.has(event.id)) continue;
      seen.current.add(event.id);
      if (view.side === "player" || ["start", "fuse", "power"].includes(event.type)) audio.play(event.type);
      if (event.type === "fuse" && view.side === "player") setNote("Найдена улика. Сохраните её для выхода.");
      if (event.type === "power" && view.side === "player") setNote("Питание восстановлено. Ищите выход.");
    }
    if (seen.current.size > 200) seen.current = new Set(view.events.map(event => event.id));
    gameRef.current = view;
    setGame(view);
  }, [audio]);

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      const url = new URL(location.href);
      const monster = url.searchParams.get("monster");
      if (monster) { setJoining(true); setJoinLink(url.href); history.replaceState(null, "", url.pathname); }
      const latest = !monster && (url.searchParams.get("room") || localStorage.getItem("night-archive:latest"));
      if (latest) {
        const requestedSide = url.searchParams.get("as") || sessionStorage.getItem(tabSideKey(latest));
        const side = requestedSide === "monster" ? "monster" : "player";
        const transferred = new URLSearchParams(url.hash.slice(1)).get("seat");
        if (transferred) {
          localStorage.setItem(storageKey(latest, side), transferred);
          sessionStorage.setItem(tabSideKey(latest), side);
          history.replaceState(null, "", `${url.pathname}?room=${encodeURIComponent(latest)}&as=${side}`);
        }
        const saved = transferred ?? localStorage.getItem(storageKey(latest, side))
          ?? (requestedSide ? null : localStorage.getItem(storageKey(latest, "monster")))
          ?? localStorage.getItem(`night-archive:seat:${latest}`);
        if (saved) { setCode(latest); setToken(saved); codeRef.current = latest; tokenRef.current = saved; setInvite(localStorage.getItem(`night-archive:invite:${latest}`) ?? ""); }
      }
      setReduced(matchMedia("(prefers-reduced-motion: reduce)").matches);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick(); const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!error) return;
    const timeout = window.setTimeout(() => setError(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [error]);
  useEffect(() => {
    if (!note) return;
    const timeout = window.setTimeout(() => setNote(""), 3300);
    return () => window.clearTimeout(timeout);
  }, [note]);
  useEffect(() => {
    if (game?.phase !== "intro") return;
    const key = `${code}:${game.round}`;
    if (introSound.current === key) return;
    introSound.current = key;
    audio.play("start");
  }, [game?.phase, game?.round, code, audio]);

  useEffect(() => {
    if (!code || !token) return;
    let active = true;
    let timeout = 0;
    const poll = async () => {
      try {
        const data = await request(undefined, token, code);
        if (active && data.game) accept(data.game);
      } catch (cause) { if (active) setError(errorText(cause)); }
      if (active) timeout = window.setTimeout(poll, ["playing", "intro"].includes(gameRef.current?.phase ?? "") ? 270 : 850);
    };
    void poll();
    return () => { active = false; window.clearTimeout(timeout); };
  }, [code, token, request, accept]);

  const enter = useCallback((room: string, seat: string, side: "player" | "monster") => {
    localStorage.setItem(storageKey(room, side), seat);
    sessionStorage.setItem(tabSideKey(room), side);
    localStorage.setItem("night-archive:latest", room);
    gameRef.current = null; setGame(null); seen.current.clear();
    codeRef.current = room; tokenRef.current = seat;
    setCode(room); setToken(seat); setPanel(false); setJoining(false); setError("");
    history.replaceState(null, "", `${location.pathname}?room=${encodeURIComponent(room)}&as=${side}`);
  }, []);
  const create = useCallback(async () => {
    audio.unlock(); setBusy(true); setError("");
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {});
    try {
      const data = await request({ type: "create" }, "", "");
      if (!data.code || !data.token || !data.monsterInvite) throw new Error("Не удалось создать комнату.");
      localStorage.setItem(`night-archive:invite:${data.code}`, data.monsterInvite);
      setInvite(data.monsterInvite); enter(data.code, data.token, "player");
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }, [audio, request, enter]);
  const join = useCallback(async () => {
    const ticket = parseInvite(joinLink);
    if (!ticket) { setError("Откройте полную ссылку приглашения — одного кода комнаты недостаточно."); return; }
    audio.unlock(); setBusy(true); setError("");
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {});
    try {
      const data = await request({ type: "join", ...ticket }, "", "");
      if (!data.code || !data.token) throw new Error("Не удалось войти.");
      enter(data.code, data.token, "monster");
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }, [joinLink, audio, request, enter]);

  const action = useCallback(async (value: Record<string, unknown>, quiet = false) => {
    if (!codeRef.current || !tokenRef.current) return false;
    audio.unlock();
    try {
      const data = await request({ type: "action", code: codeRef.current, action: value });
      if (data.game) accept(data.game);
      if (!quiet) setError("");
      return true;
    } catch (cause) {
      if (!quiet) setError(errorText(cause));
      return false;
    }
  }, [audio, request, accept]);
  const input = useCallback((motion: MotionInput) => {
    if (motionBusy.current) return;
    motionBusy.current = true;
    void action({ type: "move", ...motion }, true).finally(() => { motionBusy.current = false; });
  }, [action]);
  const trigger = useCallback((type: string) => {
    const g = gameRef.current;
    if (!g || g.side !== "monster") return;
    const value: Record<string, unknown> = { type };
    if (type === "blackout") value.zone = Math.max(0, Math.min(2, Math.floor((g.spectate?.x ?? g.self.x) / (g.map[0].length / 3))));
    if (type === "knock") { value.x = Math.round(g.spectate?.x ?? g.self.x); value.y = Math.round(g.spectate?.y ?? g.self.y); }
    void action(value);
  }, [action]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "Tab" && gameRef.current) { event.preventDefault(); setPanel(value => !value); return; }
      if (event.key === "Escape") { setPanel(false); return; }
      const g = gameRef.current;
      if (!g || g.phase !== "playing" || event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === "e") { event.preventDefault(); void action({ type: g.side === "player" ? "interact" : "search" }); }
      if (key === "f" && g.side === "player") { event.preventDefault(); void action({ type: "flare" }); }
      if (key === "g" && g.side === "monster") { event.preventDefault(); void action({ type: "disguise" }); }
      if (key === "p" && g.side === "monster") { event.preventDefault(); setPipLarge(value => !value); }
      if (g.side === "monster") {
        const trick = tricks.find(item => item.key === key);
        if (trick && !panel) { event.preventDefault(); trigger(trick.type); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [action, trigger, panel]);

  useEffect(() => {
    type Tool = { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean }; execute: (input: unknown) => Promise<unknown> };
    const context = (document as Document & { modelContext?: { registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Tool) => { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); };
    register({ name: "create_hospital_room", title: "Создать комнату", description: "Создать партию и получить приглашение для второго игрока.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false },
      async execute() { const data = await request({ type: "create" }, "", ""); if (!data.code || !data.token || !data.monsterInvite) throw new Error("Не удалось создать комнату."); localStorage.setItem(`night-archive:invite:${data.code}`, data.monsterInvite); setInvite(data.monsterInvite); enter(data.code, data.token, "player"); return { code: data.code, inviteUrl: `${location.origin}${location.pathname}?monster=${data.code}.${data.monsterInvite}` }; } });
    register({ name: "join_hospital_as_monster", title: "Войти вторым игроком", description: "Занять роль монстра по личному приглашению.", inputSchema: { type: "object", properties: { code: { type: "string" }, invite: { type: "string" } }, required: ["code", "invite"], additionalProperties: false }, annotations: { readOnlyHint: false },
      async execute(value) { const data = value as { code: string; invite: string }; const joined = await request({ type: "join", code: data.code, invite: data.invite }, "", ""); if (!joined.code || !joined.token) throw new Error("Не удалось войти."); enter(joined.code, joined.token, "monster"); return { code: joined.code, role: "monster" }; } });
    register({ name: "perform_hospital_action", title: "Сделать действие", description: "Выполнить действие текущей роли с проверкой сервером.", inputSchema: { type: "object", properties: { type: { type: "string" }, forward: { type: "number" }, strafe: { type: "number" }, yaw: { type: "number" }, pitch: { type: "number" } }, required: ["type"], additionalProperties: true }, annotations: { readOnlyHint: false },
      async execute(value) { const data = value as Record<string, unknown>; if (!codeRef.current || !tokenRef.current) throw new Error("Сначала войдите в комнату."); const result = await request({ type: "action", code: codeRef.current, action: data }); if (result.game) accept(result.game); return { phase: result.game?.phase, found: result.game?.found, position: result.game?.self }; } });
    return () => lifecycle.abort();
  }, [request, enter, accept]);

  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setNote("Приглашение скопировано"); }
    catch { setError("Не удалось скопировать. Выделите ссылку вручную."); }
  };
  const copyForChrome = async () => {
    const current = gameRef.current;
    if (!current || !codeRef.current || !tokenRef.current) return;
    const url = new URL(location.href);
    url.search = `?room=${encodeURIComponent(codeRef.current)}&as=${current.side}`;
    url.hash = `seat=${encodeURIComponent(tokenRef.current)}`;
    setChromeUrl(url.href);
    try {
      await navigator.clipboard.writeText(url.href);
      setNote("Личная ссылка скопирована.");
    } catch { setNote("Выделите личную ссылку и скопируйте её вручную."); }
  };
  const leave = () => {
    localStorage.removeItem("night-archive:latest");
    if (codeRef.current) sessionStorage.removeItem(tabSideKey(codeRef.current));
    gameRef.current = null; setGame(null); setCode(""); setToken(""); setInvite(""); setChromeUrl("");
    codeRef.current = ""; tokenRef.current = ""; seen.current.clear();
    history.replaceState(null, "", location.pathname);
  };
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setNote("Полный экран можно включить кнопкой браузера."); }
  };
  const inviteUrl = invite && code ? `${typeof location !== "undefined" ? location.origin + location.pathname : ""}?monster=${code}.${invite}` : "";
  const evidenceTotal = game?.fuses.length ?? 4;
  const isMonster = game?.side === "monster";
  const active = !!game && !panel && !chromeUrl && (game.phase === "intro" || game.phase === "playing");
  const activePrank = game?.side === "player" ? game.events.find(event => ["scare", "glitch", "shadow"].includes(event.type) && event.until > now) : null;
  const intro = game?.phase === "intro" ? introCopy(game, now) : null;
  const interaction = game ? nearbyHint(game) : "";
  const introElapsed = game ? now - game.startedAt : 0;
  const cinematicCut = game && (game.phase === "intro" || game.phase === "playing" && now < game.introEndsAt + 750)
    && (introElapsed >= 4_450 && introElapsed <= 5_250 || introElapsed >= 17_300 && introElapsed <= 18_750);

  return <main className="hospital-app" onPointerDown={audio.unlock}>
    {!game && <section className="hospital-entry">
      <div className="hospital-entry-sky" aria-hidden="true"><i className="hospital-building" /><i className="hospital-car" /></div>
      <div className="hospital-entry-top"><span>КО-13 / ЗАКРЫТЫЙ КОРПУС</span><span>ИГРА ДЛЯ ДВОИХ</span></div>
      <div className="hospital-entry-main">
        <p className="hospital-kicker">ПОСЛЕДНИЙ ВЫЗОВ · ПСИХИАТРИЧЕСКАЯ БОЛЬНИЦА</p>
        <h1>ТИХИЙ<br /><em>КОРПУС</em></h1>
        <p className="hospital-lead">Вы приехали сюда вместе. Чтобы выйти, найдите истории пациентов и включите аварийный выход. Один из вас уже знает, что случится внутри.</p>
        {!joining ? <div className="hospital-entry-actions"><button className="hospital-primary" disabled={busy} onClick={() => void create()}>Создать игру <span>↗</span></button><button className="hospital-plain" onClick={() => setJoining(true)}>У меня есть приглашение</button></div>
          : <div className="hospital-join"><label>ПОЛНАЯ ССЫЛКА ПРИГЛАШЕНИЯ<input value={joinLink} onChange={event => setJoinLink(event.target.value)} placeholder="https://…?monster=…" autoComplete="off" /></label><button className="hospital-primary" disabled={busy} onClick={() => void join()}>Войти в больницу ↗</button><button className="hospital-plain" onClick={() => setJoining(false)}>Назад</button></div>}
      </div>
      <div className="hospital-entry-bottom"><span>ДВА ДРУГА · ОДНА НОЧЬ</span><span>WASD + МЫШЬ · TAB — ЗАДАЧА</span></div>
    </section>}

    {game && <section className="hospital-game">
      <Suspense fallback={<div className="hospital-loading">Открываем корпус…</div>}><ThreeFirstPerson game={game} active={active} reduced={reduced} pipLarge={pipLarge} onInput={input} onCopyForChrome={() => void copyForChrome()} /></Suspense>
      <div className="hospital-vignette" aria-hidden="true" />
      <div className="hospital-reticle" aria-hidden="true" />
      <header className="hospital-hud">
        <div className="hospital-hud-left"><button className="hospital-hud-button" onClick={() => setPanel(value => !value)} aria-expanded={panel}>TAB <span>{isMonster ? "РОЗЫГРЫШИ" : "ДЕЛО"}</span></button><div className="hospital-hud-objective"><strong>{isMonster ? game.self.disguised ? "ЧЕЛОВЕК" : "ОН ВИДИТ МОНСТРА" : `УЛИКИ ${game.found}/${evidenceTotal}`}</strong><small>{zoneName(game)} · {isMonster ? "G — СМЕНИТЬ ОБЛИК" : game.power ? "Выход разблокирован" : "Ищите истории пациентов"}</small></div></div>
        <div className="hospital-hud-right"><span className="hospital-timer">{game.phase === "playing" ? timer(game.endsAt - now) : game.phase === "intro" ? timer(game.introEndsAt - now) : "12:00"}</span><button className="hospital-icon-button" onClick={() => void fullscreen()} aria-label="Полный экран" title="Полный экран">⛶</button></div>
      </header>
      {isMonster && game.spectate && game.phase !== "waiting" && <button className={`hospital-pip-label ${pipLarge ? "large" : ""}`} onClick={() => setPipLarge(value => !value)} aria-label="Изменить размер вида глазами друга"><span>● ГЛАЗА ДРУГА</span><small>{pipLarge ? "УМЕНЬШИТЬ" : "P · УВЕЛИЧИТЬ"}</small></button>}
      {interaction && <div className="hospital-interaction">{interaction}</div>}
      <div className="hospital-bottom-hint"><span>{game.phase === "intro" ? "МЫШЬ — ОСМОТРЕТЬСЯ · WASD — ИДТИ ПОСЛЕ ОСТАНОВКИ" : "WASD — СВОБОДНО ИДТИ · МЫШЬ — СМОТРЕТЬ · E — ДЕЙСТВИЕ · TAB — ПАНЕЛЬ"}</span></div>
      {intro && <div className="hospital-intro-caption"><span>{intro.kicker}</span><h2>{intro.title}</h2><p>{intro.text}</p></div>}
      {cinematicCut && <div className="hospital-cinematic-cut" aria-hidden="true"><span>{introElapsed < 6_000 ? "ВЫ ВЫШЛИ ИЗ МАШИНЫ" : "СВЕТ ПОГАС. ВЫ РАЗДЕЛЕНЫ."}</span></div>}
      {game.phase === "waiting" && <div className="hospital-modal-scrim"><div className="hospital-modal"><p className="hospital-kicker">КОМНАТА {code}</p><h2>Ждём второго игрока</h2><p>Отправьте другу приглашение. Вы начнёте вместе в машине у входа в корпус.</p>{inviteUrl && <><input readOnly value={inviteUrl} aria-label="Ссылка приглашения" onFocus={event => event.currentTarget.select()} /><button className="hospital-primary" onClick={() => void copy(inviteUrl)}>Скопировать приглашение</button></>}</div></div>}
      {chromeUrl && <div className="hospital-modal-scrim"><div className="hospital-modal"><p className="hospital-kicker">ЗАХВАТ МЫШИ</p><h2>Откройте в Chrome</h2><p>Скопируйте личную ссылку в обычный Chrome. Вы вернётесь в ту же комнату и к той же роли. Эту ссылку нельзя отправлять другу.</p><input readOnly value={chromeUrl} aria-label="Личная ссылка для Chrome" onFocus={event => event.currentTarget.select()} onClick={event => event.currentTarget.select()} /><button className="hospital-primary" onClick={() => void copyForChrome()}>Скопировать личную ссылку</button><button className="hospital-plain" onClick={() => setChromeUrl("")}>Вернуться в игру</button></div></div>}
      {game.phase === "ended" && <div className="hospital-modal-scrim"><div className="hospital-modal"><p className="hospital-kicker">ДЕЛО ЗАКРЫТО · ПАРТИЯ {game.round}</p><h2>{game.winner === "player" ? "Улики вынесены наружу" : "Больница удержала гостя"}</h2><p>{game.reason}</p><button className="hospital-primary" disabled={game.votes[game.side]} onClick={() => void action({ type: "rematch" })}>{game.votes[game.side] ? "Ждём друга" : "Предложить реванш"}</button><button className="hospital-plain" onClick={leave}>Новая комната</button></div></div>}
      {panel && <div className="hospital-panel-backdrop" onClick={() => setPanel(false)}><aside className="hospital-panel" onClick={event => event.stopPropagation()} aria-label={isMonster ? "Панель монстра" : "Дело пациента"}>
        <div className="hospital-panel-head"><span>{isMonster ? "КОНСОЛЬ КОРПУСА" : "ЛИЧНОЕ ДЕЛО"}</span><button onClick={() => setPanel(false)} aria-label="Закрыть панель">×</button></div>
        <h2>{isMonster ? "Держи его в страхе." : "Найдите путь наружу."}</h2>
        {isMonster ? <>
          <p className="hospital-panel-lead">Смотри глазами друга в углу экрана. Подходи к нему как спутник или раскрывайся клавишей G. Розыгрыши влияют на восприятие, а не ломают соединение.</p>
          <div className="hospital-energy">ПОМЕХИ <strong>{Math.floor(game.self.energy ?? 0)} / 100</strong><i style={{ width: `${game.self.energy ?? 0}%` }} /></div>
          <button className="hospital-disguise" onClick={() => void action({ type: "disguise" })}>{game.self.disguised ? "G · Раскрыть настоящую форму" : "G · Выглядеть как обычный спутник"}<small>Маску можно менять в любой момент.</small></button>
          <div className="hospital-tricks">{tricks.map(trick => <button key={trick.type} disabled={game.phase !== "playing" || (game.cooldowns?.[trick.type] ?? 0) > now || (game.self.energy ?? 0) < trick.cost || trick.type === "lock" && !game.power} onClick={() => trigger(trick.type)}><b>{trick.key}</b><span><strong>{trick.label} · {trick.cost}</strong><small>{trick.detail}</small></span>{(game.cooldowns?.[trick.type] ?? 0) > now && <em>{timer((game.cooldowns?.[trick.type] ?? 0) - now)}</em>}</button>)}</div>
        </> : <>
          <p className="hospital-panel-lead">Соберите четыре истории пациентов, запустите аварийное питание у поста охраны и вернитесь к выходу. У вас есть двенадцать минут.</p>
          <div className="hospital-case-row"><span>НАЙДЕНО УЛИК</span><strong>{game.found} / {evidenceTotal}</strong></div>
          <div className="hospital-case-row"><span>АВАРИЙНОЕ ПИТАНИЕ</span><strong>{game.power ? "ВКЛЮЧЕНО" : "ОТКЛЮЧЕНО"}</strong></div>
          <div className="hospital-case-row"><span>ВЫХОД</span><strong>{game.power ? "ИЩИТЕ ВХОД" : "ЗАКРЫТ"}</strong></div>
          <p className="hospital-panel-lead">E — изучить улику, включить питание или выйти. F — вспышка фонаря, если спутник раскрылся. Вы можете оглядываться до самого пола и потолка.</p>
        </>}
        <div className="hospital-panel-foot"><span>КОМНАТА {code}</span><button onClick={() => { audio.unlock(); audio.setMuted(!audio.muted); }}>{audio.muted ? "ЗВУК ВЫКЛ" : "ЗВУК ВКЛ"}</button><button onClick={() => setReduced(value => !value)}>{reduced ? "ЭФФЕКТЫ СНИЖЕНЫ" : "СНИЗИТЬ ЭФФЕКТЫ"}</button><button onClick={leave}>ПОКИНУТЬ КОМНАТУ</button></div>
      </aside></div>}
      {activePrank?.type === "glitch" && !reduced && <div className="hospital-fake-lag" aria-hidden="true"><strong>СИГНАЛ ПОТЕРЯН</strong><span>ПОДКЛЮЧЕНИЕ К КОРПУСУ…</span></div>}
      {activePrank?.type === "shadow" && !reduced && <div className="hospital-shadow" aria-hidden="true" />}
      {activePrank?.type === "scare" && !reduced && <div className="hospital-scare" aria-hidden="true"><span>ОН РЯДОМ</span></div>}
    </section>}
    {error && <div className="hospital-error" role="alert">{error}<button onClick={() => setError("")} aria-label="Закрыть">×</button></div>}
    {note && <div className="hospital-note" role="status">{note}</div>}
  </main>;
}
