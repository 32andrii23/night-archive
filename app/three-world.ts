import * as THREE from "three";

export type Point = { x: number; y: number };
export type WorldGame = {
  map: string[];
  self: Point & { hidden?: boolean };
  rival: Point | null;
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
const WALL_HEIGHT = 3.05;
const WALL_COLOR = 0x57615a;

export function positionFor(point: Point) {
  return new THREE.Vector3((point.x + .5) * CELL, EYE_HEIGHT, (point.y + .5) * CELL);
}

function surfaceTexture(kind: "floor" | "wall") {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.fillStyle = kind === "floor" ? "#49504b" : "#687068";
  context.fillRect(0, 0, 128, 128);
  context.strokeStyle = kind === "floor" ? "#2f3936" : "#4d584f";
  context.lineWidth = 2;
  if (kind === "floor") {
    for (let i = 0; i <= 128; i += 32) {
      context.beginPath(); context.moveTo(i, 0); context.lineTo(i, 128); context.stroke();
      context.beginPath(); context.moveTo(0, i); context.lineTo(128, i); context.stroke();
    }
  } else {
    for (let i = 0; i <= 128; i += 24) {
      context.beginPath(); context.moveTo(0, i); context.lineTo(128, i); context.stroke();
    }
    context.fillStyle = "#293431";
    for (let i = 0; i < 32; i++) context.fillRect((i * 37 + 19) % 126, (i * 53 + 7) % 126, 2, 3);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
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
  floorTexture.repeat.set(initial.map[0].length, initial.map.length);

  const stone = material(new THREE.MeshLambertMaterial({ color: WALL_COLOR, map: wallTexture }));
  const floorMaterial = material(new THREE.MeshLambertMaterial({ color: 0x818980, map: floorTexture, side: THREE.DoubleSide }));
  const ceilingMaterial = material(new THREE.MeshLambertMaterial({ color: 0x28322f, side: THREE.DoubleSide }));
  const timber = material(new THREE.MeshLambertMaterial({ color: 0x756b58 }));
  const paper = material(new THREE.MeshLambertMaterial({ color: 0xb0a17f }));
  const metal = material(new THREE.MeshLambertMaterial({ color: 0x64746b }));
  const darkMetal = material(new THREE.MeshLambertMaterial({ color: 0x273b3a }));
  const amber = material(new THREE.MeshBasicMaterial({ color: 0xe9bc73 }));
  const cold = material(new THREE.MeshBasicMaterial({ color: 0x94b7ab }));
  const red = material(new THREE.MeshBasicMaterial({ color: 0xe76452 }));
  const black = material(new THREE.MeshLambertMaterial({ color: 0x151919 }));

  const width = initial.map[0].length, height = initial.map.length;
  const floor = new THREE.Mesh(geometry(new THREE.PlaneGeometry(width * CELL, height * CELL)), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(width * CELL / 2, 0, height * CELL / 2);
  scene.add(floor);
  const ceiling = new THREE.Mesh(geometry(new THREE.PlaneGeometry(width * CELL, height * CELL)), ceilingMaterial);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(width * CELL / 2, WALL_HEIGHT, height * CELL / 2);
  scene.add(ceiling);

  const cube = geometry(new THREE.BoxGeometry(1, 1, 1));
  const capsule = geometry(new THREE.SphereGeometry(1, 8, 6));
  const cloak = geometry(new THREE.ConeGeometry(.43, 1.45, 7));
  const prism = geometry(new THREE.CylinderGeometry(.12, .17, .2, 6));
  const dummy = new THREE.Object3D();
  const makeInstance = (items: Instance[], mat: THREE.Material) => {
    const mesh = new THREE.InstancedMesh(cube, mat, items.length);
    for (let i = 0; i < items.length; i++) {
      mesh.setMatrixAt(i, items[i].matrix);
      const tint = items[i].color;
      if (tint) mesh.setColorAt(i, tint);
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
    items.push({ matrix: dummy.matrix.clone(), color: color === undefined ? undefined : new THREE.Color(color) });
  };

  const walls: Instance[] = [];
  const boards: Instance[] = [];
  const books: Instance[] = [];
  const lights: Instance[] = [];
  const beams: Instance[] = [];
  const shelfPalette = [0x8e866d, 0x777a69, 0x9b765b, 0x77877b, 0xb5a17d];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const worldX = (x + .5) * CELL, worldZ = (y + .5) * CELL;
    if (initial.map[y][x] === "#") {
      instance(walls, worldX, WALL_HEIGHT / 2, worldZ, CELL, WALL_HEIGHT, CELL, 0, (x + y) % 4 === 0 ? 0x8c9488 : 0xffffff);
      if ((x * 7 + y * 11) % 4 !== 0) continue;
      const faces = [
        { dx: 0, dz: -1, angle: 0 }, { dx: 0, dz: 1, angle: Math.PI },
        { dx: -1, dz: 0, angle: Math.PI / 2 }, { dx: 1, dz: 0, angle: -Math.PI / 2 },
      ];
      for (const face of faces) {
        if (initial.map[y + face.dz]?.[x + face.dx] !== ".") continue;
        const cx = worldX + face.dx * (CELL / 2 + .025);
        const cz = worldZ + face.dz * (CELL / 2 + .025);
        const ca = Math.cos(face.angle), sa = Math.sin(face.angle);
        const put = (list: Instance[], lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color?: number) => {
          instance(list, cx + lx * ca + lz * sa, ly, cz - lx * sa + lz * ca, sx, sy, sz, face.angle, color);
        };
        put(boards, -.56, 1.22, 0, .09, 2.02, .13);
        put(boards, .56, 1.22, 0, .09, 2.02, .13);
        for (let row = 0; row < 4; row++) {
          const shelfY = .35 + row * .55;
          put(boards, 0, shelfY, 0, 1.2, .09, .19);
          for (let col = 0; col < 10; col++) {
            const seed = (x * 17 + y * 29 + row * 13 + col * 7) % 5;
            put(books, -.48 + col * .105, shelfY + .2, .055, .065 + seed * .005, .27 + seed * .025, .12, shelfPalette[seed]);
          }
        }
      }
    } else {
      if ((x * 5 + y * 3) % 7 === 0) instance(beams, worldX, WALL_HEIGHT - .12, worldZ, CELL * .92, .12, .18);
      if ((x * 11 + y * 5) % 13 === 0) instance(lights, worldX, WALL_HEIGHT - .018, worldZ, .64, .025, .22);
    }
  }
  makeInstance(walls, stone);
  if (boards.length) makeInstance(boards, timber);
  if (books.length) makeInstance(books, paper);
  if (beams.length) makeInstance(beams, darkMetal);
  if (lights.length) makeInstance(lights, amber);

  const mesh = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const part = new THREE.Mesh(geo, mat);
    part.position.set(x, y, z);
    part.scale.set(sx, sy, sz);
    parent.add(part);
    return part;
  };
  const fuseModels = Array.from({ length: initial.fuses.length }, () => {
    const group = new THREE.Group();
    mesh(group, cube, metal, 0, .17, 0, .28, .34, .25);
    mesh(group, cube, amber, 0, .23, -.135, .14, .13, .02);
    mesh(group, cube, darkMetal, -.1, .39, 0, .05, .11, .08);
    mesh(group, cube, darkMetal, .1, .39, 0, .05, .11, .08);
    scene.add(group);
    return group;
  });

  for (const locker of initial.lockers) {
    const group = new THREE.Group();
    const base = positionFor(locker);
    const nearWest = initial.map[locker.y]?.[locker.x - 1] === "#";
    const nearEast = initial.map[locker.y]?.[locker.x + 1] === "#";
    const nearNorth = initial.map[locker.y - 1]?.[locker.x] === "#";
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
    group.position.copy(positionFor(watch));
    mesh(group, cube, metal, 0, .97, 0, .27, .12, .2);
    mesh(group, prism, darkMetal, 0, .9, -.15, 1, 1, 1);
    mesh(group, cube, red, 0, .87, -.255, .07, .04, .015);
    scene.add(group);
  }

  const switchGroup = new THREE.Group();
  switchGroup.position.copy(positionFor(initial.switch));
  mesh(switchGroup, cube, metal, 0, -.12, 0, .36, .48, .18);
  const switchLamp = mesh(switchGroup, cube, amber, 0, -.28, -.1, .13, .07, .025);
  mesh(switchGroup, cube, black, 0, .01, -.11, .06, .18, .035);
  scene.add(switchGroup);

  const exitGroup = new THREE.Group();
  exitGroup.position.set((initial.exit.x + .5) * CELL + .63, 0, (initial.exit.y + .5) * CELL);
  const door = mesh(exitGroup, cube, darkMetal, 0, 1.14, 0, .13, 2.28, 1.26);
  mesh(exitGroup, cube, metal, -.09, 1.21, -.68, .25, 2.52, .1);
  mesh(exitGroup, cube, metal, -.09, 1.21, .68, .25, 2.52, .1);
  mesh(exitGroup, cube, metal, -.09, 2.44, 0, .25, .1, 1.45);
  const exitLamp = mesh(exitGroup, cube, red, -.09, 2.54, 0, .06, .08, .23);
  scene.add(exitGroup);

  const monster = new THREE.Group();
  const body = new THREE.Mesh(cloak, black);
  body.position.y = .75;
  monster.add(body);
  mesh(monster, capsule, black, 0, 1.57, 0, .29, .37, .29);
  mesh(monster, cube, red, -.115, 1.61, -.27, .07, .035, .025);
  mesh(monster, cube, red, .115, 1.61, -.27, .07, .035, .025);
  mesh(monster, cube, black, -.42, .79, 0, .17, .74, .22).rotation.z = -.32;
  mesh(monster, cube, black, .42, .79, 0, .17, .74, .22).rotation.z = .32;
  scene.add(monster);

  const hemisphere = new THREE.HemisphereLight(0xb9c5b1, 0x1b2525, 1.32);
  scene.add(hemisphere);
  const torch = new THREE.SpotLight(0xf4dfb5, 17, 13, Math.PI / 5, .62, 1.25);
  torch.castShadow = false;
  const torchTarget = new THREE.Object3D();
  scene.add(torch, torchTarget);
  torch.target = torchTarget;

  const update = (game: WorldGame) => {
    for (let i = 0; i < fuseModels.length; i++) {
      const fuse = game.fuses[i];
      const group = fuseModels[i];
      group.visible = !fuse.found && fuse.x !== null && fuse.y !== null;
      if (group.visible) group.position.set((fuse.x! + .5) * CELL, .02, (fuse.y! + .5) * CELL);
    }
    monster.visible = !!game.rival;
    if (game.rival) monster.position.set((game.rival.x + .5) * CELL, 0, (game.rival.y + .5) * CELL);
    switchLamp.material = game.power ? cold : amber;
    exitLamp.material = game.lockUntil > game.now ? red : game.power ? cold : red;
    door.material = game.power ? metal : darkMetal;
    const blackedOut = game.lightsUntil[game.self.x < 7 ? 0 : game.self.x < 13 ? 1 : 2] > game.now;
    hemisphere.intensity = blackedOut ? .22 : 1.32;
    torch.intensity = blackedOut ? 21 : 17;
    fog.density = blackedOut ? .085 : .035;
  };
  update(initial);

  return {
    scene,
    monster,
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
