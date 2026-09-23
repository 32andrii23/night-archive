"use client";

import { useEffect, useRef, useState } from "react";
import { STORIES } from "../../lib/hospital";
import type { GameView } from "../game-types";

/** Procedurally drawn face, redrawn with jitter every frame. */
function drawFace(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, variant: number, grow: number) {
  const r = () => Math.random();
  ctx.save();
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
  const bg = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, Math.max(w, h) * .7);
  bg.addColorStop(0, "#3a0806"); bg.addColorStop(.5, "#120202"); bg.addColorStop(1, "#000");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  const s = Math.min(w, h) * (.9 + grow * .5);
  ctx.translate(w / 2 + (r() - .5) * 26, h / 2 + (r() - .5) * 26 + s * .04);
  ctx.rotate((r() - .5) * .06 + Math.sin(t * 40) * .02);
  ctx.scale(s / 1000, s / 1000);
  // gaunt, lopsided skull with a ragged outline
  const skin = ctx.createRadialGradient(-20, -80, 30, 0, 0, 520);
  skin.addColorStop(0, variant === 2 ? "#9a8f86" : "#bdb8a4"); skin.addColorStop(.55, "#6e695c"); skin.addColorStop(1, "#141210");
  ctx.fillStyle = skin;
  ctx.beginPath();
  for (let i = 0; i <= 48; i++) {
    const a = i / 48 * Math.PI * 2;
    const wobble = 1 + Math.sin(a * 5 + variant) * .03 + (r() - .5) * .025;
    const narrow = a > Math.PI * .15 && a < Math.PI * .85 ? .82 : 1; // hollow jaw
    const x = Math.cos(a) * 300 * wobble * narrow, y = Math.sin(a) * 480 * wobble;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.fill();
  // sunken cheeks
  for (const side of [-1, 1]) {
    const c = ctx.createRadialGradient(side * 170, 120, 10, side * 170, 120, 170);
    c.addColorStop(0, "rgba(10,8,6,.75)"); c.addColorStop(1, "rgba(10,8,6,0)");
    ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(side * 170, 120, 130, 190, side * .3, 0, Math.PI * 2); ctx.fill();
  }
  // veins
  ctx.strokeStyle = "rgba(60,20,30,.45)"; ctx.lineWidth = 3;
  for (let i = 0; i < 14; i++) { ctx.beginPath(); let x = (r() - .5) * 400, y = -380 + r() * 200; ctx.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - .5) * 60; y += 30 + r() * 30; ctx.lineTo(x, y); } ctx.stroke(); }
  // eye sockets
  for (const side of [-1, 1]) {
    const ex = side * (side < 0 ? 128 : 112), ey = side < 0 ? -96 : -78;
    const g = ctx.createRadialGradient(ex, ey, 10, ex, ey, 130);
    g.addColorStop(0, "#000"); g.addColorStop(.55, "#050303"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(ex, ey, 120, 95 + Math.sin(t * 30) * 4, side * .15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = variant === 1 ? "#ff2a1a" : "#f4f0e0";
    ctx.beginPath(); ctx.arc(ex + (r() - .5) * 10, ey + (r() - .5) * 8, 9 + r() * 3, 0, Math.PI * 2); ctx.fill();
    if (variant !== 2) {
      ctx.fillStyle = "rgba(110,6,4,.85)";
      for (let d = 0; d < 3; d++) ctx.fillRect(ex - 40 + d * 35 + r() * 10, ey + 50, 7, 120 + r() * 160);
    }
  }
  ctx.fillStyle = "#0a0806"; ctx.beginPath(); ctx.ellipse(-22, 40, 10, 30, .2, 0, Math.PI * 2); ctx.ellipse(22, 40, 10, 30, -.2, 0, Math.PI * 2); ctx.fill();
  // gaping mouth
  const open = 150 + Math.sin(t * 22) * 20 + grow * 60;
  ctx.fillStyle = "#050000"; ctx.beginPath(); ctx.ellipse(0, 250, 150, open, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#4a0a08"; ctx.beginPath(); ctx.ellipse(0, 250 - open + 18, 140, 26, 0, 0, Math.PI); ctx.fill();
  ctx.fillStyle = "#d8cfae";
  for (let i = 0; i < 11; i++) {
    const x = -130 + i * 26;
    ctx.beginPath(); ctx.moveTo(x, 250 - open + 12); ctx.lineTo(x + 12, 250 - open + 55 + r() * 30); ctx.lineTo(x + 24, 250 - open + 12); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, 250 + open - 10); ctx.lineTo(x + 12, 250 + open - 50 - r() * 30); ctx.lineTo(x + 24, 250 + open - 10); ctx.fill();
  }
  ctx.restore();
  // the edges of the head dissolve into darkness
  const fade = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .25, w / 2, h / 2, Math.max(w, h) * .62);
  fade.addColorStop(0, "rgba(0,0,0,0)"); fade.addColorStop(1, "rgba(0,0,0,.92)");
  ctx.fillStyle = fade; ctx.fillRect(0, 0, w, h);
  // glitch bands and grain
  for (let i = 0; i < 6; i++) { const y = r() * h, bh = 4 + r() * 30; ctx.drawImage(ctx.canvas, 0, y, w, bh, (r() - .5) * 60, y, w, bh); }
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) { const n = (r() - .5) * 70; img.data[i] += n + 10; img.data[i + 1] += n; img.data[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
}

export function Screamer({ variant, duration = 1500, caught }: { variant: number; duration?: number; caught?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = 480; c.height = 300;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const age = now - start;
      drawFace(ctx, c.width, c.height, age / 1000, variant, Math.min(1, age / (caught ? 500 : 250)));
      if (age < duration) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [variant, duration, caught]);
  return <div className={`hospital-screamer ${caught ? "caught" : ""}`} aria-hidden="true"><canvas ref={ref} /></div>;
}

export function DocumentReader({ story, onClose }: { story: number; onClose: () => void }) {
  const s = STORIES.find(x => x.id === story);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const full = (s?.text.length ?? 0) + (s?.note.length ?? 0);
    const id = window.setInterval(() => setShown(v => { if (v >= full) { window.clearInterval(id); return v; } return v + 3; }), 16);
    return () => window.clearInterval(id);
  }, [s]);
  if (!s) return null;
  const text = s.text.slice(0, shown);
  const note = shown > s.text.length ? s.note.slice(0, shown - s.text.length) : "";
  return <aside className="hospital-document" onClick={onClose} role="dialog" aria-label={`История болезни ${s.number}`}>
    <div className="hospital-document-paper">
      <header><span>ИСТОРИЯ БОЛЕЗНИ</span><b>{s.number}</b></header>
      <h3>{s.title}</h3>
      <p>{text}<span className="hospital-caret" /></p>
      {note && <p className="hospital-document-note">{note}</p>}
      <footer>КОРПУС 13 · АРХИВ · <kbd>E</kbd> ЗАКРЫТЬ</footer>
    </div>
  </aside>;
}

