/** Integer coordinates are tile centres; positions between them are continuous. */
export const MAP = [
  "###########################",
  "#.........................#",
  "#.###.####.#...#######.##.#",
  "#......#..........#.......#",
  "#.........................#",
  "#......#..........#.......#",
  "#.##.#####.#...########.#.#",
  "#.........................#",
  "#.##.#####.#...###.####.#.#",
  "#......#............#.....#",
  "#.........................#",
  "#......#............#.....#",
  "#.###.###.##...##.###.###.#",
  "#.........................#",
  "#.###.####.#...##.###.###.#",
  "#.........................#",
  "#......#............#.....#",
  "#########.........#########",
  "###########################",
];

export type Point = { x: number; y: number };
export type Pose = Point & { yaw: number; pitch: number };
export type Side = "player" | "monster";
export type Phase = "waiting" | "intro" | "playing" | "ended";
export type Event = { id: string; type: string; x: number; y: number; at: number; until: number; variant?: number };
export type Game = {
  layoutVersion?: number;
  phase: Phase; round: number; startedAt: number; introEndsAt: number; endsAt: number; winner: Side | null; reason: string;
  player: Pose & { hidden: boolean; flares: number; stunnedUntil: number; lastMove: number };
  monster: Pose & { energy: number; lastEnergy: number; lastMove: number; stunnedUntil: number; disguised: boolean };
  fuses: Array<Point & { found: boolean }>;
  switch: Point; power: boolean; exit: Point; lockers: Point[]; cameras: Point[];
  lightsUntil: number[]; lockUntil: number; cooldowns: Record<string, number>;
  events: Event[]; votes: { player: boolean; monster: boolean }; lastKnown: Point & { at: number };
};

// One clue is chosen in each wing so the search crosses varied rooms.
export const EVIDENCE_AREAS: Point[][] = [
  [{ x: 4, y: 4 }, { x: 4, y: 10 }, { x: 4, y: 15 }],
  [{ x: 10, y: 4 }, { x: 10, y: 10 }, { x: 10, y: 15 }],
  [{ x: 16, y: 4 }, { x: 16, y: 10 }, { x: 16, y: 15 }],
  [{ x: 23, y: 4 }, { x: 23, y: 10 }, { x: 23, y: 15 }],
];
export const LOCKERS: Point[] = [{ x: 3, y: 3 }, { x: 10, y: 9 }, { x: 17, y: 11 }, { x: 24, y: 15 }];
export const CAMERAS: Point[] = [{ x: 5, y: 7 }, { x: 13, y: 7 }, { x: 21, y: 13 }, { x: 13, y: 15 }];
export const INTRO_MS = 18_000;
export const ROUND_MS = 12 * 60_000;
const BODY_RADIUS = .23;
const PLAYER_SPEED = 1.8; // tile centres per second
const MONSTER_SPEED = 1.95;

