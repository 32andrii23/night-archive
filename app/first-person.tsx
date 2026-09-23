"use client";
import { useEffect, useRef } from "react";

type Pt = { x: number; y: number };
type Thing = Pt & { found?: boolean };
export type FirstPersonGame = {
  map: string[]; self: Pt & { hidden?: boolean }; rival: Pt | null;
  fuses: Array<{ x: number | null; y: number | null; found: boolean }>;
  lockers: Pt[]; cameras: Pt[]; switch: Pt; exit: Pt; power: boolean;
  lightsUntil: number[]; lockUntil: number; now: number;
};

const RW = 400, RH = 250, FOV = Math.PI / 2.75;
type Textures = { wall: HTMLCanvasElement; shelf: HTMLCanvasElement; metal: HTMLCanvasElement };

function texture(kind: "wall" | "shelf" | "metal") {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d")!;
  x.fillStyle = kind === "shelf" ? "#34403b" : kind === "metal" ? "#4d5550" : "#444a43"; x.fillRect(0, 0, 64, 64);
  if (kind === "shelf") {
    for (let row = 0; row < 4; row++) {
      x.fillStyle = "#101a1b"; x.fillRect(2, row * 16 + 1, 60, 2);
      for (let col = 0; col < 6; col++) {
        const seed = (row * 31 + col * 17) % 5;
        x.fillStyle = ["#55554a", "#6b6857", "#545d54", "#7c6b51", "#494d48"][seed];
        x.fillRect(4 + col * 10, row * 16 + 4, 6 + seed % 3, 10);
        x.fillStyle = "#91866e"; x.fillRect(5 + col * 10, row * 16 + 10, 3, 1);
      }
    }
  } else if (kind === "metal") {
    x.strokeStyle = "#89928a"; x.strokeRect(4, 4, 56, 56);
    x.fillStyle = "#202d2c"; x.fillRect(9, 9, 46, 46);
    for (let row = 0; row < 5; row++) { x.fillStyle = row % 2 ? "#8e917f" : "#7b8578"; x.fillRect(15, 13 + row * 8, 34, 2); }
    x.fillStyle = "#bca77a"; x.fillRect(46, 35, 4, 5);
  } else {
    x.fillStyle = "#5c6359"; for (let row = 0; row < 5; row++) x.fillRect(0, row * 14, 64, 1);
    x.fillStyle = "#252f2e"; for (let col = 0; col < 5; col++) x.fillRect((col * 19 + 7) % 64, 0, 1, 64);
    x.fillStyle = "#777768"; for (let i = 0; i < 28; i++) { const px = (i * 37) % 64, py = (i * 23) % 64; x.fillRect(px, py, 1, 2); }
  }
  const grime = x.createLinearGradient(0, 0, 64, 64); grime.addColorStop(0, "#0000"); grime.addColorStop(1, "#0a151680"); x.fillStyle = grime; x.fillRect(0, 0, 64, 64);
  return c;
}

