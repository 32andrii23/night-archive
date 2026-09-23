import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { rng } from "./textures";

/** Material slots shared by every merged prop. */
export const SLOT = { matte: 0, metal: 1, glow: 2, screen: 3, cloth: 4 } as const;

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const cylinders = new Map<string, THREE.CylinderGeometry>();
function cylinder(top: number, bottom: number, segments: number) {
  const key = `${top}:${bottom}:${segments}`;
  let geo = cylinders.get(key);
  if (!geo) { geo = new THREE.CylinderGeometry(top, bottom, 1, segments, 1); cylinders.set(key, geo); }
  return geo;
}
const sphereGeo = new THREE.SphereGeometry(1, 10, 8);
const euler = new THREE.Euler();
const quat = new THREE.Quaternion();
const matrix = new THREE.Matrix4();

/** Collects coloured primitive parts and merges them into one geometry with material groups. */
export class Builder {
  private parts = new Map<number, THREE.BufferGeometry[]>();
  add(source: THREE.BufferGeometry, color: THREE.ColorRepresentation, pos: [number, number, number], scale: [number, number, number], rot: [number, number, number] = [0, 0, 0], slot = 0) {
    const geo = (source.index ? source.toNonIndexed() : source.clone());
    euler.set(rot[0], rot[1], rot[2]);
    quat.setFromEuler(euler);
    matrix.compose(new THREE.Vector3(...pos), quat, new THREE.Vector3(...scale));
    geo.applyMatrix4(matrix);
    const c = new THREE.Color(color);
    const count = geo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    for (const name of Object.keys(geo.attributes)) if (!["position", "normal", "uv", "color"].includes(name)) geo.deleteAttribute(name);
    const list = this.parts.get(slot) ?? [];
    list.push(geo);
    this.parts.set(slot, list);
    return this;
  }
  box(w: number, h: number, d: number, color: THREE.ColorRepresentation, x: number, y: number, z: number, rot?: [number, number, number], slot = 0) {
    return this.add(unitBox, color, [x, y, z], [w, h, d], rot, slot);
  }
  cyl(r: number, h: number, color: THREE.ColorRepresentation, x: number, y: number, z: number, rot?: [number, number, number], slot = 0, segments = 8, top = 1) {
    return this.add(cylinder(top, 1, segments), color, [x, y, z], [r, h, r], rot, slot);
  }
  ball(rx: number, ry: number, rz: number, color: THREE.ColorRepresentation, x: number, y: number, z: number, slot = 0) {
    return this.add(sphereGeo, color, [x, y, z], [rx, ry, rz], [0, 0, 0], slot);
  }
  /** Tube between two points. */
  bar(a: [number, number, number], b: [number, number, number], r: number, color: THREE.ColorRepresentation, slot: number = SLOT.metal) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const mid = va.clone().add(vb).multiplyScalar(.5);
    const dir = vb.clone().sub(va);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    return this.add(cylinder(1, 1, 6), color, [mid.x, mid.y, mid.z], [r, len, r], [e.x, e.y, e.z], slot);
  }
  build() {
    const groups: THREE.BufferGeometry[] = [];
    const slots: number[] = [];
    for (const [slot, list] of [...this.parts.entries()].sort((a, b) => a[0] - b[0])) {
      groups.push(mergeGeometries(list, false)!);
      slots.push(slot);
      list.forEach(g => g.dispose());
    }
    const merged = mergeGeometries(groups, true)!;
    merged.groups.forEach((g, i) => { g.materialIndex = slots[i]; });
    groups.forEach(g => g.dispose());
    merged.computeBoundingSphere();
    return merged;
  }
}

const IRON = 0x4d5553, STEEL = 0x8f9894, WOOD = 0x5e4430, DARKWOOD = 0x3b2a1d, SHEET = 0xcfcab4, LEATHER = 0x3a2a20;

export type PropName =
  | "bed" | "bedStraps" | "autopsy" | "autopsyBody" | "operating" | "dining" | "shelfArchive" | "shelfPharmacy"
  | "reception" | "securityDesk" | "kitchen" | "shockMachine" | "pharmacyCounter" | "bathtub" | "rubble"
  | "chair" | "chairFallen" | "bench" | "wheelchair" | "iv" | "gurneyBody" | "bedside" | "radiator" | "bin"
  | "cabinet" | "plant" | "extinguisher" | "clock" | "curtain" | "opLamp" | "wires" | "cctv" | "trolley"
  | "boxes" | "straitChair" | "drawerOpen" | "tree" | "fence" | "streetLamp" | "stairs" | "papersPile";