export function dist(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function open(x: number, y: number) {
  return Number.isFinite(x) && Number.isFinite(y) && MAP[Math.floor(y + .5)]?.[Math.floor(x + .5)] === ".";
}
export function zone(x: number) { return x < 9 ? 0 : x < 18 ? 1 : 2; }
function event(type: string, x: number, y: number, now: number, life = 3500, variant?: number): Event {
  return { id: crypto.randomUUID(), type, x, y, at: now, until: now + life, variant };
}

/** Existing D1 room JSON lacks the new pose and appearance fields. */
export function normalize(g: Game, now: number): Game {
  g.introEndsAt ??= g.startedAt || 0;
  g.player.yaw ??= -Math.PI / 2;
  g.player.pitch ??= 0;
  g.monster.yaw ??= -Math.PI / 2;
  g.monster.pitch ??= 0;
  g.monster.disguised ??= false;
  g.monster.lastEnergy ??= now;
  g.cooldowns ??= {};
  g.lightsUntil ??= [0, 0, 0];
  g.events ??= [];
  if (g.layoutVersion !== 2) {
    const nearest = (p: Point): Point => {
      if (canOccupy(p.x, p.y)) return { x: p.x, y: p.y };
      let best: Point = { x: 12, y: 16 }, gap = Infinity;
      for (let y = 1; y < MAP.length - 1; y++) for (let x = 1; x < MAP[y].length - 1; x++) {
        if (!open(x, y)) continue;
        const distance = dist(p, { x, y });
        if (distance < gap) { best = { x, y }; gap = distance; }
      }
      return best;
    };
    Object.assign(g.player, nearest(g.player));
    Object.assign(g.monster, nearest(g.monster));
    g.lockers = LOCKERS;
    g.cameras = CAMERAS;
    if (g.phase === "waiting") {
      g.fuses = EVIDENCE_AREAS.map(area => ({ ...area[0], found: false }));
      g.switch = { x: 23, y: 3 };
      g.exit = { x: 13, y: 17 };
    } else {
      g.fuses = g.fuses.map(f => ({ ...f, ...nearest(f) }));
      g.switch = nearest(g.switch);
      g.exit = nearest(g.exit);
      // A locker from the archive may no longer exist at the same coordinate.
      if (g.player.hidden && !g.lockers.some(p => dist(p, g.player) <= .45)) g.player.hidden = false;
    }
    g.layoutVersion = 2;
  }
  return g;
}

export function makeGame(round = 1, now = Date.now()): Game {
  const clues = EVIDENCE_AREAS.map(area => ({ ...area[Math.floor(Math.random() * area.length)], found: false }));
  return {
    layoutVersion: 2,
    phase: "waiting", round, startedAt: 0, introEndsAt: 0, endsAt: 0, winner: null, reason: "",
    player: { x: 12, y: 17, yaw: -Math.PI / 2, pitch: 0, hidden: false, flares: 2, stunnedUntil: 0, lastMove: now },
    monster: { x: 14, y: 17, yaw: -Math.PI / 2, pitch: 0, energy: 100, lastEnergy: now, lastMove: now, stunnedUntil: 0, disguised: true },
    fuses: clues, switch: { x: 23, y: 3 }, power: false, exit: { x: 13, y: 17 }, lockers: LOCKERS, cameras: CAMERAS,
    lightsUntil: [0, 0, 0], lockUntil: 0, cooldowns: {}, events: [],
    votes: { player: false, monster: false }, lastKnown: { x: 12, y: 17, at: 0 },
  };
}

export function start(g: Game, now: number) {
  normalize(g, now);
  // Joining an older waiting room still begins at the shared car arrival.
  g.player.x = 12; g.player.y = 17; g.player.yaw = -Math.PI / 2; g.player.pitch = 0;
  g.monster.x = 14; g.monster.y = 17; g.monster.yaw = -Math.PI / 2; g.monster.pitch = 0;
  g.monster.disguised = true;
  g.phase = "intro";
  g.startedAt = now;
  g.introEndsAt = now + INTRO_MS;
  g.endsAt = g.introEndsAt + ROUND_MS;
  g.player.lastMove = now;
  g.monster.lastMove = now;
  g.events.push(event("start", 13, 17, now, INTRO_MS));
}

export function tick(g: Game, now: number) {
  normalize(g, now);
  if (g.phase === "intro" && now >= g.introEndsAt) {
    g.phase = "playing";
    g.player.x = 12; g.player.y = 16; g.player.yaw = -Math.PI / 2; g.player.pitch = 0;
    g.monster.x = 23; g.monster.y = 3; g.monster.yaw = Math.PI / 2; g.monster.pitch = 0;
    g.player.lastMove = now;
    g.monster.lastMove = now;
  }
  if (g.phase === "playing" && now >= g.endsAt) {
    g.phase = "ended"; g.winner = "monster"; g.reason = "Смена закончилась. Улики остались в больнице.";
  }
  g.monster.energy = Math.min(100, g.monster.energy + Math.max(0, now - g.monster.lastEnergy) * .0035);
  g.monster.lastEnergy = now;
  g.events = g.events.filter(e => e.until > now - 1000).slice(-24);
}

function canOccupy(x: number, y: number) {
  return open(x - BODY_RADIUS, y - BODY_RADIUS) && open(x + BODY_RADIUS, y - BODY_RADIUS) &&
    open(x - BODY_RADIUS, y + BODY_RADIUS) && open(x + BODY_RADIUS, y + BODY_RADIUS);
}
function slide(unit: Point, dx: number, dy: number) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / .08));
  for (let i = 0; i < steps; i++) {
    const sx = dx / steps, sy = dy / steps;
    if (canOccupy(unit.x + sx, unit.y)) unit.x += sx;
    if (canOccupy(unit.x, unit.y + sy)) unit.y += sy;
  }
}
function caught(g: Game, now: number) {
  if (g.player.hidden || g.monster.disguised || g.monster.stunnedUntil > now) return;
  if (dist(g.player, g.monster) <= .53) {
    g.phase = "ended"; g.winner = "monster"; g.reason = "Существо настигло вас в больнице.";
    g.events.push(event("caught", g.player.x, g.player.y, now, 5000, g.round % 3));
  }
}
function spend(g: Game, key: string, now: number, cost: number, cooldown: number) {
  if (g.monster.energy < cost) throw new Error("Недостаточно сил. Подождите восстановления.");
  if ((g.cooldowns[key] ?? 0) > now) throw new Error("Приём ещё восстанавливается.");
  g.monster.energy -= cost;
  g.cooldowns[key] = now + cooldown;
}
function look(unit: Pose, action: Record<string, unknown>) {
  if (action.yaw !== undefined) {
    if (typeof action.yaw !== "number" || !Number.isFinite(action.yaw)) throw new Error("Некорректный угол обзора.");
    unit.yaw = Math.atan2(Math.sin(action.yaw), Math.cos(action.yaw));
  }
  if (action.pitch !== undefined) {
    if (typeof action.pitch !== "number" || !Number.isFinite(action.pitch)) throw new Error("Некорректный угол обзора.");
    unit.pitch = Math.max(-1.48, Math.min(1.48, action.pitch));
  }
}

