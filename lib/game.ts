import {
  ARRIVAL_MS, FLARES, INTRO_MS, LIVES, MAP, REACH, REVEAL_MS, ROUND_MS, SPOTS, STORIES,
  canOccupy, castToWall, dist, lineOfSight, maxSpeed, open, sector, slide, tileAt,
  type Phase, type Point, type Side,
} from "./hospital";

export { MAP };
export type { Phase, Point, Side };

export type PoseState = Point & {
  yaw: number; pitch: number;
  /** Server time of the last accepted move. */
  t: number;
  /** Highest client sequence number applied. */
  seq: number;
  /** Increments whenever the server teleports this body. */
  warp: number;
  /** Token bucket of distance the client may still cover. */
  budget: number;
  moving: boolean;
  crouch?: boolean;
  sprint?: boolean;
  light?: boolean;
  battery?: number;
  /** Battery timestamp, independent of the movement clock. */
  bt?: number;
};

export type Event = {
  id: string; type: string; x: number; y: number; at: number; until: number;
  variant?: number; text?: string; yaw?: number; face?: number; tx?: number; ty?: number; fx?: number; fy?: number;
};
export type Writing = { id: string; tx: number; ty: number; face: number; text: string; at: number };

export type Game = {
  layoutVersion: 3;
  hostSide: Side;
  names: { player: string; monster: string };
  phase: Phase; round: number; startedAt: number; introEndsAt: number; endsAt: number; endedAt: number;
  winner: Side | null; reason: string;
  pose: { player: PoseState; monster: PoseState };
  player: { hidden: number; flares: number; lives: number; stunnedUntil: number; safeUntil: number };
  monster: { energy: number; lastEnergy: number; disguised: boolean; revealedAt: number; formReadyAt: number; stunnedUntil: number };
  clues: Array<Point & { found: boolean; story: number }>;
  batteries: Array<Point & { taken: boolean }>;
  power: boolean; powerAt: number;
  lightsUntil: number[]; lockUntil: number; flickerUntil: number;
  cooldowns: Record<string, number>;
  events: Event[];
  writings: Writing[];
  votes: { player: "same" | "swap" | null; monster: "same" | "swap" | null };
  stats: { tricks: number; scares: number; catches: number; flared: number; hides: number; searches: number };
};

const ENERGY_PER_MS = .003;
const BATTERY_PER_MS = 100 / 420_000;
const BATTERY_PICKUP = 45;
const MAX_TEXT = 90;

export function other(side: Side): Side { return side === "player" ? "monster" : "player"; }

function event(g: Game, type: string, x: number, y: number, now: number, life = 3500, extra: Partial<Event> = {}) {
  const e: Event = { id: crypto.randomUUID(), type, x, y, at: now, until: now + life, ...extra };
  g.events.push(e);
  return e;
}
function pose(x: number, y: number, yaw: number, now: number, extra: Partial<PoseState> = {}): PoseState {
  return { x, y, yaw, pitch: 0, t: now, seq: 0, warp: 0, budget: 0, moving: false, ...extra };
}
function warp(p: PoseState, to: Point, yaw: number, now: number) {
  p.x = to.x; p.y = to.y; p.yaw = yaw; p.pitch = 0; p.t = now; p.budget = 0; p.moving = false; p.warp++;
}
function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}
export function cleanName(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 16) : "";
  return text || fallback;
}
function cleanText(value: unknown, max = MAX_TEXT) {
  const text = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  if (!text) throw new Error("Напишите текст сообщения.");
  return text;
}