function render(ctx: CanvasRenderingContext2D, g: FirstPersonGame, yaw: number, pitch: number, textures: Textures, time: number, reduced: boolean) {
  const camX = g.self.x + .5, camY = g.self.y + .5, black = g.lightsUntil[g.self.x < 7 ? 0 : g.self.x < 13 ? 1 : 2] > g.now;
  const maxLight = black ? 3.8 : 7.6;
  const horizon = RH / 2 + pitch * RH * .35;
  const sky = ctx.createLinearGradient(0, 0, 0, horizon); sky.addColorStop(0, "#090f11"); sky.addColorStop(1, black ? "#142022" : "#26312d");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, RW, horizon);
  const floor = ctx.createLinearGradient(0, horizon, 0, RH); floor.addColorStop(0, "#28302d"); floor.addColorStop(1, "#101a1b");
  ctx.fillStyle = floor; ctx.fillRect(0, horizon, RW, RH - horizon);
  ctx.strokeStyle = "#a39a7c10";
  for (let i = 1; i < 8; i++) { const y = horizon + (RH - horizon) * (1 - 1 / (1 + i * .5)); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(RW, y); ctx.stroke(); }
  const depths = new Float32Array(RW);
  const wallTex = [textures.wall, textures.shelf, textures.metal];
  for (let col = 0; col < RW; col++) {
    const angle = yaw + Math.atan((col / RW - .5) * 2 * Math.tan(FOV / 2));
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let mapX = Math.floor(camX), mapY = Math.floor(camY), side = 0;
    const deltaX = Math.abs(1 / (dx || .00001)), deltaY = Math.abs(1 / (dy || .00001));
    const stepX = dx < 0 ? -1 : 1, stepY = dy < 0 ? -1 : 1;
    let sideX = (dx < 0 ? camX - mapX : mapX + 1 - camX) * deltaX;
    let sideY = (dy < 0 ? camY - mapY : mapY + 1 - camY) * deltaY;
    for (let n = 0; n < 26; n++) {
      if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
      else { sideY += deltaY; mapY += stepY; side = 1; }
      if (g.map[mapY]?.[mapX] !== ".") break;
    }
    const raw = Math.max(.08, side === 0 ? sideX - deltaX : sideY - deltaY);
    const corrected = raw * Math.cos(angle - yaw);
    depths[col] = corrected;
    const height = Math.min(RH * 3, RH / corrected * .82), top = horizon - height / 2;
    const hitCoord = side === 0 ? camY + raw * dy : camX + raw * dx;
    const tx = Math.floor((hitCoord - Math.floor(hitCoord)) * 64) % 64;
    const tex = wallTex[(mapX * 7 + mapY * 11 + (side ? 1 : 0)) % 3];
    ctx.drawImage(tex, tx, 0, 1, 64, col, top, 1, height);
    const shade = Math.min(.95, Math.max(.06, corrected / maxLight * .86 + (side ? .13 : 0)));
    ctx.fillStyle = `rgba(3,12,13,${shade})`; ctx.fillRect(col, Math.max(0, top), 1, Math.min(RH, height));
    if (corrected < 3 && (mapX + mapY) % 11 === 0) { ctx.fillStyle = "#c0a97822"; ctx.fillRect(col, top + height * .13, 1, height * .05); }
  }
  const objects: Array<{ p: Pt; kind: string }> = [
    ...g.fuses.filter(f => !f.found && f.x !== null && f.y !== null).map(f => ({ p: f as Thing, kind: "fuse" })),
    ...g.lockers.map(p => ({ p, kind: "locker" })),
    ...g.cameras.map(p => ({ p, kind: "camera" })),
    { p: g.switch, kind: "switch" }, { p: g.exit, kind: "exit" },
    ...(g.rival ? [{ p: g.rival, kind: "monster" }] : []),
  ].sort((a, b) => Math.hypot(b.p.x + .5 - camX, b.p.y + .5 - camY) - Math.hypot(a.p.x + .5 - camX, a.p.y + .5 - camY));
  for (const obj of objects) {
    const ox = obj.p.x + .5 - camX, oy = obj.p.y + .5 - camY;
    const distance = Math.hypot(ox, oy), relative = Math.atan2(oy, ox) - yaw;
    const a = Math.atan2(Math.sin(relative), Math.cos(relative));
    if (Math.abs(a) > FOV * .7 || distance > maxLight + 1) continue;
    const screenX = Math.round(RW / 2 + Math.tan(a) / Math.tan(FOV / 2) * RW / 2), depth = distance * Math.cos(a);
    if (screenX < 0 || screenX >= RW || depth > depths[screenX] + .25) continue;
    const size = Math.min(RH * 1.9, RH / Math.max(.35, depth) * (obj.kind === "monster" ? .75 : .4));
    const y = horizon + (obj.kind === "monster" ? 0 : size * .33);
    ctx.save(); ctx.shadowBlur = Math.min(25, 17 / depth); ctx.shadowColor = obj.kind === "monster" ? "#bd3027" : "#dbc083";
    if (obj.kind === "monster") {
      ctx.fillStyle = "#150f11"; ctx.beginPath(); ctx.ellipse(screenX, y + size * .08, size * .2, size * .47, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#b84238"; ctx.fillRect(screenX - size * .09, y - size * .21, size * .055, size * .025); ctx.fillRect(screenX + size * .04, y - size * .21, size * .055, size * .025);
    } else if (obj.kind === "fuse") {
      ctx.fillStyle = "#ddbe75"; ctx.fillRect(screenX - size * .11, y - size * .14, size * .22, size * .28);
      ctx.fillStyle = "#eee2af"; ctx.fillRect(screenX - size * .055, y - size * .1, size * .11, size * .13);
    } else if (obj.kind === "exit") {
      ctx.fillStyle = g.power ? "#96c3a2" : "#a06458"; ctx.fillRect(screenX - size * .27, y - size * .4, size * .54, size * .8);
      ctx.fillStyle = "#14211c"; ctx.fillRect(screenX - size * .18, y - size * .3, size * .36, size * .58);
      ctx.fillStyle = g.lockUntil > g.now ? "#e05845" : "#d5c281"; ctx.fillRect(screenX + size * .09, y + size * .04, size * .045, size * .045);
    } else if (obj.kind === "locker") {
      ctx.fillStyle = "#68776b"; ctx.fillRect(screenX - size * .21, y - size * .42, size * .42, size * .84);
      ctx.fillStyle = "#273832"; ctx.fillRect(screenX - size * .12, y - size * .33, size * .24, size * .57);
    } else if (obj.kind === "switch") {
      ctx.fillStyle = g.power ? "#88bba0" : "#b69e73"; ctx.fillRect(screenX - size * .19, y - size * .19, size * .38, size * .38);
      ctx.fillStyle = "#101b1b"; ctx.fillRect(screenX - size * .035, y - size * .12, size * .07, size * .23);
    } else { ctx.fillStyle = "#899e9d"; ctx.fillRect(screenX - size * .1, y - size * .1, size * .2, size * .2); }
    ctx.restore();
  }
  const vignette = ctx.createRadialGradient(RW / 2, RH / 2, RH * .05, RW / 2, RH / 2, RH * .95);
  vignette.addColorStop(0, "#0000"); vignette.addColorStop(1, black ? "#020506e8" : "#020506b5");
  ctx.fillStyle = vignette; ctx.fillRect(0, 0, RW, RH);
  if (!reduced && g.rival && Math.abs(g.rival.x - g.self.x) + Math.abs(g.rival.y - g.self.y) < 3) {
    ctx.fillStyle = `rgba(100,12,10,${.06 + .035 * Math.sin(time / 130)})`; ctx.fillRect(0, 0, RW, RH);
  }
  ctx.strokeStyle = "#ddd1a7b8"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(RW / 2 - 6, RH / 2); ctx.lineTo(RW / 2 - 2, RH / 2); ctx.moveTo(RW / 2 + 2, RH / 2); ctx.lineTo(RW / 2 + 6, RH / 2); ctx.moveTo(RW / 2, RH / 2 - 6); ctx.lineTo(RW / 2, RH / 2 - 2); ctx.moveTo(RW / 2, RH / 2 + 2); ctx.lineTo(RW / 2, RH / 2 + 6); ctx.stroke();
}

