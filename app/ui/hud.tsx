"use client";

import { useEffect, useRef } from "react";
import { MAP, ROOMS, SPOTS, roomAt } from "../../lib/hospital";
import type { GameView, LocalState } from "../game-types";
import { HOTBAR, type Trick } from "./data";

export function timer(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function zoneName(game: GameView) {
  const room = roomAt(game.self.x, game.self.y);
  if (!room) return "ДВЕРНОЙ ПРОЁМ";
  return room.name;
}

export type Hint = { text: string; hold?: boolean; action?: "interact" | "search" };
export function nearbyHint(game: GameView): Hint | null {
  if (game.phase !== "playing") return null;
  const d = (p: { x: number; y: number }) => Math.hypot(game.self.x - p.x, game.self.y - p.y);
  if (game.side === "monster") {
    if (SPOTS.lockers.some(p => d(p) <= 1.15)) return { text: "E · ОБЫСКАТЬ ШКАФ", action: "search" };
    return null;
  }
  if ((game.self.hidden ?? -1) >= 0) return { text: "E · ВЫЙТИ ИЗ ШКАФА", action: "interact" };
  if (game.clues.some(c => !c.found && c.x !== null && c.y !== null && d({ x: c.x, y: c.y }) <= 1.15)) return { text: "E · ВЗЯТЬ ИСТОРИЮ БОЛЕЗНИ", action: "interact" };
  if (game.batteries.some(b => d(b) <= 1.05)) return { text: "E · ВЗЯТЬ БАТАРЕЙКИ", action: "interact" };
  if (d(SPOTS.switch) <= 1.25 && !game.power) return game.found === game.total ? { text: "УДЕРЖИВАЙТЕ E · ВКЛЮЧИТЬ ПИТАНИЕ", hold: true, action: "interact" } : { text: `ЩИТОК НЕ ПОДДАЁТСЯ · НУЖНЫ ВСЕ ИСТОРИИ (${game.found}/${game.total})` };
  if (d(SPOTS.exit) <= 1.3) return game.power ? { text: "УДЕРЖИВАЙТЕ E · ОТКРЫТЬ ВЫХОД", hold: true, action: "interact" } : { text: "ЗАПЕРТО · КЛЮЧИ И ЩИТОК НА ПОСТУ ОХРАНЫ" };
  if (SPOTS.lockers.some(p => d(p) <= .95)) return { text: "E · СПРЯТАТЬСЯ В ШКАФУ", action: "interact" };
  return null;
}

function Bar({ value, tone, label }: { value: number; tone: string; label: string }) {
  return <div className={`hospital-bar ${tone}`}><span>{label}</span><i><b style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></i></div>;
}

export function VisitorHud({ game, local, now, hint, hold }: { game: GameView; local: LocalState; now: number; hint: Hint | null; hold: number }) {
  const battery = (game.self.battery ?? 0) / 100;
  const flareReady = (game.self.flareReadyAt ?? 0) <= now;
  const lives = game.self.lives ?? 3;
  return <>
    <div className="hospital-files" aria-label={`Истории ${game.found} из ${game.total}`}>
      {Array.from({ length: game.total }, (_, i) => <i key={i} className={i < game.found ? "found" : ""} />)}
      <span>{game.power ? "ПИТАНИЕ ЕСТЬ · К ВЫХОДУ" : game.found === game.total ? "ВСЕ ИСТОРИИ · НА ПОСТ ОХРАНЫ" : "ИСТОРИИ ПАЦИЕНТОВ"}</span>
    </div>
    <div className="hospital-vitals">
      <Bar value={battery} tone={battery < .15 ? "danger" : "amber"} label={local.light ? "ФОНАРЬ" : "ФОНАРЬ ВЫКЛ"} />
      {local.stamina < .99 && <Bar value={local.stamina} tone={local.stamina < .2 ? "danger" : "pale"} label="ДЫХАНИЕ" />}
      <div className="hospital-flares"><span>ВСПЫШКИ</span>{Array.from({ length: 3 }, (_, i) => <i key={i} className={i < (game.self.flares ?? 0) ? (flareReady ? "on" : "cool") : ""} />)}</div>
      <div className="hospital-lives"><span>СИЛЫ</span>{Array.from({ length: 3 }, (_, i) => <i key={i} className={i < lives ? "on" : ""} />)}</div>
      {local.crouch && <em className="hospital-tag">ПРИСЕД</em>}
    </div>
    {hint && <div className={`hospital-interaction ${hint.hold ? "hold" : ""}`}>{hint.text}{hint.hold && hold > 0 && <i style={{ width: `${hold * 100}%` }} />}</div>}
    {game.lockUntil > now && game.power && <div className="hospital-alert">ВЫХОД ЗАКЛИНИЛО</div>}
  </>;
}

export function MonsterHud({ game, now, onTrick, onToggleForm }: { game: GameView; now: number; onTrick: (t: Trick) => void; onToggleForm: () => void }) {
  const energy = game.self.energy ?? 0;
  const friend = game.friend;
  const formLocked = (game.self.formReadyAt ?? 0) > now;
  const stunned = (game.self.stunnedUntil ?? 0) > now;
  return <>
    <div className="hospital-monster-status">
      <button className={`hospital-form ${game.self.disguised ? "human" : "beast"}`} onClick={onToggleForm} disabled={formLocked || stunned}>
        <b>G</b><span><strong>{game.self.disguised ? "ОБЛИК ДРУГА" : "ИСТИННАЯ ФОРМА"}</strong><small>{stunned ? "ОСЛЕПЛЁН ВСПЫШКОЙ" : formLocked ? `облик устоится через ${Math.ceil(((game.self.formReadyAt ?? 0) - now) / 1000)} с` : game.self.disguised ? "G — раскрыться и охотиться" : "ЛКМ — бросок · G — спрятать лицо"}</small></span>
      </button>
      <Bar value={energy / 100} tone="blood" label={`СИЛА ${Math.floor(energy)}`} />
    </div>
    {friend && <div className="hospital-friend">
      <strong>{game.names.player.toUpperCase()}</strong>
      <span className={friend.detected ? "hot" : ""}>{friend.hidden ? "ПРЯЧЕТСЯ" : friend.detected ? "ЗАМЕЧЕН" : "НЕ ВИДНО"}</span>
      <span>СИЛЫ {"●".repeat(friend.lives)}{"○".repeat(Math.max(0, 3 - friend.lives))}</span>
      <span>ИСТОРИИ {game.found}/{game.total}</span>
      <span>ФОНАРЬ {friend.battery}% · ВСПЫШЕК {friend.flares}</span>
      {game.power && <span className="hot">ПИТАНИЕ ВКЛЮЧЕНО</span>}
    </div>}
    <div className="hospital-hotbar">
      {HOTBAR.map(t => {
        const cd = (game.cooldowns?.[t.type] ?? 0) - now;
        const disabled = game.phase !== "playing" || cd > 0 || energy < t.cost || (t.type === "lock" && !game.power);
        const k = cd > 0 ? Math.min(1, cd / 30_000) : 0;
        return <button key={t.type} disabled={disabled} onClick={() => onTrick(t)} title={t.detail} style={{ ["--cd" as string]: `${k * 360}deg` }} className={cd > 0 ? "cooling" : ""}>
          <kbd>{t.keyLabel}</kbd><span>{t.label}</span><small>{cd > 0 ? `${Math.ceil(cd / 1000)}с` : t.cost}</small>
        </button>;
      })}
      <div className="hospital-hotbar-extra"><kbd>R</kbd> рация <kbd>T</kbd> кровью <kbd>V</kbd> голос <kbd>M</kbd> карта</div>
    </div>
  </>;
}

/** Floor plan for the creature: rooms, cameras, clues and the last place the friend was seen. */
export function Minimap({ game, lastSeen, now }: { game: GameView; lastSeen: { x: number; y: number; at: number } | null; now: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const px = 6, rows = 29, cols = MAP[0].length;
    c.width = cols * px; c.height = rows * px;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const ch = MAP[y][x];
      ctx.fillStyle = ".dE".includes(ch) ? "#3b3330" : "bstkux".includes(ch) ? "#2a2321" : ch === "g" ? "#35403f" : "#0e0b0a";
      ctx.fillRect(x * px, y * px, px, px);
    }
    ctx.font = "bold 7px monospace"; ctx.fillStyle = "#8a7560"; ctx.textAlign = "center";
    for (const r of ROOMS) if (r.zone !== "corridor" && r.zone !== "exterior") ctx.fillText(r.name, (r.x0 + r.x1 + 1) / 2 * px, (r.y0 + r.y1 + 1) / 2 * px + 3);
    SPOTS.cameras.forEach((cam, i) => { ctx.fillStyle = game.cameraSignals?.[i] ? "#ffffff" : "#4f7a86"; ctx.fillRect(cam.x * px + 1, cam.y * px + 1, px - 2, px - 2); });
    for (const l of SPOTS.lockers) { ctx.strokeStyle = "#6a8a7a"; ctx.strokeRect(l.x * px + 1.5, l.y * px + 1.5, px - 3, px - 3); }
    for (const clue of game.clues) if (!clue.found && clue.x !== null) { ctx.fillStyle = "#e0a94a"; ctx.beginPath(); ctx.arc((clue.x + .5) * px, (clue.y! + .5) * px, 2.4, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = game.power ? "#56e08a" : "#b0382c";
    ctx.fillRect(SPOTS.switch.x * px, SPOTS.switch.y * px, px, px);
    ctx.fillRect(SPOTS.exit.x * px, (SPOTS.exit.y + 1) * px, px, px);
    if (lastSeen) {
      const age = (now - lastSeen.at) / 1000;
      const fresh = age < 1.2;
      ctx.strokeStyle = fresh ? "#ffffff" : `rgba(255,255,255,${Math.max(.2, 1 - age / 30)})`;
      ctx.fillStyle = fresh ? "#ffffff" : "transparent";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc((lastSeen.x + .5) * px, (lastSeen.y + .5) * px, fresh ? 3 : 4 + Math.min(6, age / 4), 0, Math.PI * 2);
      if (fresh) ctx.fill(); else ctx.stroke();
      if (!fresh) { ctx.fillStyle = "#cfc2b0"; ctx.font = "7px monospace"; ctx.fillText(`${Math.floor(age)}с`, (lastSeen.x + .5) * px, (lastSeen.y - .6) * px); }
    }
    const s = game.self;
    ctx.save(); ctx.translate((s.x + .5) * px, (s.y + .5) * px); ctx.rotate(s.yaw);
    ctx.fillStyle = "#ff3a28"; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -3.5); ctx.lineTo(-4, 3.5); ctx.fill();
    ctx.restore();
  }, [game, lastSeen, now]);
  return <div className="hospital-minimap"><canvas ref={ref} /><span>КАРТА · M</span></div>;
}