export function makeGame(hostSide: Side, names: { player: string; monster: string }, round = 1, now = Date.now()): Game {
  const stories = shuffle(STORIES.map(s => s.id));
  return {
    layoutVersion: 3, hostSide, names,
    phase: "waiting", round, startedAt: 0, introEndsAt: 0, endsAt: 0, endedAt: 0, winner: null, reason: "",
    pose: {
      player: pose(SPOTS.arrival.player.x, SPOTS.arrival.player.y, -Math.PI / 2, now, { light: true, battery: 100, bt: now }),
      monster: pose(SPOTS.arrival.monster.x, SPOTS.arrival.monster.y, -Math.PI / 2, now),
    },
    player: { hidden: -1, flares: FLARES, lives: LIVES, stunnedUntil: 0, safeUntil: 0 },
    monster: { energy: 60, lastEnergy: now, disguised: true, revealedAt: 0, formReadyAt: 0, stunnedUntil: 0 },
    clues: SPOTS.clueAreas.map((area, i) => ({ ...area[Math.floor(Math.random() * area.length)], found: false, story: stories[i] })),
    batteries: shuffle(SPOTS.batteries).slice(0, 6).map(p => ({ ...p, taken: false })),
    power: false, powerAt: 0,
    lightsUntil: [0, 0, 0], lockUntil: 0, flickerUntil: 0,
    cooldowns: {}, events: [], writings: [],
    votes: { player: null, monster: null },
    stats: { tricks: 0, scares: 0, catches: 0, flared: 0, hides: 0, searches: 0 },
  };
}

export function start(g: Game, now: number) {
  g.phase = "intro";
  g.startedAt = now;
  g.introEndsAt = now + INTRO_MS;
  g.endsAt = g.introEndsAt + ROUND_MS;
  warp(g.pose.player, SPOTS.arrival.player, -Math.PI / 2, now);
  warp(g.pose.monster, SPOTS.arrival.monster, -Math.PI / 2, now);
  g.pose.player.bt = now;
  g.monster.disguised = true;
  g.monster.lastEnergy = now;
  event(g, "start", 22, 30, now, INTRO_MS);
}

/** Applies time-driven transitions. Returns true when the change must be persisted. */
export function tick(g: Game, now: number) {
  let dirty = false;
  if (g.phase === "intro" && now >= g.introEndsAt) {
    g.phase = "playing";
    warp(g.pose.player, SPOTS.start.player, -Math.PI / 2, now);
    warp(g.pose.monster, SPOTS.start.monster, Math.PI / 2, now);
    g.pose.player.bt = now;
    g.monster.disguised = true;
    g.monster.formReadyAt = now + 4000;
    event(g, "separate", SPOTS.start.player.x, SPOTS.start.player.y, now, 4000);
    dirty = true;
  }
  if (g.phase === "playing" && now >= g.endsAt) {
    finish(g, "monster", "Смена закончилась. Корпус оставил вас себе.", now);
    dirty = true;
  }
  g.monster.energy = Math.min(100, g.monster.energy + Math.max(0, now - g.monster.lastEnergy) * ENERGY_PER_MS);
  g.monster.lastEnergy = now;
  const p = g.pose.player;
  if (p.bt !== undefined) {
    const lightOn = p.light && g.phase === "playing" && g.player.hidden < 0;
    p.battery = Math.max(0, (p.battery ?? 100) - (lightOn ? Math.max(0, now - p.bt) * BATTERY_PER_MS : 0));
    p.bt = now;
    if (p.battery <= 0) p.light = false;
  }
  g.events = g.events.filter(e => e.until > now - 1500).slice(-40);
  return dirty;
}

function finish(g: Game, winner: Side, reason: string, now: number) {
  g.phase = "ended"; g.winner = winner; g.reason = reason; g.endedAt = now;
}

function dangerous(g: Game, now: number) {
  return !g.monster.disguised && now >= g.monster.revealedAt + REVEAL_MS && g.monster.stunnedUntil <= now;
}

function hurt(g: Game, now: number, how: "caught" | "locker") {
  const p = g.pose.player, m = g.pose.monster;
  g.player.lives--;
  g.stats.catches++;
  event(g, "caught", p.x, p.y, now, 2600, { variant: how === "locker" ? 1 : 0, yaw: Math.atan2(m.y - p.y, m.x - p.x) });
  g.player.hidden = -1;
  if (g.player.lives <= 0) {
    finish(g, "monster", how === "locker" ? "Существо распахнуло шкаф. Бежать было некуда." : "Существо настигло вас в темноте.", now);
    return;
  }
  // The visitor tears free and comes to somewhere far from the creature.
  const spot = [...SPOTS.respawns].sort((a, b) => dist(b, m) - dist(a, m))[Math.floor(Math.random() * 2)];
  warp(p, spot, Math.random() * Math.PI * 2, now);
  g.player.stunnedUntil = now + 2600;
  g.player.safeUntil = now + 8000;
  g.monster.stunnedUntil = now + 3200;
  g.monster.disguised = true;
  g.monster.formReadyAt = now + 7000;
  event(g, "wake", spot.x, spot.y, now, 5200, { variant: g.player.lives });
}

