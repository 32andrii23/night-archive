import * as THREE from "three";
import { MAP, ROOMS, SPOTS, roomAt, sector, type Zone } from "../../lib/hospital";
import * as T from "./textures";
import {
  SLOT, buildBattery, buildBreaker, buildCar, buildClue, buildLever, buildLocker, buildLockerDoor, buildProp, type PropName,
} from "./models";
import { atlasMaterial } from "./post";

export const CELL = 1.8;
export const WALL_H = 3.2;
export const EYE = 1.62;
export const wx = (x: number) => (x + .5) * CELL;
export const wz = (y: number) => (y + .5) * CELL;

const W = MAP[0].length, H = MAP.length;
const at = (x: number, y: number) => MAP[y]?.[x] ?? "#";
const solid = (c: string) => c === "#" || c === "=" || c === "m" || c === "p" || c === "v";
const outside = (c: string) => c === "o" || c === "v";
const interior = (x: number, y: number) => { const c = at(x, y); return !solid(c) && c !== "o"; };
const zoneOf = (x: number, y: number): Zone => roomAt(x, y)?.zone ?? "corridor";
const SIDES = [{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 0, dy: 1 }];

const WALL_STYLE: Record<Zone, T.WallStyle> = {
  corridor: "corridor", ward: "ward", morgue: "morgue", treatment: "treatment", hydro: "hydro", isolation: "padded",
  archive: "archive", lobby: "lobby", canteen: "canteen", pharmacy: "pharmacy", security: "security", exterior: "facade",
};
const FLOOR_STYLE: Record<Zone, T.FloorStyle> = {
  corridor: "checker", ward: "lino", morgue: "tile", treatment: "tile", hydro: "wetTile", isolation: "padded",
  archive: "parquet", lobby: "terrazzo", canteen: "tile", pharmacy: "lino", security: "concrete", exterior: "asphalt",
};
const WETNESS: Partial<Record<T.FloorStyle, number>> = { wetTile: .95, tile: .55, checker: .45, terrazzo: .4, lino: .3, concrete: .35 };

type Item = { m: THREE.Matrix4; uv?: [number, number, number, number]; color?: THREE.Color };
const dummy = new THREE.Object3D();
function mat4(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0) {
  dummy.position.set(x, y, z); dummy.rotation.set(rx, ry, 0, "YXZ"); dummy.scale.set(sx, sy, sz); dummy.updateMatrix();
  return dummy.matrix.clone();
}

export type Fixture = {
  pos: THREE.Vector3; sector: number; pre: "dead" | "flicker" | "steady"; post: "dead" | "flicker" | "steady";
  seed: number; color: THREE.Color; emergency: boolean; mesh: THREE.InstancedMesh; index: number; level: number; lobby: boolean;
};
export type Door = {
  x: number; y: number; group: THREE.Group; hinges: [THREE.Group, THREE.Group]; angle: number; rest: number;
  swing: number; slamUntil: number; along: "x" | "z"; vel: number;
};
export type Locker = { index: number; x: number; y: number; door: THREE.Group; open: number; openUntil: number; yaw: number; inside: THREE.Vector3 };

export type LevelState = {
  time: number; now: number; power: boolean; lightsUntil: number[]; focus: THREE.Vector3; bodies: THREE.Vector3[];
  intro: boolean; exitOpen: boolean; lockUntil: number;
};