export function buildProp(name: PropName, seed = 1): THREE.BufferGeometry {
  const b = new Builder();
  const r = rng(seed);
  switch (name) {
    case "bed":
    case "bedStraps": {
      // Head at -Z (against the wall), 2 m long.
      const z0 = -.86, z1 = 1.08;
      for (const x of [-.44, .44]) for (const z of [z0, z1]) b.cyl(.025, .5, IRON, x, .25, z, undefined, SLOT.metal, 6);
      for (const x of [-.44, .44]) b.bar([x, .44, z0], [x, .44, z1], .022, IRON);
      b.bar([-.44, .44, z0], [.44, .44, z0], .022, IRON).bar([-.44, .44, z1], [.44, .44, z1], .022, IRON);
      // headboard bars
      b.bar([-.44, 1.02, z0], [.44, 1.02, z0], .025, IRON);
      for (const x of [-.44, .44]) b.bar([x, .44, z0], [x, 1.02, z0], .025, IRON);
      for (let i = 1; i < 6; i++) b.bar([-.44 + i * .147, .5, z0], [-.44 + i * .147, 1.0, z0], .012, IRON);
      b.bar([-.44, .78, z1], [.44, .78, z1], .022, IRON);
      for (const x of [-.44, .44]) b.bar([x, .44, z1], [x, .78, z1], .022, IRON);
      b.box(.84, .15, 1.86, 0xb9b39a, 0, .53, .11, undefined, SLOT.cloth);
      b.box(.6, .09, .34, 0xc9c4ae, 0, .65, -.62, [.1, 0, 0], SLOT.cloth);
      b.box(.86, .03, 1.1, 0x9e9a86, 0, .62, .45, [0, 0, .02], SLOT.cloth);
      if (name === "bedStraps") for (const z of [-.2, .4, .85]) { b.box(.9, .04, .08, LEATHER, 0, .62, z); b.box(.06, .05, .06, STEEL, .3, .64, z, undefined, SLOT.metal); }
      break;
    }
    case "autopsy":
    case "autopsyBody": {
      b.cyl(.12, .78, STEEL, 0, .39, 0, undefined, SLOT.metal, 10);
      b.box(.5, .06, .5, STEEL, 0, .03, 0, undefined, SLOT.metal);
      b.box(.78, .06, 1.95, 0xa8b0ab, 0, .82, 0, undefined, SLOT.metal);
      for (const x of [-.37, .37]) b.box(.04, .07, 1.95, STEEL, x, .87, 0, undefined, SLOT.metal);
      b.cyl(.05, .02, 0x1b1d1c, 0, .86, .85, undefined, SLOT.metal, 8);
      if (name === "autopsyBody") {
        b.ball(.24, .12, .8, SHEET, 0, .96, .05, SLOT.cloth);
        b.ball(.12, .11, .13, SHEET, 0, .97, -.78, SLOT.cloth);
        b.ball(.1, .07, .12, SHEET, -.12, .95, .78, SLOT.cloth).ball(.1, .07, .12, SHEET, .12, .95, .78, SLOT.cloth);
        b.box(.5, .01, .6, 0x5a1410, 0, .891, .1, undefined, SLOT.cloth);
        b.ball(.035, .012, .03, 0x6a4e3e, -.36, .93, -.2).box(.03, .01, .01, 0x3c1510, -.36, .925, -.12);
      }
      break;
    }
    case "operating": {
      b.cyl(.14, .7, 0x5b6360, 0, .35, 0, undefined, SLOT.metal, 10);
      b.box(.6, .1, .6, 0x3c4341, 0, .05, 0, undefined, SLOT.metal);
      b.box(.58, .1, 1.9, 0x2a2a28, 0, .8, 0);
      b.box(.62, .04, 1.92, STEEL, 0, .73, 0, undefined, SLOT.metal);
      for (const z of [-.3, .5]) b.box(.7, .03, .07, LEATHER, 0, .87, z);
      b.box(.08, .5, .06, STEEL, .34, 1.0, -.7, undefined, SLOT.metal);
      break;
    }
    case "dining": {
      for (const x of [-.55, .55]) for (const z of [-.35, .35]) b.cyl(.025, .74, IRON, x, .37, z, undefined, SLOT.metal, 6);
      b.box(1.3, .05, .82, 0x7a6a50, 0, .76, 0);
      b.box(.3, .02, .22, 0x9ea6a2, -.2, .79, .1, undefined, SLOT.metal);
      b.cyl(.06, .08, 0xc9c3ad, .3, .82, -.15, undefined, 0, 10);
      for (const [x, z, a] of [[-.35, -.72, 0], [.35, -.72, 0], [-.35, .72, Math.PI], [.4, .78, Math.PI + .5]] as const) chair(b, x, z, a);
      break;
    }
    case "shelfArchive": {
      // Double-sided, long axis X, fills the tile.
      for (const x of [-.86, 0, .86]) for (const z of [-.4, .4]) b.box(.05, 2.4, .05, DARKWOOD, x, 1.2, z);
      for (let lv = 0; lv < 6; lv++) {
        const y = .12 + lv * .44;
        b.box(1.78, .035, .86, WOOD, 0, y, 0);
        if (lv === 5) continue;
        let x = -.84;
        while (x < .8) {
          const w = .06 + r() * .1, h = .22 + r() * .12;
          if (r() < .12) { x += w + .05; continue; }
          const tone = [0x6d5a3c, 0x8a7a55, 0x4d5a4a, 0x7a3e2e, 0xa39a7a][Math.floor(r() * 5)];
          if (r() < .3) { b.box(.3, .22, .36, 0x8b7755, x + .15, y + .13, (r() < .5 ? -1 : 1) * .2); x += .32; }
          else { b.box(w, h, .32, tone, x + w / 2, y + h / 2 + .02, -.21, [0, 0, (r() - .5) * .15]); b.box(w, h, .32, tone, x + w / 2, y + h / 2 + .02, .21, [0, 0, (r() - .5) * .15]); x += w + .005; }
        }
      }
      break;
    }
    case "shelfPharmacy": {
      for (const x of [-.86, .86]) for (const z of [-.4, .4]) b.box(.04, 2.1, .04, STEEL, x, 1.05, z, undefined, SLOT.metal);
      for (let lv = 0; lv < 5; lv++) {
        const y = .15 + lv * .46;
        b.box(1.76, .025, .84, 0xa3aca8, 0, y, 0, undefined, SLOT.metal);
        if (lv === 4) continue;
        for (let i = 0; i < 12; i++) {
          if (r() < .35) continue;
          const glass = [0x5a3a1a, 0x2e4a3a, 0xd6d6c8, 0x3a3f5a][Math.floor(r() * 4)];
          b.cyl(.04 + r() * .03, .1 + r() * .14, glass, -.8 + i * .145, y + .1, (r() - .5) * .6, undefined, SLOT.metal, 8);
        }
      }
      break;
    }
    case "reception": {
      b.box(1.8, 1.05, .6, 0x5a4331, 0, .52, .1);
      b.box(1.86, .05, .72, 0x6e5540, 0, 1.07, .06);
      b.box(1.8, .06, .5, 0x4b3727, 0, .78, -.22);
      b.box(.24, .08, .18, 0x1c1c1a, -.5, 1.13, 0);
      b.box(.08, .05, .2, 0x1c1c1a, -.5, 1.2, 0);
      b.box(.4, .01, .3, 0xd6d0b8, .2, 1.1, .05, [0, .3, 0]);
      b.cyl(.04, .05, 0xb8a064, .7, 1.12, .1, undefined, SLOT.metal);
      b.cyl(.012, .35, IRON, -.1, 1.27, -.1, undefined, SLOT.metal).ball(.09, .06, .09, 0x3c5a48, -.1, 1.45, -.1, SLOT.metal);
      break;
    }
    case "securityDesk": {
      b.box(1.7, .05, .8, 0x5c5f5a, 0, .76, 0, undefined, SLOT.metal);
      for (const x of [-.8, .8]) b.box(.05, .76, .75, 0x444744, x, .38, 0, undefined, SLOT.metal);
      for (const x of [-.45, .35]) {
        b.box(.5, .42, .46, 0x2e302c, x, 1.0, -.1);
        b.box(.4, .3, .01, 0x88ff99, x, 1.02, .135, undefined, SLOT.screen);
      }
      b.box(.45, .03, .16, 0x222, -.05, .8, .25);
      b.box(.3, .01, .22, 0xd8d2bb, .55, .79, .2, [0, -.4, 0]);
      b.cyl(.04, .1, 0xe8e4d6, -.7, .83, .2, undefined, 0, 8);
      break;
    }
    case "kitchen": {
      b.box(1.8, .9, .7, 0x8a918d, 0, .45, 0, undefined, SLOT.metal);
      b.box(1.82, .04, .72, 0xa7aeaa, 0, .92, 0, undefined, SLOT.metal);
      b.cyl(.2, .3, 0x6c7270, -.4, 1.09, 0, undefined, SLOT.metal, 12);
      b.cyl(.14, .16, 0x5c6260, .4, 1.02, -.1, undefined, SLOT.metal, 12);
      b.bar([.55, 1.1, -.1], [.8, 1.1, -.1], .015, IRON);
      break;
    }
    case "shockMachine": {
      b.box(.8, 1.2, .6, 0x57614f, 0, .6, -.2);
      b.box(.7, .5, .02, 0x2a2e28, 0, .95, .105);
      for (let i = 0; i < 4; i++) b.cyl(.05, .03, 0xe7e2cf, -.24 + i * .16, .98, .12, [Math.PI / 2, 0, 0], SLOT.metal, 12);
      b.box(.05, .05, .02, 0xff3a24, .28, 1.15, .11, undefined, SLOT.glow);
      b.box(.05, .05, .02, 0xffc34a, .2, 1.15, .11, undefined, SLOT.glow);
      b.bar([.3, .7, .1], [.5, .3, .6], .012, 0x151515);
      b.bar([-.3, .7, .1], [-.4, .5, .7], .012, 0x151515);
      b.box(.12, .08, .06, 0x151515, .5, .3, .62);
      break;
    }
    case "pharmacyCounter": {
      b.box(1.8, 1.0, .6, 0x7c8a86, 0, .5, 0);
      b.box(1.82, .04, .64, 0xb4bab6, 0, 1.02, 0, undefined, SLOT.metal);
      b.box(1.7, .5, .02, 0x9fbfbf, 0, 1.3, -.25, undefined, SLOT.metal);
      b.box(.1, .12, .1, 0xd6d0c0, .4, 1.1, .1);
      break;
    }
    case "bathtub": {
      const white = 0xd9d6c8;
      b.box(1.66, .5, .08, white, 0, .45, -.36).box(1.66, .5, .08, white, 0, .45, .36);
      b.box(.08, .5, .8, white, -.8, .45, 0).box(.08, .5, .8, white, .8, .45, 0);
      b.box(1.62, .06, .72, 0xc8c4b3, 0, .22, 0);
      b.box(1.58, .02, .66, 0x102220, 0, .5, 0, undefined, SLOT.metal);
      for (const x of [-.7, .7]) for (const z of [-.3, .3]) b.ball(.06, .1, .06, 0x6d5a3a, x, .12, z, SLOT.metal);
      for (const x of [-.3, .35]) b.box(.08, .03, .9, LEATHER, x, .71, 0);
      b.cyl(.02, .9, STEEL, -.82, 1.1, 0, undefined, SLOT.metal).box(.2, .04, .04, STEEL, -.73, 1.55, 0, undefined, SLOT.metal);
      break;
    }
    case "rubble": {
      for (let i = 0; i < 26; i++) b.box(.25, .12, .12, [0x7a4a3a, 0x8c8578, 0x5d5a52][i % 3], (r() - .5) * 1.4, r() * .5, (r() - .5) * 1.4, [r() * 3, r() * 3, r() * 3]);
      for (let i = 0; i < 7; i++) b.box(1.3 + r() * .6, .05, .18, WOOD, (r() - .5) * .8, .3 + r() * .8, (r() - .5) * .8, [(r() - .5) * 1.2, r() * 3, (r() - .5) * 1.2]);
      for (let i = 0; i < 3; i++) chair(b, (r() - .5) * .9, (r() - .5) * .9, r() * 6, .4 + r() * .7, [(r() - .5) * 2.2, 0, (r() - .5) * 2.4]);
      b.box(1.4, .04, 1.0, 0xa9a898, .1, .9, 0, [.5, .3, .6]);
      break;
    }
    case "chair": chair(b, 0, 0, 0); break;
    case "chairFallen": chair(b, 0, 0, 0, .2, [Math.PI / 2 - .1, .3, 0]); break;
    case "bench": {
      b.box(1.5, .05, .4, WOOD, 0, .46, 0).box(1.5, .3, .04, WOOD, 0, .75, -.18, [-.15, 0, 0]);
      for (const x of [-.65, .65]) { b.box(.04, .46, .36, IRON, x, .23, 0, undefined, SLOT.metal); }
      break;
    }
    case "wheelchair": {
      const tor = new THREE.TorusGeometry(.3, .02, 6, 16);
      b.add(tor, 0x2a2c2b, [-.3, .3, 0], [1, 1, 1], [0, Math.PI / 2, 0], SLOT.metal).add(tor, 0x2a2c2b, [.3, .3, 0], [1, 1, 1], [0, Math.PI / 2, 0], SLOT.metal);
      b.box(.52, .05, .45, 0x3a2e28, 0, .5, 0).box(.52, .45, .04, 0x3a2e28, 0, .75, -.22, [-.1, 0, 0]);
      b.bar([-.26, .5, -.2], [-.26, 1.0, -.28], .015, STEEL).bar([.26, .5, -.2], [.26, 1.0, -.28], .015, STEEL);
      b.bar([-.2, .1, .35], [-.2, .5, .2], .012, STEEL).bar([.2, .1, .35], [.2, .5, .2], .012, STEEL);
      break;
    }
    case "iv": {
      b.cyl(.012, 1.9, STEEL, 0, .95, 0, undefined, SLOT.metal, 6);
      for (let i = 0; i < 4; i++) b.bar([0, .05, 0], [Math.cos(i * 1.57) * .25, .02, Math.sin(i * 1.57) * .25], .01, STEEL);
      b.bar([-.15, 1.85, 0], [.15, 1.85, 0], .008, STEEL);
      b.box(.12, .2, .04, 0xc9cfae, .12, 1.7, 0, undefined, SLOT.metal).bar([.12, 1.6, 0], [.05, .9, .05], .004, 0x7a2018);
      break;
    }
    case "gurneyBody": {
      for (const x of [-.28, .28]) for (const z of [-.8, .8]) b.cyl(.02, .7, STEEL, x, .38, z, undefined, SLOT.metal, 6);
      b.box(.62, .05, 1.9, 0x9aa19d, 0, .76, 0, undefined, SLOT.metal);
      b.ball(.24, .13, .82, 0xbcb7a2, 0, .88, 0, SLOT.cloth).ball(.12, .1, .12, 0xbcb7a2, 0, .9, -.82, SLOT.cloth);
      b.box(.64, .45, .01, 0xb4ae98, 0, .6, .95, [.2, 0, 0], SLOT.cloth);
      b.box(.06, .01, .08, 0x7c1a14, .1, .95, .3, undefined, SLOT.cloth);
      b.ball(.03, .06, .02, 0x9b8d78, .27, .68, -.2);
      break;
    }
    case "bedside": {
      b.box(.45, .7, .42, 0x8a8f86, 0, .35, 0, undefined, SLOT.metal);
      b.box(.4, .02, .01, 0x333, 0, .55, .215, undefined, SLOT.metal);
      b.cyl(.035, .12, 0x6c4b2a, .1, .76, .05, undefined, SLOT.metal, 8);
      break;
    }
    case "radiator": {
      for (let i = 0; i < 12; i++) b.box(.05, .55, .1, 0xa9aa9d, -.33 + i * .06, .45, 0, undefined, SLOT.metal);
      b.bar([-.4, .72, 0], [.4, .72, 0], .02, 0x8a8b80).bar([-.4, .18, 0], [.4, .18, 0], .02, 0x8a8b80);
      break;
    }
    case "bin": b.cyl(.18, .45, 0x4e5a52, 0, .225, 0, undefined, SLOT.metal, 10, .85).box(.2, .02, .15, 0xd8d0b8, .05, .46, 0); break;
    case "cabinet": {
      b.box(.9, 1.9, .45, 0x7d8a82, 0, .95, 0, undefined, SLOT.metal);
      b.box(.02, 1.8, .01, 0x3d4541, 0, .95, .23, undefined, SLOT.metal);
      b.box(.4, 1.2, .01, 0x9cb0ac, -.22, 1.2, .226, undefined, SLOT.metal).box(.4, 1.2, .01, 0x9cb0ac, .22, 1.2, .226, undefined, SLOT.metal);
      break;
    }
    case "plant": {
      b.cyl(.2, .4, 0x6a4a36, 0, .2, 0, undefined, 0, 10, 1.2);
      for (let i = 0; i < 6; i++) b.bar([0, .38, 0], [(r() - .5) * .7, .9 + r() * .6, (r() - .5) * .7], .01, 0x4a3a24, 0);
      break;
    }
    case "extinguisher": b.cyl(.08, .5, 0xa3281c, 0, 1.0, 0, undefined, SLOT.metal, 10).box(.05, .12, .05, 0x222, 0, 1.3, 0); break;
    case "clock": {
      b.cyl(.2, .05, 0xd9d4c2, 0, 0, 0, [Math.PI / 2, 0, 0], 0, 16).cyl(.21, .04, 0x2a2a28, 0, 0, -.01, [Math.PI / 2, 0, 0], SLOT.metal, 16);
      b.box(.015, .12, .01, 0x111, 0, .05, .03, [0, 0, -.2]).box(.012, .16, .01, 0x111, 0, -.07, .03, [0, 0, .5]);
      break;
    }
    case "curtain": {
      b.bar([-.9, 3.0, 0], [.9, 3.0, 0], .015, STEEL);
      for (let i = 0; i < 9; i++) b.box(.22, 2.2, .02, 0x9aa493, -.8 + i * .2, 1.9, Math.sin(i * 1.3) * .06, [0, Math.sin(i * 2.1) * .4, 0], SLOT.cloth);
      break;
    }
    case "opLamp": {
      b.cyl(.02, .8, STEEL, 0, 2.8, 0, undefined, SLOT.metal).bar([0, 2.4, 0], [.4, 2.2, 0], .02, STEEL);
      b.cyl(.35, .12, 0xb8bcb5, .4, 2.1, 0, undefined, SLOT.metal, 14, .8);
      for (let i = 0; i < 5; i++) b.cyl(.06, .02, 0xfff4d8, .4 + Math.cos(i * 1.26) * .18, 2.035, Math.sin(i * 1.26) * .18, undefined, SLOT.glow, 8);
      break;
    }
    case "wires": {
      for (let i = 0; i < 5; i++) { const x = (r() - .5) * .6, z = (r() - .5) * .6; b.bar([x, 3.18, z], [x + (r() - .5) * .3, 2.1 + r() * .6, z + (r() - .5) * .3], .008, 0x151515, 0); }
      b.box(.6, .02, .6, 0xa9a898, .1, 2.6, 0, [.9, .2, .1]);
      break;
    }
    case "cctv": {
      b.box(.06, .06, .3, 0x2a2c2b, 0, 0, .15, undefined, SLOT.metal);
      b.box(.16, .14, .34, 0xc5c7bf, 0, -.1, .3, [.35, 0, 0], SLOT.metal);
      b.cyl(.05, .04, 0x111, 0, -.17, .47, [Math.PI / 2 + .35, 0, 0], SLOT.metal, 10);
      break;
    }
    case "trolley": {
      for (const x of [-.25, .25]) for (const z of [-.18, .18]) b.cyl(.012, .85, STEEL, x, .42, z, undefined, SLOT.metal, 6);
      b.box(.56, .02, .42, STEEL, 0, .85, 0, undefined, SLOT.metal).box(.56, .02, .42, STEEL, 0, .35, 0, undefined, SLOT.metal);
      for (let i = 0; i < 5; i++) b.box(.02, .005, .16, 0xd0d4d0, -.15 + i * .08, .87, 0, [0, r() * .5, 0], SLOT.metal);
      b.box(.12, .01, .1, 0x6a1510, .15, .865, .1);
      break;
    }
    case "boxes": {
      for (let i = 0; i < 4; i++) { const s = .35 + r() * .2; b.box(s, s * .8, s, 0x8b7755, (r() - .5) * .6, s * .4 + (i === 3 ? .45 : 0), (r() - .5) * .5, [0, r() * 1.5, 0]); }
      break;
    }
    case "straitChair": {
      b.box(.6, .08, .6, WOOD, 0, .48, 0).box(.6, 1.0, .08, WOOD, 0, 1.0, -.27);
      for (const x of [-.26, .26]) for (const z of [-.26, .26]) b.box(.06, .48, .06, WOOD, x, .24, z);
      for (const x of [-.3, .3]) b.box(.06, .06, .5, WOOD, x, .75, 0);
      for (const [x, y] of [[-.3, .78], [.3, .78], [0, 1.2], [-.2, .2], [.2, .2]] as const) b.box(.1, .04, .12, LEATHER, x, y, x === 0 ? -.22 : 0);
      break;
    }
    case "drawerOpen": {
      b.box(.7, .08, .9, 0x9aa19c, 0, 0, .45, undefined, SLOT.metal);
      b.box(.72, .38, .03, 0x9aa19c, 0, 0, .9, undefined, SLOT.metal);
      b.ball(.22, .1, .38, SHEET, 0, .09, .42, SLOT.cloth).ball(.1, .08, .1, SHEET, 0, .1, .02, SLOT.cloth);
      b.ball(.035, .02, .08, 0x8a8070, .22, .06, .72);
      break;
    }
    case "tree": {
      b.cyl(.2, 4.2, 0x1e1b17, 0, 2.1, 0, undefined, 0, 7, .5);
      for (let i = 0; i < 9; i++) {
        const y = 1.8 + r() * 2.4, a = r() * Math.PI * 2, len = .9 + r() * 1.6;
        const end: [number, number, number] = [Math.cos(a) * len, y + .6 + r() * .8, Math.sin(a) * len];
        b.bar([0, y, 0], end, .05, 0x1a1714, 0);
        b.bar(end, [end[0] * 1.4 + (r() - .5), end[1] + .5, end[2] * 1.4 + (r() - .5)], .02, 0x1a1714, 0);
      }
      break;
    }
    case "fence": {
      b.box(1.8, 2.2, .12, 0x6a685f, 0, 1.1, 0);
      for (let i = 0; i < 3; i++) b.box(1.8, .04, .14, 0x55534c, 0, .5 + i * .7, 0);
      b.box(.16, 2.4, .2, 0x4e4c45, -.9, 1.2, 0);
      break;
    }
    case "streetLamp": {
      b.cyl(.07, 5.2, 0x2b2e2c, 0, 2.6, 0, undefined, SLOT.metal, 8, .7).bar([0, 5.1, 0], [.9, 5.3, 0], .04, 0x2b2e2c);
      b.box(.45, .12, .25, 0x2b2e2c, .95, 5.22, 0, undefined, SLOT.metal).box(.36, .03, .18, 0xffb566, .95, 5.15, 0, undefined, SLOT.glow);
      break;
    }
    case "stairs": {
      for (let i = 0; i < 3; i++) b.box(3.4 - i * .3, .16, .5, 0x5a5850, 0, .08 + i * .16, .5 - i * .42);
      break;
    }
    case "papersPile": {
      for (let i = 0; i < 18; i++) b.box(.21, .003, .29, [0xd8d2bb, 0xc9c1a3, 0xe3ddc8][i % 3], (r() - .5) * 1.2, .005 + i * .001, (r() - .5) * 1.2, [0, r() * 6, 0]);
      b.box(.34, .06, .26, 0x6d2a20, (r() - .5) * .6, .03, (r() - .5) * .6, [0, r() * 3, 0]);
      break;
    }
  }
  return b.build();
}

