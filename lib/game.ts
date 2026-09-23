export const MAP = [
  "###################",
  "#.................#",
  "#.###..####..###..#",
  "#...#.....#.......#",
  "#.#.#.###.#.###.#.#",
  "#.#...#...#...#.#.#",
  "#.#####.#####.#.#.#",
  "#.....#.......#...#",
  "###.#.#.#####.###.#",
  "#...#.....#.......#",
  "#.###.###.#.###.#.#",
  "#.................#",
  "###################",
];

export type Point = { x: number; y: number };
export type Side = "player" | "monster";
export type Phase = "waiting" | "playing" | "ended";
export type Event = { id: string; type: string; x: number; y: number; at: number; until: number; variant?: number };
export type Game = {
  phase: Phase; round: number; startedAt: number; endsAt: number; winner: Side | null; reason: string;
  player: Point & { hidden: boolean; flares: number; stunnedUntil: number; lastMove: number };
  monster: Point & { energy: number; lastEnergy: number; lastMove: number; stunnedUntil: number };
  fuses: Array<Point & { found: boolean }>;
  switch: Point; power: boolean; exit: Point; lockers: Point[]; cameras: Point[];
  lightsUntil: number[]; lockUntil: number; cooldowns: Record<string, number>;
  events: Event[]; votes: { player: boolean; monster: boolean }; lastKnown: Point & { at: number };
};

export const FUSE_SPOTS: Point[] = [
  { x: 3, y: 3 }, { x: 9, y: 3 }, { x: 15, y: 3 }, { x: 5, y: 5 },
  { x: 11, y: 7 }, { x: 7, y: 9 }, { x: 15, y: 9 }, { x: 3, y: 11 }, { x: 13, y: 11 },
];
export const LOCKERS: Point[] = [{ x: 1, y: 5 }, { x: 9, y: 5 }, { x: 5, y: 9 }, { x: 17, y: 7 }];
export const CAMERAS: Point[] = [{ x: 3, y: 1 }, { x: 9, y: 3 }, { x: 13, y: 7 }, { x: 9, y: 11 }];

export function dist(a: Point, b: Point) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
export function open(x: number, y: number) { return Number.isInteger(x) && Number.isInteger(y) && MAP[y]?.[x] === "."; }
export function zone(x: number) { return x < 7 ? 0 : x < 13 ? 1 : 2; }
function event(type: string, x: number, y: number, now: number, life = 3500, variant?: number): Event {
  return { id: crypto.randomUUID(), type, x, y, at: now, until: now + life, variant };
}

export function makeGame(round = 1, now = Date.now()): Game {
  const spots = [...FUSE_SPOTS];
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  return {
    phase: "waiting", round, startedAt: 0, endsAt: 0, winner: null, reason: "",
    player: { x: 1, y: 1, hidden: false, flares: 2, stunnedUntil: 0, lastMove: 0 },
    monster: { x: 17, y: 1, energy: 100, lastEnergy: now, lastMove: 0, stunnedUntil: 0 },
    fuses: spots.slice(0, 3).map(p => ({ ...p, found: false })),
    switch: { x: 9, y: 11 }, power: false, exit: { x: 17, y: 11 }, lockers: LOCKERS, cameras: CAMERAS,
    lightsUntil: [0, 0, 0], lockUntil: 0, cooldowns: {}, events: [],
    votes: { player: false, monster: false }, lastKnown: { x: 1, y: 1, at: 0 },
  };
}

export function start(g: Game, now: number) {
  g.phase = "playing"; g.startedAt = now; g.endsAt = now + 240_000;
  g.events.push(event("start", 9, 6, now, 4000));
}

export function tick(g: Game, now: number) {
  if (g.phase === "playing" && now >= g.endsAt) {
    g.phase = "ended"; g.winner = "monster"; g.reason = "Время вышло. Архив заперт до утра.";
  }
  g.monster.energy = Math.min(100, g.monster.energy + Math.max(0, now - g.monster.lastEnergy) * 0.0035);
  g.monster.lastEnergy = now;
  g.events = g.events.filter(e => e.until > now - 1000).slice(-16);
}

function caught(g: Game, now: number) {
  if (g.player.hidden || g.monster.stunnedUntil > now) return;
  if (dist(g.player, g.monster) === 0) {
    g.phase = "ended"; g.winner = "monster"; g.reason = "Архивариус нашёл вас между стеллажами.";
    g.events.push(event("caught", g.player.x, g.player.y, now, 5000, g.round % 3));
  }
}

