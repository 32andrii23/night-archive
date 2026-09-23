"use client";

import { useEffect, useRef, useState } from "react";
import { STORIES } from "../../lib/hospital";
import type { GameView } from "../game-types";
import type { Settings } from "../game-view";
import { RADIO_PRESETS, TRICKS, VOICE_PRESETS, WRITE_PRESETS, type Trick } from "./data";

export type AllSettings = Settings & { volume: number };

function SettingsBlock({ settings, setSettings }: { settings: AllSettings; setSettings: (s: AllSettings) => void }) {
  const set = <K extends keyof AllSettings>(key: K, value: AllSettings[K]) => setSettings({ ...settings, [key]: value });
  return <div className="hospital-settings">
    <h3>НАСТРОЙКИ</h3>
    <label>Громкость <input type="range" min={0} max={1} step={.05} value={settings.volume} onChange={e => set("volume", Number(e.target.value))} /><output>{Math.round(settings.volume * 100)}</output></label>
    <label>Чувствительность мыши <input type="range" min={.25} max={2.5} step={.05} value={settings.sensitivity} onChange={e => set("sensitivity", Number(e.target.value))} /><output>{settings.sensitivity.toFixed(2)}</output></label>
    <label>Поле зрения <input type="range" min={60} max={95} step={1} value={settings.fov} onChange={e => set("fov", Number(e.target.value))} /><output>{settings.fov}°</output></label>
    <label>Качество
      <select value={settings.quality} onChange={e => set("quality", e.target.value as Settings["quality"])}>
        <option value="low">Низкое — слабый ноутбук</option>
        <option value="medium">Среднее</option>
        <option value="high">Высокое — тени и сглаживание</option>
      </select>
    </label>
    <label className="check"><input type="checkbox" checked={settings.invertY} onChange={e => set("invertY", e.target.checked)} /> Инвертировать мышь по вертикали</label>
    <label className="check"><input type="checkbox" checked={settings.reduced} onChange={e => set("reduced", e.target.checked)} /> Снизить вспышки и тряску</label>
  </div>;
}