function chair(b: Builder, x: number, z: number, yaw: number, y = 0, tilt: [number, number, number] = [0, 0, 0]) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (lx: number, ly: number, lz: number): [number, number, number] => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
  const rot: [number, number, number] = [tilt[0], yaw + tilt[1], tilt[2]];
  b.add(unitBox, 0x5a4a38, at(0, .46, 0), [.42, .04, .4], rot);
  b.add(unitBox, 0x5a4a38, at(0, .72, -.19), [.42, .3, .03], rot);
  for (const lx of [-.18, .18]) for (const lz of [-.17, .17]) b.add(cylinder(1, 1, 5), IRON, at(lx, .23, lz), [.015, .46, .015], rot, SLOT.metal);
}

/** A little glowing prop cluster: patient file on a stool with a candle. */
export function buildClue() {
  const b = new Builder();
  for (const x of [-.14, .14]) for (const z of [-.14, .14]) b.cyl(.015, .55, IRON, x, .275, z, undefined, SLOT.metal, 5);
  b.cyl(.22, .04, 0x5a4a38, 0, .57, 0, undefined, 0, 12);
  b.box(.3, .025, .23, 0x8b2a22, -.03, .6, 0, [0, .25, 0]);
  b.box(.27, .012, .2, 0xe1d8bb, -.02, .618, .01, [0, .3, 0], SLOT.cloth);
  b.cyl(.025, .12, 0xe8e0c8, .13, .65, -.08, undefined, SLOT.cloth, 8);
  b.cyl(.012, .03, 0xffd08a, .13, .73, -.08, undefined, SLOT.glow, 6, .2);
  for (let i = 0; i < 3; i++) b.cyl(.02, .02, 0xe8e0c8, .1 + i * .03, .595, -.12, undefined, SLOT.cloth, 6);
  return b.build();
}
export function buildBattery() {
  const b = new Builder();
  b.box(.09, .16, .06, 0x2a2c2a, 0, .08, 0, undefined, SLOT.metal).box(.092, .06, .062, 0xc3a23a, 0, .1, 0);
  b.cyl(.012, .02, 0x9cffb0, -.02, .17, 0, undefined, SLOT.glow, 6).cyl(.012, .02, 0x9cffb0, .02, .17, 0, undefined, SLOT.glow, 6);
  return b.build();
}
export function buildLocker() {
  const b = new Builder();
  const body = 0x5c6f68;
  b.box(.64, 1.95, .04, body, 0, .975, -.25, undefined, SLOT.metal);
  b.box(.04, 1.95, .52, body, -.3, .975, 0, undefined, SLOT.metal).box(.04, 1.95, .52, body, .3, .975, 0, undefined, SLOT.metal);
  b.box(.64, .04, .52, body, 0, 1.93, 0, undefined, SLOT.metal).box(.64, .08, .52, body, 0, .04, 0, undefined, SLOT.metal);
  // Hook rail near the top; kept above eye level so a hidden player can see out.
  b.box(.5, .02, .02, 0x22221f, 0, 1.86, -.2, undefined, SLOT.metal);
  return b.build();
}
export function buildLockerDoor() {
  const b = new Builder();
  // hinge at x=0, door extends to +x
  b.box(.58, 1.85, .025, 0x607369, .29, .96, 0, undefined, SLOT.metal);
  for (let i = 0; i < 6; i++) b.box(.36, .02, .01, 0x151715, .29, 1.65 - i * .05, .014, undefined, SLOT.metal);
  for (let i = 0; i < 6; i++) b.box(.36, .02, .01, 0x151715, .29, .45 - i * .05 + .25, .014, undefined, SLOT.metal);
  b.box(.03, .14, .03, 0x2c2e2c, .52, 1.0, .03, undefined, SLOT.metal);
  b.box(.14, .08, .005, 0xd9d2b8, .29, 1.35, .014);
  return b.build();
}
export function buildBreaker() {
  const b = new Builder();
  b.box(1.1, 1.3, .3, 0x6d756f, 0, 1.45, 0, undefined, SLOT.metal);
  b.box(1.0, 1.2, .02, 0x59615b, 0, 1.45, .16, undefined, SLOT.metal);
  for (let i = 0; i < 6; i++) b.box(.1, .18, .03, 0x2a2c2a, -.35 + i * .1, 1.75, .18, undefined, SLOT.metal);
  b.box(.3, .2, .01, 0xd6b640, .25, 1.1, .175);
  b.box(.2, .14, .01, 0x1a1a1a, .25, 1.1, .18);
  b.cyl(.03, .5, 0x3a3a38, -.35, 1.25, .28, [Math.PI / 2, 0, 0], SLOT.metal, 8);
  b.box(.25, .1, .1, 0x3a3a38, -.35, 1.25, .1, undefined, SLOT.metal);
  b.bar([0, 2.1, 0], [0, 3.2, 0], .03, 0x2a2c2a);
  return b.build();
}
export function buildLever() {
  const b = new Builder();
  b.box(.06, .45, .06, 0x2a2c2a, 0, .22, 0, undefined, SLOT.metal);
  b.box(.24, .08, .08, 0xb23022, 0, .46, 0);
  return b.build();
}