export function createLevel(scene: THREE.Scene, quality: "low" | "medium" | "high") {
  const disposables: Array<{ dispose(): void }> = [];
  const windows: Array<{ x: number; z: number; dx: number; dy: number }> = [];
  const drawerFaces: Array<{ x: number; z: number; yaw: number }> = [];
  const wallFaces: Array<{ x: number; z: number; dx: number; dy: number; zone: Zone; tx: number; ty: number }> = [];
  const hanging: Array<{ x: number; y: number }> = [];
  const keep = <V extends { dispose(): void }>(v: V) => { disposables.push(v); return v; };
  const r = T.rng(1313);

  /* -------------------------------- materials -------------------------------- */
  const wallMats = new Map<string, THREE.MeshStandardMaterial>();
  const wallMaterial = (key: string, make: () => THREE.Texture, extra: THREE.MeshStandardMaterialParameters = {}) => {
    let m = wallMats.get(key);
    if (!m) {
      m = keep(atlasMaterial(new THREE.MeshStandardMaterial({ map: keep(make()), roughness: .92, metalness: 0, ...extra })));
      wallMats.set(key, m);
    }
    return m;
  };
  const floorMats = new Map<string, THREE.MeshStandardMaterial>();
  const floorMaterial = (style: T.FloorStyle) => {
    let m = floorMats.get(style);
    if (!m) {
      const wet = WETNESS[style] ?? .2;
      m = keep(atlasMaterial(new THREE.MeshStandardMaterial({ map: keep(T.floorTexture(style, style.length * 13)), roughness: 1, roughnessMap: keep(T.wetnessTexture(style.length * 7, wet)), metalness: 0 })));
      floorMats.set(style, m);
    }
    return m;
  };
  const ceilingMat = keep(atlasMaterial(new THREE.MeshStandardMaterial({ map: keep(T.ceilingTexture(5)), roughness: .95 })));
  const grimeMap = keep(T.propGrime());
  const propMats: THREE.Material[] = [
    keep(new THREE.MeshStandardMaterial({ vertexColors: true, map: grimeMap, roughness: .82 })),
    keep(new THREE.MeshStandardMaterial({ vertexColors: true, map: grimeMap, roughness: .38, metalness: .55 })),
    keep(new THREE.MeshBasicMaterial({ vertexColors: true })),
    keep(new THREE.MeshBasicMaterial({ vertexColors: false, color: 0xbfffc8 })),
    keep(new THREE.MeshStandardMaterial({ vertexColors: true, map: grimeMap, roughness: .98, side: THREE.DoubleSide })),
  ];
  const screen = T.staticScreen();
  keep(screen.texture);
  (propMats[SLOT.screen] as THREE.MeshBasicMaterial).map = screen.texture;
  const trimMat = keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .6, map: grimeMap }));

  /* ------------------------------ surface batches ----------------------------- */
  const batches = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; items: Item[]; shadow: boolean; receive: boolean; order?: number }>();
  const batch = (key: string, geo: () => THREE.BufferGeometry, mat: THREE.Material, shadow = true, receive = true) => {
    let b = batches.get(key);
    if (!b) { b = { geo: keep(geo()), mat, items: [], shadow, receive }; batches.set(key, b); }
    return b;
  };
  const wallGeo = () => new THREE.PlaneGeometry(CELL, WALL_H);
  const tileGeo = () => new THREE.PlaneGeometry(CELL, CELL);
  const boxGeo = () => new THREE.BoxGeometry(1, 1, 1);

  /* ---------------------------------- walls ---------------------------------- */
  const faceYaw = (dx: number, dy: number) => Math.atan2(dx, dy);
  const wallVariant = (x: number, y: number, s: number): [number, number, number, number] => {
    const h = (x * 73 + y * 151 + s * 29) % 4;
    return h === 0 ? [0, 0, .5, 1] : h === 1 ? [.5, 0, .5, 1] : h === 2 ? [.5, 0, -.5, 1] : [1, 0, -.5, 1];
  };
  const trims = batch("trim", boxGeo, trimMat, false);
  const facadeMat = keep(atlasMaterial(new THREE.MeshStandardMaterial({ map: keep(T.facadeTexture()), roughness: .95 })));
  const facadeGeo = () => new THREE.PlaneGeometry(CELL, 7.4);
  const windowMat = keep(atlasMaterial(new THREE.MeshStandardMaterial({ map: keep(T.windowTexture(9)), roughness: .9, emissive: 0xffffff, emissiveMap: keep(T.windowGlow()), emissiveIntensity: .55 })));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = at(x, y);
    if (!solid(c) || c === "v") continue;
    SIDES.forEach((s, si) => {
      const nx = x + s.dx, ny = y + s.dy, n = at(nx, ny);
      if (solid(n)) return;
      const fx = wx(x) + s.dx * CELL / 2, fz = wz(y) + s.dy * CELL / 2;
      const yaw = faceYaw(s.dx, s.dy);
      if (outside(n)) {
        if (s.dy !== 1) return;
        const variant = c === "=" ? 1 : (x % 3 === 0 ? 2 : 0);
        batch("facade", facadeGeo, facadeMat).items.push({ m: mat4(fx, 3.7, fz + .001, yaw), uv: [variant / 3, 0, 1 / 3, 1] });
        return;
      }
      const zone = zoneOf(nx, ny);
      if (c === "=") {
        batch("window", wallGeo, windowMat)
          .items.push({ m: mat4(fx, WALL_H / 2, fz, yaw), uv: [0, 0, 1, 1] });
        windows.push({ x: fx - s.dx * .01, z: fz - s.dy * .01, dx: s.dx, dy: s.dy });
      } else if (c === "m" && zone === "morgue") {
        batch("drawers", wallGeo, wallMaterial("drawers", () => T.drawerTexture(3)), true).items.push({ m: mat4(fx, WALL_H / 2, fz, yaw), uv: [(x % 4) / 4, 0, .25, 1] });
        drawerFaces.push({ x: fx, z: fz, yaw });
      } else {
        const style = c === "p" ? "lobby" : WALL_STYLE[zone];
        batch(`wall:${style}`, wallGeo, wallMaterial(style, () => T.wallTexture(style, style.length * 31 + 7))).items.push({ m: mat4(fx, WALL_H / 2, fz, yaw), uv: wallVariant(x, y, si) });
        if (style !== "hydro" && style !== "padded" && style !== "treatment" && style !== "morgue") {
          const base = style === "lobby" || style === "archive" ? 0x2e2118 : 0x2f3b37;
          trims.items.push({ m: mat4(fx + s.dx * .02, .07, fz + s.dy * .02, yaw, CELL, .14, .04), color: new THREE.Color(base) });
        }
        wallFaces.push({ x: fx, z: fz, dx: s.dx, dy: s.dy, zone, tx: x, ty: y });
      }
    });
  }
  // The entrance leaves a gap in the facade above the door frame.
  batch("facadeTop", () => new THREE.PlaneGeometry(CELL, 4.2), facadeMat).items.push({ m: mat4(wx(22), 3.2 + 2.1, 29 * CELL + .001, 0), uv: [0, 3.2 / 7.4, 1 / 3, 4.2 / 7.4] });
  // Glass partitions ('g') sit on a floor tile.
  const glassMat = keep(new THREE.MeshStandardMaterial({ color: 0x9fb8b6, roughness: .08, metalness: .1, transparent: true, opacity: .22, depthWrite: false }));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (at(x, y) !== "g") continue;
    const horizontal = at(x - 1, y) === "g" || at(x + 1, y) === "g" || solid(at(x - 1, y)) && solid(at(x + 1, y));
    const yaw = horizontal ? 0 : Math.PI / 2;
    batch("glass", tileGeo, glassMat, false, false).items.push({ m: mat4(wx(x), 1.25, wz(y), yaw, 1, 2.5 / CELL, 1) });
    trims.items.push({ m: mat4(wx(x), .5, wz(y), yaw, CELL, 1, .08), color: new THREE.Color(0x4a5550) });
    trims.items.push({ m: mat4(wx(x), 2.52, wz(y), yaw, CELL, .06, .08), color: new THREE.Color(0x3a4440) });
    trims.items.push({ m: mat4(wx(x), WALL_H - .3, wz(y), yaw, CELL, .6, .12), color: new THREE.Color(0x707568) });
  }

  /* ------------------------------ floors, ceilings ----------------------------- */
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!interior(x, y)) continue;
    const zone = zoneOf(x, y);
    const style = FLOOR_STYLE[zone];
    const h = (x * 31 + y * 17) % 4;
    const uv: [number, number, number, number] = h === 0 ? [0, 0, 1, 1] : h === 1 ? [1, 0, -1, 1] : h === 2 ? [0, 1, 1, -1] : [1, 1, -1, -1];
    batch(`floor:${style}`, tileGeo, floorMaterial(style), false).items.push({ m: mat4(wx(x), 0, wz(y), 0, 1, 1, 1, -Math.PI / 2), uv: style === "checker" || style === "tile" || style === "wetTile" || style === "padded" ? [0, 0, 1, 1] : uv });
    const hole = (x * 7 + y * 13) % 11 === 0 && zone !== "lobby";
    batch("ceiling", tileGeo, ceilingMat, false).items.push({ m: mat4(wx(x), WALL_H, wz(y), 0, 1, 1, 1, Math.PI / 2), uv: hole ? [.5, 0, .5, 1] : ((x + y) % 2 ? [0, 0, .5, 1] : [.5, 1, -.5, -1]) });
    if (hole) hanging.push({ x, y });
  }

  /* ---------------------------------- doors ----------------------------------- */
  const doorMats = [keep(new THREE.MeshStandardMaterial({ map: keep(T.doorTexture(1)), roughness: .7 })), keep(new THREE.MeshStandardMaterial({ map: keep(T.doorTexture(2)), roughness: .7 }))];
  const leafGeo = keep(new THREE.BoxGeometry(.86, 2.28, .05));
  leafGeo.translate(.43, 1.14, 0);
  const doors: Door[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (at(x, y) !== "d") continue;
    const along: "x" | "z" = solid(at(x - 1, y)) && solid(at(x + 1, y)) ? "x" : "z";
    const group = new THREE.Group();
    group.position.set(wx(x), 0, wz(y));
    group.rotation.y = along === "x" ? 0 : Math.PI / 2;
    const hinge = (side: number) => {
      const h = new THREE.Group();
      h.position.set(side * .88, 0, 0);
      const leaf = new THREE.Mesh(leafGeo, doorMats[(x + y) % 2]);
      leaf.castShadow = true; leaf.receiveShadow = true;
      if (side > 0) { leaf.scale.x = -1; }
      h.add(leaf);
      group.add(h);
      return h;
    };
    const hinges: [THREE.Group, THREE.Group] = [hinge(-1), hinge(1)];
    // Header above the doorway fills the wall up to the ceiling.
    trims.items.push({ m: mat4(wx(x), (2.34 + WALL_H) / 2, wz(y), group.rotation.y, CELL, WALL_H - 2.34, CELL * .96), color: new THREE.Color(0x8c8a7c) });
    for (const side of [-1, 1]) trims.items.push({ m: mat4(wx(x) + (along === "x" ? side * .87 : 0), 1.17, wz(y) + (along === "z" ? side * .87 : 0), group.rotation.y, .08, 2.34, .16), color: new THREE.Color(0x4f5a55) });
    scene.add(group);
    const seed = (x * 13 + y * 7) % 10;
    const rest = seed < 6 ? 1.45 : seed < 8 ? .5 + (seed - 6) * .3 : 0;
    doors.push({ x, y, group, hinges, angle: rest, rest, swing: seed % 2 ? 1 : -1, slamUntil: 0, along, vel: 0 });
  }

  trims.items.push({ m: mat4(wx(22), (2.5 + WALL_H) / 2, wz(28), 0, CELL, WALL_H - 2.5, CELL * .96), color: new THREE.Color(0x6e6a5c) });

  /* ---------------------------------- props ----------------------------------- */
  const propItems = new Map<PropName, Item[]>();
  const place = (name: PropName, x: number, y: number, z: number, yaw: number, tint?: number) => {
    const list = propItems.get(name) ?? [];
    list.push({ m: mat4(x, y, z, yaw), color: new THREE.Color(tint ?? 0xffffff) });
    propItems.set(name, list);
  };
  const wallSide = (x: number, y: number) => SIDES.find(s => solid(at(x + s.dx, y + s.dy)) && at(x + s.dx, y + s.dy) !== "v");
  const yawToWall = (s: { dx: number; dy: number }) => (s.dx === -1 ? Math.PI / 2 : s.dx === 1 ? -Math.PI / 2 : s.dy === -1 ? 0 : Math.PI);
  const reserved = new Set<string>([
    ...SPOTS.lockers, ...SPOTS.clueAreas.flat(), ...SPOTS.batteries, SPOTS.switch, SPOTS.exit, ...Object.values(SPOTS.arrival), ...Object.values(SPOTS.start), ...SPOTS.respawns,
  ].map(p => `${p.x},${p.y}`));
  const nearDoor = (x: number, y: number) => SIDES.some(s => at(x + s.dx, y + s.dy) === "d" || at(x + s.dx, y + s.dy) === "E");

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = at(x, y), zone = zoneOf(x, y);
    const X = wx(x), Z = wz(y);
    const tint = () => 0xffffff - Math.floor(r() * 0x18) * 0x010101;
    if (c === "b") {
      const s = wallSide(x, y) ?? { dx: -1, dy: 0 };
      const yaw = yawToWall(s);
      place(r() < .4 ? "bedStraps" : "bed", X - s.dx * .02, 0, Z - s.dy * .02, yaw, tint());
      continue;
    }
    if (c === "t") {
      if (zone === "morgue") place(r() < .65 ? "autopsyBody" : "autopsy", X, 0, Z, 0);
      else if (zone === "treatment") { place("operating", X, 0, Z, Math.PI / 2); place("opLamp", X - .4, 0, Z, 0); }
      else place("dining", X, 0, Z, r() < .5 ? 0 : Math.PI);
      continue;
    }
    if (c === "s") {
      const alongX = at(x - 1, y) === "s" || at(x + 1, y) === "s";
      if (zone === "archive") place("shelfArchive", X, 0, Z, alongX ? 0 : Math.PI / 2);
      else if (zone === "pharmacy") place("shelfPharmacy", X, 0, Z, alongX ? 0 : Math.PI / 2);
      else { const s = wallSide(x, y) ?? { dx: 1, dy: 0 }; place("cabinet", X + s.dx * .62, 0, Z + s.dy * .62, yawToWall(s)); place("trolley", X - s.dx * .3, 0, Z - s.dy * .3, yawToWall(s)); }
      continue;
    }
    if (c === "k") {
      if (zone === "lobby") place("reception", X, 0, Z, 0);
      else if (zone === "security") place("securityDesk", X, 0, Z, 0);
      else if (zone === "pharmacy") place("pharmacyCounter", X, 0, Z, Math.PI);
      else if (zone === "canteen") place("kitchen", X, 0, Z + .5, Math.PI);
      else place("shockMachine", X, 0, Z - .45, 0);
      continue;
    }
    if (c === "u") { place("bathtub", X, 0, Z, 0); continue; }
    if (c === "x") { place("rubble", X, 0, Z, r() * 6); continue; }
    if (c !== ".") continue;
    if (reserved.has(`${x},${y}`)) continue;
    const s = wallSide(x, y);
    const roll = r();
    if (!s) {
      if (zone === "isolation" && x === 17 && y === 14) place("straitChair", X, 0, Z, Math.PI);
      else if (roll < .06 && zone !== "lobby") place("papersPile", X, 0, Z, 0);
      continue;
    }
    if (nearDoor(x, y)) continue;
    const yaw = yawToWall(s);
    const push = (d: number) => [X + s.dx * d, Z + s.dy * d] as const;
    const windowBehind = at(x + s.dx, y + s.dy) === "=";
    if (windowBehind) { const [px, pz] = push(.82); place("radiator", px, 0, pz, yaw); continue; }
    switch (zone) {
      case "corridor": {
        if (roll < .07) { const [px, pz] = push(.65); place("bench", px, 0, pz, yaw); }
        else if (roll < .11) { const [px, pz] = push(.6); place("chair", px, 0, pz, yaw); }
        else if (roll < .14) { const [px, pz] = push(.55); place("chairFallen", px, 0, pz, yaw + r()); }
        else if (roll < .17) { const [px, pz] = push(.82); place("extinguisher", px, 0, pz, yaw); }
        else if (roll < .2) { const [px, pz] = push(.7); place("bin", px, 0, pz, yaw); }
        else if (roll < .23) { const [px, pz] = push(.55); place("wheelchair", px, 0, pz, yaw + (r() - .5)); }
        else if (roll < .3) { const [px, pz] = push(.3); place("papersPile", px, 0, pz, 0); }
        break;
      }
      case "ward": {
        if (x === 1 || x === 6 || x === 8 || x === 13) { if (y % 2 === 1) { const [px, pz] = push(.6); place("bedside", px, 0, pz, yaw); place("curtain", X, 0, Z, yaw + Math.PI / 2); } }
        else if (roll < .15) { const [px, pz] = push(.6); place("iv", px, 0, pz, 0); }
        else if (roll < .22) { const [px, pz] = push(.5); place("wheelchair", px, 0, pz, yaw + r()); }
        break;
      }
      case "morgue": {
        if (roll < .3 && s.dy !== -1) { const [px, pz] = push(.5); place("gurneyBody", px, 0, pz, yaw + Math.PI / 2); }
        else if (roll < .38) { const [px, pz] = push(.6); place("trolley", px, 0, pz, yaw); }
        break;
      }
      case "treatment": {
        if (roll < .2) { const [px, pz] = push(.6); place("cabinet", px, 0, pz, yaw); }
        else if (roll < .32) { const [px, pz] = push(.55); place("trolley", px, 0, pz, yaw); }
        else if (roll < .42) { const [px, pz] = push(.6); place("iv", px, 0, pz, 0); }
        break;
      }
      case "archive": case "pharmacy": case "security": {
        if (roll < .18) { const [px, pz] = push(.5); place("boxes", px, 0, pz, r() * 3); }
        else if (roll < .3) { const [px, pz] = push(.3); place("papersPile", px, 0, pz, 0); }
        else if (roll < .38 && zone !== "archive") { const [px, pz] = push(.62); place("cabinet", px, 0, pz, yaw); }
        break;
      }
      case "canteen": {
        if (roll < .15) { const [px, pz] = push(.55); place("chairFallen", px, 0, pz, r() * 6); }
        else if (roll < .22) { const [px, pz] = push(.7); place("bin", px, 0, pz, 0); }
        break;
      }
      case "lobby": {
        if (roll < .14) { const [px, pz] = push(.65); place("bench", px, 0, pz, yaw); }
        else if (roll < .22) { const [px, pz] = push(.6); place("plant", px, 0, pz, 0); }
        break;
      }
      case "hydro": {
        if (roll < .12) { const [px, pz] = push(.6); place("chair", px, 0, pz, yaw); }
        break;
      }
      default: break;
    }
  }
  for (const face of drawerFaces) if (r() < .25) {
    const dz = Math.cos(face.yaw), dx = Math.sin(face.yaw);
    place("drawerOpen", face.x + dx * .02, 1.0 + Math.floor(r() * 2) * .8, face.z + dz * .02, face.yaw + Math.PI);
  }
  for (const h of hanging) place("wires", wx(h.x), 0, wz(h.y), r() * 6);
  for (const cam of SPOTS.cameras) place("cctv", wx(cam.x), WALL_H - .02, wz(cam.y), r() * 6);
  place("clock", wx(26), 2.5, 21 * CELL + CELL + .03, 0);
  place("stairs", wx(22), 0, 29 * CELL + .1, 0);
  place("streetLamp", wx(27.6), 0, wz(29.6), Math.PI);

  // Exterior: fence around the yard, dead trees beyond.
  for (let y = 29; y <= 31; y++) { place("fence", 15 * CELL - .1, 0, wz(y), Math.PI / 2); place("fence", 30 * CELL + .1, 0, wz(y), Math.PI / 2); }
  for (let x = 15; x <= 29; x++) if (x < 21 || x > 23) place("fence", wx(x), 0, 32 * CELL, 0);
  for (let i = 0; i < 46; i++) {
    const a = r() * Math.PI * 2, d = 18 + r() * 40;
    const tx = wx(22) + Math.cos(a) * d, tz = wz(30) + Math.abs(Math.sin(a)) * d;
    if (Math.abs(tx - wx(22)) < 6) continue;
    place("tree", tx, 0, tz, r() * 6);
  }

  const propGeos = new Map<PropName, THREE.BufferGeometry>();
  for (const [name, items] of propItems) {
    const geo = keep(buildProp(name, name.length * 7 + 3));
    propGeos.set(name, geo);
    const mesh = new THREE.InstancedMesh(geo, propMats, items.length);
    items.forEach((it, i) => { mesh.setMatrixAt(i, it.m); mesh.setColorAt(i, it.color ?? new THREE.Color(1, 1, 1)); });
    mesh.castShadow = name !== "papersPile" && name !== "tree" && name !== "fence";
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }

  /* --------------------------------- lockers ---------------------------------- */
  const lockerGeo = keep(buildLocker()), lockerDoorGeo = keep(buildLockerDoor());
  const lockerMesh = new THREE.InstancedMesh(lockerGeo, propMats, SPOTS.lockers.length);
  lockerMesh.castShadow = true; lockerMesh.receiveShadow = true;
  const lockers: Locker[] = SPOTS.lockers.map((spot, index) => {
    const s = wallSide(spot.x, spot.y) ?? { dx: 0, dy: -1 };
    const yaw = yawToWall(s);
    const px = wx(spot.x) + s.dx * (CELL / 2 - .28), pz = wz(spot.y) + s.dy * (CELL / 2 - .28);
    lockerMesh.setMatrixAt(index, mat4(px, 0, pz, yaw));
    lockerMesh.setColorAt(index, new THREE.Color(0xffffff));
    const door = new THREE.Group();
    const hinge = new THREE.Group();
    // Door on the room-facing side (+Z in locker space), hinged on the left.
    hinge.position.set(-.29, 0, .26);
    const leaf = new THREE.Mesh(lockerDoorGeo, propMats);
    leaf.castShadow = true;
    hinge.add(leaf);
    door.add(hinge);
    door.position.set(px, 0, pz); door.rotation.y = yaw;
    scene.add(door);
    const inside = new THREE.Vector3(px, EYE - .05, pz).addScaledVector(new THREE.Vector3(s.dx, 0, s.dy), .05);
    // Game-space yaw looking out of the locker, away from the wall.
    return { index, x: spot.x, y: spot.y, door: hinge, open: 0, openUntil: 0, yaw: Math.atan2(-s.dy, -s.dx), inside };
  });
  lockerMesh.computeBoundingSphere();
  scene.add(lockerMesh);

  /* --------------------------------- instances -------------------------------- */
  for (const [, b] of batches) {
    if (!b.items.length) continue;
    const mesh = new THREE.InstancedMesh(b.geo, b.mat, b.items.length);
    const uv = new Float32Array(b.items.length * 4);
    b.items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      if (it.color) mesh.setColorAt(i, it.color);
      const u = it.uv ?? [0, 0, 1, 1];
      uv.set(u, i * 4);
    });
    b.geo.setAttribute("instUv", new THREE.InstancedBufferAttribute(uv, 4));
    mesh.castShadow = b.shadow; mesh.receiveShadow = b.receive;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }

  /* ---------------------------------- decals ---------------------------------- */
  const decalTex = keep(T.decalAtlas());
  const decalMat = keep(atlasMaterial(new THREE.MeshStandardMaterial({ map: decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: .6 })));
  const decalItems: Item[] = [];
  const cellUv = (i: number): [number, number, number, number] => [(i % 4) / 4, (3 - Math.floor(i / 4)) / 4, .25, .25];
  const wallDecal = (face: { x: number; z: number; dx: number; dy: number }, name: T.DecalName, y: number, size: number) => {
    decalItems.push({ m: mat4(face.x + face.dx * .015, y, face.z + face.dy * .015, faceYaw(face.dx, face.dy), size, size, 1), uv: cellUv(T.DECALS[name]) });
  };
  const floorDecal = (x: number, z: number, name: T.DecalName, size: number, yaw = r() * 6) => {
    decalItems.push({ m: mat4(x, .012, z, yaw, size, size, 1, -Math.PI / 2), uv: cellUv(T.DECALS[name]) });
  };
  const decalPool: Record<string, T.DecalName[]> = {
    corridor: ["crack", "stain", "poster0", "poster1", "graffiti1", "hands", "blood1", "stain"],
    ward: ["stain", "crack", "graffiti2", "hands", "tally", "blood0"],
    morgue: ["blood0", "blood1", "hands", "stain", "graffiti1", "drip"],
    treatment: ["blood1", "stain", "poster1", "crack", "drip"],
    hydro: ["stain", "crack", "hands", "drip"],
    isolation: ["tally", "graffiti0", "hands", "graffiti2", "blood1"],
    archive: ["stain", "crack", "graffiti3", "poster0"],
    lobby: ["poster0", "poster1", "stain", "crack", "graffiti3"],
    canteen: ["stain", "crack", "poster0", "blood1"],
    pharmacy: ["stain", "poster1", "crack"],
    security: ["crack", "stain", "graffiti1"],
  };
  for (const face of wallFaces) {
    const roll = r();
    const odds = face.zone === "isolation" ? .5 : face.zone === "corridor" ? .22 : .18;
    if (roll > odds) continue;
    const pool = decalPool[face.zone] ?? decalPool.corridor;
    const name = pool[Math.floor(r() * pool.length)];
    const high = name.startsWith("poster") || name.startsWith("graffiti");
    wallDecal(face, name, high ? 1.5 + r() * .4 : .6 + r() * 1.6, name === "drip" ? 1.4 : high ? 1.1 : .9 + r() * .7);
  }
  // Story beats placed by hand.
  const facing = (tx: number, ty: number, dx: number, dy: number) => ({ x: wx(tx) + dx * CELL / 2, z: wz(ty) + dy * CELL / 2, dx, dy });
  wallDecal(facing(20, 28, 0, -1), "graffiti3", 1.7, 1.2);
  wallDecal(facing(0, 15, 1, 0), "graffiti2", 1.8, 1.2);
  wallDecal(facing(20, 14, -1, 0), "graffiti0", 1.6, 1.3);
  wallDecal(facing(13, 4, -1, 0), "graffiti1", 1.8, 1.2);
  wallDecal(facing(14, 16, 1, 0), "tally", 1.3, 1.2);
  for (let i = 0; i < 5; i++) floorDecal(wx(6) + (r() - .5) * .4, wz(8 + i * .5), "smear", 1.4, Math.PI / 2 + (r() - .5) * .4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!interior(x, y) || at(x, y) !== ".") continue;
    const zone = zoneOf(x, y), roll = r();
    if (roll < (zone === "morgue" || zone === "treatment" ? .08 : .025)) floorDecal(wx(x) + (r() - .5), wz(y) + (r() - .5), r() < .5 ? "blood2" : "smear", 1 + r());
    else if (roll < .07) floorDecal(wx(x) + (r() - .5), wz(y) + (r() - .5), r() < .6 ? "stain" : "papers", 1.1 + r() * .6);
  }
  if (decalItems.length) {
    const geo = keep(new THREE.PlaneGeometry(1, 1));
    const mesh = new THREE.InstancedMesh(geo, decalMat, decalItems.length);
    const uv = new Float32Array(decalItems.length * 4);
    decalItems.forEach((it, i) => { mesh.setMatrixAt(i, it.m); uv.set(it.uv!, i * 4); });
    geo.setAttribute("instUv", new THREE.InstancedBufferAttribute(uv, 4));
    mesh.receiveShadow = true; mesh.renderOrder = 1;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }

  /* ---------------------------- signs and big props --------------------------- */
  const signGeo = keep(new THREE.PlaneGeometry(1.1, .275));
  const addSign = (text: string, x: number, y: number, z: number, yaw: number, kind: "plate" | "exit" = "plate") => {
    const tex = keep(T.signTexture(text, kind));
    const m = keep(kind === "exit" ? new THREE.MeshBasicMaterial({ map: tex, color: 0x303030 }) : new THREE.MeshStandardMaterial({ map: tex, roughness: .8 }));
    const mesh = new THREE.Mesh(signGeo, m);
    mesh.position.set(x, y, z); mesh.rotation.y = yaw;
    scene.add(mesh);
    return mesh;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (at(x, y) !== "d") continue;
    for (const s of SIDES) {
      const n = roomAt(x + s.dx, y + s.dy), back = roomAt(x - s.dx, y - s.dy);
      if (!n || !back || n.zone !== "corridor" || back.zone === "corridor") continue;
      addSign(back.name, wx(x) + s.dx * (CELL / 2 + .02), 2.6, wz(y) + s.dy * (CELL / 2 + .02), faceYaw(s.dx, s.dy));
    }
  }
  const exitSign = addSign("ВЫХОД", wx(22), 2.7, 28 * CELL - .02, Math.PI, "exit");
  const planMat = keep(new THREE.MeshStandardMaterial({ map: keep(T.evacuationPlan()), roughness: .7 }));
  const plan = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.1, 1.1)), planMat);
  plan.position.set(wx(17), 1.6, 22 * CELL + .02);
  scene.add(plan);

  const entranceMat = keep(new THREE.MeshStandardMaterial({ map: keep(T.entranceTexture()), roughness: .6 }));
  const exitLeaves: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(wx(22) + side * .86, 0, wz(28));
    const leaf = new THREE.Mesh(keep(new THREE.BoxGeometry(.86, 2.5, .08)), entranceMat);
    leaf.position.set(-side * .43, 1.25, 0);
    leaf.castShadow = true;
    hinge.add(leaf);
    scene.add(hinge);
    exitLeaves.push(hinge);
  }

  const breaker = new THREE.Mesh(keep(buildBreaker()), propMats);
  breaker.position.set(wx(SPOTS.switch.x), 0, SPOTS.switch.y * CELL + .16);
  breaker.castShadow = true;
  scene.add(breaker);
  const lever = new THREE.Mesh(keep(buildLever()), propMats);
  lever.position.set(wx(SPOTS.switch.x) - .35, 1.25, SPOTS.switch.y * CELL + .45);
  lever.rotation.x = .9;
  scene.add(lever);
  const breakerLamp = new THREE.Mesh(keep(new THREE.SphereGeometry(.04, 8, 6)), keep(new THREE.MeshBasicMaterial({ color: 0xff3020 })));
  breakerLamp.position.set(wx(SPOTS.switch.x) + .35, 1.95, SPOTS.switch.y * CELL + .33);
  scene.add(breakerLamp);

  /* -------------------------------- exterior ---------------------------------- */
  const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(260, 260)), keep(new THREE.MeshStandardMaterial({ map: (() => { const t = keep(T.floorTexture("asphalt", 3)); t.repeat.set(70, 70); return t; })(), color: 0x6d7060, roughness: .95 })));
  ground.rotation.x = -Math.PI / 2; ground.position.set(wx(22), -.02, wz(30));
  ground.receiveShadow = true;
  scene.add(ground);
  const road = new THREE.Mesh(keep(new THREE.PlaneGeometry(7, 160)), keep(new THREE.MeshStandardMaterial({ map: (() => { const t = keep(T.floorTexture("asphalt", 8)); t.repeat.set(3, 60); return t; })(), roughness: .8, color: 0x8a8a86 })));
  road.rotation.x = -Math.PI / 2; road.position.set(wx(22), -.01, 29 * CELL + 80);
  road.receiveShadow = true;
  scene.add(road);
  const roof = new THREE.Mesh(keep(new THREE.BoxGeometry(W * CELL + 1, .5, 1.2)), keep(new THREE.MeshStandardMaterial({ color: 0x3f3e39, roughness: .9 })));
  roof.position.set(W * CELL / 2, 7.55, 29 * CELL - .4);
  scene.add(roof);
  const facadeSign = new THREE.Mesh(keep(new THREE.PlaneGeometry(5.2, 1.3)), keep(new THREE.MeshStandardMaterial({ map: keep(T.facadeSign()), roughness: .7 })));
  facadeSign.position.set(wx(22), 3.95, 29 * CELL + .03);
  scene.add(facadeSign);
  const canopy = new THREE.Mesh(keep(new THREE.BoxGeometry(4.2, .18, 1.8)), keep(new THREE.MeshStandardMaterial({ color: 0x55544d, roughness: .9 })));
  canopy.position.set(wx(22), 3.2, 29 * CELL + .9); canopy.castShadow = true;
  scene.add(canopy);
  const figure = new THREE.Mesh(keep(new THREE.PlaneGeometry(.95, 1.9)), keep(new THREE.MeshBasicMaterial({ map: keep(T.silhouetteTexture()), color: 0x8a8a8a })));
  figure.position.set(wx(25), 5.35, 29 * CELL - .05); figure.rotation.y = 0;
  scene.add(figure);
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(350, 32, 16)), keep(new THREE.MeshBasicMaterial({ map: keep(T.skyTexture()), side: THREE.BackSide, fog: false, depthWrite: false })));
  sky.renderOrder = -10;
  scene.add(sky);
  const car = new THREE.Group();
  const carBody = new THREE.Mesh(keep(buildCar()), propMats);
  carBody.castShadow = true; carBody.receiveShadow = true;
  car.add(carBody);
  car.position.set(wx(22), 0, wz(32.6));
  scene.add(car);

  /* ---------------------------------- lights ---------------------------------- */
  const fixtures: Fixture[] = [];
  const housingGeo = keep(new THREE.BoxGeometry(1.2, .08, .3));
  const tubeGeo = keep(new THREE.BoxGeometry(1.1, .03, .16));
  const redGeo = keep(new THREE.BoxGeometry(.3, .16, .08));
  type Spot = { x: number; z: number; emergency: boolean; y?: number; yaw?: number };
  const spots: Spot[] = [];
  for (let x = 2; x <= 42; x += 4) { spots.push({ x: x * CELL + CELL / 2, z: 10 * CELL, emergency: false }); spots.push({ x: x * CELL + CELL / 2, z: 20 * CELL, emergency: false }); }
  for (const y of [12, 16]) spots.push({ x: 22 * CELL, z: wz(y), emergency: false });
  for (const room of ROOMS) {
    if (room.zone === "corridor" || room.zone === "exterior") continue;
    for (let y = room.y0 + 1; y <= room.y1; y += 3) for (let x = room.x0 + 1; x <= room.x1; x += 4) spots.push({ x: wx(x), z: wz(y), emergency: false });
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (at(x, y) !== "d") continue;
    for (const s of SIDES) if (roomAt(x + s.dx, y + s.dy)?.zone === "corridor") spots.push({ x: wx(x) + s.dx * (CELL / 2 + .05), z: wz(y) + s.dy * (CELL / 2 + .05), emergency: true, y: 2.9, yaw: faceYaw(s.dx, s.dy) });
  }
  const tubes = spots.filter(s => !s.emergency), reds = spots.filter(s => s.emergency);
  const housing = new THREE.InstancedMesh(housingGeo, keep(new THREE.MeshStandardMaterial({ color: 0x4c524e, roughness: .6, metalness: .4 })), tubes.length);
  const tubeMesh = new THREE.InstancedMesh(tubeGeo, keep(new THREE.MeshBasicMaterial({ color: 0xffffff })), tubes.length);
  const redMesh = new THREE.InstancedMesh(redGeo, keep(new THREE.MeshBasicMaterial({ color: 0xffffff })), reds.length);
  tubes.forEach((s, i) => {
    const yaw = (Math.round(s.x) + Math.round(s.z)) % 2 ? 0 : Math.PI / 2;
    housing.setMatrixAt(i, mat4(s.x, WALL_H - .04, s.z, yaw));
    tubeMesh.setMatrixAt(i, mat4(s.x, WALL_H - .09, s.z, yaw));
    tubeMesh.setColorAt(i, new THREE.Color(0));
    const tileZone = zoneOf(Math.floor(s.x / CELL), Math.floor(s.z / CELL));
    const lobby = tileZone === "lobby" && i % 3 === 0;
    const h = T.rng(i * 7 + 3)();
    fixtures.push({
      pos: new THREE.Vector3(s.x, WALL_H - .25, s.z), sector: sector(s.x / CELL), seed: i * 1.37,
      pre: lobby ? "flicker" : h < .22 ? "flicker" : h < .3 ? "steady" : "dead",
      post: h < .7 ? "steady" : h < .85 ? "flicker" : "dead",
      color: new THREE.Color(tileZone === "treatment" || tileZone === "morgue" ? 0xd8f0ff : 0xffe6b8), emergency: false, mesh: tubeMesh, index: i, level: 0,
      lobby: tileZone === "lobby",
    });
  });
  reds.forEach((s, i) => {
    redMesh.setMatrixAt(i, mat4(s.x, s.y!, s.z, s.yaw!));
    redMesh.setColorAt(i, new THREE.Color(0));
    fixtures.push({ pos: new THREE.Vector3(s.x, s.y! - .1, s.z), sector: sector(s.x / CELL), seed: i * 2.1, pre: "dead", post: "steady", color: new THREE.Color(0xff2a1a), emergency: true, mesh: redMesh, index: i, level: 0, lobby: false });
  });
  for (const m of [housing, tubeMesh, redMesh]) { m.computeBoundingSphere(); scene.add(m); }

  const hemi = new THREE.HemisphereLight(0x8fa3b0, 0x1a1712, .09);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0x9db4c8, .35);
  moon.position.set(wx(10), 30, wz(40));
  moon.target.position.set(wx(22), 0, wz(26));
  scene.add(moon, moon.target);
  const poolSize = quality === "low" ? 3 : 6;
  const pool = Array.from({ length: poolSize }, () => { const l = new THREE.PointLight(0xffe6b8, 0, 9, 1.6); scene.add(l); return { light: l, fixture: null as Fixture | null }; });
  const streetLight = new THREE.PointLight(0xffa851, 9, 18, 1.4);
  streetLight.position.set(wx(27.6) - .95, 5.0, wz(29.6));
  scene.add(streetLight);

  // Moonlight patches on floors under windows.
  const poolTex = keep(T.lightPoolTexture(true));
  const windowPoolMat = keep(new THREE.MeshBasicMaterial({ map: poolTex, color: 0x2b3f55, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const poolGeo = keep(new THREE.PlaneGeometry(1.3, 2.2));
  for (const w of windows) {
    const m = new THREE.Mesh(poolGeo, windowPoolMat);
    m.rotation.set(-Math.PI / 2, 0, 0, "YXZ");
    m.rotation.y = faceYaw(w.dx, w.dy);
    m.position.set(w.x + w.dx * 1.15, .015, w.z + w.dy * 1.15);
    scene.add(m);
  }

  /* ------------------------------- dynamic props ------------------------------- */
  const clueGeo = keep(buildClue()), batteryGeo = keep(buildBattery());
  const glowTex = keep(T.glowTexture());
  // HDR colours so the tiny flame still reads after tone mapping, from across a dark room.
  const flameMat = keep(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(0xffb35c).multiplyScalar(5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  const haloMat = keep(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(0x3a2008).multiplyScalar(2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  const clues = Array.from({ length: 4 }, () => {
    const g = new THREE.Group();
    const m = new THREE.Mesh(clueGeo, propMats); m.castShadow = true; g.add(m);
    const flame = new THREE.Sprite(flameMat); flame.position.set(.13, .76, -.08); flame.scale.set(.35, .45, 1); g.add(flame);
    const halo = new THREE.Sprite(haloMat); halo.position.set(.13, .72, -.08); halo.scale.setScalar(2.4); g.add(halo);
    g.visible = false; scene.add(g);
    return { group: g, flame, halo };
  });
  const batteryMat = keep(new THREE.SpriteMaterial({ map: glowTex, color: 0x6dff9a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .5 }));
  const batteries = Array.from({ length: 6 }, () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(batteryGeo, propMats));
    const glow = new THREE.Sprite(batteryMat); glow.position.y = .2; glow.scale.setScalar(.25); g.add(glow);
    g.visible = false; scene.add(g);
    return g;
  });

  /* ------------------------------ blood writings ------------------------------ */
  const writings = new Map<string, THREE.Mesh>();
  const writingGeo = keep(new THREE.PlaneGeometry(2.4, 1.2));
  const setWritings = (list: Array<{ id: string; tx: number; ty: number; face: number; text: string }>) => {
    const ids = new Set(list.map(w => w.id));
    for (const [id, mesh] of writings) if (!ids.has(id)) { scene.remove(mesh); (mesh.material as THREE.MeshStandardMaterial).map?.dispose(); (mesh.material as THREE.Material).dispose(); writings.delete(id); }
    for (const w of list) {
      if (writings.has(w.id)) continue;
      const tex = T.bloodWriting(w.text, w.text.length * 31 + w.tx);
      const mesh = new THREE.Mesh(writingGeo, new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, roughness: .35 }));
      const n = [{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 0, dy: 1 }][w.face];
      mesh.position.set(wx(w.tx) + n.dx * (CELL / 2 + .02), 1.65, wz(w.ty) + n.dy * (CELL / 2 + .02));
      mesh.rotation.y = faceYaw(n.dx, n.dy);
      mesh.renderOrder = 2;
      mesh.userData.born = performance.now();
      scene.add(mesh);
      writings.set(w.id, mesh);
    }
  };

  /* ---------------------------------- update ---------------------------------- */
  let screenClock = 0, poolClock = 0;
  const tmp = new THREE.Color();
  const focusFlat = new THREE.Vector3();
  const lightLevel = (f: Fixture, t: number, powered: boolean, dark: boolean, intro: boolean) => {
    // The arrival: the lobby is still lit, everything else is dead.
    if (intro) return f.lobby ? (Math.sin(t * 43 + f.seed) > .97 ? .5 : 1) : 0;
    if (dark) return 0;
    const mode = powered ? f.post : f.pre;
    if (mode === "dead") return 0;
    if (f.emergency) return .75 + Math.sin(t * 2.2 + f.seed) * .25;
    if (mode === "steady") return Math.sin(t * 61 + f.seed * 9) > .985 ? .35 : 1;
    const n = Math.sin(t * 1.3 + f.seed) + Math.sin(t * 3.7 + f.seed * 1.7) * .7 + Math.sin(t * 17 + f.seed * 3) * .35;
    return n > .55 ? 1 : n > .25 ? (Math.sin(t * 90 + f.seed) > 0 ? .9 : .08) : .04;
  };
  const update = (dt: number, s: LevelState) => {
    const t = s.time;
    // Fixtures and the point-light pool.
    for (const f of fixtures) {
      const dark = s.lightsUntil[f.sector] > s.now;
      const target = lightLevel(f, t, s.power, dark, s.intro);
      f.level = target > f.level ? target : f.level + (target - f.level) * Math.min(1, dt * 18);
      const k = f.emergency ? 3 * f.level : 2.4 * f.level;
      tmp.copy(f.color).multiplyScalar(k + (f.emergency ? 0 : .02));
      if (!f.emergency && f.level < .03) tmp.setRGB(.03, .03, .028);
      f.mesh.setColorAt(f.index, tmp);
    }
    tubeMesh.instanceColor!.needsUpdate = true;
    redMesh.instanceColor!.needsUpdate = true;
    poolClock -= dt;
    focusFlat.set(s.focus.x, WALL_H - .25, s.focus.z);
    if (poolClock <= 0) {
      poolClock = .3;
      const lit = fixtures.filter(f => (s.intro ? f.lobby : (s.power ? f.post : f.pre) !== "dead") && f.pos.distanceToSquared(focusFlat) < 20 * 20)
        .sort((a, b) => a.pos.distanceToSquared(focusFlat) - b.pos.distanceToSquared(focusFlat)).slice(0, pool.length);
      const keepers = new Set(lit);
      for (const p of pool) if (p.fixture && !keepers.has(p.fixture)) p.fixture = null;
      for (const f of lit) if (!pool.some(p => p.fixture === f)) { const free = pool.find(p => !p.fixture); if (free) { free.fixture = f; free.light.position.copy(f.pos); free.light.color.copy(f.color); } }
    }
    for (const p of pool) {
      p.light.intensity = p.fixture ? p.fixture.level * (p.fixture.emergency ? 2.2 : 4.2) : 0;
      p.light.distance = p.fixture?.emergency ? 6 : 9;
    }
    streetLight.intensity = (Math.sin(t * 7) > .92 ? 3 : 9) * (s.lightsUntil.some(v => v > s.now) ? .6 : 1);
    (breakerLamp.material as THREE.MeshBasicMaterial).color.set(s.power ? 0x40ff70 : (Math.sin(t * 5) > 0 ? 0xff3020 : 0x401010));
    lever.rotation.x += ((s.power ? -.9 : .9) - lever.rotation.x) * Math.min(1, dt * 8);
    (exitSign.material as THREE.MeshBasicMaterial).color.setScalar(s.power ? 1.8 : .12);
    // CRT static
    screenClock -= dt;
    if (screenClock <= 0) { screenClock = .08; screen.redraw(); }
    // Doors swing open for anyone who approaches, otherwise drift back.
    for (const d of doors) {
      const cx = d.group.position.x, cz = d.group.position.z;
      let target = d.rest, dir = d.swing;
      for (const b of s.bodies) {
        const dx = b.x - cx, dz = b.z - cz;
        if (dx * dx + dz * dz < 2.1 * 2.1) {
          const local = d.along === "x" ? dz : dx;
          target = 1.5; dir = local > 0 ? -1 : 1;
          break;
        }
      }
      if (d.slamUntil > s.now) target = 0;
      if (target > .05) d.swing = dir;
      const speed = d.slamUntil > s.now ? 22 : 4.5;
      const before = d.angle;
      d.angle += (target - d.angle) * Math.min(1, dt * speed);
      d.vel = dt > 0 ? (d.angle - before) / dt : 0;
      d.hinges[0].rotation.y = -d.angle * d.swing;
      d.hinges[1].rotation.y = d.angle * d.swing;
    }
    for (const l of lockers) {
      const target = l.openUntil > s.now ? 1.6 : 0;
      l.open += (target - l.open) * Math.min(1, dt * (target ? 10 : 4));
      l.door.rotation.y = -l.open;
    }
    const exitTarget = s.exitOpen ? 1.35 : 0;
    exitLeaves.forEach((h, i) => { h.rotation.y += ((i === 0 ? exitTarget : -exitTarget) - h.rotation.y) * Math.min(1, dt * (s.exitOpen ? 3 : 14)); });
    for (const c of clues) if (c.group.visible) { const k = .85 + Math.sin(t * 13 + c.group.position.x) * .08 + Math.sin(t * 29) * .05; c.flame.scale.set(.3 * k, .42 * k, 1); c.halo.material.opacity = .8 + k * .2; }
    for (const [, mesh] of writings) {
      const age = (performance.now() - mesh.userData.born) / 1000;
      (mesh.material as THREE.MeshStandardMaterial).opacity = Math.min(1, age / 1.4);
    }
    sky.position.copy(s.focus);
    figure.visible = s.intro;
  };

  return {
    doors, lockers, fixtures, clues, batteries, car, hemi, moon, streetLight, exitLeaves, figure,
    setWritings, update,
    slamNear(x: number, y: number, now: number) {
      let best: Door | null = null, gap = 99;
      for (const d of doors) { const g = Math.hypot(d.x - x, d.y - y); if (g < gap) { gap = g; best = d; } }
      if (best && gap < 2.5) { best.slamUntil = now + 2600; best.angle = Math.max(best.angle, 1.4); return best; }
      return null;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      for (const [, m] of writings) { (m.material as THREE.MeshStandardMaterial).map?.dispose(); (m.material as THREE.Material).dispose(); }
    },
  };
}

export type Level = ReturnType<typeof createLevel>;