export function act(g: Game, side: Side, action: Record<string, unknown>, now: number): Game {
  tick(g, now);
  const kind = action.type;
  if (kind === "rematch") {
    if (g.phase !== "ended") throw new Error("Реванш доступен после финала.");
    g.votes[side] = true;
    if (g.votes.player && g.votes.monster) { const next = makeGame(g.round + 1, now); start(next, now); return next; }
    return g;
  }
  if (kind === "move") {
    if (g.phase !== "intro" && g.phase !== "playing") throw new Error("Движение пока недоступно.");
    const unit = side === "player" ? g.player : g.monster;
    const forward = action.forward ?? 0, strafe = action.strafe ?? 0;
    if (typeof forward !== "number" || typeof strafe !== "number" || !Number.isFinite(forward) || !Number.isFinite(strafe) || Math.abs(forward) > 1 || Math.abs(strafe) > 1) {
      throw new Error("Недопустимое направление.");
    }
    look(unit, action);
    const elapsed = Math.min(150, Math.max(0, now - unit.lastMove));
    unit.lastMove = now;
    // Arrival is a short shared scene, then both can walk in before separation.
    if (g.phase === "intro" && now < g.startedAt + 5000) return g;
    if (side === "player" && g.player.hidden) return g;
    if (side === "monster" && g.monster.stunnedUntil > now) return g;
    const magnitude = Math.hypot(forward, strafe);
    if (magnitude > 0 && elapsed > 0) {
      const scale = (side === "player" ? PLAYER_SPEED : MONSTER_SPEED) * (elapsed / 1000) / Math.max(1, magnitude);
      const dx = (Math.cos(unit.yaw) * forward - Math.sin(unit.yaw) * strafe) * scale;
      const dy = (Math.sin(unit.yaw) * forward + Math.cos(unit.yaw) * strafe) * scale;
      const beforeX = unit.x, beforeY = unit.y;
      slide(unit, dx, dy);
      if (dist(unit, { x: beforeX, y: beforeY }) > .11) {
        const type = side === "player" ? "step" : g.monster.disguised ? "step" : "heavy";
        if (!g.events.some(e => e.type === type && e.at > now - 550)) g.events.push(event(type, unit.x, unit.y, now, 900));
      }
      if (g.phase === "playing") caught(g, now);
    }
    return g;
  }
  if (g.phase !== "playing") throw new Error(g.phase === "intro" ? "Дождитесь, пока машина остановится." : g.phase === "waiting" ? "Ждём второго участника." : "Партия завершена.");

  if (side === "player") {
    if (kind === "interact") {
      if (g.player.hidden) { g.player.hidden = false; g.events.push(event("unhide", g.player.x, g.player.y, now)); return g; }
      const clue = g.fuses.find(f => !f.found && dist(g.player, f) <= 1.05);
      if (clue) { clue.found = true; g.events.push(event("fuse", clue.x, clue.y, now)); return g; }
      if (dist(g.player, g.switch) <= 1.05 && !g.power) {
        if (g.fuses.some(f => !f.found)) throw new Error("Сначала соберите все улики.");
        g.power = true; g.events.push(event("power", g.switch.x, g.switch.y, now, 5000)); return g;
      }
      if (dist(g.player, g.exit) <= 1.05) {
        if (!g.power) throw new Error("Выход заблокирован. Найдите улики и откройте пост охраны.");
        if (g.lockUntil > now) throw new Error("Дверь заклинило. Несколько секунд!");
        g.phase = "ended"; g.winner = "player"; g.reason = "Вы вынесли улики из больницы.";
        g.events.push(event("escape", g.exit.x, g.exit.y, now, 5000)); return g;
      }
      const locker = g.lockers.find(p => dist(g.player, p) <= .85);
      if (locker) { g.player.x = locker.x; g.player.y = locker.y; g.player.hidden = true; g.events.push(event("hide", locker.x, locker.y, now)); return g; }
      throw new Error("Рядом нечего использовать.");
    }
    if (kind === "flare") {
      if (g.player.flares <= 0) throw new Error("Вспышки закончились.");
      if ((g.cooldowns.flare ?? 0) > now) throw new Error("Фонарь перегрелся.");
      if (g.player.hidden) throw new Error("Из укрытия нельзя использовать вспышку.");
      g.player.flares--; g.cooldowns.flare = now + 16_000;
      if (dist(g.player, g.monster) <= 3) g.monster.stunnedUntil = now + 4200;
      g.events.push(event("flare", g.player.x, g.player.y, now, 2600)); return g;
    }
  } else {
    if (kind === "disguise") {
      g.monster.disguised = !g.monster.disguised;
      g.events.push(event(g.monster.disguised ? "disguise" : "reveal", g.monster.x, g.monster.y, now, 1400));
      caught(g, now);
      return g;
    }
    if (kind === "search") {
      const locker = g.lockers.find(p => dist(g.monster, p) <= 1.05);
      if (!locker) throw new Error("Подойдите к шкафу.");
      spend(g, "search", now, 10, 5000);
      g.events.push(event("search", locker.x, locker.y, now));
      if (g.player.hidden && dist(g.player, locker) <= .45) {
        g.phase = "ended"; g.winner = "monster"; g.reason = "Существо распахнуло ваш шкаф.";
        g.events.push(event("caught", locker.x, locker.y, now, 5000, (g.round + 1) % 3));
      }
      return g;
    }
    if (kind === "blackout") {
      const z = Number(action.zone);
      if (![0, 1, 2].includes(z)) throw new Error("Выберите сектор.");
      spend(g, "blackout", now, 28, 24_000);
      g.lightsUntil[z] = now + 12_000;
      g.events.push(event("blackout", z * 9 + 4, 10, now, 12_000)); return g;
    }
    if (kind === "knock") {
      const x = Number(action.x), y = Number(action.y);
      if (!open(x, y)) throw new Error("Выберите проход.");
      spend(g, "knock", now, 14, 10_000);
      g.events.push(event("knock", x, y, now, 5000, Math.floor(Math.random() * 2))); return g;
    }
    if (kind === "lock") {
      if (!g.power) throw new Error("Дверь ещё заблокирована.");
      spend(g, "lock", now, 32, 38_000);
      g.lockUntil = now + 8000; g.events.push(event("lock", g.exit.x, g.exit.y, now, 8000)); return g;
    }
    if (kind === "scare") {
      if (g.player.hidden || dist(g.player, g.monster) > 4.5) throw new Error("Подойдите ближе к посетителю.");
      spend(g, "scare", now, 26, 26_000);
      g.events.push(event("scare", g.player.x, g.player.y, now, 2200, Math.floor(Math.random() * 3))); return g;
    }
    const tricks: Record<string, { cost: number; cooldown: number; life: number }> = {
      sound: { cost: 22, cooldown: 14_000, life: 3000 },
      glitch: { cost: 18, cooldown: 20_000, life: 2200 },
      footsteps: { cost: 10, cooldown: 8000, life: 2600 },
      doorSlam: { cost: 18, cooldown: 12_000, life: 2200 },
      shadow: { cost: 24, cooldown: 18_000, life: 3500 },
    };
    if (typeof kind === "string" && kind in tricks) {
      const trick = tricks[kind];
      spend(g, kind, now, trick.cost, trick.cooldown);
      const near = kind === "footsteps" ? { x: g.player.x - Math.cos(g.player.yaw) * 1.3, y: g.player.y - Math.sin(g.player.yaw) * 1.3 } : g.player;
      const target = open(near.x, near.y) ? near : g.player;
      g.events.push(event(kind, target.x, target.y, now, trick.life, Math.floor(Math.random() * 3)));
      return g;
    }
  }
  throw new Error("Недоступное действие.");
}

