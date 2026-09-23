/**
 * Shared hospital layout and movement rules. Imported by both the Worker and
 * the browser so prediction, collision and line-of-sight always agree.
 *
 * Integer coordinates are tile centres; a tile spans ±0.5 around its index.
 *
 * Legend
 *   #  wall                 =  exterior wall with a barred window
 *   m  morgue drawer wall   g  glass partition (blocks bodies, not sight)
 *   E  main entrance door   p  pillar
 *   .  floor                d  doorway
 *   o  yard outside         v  hedge / fence outside
 *   b  bed   t  table   s  shelf   k  counter / desk   u  bathtub   x  rubble
 */
export const MAP = [
  "####=###=########=###=###=########=###=###=##", // 0
  "#mmmmmmmmmmmm#................#.............#", // 1
  "#............#.ssss.ssss.ssss.#.............#", // 2
  "=............#................#.kkk.....gggg=", // 3
  "#..t..t..t...#.ssss.ssss.ssss.d.........g...#", // 4
  "=............#................#.........d...=", // 5
  "#............#.ssss.ssss.ssss.#.........g...#", // 6
  "#............#................#.........g...#", // 7
  "######d##########d########d#########d########", // 8
  "#.............x.............................#", // 9
  "#...........................................#", // 10
  "###d######d######d###..###d###########d######", // 11
  "#b....b#b....b#.....#..#k......s#...........#", // 12
  "#......#......#.....#..#.......s#..u..u..u..#", // 13
  "=b....b#b....b#.....#..#...tt...#...........=", // 14
  "#......d......#.....#..#........#...........#", // 15
  "=b....b#b....b#.....#..#........#..u..u..u..=", // 16
  "#......#......#.....#..#........#...........#", // 17
  "####d######d#########..#####d#######d########", // 18
  "#...........................................#", // 19
  "#................................x..........#", // 20
  "######d#############.....############d#######", // 21
  "#............#..p...........pxx#...........s#", // 22
  "#..t..t..t...#...kkkk........xx#......s..s.s#", // 23
  "=............d.................#kkkk..s..s..=", // 24
  "#..t..t..t...#.................d......s..s..#", // 25
  "=............#..p...........p..#......s..s..=", // 26
  "#kkkk........#.................#............#", // 27
  "###=##=##=######=##=##E##=##=######=##=##=###", // 28
  "vvvvvvvvvvvvvvvooooooooooooooovvvvvvvvvvvvvvv", // 29
  "vvvvvvvvvvvvvvvooooooooooooooovvvvvvvvvvvvvvv", // 30
  "vvvvvvvvvvvvvvvooooooooooooooovvvvvvvvvvvvvvv", // 31
  "vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv", // 32
  "vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv", // 33
];
export const MAP_W = MAP[0].length;
export const MAP_H = MAP.length;

export type Point = { x: number; y: number };
export type Side = "player" | "monster";
export type Phase = "waiting" | "intro" | "playing" | "ended";

export type Zone =
  | "morgue" | "archive" | "security" | "corridor" | "ward" | "isolation"
  | "treatment" | "hydro" | "canteen" | "lobby" | "pharmacy" | "exterior";
export type Room = { id: string; name: string; zone: Zone; x0: number; y0: number; x1: number; y1: number };

export const ROOMS: Room[] = [
  { id: "morgue", name: "МОРГ", zone: "morgue", x0: 1, y0: 1, x1: 12, y1: 7 },
  { id: "archive", name: "АРХИВ", zone: "archive", x0: 14, y0: 1, x1: 29, y1: 7 },
  { id: "security", name: "ПОСТ ОХРАНЫ", zone: "security", x0: 31, y0: 1, x1: 43, y1: 7 },
  { id: "north", name: "СЕВЕРНЫЙ КОРИДОР", zone: "corridor", x0: 1, y0: 9, x1: 43, y1: 10 },
  { id: "ward1", name: "ПАЛАТА 1", zone: "ward", x0: 1, y0: 12, x1: 6, y1: 17 },
  { id: "ward2", name: "ПАЛАТА 2", zone: "ward", x0: 8, y0: 12, x1: 13, y1: 17 },
  { id: "isolation", name: "ИЗОЛЯТОР", zone: "isolation", x0: 15, y0: 12, x1: 19, y1: 17 },
  { id: "connector", name: "ПЕРЕХОД", zone: "corridor", x0: 21, y0: 11, x1: 22, y1: 18 },
  { id: "treatment", name: "ПРОЦЕДУРНАЯ", zone: "treatment", x0: 24, y0: 12, x1: 31, y1: 17 },
  { id: "hydro", name: "ГИДРОТЕРАПИЯ", zone: "hydro", x0: 33, y0: 12, x1: 43, y1: 17 },
  { id: "main", name: "ГЛАВНЫЙ КОРИДОР", zone: "corridor", x0: 1, y0: 19, x1: 43, y1: 20 },
  { id: "canteen", name: "СТОЛОВАЯ", zone: "canteen", x0: 1, y0: 22, x1: 12, y1: 27 },
  { id: "lobby", name: "ВЕСТИБЮЛЬ", zone: "lobby", x0: 14, y0: 21, x1: 30, y1: 27 },
  { id: "pharmacy", name: "АПТЕКА", zone: "pharmacy", x0: 32, y0: 22, x1: 43, y1: 27 },
  { id: "yard", name: "ДВОР", zone: "exterior", x0: 0, y0: 29, x1: 44, y1: 33 },
];

