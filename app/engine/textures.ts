import * as THREE from "three";
import { MAP, ROOMS, SPOTS } from "../../lib/hospital";

/** Deterministic PRNG so every client builds the same grime. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Tileable value noise: u,v in [0,1), lattice period `freq`. */
function noise(u: number, v: number, freq: number, seed: number) {
  const x = u * freq, y = v * freq;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % freq) + freq) % freq, y0 = ((yi % freq) + freq) % freq;
  const x1 = (x0 + 1) % freq, y1 = (y0 + 1) % freq;
  const a = hash(x0, y0, seed), b = hash(x1, y0, seed), c = hash(x0, y1, seed), d = hash(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(u: number, v: number, base: number, octaves: number, seed: number) {
  let sum = 0, amp = .5, freq = base, norm = 0;
  for (let i = 0; i < octaves; i++) { sum += noise(u, v, freq, seed + i * 17) * amp; norm += amp; amp *= .5; freq *= 2; }
  return sum / norm;
}

type Field = { w: number; h: number; data: Float32Array };
/** Precomputed tileable fbm fields; textures sample these instead of recomputing noise. */
const fields = new Map<string, Field>();
function field(name: string, w: number, h: number, base: number, octaves: number, seed: number): Field {
  const key = `${name}:${w}x${h}`;
  const cached = fields.get(key);
  if (cached) return cached;
  const data = new Float32Array(w * h);
  const aspect = h / w;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    data[y * w + x] = fbm(x / w, y / h, base, octaves, seed) * .5 + fbm(x / w, y / h, Math.round(base * aspect), octaves, seed + 99) * .5;
  }
  const f = { w, h, data };
  fields.set(key, f);
  return f;
}
function sample(f: Field, x: number, y: number) {
  const ix = ((Math.floor(x) % f.w) + f.w) % f.w, iy = ((Math.floor(y) % f.h) + f.h) % f.h;
  return f.data[iy * f.w + ix];
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  return { c, ctx };
}
function hex(color: string) {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function clamp01(v: number) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smooth(e0: number, e1: number, x: number) { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }

function texture(c: HTMLCanvasElement, repeat = false, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

/** Applies per-pixel grime: noise tint, darkening toward the floor, stains. */
function grime(ctx: CanvasRenderingContext2D, w: number, h: number, opts: { amount: number; floorFade?: number; seed: number; stains?: number; rust?: boolean }) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const big = field("big", 256, 256, 3, 5, 11), fine = field("fine", 256, 256, 16, 3, 23);
  const off = opts.seed * 37;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const n = sample(big, x * 256 / w + off, y * 256 / h * (h / w) + off);
    const f = sample(fine, x * 2 + off, y * 2 + off);
    let k = 1 - opts.amount * (smooth(.45, .8, n) * .55 + (f - .5) * .35);
    if (opts.floorFade) k *= 1 - opts.floorFade * smooth(.7, 1, y / h) * (.6 + n * .6);
    // streaks running down from the top (water damage)
    const streak = sample(fine, x * .35 + off, y * .02);
    k *= 1 - opts.amount * .25 * smooth(.62, .78, streak) * (1 - y / h);
    d[i] *= k; d[i + 1] *= k; d[i + 2] *= k * (opts.rust ? .9 : 1);
    if (opts.rust && n > .62) { d[i] = d[i] * .9 + 20; d[i + 1] *= .85; d[i + 2] *= .7; }
  }
  ctx.putImageData(img, 0, 0);
  const r = rng(opts.seed);
  for (let s = 0; s < (opts.stains ?? 0); s++) {
    const x = r() * w, y = r() * h, rad = 10 + r() * w * .18;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${40 + r() * 30},${36 + r() * 20},${18},${.1 + r() * .18})`);
    g.addColorStop(.7, "rgba(60,50,20,.06)");
    g.addColorStop(1, "rgba(60,50,20,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, rad, rad * (.6 + r() * .8), r() * 3, 0, Math.PI * 2); ctx.fill();
  }
}
function cracks(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, seed: number, color = "rgba(20,22,18,.55)") {
  const r = rng(seed);
  ctx.strokeStyle = color;
  for (let c = 0; c < count; c++) {
    let x = r() * w, y = r() * h, a = r() * Math.PI * 2;
    ctx.lineWidth = .6 + r() * 1.2;
    ctx.beginPath(); ctx.moveTo(x, y);
    const len = 8 + r() * 30;
    for (let s = 0; s < len; s++) {
      a += (r() - .5) * .9; x += Math.cos(a) * 3; y += Math.sin(a) * 3;
      ctx.lineTo(x, y);
      if (r() < .08) { ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineWidth *= .7; }
    }
    ctx.stroke();
  }
}
/** Peeling paint: irregular blotches revealing plaster underneath. */
function peel(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, seed: number, under: string, y0 = 0, y1 = 1) {
  const r = rng(seed);
  for (let p = 0; p < count; p++) {
    const cx = r() * w, cy = (y0 + r() * (y1 - y0)) * h, rad = 6 + r() * 26;
    ctx.fillStyle = under;
    ctx.beginPath();
    const pts = 9 + Math.floor(r() * 6);
    for (let i = 0; i <= pts; i++) {
      const a = i / pts * Math.PI * 2, rr = rad * (.45 + r() * .75);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * (.7 + r() * .6);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 1; ctx.stroke();
  }
}

export type WallStyle = "corridor" | "ward" | "morgue" | "treatment" | "hydro" | "padded" | "archive" | "lobby" | "canteen" | "pharmacy" | "security" | "facade";

/** Wall textures are two variants side by side (U 0–.5 and .5–1) so instances can alternate. */
export function wallTexture(style: WallStyle, seed: number) {
  // 288×512 matches a 1.8 × 3.2 m wall face, so tiles stay square.
  const W = 288, H = 512;
  const { c, ctx } = canvas(W * 2, H);
  for (let v = 0; v < 2; v++) {
    ctx.save();
    ctx.beginPath(); ctx.rect(v * W, 0, W, H); ctx.clip();
    ctx.translate(v * W, 0);
    paintWall(ctx, style, W, H, seed + v * 101);
    ctx.restore();
  }
  grime(ctx, W * 2, H, { amount: style === "padded" ? .55 : .7, floorFade: .5, seed, stains: 14, rust: style === "hydro" || style === "morgue" });
  return texture(c);
}

function tiles(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, size: number, base: string, grout: string, seed: number, broken = .03) {
  const r = rng(seed);
  ctx.fillStyle = grout; ctx.fillRect(x0, y0, w, h);
  const [br, bg, bb] = hex(base);
  for (let y = y0; y < y0 + h; y += size) for (let x = x0; x < x0 + w; x += size) {
    const k = .88 + r() * .14;
    if (r() < broken) {
      ctx.fillStyle = `rgb(${br * .45},${bg * .43},${bb * .4})`;
      ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
      continue;
    }
    ctx.fillStyle = `rgb(${br * k},${bg * k},${bb * k})`;
    ctx.fillRect(x + 1.5, y + 1.5, size - 3, size - 3);
    ctx.fillStyle = "rgba(255,255,255,.08)";
    ctx.fillRect(x + 2, y + 2, size - 5, 2);
  }
}

function paintWall(ctx: CanvasRenderingContext2D, style: WallStyle, W: number, H: number, seed: number) {
  const r = rng(seed);
  // Soviet hospital walls: oil paint to shoulder height, whitewash above.
  const dado = H * .5;
  const twoTone = (upper: string, lower: string, line: string) => {
    ctx.fillStyle = upper; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = lower; ctx.fillRect(0, dado, W, H - dado);
    peel(ctx, W, H, 7, seed, "#9d998a", .55, .98);
    peel(ctx, W, H, 5, seed + 3, "#b9b5a6", .05, .45);
    ctx.fillStyle = line; ctx.fillRect(0, dado - 5, W, 7);
    cracks(ctx, W, H, 6, seed + 7);
  };
  switch (style) {
    case "corridor": twoTone("#c9c7b6", "#5d7f78", "#3f5a55"); break;
    case "ward": twoTone("#cdd0bf", "#7f9c86", "#566e5d"); break;
    case "canteen": twoTone("#d2c9ad", "#a58f5f", "#6f5f3a"); break;
    case "pharmacy": twoTone("#d7d6cc", "#8ea3a8", "#62767a"); break;
    case "security": twoTone("#bdbeb2", "#5f6a66", "#434b48"); break;
    case "morgue":
    case "treatment": {
      ctx.fillStyle = "#c4c6bb"; ctx.fillRect(0, 0, W, H);
      tiles(ctx, 0, H * .28, W, H * .72, 32, style === "morgue" ? "#cfd5cf" : "#d8dccf", "#6b716a", seed, .05);
      ctx.fillStyle = "#4e5a57"; ctx.fillRect(0, H * .28 - 4, W, 6);
      peel(ctx, W, H, 5, seed, "#9c9a8c", 0, .26);
      cracks(ctx, W, H, 10, seed + 5, "rgba(30,30,26,.6)");
      break;
    }
    case "hydro": {
      tiles(ctx, 0, 0, W, H, 32, "#86aca7", "#3f5552", seed, .06);
      ctx.fillStyle = "rgba(20,40,38,.25)"; ctx.fillRect(0, H * .82, W, H * .18);
      cracks(ctx, W, H, 8, seed + 5);
      break;
    }
    case "padded": {
      ctx.fillStyle = "#b9b39d"; ctx.fillRect(0, 0, W, H);
      const cell = 64;
      for (let y = -cell / 2; y < H + cell; y += cell) for (let x = 0; x < W + cell; x += cell) {
        const ox = (Math.round(y / cell) % 2) * cell / 2;
        const g = ctx.createRadialGradient(x + ox, y, 4, x + ox, y, cell * .62);
        g.addColorStop(0, "#d6cfb6"); g.addColorStop(.7, "#b3ab92"); g.addColorStop(1, "#7f7864");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(x + ox, y - cell / 2); ctx.lineTo(x + ox + cell / 2, y); ctx.lineTo(x + ox, y + cell / 2); ctx.lineTo(x + ox - cell / 2, y); ctx.fill();
        ctx.fillStyle = "#5a5446"; ctx.beginPath(); ctx.arc(x + ox, y - cell / 2, 2.4, 0, Math.PI * 2); ctx.fill();
      }
      // scratches from fingernails
      ctx.strokeStyle = "rgba(60,30,24,.45)";
      for (let s = 0; s < 5; s++) {
        const x = r() * W, y = H * (.4 + r() * .4);
        for (let k = 0; k < 4; k++) { ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + k * 7, y); ctx.lineTo(x + k * 7 + r() * 6, y + 40 + r() * 50); ctx.stroke(); }
      }
      break;
    }
    case "archive":
    case "lobby": {
      ctx.fillStyle = style === "archive" ? "#b8ac86" : "#a9a58f"; ctx.fillRect(0, 0, W, H);
      // faded wallpaper pattern
      ctx.fillStyle = "rgba(90,70,40,.12)";
      for (let y = 10; y < dado; y += 38) for (let x = (y / 38 % 2) * 19; x < W; x += 38) { ctx.beginPath(); ctx.ellipse(x, y, 5, 9, 0, 0, Math.PI * 2); ctx.fill(); }
      peel(ctx, W, H, 6, seed, "#8c826a", .03, .45);
      // wood panels
      const wood = style === "archive" ? [92, 62, 38] : [80, 56, 36];
      const panel = W / 2;
      for (let x = 0; x < W; x += panel) {
        for (let y = dado; y < H; y++) {
          const grain = Math.sin((y + seed) * .21 + Math.sin(x * .05 + y * .03) * 3) * .5 + .5;
          const k = .75 + grain * .3;
          ctx.fillStyle = `rgb(${wood[0] * k},${wood[1] * k},${wood[2] * k})`;
          ctx.fillRect(x, y, panel, 1);
        }
        ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(x, dado, 3, H - dado);
        ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 3; ctx.strokeRect(x + 16, dado + 24, panel - 32, H - dado - 60);
      }
      ctx.fillStyle = "#3b2a1c"; ctx.fillRect(0, dado - 10, W, 12);
      cracks(ctx, W, dado, 4, seed + 5);
      break;
    }
    case "facade": {
      ctx.fillStyle = "#8f8b7f"; ctx.fillRect(0, 0, W, H);
      const rr = rng(seed + 4);
      for (let y = 0; y < H; y += 16) for (let x = -(y / 16 % 2) * 24; x < W; x += 48) {
        const k = .8 + rr() * .25;
        ctx.fillStyle = `rgb(${120 * k},${96 * k},${80 * k})`;
        ctx.fillRect(x + 1, y + 1, 46, 14);
      }
      // stucco falling off in patches
      peel(ctx, W, H, 10, seed, "#6d5a4b");
      break;
    }
  }
}

export type FloorStyle = "checker" | "lino" | "tile" | "wetTile" | "parquet" | "terrazzo" | "concrete" | "asphalt" | "padded";

export function floorTexture(style: FloorStyle, seed: number) {
  const S = 512;
  const { c, ctx } = canvas(S, S);
  const r = rng(seed);
  switch (style) {
    case "checker": {
      const n = 4;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const k = .92 + r() * .1;
        ctx.fillStyle = (x + y) % 2 ? `rgb(${60 * k},${72 * k},${68 * k})` : `rgb(${176 * k},${170 * k},${150 * k})`;
        ctx.fillRect(x * S / n, y * S / n, S / n, S / n);
      }
      ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 2;
      for (let i = 0; i <= n; i++) { ctx.beginPath(); ctx.moveTo(i * S / n, 0); ctx.lineTo(i * S / n, S); ctx.moveTo(0, i * S / n); ctx.lineTo(S, i * S / n); ctx.stroke(); }
      break;
    }
    case "lino": {
      ctx.fillStyle = "#6f7d63"; ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.lineWidth = 2; ctx.strokeRect(1, 1, S - 2, S - 2);
      for (let i = 0; i < 6; i++) { ctx.fillStyle = "rgba(40,30,20,.18)"; ctx.beginPath(); ctx.ellipse(r() * S, r() * S, 40 + r() * 80, 20 + r() * 50, r() * 3, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case "tile":
    case "wetTile":
      tiles(ctx, 0, 0, S, S, 64, style === "tile" ? "#b9bcae" : "#8fa9a2", "#4c524b", seed, .04);
      break;
    case "parquet": {
      for (let y = 0; y < S; y += 64) for (let x = 0; x < S; x += 64) {
        const vertical = ((x + y) / 64) % 2 === 0;
        for (let k = 0; k < 4; k++) {
          const t = .72 + r() * .28;
          ctx.fillStyle = `rgb(${110 * t},${76 * t},${46 * t})`;
          if (vertical) ctx.fillRect(x + k * 16, y, 15, 63); else ctx.fillRect(x, y + k * 16, 63, 15);
        }
      }
      break;
    }
    case "terrazzo": {
      ctx.fillStyle = "#8d8a7e"; ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 2600; i++) {
        const t = r();
        ctx.fillStyle = t < .3 ? "#5b574d" : t < .6 ? "#b7b2a2" : t < .8 ? "#6f5d4a" : "#cfc9b8";
        ctx.beginPath(); ctx.ellipse(r() * S, r() * S, 1 + r() * 4, 1 + r() * 3, r() * 3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = "rgba(40,36,30,.6)"; ctx.lineWidth = 3;
      ctx.strokeRect(0, 0, S, S); ctx.beginPath(); ctx.moveTo(S / 2, 0); ctx.lineTo(S / 2, S); ctx.moveTo(0, S / 2); ctx.lineTo(S, S / 2); ctx.stroke();
      break;
    }
    case "concrete":
    case "asphalt": {
      ctx.fillStyle = style === "asphalt" ? "#3a3c3b" : "#77756c"; ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 5000; i++) { const t = r(); ctx.fillStyle = t < .5 ? "rgba(0,0,0,.18)" : "rgba(255,255,255,.08)"; ctx.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2); }
      break;
    }
    case "padded": {
      ctx.fillStyle = "#9d9784"; ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = "rgba(50,46,38,.5)"; ctx.lineWidth = 3;
      for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * S / 4, 0); ctx.lineTo(i * S / 4, S); ctx.moveTo(0, i * S / 4); ctx.lineTo(S, i * S / 4); ctx.stroke(); }
      break;
    }
  }
  cracks(ctx, S, S, style === "asphalt" ? 14 : 6, seed + 9);
  grime(ctx, S, S, { amount: .85, seed: seed + 1, stains: 10 });
  return texture(c, true);
}

/** Roughness map for floors: wet patches become glossy under the flashlight. */
export function wetnessTexture(seed: number, wet = .5) {
  const S = 256;
  const { c, ctx } = canvas(S, S);
  const img = ctx.createImageData(S, S);
  const f = field("wet", 256, 256, 4, 4, seed);
  for (let i = 0; i < S * S; i++) {
    const n = f.data[i];
    const v = 1 - smooth(1 - wet * .55, 1 - wet * .3, n) * .8;
    const g = Math.round((.55 + v * .45) * 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return texture(c, true, false);
}

export function ceilingTexture(seed: number) {
  const S = 512;
  const { c, ctx } = canvas(S * 2, S);
  const r = rng(seed);
  for (let v = 0; v < 2; v++) {
    const ox = v * S;
    ctx.fillStyle = "#a9a898"; ctx.fillRect(ox, 0, S, S);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      const k = .85 + r() * .15;
      const missing = v === 1 && x === 1 && y === 1;
      ctx.fillStyle = missing ? "#141410" : `rgb(${176 * k},${172 * k},${156 * k})`;
      ctx.fillRect(ox + x * S / 3 + 3, y * S / 3 + 3, S / 3 - 6, S / 3 - 6);
      if (missing) { ctx.strokeStyle = "#3a3830"; ctx.lineWidth = 4; for (let w = 0; w < 5; w++) { ctx.beginPath(); ctx.moveTo(ox + S / 2 - 60 + r() * 120, S / 2 - 60); ctx.quadraticCurveTo(ox + S / 2 + r() * 40, S / 2, ox + S / 2 - 60 + r() * 120, S / 2 + 60); ctx.stroke(); } }
    }
    ctx.strokeStyle = "#5c5b50"; ctx.lineWidth = 6;
    for (let i = 0; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(ox + i * S / 3, 0); ctx.lineTo(ox + i * S / 3, S); ctx.moveTo(ox, i * S / 3); ctx.lineTo(ox + S, i * S / 3); ctx.stroke(); }
  }
  grime(ctx, S * 2, S, { amount: .9, seed, stains: 16 });
  return texture(c);
}

/** Barred window with moonlit sky, used on interior faces of '=' tiles. */
export function windowTexture(seed: number) {
  const W = 256, H = 512;
  const { c, ctx } = canvas(W, H);
  paintWall(ctx, "corridor", W, H, seed);
  const x0 = 38, y0 = 90, w = W - 76, h = 250;
  const sky = ctx.createLinearGradient(0, y0, 0, y0 + h);
  sky.addColorStop(0, "#324a5c"); sky.addColorStop(1, "#122029");
  ctx.fillStyle = "#1a1a16"; ctx.fillRect(x0 - 10, y0 - 10, w + 20, h + 20);
  ctx.fillStyle = sky; ctx.fillRect(x0, y0, w, h);
  // dead branches outside
  const r = rng(seed);
  ctx.strokeStyle = "rgba(6,10,12,.9)";
  for (let b = 0; b < 4; b++) { ctx.lineWidth = 3; let x = x0 + r() * w, y = y0 + h; ctx.beginPath(); ctx.moveTo(x, y); for (let s = 0; s < 8; s++) { x += (r() - .5) * 30; y -= 20 + r() * 20; ctx.lineTo(x, y); } ctx.stroke(); }
  ctx.fillStyle = "#3d3c34";
  ctx.fillRect(x0 + w / 2 - 3, y0, 6, h); ctx.fillRect(x0, y0 + h / 2 - 3, w, 6);
  ctx.fillStyle = "#222320";
  for (let i = 1; i < 6; i++) ctx.fillRect(x0 + i * w / 6 - 2, y0 - 10, 4, h + 20);
  ctx.fillStyle = "#6e6a5b"; ctx.fillRect(x0 - 16, y0 + h + 8, w + 32, 12);
  grime(ctx, W, H, { amount: .6, floorFade: .5, seed, stains: 6 });
  return texture(c);
}
/** Emissive mask for the window's glass so moonlight survives the dark. */
export function windowGlow() {
  const W = 256, H = 512;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 90, 0, 340);
  g.addColorStop(0, "#5b7c96"); g.addColorStop(1, "#1d2e3a");
  ctx.fillStyle = g; ctx.fillRect(38, 90, W - 76, 250);
  ctx.fillStyle = "#000";
  ctx.fillRect(W / 2 - 3, 90, 6, 250); ctx.fillRect(38, 212, W - 76, 6);
  for (let i = 1; i < 6; i++) ctx.fillRect(38 + i * (W - 76) / 6 - 2, 80, 4, 270);
  return texture(c);
}

/** Morgue cold-chamber doors: four columns side by side, one per atlas cell. */
export function drawerTexture(seed: number) {
  const W = 256, H = 512, N = 4;
  const { c, ctx } = canvas(W * N, H);
  ctx.fillStyle = "#6b716e"; ctx.fillRect(0, 0, W * N, H);
  for (let col = 0; col < N; col++) {
    const ox = col * W;
    for (let row = 0; row < 3; row++) {
      const y = 40 + row * 150;
      ctx.fillStyle = "#9aa19c"; ctx.fillRect(ox + 14, y, W - 28, 130);
      ctx.strokeStyle = "#4b504d"; ctx.lineWidth = 4; ctx.strokeRect(ox + 14, y, W - 28, 130);
      ctx.fillStyle = "#3d403e"; ctx.fillRect(ox + W / 2 - 40, y + 60, 80, 14);
      ctx.fillStyle = "#d9d6c5"; ctx.fillRect(ox + W / 2 - 22, y + 20, 44, 26);
      ctx.fillStyle = "#333"; ctx.font = "bold 16px monospace"; ctx.textAlign = "center";
      ctx.fillText(String(1 + col * 3 + row + (seed % 5) * 12), ox + W / 2, y + 39);
    }
  }
  grime(ctx, W * N, H, { amount: .8, seed, stains: 12, rust: true });
  return texture(c);
}

export function entranceTexture() {
  const W = 256, H = 512;
  const { c, ctx } = canvas(W, H);
  paintWall(ctx, "lobby", W, H, 4);
  ctx.fillStyle = "#2b3130"; ctx.fillRect(20, 110, W - 40, H - 110);
  for (const x of [26, W / 2 + 3]) {
    ctx.fillStyle = "#56605d"; ctx.fillRect(x, 116, W / 2 - 29, H - 120);
    ctx.fillStyle = "#1d2322"; ctx.fillRect(x + 14, 150, W / 2 - 57, 120);
    ctx.fillStyle = "#8e958f"; ctx.fillRect(x + 8, 320, W / 2 - 45, 14);
  }
  grime(ctx, W, H, { amount: .8, floorFade: .6, seed: 9, stains: 6, rust: true });
  return texture(c);
}

/** One atlas with 4×4 cells of wall/floor decals (alpha). */
export const DECALS = {
  blood0: 0, blood1: 1, blood2: 2, smear: 3, hands: 4, crack: 5, stain: 6, poster0: 7,
  poster1: 8, papers: 9, graffiti0: 10, graffiti1: 11, graffiti2: 12, graffiti3: 13, tally: 14, drip: 15,
} as const;
export type DecalName = keyof typeof DECALS;

export function decalAtlas() {
  const S = 256, N = 4;
  const { c, ctx } = canvas(S * N, S * N);
  const cell = (i: number, draw: (r: () => number) => void) => {
    ctx.save();
    ctx.translate((i % N) * S, Math.floor(i / N) * S);
    ctx.beginPath(); ctx.rect(0, 0, S, S); ctx.clip();
    draw(rng(i * 13 + 5));
    ctx.restore();
  };
  const bloodColor = (a: number) => `rgba(${70 + Math.random() * 20},6,4,${a})`;
  const splat = (r: () => number, cx: number, cy: number, size: number) => {
    ctx.fillStyle = bloodColor(.9);
    ctx.beginPath(); ctx.arc(cx, cy, size, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2, d = size * (.8 + r() * 2.2), s = size * (.05 + r() * .25);
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, s, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = s * .8; ctx.strokeStyle = bloodColor(.8);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * d * .9, cy + Math.sin(a) * d * .9); ctx.stroke();
    }
  };
  cell(0, r => splat(r, 128, 128, 34));
  cell(1, r => { splat(r, 100, 90, 22); splat(r, 160, 150, 14); });
  cell(2, r => { // pool
    const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 110);
    g.addColorStop(0, "rgba(40,2,2,.95)"); g.addColorStop(.75, "rgba(60,4,3,.85)"); g.addColorStop(1, "rgba(60,4,3,0)");
    ctx.fillStyle = g; ctx.beginPath();
    for (let i = 0; i <= 20; i++) { const a = i / 20 * Math.PI * 2, rr = 70 + r() * 40; ctx.lineTo(128 + Math.cos(a) * rr, 128 + Math.sin(a) * rr * .8); }
    ctx.fill();
  });
  cell(3, r => { // drag smear
    for (let k = 0; k < 5; k++) {
      ctx.strokeStyle = bloodColor(.35 + r() * .3); ctx.lineWidth = 8 + r() * 14; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(20, 128 + (r() - .5) * 60);
      ctx.bezierCurveTo(90, 100 + r() * 60, 160, 90 + r() * 70, 240, 128 + (r() - .5) * 60); ctx.stroke();
    }
  });
  cell(4, r => { // handprints
    for (let h = 0; h < 3; h++) {
      const x = 50 + h * 70 + r() * 20, y = 80 + r() * 90, a = (r() - .5) * .8;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillStyle = bloodColor(.75);
      ctx.beginPath(); ctx.ellipse(0, 12, 17, 21, 0, 0, Math.PI * 2); ctx.fill();
      for (let f = 0; f < 4; f++) { ctx.beginPath(); ctx.ellipse(-13 + f * 9, -22 - (f === 1 || f === 2 ? 6 : 0), 4, 13, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.beginPath(); ctx.ellipse(20, 4, 4, 11, -.9, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(-10, 30, 20, 40 * r());
      ctx.restore();
    }
  });
  cell(5, r => { ctx.globalAlpha = .9; cracks(ctx, S, S, 1, Math.floor(r() * 99), "rgba(12,12,10,.9)"); ctx.lineWidth = 2; cracks(ctx, S, S, 5, 3, "rgba(12,12,10,.7)"); });
  cell(6, () => { const g = ctx.createRadialGradient(128, 90, 10, 128, 128, 128); g.addColorStop(0, "rgba(58,48,20,.55)"); g.addColorStop(.6, "rgba(70,56,24,.3)"); g.addColorStop(1, "rgba(70,56,24,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, S, S); ctx.fillStyle = "rgba(50,40,18,.3)"; for (let i = 0; i < 12; i++) ctx.fillRect(100 + i * 5, 128, 2, 60 + i * 7 % 50); });
  const poster = (title: string, lines: string[], accent: string) => {
    ctx.fillStyle = "#d8cfae"; ctx.fillRect(40, 16, 176, 224);
    ctx.fillStyle = accent; ctx.fillRect(40, 16, 176, 60);
    ctx.fillStyle = "#f0e6c8"; ctx.font = "bold 22px Impact, 'Arial Narrow', sans-serif"; ctx.textAlign = "center";
    ctx.fillText(title, 128, 56);
    ctx.fillStyle = "#2e2a22"; ctx.font = "bold 14px Georgia, serif";
    lines.forEach((l, i) => ctx.fillText(l, 128, 110 + i * 24));
    ctx.fillStyle = "rgba(60,40,10,.35)"; ctx.fillRect(40, 190, 176, 50);
    ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.moveTo(216, 16); ctx.lineTo(190, 16); ctx.lineTo(216, 50); ctx.fill();
  };
  cell(7, () => poster("СОБЛЮДАЙ", ["РЕЖИМ", "ОТДЕЛЕНИЯ", "ТИШИНА —", "ЗАЛОГ ЗДОРОВЬЯ"], "#7b2d24"));
  cell(8, () => poster("МОЙ РУКИ", ["ПЕРЕД", "ПРОЦЕДУРОЙ", "", "МИНЗДРАВ СССР"], "#2f5a55"));
  cell(9, r => { for (let p = 0; p < 7; p++) { ctx.save(); ctx.translate(40 + r() * 170, 40 + r() * 170); ctx.rotate(r() * 6); ctx.fillStyle = `rgb(${200 + r() * 30},${196 + r() * 25},${170})`; ctx.fillRect(-26, -34, 52, 68); ctx.fillStyle = "rgba(40,40,40,.5)"; for (let l = 0; l < 8; l++) ctx.fillRect(-20, -26 + l * 8, 30 + r() * 10, 1.5); ctx.restore(); } });
  const graffiti = (text: string, size: number, color: string) => (r: () => number) => {
    ctx.font = `bold ${size}px 'Arial Black', Impact, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const words = text.split("\n");
    words.forEach((w, row) => {
      let x = 128 - ctx.measureText(w).width / 2;
      for (const ch of w) {
        const cw = ctx.measureText(ch).width;
        ctx.save(); ctx.translate(x + cw / 2, 128 + (row - (words.length - 1) / 2) * size * 1.05 + (r() - .5) * 8); ctx.rotate((r() - .5) * .25);
        ctx.fillStyle = color; ctx.globalAlpha = .75 + r() * .2; ctx.fillText(ch, 0, 0);
        ctx.restore(); x += cw;
      }
    });
    ctx.globalAlpha = 1; ctx.fillStyle = color;
    for (let d = 0; d < 9; d++) { const x = 30 + r() * 196; ctx.fillRect(x, 150 + r() * 30, 2.5, 20 + r() * 60); }
  };
  cell(10, graffiti("ПОМОГИТЕ", 40, "rgba(90,10,8,.95)"));
  cell(11, graffiti("ОН\nЗДЕСЬ", 58, "rgba(20,20,18,.9)"));
  cell(12, graffiti("НЕ\nСПИ", 64, "rgba(96,12,8,.95)"));
  cell(13, graffiti("НАС\nБЫЛО\nДВОЕ", 44, "rgba(24,24,20,.92)"));
  cell(14, r => { ctx.strokeStyle = "rgba(30,26,20,.85)"; ctx.lineWidth = 3; for (let g = 0; g < 7; g++) { const x0 = 20 + (g % 4) * 58, y0 = 40 + Math.floor(g / 4) * 90; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x0 + i * 10, y0 + r() * 4); ctx.lineTo(x0 + i * 10 + r() * 3, y0 + 60); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(x0 - 5, y0 + 45); ctx.lineTo(x0 + 40, y0 + 12); ctx.stroke(); } });
  cell(15, r => { ctx.fillStyle = bloodColor(.85); ctx.fillRect(10, 0, 236, 20); for (let d = 0; d < 18; d++) { const x = 14 + r() * 228, len = 30 + r() * 180; ctx.fillRect(x, 10, 3 + r() * 4, len); ctx.beginPath(); ctx.arc(x + 3, 10 + len, 4, 0, Math.PI * 2); ctx.fill(); } });
  const t = texture(c);
  t.generateMipmaps = true;
  return t;
}