/** Soviet sedan, nose toward -Z. */
export function buildCar() {
  const b = new Builder();
  const paint = 0x3a4d4a, dark = 0x121615, chrome = 0x9ea5a2;
  b.box(1.66, .5, 4.1, paint, 0, .62, 0, undefined, SLOT.metal);
  b.box(1.6, .08, 1.3, paint, 0, .9, -1.35, [.05, 0, 0], SLOT.metal);
  b.box(1.6, .08, .9, paint, 0, .9, 1.6, [-.04, 0, 0], SLOT.metal);
  // cabin pillars and roof (open windows)
  b.box(1.46, .06, 1.7, paint, 0, 1.43, .25, undefined, SLOT.metal);
  for (const x of [-.72, .72]) {
    b.bar([x, .9, -.62], [x * .95, 1.42, -.45], .035, paint);
    b.bar([x, .9, 1.1], [x * .95, 1.42, 1.08], .035, paint);
    b.bar([x, .9, .25], [x * .95, 1.42, .25], .03, paint);
  }
  // Interior, laid out for a driver's eye at about (±.36, 1.2, .2).
  b.box(1.5, .2, .42, 0x241f1b, 0, .84, -.8);
  b.box(1.5, .06, .1, 0x1b1714, 0, .95, -.62, [.3, 0, 0]);
  b.box(.26, .05, .01, 0xffb866, -.36, .9, -.585, [.3, 0, 0], SLOT.glow);
  b.cyl(.012, .01, 0xff5a3a, .05, .92, -.6, [Math.PI / 2 + .3, 0, 0], SLOT.glow, 6);
  for (const x of [-.36, .36]) { b.box(.5, .12, .5, 0x4a3b30, x, .75, .15, undefined, SLOT.cloth); b.box(.5, .6, .1, 0x4a3b30, x, 1.05, .45, [-.15, 0, 0], SLOT.cloth); }
  b.box(1.4, .12, .5, 0x4a3b30, 0, .75, 1.0, undefined, SLOT.cloth);
  const wheel = new THREE.TorusGeometry(.16, .018, 6, 18);
  b.add(wheel, dark, [-.36, .9, -.42], [1, 1, 1], [-1.15, 0, 0]);
  b.bar([-.36, .86, -.44], [-.36, .8, -.62], .02, dark);
  b.bar([-.5, .9, -.42], [-.22, .9, -.42], .01, dark);
  // lights and trim
  for (const x of [-.6, .6]) {
    b.cyl(.11, .04, 0xfff0c8, x, .7, -2.06, [Math.PI / 2, 0, 0], SLOT.glow, 12);
    b.box(.3, .12, .03, 0xa01810, x, .74, 2.06, undefined, SLOT.glow);
  }
  b.box(1.7, .12, .1, chrome, 0, .45, -2.08, undefined, SLOT.metal).box(1.7, .12, .1, chrome, 0, .45, 2.08, undefined, SLOT.metal);
  b.box(.5, .12, .02, 0xe6e2d0, 0, .45, 2.14);
  for (const x of [-.78, .78]) for (const z of [-1.3, 1.3]) b.cyl(.31, .22, dark, x, .31, z, [0, 0, Math.PI / 2], 0, 14);
  return b.build();
}

