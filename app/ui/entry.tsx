"use client";

import { useEffect, useState } from "react";
import type { Side } from "../game-types";

export type Peek = { code: string; invite: string; host: string; side: Side } | null;

function Backdrop() {
  return <div className="hospital-entry-sky" aria-hidden="true">
    <i className="hospital-moon" />
    <div className="hospital-building">
      {Array.from({ length: 16 }, (_, i) => <b key={i} className={i === 5 ? "lit" : i === 11 ? "flicker" : ""} />)}
      <em>КОРПУС 13</em>
    </div>
    <i className="hospital-fog" />
    <i className="hospital-car"><s /></i>
    <i className="hospital-trees" />
  </div>;
}

export function Landing(props: {
  name: string; setName: (v: string) => void; side: Side; setSide: (s: Side) => void;
  busy: boolean; onCreate: () => void; joining: boolean; setJoining: (v: boolean) => void;
  joinLink: string; setJoinLink: (v: string) => void; onJoinLink: () => void;
}) {
  return <section className="hospital-entry">
    <Backdrop />
    <div className="hospital-entry-top"><span>КО-13 / ЗАКРЫТЫЙ КОРПУС</span><span>ХОРРОР ДЛЯ ДВОИХ · ОНЛАЙН</span></div>
    <div className="hospital-entry-main">
      <p className="hospital-kicker">ПОСЛЕДНИЙ ВЫЗОВ · ПСИХОНЕВРОЛОГИЧЕСКИЙ ДИСПАНСЕР</p>
      <h1 data-text="ТИХИЙ">ТИХИЙ<br /><em>КОРПУС</em></h1>
      {!props.joining ? <>
        <p className="hospital-lead">Двое приезжают ночью к закрытому корпусу. Один ищет истории пациентов и путь наружу. Второй с самого начала знает, чем закончится эта ночь.</p>
        <TouchWarning />
        <label className="hospital-field">ТВОЁ ИМЯ<input value={props.name} maxLength={16} onChange={e => props.setName(e.target.value)} placeholder="Например, Андрей" autoComplete="nickname" /></label>
        <div className="hospital-roles" role="radiogroup" aria-label="Твоя роль">
          <button role="radio" aria-checked={props.side === "monster"} className={props.side === "monster" ? "active" : ""} onClick={() => props.setSide("monster")}>
            <b>СУЩЕСТВО</b><span>Второй игрок думает, что вы исследуете корпус вдвоём. Выгляди как спутник, пугай, путай и раскройся в худший момент.</span>
          </button>
          <button role="radio" aria-checked={props.side === "player"} className={props.side === "player" ? "active" : ""} onClick={() => props.setSide("player")}>
            <b>ПОСЕТИТЕЛЬ</b><span>Найди четыре истории пациентов, запусти щиток на посту охраны и выберись. Держись рядом со спутником… если это спутник.</span>
          </button>
        </div>
        <div className="hospital-entry-actions">
          <button className="hospital-primary" disabled={props.busy} onClick={props.onCreate}>Создать комнату <span>↗</span></button>
          <button className="hospital-plain" onClick={() => props.setJoining(true)}>У меня есть ссылка-приглашение</button>
        </div>
      </> : <div className="hospital-join">
        <label className="hospital-field">ССЫЛКА-ПРИГЛАШЕНИЕ<input value={props.joinLink} onChange={e => props.setJoinLink(e.target.value)} placeholder="https://…?join=…" autoComplete="off" /></label>
        <button className="hospital-primary" disabled={props.busy} onClick={props.onJoinLink}>Открыть приглашение <span>↗</span></button>
        <button className="hospital-plain" onClick={() => props.setJoining(false)}>Назад</button>
      </div>}
    </div>
    <div className="hospital-entry-bottom"><span>НАУШНИКИ ОБЯЗАТЕЛЬНЫ</span><span>WASD · SHIFT · МЫШЬ · E · F · TAB</span></div>
  </section>;
}