export function RadioLine({ name, text, at }: { name: string; text: string; at: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setShown(v => Math.min(text.length, v + 1)), 28);
    return () => window.clearInterval(id);
  }, [text, at]);
  return <div className="hospital-radio" role="status"><span className="hospital-radio-head"><i />РАЦИЯ · {name}</span><p>{text.slice(0, shown)}</p></div>;
}

export function LockerView() {
  return <div className="hospital-locker" aria-hidden="true"><div className="hospital-locker-slats" /><span>ВЫ В ШКАФУ · E — ВЫЙТИ · НЕ ДЫШИТЕ</span></div>;
}

/** Looks exactly like a network failure. The 3D frame is frozen underneath. */
export function FakeLag({ until, now }: { until: number; now: number }) {
  const left = Math.max(1, Math.ceil((until - now) / 1000));
  return <div className="hospital-fake-lag" aria-hidden="true">
    <div className="hospital-fake-lag-box"><i className="hospital-spinner" /><div><strong>Соединение с сервером потеряно</strong><span>Переподключение… попытка {4 - Math.min(3, left)} · пинг 999 мс</span></div></div>
  </div>;
}

export function Ending({ game, onRematch, onLeave }: { game: GameView; onRematch: (swap: boolean) => void; onLeave: () => void }) {
  const visitor = game.side === "player";
  const won = game.winner === game.side;
  const monsterName = game.names.monster, visitorName = game.names.player;
  const mine = game.votes[game.side], theirs = game.votes[visitor ? "monster" : "player"];
  const survived = Math.max(0, Math.min(game.endedAt, game.endsAt) - game.introEndsAt);
  const minutes = `${Math.floor(survived / 60000)}:${String(Math.floor(survived / 1000) % 60).padStart(2, "0")}`;
  const title = visitor ? (won ? "Вы выбрались" : "Вас поймали") : (won ? "Добыча не ушла" : "Добыча сбежала");
  return <div className={`hospital-modal-scrim hospital-ending ${won ? "won" : "lost"}`}>
    <div className="hospital-modal">
      <p className="hospital-kicker">ДЕЛО ЗАКРЫТО · ПАРТИЯ {game.round}{visitor ? "" : ` · ${visitorName.toUpperCase()}`}</p>
      <h2>{title}</h2>
      {visitor && <p className="hospital-reveal">{won ? `Существо осталось внутри. Оно всё ещё выглядит как ${monsterName}.` : <>Всё это время рядом с вами было существо.<br />Существо — это <b>{monsterName}</b>.</>}</p>}
      <p>{game.reason}</p>
      <dl className="hospital-stats">
        <div><dt>Время в корпусе</dt><dd>{minutes}</dd></div>
        <div><dt>Истории</dt><dd>{game.found}/{game.total}</dd></div>
        <div><dt>Розыгрышей</dt><dd>{game.stats.tricks}</dd></div>
        <div><dt>Скримеров</dt><dd>{game.stats.scares}</dd></div>
        <div><dt>Поимок</dt><dd>{game.stats.catches}</dd></div>
        <div><dt>Вспышек в цель</dt><dd>{game.stats.flared}</dd></div>
      </dl>
      <div className="hospital-ending-actions">
        <button className="hospital-primary" disabled={!!mine} onClick={() => onRematch(false)}>{mine === "same" ? "Ждём друга…" : "Реванш"}<span>↻</span></button>
        <button className="hospital-secondary" disabled={!!mine} onClick={() => onRematch(true)}>{mine === "swap" ? "Ждём друга…" : "Реванш со сменой ролей"}</button>
      </div>
      {theirs && <p className="hospital-vote-note">{visitor ? monsterName : visitorName} хочет {theirs === "swap" ? "поменяться ролями" : "реванш"}.</p>}
      <button className="hospital-plain" onClick={onLeave}>Новая комната</button>
    </div>
  </div>;
}