function spend(g: Game, key: string, now: number, cost: number, cooldown: number) {
  if (g.monster.energy < cost) throw new Error("Недостаточно помех. Подождите восстановления.");
  if ((g.cooldowns[key] ?? 0) > now) throw new Error("Приём ещё восстанавливается.");
  g.monster.energy -= cost; g.cooldowns[key] = now + cooldown;
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
  if (g.phase !== "playing") throw new Error(g.phase === "waiting" ? "Ждём второго участника." : "Партия завершена.");

  if (kind === "move") {
    const dx = action.dx, dy = action.dy;
    if (!Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(Number(dx)) + Math.abs(Number(dy)) !== 1) throw new Error("Недопустимый ход.");
    const unit = side === "player" ? g.player : g.monster;
    if (side === "player" && g.player.hidden) throw new Error("Сначала выйдите из укрытия.");
    if (side === "monster" && g.monster.stunnedUntil > now) throw new Error("Вспышка ослепила вас.");
    const delay = side === "player" ? 180 : 310;
    if (now - unit.lastMove < delay) throw new Error("Слишком быстро.");
    const x = unit.x + Number(dx), y = unit.y + Number(dy);
    if (!open(x, y)) throw new Error("Здесь стена.");
    unit.x = x; unit.y = y; unit.lastMove = now;
    if (side === "player") {
      g.events.push(event("step", x, y, now, 1500));
    } else {
      g.events.push(event("heavy", x, y, now, 1800));
    }
    caught(g, now);
    return g;
  }

  if (side === "player") {
    if (kind === "interact") {
      if (g.player.hidden) { g.player.hidden = false; g.events.push(event("unhide", g.player.x, g.player.y, now)); return g; }
      const fuse = g.fuses.find(f => !f.found && dist(g.player, f) <= 1);
      if (fuse) { fuse.found = true; g.events.push(event("fuse", fuse.x, fuse.y, now)); return g; }
      if (dist(g.player, g.switch) <= 1 && !g.power) {
        if (g.fuses.some(f => !f.found)) throw new Error("Нужны все три предохранителя.");
        g.power = true; g.events.push(event("power", g.switch.x, g.switch.y, now, 5000)); return g;
      }
      if (dist(g.player, g.exit) <= 1) {
        if (!g.power) throw new Error("Выход обесточен. Включите рубильник.");
        if (g.lockUntil > now) throw new Error("Замок заклинило. Несколько секунд!");
        g.phase = "ended"; g.winner = "player"; g.reason = "Вы вышли из архива до рассвета.";
        g.events.push(event("escape", g.exit.x, g.exit.y, now, 5000)); return g;
      }
      const locker = g.lockers.find(p => dist(g.player, p) <= 1);
      if (locker) { g.player.x = locker.x; g.player.y = locker.y; g.player.hidden = true; g.events.push(event("hide", locker.x, locker.y, now)); return g; }
      throw new Error("Рядом нечего использовать.");
    }
    if (kind === "flare") {
      if (g.player.flares <= 0) throw new Error("Вспышки закончились.");
      if ((g.cooldowns.flare ?? 0) > now) throw new Error("Фонарь перегрелся.");
      if (g.player.hidden) throw new Error("Из укрытия нельзя использовать вспышку.");
      g.player.flares--; g.cooldowns.flare = now + 16_000;
      if (dist(g.player, g.monster) <= 4) g.monster.stunnedUntil = now + 4200;
      g.events.push(event("flare", g.player.x, g.player.y, now, 2600)); return g;
    }
  } else {
    if (kind === "search") {
      const locker = g.lockers.find(p => dist(g.monster, p) <= 1);
      if (!locker) throw new Error("Подойдите к шкафу.");
      spend(g, "search", now, 10, 5000);
      g.events.push(event("search", locker.x, locker.y, now));
      if (g.player.hidden && dist(g.player, locker) === 0) {
        g.phase = "ended"; g.winner = "monster"; g.reason = "Архивариус распахнул ваш шкаф.";
        g.events.push(event("caught", locker.x, locker.y, now, 5000, (g.round + 1) % 3));
      }
      return g;
    }
    if (kind === "blackout") {
      const z = Number(action.zone);
      if (![0, 1, 2].includes(z)) throw new Error("Выберите сектор.");
      spend(g, "blackout", now, 28, 24_000);
      g.lightsUntil[z] = now + 12_000;
      g.events.push(event("blackout", z * 6 + 3, 6, now, 12_000)); return g;
    }
    if (kind === "knock") {
      const x = Number(action.x), y = Number(action.y);
      if (!open(x, y)) throw new Error("Выберите проход.");
      spend(g, "knock", now, 14, 10_000);
      g.events.push(event("knock", x, y, now, 5000, Math.floor(Math.random() * 2))); return g;
    }
    if (kind === "lock") {
      if (!g.power) throw new Error("Дверь ещё обесточена.");
      spend(g, "lock", now, 32, 38_000);
      g.lockUntil = now + 8000; g.events.push(event("lock", g.exit.x, g.exit.y, now, 8000)); return g;
    }
    if (kind === "scare") {
      if (g.player.hidden || dist(g.player, g.monster) > 5) throw new Error("Подойдите ближе к незапертому игроку.");
      spend(g, "scare", now, 26, 26_000);
      g.events.push(event("scare", g.player.x, g.player.y, now, 2200, Math.floor(Math.random() * 3))); return g;
    }
  }
  throw new Error("Недоступное действие.");
}

export function view(g: Game, side: Side, now: number, connected: boolean, version: number) {
  const playerVisible = g.player.hidden ? dist(g.monster, g.player) <= 1 :
    dist(g.monster, g.player) <= 3 || g.cameras.some(c => dist(c, g.player) <= 3 && g.lightsUntil[zone(c.x)] <= now);
  const monsterVisible = dist(g.player, g.monster) <= (g.lightsUntil[zone(g.player.x)] > now ? 2 : 4) || g.monster.stunnedUntil > now;
  const common = {
    phase: g.phase, round: g.round, now, version, endsAt: g.endsAt, winner: g.winner, reason: g.reason,
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
    ...common, side, self: g.player, rival: monsterVisible ? g.monster : null,
    fuses: g.fuses.map(f => ({ x: f.found || dist(g.player, f) <= 4 ? f.x : null, y: f.found || dist(g.player, f) <= 4 ? f.y : null, found: f.found })),
    flareReadyAt: g.cooldowns.flare ?? 0,
  };
  return {
    ...common, side, self: g.monster, rival: playerVisible ? g.player : null,
    fuses: g.fuses, cooldowns: g.cooldowns,
    cameraSignals: g.cameras.map(c => dist(c, g.player) <= 3 && g.lightsUntil[zone(c.x)] <= now && !g.player.hidden),
  };
}