export function Panel({ game, code, settings, setSettings, onClose, onLeave, onTrick, onForm, onRead, now }: {
  game: GameView; code: string; settings: AllSettings; setSettings: (s: AllSettings) => void; onClose: () => void; onLeave: () => void;
  onTrick: (t: Trick) => void; onForm: () => void; onRead: (story: number) => void; now: number;
}) {
  const monster = game.side === "monster";
  const energy = game.self.energy ?? 0;
  return <div className="hospital-panel-backdrop" onClick={onClose}>
    <aside className="hospital-panel" onClick={e => e.stopPropagation()} aria-label={monster ? "Консоль существа" : "Личное дело"}>
      <div className="hospital-panel-head"><span>{monster ? "КОНСОЛЬ СУЩЕСТВА" : "ЛИЧНОЕ ДЕЛО"}</span><button onClick={onClose} aria-label="Закрыть панель">×</button></div>
      {monster ? <>
        <h2>Держи добычу в страхе.</h2>
        <p className="hospital-panel-lead">В углу экрана — то, что видит {game.names.player}. В облике спутника тебя не боятся — подойди, помаши, заведи в тупик. Поймать можно только в истинной форме (G): превращение занимает секунду, и в это время тебя видно. Вспышка фонаря ослепляет на 4 секунды.</p>
        <div className="hospital-energy">СИЛА <strong>{Math.floor(energy)} / 100</strong><i style={{ width: `${energy}%` }} /></div>
        <button className="hospital-disguise" onClick={onForm}>{game.self.disguised ? "G · Раскрыть истинную форму" : "G · Снова выглядеть как спутник"}<small>В истинной форме ты быстрее и опасен. ЛКМ — бросок вперёд.</small></button>
        {(["sound", "vision", "control", "voice"] as const).map(group => <div key={group} className="hospital-tricks">
          <h3>{group === "sound" ? "ЗВУКИ" : group === "vision" ? "ВИДЕНИЯ" : group === "control" ? "КОНТРОЛЬ" : "ГОЛОС"}</h3>
          {TRICKS.filter(t => t.group === group).map(t => {
            const cd = (game.cooldowns?.[t.type] ?? 0) - now;
            const disabled = game.phase !== "playing" || cd > 0 || energy < t.cost || (t.type === "lock" && !game.power);
            return <button key={t.type} disabled={disabled} onClick={() => onTrick(t)}>
              <b>{t.keyLabel ?? "·"}</b><span><strong>{t.label} · {t.cost}</strong><small>{t.detail}</small></span>{cd > 0 && <em>{Math.ceil(cd / 1000)}с</em>}
            </button>;
          })}
        </div>)}
        <ul className="hospital-controls"><li><b>WASD</b> идти</li><li><b>G</b> облик</li><li><b>ЛКМ/ПКМ</b> бросок</li><li><b>E</b> обыскать шкаф</li><li><b>P</b> размер окна друга</li><li><b>M</b> карта</li></ul>
      </> : <>
        <h2>Найдите путь наружу.</h2>
        <p className="hospital-panel-lead">Соберите четыре истории пациентов, запустите щиток на посту охраны (северо-восток) и вернитесь к главному входу. План эвакуации висит в вестибюле. В корпусе что-то есть: вспышка ненадолго его ослепляет, а в шкафу можно переждать.</p>
        <div className="hospital-case-row"><span>ИСТОРИИ ПАЦИЕНТОВ</span><strong>{game.found} / {game.total}</strong></div>
        <div className="hospital-case-row"><span>АВАРИЙНОЕ ПИТАНИЕ</span><strong>{game.power ? "ВКЛЮЧЕНО" : "ОТКЛЮЧЕНО"}</strong></div>
        <div className="hospital-case-row"><span>ГЛАВНЫЙ ВХОД</span><strong>{game.power ? "ОТКРЫВАЕТСЯ" : "ЗАПЕРТ"}</strong></div>
        {game.stories.length > 0 && <div className="hospital-stories"><h3>НАЙДЕННЫЕ ИСТОРИИ</h3>{game.stories.map(id => { const s = STORIES.find(x => x.id === id)!; return <button key={id} onClick={() => onRead(id)}><b>{s.number}</b>{s.title}</button>; })}</div>}
        <ul className="hospital-controls"><li><b>WASD</b> идти</li><li><b>SHIFT</b> бежать</li><li><b>C</b> присесть — тише шаги</li><li><b>E</b> действие / шкаф</li><li><b>F</b> фонарь</li><li><b>Q / ПКМ</b> вспышка</li></ul>
      </>}
      <SettingsBlock settings={settings} setSettings={setSettings} />
      <div className="hospital-panel-foot"><span>КОМНАТА {code}</span><button onClick={onLeave}>ПОКИНУТЬ КОМНАТУ</button></div>
    </aside>
  </div>;
}

/** Radio / blood writing / voice input for the creature. Digits pick presets. */
export function TextTrick({ kind, friend, onSend, onClose }: { kind: "radio" | "write" | "voice"; friend: string; onSend: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const presets = kind === "radio" ? RADIO_PRESETS : kind === "write" ? [...WRITE_PRESETS, `${friend.toUpperCase()}, НЕ ВЫЙТИ`.slice(0, 22)] : VOICE_PRESETS;
  useEffect(() => { input.current?.focus(); }, []);
  const max = kind === "write" ? 22 : 90;
  return <div className="hospital-modal-scrim soft" onClick={onClose}>
    <div className="hospital-modal hospital-text-trick" onClick={e => e.stopPropagation()}>
      <p className="hospital-kicker">{kind === "radio" ? "РАЦИЯ · ГОВОРИШЬ КАК СПУТНИК" : kind === "write" ? "НАДПИСЬ КРОВЬЮ НА СТЕНЕ ПЕРЕД ДОБЫЧЕЙ" : "ГОЛОС ИЗ ТЕМНОТЫ"}</p>
      <div className="hospital-presets">{presets.map((p, i) => <button key={p} onClick={() => onSend(p)}><kbd>{i + 1}</kbd>{p}</button>)}</div>
      <form onSubmit={e => { e.preventDefault(); if (text.trim()) onSend(text.trim()); }}>
        <input ref={input} value={text} maxLength={max} placeholder={kind === "write" ? "Свой текст, до 22 букв" : "Свой текст…"}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Escape") { e.preventDefault(); onClose(); }
            if (!text && /^Digit[1-9]$/.test(e.code)) { const p = presets[Number(e.code.slice(5)) - 1]; if (p) { e.preventDefault(); onSend(p); } }
            e.stopPropagation();
          }} />
        <button className="hospital-primary" type="submit" disabled={!text.trim()}>Отправить <span>↵</span></button>
      </form>
    </div>
  </div>;
}