/* ------------------------------------------------------------------ */
/* Characters                                                          */
/* ------------------------------------------------------------------ */

type Limb = THREE.Group;
export type Rig = {
  root: THREE.Group; body: THREE.Group; hips: Limb; chest: Limb; head: Limb;
  armL: Limb; armR: Limb; foreL: Limb; foreR: Limb; legL: Limb; legR: Limb; shinL: Limb; shinR: Limb;
  hand?: THREE.Object3D; eyes?: THREE.Mesh[]; jaw?: THREE.Group; materials: THREE.Material[];
};

function limb(parent: THREE.Object3D, x: number, y: number, z: number) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g;
}
function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

const capsule = new THREE.CapsuleGeometry(1, 1, 4, 8);
const roundBox = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
const headGeo = new THREE.SphereGeometry(1, 14, 12);
const cone = new THREE.ConeGeometry(1, 1, 6);

/** A person in a jacket carrying a torch in the right hand. Faces -Z. */
export function createHuman(palette: { jacket: number; pants: number; hair: number; skin?: number }): Rig {
  const mats = {
    jacket: new THREE.MeshStandardMaterial({ color: palette.jacket, roughness: .85 }),
    pants: new THREE.MeshStandardMaterial({ color: palette.pants, roughness: .9 }),
    skin: new THREE.MeshStandardMaterial({ color: palette.skin ?? 0xc8a48a, roughness: .7 }),
    hair: new THREE.MeshStandardMaterial({ color: palette.hair, roughness: .95 }),
    shoe: new THREE.MeshStandardMaterial({ color: 0x1b1a18, roughness: .6 }),
    torch: new THREE.MeshStandardMaterial({ color: 0x2b2d2c, roughness: .4, metalness: .6 }),
    lens: new THREE.MeshBasicMaterial({ color: 0xfff1cf }),
  };
  const root = new THREE.Group();
  const body = limb(root, 0, 0, 0);
  const hips = limb(body, 0, .92, 0);
  part(hips, roundBox, mats.pants, 0, .02, 0, .34, .16, .2);
  const chest = limb(hips, 0, .08, 0);
  part(chest, capsule, mats.jacket, 0, .28, 0, .19, .26, .12);
  part(chest, roundBox, mats.jacket, 0, .42, 0, .44, .14, .22);
  const head = limb(chest, 0, .58, 0);
  part(head, capsule, mats.skin, 0, .02, 0, .05, .05, .05);
  part(head, headGeo, mats.skin, 0, .14, 0, .1, .125, .11);
  part(head, headGeo, mats.hair, 0, .19, .015, .107, .09, .115);
  part(head, roundBox, mats.shoe, -.035, .15, -.1, .025, .012, .01);
  part(head, roundBox, mats.shoe, .035, .15, -.1, .025, .012, .01);
  const arm = (side: number) => {
    const a = limb(chest, side * .25, .44, 0);
    part(a, capsule, mats.jacket, 0, -.14, 0, .055, .14, .055);
    const f = limb(a, 0, -.3, 0);
    part(f, capsule, mats.jacket, 0, -.12, 0, .048, .12, .048);
    part(f, headGeo, mats.skin, 0, -.29, 0, .045, .06, .035);
    return [a, f] as const;
  };
  const [armL, foreL] = arm(-1), [armR, foreR] = arm(1);
  const hand = new THREE.Group();
  hand.position.set(0, -.3, -.04);
  foreR.add(hand);
  // The torch runs along the forearm, lens at the far end.
  part(hand, cylinderMesh(), mats.torch, 0, -.06, 0, .025, .2, .025);
  part(hand, cylinderMesh(), mats.lens, 0, -.165, 0, .032, .012, .032);
  const leg = (side: number) => {
    const l = limb(hips, side * .1, -.02, 0);
    part(l, capsule, mats.pants, 0, -.2, 0, .075, .19, .075);
    const s = limb(l, 0, -.44, 0);
    part(s, capsule, mats.pants, 0, -.2, 0, .062, .18, .062);
    part(s, roundBox, mats.shoe, 0, -.43, -.05, .11, .07, .26);
    return [l, s] as const;
  };
  const [legL, shinL] = leg(-1), [legR, shinR] = leg(1);
  armR.rotation.x = 1.25; foreR.rotation.x = .1;
  return { root, body, hips, chest, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR, hand, materials: Object.values(mats) };
}
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
function cylinderMesh() { return cylGeo; }