export function signTexture(text: string, style: "plate" | "exit" | "arrow" = "plate") {
  const W = 512, H = 128;
  const { c, ctx } = canvas(W, H);
  if (style === "exit") {
    ctx.fillStyle = "#0e2a18"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#7cf0a2"; ctx.font = "bold 78px Impact, 'Arial Narrow', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, W / 2, H / 2 + 4);
    return texture(c);
  }
  ctx.fillStyle = "#e3dcc4"; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#2c2a24"; ctx.lineWidth = 8; ctx.strokeRect(10, 10, W - 20, H - 20);
  ctx.fillStyle = "#1f1d18"; ctx.font = "bold 58px 'Arial Narrow', Impact, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2 + 3, W - 60);
  grime(ctx, W, H, { amount: .9, seed: text.length * 7, stains: 4 });
  return texture(c);
}

/** Evacuation plan drawn from the real map — readers can actually navigate with it. */
export function evacuationPlan() {
  const cols = MAP[0].length, rows = 29, px = 10;
  const W = cols * px + 40, H = rows * px + 90;
  const { c, ctx } = canvas(512, 512);
  ctx.fillStyle = "#d9d3bb"; ctx.fillRect(0, 0, 512, 512);
  ctx.save();
  const scale = Math.min(496 / W, 496 / H);
  ctx.translate((512 - W * scale) / 2, (512 - H * scale) / 2);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#7a1f18"; ctx.font = "bold 22px Impact, sans-serif"; ctx.textAlign = "center";
  ctx.fillText("ПЛАН ЭВАКУАЦИИ · КОРПУС 13", W / 2, 28);
  ctx.translate(20, 44);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const ch = MAP[y][x];
    ctx.fillStyle = ".dE".includes(ch) ? "#eee8d2" : "bstkux".includes(ch) ? "#b9b29a" : "#2d2b25";
    ctx.fillRect(x * px, y * px, px, px);
  }
  ctx.fillStyle = "#2d2b25"; ctx.font = "bold 9px 'Arial Narrow', sans-serif";
  for (const room of ROOMS) {
    if (room.zone === "exterior" || room.zone === "corridor") continue;
    ctx.fillText(room.name, ((room.x0 + room.x1) / 2 + .5) * px, ((room.y0 + room.y1) / 2 + .8) * px);
  }
  ctx.fillStyle = "#2c8a4f";
  ctx.beginPath(); ctx.moveTo((SPOTS.exit.x + .5) * px, (SPOTS.exit.y + 1.6) * px); ctx.lineTo((SPOTS.exit.x - .4) * px, (SPOTS.exit.y + .4) * px); ctx.lineTo((SPOTS.exit.x + 1.4) * px, (SPOTS.exit.y + .4) * px); ctx.fill();
  ctx.fillStyle = "#b8261d";
  ctx.beginPath(); ctx.arc((22 + .5) * px, (25 + .5) * px, 5, 0, Math.PI * 2); ctx.fill();
  ctx.font = "bold 10px sans-serif"; ctx.fillText("ВЫ ЗДЕСЬ", (22 + .5) * px, (24.2) * px);
  ctx.fillStyle = "#b8261d";
  ctx.fillRect((SPOTS.switch.x - .3) * px, (SPOTS.switch.y - .2) * px, px * 1.6, px * .8);
  ctx.fillText("ЩИТОК", (SPOTS.switch.x + .5) * px, (SPOTS.switch.y + 2) * px);
  ctx.restore();
  grime(ctx, 512, 512, { amount: .7, seed: 77, stains: 6 });
  return texture(c);
}