export function view(g: Game, side: Side, now: number, connected: boolean, version: number) {
  normalize(g, now);
  const playerVisible = g.player.hidden ? dist(g.monster, g.player) <= 1 :
    dist(g.monster, g.player) <= 3.5 || g.cameras.some(c => dist(c, g.player) <= 3 && g.lightsUntil[zone(c.x)] <= now);
  const monsterVisible = dist(g.player, g.monster) <= (g.lightsUntil[zone(g.player.x)] > now ? 2.2 : 4.5) || g.monster.stunnedUntil > now;
  const common = {
    phase: g.phase, round: g.round, now, version, startedAt: g.startedAt, introEndsAt: g.introEndsAt, endsAt: g.endsAt,
    winner: g.winner, reason: g.reason,
    map: MAP, power: g.power, found: g.fuses.filter(f => f.found).length, switch: g.switch, exit: g.exit,
    lockers: g.lockers, cameras: g.cameras, lightsUntil: g.lightsUntil, lockUntil: g.lockUntil,
    events: g.events.filter(e => e.until > now && (
      side === "player"
        ? (e.type !== "heavy" || dist(g.player, e) <= 5)
        : (e.type !== "step" || dist(g.monster, e) <= 3 || g.cameras.some(c => dist(c, e) <= 3 && g.lightsUntil[zone(c.x)] <= now))
    )),
    votes: g.votes, otherConnected: connected,
  };
  if (side === "player") return {
    ...common, side, self: g.player,
    rival: monsterVisible ? { x: g.monster.x, y: g.monster.y, yaw: g.monster.yaw, pitch: g.monster.pitch, disguised: g.monster.disguised } : null,
    fuses: g.fuses.map(f => ({ x: f.found || dist(g.player, f) <= 4 ? f.x : null, y: f.found || dist(g.player, f) <= 4 ? f.y : null, found: f.found })),
    flareReadyAt: g.cooldowns.flare ?? 0,
  };
  return {
    ...common, side, self: g.monster,
    rival: playerVisible ? { x: g.player.x, y: g.player.y, yaw: g.player.yaw, pitch: g.player.pitch } : null,
    spectate: { x: g.player.x, y: g.player.y, yaw: g.player.yaw, pitch: g.player.pitch },
    fuses: g.fuses, cooldowns: g.cooldowns,
    cameraSignals: g.cameras.map(c => dist(c, g.player) <= 3 && g.lightsUntil[zone(c.x)] <= now && !g.player.hidden),
  };
}