export default function FirstPerson({ game, yaw, reduced }: { game: FirstPersonGame; yaw: React.MutableRefObject<number>; reduced: boolean }) {
  const shown = useRef<HTMLCanvasElement>(null), back = useRef<HTMLCanvasElement | null>(null), textures = useRef<Textures | null>(null);
  const pitch = useRef(0);
  const gameRef = useRef(game);
  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => { if (!back.current) { back.current = document.createElement("canvas"); back.current.width = RW; back.current.height = RH; textures.current = { wall: texture("wall"), shelf: texture("shelf"), metal: texture("metal") }; } }, []);
  useEffect(() => { const display = shown.current, buffer = back.current, tex = textures.current; if (!display || !buffer || !tex) return;
    const context = display.getContext("2d", { alpha: false }), low = buffer.getContext("2d", { alpha: false }); if (!context || !low) return;
    context.imageSmoothingEnabled = true; let frame = 0, last = 0;
    const step = (time: number) => { if (time - last >= 33) { render(low, gameRef.current, yaw.current, pitch.current, tex, time, reduced); context.drawImage(buffer, 0, 0, display.width, display.height); last = time; } frame = requestAnimationFrame(step); };
    frame = requestAnimationFrame(step); return () => cancelAnimationFrame(frame);
  }, [yaw, reduced]);
  useEffect(() => { const mouse = (e: MouseEvent) => { if (document.pointerLockElement === shown.current) { yaw.current += e.movementX * .0032; pitch.current = Math.max(-.45, Math.min(.45, pitch.current - e.movementY * .003)); } };
    document.addEventListener("mousemove", mouse); return () => document.removeEventListener("mousemove", mouse);
  }, [yaw]);
  return <canvas ref={shown} width={960} height={600} className="first-person" aria-label="Вид от первого лица. Нажмите для управления мышью; Escape освобождает курсор" role="img"
    onClick={() => { if (document.pointerLockElement !== shown.current) void shown.current?.requestPointerLock?.(); }} />;
}
