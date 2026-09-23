"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ARRIVAL_MS, INTRO_MS } from "../lib/hospital";
import type { GameEvent, GameView, LocalState, Side } from "./game-types";
import type { MoveInput } from "./game-view";
import { HorrorAudio } from "./engine/audio";
import { TRICKS, type Trick } from "./ui/data";
import { InviteScreen, Landing, Waiting, type Peek } from "./ui/entry";
import { MonsterHud, Minimap, VisitorHud, nearbyHint, timer, zoneName } from "./ui/hud";
import { DocumentReader, Ending, FakeLag, LockerView, RadioLine, Screamer } from "./ui/overlays";
import { Panel, TextTrick, type AllSettings } from "./ui/panel";

const GameViewCanvas = lazy(() => import("./game-view"));
const API = "/api/game";
const seatKey = (code: string, side: Side) => `night-archive:seat:${code}:${side}`;
const tabSideKey = (code: string) => `night-archive:tab-side:${code}`;
const SETTINGS_KEY = "night-archive:settings";
const DEFAULT_SETTINGS: AllSettings = { sensitivity: 1, quality: "medium", invertY: false, fov: 75, reduced: false, volume: .8 };
const HOLD_MS = 1300;

type Response = { game?: GameView; code?: string; token?: string; invite?: string; side?: Side; host?: string; error?: string };

function parseTicket(value: string) {
  try {
    const url = new URL(value.trim(), typeof location !== "undefined" ? location.href : "http://x");
    const ticket = url.searchParams.get("join") ?? url.searchParams.get("monster") ?? "";
    const dot = ticket.indexOf(".");
    if (dot < 0) return null;
    const code = ticket.slice(0, dot).toUpperCase(), invite = ticket.slice(dot + 1);
    return /^[A-Z0-9]{6,8}$/.test(code) && /^[A-Za-z0-9_-]{25,100}$/.test(invite) ? { code, invite } : null;
  } catch { return null; }
}
function errorText(error: unknown) { return error instanceof Error ? error.message : "Больница не отвечает. Попробуйте ещё раз."; }

function introCopy(game: GameView, elapsed: number) {
  const monster = game.side === "monster";
  if (elapsed < ARRIVAL_MS) return monster
    ? { kicker: "ТЫ — СУЩЕСТВО", title: "Приехали вдвоём.", text: "Для второго игрока ты просто спутник. Пока." }
    : { kicker: "КОРПУС 13 · 02:47", title: "Мы приехали вдвоём.", text: "Говорят, после закрытия отсюда никто не уезжал." };
  if (elapsed < 13_000) return monster
    ? { kicker: "ИГРАЙ РОЛЬ", title: "Будь рядом.", text: "Иди со спутником ко входу. Не выдавай себя." }
    : { kicker: "У ВХОДА", title: "Двери открыты.", text: "Выйдите из машины и зайдите внутрь. WASD — идти, мышь — смотреть." };
  return monster
    ? { kicker: "СКОРО", title: "Свет погаснет.", text: "Вас разделит — и начнётся охота. G — истинный облик." }
    : { kicker: "ВЕСТИБЮЛЬ", title: "Не отходите далеко.", text: "Свет здесь ещё работает. Пока." };
}