function TouchWarning() {
  // Measured after mount so the server render and hydration agree.
  const [touchOnly, setTouchOnly] = useState(false);
  useEffect(() => { queueMicrotask(() => setTouchOnly(matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches)); }, []);
  return touchOnly ? <p className="hospital-touch-warning">Похоже, это телефон. Для игры нужен компьютер с клавиатурой и мышью — откройте ссылку на нём.</p> : null;
}

export function InviteScreen({ peek, name, setName, busy, onJoin, onBack }: { peek: Peek; name: string; setName: (v: string) => void; busy: boolean; onJoin: () => void; onBack: () => void }) {
  const monster = peek?.side === "monster";
  return <section className="hospital-entry invite">
    <Backdrop />
    <div className="hospital-entry-top"><span>ПРИГЛАШЕНИЕ · КОМНАТА {peek?.code ?? "…"}</span><span>НАУШНИКИ ОБЯЗАТЕЛЬНЫ</span></div>
    <div className="hospital-entry-main">
      <p className="hospital-kicker">{peek ? `${peek.host.toUpperCase()} ЗОВЁТ ТЕБЯ` : "ОТКРЫВАЕМ ПРИГЛАШЕНИЕ…"}</p>
      <h1>ТИХИЙ<br /><em>КОРПУС</em></h1>
      {peek && (monster
        ? <p className="hospital-lead">Ты будешь существом. Второй игрок думает, что вы приехали исследовать корпус вдвоём. Прикидывайся спутником, пугай и лови, пока добыча не сбежала.</p>
        : <p className="hospital-lead">Ночью вы вдвоём едете к закрытому корпусу психбольницы. Найдите четыре истории пациентов, запустите щиток на посту охраны и выберитесь до конца смены. Говорят, внутри кто-то остался.</p>)}
      {peek && <>
        <TouchWarning />
        <label className="hospital-field">ТВОЁ ИМЯ<input value={name} maxLength={16} onChange={e => setName(e.target.value)} placeholder="Как тебя зовут?" autoComplete="nickname" /></label>
        <div className="hospital-entry-actions">
          <button className="hospital-primary" disabled={busy} onClick={onJoin}>{monster ? "Войти существом" : "Сесть в машину"} <span>↗</span></button>
          <button className="hospital-plain" onClick={onBack}>На главную</button>
        </div>
        <ul className="hospital-howto">
          {monster ? <>
            <li><b>G</b> сменить облик · <b>ЛКМ</b> бросок</li>
            <li><b>1–0</b> розыгрыши · <b>R</b> рация · <b>T</b> надпись</li>
            <li><b>TAB</b> все приёмы и настройки</li>
          </> : <>
            <li><b>WASD</b> идти · <b>SHIFT</b> бежать · <b>C</b> присесть</li>
            <li><b>E</b> действие · <b>F</b> фонарь · <b>Q</b> вспышка</li>
            <li><b>TAB</b> дело и настройки</li>
          </>}
        </ul>
      </>}
    </div>
    <div className="hospital-entry-bottom"><span>ДВОЕ · ОДНА НОЧЬ</span><span>ЛУЧШЕ ИГРАТЬ В ТЕМНОТЕ</span></div>
  </section>;
}

export function Waiting({ code, inviteUrl, side, onCopy }: { code: string; inviteUrl: string; side: Side; onCopy: () => void }) {
  return <div className="hospital-modal-scrim"><div className="hospital-modal">
    <p className="hospital-kicker">КОМНАТА {code}</p>
    <h2>Ждём второго игрока</h2>
    {side === "monster"
      ? <p>Отправь ссылку. Это обычное приглашение: вы приедете вместе, и для второго игрока ты будешь просто спутником. Раскройся клавишей <b>G</b>, когда будет страшнее всего.</p>
      : <p>Отправь ссылку второму игроку. Вы начнёте вместе в машине у входа в корпус.</p>}
    {inviteUrl && <><input readOnly value={inviteUrl} aria-label="Ссылка приглашения" onFocus={e => e.currentTarget.select()} onClick={e => e.currentTarget.select()} />
      <button className="hospital-primary" onClick={onCopy}>Скопировать приглашение</button></>}
    <p className="hospital-small">Игра начнётся сама, как только второй игрок войдёт. Страницу можно не обновлять.</p>
  </div></div>;
}