/**
 * The creature's true form: 2.4 m, emaciated, long-armed, eyeless with a
 * split jaw. Pale and faintly wet so a torch beam catches it.
 */
export function createCreature(shadow = false): Rig {
  const skin = new THREE.MeshStandardMaterial({
    color: shadow ? 0x050505 : 0xa8a49a, roughness: shadow ? 1 : .42, metalness: 0,
    emissive: shadow ? 0x000000 : 0x0b0908,
  });
  const dark = new THREE.MeshStandardMaterial({ color: shadow ? 0x000000 : 0x1a0d0b, roughness: .6 });
  const teeth = new THREE.MeshStandardMaterial({ color: shadow ? 0x000000 : 0xd8d0b0, roughness: .3 });
  const eye = new THREE.MeshBasicMaterial({ color: shadow ? 0xd8b0a0 : 0xfff2e0 });
  const cloth = new THREE.MeshStandardMaterial({ color: shadow ? 0x030303 : 0x5e5646, roughness: .95, side: THREE.DoubleSide });
  const root = new THREE.Group();
  const body = limb(root, 0, 0, 0);
  const hips = limb(body, 0, 1.18, 0);
  part(hips, capsule, skin, 0, 0, 0, .12, .06, .09);
  const chest = limb(hips, 0, .06, 0);
  chest.rotation.x = -.55;
  part(chest, capsule, skin, 0, .36, 0, .12, .3, .09);
  // ribs and a jutting spine
  for (let i = 0; i < 6; i++) part(chest, roundBox, skin, 0, .26 + i * .07, -.08, .23 - i * .01, .016, .04);
  for (let i = 0; i < 7; i++) part(chest, roundBox, skin, 0, .12 + i * .1, .1, .03, .05, .035);
  part(chest, roundBox, skin, 0, .7, 0, .46, .08, .13);
  // shoulder blades
  for (const side of [-1, 1]) part(chest, roundBox, skin, side * .12, .58, .09, .1, .14, .03);
  // torn patient gown hanging from the chest
  const gownGeo = new THREE.CylinderGeometry(.17, .27, .7, 12, 3, true);
  const gp = gownGeo.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const y = gp.getY(i);
    if (y < -.1) { gp.setY(i, y - Math.random() * .22); gp.setX(i, gp.getX(i) * (.9 + Math.random() * .3)); gp.setZ(i, gp.getZ(i) * (.9 + Math.random() * .3)); }
  }
  gownGeo.computeVertexNormals();
  const gown = new THREE.Mesh(gownGeo, cloth);
  gown.position.set(0, .25, .01); gown.castShadow = true; chest.add(gown);
  const head = limb(chest, 0, .82, -.05);
  head.rotation.x = .75;
  part(head, capsule, skin, 0, .05, 0, .042, .08, .042);
  part(head, headGeo, skin, 0, .25, .03, .115, .21, .135);
  // cheekbones, sunken
  for (const side of [-1, 1]) part(head, headGeo, skin, side * .075, .2, -.07, .04, .05, .04);
  // split jaw hanging wide open
  const jaw = limb(head, 0, .15, -.05);
  jaw.rotation.x = .85;
  part(jaw, headGeo, skin, 0, -.07, -.02, .085, .11, .1);
  part(head, headGeo, dark, 0, .13, -.1, .075, .085, .06);
  for (let i = 0; i < 7; i++) {
    const a = (i / 6 - .5) * 2;
    const t = part(head, cone, teeth, a * .055, .19, -.12 + Math.abs(a) * .02, .012, .05, .012);
    t.rotation.x = Math.PI;
    part(jaw, cone, teeth, a * .045, -.01, -.1, .01, .045, .01);
  }
  const eyes = [part(head, headGeo, eye, -.05, .3, -.115, .016, .01, .01), part(head, headGeo, eye, .05, .3, -.115, .016, .01, .01)];
  for (const e of eyes) e.castShadow = false;
  const arm = (side: number) => {
    const a = limb(chest, side * .26, .7, 0);
    a.rotation.z = side * .12;
    part(a, capsule, skin, 0, -.3, 0, .045, .3, .045);
    const f = limb(a, 0, -.66, 0);
    part(f, capsule, skin, 0, -.32, 0, .038, .32, .038);
    const hand = limb(f, 0, -.7, 0);
    part(hand, headGeo, skin, 0, 0, 0, .05, .07, .03);
    for (let i = 0; i < 4; i++) {
      const finger = part(hand, cone, skin, (i - 1.5) * .026, -.2, -.02, .011, .32, .011);
      finger.rotation.x = Math.PI - .25; finger.rotation.z = (i - 1.5) * .08;
    }
    return [a, f] as const;
  };
  const [armL, foreL] = arm(-1), [armR, foreR] = arm(1);
  const leg = (side: number) => {
    const l = limb(hips, side * .11, 0, 0);
    part(l, capsule, skin, 0, -.29, 0, .055, .3, .055);
    const s = limb(l, 0, -.6, 0);
    part(s, capsule, skin, 0, -.28, 0, .045, .28, .045);
    part(s, roundBox, skin, 0, -.58, -.08, .08, .04, .22);
    return [l, s] as const;
  };
  const [legL, shinL] = leg(-1), [legR, shinR] = leg(1);
  return { root, body, hips, chest, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR, eyes, jaw, materials: [skin, dark, teeth, eye, cloth] };
}