export default function Home() {
  const [game, setGame] = useState<GameView | null>(null);
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [invite, setInvite] = useState("");
  const [name, setNameState] = useState("");
  const [chosenSide, setChosenSide] = useState<Side>("monster");
  const [joinLink, setJoinLink] = useState("");
  const [joining, setJoining] = useState(false);
  const [peek, setPeek] = useState<Peek>(null);
  const [peeking, setPeeking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [chromeUrl, setChromeUrl] = useState("");
  const [panel, setPanel] = useState(false);
  const [pipLarge, setPipLarge] = useState(false);
  const [showMap, setShowMap] = useState(true);
  const [textTrick, setTextTrick] = useState<null | "radio" | "write" | "voice">(null);
  const [reading, setReading] = useState<number | null>(null);
  const [radio, setRadio] = useState<{ name: string; text: string; at: number } | null>(null);
  const [screamer, setScreamer] = useState<{ variant: number; until: number; caught?: boolean } | null>(null);
  const [fakeLag, setFakeLag] = useState(0);
  const [settings, setSettingsState] = useState<AllSettings>(DEFAULT_SETTINGS);
  const [local, setLocal] = useState<LocalState>({ stamina: 1, crouch: false, light: true, sprinting: false, holdProgress: 0, holdLabel: "" });
  const [hold, setHold] = useState(0);
  const [lastSeen, setLastSeen] = useState<{ x: number; y: number; at: number } | null>(null);
  const [now, setNow] = useState(0);
  const gameRef = useRef<GameView | null>(null);
  const codeRef = useRef("");
  const tokenRef = useRef("");
  const clock = useRef(0);
  const clockReady = useRef(false);
  const moveBusy = useRef(false);
  const pendingMove = useRef<MoveInput | null>(null);
  const seen = useRef(new Set<string>());
  const holdRef = useRef<{ start: number; raf: number } | null>(null);
  const pipRef = useRef<HTMLDivElement>(null);
  const audio = useMemo(() => new HorrorAudio(), []);

  const setName = (v: string) => { setNameState(v); try { localStorage.setItem("night-archive:name", v); } catch { /* private mode */ } };
  const setSettings = (s: AllSettings) => { setSettingsState(s); try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ } };
  useEffect(() => { audio.setVolume(settings.volume); }, [audio, settings.volume]);

  const request = useCallback(async (body?: Record<string, unknown>, seat = tokenRef.current, room = codeRef.current) => {
    const sentAt = Date.now();
    const response = await fetch(body ? API : `${API}?code=${encodeURIComponent(room)}`, {
      method: body ? "POST" : "GET",
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(seat ? { Authorization: `Bearer ${seat}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const data = await response.json() as Response;
    if (!response.ok) throw new Error(data.error || "Больница не отвечает.");
    if (data.game) {
      // Estimate the server clock from the round trip midpoint.
      const receivedAt = Date.now();
      const sample = data.game.now - (sentAt + receivedAt) / 2;
      if (!clockReady.current) { clock.current = sample; clockReady.current = true; }
      else if (receivedAt - sentAt < 900) clock.current += (sample - clock.current) * .12;
    }
    return data;
  }, []);

  const uiEvent = useCallback((e: GameEvent, view: GameView) => {
    const t = Date.now() + clock.current;
    const visitor = view.side === "player";
    if (visitor) {
      if (e.type === "clue") { setReading(e.variant ?? 0); setNote(`История найдена · ${view.found}/${view.total}`); }
      if (e.type === "allClues") setNote("Все истории у вас. Щиток — на посту охраны, северо-восток.");
      if (e.type === "power") setNote("Питание есть! Бегите к главному входу.");
      if (e.type === "battery") setNote("Батарейки: фонарь +45%");
      if (e.type === "radio" && e.text) setRadio({ name: view.names.monster, text: e.text, at: e.at });
      if (e.type === "scare" && !settings.reduced) setScreamer({ variant: e.variant ?? 0, until: t + 1400 });
      if (e.type === "caught") setScreamer({ variant: 1, until: t + (settings.reduced ? 600 : 2300), caught: true });
      if (e.type === "wake") window.setTimeout(() => setNote(`Вы вырвались. Сил осталось: ${e.variant ?? 1}`), 2600);
      if (e.type === "flare" && e.variant) setNote("Вспышка ослепила существо! Бегите.");
      if (e.type === "lock") setNote("Что-то держит дверь изнутри…");
      if (e.type === "glitch" && !settings.reduced) {
        setFakeLag(e.until);
        window.setTimeout(() => { setFakeLag(0); setScreamer({ variant: 2, until: Date.now() + clock.current + 420 }); audio.play("unglitch"); }, Math.max(0, e.until - t));
      }
    } else {
      if (e.type === "clue") setNote(`Найдена история · ${view.found}/${view.total}`);
      if (e.type === "power") setNote("Щиток включён. Добыча побежит к главному входу!");
      if (e.type === "flare" && e.variant) setNote("Ослеплён вспышкой!");
      if (e.type === "caught") setNote(view.phase === "ended" ? "Попалась добыча." : `Попалась! Сил у добычи: ${view.friend?.lives ?? 0}`);
      if (e.type === "hide") setNote("Рядом хлопнула дверца шкафа…");
      if (e.type === "radio") setNote("Рация: сообщение ушло.");
    }
  }, [audio, settings.reduced]);

  const accept = useCallback((view: GameView) => {
    const old = gameRef.current;
    if (old && old.round === view.round && (view.version < old.version || (view.version === old.version && view.now < old.now))) return;
    for (const e of view.events) {
      if (seen.current.has(e.id)) continue;
      seen.current.add(e.id);
      if (old || view.now - e.at < 1500) uiEvent(e, view);
    }
    if (seen.current.size > 300) seen.current = new Set(view.events.map(e => e.id));
    if (view.side === "monster" && view.friend?.detected && view.spectate) setLastSeen({ x: view.spectate.x, y: view.spectate.y, at: view.now });
    if (old && old.round !== view.round) { setReading(null); setRadio(null); setLastSeen(null); }
    gameRef.current = view;
    setGame(view);
  }, [uiEvent]);

  /* --------------------------- boot from URL / storage --------------------------- */
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (saved) setSettingsState({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
        setNameState(localStorage.getItem("night-archive:name") ?? "");
      } catch { /* storage blocked */ }
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) setSettingsState(s => ({ ...s, reduced: true }));
      const url = new URL(location.href);
      const ticket = parseTicket(url.href);
      if (ticket) {
        history.replaceState(null, "", url.pathname);
        setPeeking(true);
        void request({ type: "peek", ...ticket }, "", "").then(data => {
          if (!mounted) return;
          setPeek({ code: ticket.code, invite: ticket.invite, host: data.host ?? "Друг", side: data.side ?? "player" });
        }).catch(cause => {
          setError(errorText(cause)); setPeeking(false);
          // The seat may already belong to this browser.
          const mine = localStorage.getItem(seatKey(ticket.code, "player")) ?? localStorage.getItem(seatKey(ticket.code, "monster"));
          if (mine) { setCode(ticket.code); setToken(mine); codeRef.current = ticket.code; tokenRef.current = mine; }
        });
        return;
      }
      const latest = url.searchParams.get("room") || localStorage.getItem("night-archive:latest");
      if (latest) {
        const requested = url.searchParams.get("as") || sessionStorage.getItem(tabSideKey(latest));
        const side: Side = requested === "player" ? "player" : "monster";
        const transferred = new URLSearchParams(url.hash.slice(1)).get("seat");
        if (transferred) {
          localStorage.setItem(seatKey(latest, side), transferred);
          sessionStorage.setItem(tabSideKey(latest), side);
          history.replaceState(null, "", `${url.pathname}?room=${encodeURIComponent(latest)}&as=${side}`);
        }
        const seat = transferred ?? localStorage.getItem(seatKey(latest, side)) ?? (requested ? null : localStorage.getItem(seatKey(latest, side === "monster" ? "player" : "monster")));
        if (seat) { setCode(latest); setToken(seat); codeRef.current = latest; tokenRef.current = seat; setInvite(localStorage.getItem(`night-archive:invite:${latest}`) ?? ""); }
      }
    });
    return () => { mounted = false; };
  }, [request]);

  useEffect(() => { const id = window.setInterval(() => setNow(Date.now() + clock.current), 200); return () => window.clearInterval(id); }, []);
  useEffect(() => { if (!error) return; const id = window.setTimeout(() => setError(""), 5000); return () => window.clearTimeout(id); }, [error]);
  useEffect(() => { if (!note) return; const id = window.setTimeout(() => setNote(""), 3600); return () => window.clearTimeout(id); }, [note]);
  useEffect(() => { if (!radio) return; const id = window.setTimeout(() => { setRadio(null); audio.play("radioEnd"); }, 6500); return () => window.clearTimeout(id); }, [radio, audio]);
  useEffect(() => { if (reading === null) return; const id = window.setTimeout(() => setReading(null), 22_000); return () => window.clearTimeout(id); }, [reading]);
  useEffect(() => { if (!screamer) return; const id = window.setTimeout(() => setScreamer(null), Math.max(50, screamer.until - Date.now() - clock.current)); return () => window.clearTimeout(id); }, [screamer]);

  /* --------------------------------- polling --------------------------------- */
  useEffect(() => {
    if (!code || !token) return;
    let active = true, timeout = 0, failures = 0;
    const poll = async () => {
      try {
        const data = await request(undefined, token, code);
        failures = 0;
        if (active && data.game) accept(data.game);
      } catch (cause) {
        const message = errorText(cause);
        if (active && ["Комната не найдена.", "Нет доступа к этой роли.", "Неверный код комнаты.", "Сохранённый доступ не найден. Откройте своё приглашение."].includes(message)) {
          try {
            localStorage.removeItem(seatKey(code, "player"));
            localStorage.removeItem(seatKey(code, "monster"));
            localStorage.removeItem(`night-archive:invite:${code}`);
            if (localStorage.getItem("night-archive:latest") === code) localStorage.removeItem("night-archive:latest");
            sessionStorage.removeItem(tabSideKey(code));
          } catch { /* storage blocked */ }
          history.replaceState(null, "", location.pathname);
          codeRef.current = ""; tokenRef.current = ""; gameRef.current = null;
          setCode(""); setToken(""); setGame(null);
          setError("Старая комната больше недоступна. Создайте новую партию.");
          return;
        }
        failures++;
        if (active && failures > 2) setError(message);
      }
      const live = ["playing", "intro"].includes(gameRef.current?.phase ?? "");
      if (active) timeout = window.setTimeout(poll, live ? 240 : 900);
    };
    void poll();
    return () => { active = false; window.clearTimeout(timeout); };
  }, [code, token, request, accept]);

  /* --------------------------------- actions --------------------------------- */
  const enter = useCallback((room: string, seat: string, side: Side) => {
    localStorage.setItem(seatKey(room, side), seat);
    sessionStorage.setItem(tabSideKey(room), side);
    localStorage.setItem("night-archive:latest", room);
    gameRef.current = null; setGame(null); seen.current.clear();
    codeRef.current = room; tokenRef.current = seat;
    setCode(room); setToken(seat); setPanel(false); setJoining(false); setPeek(null); setPeeking(false); setError("");
    history.replaceState(null, "", `${location.pathname}?room=${encodeURIComponent(room)}&as=${side}`);
  }, []);
  const goFullscreen = () => { if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {}); };
  const create = useCallback(async () => {
    audio.unlock(); setBusy(true); setError(""); goFullscreen();
    try {
      const data = await request({ type: "create", side: chosenSide, name }, "", "");
      if (!data.code || !data.token || !data.invite) throw new Error("Не удалось создать комнату.");
      localStorage.setItem(`night-archive:invite:${data.code}`, data.invite);
      setInvite(data.invite); enter(data.code, data.token, data.side ?? chosenSide);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }, [audio, request, enter, chosenSide, name]);
  const join = useCallback(async () => {
    if (!peek) return;
    audio.unlock(); setBusy(true); setError(""); goFullscreen();
    try {
      const data = await request({ type: "join", code: peek.code, invite: peek.invite, name }, "", "");
      if (!data.code || !data.token) throw new Error("Не удалось войти.");
      enter(data.code, data.token, data.side ?? peek.side);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }, [peek, audio, request, enter, name]);
  const openLink = useCallback(async () => {
    const ticket = parseTicket(joinLink);
    if (!ticket) { setError("Вставьте полную ссылку-приглашение."); return; }
    setBusy(true);
    try {
      const data = await request({ type: "peek", ...ticket }, "", "");
      setPeek({ ...ticket, host: data.host ?? "Друг", side: data.side ?? "player" }); setPeeking(true); setJoining(false);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }, [joinLink, request]);

  const action = useCallback(async (value: Record<string, unknown>, quiet = false) => {
    if (!codeRef.current || !tokenRef.current) return false;
    audio.unlock();
    try {
      const data = await request({ type: "action", code: codeRef.current, action: value });
      if (data.game) accept(data.game);
      return true;
    } catch (cause) {
      if (!quiet) setError(errorText(cause));
      return false;
    }
  }, [audio, request, accept]);

  // One move in flight at a time; the newest pending pose replaces older ones.
  const sendMove = useCallback((m: MoveInput) => {
    const run = (move: MoveInput) => {
      moveBusy.current = true;
      void request({ type: "move", code: codeRef.current, move })
        .then(data => { if (data.game) accept(data.game); })
        .catch(() => {})
        .finally(() => {
          moveBusy.current = false;
          const next = pendingMove.current;
          pendingMove.current = null;
          if (next) run(next);
        });
    };
    if (moveBusy.current) { pendingMove.current = m; return; }
    run(m);
  }, [request, accept]);

  const trigger = useCallback((t: Trick) => {
    const g = gameRef.current;
    if (!g || g.side !== "monster") return;
    if (t.input) { setTextTrick(t.input); return; }
    void action({ type: t.type });
  }, [action]);
  const sendText = useCallback((text: string) => {
    const kind = textTrick;
    setTextTrick(null);
    if (kind) void action({ type: kind, text });
  }, [textTrick, action]);

  const cancelHold = useCallback(() => {
    if (holdRef.current) cancelAnimationFrame(holdRef.current.raf);
    holdRef.current = null; setHold(0);
  }, []);
  const startHold = useCallback(() => {
    cancelHold();
    const start = performance.now();
    const step = () => {
      const g = gameRef.current;
      const hint = g ? nearbyHint(g) : null;
      if (!hint?.hold) { cancelHold(); return; }
      const k = (performance.now() - start) / HOLD_MS;
      if (k >= 1) { cancelHold(); void action({ type: "interact" }); return; }
      setHold(k);
      holdRef.current = { start, raf: requestAnimationFrame(step) };
    };
    holdRef.current = { start, raf: requestAnimationFrame(step) };
  }, [action, cancelHold]);

  /* --------------------------------- keyboard --------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const g = gameRef.current;
      if (e.code === "Tab" && g) { e.preventDefault(); setPanel(v => !v); return; }
      if (e.code === "Escape") { setPanel(false); setReading(null); setTextTrick(null); return; }
      if (!g || e.repeat) return;
      if (e.code === "KeyP" && g.side === "monster") { setPipLarge(v => !v); return; }
      if (e.code === "KeyM" && g.side === "monster") { setShowMap(v => !v); return; }
      if (g.phase !== "playing" || panel || textTrick) return;
      if (g.side === "player") {
        if (e.code === "KeyE") {
          e.preventDefault();
          if (reading !== null) { setReading(null); return; }
          const hint = nearbyHint(g);
          if (hint?.hold) startHold(); else void action({ type: "interact" });
        }
        if (e.code === "KeyQ") { e.preventDefault(); void action({ type: "flare" }); }
      } else {
        if (e.code === "KeyE") { e.preventDefault(); void action({ type: "search" }); }
        if (e.code === "KeyG") { e.preventDefault(); void action({ type: "disguise" }); }
        const t = TRICKS.find(x => x.key === e.code);
        if (t) { e.preventDefault(); trigger(t); }
      }
    };
    const onUp = (e: KeyboardEvent) => { if (e.code === "KeyE") cancelHold(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onUp); };
  }, [action, trigger, panel, textTrick, reading, startHold, cancelHold]);

  /* ------------------------------ agent tools ------------------------------ */
  useEffect(() => {
    type Tool = { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean }; execute: (input: unknown) => Promise<unknown> };
    const context = (document as Document & { modelContext?: { registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Tool) => { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); };
    register({ name: "create_hospital_room", title: "Создать комнату", description: "Создать партию. side: monster или player — роль создателя.", inputSchema: { type: "object", properties: { side: { type: "string", enum: ["monster", "player"] }, name: { type: "string" } }, additionalProperties: false }, annotations: { readOnlyHint: false },
      async execute(value) { const v = (value ?? {}) as { side?: Side; name?: string }; const data = await request({ type: "create", side: v.side ?? "monster", name: v.name ?? "" }, "", ""); if (!data.code || !data.token || !data.invite) throw new Error("Не удалось создать комнату."); localStorage.setItem(`night-archive:invite:${data.code}`, data.invite); setInvite(data.invite); enter(data.code, data.token, data.side ?? "monster"); return { code: data.code, inviteUrl: `${location.origin}${location.pathname}?join=${data.code}.${data.invite}` }; } });
    register({ name: "perform_hospital_action", title: "Сделать действие", description: "Выполнить действие текущей роли с проверкой сервером.", inputSchema: { type: "object", properties: { type: { type: "string" }, text: { type: "string" } }, required: ["type"], additionalProperties: true }, annotations: { readOnlyHint: false },
      async execute(value) { const data = value as Record<string, unknown>; if (!codeRef.current || !tokenRef.current) throw new Error("Сначала войдите в комнату."); const result = await request({ type: "action", code: codeRef.current, action: data }); if (result.game) accept(result.game); return { phase: result.game?.phase, found: result.game?.found }; } });
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
    try { await navigator.clipboard.writeText(url.href); setNote("Личная ссылка скопирована."); }
    catch { setNote("Выделите личную ссылку и скопируйте её вручную."); }
  };
  const leave = () => {
    localStorage.removeItem("night-archive:latest");
    if (codeRef.current) sessionStorage.removeItem(tabSideKey(codeRef.current));
    gameRef.current = null; setGame(null); setCode(""); setToken(""); setInvite(""); setChromeUrl(""); setPanel(false);
    codeRef.current = ""; tokenRef.current = ""; seen.current.clear();
    history.replaceState(null, "", location.pathname);
  };
  const fullscreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { setNote("Полный экран можно включить кнопкой браузера."); }
  };

  const inviteUrl = invite && code ? `${typeof location !== "undefined" ? location.origin + location.pathname : ""}?join=${code}.${invite}` : "";
  const isMonster = game?.side === "monster";
  const active = !!game && !panel && !chromeUrl && !textTrick && (game.phase === "intro" || game.phase === "playing");
  const introElapsed = game ? now - game.startedAt : 0;
  const intro = game?.phase === "intro" ? introCopy(game, introElapsed) : null;
  const hint = game ? nearbyHint(game) : null;
  const cinematic = game && (game.phase === "intro" || (game.phase === "playing" && now < game.introEndsAt + 1500))
    ? introElapsed >= ARRIVAL_MS - 550 && introElapsed <= ARRIVAL_MS + 300 ? "ВЫ ВЫШЛИ ИЗ МАШИНЫ"
      : introElapsed >= INTRO_MS - 700 && introElapsed <= INTRO_MS + 1400 ? "СВЕТ ПОГАС. ВЫ РАЗДЕЛЕНЫ." : null
    : null;
  const hidden = !isMonster && (game?.self.hidden ?? -1) >= 0;

  return <main className={`hospital-app ${screamer ? "shaking" : ""}`} onPointerDown={() => audio.unlock()}>
    {!game && !code && (peek || peeking
      ? <InviteScreen peek={peek} name={name} setName={setName} busy={busy} onJoin={() => void join()} onBack={() => { setPeek(null); setPeeking(false); }} />
      : <Landing name={name} setName={setName} side={chosenSide} setSide={setChosenSide} busy={busy} onCreate={() => void create()}
        joining={joining} setJoining={setJoining} joinLink={joinLink} setJoinLink={setJoinLink} onJoinLink={() => void openLink()} />)}
    {!game && code && <div className="hospital-loading">Открываем корпус…</div>}

    {game && <section className={`hospital-game ${isMonster ? "monster" : "visitor"}`}>
      <Suspense fallback={<div className="hospital-loading">Открываем корпус…</div>}>
        <GameViewCanvas game={game} active={active} settings={settings} pipLarge={pipLarge} pipRef={pipRef} audio={audio} clock={clock}
          onMove={sendMove} onAction={type => void action({ type }, true)} onLocal={s => setLocal(prev => (Math.abs(prev.stamina - s.stamina) > .02 || prev.crouch !== s.crouch || prev.light !== s.light || prev.sprinting !== s.sprinting) ? s : prev)}
          onCopyForChrome={() => void copyForChrome()} />
      </Suspense>
      <div className="hospital-reticle" aria-hidden="true" />
      <header className="hospital-hud">
        <div className="hospital-hud-left">
          <button className="hospital-hud-button" onClick={() => setPanel(v => !v)} aria-expanded={panel}>TAB <span>{isMonster ? "ПРИЁМЫ" : "ДЕЛО"}</span></button>
          <div className="hospital-hud-objective"><strong>{zoneName(game)}</strong><small>{game.phase === "intro" ? "ПРИБЫТИЕ" : isMonster ? (game.self.disguised ? "ТЫ ВЫГЛЯДИШЬ КАК СПУТНИК" : "ТЕБЯ ВИДНО. ОХОТЬСЯ") : game.power ? "К ГЛАВНОМУ ВХОДУ" : "ИЩИТЕ ИСТОРИИ ПАЦИЕНТОВ"}</small></div>
        </div>
        <div className="hospital-hud-right">
          <span className={`hospital-timer ${game.phase === "playing" && game.endsAt - now < 60_000 ? "urgent" : ""}`}>{game.phase === "playing" ? timer(game.endsAt - now) : game.phase === "intro" ? timer(game.introEndsAt - now) : "—:—"}</span>
          <button className="hospital-icon-button" onClick={() => void fullscreen()} aria-label="Полный экран" title="Полный экран">⛶</button>
        </div>
      </header>

      {!isMonster && game.phase !== "waiting" && <VisitorHud game={game} local={local} now={now} hint={hint} hold={hold} />}
      {isMonster && game.phase !== "waiting" && <>
        <MonsterHud game={game} now={now} onTrick={trigger} onToggleForm={() => void action({ type: "disguise" })} />
        <div ref={pipRef} className={`hospital-pip ${pipLarge ? "large" : ""}`} onClick={() => setPipLarge(v => !v)} role="button" aria-label="Изменить размер окна глаз друга">
          <span><i />ГЛАЗА: {game.names.player.toUpperCase()}</span><small>{pipLarge ? "P · МЕНЬШЕ" : "P · БОЛЬШЕ"}</small>
        </div>
        {showMap && game.phase === "playing" && <Minimap game={game} lastSeen={lastSeen} now={now} />}
        {hint && <div className="hospital-interaction">{hint.text}</div>}
      </>}
      {!isMonster && game.phase === "playing" && now < game.introEndsAt + 30_000 && <div className="hospital-bottom-hint">WASD · SHIFT бег · C присесть · E действие · F фонарь · Q вспышка · TAB дело</div>}
      {intro && <div className="hospital-intro-caption"><span>{intro.kicker}</span><h2>{intro.title}</h2><p>{intro.text}</p></div>}
      {cinematic && <div className="hospital-cinematic-cut" aria-hidden="true"><span>{cinematic}</span></div>}
      {hidden && <LockerView />}
      {radio && !isMonster && <RadioLine name={radio.name} text={radio.text} at={radio.at} />}
      {reading !== null && !isMonster && <DocumentReader story={reading} onClose={() => setReading(null)} />}
      {fakeLag > now && !isMonster && <FakeLag until={fakeLag} now={now} />}
      {screamer && <Screamer variant={screamer.variant} caught={screamer.caught} duration={screamer.caught ? 2300 : 1400} />}
      {game.phase === "waiting" && <Waiting code={code} inviteUrl={inviteUrl} side={game.side} onCopy={() => void copy(inviteUrl)} />}
      {chromeUrl && <div className="hospital-modal-scrim"><div className="hospital-modal"><p className="hospital-kicker">ЗАХВАТ МЫШИ</p><h2>Откройте в Chrome</h2><p>Скопируйте личную ссылку в обычный Chrome. Вы вернётесь в ту же комнату и к той же роли. Эту ссылку нельзя отправлять другу.</p><input readOnly value={chromeUrl} aria-label="Личная ссылка для Chrome" onFocus={e => e.currentTarget.select()} onClick={e => e.currentTarget.select()} /><button className="hospital-primary" onClick={() => void copyForChrome()}>Скопировать личную ссылку</button><button className="hospital-plain" onClick={() => setChromeUrl("")}>Вернуться в игру</button></div></div>}
      {game.phase === "ended" && !screamer && <Ending game={game} onRematch={swap => void action({ type: "rematch", swap })} onLeave={leave} />}
      {panel && <Panel game={game} code={code} settings={settings} setSettings={setSettings} onClose={() => setPanel(false)} onLeave={leave}
        onTrick={t => { trigger(t); if (!t.input) setPanel(false); }} onForm={() => void action({ type: "disguise" })} onRead={id => { setReading(id); setPanel(false); }} now={now} />}
      {textTrick && <TextTrick kind={textTrick} friend={game.names.player} onSend={sendText} onClose={() => setTextTrick(null)} />}
      {game.phase !== "waiting" && !game.otherConnected && game.phase !== "ended" && <div className="hospital-offline">Второй игрок не на связи…</div>}
    </section>}
    {error && <div className="hospital-error" role="alert">{error}<button onClick={() => setError("")} aria-label="Закрыть">×</button></div>}
    {note && <div className="hospital-note" role="status">{note}</div>}
  </main>;
}