export function roomAt(x: number, y: number): Room | null {
  const tx = Math.round(x), ty = Math.round(y);
  return ROOMS.find(r => tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1) ?? null;
}

export const SPOTS = {
  lockers: [
    { x: 12, y: 7 }, { x: 1, y: 7 }, { x: 29, y: 1 }, { x: 31, y: 7 }, { x: 43, y: 1 }, { x: 1, y: 17 },
    { x: 13, y: 15 }, { x: 19, y: 17 }, { x: 25, y: 17 }, { x: 43, y: 17 }, { x: 12, y: 22 }, { x: 43, y: 27 },
    { x: 14, y: 27 }, { x: 43, y: 9 },
  ] as Point[],
  /** One patient history is drawn from each quarter of the building. */
  clueAreas: [
    [{ x: 9, y: 6 }, { x: 2, y: 15 }, { x: 12, y: 13 }],
    [{ x: 27, y: 5 }, { x: 42, y: 6 }, { x: 42, y: 15 }],
    [{ x: 10, y: 26 }, { x: 18, y: 16 }, { x: 2, y: 24 }],
    [{ x: 42, y: 26 }, { x: 30, y: 16 }, { x: 34, y: 27 }],
  ] as Point[][],
  cameras: [{ x: 8, y: 9 }, { x: 34, y: 10 }, { x: 8, y: 20 }, { x: 36, y: 19 }, { x: 22, y: 24 }, { x: 22, y: 1 }, { x: 21, y: 14 }] as Point[],
  batteries: [
    { x: 1, y: 2 }, { x: 15, y: 1 }, { x: 33, y: 1 }, { x: 5, y: 13 }, { x: 10, y: 17 }, { x: 16, y: 12 },
    { x: 30, y: 12 }, { x: 43, y: 12 }, { x: 1, y: 22 }, { x: 43, y: 25 }, { x: 27, y: 27 }, { x: 22, y: 11 },
  ] as Point[],
  /** The breaker cabinet hangs on the north wall above this tile. */
  switch: { x: 36, y: 1 } as Point,
  /** The inside of the main entrance; the door leaf is one tile south. */
  exit: { x: 22, y: 27 } as Point,
  arrival: { player: { x: 21, y: 31 }, monster: { x: 23, y: 31 } },
  start: { player: { x: 22, y: 25 }, monster: { x: 5, y: 5 } },
  /** Where a visitor wakes up after tearing free from the creature. */
  respawns: [{ x: 3, y: 9 }, { x: 40, y: 10 }, { x: 22, y: 15 }, { x: 5, y: 20 }, { x: 40, y: 19 }, { x: 22, y: 26 }, { x: 36, y: 25 }, { x: 7, y: 26 }] as Point[],
};

export const CATEGORY_WALK = ".do";
export const BODY_RADIUS = .23;

export const SPEED = {
  walk: 1.9,
  sprint: 3.05,
  crouch: 1.05,
  monster: 2.0,
  hunt: 2.65,
};
/** Server-side allowance for a single client: never slower than the fastest legal gait. */
export function maxSpeed(side: Side) { return side === "player" ? SPEED.sprint : SPEED.hunt; }

export function tileAt(x: number, y: number) {
  return MAP[Math.floor(y + .5)]?.[Math.floor(x + .5)] ?? "#";
}
export function walkableChar(c: string, phase?: Phase) {
  return c === "." || c === "d" || c === "o" || (c === "E" && phase === "intro");
}
export function open(x: number, y: number, phase?: Phase) {
  return Number.isFinite(x) && Number.isFinite(y) && walkableChar(tileAt(x, y), phase);
}
export function canOccupy(x: number, y: number, phase?: Phase) {
  const r = BODY_RADIUS;
  return open(x - r, y - r, phase) && open(x + r, y - r, phase) && open(x - r, y + r, phase) && open(x + r, y + r, phase);
}
/** Moves a body with wall sliding; returns true when it moved at all. */
export function slide(unit: Point, dx: number, dy: number, phase?: Phase) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / .07));
  const sx = dx / steps, sy = dy / steps;
  const bx = unit.x, by = unit.y;
  for (let i = 0; i < steps; i++) {
    if (canOccupy(unit.x + sx, unit.y, phase)) unit.x += sx;
    if (canOccupy(unit.x, unit.y + sy, phase)) unit.y += sy;
  }
  return unit.x !== bx || unit.y !== by;
}