/** Drives a rig from locomotion speed; `mode` selects the creature's gait. */
export function animateRig(rig: Rig, time: number, speed: number, mode: "human" | "creature" | "stunned" | "lunge", phase: { walk: number }, dt: number) {
  const moving = Math.min(1, speed / 1.8);
  phase.walk += dt * (mode === "creature" ? 5.2 : 7.2) * Math.max(.25, Math.min(1.6, speed / 1.6)) * (moving > .05 ? 1 : 0);
  const s = Math.sin(phase.walk), c = Math.cos(phase.walk);
  if (mode === "human") {
    rig.legL.rotation.x = s * .55 * moving; rig.legR.rotation.x = -s * .55 * moving;
    rig.shinL.rotation.x = -Math.max(0, -c) * .7 * moving; rig.shinR.rotation.x = -Math.max(0, c) * .7 * moving;
    rig.armL.rotation.x = -s * .45 * moving;
    rig.armR.rotation.x = 1.25 + s * .06 * moving;
    rig.body.position.y = Math.abs(c) * .035 * moving;
    rig.chest.rotation.y = s * .06 * moving;
    rig.head.rotation.y = Math.sin(time * .4) * .25 * (1 - moving);
    return;
  }
  // Creature: long, uneven strides; arms dangle and lag; the head twitches.
  const twitch = Math.sin(time * 13.7) > .96 ? (Math.sin(time * 31) * .5) : 0;
  if (mode === "stunned") {
    rig.armL.rotation.x = 2.4 + Math.sin(time * 20) * .1; rig.armR.rotation.x = 2.5 + Math.cos(time * 19) * .1;
    rig.foreL.rotation.x = 1.2; rig.foreR.rotation.x = 1.3;
    rig.chest.rotation.x = -.1 + Math.sin(time * 25) * .04;
    rig.head.rotation.z = Math.sin(time * 30) * .3;
    rig.legL.rotation.x = rig.legR.rotation.x = 0;
    return;
  }
  const lunge = mode === "lunge" ? 1 : 0;
  rig.legL.rotation.x = s * .7 * moving + .15; rig.legR.rotation.x = -s * .7 * moving + .15;
  rig.shinL.rotation.x = -.3 - Math.max(0, -c) * .9 * moving; rig.shinR.rotation.x = -.3 - Math.max(0, c) * .9 * moving;
  rig.armL.rotation.x = Math.sin(phase.walk - .8) * .5 * moving + Math.sin(time * 1.3) * .05 + lunge * 1.4;
  rig.armR.rotation.x = -Math.sin(phase.walk - .8) * .5 * moving + Math.cos(time * 1.1) * .05 + lunge * 1.4;
  rig.foreL.rotation.x = .25 + lunge * .3; rig.foreR.rotation.x = .2 + lunge * .3;
  rig.chest.rotation.x = -.55 - moving * .12 - lunge * .3 + Math.sin(time * 2.1) * .02;
  rig.body.position.y = Math.abs(c) * .06 * moving - .06;
  rig.head.rotation.z = twitch + Math.sin(time * .7) * .08;
  rig.head.rotation.y = Math.sin(time * .9) * .2 + twitch * .6;
}
