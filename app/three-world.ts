import * as THREE from "three";

export type Point = { x: number; y: number; yaw?: number; pitch?: number; disguised?: boolean };
export type WorldGame = {
  map: string[];
  side?: "player" | "monster";
  self: Point & { hidden?: boolean };
  rival: Point | null;
  spectate?: Point | null;
  fuses: Array<{ x: number | null; y: number | null; found: boolean }>;
  lockers: Point[];
  cameras: Point[];
  switch: Point;
  exit: Point;
  power: boolean;
  lightsUntil: number[];
  lockUntil: number;
  now: number;
};

export const CELL = 1.8;
export const EYE_HEIGHT = 1.58;
const WALL_HEIGHT = 3.18;

export function positionFor(point: Point) {
  return new THREE.Vector3((point.x + .5) * CELL, EYE_HEIGHT, (point.y + .5) * CELL);
}

function surfaceTexture(kind: "floor" | "wall") {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.fillStyle = kind === "floor" ? "#dedbd0" : "#d4d7cf";
  context.fillRect(0, 0, 128, 128);
  context.strokeStyle = kind === "floor" ? "#b0b8b0" : "#a8b8ac";
  context.lineWidth = 2;
  if (kind === "floor") {
    context.strokeRect(1, 1, 126, 126);
    context.beginPath(); context.moveTo(64, 0); context.lineTo(64, 128);
    context.moveTo(0, 64); context.lineTo(128, 64); context.stroke();
  } else {
    context.fillStyle = "#a4b5a8"; context.fillRect(0, 88, 128, 9);
    context.beginPath(); context.moveTo(0, 9); context.lineTo(128, 9); context.stroke();
  }
  for (let i = 0; i < 190; i++) {
    const x = (i * 47 + i * i * 3) % 128, y = (i * 79 + i * i * 5) % 128;
    context.fillStyle = i % 3 ? "#48594e18" : "#ffffff20";
    context.fillRect(x, y, i % 5 === 0 ? 3 : 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 2;
  return texture;
}

type Instance = { matrix: THREE.Matrix4; color?: THREE.Color };

export function createWorld(initial: WorldGame) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111b1c);
  const fog = new THREE.FogExp2(0x111b1c, .035);
  scene.fog = fog;

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const geometry = <T extends THREE.BufferGeometry>(value: T) => { geometries.add(value); return value; };
  const material = <T extends THREE.Material>(value: T) => { materials.add(value); return value; };
  const floorTexture = surfaceTexture("floor"), wallTexture = surfaceTexture("wall");
  textures.add(floorTexture); textures.add(wallTexture);
  const stone = material(new THREE.MeshLambertMaterial({ color: 0xffffff, map: wallTexture }));
  const floorMaterial = material(new THREE.MeshLambertMaterial({ color: 0xffffff, map: floorTexture }));
  const ceilingMaterial = material(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const timber = material(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const paper = material(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const metal = material(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const darkMetal = material(new THREE.MeshLambertMaterial({ color: 0x273b3a }));
  const fixture = material(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const amber = material(new THREE.MeshBasicMaterial({ color: 0xe9bc73 }));
  const cold = material(new THREE.MeshBasicMaterial({ color: 0x94b7ab }));
  const red = material(new THREE.MeshBasicMaterial({ color: 0xe76452 }));
  const black = material(new THREE.MeshLambertMaterial({ color: 0x151919 }));

  const width = initial.map[0].length, height = initial.map.length;
  type Zone = "arrival" | "foyer" | "ward" | "treatment" | "records";
  const zone = (x: number, y: number): Zone =>
    y >= height - 2 ? "arrival" : y >= 14 ? "foyer" : x <= 8 ? "ward" : x <= 17 ? "treatment" : "records";
  const floorTone: Record<Zone, number> = {
    arrival: 0x788387, foyer: 0xadb1a8, ward: 0x9eb6a7, treatment: 0xaac6c0, records: 0xb5b09d,
  };
  const wallTone: Record<Zone, number> = {
    arrival: 0x4e6064, foyer: 0x898f7d, ward: 0x607d71, treatment: 0x748f8c, records: 0x887d67,
  };
  const walkable = (x: number, y: number) => initial.map[y]?.[x] === ".";
  const hash = (x: number, y: number) => (Math.imul(x + 31, 73856093) ^ Math.imul(y + 17, 19349663)) >>> 0;

  const cube = geometry(new THREE.BoxGeometry(1, 1, 1));
  const capsule = geometry(new THREE.SphereGeometry(1, 8, 6));
  const cloak = geometry(new THREE.ConeGeometry(.43, 1.45, 7));
  const prism = geometry(new THREE.CylinderGeometry(.12, .17, .2, 6));
  const dummy = new THREE.Object3D();
  const makeInstance = (items: Instance[], mat: THREE.Material) => {
    if (!items.length) return;
    const mesh = new THREE.InstancedMesh(cube, mat, items.length);
    for (let i = 0; i < items.length; i++) {
      mesh.setMatrixAt(i, items[i].matrix);
      mesh.setColorAt(i, items[i].color ?? new THREE.Color(0xffffff));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    return mesh;
  };
  const instance = (items: Instance[], x: number, y: number, z: number, sx: number, sy: number, sz: number, rotation = 0, color?: number) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rotation, 0);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    items.push({ matrix: dummy.matrix.clone(), color: new THREE.Color(color ?? 0xffffff) });
  };


  const floors: Instance[] = [], walls: Instance[] = [], ceilings: Instance[] = [];
  const trims: Instance[] = [], glassWalls: Instance[] = [], steelProps: Instance[] = [], clothProps: Instance[] = [];
  const woodProps: Instance[] = [], paperProps: Instance[] = [], lights: Instance[] = [];
  const around = [{ dx: -1, dz: 0, turn: Math.PI / 2 }, { dx: 1, dz: 0, turn: Math.PI / 2 },
    { dx: 0, dz: -1, turn: 0 }, { dx: 0, dz: 1, turn: 0 }];
  const prop = (items: Instance[], tileX: number, tileY: number, dx: number, dz: number,
    lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: number) => {
    const turn = dx ? Math.PI / 2 : 0, c = Math.cos(turn), s = Math.sin(turn);
    instance(items, (tileX + .5) * CELL + dx * .55 + lx * c + lz * s,
      ly, (tileY + .5) * CELL + dz * .55 - lx * s + lz * c, sx, sy, sz, turn, color);
  };
  const reserved = new Set<string>([
    String(initial.exit.x) + "," + String(initial.exit.y),
    String(initial.switch.x) + "," + String(initial.switch.y),
    "12,17", "14,17", "12,16", "23,3",
    ...initial.lockers.map(p => String(Math.floor(p.x)) + "," + String(Math.floor(p.y))),
    ...initial.cameras.map(p => String(Math.floor(p.x)) + "," + String(Math.floor(p.y))),
    ...initial.fuses.filter(f => f.x !== null && f.y !== null).map(f => String(Math.floor(f.x!)) + "," + String(Math.floor(f.y!))),
  ]);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const worldX = (x + .5) * CELL, worldZ = (y + .5) * CELL;
    const z = zone(x, y), h = hash(x, y);
    if (!walkable(x, y)) {
      if (y === height - 1 && x === 13) continue;
      if (y === height - 1 && x >= 9 && x <= 17) {
        // Glazed southern wall lets both friends see the car, while the server
        // still treats the boundary as solid.
        instance(glassWalls, worldX, 1.4, worldZ - CELL * .49, CELL - .14, 2.73, .07,
          0, 0xa1c4c5);
        instance(trims, worldX, 2.85, worldZ - CELL * .49, CELL, .13, .13, 0, 0x476266);
        continue;
      }
      const face = around.find(p => walkable(x + p.dx, y + p.dz));
      const visibleZone = face ? zone(x + face.dx, y + face.dz) : z;
      instance(walls, worldX, WALL_HEIGHT / 2, worldZ, CELL, WALL_HEIGHT, CELL, 0, wallTone[visibleZone]);
      for (const side of around) {
        if (!walkable(x + side.dx, y + side.dz)) continue;
        const fx = worldX + side.dx * (CELL / 2 + .025), fz = worldZ + side.dz * (CELL / 2 + .025);
        const facingZone = zone(x + side.dx, y + side.dz);
        instance(trims, fx, .13, fz, CELL * .92, .24, .06, side.turn,
          facingZone === "records" ? 0x655f50 : 0x55736c);
        instance(trims, fx, 1.16, fz, CELL * .92, .11, .065, side.turn,
          facingZone === "ward" ? 0x5e8775 : facingZone === "treatment" ? 0x5a8a86 : 0x837c67);
        if (h % 11 === 0 && facingZone !== "arrival") {
          instance(paperProps, fx, 2.12, fz, .44, .34, .07, side.turn, 0xd2d4bd);
          instance(lights, fx + side.dx * .045, 2.12, fz + side.dz * .045, .15, .14, .025,
            side.turn, facingZone === "ward" ? 0x8bb49c : 0xc1a576);
        }
      }
      continue;
    }
    instance(floors, worldX, -.035, worldZ, CELL, .07, CELL,
      0, floorTone[z] + ((h % 5) - 2) * 0x010101);
    if (z !== "arrival") {
      instance(ceilings, worldX, WALL_HEIGHT + .025, worldZ, CELL, .05, CELL,
        0, z === "treatment" ? 0x6c8580 : 0x5d6b65);
      if (h % 8 === 0) instance(lights, worldX, WALL_HEIGHT - .02, worldZ, .72, .025, .24,
        0, z === "treatment" ? 0xc7e7da : 0xd5caa1);
    } else if ((x + y) % 2 === 0) {
      instance(trims, worldX, .006, worldZ, CELL * .93, .012, .04, 0, 0xc4c3ae);
    }
    if (reserved.has(String(x) + "," + String(y)) || y === 7 || y === 13 || z === "arrival") continue;
    const candidates = around.filter(p => !walkable(x + p.dx, y + p.dz));
    if (!candidates.length) continue;
    const side = candidates[h % candidates.length];
    if (z === "ward" && h % 5 === 0) {
      prop(steelProps, x, y, side.dx, side.dz, 0, .31, 0, 1.24, .12, .58, 0x6e8279);
      prop(clothProps, x, y, side.dx, side.dz, 0, .43, 0, 1.12, .13, .54, 0xb8caba);
      prop(paperProps, x, y, side.dx, side.dz, -.4, .53, 0, .23, .07, .45, 0xdfe0d1);
      prop(steelProps, x, y, side.dx, side.dz, -.58, .54, 0, .04, .4, .62, 0x71847d);
    } else if (z === "ward" && h % 7 === 0) {
      prop(clothProps, x, y, side.dx, side.dz, 0, .85, 0, .035, 1.5, .83, 0xb4c8bc);
      prop(steelProps, x, y, side.dx, side.dz, 0, 1.64, 0, .07, .05, .9, 0x6d8278);
    } else if (z === "treatment" && h % 5 === 0) {
      prop(steelProps, x, y, side.dx, side.dz, 0, .54, 0, 1.15, .14, .6, 0x788f8a);
      prop(clothProps, x, y, side.dx, side.dz, 0, .64, 0, 1.0, .1, .52, 0x9fb9ae);
      prop(steelProps, x, y, side.dx, side.dz, -.43, 1.1, -.15, .06, .85, .07, 0x9db4ab);
      prop(paperProps, x, y, side.dx, side.dz, -.43, 1.56, -.15, .2, .08, .2, 0xd5e3cd);
    } else if (z === "treatment" && h % 6 === 0) {
      prop(steelProps, x, y, side.dx, side.dz, 0, .57, 0, 1.0, 1.14, .38, 0x778e88);
      prop(paperProps, x, y, side.dx, side.dz, 0, 1.07, -.2, .72, .25, .018, 0xa6c0b5);
    } else if (z === "records" && h % 4 === 0) {
      prop(woodProps, x, y, side.dx, side.dz, 0, .9, 0, 1.03, 1.8, .34, 0x6c6757);
      for (let row = 0; row < 4; row++) {
        prop(paperProps, x, y, side.dx, side.dz, 0, .27 + row * .4, -.185, .81, .29, .02,
          row % 2 ? 0xa7a28c : 0xbfb9a2);
        prop(steelProps, x, y, side.dx, side.dz, 0, .27 + row * .4, -.209, .18, .025, .025, 0x586460);
      }
    } else if (z === "records" && h % 7 === 0) {
      prop(woodProps, x, y, side.dx, side.dz, 0, .43, 0, 1.13, .85, .39, 0x756e5a);
      prop(paperProps, x, y, side.dx, side.dz, .18, .9, 0, .42, .055, .28, 0xcec6a7);
    } else if (z === "foyer" && h % 6 === 0) {
      prop(woodProps, x, y, side.dx, side.dz, 0, .57, 0, 1.16, .13, .41, 0x6d6553);
      prop(steelProps, x, y, side.dx, side.dz, -.43, .28, 0, .055, .52, .32, 0x6d807a);
      prop(steelProps, x, y, side.dx, side.dz, .43, .28, 0, .055, .52, .32, 0x6d807a);
      prop(clothProps, x, y, side.dx, side.dz, 0, .9, .14, 1.1, .5, .08, 0x958e7a);
    }
  }
  makeInstance(floors, floorMaterial);
  makeInstance(walls, stone);
  makeInstance(ceilings, ceilingMaterial);
  makeInstance(trims, metal);
  makeInstance(glassWalls, material(new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: .38, depthWrite: false })));
  makeInstance(steelProps, metal);
  makeInstance(clothProps, paper);
  makeInstance(woodProps, timber);
  makeInstance(paperProps, paper);
  makeInstance(lights, fixture);
  const mesh = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const part = new THREE.Mesh(geo, mat);
    part.position.set(x, y, z);
    part.scale.set(sx, sy, sz);
    parent.add(part);
    return part;
  };
  const fuseModels = Array.from({ length: initial.fuses.length }, () => {
    const group = new THREE.Group();
    // A warm-lit patient file on a narrow trolley, legible in flashlight range.
    mesh(group, cube, metal, 0, .34, 0, .055, .65, .055);
    mesh(group, cube, metal, 0, .68, 0, .47, .07, .35);
    mesh(group, cube, amber, 0, .74, -.03, .37, .025, .26);
    mesh(group, cube, paper, 0, .765, -.03, .3, .012, .19);
    mesh(group, cube, red, 0, .78, -.07, .12, .006, .025);
    mesh(group, cube, red, 0, .78, -.07, .025, .006, .1);
    scene.add(group);
    return group;
  });

  for (const locker of initial.lockers) {
    const group = new THREE.Group();
    const base = positionFor(locker);
    const nearWest = !walkable(Math.floor(locker.x) - 1, Math.floor(locker.y));
    const nearEast = !walkable(Math.floor(locker.x) + 1, Math.floor(locker.y));
    const nearNorth = !walkable(Math.floor(locker.x), Math.floor(locker.y) - 1);
    group.position.set(base.x + (nearWest ? -.63 : nearEast ? .63 : 0), 0, base.z + (nearNorth ? -.63 : nearWest || nearEast ? 0 : .63));
    if (nearWest || nearEast) group.rotation.y = Math.PI / 2;
    mesh(group, cube, metal, 0, .94, 0, .42, 1.88, .23);
    mesh(group, cube, darkMetal, 0, 1.03, -.126, .33, 1.62, .016);
    for (let i = 0; i < 4; i++) mesh(group, cube, paper, 0, 1.55 - i * .11, -.14, .18, .012, .013);
    mesh(group, cube, amber, .1, .93, -.15, .025, .1, .02);
    scene.add(group);
  }

  for (const watch of initial.cameras) {
    const group = new THREE.Group();
    group.position.set((watch.x + .5) * CELL, WALL_HEIGHT - .25, (watch.y + .5) * CELL);
    mesh(group, cube, metal, 0, 0, 0, .08, .33, .08);
    mesh(group, cube, darkMetal, 0, -.23, -.12, .28, .17, .25);
    mesh(group, prism, red, 0, -.23, -.28, .35, .22, .3);
    scene.add(group);
  }

  const switchGroup = new THREE.Group();
  // Security spawns on this tile; attach the console to its north wall so the
  // first-person camera never begins inside the housing.
  switchGroup.position.set((initial.switch.x + .5) * CELL, 0, (initial.switch.y + .5) * CELL - .75);
  mesh(switchGroup, cube, metal, 0, 1.19, 0, .59, .8, .27);
  mesh(switchGroup, cube, darkMetal, 0, 1.29, -.145, .46, .55, .017);
  const switchLamp = mesh(switchGroup, cube, amber, .14, 1.48, -.166, .08, .08, .02);
  for (let i = 0; i < 3; i++) mesh(switchGroup, cube, paper, -.13, 1.48 - i * .15, -.166, .12, .05, .02);
  scene.add(switchGroup);

  const exitGroup = new THREE.Group();
  exitGroup.position.set((initial.exit.x + .5) * CELL, 0, (initial.exit.y + 1) * CELL);
  const door = mesh(exitGroup, cube, darkMetal, 0, 1.14, 0, 1.22, 2.28, .13);
  mesh(exitGroup, cube, metal, -.69, 1.21, 0, .11, 2.52, .19);
  mesh(exitGroup, cube, metal, .69, 1.21, 0, .11, 2.52, .19);
  mesh(exitGroup, cube, metal, 0, 2.44, 0, 1.49, .11, .19);
  const exitLamp = mesh(exitGroup, cube, red, 0, 2.57, -.06, .32, .1, .04);
  scene.add(exitGroup);

  const visitorJacket = material(new THREE.MeshLambertMaterial({ color: 0x54737a }));
  const patientGown = material(new THREE.MeshLambertMaterial({ color: 0xaaa697 }));
  const skin = material(new THREE.MeshLambertMaterial({ color: 0xc9c1aa }));
  const human = (shirt: THREE.Material) => {
    const avatar = new THREE.Group();
    mesh(avatar, cube, shirt, 0, 1.05, 0, .54, .73, .29);
    mesh(avatar, capsule, skin, 0, 1.67, 0, .22, .28, .22);
    mesh(avatar, cube, black, 0, 1.86, .035, .28, .11, .25);
    mesh(avatar, cube, darkMetal, -.15, .44, 0, .2, .82, .22);
    mesh(avatar, cube, darkMetal, .15, .44, 0, .2, .82, .22);
    mesh(avatar, cube, shirt, -.37, 1.03, 0, .17, .62, .2).rotation.z = -.13;
    mesh(avatar, cube, shirt, .37, 1.03, 0, .17, .62, .2).rotation.z = .13;
    return avatar;
  };
  const visitorAvatar = human(visitorJacket);
  scene.add(visitorAvatar);
  const monsterAvatar = new THREE.Group();
  const trueForm = new THREE.Group();
  const body = new THREE.Mesh(cloak, black);
  body.position.y = .77; body.rotation.z = Math.PI;
  trueForm.add(body);
  mesh(trueForm, capsule, black, 0, 1.6, 0, .28, .38, .28);
  mesh(trueForm, cube, red, -.115, 1.62, -.27, .07, .04, .025);
  mesh(trueForm, cube, red, .115, 1.62, -.27, .07, .04, .025);
  mesh(trueForm, cube, black, -.42, .81, 0, .16, .85, .2).rotation.z = -.31;
  mesh(trueForm, cube, black, .42, .81, 0, .16, .85, .2).rotation.z = .31;
  const disguiseForm = human(patientGown);
  monsterAvatar.add(trueForm, disguiseForm);
  scene.add(monsterAvatar);

  // The car is beyond a glazed entrance. It is visible in the shared arrival
  // without occupying either player's walkable spawn tile.
  const arrivalCar = new THREE.Group();
  arrivalCar.position.set((13 + .5) * CELL, 0, (height + .1) * CELL);
  const carPaint = material(new THREE.MeshLambertMaterial({ color: 0x34494b }));
  const carGlass = material(new THREE.MeshLambertMaterial({
    color: 0x789ba0, transparent: true, opacity: .23, depthWrite: false,
  }));
  const tire = material(new THREE.MeshLambertMaterial({ color: 0x0f1719 }));
  // Static road stays put while the car group animates toward the entrance.
  mesh(scene, cube, darkMetal, (13 + .5) * CELL, -.09, (height + 4.7) * CELL, 11.4, .12, 22);
  for (let i = 0; i < 5; i++) {
    mesh(scene, cube, paper, (13 + .5) * CELL, -.02, (height + .6 + i * 2.1) * CELL, .065, .012, .8);
  }
  mesh(arrivalCar, cube, carPaint, 0, .61, 0, 1.37, .56, 2.65);
  // The cabin is open at eye height for the shared first-person driving shot.
  mesh(arrivalCar, cube, carPaint, 0, 1.57, -.22, 1.3, .08, 1.47);
  mesh(arrivalCar, cube, carPaint, -.63, 1.18, -.22, .07, .8, 1.36);
  mesh(arrivalCar, cube, carPaint, .63, 1.18, -.22, .07, .8, 1.36);
  mesh(arrivalCar, cube, carGlass, 0, 1.04, -.92, 1.04, .42, .05);
  mesh(arrivalCar, cube, carGlass, -.62, 1.04, -.22, .04, .39, 1.07);
  mesh(arrivalCar, cube, carGlass, .62, 1.04, -.22, .04, .39, 1.07);
  // Low dashboard and wheel make the first five seconds read as a car cabin
  // without covering the windshield at either seat camera.
  mesh(arrivalCar, cube, carPaint, 0, .89, -.98, 1.15, .19, .28);
  mesh(arrivalCar, cube, darkMetal, -.35, 1.01, -.82, .43, .08, .07);
  mesh(arrivalCar, cube, amber, -.42, 1.02, -.86, .07, .027, .01);
  mesh(arrivalCar, cube, amber, -.28, 1.02, -.86, .07, .027, .01);
  const wheelRing = geometry(new THREE.TorusGeometry(.21, .026, 5, 12));
  const wheel = new THREE.Mesh(wheelRing, tire);
  wheel.position.set(-.35, 1.1, -.61);
  wheel.rotation.x = -.28;
  arrivalCar.add(wheel);
  mesh(arrivalCar, cube, tire, -.35, 1.1, -.64, .09, .09, .06);
  mesh(arrivalCar, cube, tire, -.35, .94, -.82, .055, .33, .055).rotation.x = .4;
  for (const seatX of [-.35, .35]) {
    mesh(arrivalCar, cube, patientGown, seatX, .62, .26, .52, .15, .57);
    mesh(arrivalCar, cube, darkMetal, seatX, 1.02, .62, .53, .81, .12);
  }
  mesh(arrivalCar, cube, darkMetal, 0, 1.43, -.67, .29, .1, .05);
  mesh(arrivalCar, cube, metal, 0, .42, -1.34, 1.19, .11, .13);
  mesh(arrivalCar, cube, amber, -.42, .65, -1.34, .25, .14, .04);
  mesh(arrivalCar, cube, amber, .42, .65, -1.34, .25, .14, .04);
  mesh(arrivalCar, cube, red, -.42, .65, 1.34, .25, .13, .04);
  mesh(arrivalCar, cube, red, .42, .65, 1.34, .25, .13, .04);
  for (const x of [-.69, .69]) for (const z of [-.82, .82]) {
    const wheel = mesh(arrivalCar, prism, tire, x, .31, z, 1.65, .95, 1.65);
    wheel.rotation.z = Math.PI / 2;
  }
  const cabinGlow = new THREE.PointLight(0xe7bc83, 1.35, 3.2, 2);
  cabinGlow.position.set(0, 1.43, -.15);
  arrivalCar.add(cabinGlow);
  scene.add(arrivalCar);
  const front = (height - 1) * CELL;
  mesh(scene, cube, metal, (13 + .5) * CELL, 3.34, front, 14.8, .25, .58);
  mesh(scene, cube, darkMetal, (13 + .5) * CELL, 3.63, front - .17, 5.1, .44, .14);
  mesh(scene, cube, red, (13 + .5) * CELL, 3.65, front - .26, .46, .32, .035);
  mesh(scene, cube, red, (13 + .5) * CELL, 3.65, front - .28, .16, .65, .035);

  const hemisphere = new THREE.HemisphereLight(0xb8c8bd, 0x101a1d, .39);
  scene.add(hemisphere);
  const moon = new THREE.DirectionalLight(0x829da8, .1);
  moon.position.set(width * CELL * .34, 8, height * CELL * .88);
  scene.add(moon);
  const entranceLight = new THREE.PointLight(0xd3a36e, 7, 11, 1.8);
  entranceLight.position.set((13 + .5) * CELL, 2.65, (height - 1.7) * CELL);
  scene.add(entranceLight);
  const securityLight = new THREE.PointLight(0xae4c4d, 3.5, 9, 1.8);
  securityLight.position.set((23 + .5) * CELL, 2.5, (3 + .5) * CELL);
  scene.add(securityLight);
  const torch = new THREE.SpotLight(0xf4e5c2, 20, 14, Math.PI / 6, .61, 1.2);
  torch.castShadow = false;
  const torchTarget = new THREE.Object3D();
  scene.add(torch, torchTarget);
  torch.target = torchTarget;

  const update = (game: WorldGame) => {
    for (let i = 0; i < fuseModels.length; i++) {
      const fuse = game.fuses[i];
      const group = fuseModels[i];
      group.visible = !!fuse && !fuse.found && fuse.x !== null && fuse.y !== null;
      if (group.visible) group.position.set((fuse.x! + .5) * CELL, .02, (fuse.y! + .5) * CELL);
    }
    const visitor = game.side === "monster" ? game.rival : game.self;
    const monster = game.side === "monster" ? game.self : game.rival;
    // First-person cameras should never see their own full-body model.
    visitorAvatar.visible = game.side === "monster" && !!visitor;
    monsterAvatar.visible = game.side !== "monster" && !!monster;
    if (visitor) {
      visitorAvatar.position.set((visitor.x + .5) * CELL, 0, (visitor.y + .5) * CELL);
      visitorAvatar.rotation.y = -(visitor.yaw ?? 0) - Math.PI / 2;
    }
    if (monster) {
      monsterAvatar.position.set((monster.x + .5) * CELL, 0, (monster.y + .5) * CELL);
      monsterAvatar.rotation.y = -(monster.yaw ?? 0) - Math.PI / 2;
    }
    trueForm.visible = !monster?.disguised;
    disguiseForm.visible = !!monster?.disguised;
    switchLamp.material = game.power ? cold : red;
    exitLamp.material = game.lockUntil > game.now ? red : game.power ? cold : red;
    door.material = game.power ? metal : darkMetal;
    door.visible = !game.power || game.lockUntil > game.now;
    const sector = Math.max(0, Math.min(2, Math.floor(game.self.x / (width / 3))));
    const blackedOut = game.lightsUntil[sector] > game.now;
    hemisphere.intensity = blackedOut ? .1 : .39;
    moon.intensity = blackedOut ? .03 : .1;
    entranceLight.intensity = blackedOut ? 2.2 : 7;
    securityLight.intensity = blackedOut ? 1.5 : 3.5;
    torch.intensity = blackedOut ? 24 : 20;
    fog.density = blackedOut ? .064 : .035;
  };
  update(initial);

  return {
    scene,
    monster: monsterAvatar,
    monsterAvatar,
    visitorAvatar,
    arrivalCar,
    torch,
    torchTarget,
    update,
    dispose() {
      for (const value of geometries) value.dispose();
      for (const value of materials) value.dispose();
      for (const value of textures) value.dispose();
    },
  };
}