export function facadeSign() {
  const { c, ctx } = canvas(1024, 256);
  ctx.fillStyle = "#1c1f1e"; ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = "#c8c1a8"; ctx.font = "bold 70px 'Arial Narrow', Impact, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("ПСИХОНЕВРОЛОГИЧЕСКИЙ ДИСПАНСЕР", 512, 86, 960);
  ctx.font = "bold 92px Impact, sans-serif"; ctx.fillStyle = "#a33a2c";
  ctx.fillText("КОРПУС 13", 512, 188);
  grime(ctx, 1024, 256, { amount: .8, seed: 13, stains: 8, rust: true });
  return texture(c);
}

/** Generic grime used as a map on vertex-coloured props. */
export function propGrime() {
  const S = 256;
  const { c, ctx } = canvas(S, S);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, S, S);
  grime(ctx, S, S, { amount: .55, seed: 3, stains: 6, rust: true });
  cracks(ctx, S, S, 3, 5, "rgba(0,0,0,.2)");
  return texture(c, true);
}

export function skyTexture() {
  const { c, ctx } = canvas(1024, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#03070a"); g.addColorStop(.55, "#0d171d"); g.addColorStop(.78, "#1b2a30"); g.addColorStop(1, "#0b1113");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 512);
  const r = rng(8);
  for (let i = 0; i < 260; i++) { ctx.fillStyle = `rgba(210,220,230,${r() * .5})`; ctx.fillRect(r() * 1024, r() * 240, 1, 1); }
  // clouds
  for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(40,55,62,${.05 + r() * .08})`; ctx.beginPath(); ctx.ellipse(r() * 1024, 120 + r() * 200, 60 + r() * 160, 8 + r() * 20, 0, 0, Math.PI * 2); ctx.fill(); }
  // moon
  const mx = 700, my = 110;
  const halo = ctx.createRadialGradient(mx, my, 10, mx, my, 110);
  halo.addColorStop(0, "rgba(200,215,220,.45)"); halo.addColorStop(1, "rgba(200,215,220,0)");
  ctx.fillStyle = halo; ctx.fillRect(mx - 120, my - 120, 240, 240);
  ctx.fillStyle = "#dfe4dc"; ctx.beginPath(); ctx.arc(mx, my, 22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(150,160,150,.4)"; ctx.beginPath(); ctx.arc(mx - 6, my - 4, 6, 0, Math.PI * 2); ctx.arc(mx + 8, my + 7, 4, 0, Math.PI * 2); ctx.fill();
  const t = texture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

/** Soft round sprite for glows, flames and dust. */
export function glowTexture() {
  const { c, ctx } = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(.25, "rgba(255,255,255,.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return texture(c, false, false);
}

/** Pool of light on the floor under a window or lamp. */
export function lightPoolTexture(window = false) {
  const { c, ctx } = canvas(128, 128);
  if (window) {
    ctx.fillStyle = "rgba(0,0,0,0)"; ctx.clearRect(0, 0, 128, 128);
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, "rgba(255,255,255,.9)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(98, 0); ctx.lineTo(118, 128); ctx.lineTo(10, 128); ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,1)";
    for (let i = 1; i < 6; i++) { const x = 30 + i * 68 / 6; ctx.beginPath(); ctx.moveTo(x - 1.5, 0); ctx.lineTo(x + 1.5, 0); ctx.lineTo(x + 4 + (x - 64) * .3, 128); ctx.lineTo(x - 2 + (x - 64) * .3, 128); ctx.fill(); }
    ctx.fillRect(0, 60, 128, 4);
  } else {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,.8)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  }
  return texture(c, false, false);
}

/** Static noise for CRT monitors; redrawn a few times a second. */
export function staticScreen() {
  const { c, ctx } = canvas(64, 48);
  const t = texture(c, false);
  t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter; t.generateMipmaps = false;
  const img = ctx.createImageData(64, 48);
  const redraw = () => {
    for (let i = 0; i < 64 * 48; i++) {
      const v = Math.random() * 150 + ((i / 64 | 0) % 3 === 0 ? 30 : 0);
      img.data[i * 4] = v * .7; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v * .85; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    t.needsUpdate = true;
  };
  redraw();
  return { texture: t, redraw };
}

/** Bloody free-form text on a transparent canvas, sized for a wall decal. */
export function bloodWriting(text: string, seed: number) {
  const W = 1024, H = 512;
  const { c, ctx } = canvas(W, H);
  const r = rng(seed);
  const size = Math.min(200, 1600 / Math.max(4, text.length));
  ctx.font = `bold ${size}px 'Arial Black', Impact, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const total = ctx.measureText(text).width;
  let x = W / 2 - Math.min(total, W - 40) / 2;
  const squeeze = Math.min(1, (W - 40) / total);
  for (const ch of text) {
    const cw = ctx.measureText(ch).width * squeeze;
    ctx.save(); ctx.translate(x + cw / 2, H * .42 + (r() - .5) * 20); ctx.rotate((r() - .5) * .22); ctx.scale(squeeze, 1);
    for (let pass = 0; pass < 3; pass++) { ctx.fillStyle = `rgba(${70 + r() * 30},${4 + r() * 6},${3},${.55 + pass * .15})`; ctx.fillText(ch, (r() - .5) * 4, (r() - .5) * 4); }
    ctx.restore();
    if (ch !== " ") for (let d = 0; d < 2; d++) {
      const dx = x + r() * cw, len = 30 + r() * 170;
      ctx.fillStyle = "rgba(80,6,4,.85)"; ctx.fillRect(dx, H * .42 + size * .3, 3 + r() * 3, len);
      ctx.beginPath(); ctx.arc(dx + 2.5, H * .42 + size * .3 + len, 4.5, 0, Math.PI * 2); ctx.fill();
    }
    x += cw;
  }
  return texture(c);
}

/** Paper texture for the patient file folder's label. */
export function folderTexture() {
  const { c, ctx } = canvas(128, 128);
  ctx.fillStyle = "#8b2a22"; ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = "#e1d8bb"; ctx.fillRect(22, 26, 84, 44);
  ctx.fillStyle = "#2b2520"; ctx.font = "bold 13px monospace"; ctx.textAlign = "center";
  ctx.fillText("ИСТОРИЯ", 64, 44); ctx.fillText("БОЛЕЗНИ", 64, 60);
  grime(ctx, 128, 128, { amount: .7, seed: 21, stains: 3 });
  return texture(c);
}

/** Painted swing-door leaf with a wired-glass window and kick plate. */
export function doorTexture(seed: number) {
  const W = 128, H = 320;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = seed % 2 ? "#6f8a80" : "#7d8f7a"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#1b2522"; ctx.fillRect(24, 40, W - 48, 90);
  ctx.strokeStyle = "rgba(160,170,160,.35)"; ctx.lineWidth = 1;
  for (let i = -90; i < 90; i += 10) { ctx.beginPath(); ctx.moveTo(24 + i, 40); ctx.lineTo(24 + i + 90, 130); ctx.moveTo(W - 24 - i, 40); ctx.lineTo(W - 24 - i - 90, 130); ctx.stroke(); }
  ctx.strokeStyle = "#3b4642"; ctx.lineWidth = 5; ctx.strokeRect(24, 40, W - 48, 90);
  ctx.fillStyle = "#8f958f"; ctx.fillRect(8, H - 60, W - 16, 44);
  ctx.fillStyle = "#3a403c"; ctx.fillRect(W - 26, 170, 10, 36);
  peel(ctx, W, H, 6, seed, "#9d998a", .1, .95);
  grime(ctx, W, H, { amount: .75, floorFade: .5, seed, stains: 4 });
  return texture(c);
}

/**
 * Exterior wall strip, 1.8 × 7.4 m, three variants side by side:
 * plain + upper window, ground window + upper window, plain.
 */
export function facadeTexture() {
  const W = 256, H = 1052;
  const { c, ctx } = canvas(W * 3, H);
  const r = rng(31);
  for (let v = 0; v < 3; v++) {
    ctx.save(); ctx.translate(v * W, 0);
    ctx.fillStyle = "#77736a"; ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 14) for (let x = -(y / 14 % 2) * 22; x < W; x += 44) {
      const k = .75 + r() * .3;
      ctx.fillStyle = `rgb(${108 * k},${86 * k},${72 * k})`;
      ctx.fillRect(x + 1, y + 1, 42, 12);
    }
    peel(ctx, W, H, 9, 40 + v, "#8f8b80");
    // plinth
    ctx.fillStyle = "#4a4842"; ctx.fillRect(0, H - 70, W, 70);
    // floor divider and cornice
    ctx.fillStyle = "#8a867b"; ctx.fillRect(0, H - 460, W, 16); ctx.fillRect(0, 0, W, 34);
    const win = (y: number, lit: boolean) => {
      ctx.fillStyle = "#3a3832"; ctx.fillRect(48, y - 8, W - 96, 236);
      const g = ctx.createLinearGradient(0, y, 0, y + 220);
      g.addColorStop(0, lit ? "#3c3a2a" : "#1a2228"); g.addColorStop(1, lit ? "#1e1d16" : "#0b1014");
      ctx.fillStyle = g; ctx.fillRect(56, y, W - 112, 220);
      ctx.fillStyle = "#2c2b26"; ctx.fillRect(W / 2 - 3, y, 6, 220); ctx.fillRect(56, y + 100, W - 112, 6);
      ctx.fillStyle = "#6f6b60"; ctx.fillRect(40, y + 222, W - 80, 12);
      // a few broken panes
      if (r() < .6) { ctx.fillStyle = "#050708"; ctx.beginPath(); ctx.moveTo(60, y + 110); ctx.lineTo(W / 2 - 6, y + 112); ctx.lineTo(90, y + 180); ctx.fill(); }
    };
    if (v < 2) win(120, false);
    if (v === 1) win(H - 420, false);
    ctx.restore();
  }
  grime(ctx, W * 3, H, { amount: .9, floorFade: .4, seed: 55, stains: 20, rust: true });
  return texture(c);
}

/** A figure standing in a faintly lit upper window. */
export function silhouetteTexture() {
  const { c, ctx } = canvas(128, 256);
  const g = ctx.createRadialGradient(64, 120, 10, 64, 120, 140);
  g.addColorStop(0, "#5a4a2a"); g.addColorStop(1, "#1d1810");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 256);
  ctx.fillStyle = "#050404";
  ctx.beginPath(); ctx.ellipse(64, 70, 17, 22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(34, 256); ctx.lineTo(40, 110); ctx.quadraticCurveTo(64, 92, 88, 110); ctx.lineTo(94, 256); ctx.fill();
  ctx.fillRect(26, 115, 10, 120); ctx.fillRect(92, 115, 10, 120);
  return texture(c);
}