const SIGHT_BLOCKERS = "#=mEsp";
export function blocksSight(c: string) { return SIGHT_BLOCKERS.includes(c) || c === "v"; }
/** Grid ray march; low furniture and glass do not block sight. */
export function lineOfSight(a: Point, b: Point) {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.ceil(distance / .2);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (blocksSight(tileAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t))) return false;
  }
  return true;
}
/** First wall hit along a ray, with the face normal for placing decals. */
export function castToWall(from: Point, yaw: number, maxDistance = 9) {
  const dx = Math.cos(yaw), dy = Math.sin(yaw);
  let px = from.x, py = from.y;
  for (let travelled = 0; travelled < maxDistance; travelled += .05) {
    const nx = from.x + dx * travelled, ny = from.y + dy * travelled;
    const c = tileAt(nx, ny);
    if (c === "#" || c === "=" || c === "m" || c === "p" || c === "E") {
      const tx = Math.floor(nx + .5), ty = Math.floor(ny + .5);
      const ox = Math.floor(px + .5), oy = Math.floor(py + .5);
      // Normal points from the wall tile back toward where the ray came from.
      const face = ox < tx ? 0 : ox > tx ? 1 : oy < ty ? 2 : 3;
      return { tile: { x: tx, y: ty }, face, distance: travelled };
    }
    px = nx; py = ny;
  }
  return null;
}
export function dist(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function sector(x: number) { return x < 15 ? 0 : x < 30 ? 1 : 2; }

export type Story = { id: number; number: string; title: string; text: string; note: string };
export const STORIES: Story[] = [
  { id: 0, number: "№ 113", title: "Ковалёв И. П., 34 года",
    text: "Поступил 12.03.1986 в сопровождении брата. Утверждает, что брат, который привёз его, — «не он»: «у него другие паузы между словами». Брата в журнале посещений нет.",
    note: "Запись дежурного: машина у ворот стояла пустой." },
  { id: 1, number: "№ 207", title: "Соловьёва А. Н., 19 лет",
    text: "Жалуется, что по ночам соседка по палате стоит у кровати и повторяет её слова с опозданием на секунду. Соседки по палате у пациентки нет. Переведена в изолятор.",
    note: "Утром изолятор был открыт изнутри." },
  { id: 2, number: "№ 318", title: "Гриценко В. С., санитар",
    text: "Не пациент. Оставил запись в журнале смены: «Нас на смене двое. Я и Петрович. Петрович уволился в феврале. Кто тогда со мной курит у морга?»",
    note: "Дальше страницы вырваны. Карандашом на полях: «ОН ВИДИТ ТВОЙ ФОНАРЬ»." },
  { id: 3, number: "№ 404", title: "Неизвестный",
    text: "Доставлен без документов, откликается на любое имя. Внешность описана тремя врачами по-разному. Рост в карте исправлен четыре раза: 178, 183, 196, 231.",
    note: "Последняя запись: «Яркая вспышка его останавливает. Ненадолго»." },
  { id: 4, number: "Приказ № 9", title: "Главный врач, 1987",
    text: "Корпус 13 закрыть. Аварийное питание отключить на посту охраны. Ключи от главного входа хранить там же. Никого не оставлять в корпусе поодиночке.",
    note: "Если вас стало на одного больше — не пересчитывайте. Уходите." },
  { id: 5, number: "№ 522", title: "Мельник О. Д., 8 лет",
    text: "Рисует одну и ту же картинку: двое идут в больницу, выходит один. Воспитательница уверяет, что девочка никогда не видела здание корпуса.",
    note: "На обороте рисунка: «второй остался, чтобы стать первым»." },
  { id: 6, number: "Журнал ГТ", title: "Отделение гидротерапии",
    text: "Процедуры прекращены. Вода в ваннах тёплая, хотя котельная не работает с осени. Пациенты говорят, что под водой их держат за руку и зовут голосом того, кто их привёз.",
    note: "В шкафах он ищет по дыханию. Не дышите." },
  { id: 7, number: "№ 13", title: "Без имени",
    text: "Графа «диагноз» заполнена почерком пациента: «ПРИШЁЛ ВМЕСТЕ С ВАМИ». Врач приписал: «Проверить, кто подписывал направление».",
    note: "Направление подписано вашей фамилией." },
];

export const INTRO_MS = 20_000;
export const ARRIVAL_MS = 5_000;
export const ROUND_MS = 12 * 60_000;
export const LIVES = 3;
export const FLARES = 3;
export const REVEAL_MS = 1_100;
export const REACH = .62;