function tryCatch(g: Game, now: number, reach = REACH) {
  if (g.phase !== "playing" || !dangerous(g, now)) return false;
  if (g.player.hidden >= 0 || g.player.safeUntil > now) return false;
  if (dist(g.pose.player, g.pose.monster) > reach) return false;
  hurt(g, now, "caught");
  return true;
}

function spend(g: Game, key: string, now: number, cost: number, cooldown: number) {
  if ((g.cooldowns[key] ?? 0) > now) throw new Error("Приём ещё восстанавливается.");
  if (g.monster.energy < cost) throw new Error("Недостаточно сил. Подождите восстановления.");
  g.monster.energy -= cost;
  g.cooldowns[key] = now + cooldown;
  g.stats.tricks++;
}

function number(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Некорректное значение: ${name}.`);
  return value;
}
function look(unit: PoseState, input: Record<string, unknown>) {
  if (input.yaw !== undefined) { const yaw = number(input.yaw, "yaw"); unit.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw)); }
  if (input.pitch !== undefined) unit.pitch = Math.max(-1.5, Math.min(1.5, number(input.pitch, "pitch")));
}

/**
 * Client reports where it believes it is; the server replays that path through
 * the same collision code and limits it with a per-body distance allowance.
 * Returns true when shared state (not just this pose) changed.
 */
export function move(g: Game, side: Side, input: Record<string, unknown>, now: number) {
  if (g.phase !== "intro" && g.phase !== "playing") return false;
  const unit = g.pose[side];
  look(unit, input);
  const seq = input.seq === undefined ? unit.seq : number(input.seq, "seq");
  const elapsed = Math.min(1000, Math.max(0, now - unit.t));
  const speed = maxSpeed(side) * 1.15;
  unit.budget = Math.min(speed * .6, unit.budget + elapsed / 1000 * speed);
  unit.t = now;
  unit.moving = false;
  // A client still acting on a pre-teleport position is ignored until it catches up.
  const warpSeen = input.warp === undefined || input.warp === unit.warp;
  if (seq > unit.seq) unit.seq = seq;
  if (side === "player") {
    unit.crouch = !!input.crouch;
    unit.sprint = !!input.sprint && !unit.crouch;
    unit.light = !!input.light && (unit.battery ?? 0) > 0;
  }
  const frozen = (g.phase === "intro" && now < g.startedAt + ARRIVAL_MS)
    || (side === "player" && (g.player.hidden >= 0 || g.player.stunnedUntil > now))
    || (side === "monster" && (g.monster.stunnedUntil > now || (!g.monster.disguised && now < g.monster.revealedAt + REVEAL_MS)));
  if (frozen || !warpSeen || input.x === undefined || input.y === undefined) return tryCatch(g, now);
  const tx = number(input.x, "x"), ty = number(input.y, "y");
  let dx = tx - unit.x, dy = ty - unit.y;
  const want = Math.hypot(dx, dy);
  if (want > 5) return tryCatch(g, now);
  if (want > unit.budget) { const k = unit.budget / want; dx *= k; dy *= k; }
  const before = { x: unit.x, y: unit.y };
  slide(unit, dx, dy, g.phase);
  const moved = dist(before, unit);
  unit.budget = Math.max(0, unit.budget - moved);
  unit.moving = moved > .01;
  return tryCatch(g, now);
}

function behind(target: { x: number; y: number; yaw: number }, distance: number) {
  let best = { x: target.x, y: target.y };
  for (let d = .3; d <= distance; d += .1) {
    const p = { x: target.x - Math.cos(target.yaw) * d, y: target.y - Math.sin(target.yaw) * d };
    if (!open(p.x, p.y)) break;
    best = p;
  }
  return best;
}
/** A spot in the target's field of view, preferring the edge of vision. */
function ahead(from: { x: number; y: number; yaw: number }, min: number, max: number) {
  const offsets = Math.random() < .5 ? [.38, -.38, .22, -.22, 0] : [-.38, .38, -.22, .22, 0];
  for (const off of offsets) {
    let best: Point | null = null;
    const yaw = from.yaw + off;
    for (let d = .5; d <= max; d += .25) {
      const p = { x: from.x + Math.cos(yaw) * d, y: from.y + Math.sin(yaw) * d };
      if (!open(p.x, p.y) || !lineOfSight(from, p)) break;
      if (d >= min && canOccupy(p.x, p.y)) best = p;
    }
    if (best) return best;
  }
  return null;
}
function nearestDoor(p: Point, range: number) {
  let best: Point | null = null, gap = range;
  for (let y = 0; y < MAP.length; y++) for (let x = 0; x < MAP[y].length; x++) {
    if (MAP[y][x] !== "d") continue;
    const d = dist(p, { x, y });
    if (d < gap) { gap = d; best = { x, y }; }
  }
  return best;
}
function roamSpot(p: Point, min: number, max: number) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const a = Math.random() * Math.PI * 2, d = min + Math.random() * (max - min);
    const q = { x: Math.round(p.x + Math.cos(a) * d), y: Math.round(p.y + Math.sin(a) * d) };
    if (open(q.x, q.y) && tileAt(q.x, q.y) !== "o") return q;
  }
  return { x: p.x, y: p.y };
}

type Trick = { cost: number; cooldown: number; life: number };
export const TRICKS: Record<string, Trick> = {
  whisper: { cost: 12, cooldown: 9_000, life: 3_200 },
  footsteps: { cost: 10, cooldown: 8_000, life: 3_600 },
  doorSlam: { cost: 16, cooldown: 12_000, life: 3_000 },
  knock: { cost: 8, cooldown: 6_000, life: 2_400 },
  flicker: { cost: 22, cooldown: 22_000, life: 4_800 },
  shadow: { cost: 20, cooldown: 16_000, life: 2_600 },
  phantom: { cost: 26, cooldown: 24_000, life: 6_000 },
  scare: { cost: 32, cooldown: 28_000, life: 2_000 },
  glitch: { cost: 20, cooldown: 22_000, life: 2_600 },
  blackout: { cost: 28, cooldown: 30_000, life: 12_000 },
  lock: { cost: 30, cooldown: 40_000, life: 8_000 },
  laugh: { cost: 14, cooldown: 14_000, life: 6_500 },
  phone: { cost: 14, cooldown: 18_000, life: 6_000 },
  breath: { cost: 12, cooldown: 12_000, life: 3_000 },
  radio: { cost: 6, cooldown: 3_500, life: 6_500 },
  voice: { cost: 16, cooldown: 10_000, life: 5_000 },
  write: { cost: 18, cooldown: 15_000, life: 4_000 },
};

export function act(g: Game, side: Side, action: Record<string, unknown>, now: number): { game: Game; replaced?: boolean } {
  tick(g, now);
  const kind = action.type;
  if (kind === "rematch") {
    if (g.phase !== "ended") throw new Error("Реванш доступен после финала.");
    g.votes[side] = action.swap ? "swap" : "same";
    const { player, monster } = g.votes;
    if (player && monster) {
      const hostSide = player === "swap" && monster === "swap" ? other(g.hostSide) : g.hostSide;
      const names = hostSide === g.hostSide ? g.names : { player: g.names.monster, monster: g.names.player };
      const next = makeGame(hostSide, names, g.round + 1, now);
      start(next, now);
      return { game: next, replaced: true };
    }
    return { game: g };
  }
  if (g.phase !== "playing") {
    throw new Error(g.phase === "intro" ? "Сначала войдите в корпус." : g.phase === "waiting" ? "Ждём второго участника." : "Партия завершена.");
  }
  const p = g.pose.player, m = g.pose.monster;

  if (side === "player") {
    if (g.player.stunnedUntil > now) throw new Error("Вы ещё не пришли в себя.");
    if (kind === "interact") {
      if (g.player.hidden >= 0) {
        const locker = SPOTS.lockers[g.player.hidden];
        g.player.hidden = -1;
        event(g, "unhide", locker.x, locker.y, now, 1500, { variant: SPOTS.lockers.indexOf(locker) });
        return { game: g };
      }
      const clue = g.clues.find(c => !c.found && dist(p, c) <= 1.15);
      if (clue) {
        clue.found = true;
        event(g, "clue", clue.x, clue.y, now, 3500, { variant: clue.story });
        if (g.clues.every(c => c.found)) event(g, "allClues", clue.x, clue.y, now, 4000);
        return { game: g };
      }
      const battery = g.batteries.find(b => !b.taken && dist(p, b) <= 1.05);
      if (battery) {
        battery.taken = true;
        p.battery = Math.min(100, (p.battery ?? 0) + BATTERY_PICKUP);
        event(g, "battery", battery.x, battery.y, now, 1500);
        return { game: g };
      }
      if (dist(p, SPOTS.switch) <= 1.25 && !g.power) {
        if (g.clues.some(c => !c.found)) throw new Error("Щиток не поддаётся. Сначала соберите все четыре истории.");
        g.power = true; g.powerAt = now;
        event(g, "power", SPOTS.switch.x, SPOTS.switch.y, now, 6000);
        return { game: g };
      }
      if (dist(p, SPOTS.exit) <= 1.3) {
        if (!g.power) throw new Error("Главный вход заперт. Ключи и щиток — на посту охраны.");
        if (g.lockUntil > now) throw new Error("Дверь заклинило! Ещё несколько секунд…");
        finish(g, "player", "Вы вынесли истории пациентов из корпуса.", now);
        event(g, "escape", SPOTS.exit.x, SPOTS.exit.y + 1, now, 6000);
        return { game: g };
      }
      const index = SPOTS.lockers.findIndex(l => dist(p, l) <= .95);
      if (index >= 0) {
        const locker = SPOTS.lockers[index];
        g.player.hidden = index;
        g.stats.hides++;
        p.x = locker.x; p.y = locker.y; p.moving = false; p.warp++;
        event(g, "hide", locker.x, locker.y, now, 1500, { variant: index });
        return { game: g };
      }
      throw new Error("Рядом нечего использовать.");
    }
    if (kind === "flare") {
      if (g.player.hidden >= 0) throw new Error("Из шкафа вспышку не использовать.");
      if (g.player.flares <= 0) throw new Error("Вспышки закончились.");
      if ((g.cooldowns.flare ?? 0) > now) throw new Error("Вспышка перезаряжается.");
      g.player.flares--; g.cooldowns.flare = now + 9000;
      const d = dist(p, m);
      const bearing = Math.atan2(m.y - p.y, m.x - p.x) - p.yaw;
      const facing = Math.cos(bearing) > Math.cos(1.2);
      const hit = d <= 4.3 && (facing || d < 1.2) && lineOfSight(p, m);
      if (hit) { g.monster.stunnedUntil = now + 4500; g.stats.flared++; }
      event(g, "flare", p.x, p.y, now, 2600, { variant: hit ? 1 : 0 });
      return { game: g };
    }
    throw new Error("Недоступное действие.");
  }

  // Monster
  if (kind === "disguise") {
    if (g.monster.formReadyAt > now) throw new Error("Облик ещё не устоялся.");
    if (g.monster.stunnedUntil > now) throw new Error("Вы оглушены.");
    g.monster.disguised = !g.monster.disguised;
    g.monster.formReadyAt = now + (g.monster.disguised ? 1500 : 2500);
    if (!g.monster.disguised) g.monster.revealedAt = now;
    event(g, g.monster.disguised ? "disguise" : "reveal", m.x, m.y, now, g.monster.disguised ? 1400 : REVEAL_MS + 400);
    return { game: g };
  }
  if (kind === "search") {
    const index = SPOTS.lockers.findIndex(l => dist(m, l) <= 1.15);
    if (index < 0) throw new Error("Подойдите к шкафу.");
    spend(g, "search", now, 8, 4000);
    g.stats.searches++;
    const locker = SPOTS.lockers[index];
    event(g, "search", locker.x, locker.y, now, 2200, { variant: index });
    if (g.player.hidden === index) {
      if (g.monster.disguised) {
        // A friendly face opening the door just lets them out.
        g.player.hidden = -1;
        event(g, "unhide", locker.x, locker.y, now, 1500, { variant: index });
      } else hurt(g, now, "locker");
    }
    return { game: g };
  }
  if (kind === "lunge") {
    if (g.monster.disguised) throw new Error("Сначала раскройтесь (G).");
    if (!dangerous(g, now)) throw new Error("Ещё не готовы к броску.");
    spend(g, "lunge", now, 14, 6500);
    const from = { x: m.x, y: m.y };
    slide(m, Math.cos(m.yaw) * 1.7, Math.sin(m.yaw) * 1.7, g.phase);
    m.warp++; m.moving = true;
    event(g, "lunge", from.x, from.y, now, 900, { fx: m.x, fy: m.y });
    tryCatch(g, now, REACH * 1.25);
    return { game: g };
  }
  if (typeof kind !== "string" || !(kind in TRICKS)) throw new Error("Недоступное действие.");
  const trick = TRICKS[kind];
  const target = { x: p.x, y: p.y, yaw: p.yaw };
  let extra: Partial<Event> = { variant: Math.floor(Math.random() * 3) };
  let at: Point = target;
  if (kind === "lock" && !g.power) throw new Error("Выход ещё обесточен — его и так не открыть.");
  if (kind === "whisper") at = behind(target, 1.2);
  else if (kind === "breath") at = behind(target, .7);
  else if (kind === "footsteps") { const start = behind(target, 5); extra = { ...extra, fx: start.x, fy: start.y }; at = behind(target, .8); }
  else if (kind === "doorSlam") at = nearestDoor(target, 9) ?? roamSpot(target, 2, 4);
  else if (kind === "knock") at = roamSpot(target, 1, 2);
  else if (kind === "laugh" || kind === "phone") at = roamSpot(target, 3, 6);
  else if (kind === "shadow" || kind === "phantom") {
    const spot = ahead(target, kind === "shadow" ? 4.5 : 3.5, kind === "shadow" ? 10 : 8);
    if (!spot) throw new Error("Друг смотрит в стену — видению негде появиться.");
    at = spot;
    extra.yaw = Math.atan2(target.y - spot.y, target.x - spot.x);
  } else if (kind === "blackout") {
    extra.variant = sector(target.x);
  } else if (kind === "radio" || kind === "voice") {
    extra.text = cleanText(action.text);
  } else if (kind === "write") {
    const text = cleanText(action.text, 22).toUpperCase();
    const hit = castToWall(target, target.yaw, 12);
    if (!hit) throw new Error("Перед другом нет стены для надписи.");
    extra = { ...extra, text, tx: hit.tile.x, ty: hit.tile.y, face: hit.face };
  }
  spend(g, kind, now, trick.cost, trick.cooldown);
  if (kind === "flicker") g.flickerUntil = now + trick.life;
  if (kind === "blackout") g.lightsUntil[sector(target.x)] = now + trick.life;
  if (kind === "lock") g.lockUntil = now + trick.life;
  if (kind === "scare") g.stats.scares++;
  if (kind === "write") {
    g.writings.push({ id: crypto.randomUUID(), tx: extra.tx!, ty: extra.ty!, face: extra.face!, text: extra.text!, at: now });
    g.writings = g.writings.slice(-10);
  }
  event(g, kind, at.x, at.y, now, trick.life, extra);
  return { game: g };
}

function visibleToPlayer(g: Game) {
  const p = g.pose.player, m = g.pose.monster;
  if (g.phase !== "playing") return true;
  const d = dist(p, m);
  return d <= 2.2 || (d <= 15 && lineOfSight(p, m));
}
function visibleToMonster(g: Game) {
  const p = g.pose.player, m = g.pose.monster;
  if (g.phase !== "playing") return true;
  if (g.player.hidden >= 0) return false;
  const d = dist(p, m);
  return d <= 2.5 || (d <= 16 && lineOfSight(p, m));
}
function cameraSignals(g: Game, now: number) {
  const p = g.pose.player;
  return SPOTS.cameras.map(c => g.player.hidden < 0 && dist(c, p) <= 4.5 && g.lightsUntil[sector(c.x)] <= now && lineOfSight(c, p));
}

const PLAYER_EVENTS = new Set(["start", "separate", "clue", "allClues", "battery", "power", "escape", "caught", "wake", "hide", "unhide", "flare"]);

export function view(g: Game, side: Side, now: number, connected: boolean, version: number) {
  const p = g.pose.player, m = g.pose.monster;
  const d = dist(p, m);
  const seesMonster = visibleToPlayer(g);
  const seesPlayer = visibleToMonster(g);
  const cams = cameraSignals(g, now);
  const events = g.events.filter(e => {
    if (e.until <= now) return false;
    if (side === "monster") {
      if (e.type === "hide" || e.type === "unhide") return dist(m, e) <= 5 || cams.some(Boolean);
      if (e.type === "flare") return dist(m, e) <= 6;
      return true;
    }
    if (PLAYER_EVENTS.has(e.type) || e.type in TRICKS) return true;
    if (e.type === "reveal" || e.type === "disguise" || e.type === "lunge") return seesMonster || dist(p, e) <= 7;
    if (e.type === "search") return dist(p, e) <= 8;
    return false;
  });
  const common = {
    phase: g.phase, side, round: g.round, now, version,
    startedAt: g.startedAt, introEndsAt: g.introEndsAt, endsAt: g.endsAt, endedAt: g.endedAt,
    winner: g.winner, reason: g.reason, hostSide: g.hostSide, names: g.names,
    power: g.power, powerAt: g.powerAt, lightsUntil: g.lightsUntil, lockUntil: g.lockUntil, flickerUntil: g.flickerUntil,
    found: g.clues.filter(c => c.found).length, total: g.clues.length,
    stories: g.clues.filter(c => c.found).map(c => c.story),
    writings: g.writings, events, votes: g.votes, otherConnected: connected, stats: g.stats,
  };
  if (side === "player") {
    const noiseRange = m.moving && now - m.t < 450 ? (g.monster.disguised ? 5.5 : 9) : 0;
    return {
      ...common,
      self: {
        x: p.x, y: p.y, yaw: p.yaw, pitch: p.pitch, seq: p.seq, warp: p.warp,
        hidden: g.player.hidden, flares: g.player.flares, lives: g.player.lives, battery: p.battery ?? 0, light: !!p.light,
        stunnedUntil: g.player.stunnedUntil, safeUntil: g.player.safeUntil, flareReadyAt: g.cooldowns.flare ?? 0,
      },
      rival: seesMonster ? {
        x: m.x, y: m.y, yaw: m.yaw, pitch: m.pitch, t: m.t, moving: m.moving && now - m.t < 450,
        disguised: g.monster.disguised, revealedAt: g.monster.revealedAt, stunned: g.monster.stunnedUntil > now,
      } : null,
      noise: !seesMonster && d <= noiseRange ? { x: m.x, y: m.y, heavy: !g.monster.disguised } : null,
      clues: g.clues.map(c => {
        const known = c.found || dist(p, c) <= 3 || (dist(p, c) <= 9 && lineOfSight(p, c));
        return { x: known ? c.x : null, y: known ? c.y : null, found: c.found };
      }),
      batteries: g.batteries.filter(b => !b.taken && dist(p, b) <= 10).map(b => ({ x: b.x, y: b.y })),
    };
  }
  const heard = g.player.hidden < 0 && p.moving && now - p.t < 450 && !p.crouch && d <= (p.sprint ? 11 : 5.5);
  return {
    ...common,
    self: {
      x: m.x, y: m.y, yaw: m.yaw, pitch: m.pitch, seq: m.seq, warp: m.warp,
      energy: g.monster.energy, disguised: g.monster.disguised, revealedAt: g.monster.revealedAt,
      formReadyAt: g.monster.formReadyAt, stunnedUntil: g.monster.stunnedUntil,
    },
    cooldowns: g.cooldowns,
    rival: seesPlayer ? { x: p.x, y: p.y, yaw: p.yaw, pitch: p.pitch, t: p.t, moving: p.moving && now - p.t < 450, light: !!p.light, crouch: !!p.crouch } : null,
    noise: heard && !seesPlayer ? { x: p.x, y: p.y, heavy: false } : null,
    spectate: { x: p.x, y: p.y, yaw: p.yaw, pitch: p.pitch, t: p.t, warp: p.warp, light: !!p.light && g.flickerUntil <= now, crouch: !!p.crouch, hidden: g.player.hidden },
    friend: {
      lives: g.player.lives, flares: g.player.flares, battery: Math.round(p.battery ?? 0), hidden: g.player.hidden >= 0,
      detected: seesPlayer || heard || cams.some(Boolean), safe: g.player.safeUntil > now,
    },
    cameraSignals: cams,
    clues: g.clues.map(c => ({ x: c.x, y: c.y, found: c.found })),
    batteries: g.batteries.filter(b => !b.taken).map(b => ({ x: b.x, y: b.y })),
  };
}
