"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { ARRIVAL_MS, REVEAL_MS, SPEED, canOccupy, dist, lineOfSight, roomAt, slide } from "../lib/hospital";
import type { GameEvent, GameView, LocalState } from "./game-types";
import type { HorrorAudio } from "./engine/audio";
import { CELL, EYE, createLevel, wx, wz } from "./engine/level";
import { animateRig, createCreature, createHuman, type Rig } from "./engine/models";
import { PostFX, defaultPost } from "./engine/post";
import { glowTexture } from "./engine/textures";

export type MoveInput = { x: number; y: number; yaw: number; pitch: number; seq: number; warp: number; crouch: boolean; sprint: boolean; light: boolean };
export type Settings = { sensitivity: number; quality: "low" | "medium" | "high"; invertY: boolean; fov: number; reduced: boolean };

type Props = {
  game: GameView;
  active: boolean;
  settings: Settings;
  pipLarge: boolean;
  pipRef: RefObject<HTMLElement | null>;
  audio: HorrorAudio;
  clock: RefObject<number>;
  onMove: (m: MoveInput) => void;
  onAction: (type: string) => void;
  onLocal: (s: LocalState) => void;
  onCopyForChrome: () => void;
};

const MAX_PITCH = Math.PI / 2 - .05;
const INTERP_DELAY = 320;

type Snap = { t: number; x: number; y: number; yaw: number; pitch: number };
/** Snapshot interpolation for remote bodies, rendered slightly in the past. */
class Interp {
  snaps: Snap[] = [];
  x = 0; y = 0; yaw = 0; pitch = 0; speed = 0; ready = false;
  push(s: Snap) {
    const last = this.snaps[this.snaps.length - 1];
    if (last && s.t <= last.t) { if (s.t === last.t) Object.assign(last, s); return; }
    if (last && Math.hypot(s.x - last.x, s.y - last.y) > 3.5) this.snaps = [];
    this.snaps.push(s);
    if (this.snaps.length > 30) this.snaps.shift();
  }
  sample(time: number, dt: number) {
    const s = this.snaps;
    if (!s.length) return;
    let x: number, y: number, yaw: number, pitch: number;
    if (time <= s[0].t) ({ x, y, yaw, pitch } = s[0]);
    else if (time >= s[s.length - 1].t) ({ x, y, yaw, pitch } = s[s.length - 1]);
    else {
      let i = 1;
      while (i < s.length && s[i].t < time) i++;
      const a = s[i - 1], b = s[i];
      const k = (time - a.t) / Math.max(1, b.t - a.t);
      x = a.x + (b.x - a.x) * k; y = a.y + (b.y - a.y) * k; pitch = a.pitch + (b.pitch - a.pitch) * k;
      const dy = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
      yaw = a.yaw + dy * k;
    }
    if (!this.ready || Math.hypot(x - this.x, y - this.y) > 3.5) { this.x = x; this.y = y; this.yaw = yaw; this.pitch = pitch; this.ready = true; this.speed = 0; return; }
    const moved = Math.hypot(x - this.x, y - this.y);
    this.speed += (moved / Math.max(dt, 1e-3) - this.speed) * Math.min(1, dt * 8);
    const blend = 1 - Math.exp(-dt * 18);
    this.x += (x - this.x) * blend; this.y += (y - this.y) * blend;
    this.yaw += Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw)) * blend;
    this.pitch += (pitch - this.pitch) * blend;
  }
  reset() { this.snaps = []; this.ready = false; this.speed = 0; }
}

type Apparition = { kind: "shadow" | "phantom"; rig: Rig; x: number; y: number; yaw: number; born: number; until: number; fade: number; gone: boolean; phase: { walk: number } };

export default function GameViewCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  const captureRef = useRef<() => void>(() => {});
  const [unavailable, setUnavailable] = useState(false);
  const [dragLook, setDragLook] = useState(false);
  useEffect(() => { propsRef.current = props; });
  useEffect(() => { if (!props.active && document.pointerLockElement === canvasRef.current) document.exitPointerLock(); }, [props.active]);

  const quality = props.settings.quality;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false });
    } catch {
      queueMicrotask(() => setUnavailable(true));
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.autoClear = false;
    renderer.setClearColor(0x05080a, 1);
    renderer.shadowMap.enabled = quality !== "low";
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // Only the torch casts shadows and both views share it: render its map once per frame.
    renderer.shadowMap.autoUpdate = false;

    const post = new PostFX();
    post.samples = quality === "high" ? 4 : 0;
    const scene = new THREE.Scene();
    const fog = new THREE.FogExp2(0x070b0c, .06);
    scene.fog = fog;
    const level = createLevel(scene, quality);
    const camera = new THREE.PerspectiveCamera(propsRef.current.settings.fov, 1, .05, 420);
    camera.rotation.order = "YXZ";
    const friendCamera = new THREE.PerspectiveCamera(72, 1.6, .05, 420);
    friendCamera.rotation.order = "YXZ";

    /* ----------------------------- characters ----------------------------- */
    const creature = createCreature();
    const disguise = createHuman({ jacket: 0x3a3f38, pants: 0x23262b, hair: 0x2a1d14 });
    const monsterRoot = new THREE.Group();
    monsterRoot.add(creature.root, disguise.root);
    scene.add(monsterRoot);
    const visitor = createHuman({ jacket: 0x6b4a2e, pants: 0x2a3140, hair: 0x4a3322 });
    scene.add(visitor.root);
    const phantomRig = createHuman({ jacket: 0x3a3f38, pants: 0x23262b, hair: 0x2a1d14 });
    const shadowRig = createCreature(true);
    scene.add(phantomRig.root, shadowRig.root);
    phantomRig.root.visible = false; shadowRig.root.visible = false;
    // Eyes must read from across a dark corridor.
    const eyeGlow = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd8c8, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .8 });
    for (const rig of [creature, shadowRig]) for (const e of rig.eyes ?? []) {
      e.scale.multiplyScalar(1.7);
      const glow = new THREE.Sprite(eyeGlow);
      glow.scale.setScalar(rig === shadowRig ? 9 : 5);
      e.add(glow);
    }
    const monsterPhase = { walk: 0 }, visitorPhase = { walk: 0 };

    // First-person view models live in their own scene, drawn over the world.
    const vmScene = new THREE.Scene();
    vmScene.add(new THREE.AmbientLight(0xffffff, .12));
    const vmLight = new THREE.PointLight(0xfff0d0, .3, 1.5, 2);
    vmScene.add(vmLight);
    const vmCamera = new THREE.PerspectiveCamera(60, 1, .01, 10);
    vmScene.add(vmCamera);
    const vmTorch = new THREE.Group();
    {
      const skin = new THREE.MeshLambertMaterial({ color: 0x7a5a48 });
      const metal = new THREE.MeshStandardMaterial({ color: 0x1c1e1d, roughness: .5, metalness: .3 });
      const sleeveMat = new THREE.MeshLambertMaterial({ color: 0x2a2620 });
      const lens = new THREE.MeshBasicMaterial({ color: 0xfff4dc });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(.017, .02, .19, 12), metal);
      body.rotation.x = Math.PI / 2; vmTorch.add(body);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(.028, .021, .045, 12), metal);
      head.rotation.x = Math.PI / 2; head.position.z = -.115; vmTorch.add(head);
      const glass = new THREE.Mesh(new THREE.CircleGeometry(.024, 14), lens);
      glass.position.z = -.139; glass.rotation.y = Math.PI; vmTorch.add(glass);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(.055, .05, .085), skin);
      hand.position.set(.002, -.012, .035); vmTorch.add(hand);
      const thumb = new THREE.Mesh(new THREE.BoxGeometry(.018, .018, .05), skin);
      thumb.position.set(-.026, .006, .012); thumb.rotation.y = .3; vmTorch.add(thumb);
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(.034, .04, .2, 10), sleeveMat);
      sleeve.rotation.x = Math.PI / 2 - .75; sleeve.position.set(.012, -.07, .12); vmTorch.add(sleeve);
      vmTorch.userData.glass = glass;
    }
    vmCamera.add(vmTorch);
    const vmClaws = new THREE.Group();
    {
      const skin = new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: .45, emissive: 0x0a0806 });
      const nail = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: .3 });
      for (const side of [-1, 1]) {
        const arm = new THREE.Group();
        // Forearm lies along -Z, reaching from the lower corner into view.
        const fore = new THREE.Mesh(new THREE.CapsuleGeometry(.028, .38, 4, 8), skin);
        fore.rotation.x = Math.PI / 2; fore.position.set(0, 0, -.2); arm.add(fore);
        const hand = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), skin);
        hand.scale.set(.04, .018, .05); hand.position.set(0, 0, -.43); arm.add(hand);
        for (let i = 0; i < 4; i++) {
          const f = new THREE.Mesh(new THREE.ConeGeometry(.007, .2, 5), skin);
          f.rotation.x = -Math.PI / 2 - .35; f.position.set((i - 1.5) * .02 * side, -.02, -.53 - (i === 1 || i === 2 ? .02 : 0)); arm.add(f);
          const tip = new THREE.Mesh(new THREE.ConeGeometry(.004, .04, 4), nail);
          tip.rotation.x = -Math.PI / 2 - .35; tip.position.set((i - 1.5) * .02 * side, -.055, -.63 - (i === 1 || i === 2 ? .02 : 0)); arm.add(tip);
        }
        arm.position.set(side * .26, -.27, -.02);
        arm.rotation.set(.12, side * .28, side * .18);
        arm.userData.side = side;
        vmClaws.add(arm);
      }
    }
    vmCamera.add(vmClaws);


    /* -------------------------------- lights -------------------------------- */
    const torch = new THREE.SpotLight(0xfff0d4, 0, 20, Math.PI / 6.4, .5, 1.35);
    torch.castShadow = quality !== "low";
    torch.shadow.mapSize.setScalar(quality === "high" ? 1024 : 512);
    torch.shadow.bias = -.0006; torch.shadow.normalBias = .03;
    torch.shadow.camera.near = .2; torch.shadow.camera.far = 20;
    const torchTarget = new THREE.Object3D();
    scene.add(torch, torchTarget); torch.target = torchTarget;
    const spill = new THREE.PointLight(0xfff0d4, 0, 4, 2);
    scene.add(spill);
    const companionTorch = new THREE.SpotLight(0xffeccc, 0, 14, Math.PI / 7, .5, 1.4);
    const companionTarget = new THREE.Object3D();
    scene.add(companionTorch, companionTarget); companionTorch.target = companionTarget;
    const headlights = new THREE.SpotLight(0xfff2d0, 0, 45, .55, .6, 1.1);
    const headTarget = new THREE.Object3D();
    scene.add(headlights, headTarget); headlights.target = headTarget;

    /* --------------------------------- dust --------------------------------- */
    const dustCount = quality === "low" ? 0 : 500;
    const dustGeo = new THREE.BufferGeometry();
    const seeds = new Float32Array(dustCount * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(seeds, 3));
    const dustTex = glowTexture();
    const dustMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { center: { value: new THREE.Vector3() }, time: { value: 0 }, lightPos: { value: new THREE.Vector3() }, lightDir: { value: new THREE.Vector3(0, 0, -1) }, strength: { value: 1 }, map: { value: dustTex } },
      vertexShader: `uniform vec3 center; uniform float time; uniform vec3 lightPos; uniform vec3 lightDir; uniform float strength; varying float vA;
        void main(){ vec3 box = vec3(9.0, 3.0, 9.0);
          vec3 p = position * box; p += vec3(sin(time*.11+position.y*40.)*.4, time*.05*(.3+position.x), cos(time*.09+position.z*30.)*.4);
          p = mod(p - center + box*.5, box) + center - box*.5; p.y = mod(p.y, 3.0) + .05;
          vec3 toP = p - lightPos; float d = length(toP); float c = dot(toP / d, lightDir);
          vA = smoothstep(.86, .97, c) * smoothstep(12.0, 1.0, d) * strength;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(7.0 / -mv.z, 1.0, 6.0); }`,
      fragmentShader: `uniform sampler2D map; varying float vA; void main(){ float a = texture2D(map, gl_PointCoord).r * vA * .5; if (a < .003) discard; gl_FragColor = vec4(vec3(1.0,.95,.85)*a, a); }`,
    });
    /* ------------------------ visible torch beams ------------------------ */
    // An open cone, tip at the lens, pointing +Z so Object3D.lookAt aims it.
    const beamGeo = new THREE.ConeGeometry(1, 1, 28, 6, true);
    beamGeo.translate(0, -.5, 0);
    beamGeo.rotateX(-Math.PI / 2);
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { strength: { value: 1 }, color: { value: new THREE.Color(0xfff0d4) } },
      vertexShader: `varying float vAlong; varying vec3 vN; varying vec3 vV;
        void main(){ vAlong = position.z; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float strength; uniform vec3 color; varying float vAlong; varying vec3 vN; varying vec3 vV;
        void main(){ float facing = abs(dot(normalize(vN), normalize(vV))); float a = strength * pow(1.0 - vAlong, 1.6) * smoothstep(0.0, 0.08, vAlong) * pow(facing, 1.8) * 0.32; gl_FragColor = vec4(color * a, a); }`,
    });
    const makeBeam = () => { const m = new THREE.Mesh(beamGeo, beamMat.clone()); m.frustumCulled = false; m.visible = false; m.renderOrder = 3; scene.add(m); return m; };
    const beams = { companion: makeBeam(), phantom: makeBeam(), visitor: makeBeam() };
    const aimBeam = (beam: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, power: number, length = 7, angle = .42) => {
      beam.visible = power > .02;
      if (!beam.visible) return;
      beam.position.copy(from);
      beam.scale.set(Math.tan(angle) * length, Math.tan(angle) * length, length);
      beam.lookAt(to);
      (beam.material as THREE.ShaderMaterial).uniforms.strength.value = power;
    };
    const dust = new THREE.Points(dustGeo, dustMat);
    dust.frustumCulled = false;
    if (dustCount) scene.add(dust);

    /* ------------------------------- state ------------------------------- */
    const g0 = propsRef.current.game;
    const me = { x: g0.self.x, y: g0.self.y, vx: 0, vy: 0 };
    let yaw = g0.self.yaw ?? -Math.PI / 2, pitch = g0.self.pitch ?? 0;
    let lastWarp = g0.self.warp, seq = 1, lastSentAt = 0, sentYaw = yaw, sentPitch = pitch;
    const sent = new Map<number, { x: number; y: number }>();
    let correction = { x: 0, y: 0 };
    let stamina = 1, staminaLock = 0, crouch = false, light = true, sprinting = false;
    let lastProcessed: GameView | null = null;
    const rival = new Interp(), friend = new Interp();
    const seen = new Set<string>();
    let trauma = 0, flash = 0, glitchUntil = 0, blackoutFade = 0, stepPhase = 0, rivalStep = 0, lastStinger = -1e9, lastGrowl = 0;
    let torchFlicker = 1, creakClock = 0, candleClock = 0, jumpscareUntil = 0, pantClock = 0;
    // Scripted "first visit" scares, local to the visitor, so the building feels alive
    // even when the creature player is busy elsewhere.
    const visited = new Set<string>();
    const pendingScares: Array<{ at: number; run: () => void }> = [];
    const JUMPSCARE_MS = 1300;
    const apparitions: Apparition[] = [];
    const keys = new Set<string>();
    let dragFallback = false, dragging = false, dragX = 0, dragY = 0;

    const serverNow = () => Date.now() + (propsRef.current.clock.current ?? 0);
    const isMonsterNow = (g: GameView) => g.side === "monster";
    const look = (dx: number, dy: number, factor = .0022) => {
      const s = propsRef.current.settings;
      const k = factor * s.sensitivity;
      yaw += dx * k;
      pitch = THREE.MathUtils.clamp(pitch - dy * k * (s.invertY ? -1 : 1), -MAX_PITCH, MAX_PITCH);
    };
    const requestCapture = () => {
      if (!propsRef.current.active || document.pointerLockElement === canvas) return;
      try {
        const result = canvas.requestPointerLock?.({ unadjustedMovement: true } as never) as unknown as Promise<void> | undefined;
        void Promise.resolve(result).catch(() => {
          void Promise.resolve(canvas.requestPointerLock?.()).catch(() => { dragFallback = true; setDragLook(true); });
        });
      } catch { dragFallback = true; setDragLook(true); }
    };
    captureRef.current = requestCapture;
    const pointerDown = (e: PointerEvent) => {
      const p = propsRef.current;
      if (!p.active || e.pointerType === "touch") return;
      if (e.button === 2 && document.pointerLockElement === canvas) p.onAction(p.game.side === "player" ? "flare" : "lunge");
      if (e.button === 0 && document.pointerLockElement === canvas && p.game.side === "monster") p.onAction("lunge");
      dragging = true; dragX = e.clientX; dragY = e.clientY;
      requestCapture();
    };
    const pointerLockChange = () => { if (document.pointerLockElement === canvas) { dragFallback = false; dragging = false; setDragLook(false); } };
    const pointerMove = (e: PointerEvent) => {
      if (!propsRef.current.active || !dragFallback || !dragging || e.pointerType === "touch") return;
      look(e.clientX - dragX, e.clientY - dragY, .0038);
      dragX = e.clientX; dragY = e.clientY;
    };
    const mouseMove = (e: MouseEvent) => {
      if (!propsRef.current.active || document.pointerLockElement !== canvas) return;
      // Some browsers emit a huge spike when the lock engages.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      look(e.movementX, e.movementY);
    };
    const pointerUp = () => { dragging = false; };
    const clearInput = () => { keys.clear(); dragging = false; };
    const keyDown = (e: KeyboardEvent) => {
      const p = propsRef.current;
      if (!p.active || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.code;
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "Space"].includes(key)) { e.preventDefault(); keys.add(key); }
      if (e.repeat) return;
      if (key === "KeyC" || key === "ControlLeft") { if (key === "KeyC") e.preventDefault(); crouch = !crouch; }
      if (key === "KeyF" && p.game.side === "player") { e.preventDefault(); light = !light; p.audio.play("torch"); lastSentAt = 0; }
    };
    const keyUp = (e: KeyboardEvent) => { keys.delete(e.code); };
    const contextMenu = (e: MouseEvent) => e.preventDefault();
    let touchX = 0, touchY = 0, touching = false;
    const touchStart = (e: TouchEvent) => { if (!propsRef.current.active || !e.touches.length) return; touching = true; touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; };
    const touchMove = (e: TouchEvent) => {
      if (!propsRef.current.active || !touching || !e.touches.length) return;
      e.preventDefault();
      look(e.touches[0].clientX - touchX, e.touches[0].clientY - touchY, .004);
      touchX = e.touches[0].clientX; touchY = e.touches[0].clientY;
    };
    const touchEnd = () => { touching = false; };
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("contextmenu", contextMenu);
    canvas.addEventListener("touchstart", touchStart, { passive: true });
    canvas.addEventListener("touchmove", touchMove, { passive: false });
    canvas.addEventListener("touchend", touchEnd);
    document.addEventListener("mousemove", mouseMove);
    document.addEventListener("pointerlockchange", pointerLockChange);
    document.addEventListener("pointerup", pointerUp);
    document.addEventListener("pointercancel", clearInput);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", clearInput);

    let width = 1, height = 1, renderScale = quality === "high" ? .9 : quality === "medium" ? .72 : .55;
    const maxScale = renderScale;
    const resize = () => {
      width = Math.max(1, Math.floor(canvas.clientWidth));
      height = Math.max(1, Math.floor(canvas.clientHeight));
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      camera.aspect = width / height; camera.updateProjectionMatrix();
      vmCamera.aspect = width / height; vmCamera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    /* ------------------------------- helpers ------------------------------- */
    const toWorld = (x: number, y: number, h = 0) => new THREE.Vector3(wx(x), h, wz(y));
    const placeRig = (rig: Rig, x: number, y: number, yawG: number) => { rig.root.position.set(wx(x), 0, wz(y)); rig.root.rotation.y = -yawG - Math.PI / 2; };
    const spawnApparition = (e: GameEvent, now: number) => {
      const kind = e.type as "shadow" | "phantom";
      const rig = kind === "shadow" ? shadowRig : phantomRig;
      for (const a of apparitions) if (a.rig === rig) a.gone = true;
      apparitions.push({ kind, rig, x: e.x, y: e.y, yaw: e.yaw ?? 0, born: now, until: e.until, fade: 0, gone: false, phase: { walk: 0 } });
    };
    const eventPos = (e: { x: number; y: number }, h = 1.2) => toWorld(e.x, e.y, h);

    const handleEvent = (e: GameEvent, g: GameView, now: number) => {
      const a = propsRef.current.audio;
      const mine = g.side === "player";
      const pos = eventPos(e);
      // The creature hears its own tricks quietly as feedback, unpositioned.
      const trick = (type: string, positional = true) => mine ? a.play(type, { pos: positional ? pos : undefined, variant: e.variant, from: e.fx !== undefined ? eventPos({ x: e.fx, y: e.fy! }, 0) : undefined }) : a.play(type, { volume: .3, variant: e.variant });
      switch (e.type) {
        case "whisper": case "breath": case "knock": case "laugh": case "phone": trick(e.type); break;
        case "footsteps": trick("footsteps"); break;
        case "doorSlam": trick("doorSlam"); level.slamNear(e.x, e.y, now); if (mine) trauma = Math.max(trauma, .45); break;
        case "flicker": trick("flicker", false); break;
        case "blackout": trick("blackout", false); break;
        case "shadow": if (mine) spawnApparition(e, now); trick("shadow", false); break;
        case "phantom": if (mine) spawnApparition(e, now); trick("phantom"); break;
        case "scare": trick("scare", false); if (mine) { trauma = 1; flash = .15; } break;
        case "glitch": if (mine && !propsRef.current.settings.reduced) { glitchUntil = e.until; a.play("glitch"); a.duck((e.until - now) / 1000); } else trick("glitch", false); break;
        case "lock": trick("lock"); break;
        case "radio": a.play("radio", { volume: mine ? 1 : .4 }); break;
        case "voice": if (mine) a.speak(e.text ?? ""); else a.play("radio", { volume: .3 }); break;
        case "write": trick("write"); break;
        case "reveal": {
          a.play("reveal", { pos, volume: mine ? 1 : .6 });
          if (mine && g.rival) { trauma = Math.max(trauma, .6); if (now - lastStinger > 15_000) { a.play("stinger"); lastStinger = now; } }
          break;
        }
        case "lunge": a.play("lunge", { pos, volume: mine ? 1 : .7 }); break;
        case "search": a.play("search", { pos }); level.lockers[e.variant ?? 0].openUntil = now + 900; break;
        case "hide": case "unhide": a.play(e.type, { pos }); level.lockers[e.variant ?? 0].openUntil = now + 700; break;
        case "flare": {
          if (mine) { flash = 1.4; a.play("flare"); }
          else if (e.variant) { flash = 2; trauma = .8; a.play("stun", { volume: .8 }); }
          else a.play("flare", { volume: .4 });
          break;
        }
        case "caught": a.play("caught", { volume: mine ? 1 : .55 }); if (mine) { trauma = 1; jumpscareUntil = now + (propsRef.current.settings.reduced ? 500 : JUMPSCARE_MS); } break;
        case "wake": if (mine) { blackoutFade = 1; a.play("wake"); } break;
        case "separate": blackoutFade = 1; a.play("separate"); trauma = .7; break;
        case "clue": case "battery": case "power": case "escape": case "allClues": a.play(e.type, { volume: mine ? 1 : .5 }); break;
        case "start": a.play("start"); break;
      }
    };

    /* -------------------------------- loop -------------------------------- */
    let previous = 0, frameAvg = 16, adaptClock = 0, lastLocal = 0;
    const forward = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const mainViewport = new THREE.Vector4(), pipViewport = new THREE.Vector4();
    const post0 = defaultPost(), postPip = defaultPost();
    const bodies: THREE.Vector3[] = [];
    const red = new THREE.Color(1, .22, .16), neutral = new THREE.Color(1, 1, 1);

    // Debug handle (window.__hospital): lets devtools step frames while the tab is hidden.
    const dbg = { force: false, power: false };
    const render = (time: number) => {
      if (document.hidden && !dbg.force) { previous = 0; return; }
      const p = propsRef.current;
      const g = p.game;
      const dt = previous ? Math.min(.05, (time - previous) / 1000) : 1 / 60;
      previous = time;
      frameAvg += (dt * 1000 - frameAvg) * .05;
      const now = serverNow();
      const t = time / 1000;
      const isMonster = g.side === "monster";

      /* ---- server reconciliation ---- */
      if (lastProcessed !== g) {
        if (g.self.warp !== lastWarp) {
          lastWarp = g.self.warp;
          const jump = Math.hypot(g.self.x - me.x, g.self.y - me.y);
          sent.clear();
          // A lunge is a short hop: glide into it instead of snapping.
          if (isMonsterNow(g) && jump < 2.2) correction = { x: g.self.x - me.x, y: g.self.y - me.y };
          else { me.x = g.self.x; me.y = g.self.y; correction = { x: 0, y: 0 }; }
          me.vx = me.vy = 0;
          if ((g.self.hidden ?? -1) >= 0) { yaw = level.lockers[g.self.hidden!].yaw; pitch = 0; }
          else if (jump > 2.5) { yaw = g.self.yaw; pitch = 0; }
        } else {
          const record = sent.get(g.self.seq);
          if (record) {
            const ex = g.self.x - record.x, ey = g.self.y - record.y;
            if (Math.hypot(ex, ey) > .04) correction = { x: correction.x + ex, y: correction.y + ey };
            for (const key of sent.keys()) if (key <= g.self.seq) sent.delete(key);
          } else if (!sent.size && Math.hypot(g.self.x - me.x, g.self.y - me.y) > 1.2) { me.x = g.self.x; me.y = g.self.y; }
        }
        if (g.rival) rival.push({ t: g.rival.t, x: g.rival.x, y: g.rival.y, yaw: g.rival.yaw, pitch: g.rival.pitch });
        else rival.reset();
        if (g.spectate) friend.push({ t: g.spectate.t, x: g.spectate.x, y: g.spectate.y, yaw: g.spectate.yaw, pitch: g.spectate.pitch });
        for (const e of g.events) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          if (lastProcessed || now - e.at < 1500) handleEvent(e, g, now);
        }
        if (seen.size > 300) { const ids = new Set(g.events.map(e => e.id)); for (const id of seen) if (!ids.has(id)) seen.delete(id); }
        level.setWritings(g.writings);
        lastProcessed = g;
      }

      /* ---- local movement ---- */
      const introElapsed = now - g.startedAt;
      const carScene = g.phase === "intro" && introElapsed < ARRIVAL_MS;
      const hidden = !isMonster && (g.self.hidden ?? -1) >= 0;
      const revealing = isMonster && !g.self.disguised && now < (g.self.revealedAt ?? 0) + REVEAL_MS;
      const frozen = carScene || hidden || (g.self.stunnedUntil ?? 0) > now || revealing || (g.phase !== "playing" && g.phase !== "intro");
      let fwd = 0, str = 0;
      if (p.active && !frozen) {
        fwd = Number(keys.has("KeyW") || keys.has("ArrowUp")) - Number(keys.has("KeyS") || keys.has("ArrowDown"));
        str = Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft"));
      }
      const wantsSprint = !isMonster && (keys.has("ShiftLeft") || keys.has("ShiftRight")) && fwd > 0 && !crouch;
      if (staminaLock > 0) staminaLock -= dt;
      sprinting = wantsSprint && stamina > 0 && staminaLock <= 0;
      if (sprinting) { stamina = Math.max(0, stamina - dt / 5.5); if (stamina <= 0) staminaLock = 2.2; }
      else stamina = Math.min(1, stamina + dt / (fwd || str ? 9 : 5.5));
      const speed = isMonster ? (g.self.disguised ? SPEED.monster : SPEED.hunt) : sprinting ? SPEED.sprint : crouch ? SPEED.crouch : SPEED.walk;
      const mag = Math.hypot(fwd, str) || 1;
      const tvx = (Math.cos(yaw) * fwd - Math.sin(yaw) * str) / mag * speed;
      const tvy = (Math.sin(yaw) * fwd + Math.cos(yaw) * str) / mag * speed;
      const accel = 1 - Math.exp(-dt * (fwd || str ? 12 : 16));
      me.vx += (tvx - me.vx) * accel; me.vy += (tvy - me.vy) * accel;
      if (!frozen) {
        slide(me, me.vx * dt, me.vy * dt, g.phase);
        // Server corrections bleed in over a few frames instead of snapping.
        const k = Math.min(1, dt * 10);
        const cx = correction.x * k, cy = correction.y * k;
        slide(me, cx, cy, g.phase);
        correction.x -= cx; correction.y -= cy;
        if (Math.abs(correction.x) + Math.abs(correction.y) < .005) correction = { x: 0, y: 0 };
      } else { me.vx = me.vy = 0; }
      const moving = Math.hypot(me.vx, me.vy) > .3;

      /* ---- send pose ---- */
      const turned = Math.abs(Math.atan2(Math.sin(yaw - sentYaw), Math.cos(yaw - sentYaw))) > .012 || Math.abs(pitch - sentPitch) > .012;
      if ((g.phase === "intro" || g.phase === "playing") && time - lastSentAt > (moving || turned ? 115 : 500)) {
        lastSentAt = time; sentYaw = yaw; sentPitch = pitch;
        seq++;
        sent.set(seq, { x: me.x, y: me.y });
        if (sent.size > 80) sent.delete(sent.keys().next().value!);
        p.onMove({ x: me.x, y: me.y, yaw, pitch, seq, warp: lastWarp, crouch, sprint: sprinting, light });
      }

      /* ---- remote bodies ---- */
      const renderAt = now - INTERP_DELAY;
      rival.sample(renderAt, dt);
      friend.sample(renderAt, dt);
      const monsterPose = isMonster ? { x: me.x, y: me.y, yaw } : rival.ready && g.rival ? rival : null;
      const visitorPose = isMonster ? (friend.ready ? friend : null) : { x: me.x, y: me.y, yaw };
      const car = level.car;
      if (carScene) {
        const k = Math.min(1, introElapsed / 4300);
        const eased = 1 - Math.pow(1 - k, 3);
        car.position.z = wz(32.6) + 46 * (1 - eased);
        car.position.y = Math.sin(t * 17) * .006 * (1 - eased);
      } else { car.position.z = wz(32.6); car.position.y = 0; }

      // Creature model (seen by the visitor) and its disguise.
      const rivalInfo = g.rival;
      const showMonster = !isMonster && !!monsterPose && !!rivalInfo;
      monsterRoot.visible = showMonster || (!isMonster && carScene);
      if (monsterRoot.visible) {
        const disguised = isMonster ? true : !!rivalInfo?.disguised;
        const transforming = !disguised && now < (rivalInfo?.revealedAt ?? 0) + REVEAL_MS;
        creature.root.visible = !disguised;
        disguise.root.visible = disguised;
        if (carScene) {
          monsterRoot.position.set(car.position.x + .36, car.position.y + .34, car.position.z + .12);
          monsterRoot.rotation.y = 0;
          sit(disguise);
        } else if (monsterPose) {
          monsterRoot.position.set(wx(monsterPose.x), 0, wz(monsterPose.y));
          monsterRoot.rotation.y = -monsterPose.yaw - Math.PI / 2;
          const spd = rival.speed;
          if (disguised) animateRig(disguise, t, spd, "human", monsterPhase, dt);
          else animateRig(creature, t, spd, rivalInfo?.stunned ? "stunned" : spd > 2.2 ? "lunge" : "creature", monsterPhase, dt);
          const s = transforming ? .72 + (now - (rivalInfo?.revealedAt ?? 0)) / REVEAL_MS * .28 : 1;
          creature.root.scale.setScalar(s);
          if (transforming) { creature.root.position.set((Math.random() - .5) * .08, 0, (Math.random() - .5) * .08); creature.head.rotation.z = (Math.random() - .5) * 1.5; }
          else creature.root.position.set(0, 0, 0);
        }
      }
      // Visitor model (seen by the creature).
      visitor.root.visible = isMonster && (carScene || (!!visitorPose && !!g.rival));
      if (visitor.root.visible) {
        if (carScene) {
          visitor.root.position.set(car.position.x - .36, car.position.y + .34, car.position.z + .12);
          visitor.root.rotation.y = 0;
          sit(visitor);
        } else if (visitorPose) {
          placeRig(visitor, visitorPose.x, visitorPose.y, visitorPose.yaw);
          animateRig(visitor, t, friend.speed, "human", visitorPhase, dt);
          visitor.body.position.y -= g.spectate?.crouch ? .35 : 0;
        }
      }

      // During the catch screamer the world stays hidden behind the overlay.
      const jumpscare = !isMonster && now < jumpscareUntil;

      /* ---- apparitions (visitor only) ---- */
      for (const a of apparitions) {
        const age = now - a.born;
        if (!a.gone) {
          const d = dist(a, { x: me.x, y: me.y });
          if (a.kind === "phantom") {
            if (d < 2.6 || now > a.until) a.gone = true;
            if (age > 1800) { a.x -= Math.cos(a.yaw) * dt * 1.2; a.y -= Math.sin(a.yaw) * dt * 1.2; if (!canOccupy(a.x, a.y)) a.gone = true; }
          } else {
            // The shadow bolts when the torch finds it.
            tmp.set(wx(a.x) - camera.position.x, 1.2 - camera.position.y, wz(a.y) - camera.position.z).normalize();
            camera.getWorldDirection(forward);
            if ((light && forward.dot(tmp) > .985 && age > 700) || now > a.until) { a.gone = true; if (age < 2400) { p.audio.play("shadow", { volume: .6 }); trauma = Math.max(trauma, .35); } }
          }
        }
        a.fade += ((a.gone ? 0 : 1) - a.fade) * Math.min(1, dt * (a.gone ? 7 : 3));
        a.rig.root.visible = a.fade > .02;
        placeRig(a.rig, a.x, a.y, a.kind === "phantom" && age > 1800 ? a.yaw + Math.PI : a.yaw);
        const moving = a.kind === "phantom" && age > 1800 ? 1.2 : 0;
        animateRig(a.rig, t, moving, a.kind === "phantom" ? "human" : "creature", a.phase, dt);
        if (a.kind === "phantom" && age < 1800) { a.rig.armL.rotation.x = 2.6; a.rig.armL.rotation.z = Math.sin(t * 9) * .4 - .3; }
        for (const m of a.rig.materials) { (m as THREE.Material).transparent = true; (m as THREE.Material).opacity = a.fade; }
      }
      for (let i = apparitions.length - 1; i >= 0; i--) if (apparitions[i].gone && apparitions[i].fade < .02) { apparitions[i].rig.root.visible = false; apparitions.splice(i, 1); }

      /* ---- camera ---- */
      trauma = Math.max(0, trauma - dt * 1.1);
      const shake = trauma * trauma * (p.settings.reduced ? .3 : 1);
      const bobAmp = moving && !frozen ? (sprinting ? .045 : crouch ? .015 : .028) : 0;
      if (moving && !frozen) stepPhase += dt * (sprinting ? 11 : crouch ? 5.5 : 8);
      const eye = isMonster ? (g.self.disguised ? EYE : 2.18) : crouch ? EYE - .55 : EYE;
      if (carScene) {
        camera.position.set(car.position.x + (isMonster ? .36 : -.36), 1.2 + car.position.y + Math.sin(t * 23) * .004, car.position.z + .22);
      } else if (hidden) {
        const locker = level.lockers[g.self.hidden!];
        camera.position.copy(locker.inside);
        const dyaw = Math.atan2(Math.sin(yaw - locker.yaw), Math.cos(yaw - locker.yaw));
        yaw = locker.yaw + THREE.MathUtils.clamp(dyaw, -.42, .42);
        pitch = THREE.MathUtils.clamp(pitch, -.35, .3);
      } else {
        const targetY = eye + Math.sin(stepPhase * 2) * bobAmp;
        camera.position.x = wx(me.x); camera.position.z = wz(me.y);
        camera.position.y += (targetY - camera.position.y) * Math.min(1, dt * 12);
      }
      camera.rotation.set(pitch + (Math.random() - .5) * shake * .06, -yaw - Math.PI / 2 + (Math.random() - .5) * shake * .06, (Math.random() - .5) * shake * .04 + (moving && !frozen ? Math.sin(stepPhase) * bobAmp * .25 : 0));
      if (camera.fov !== p.settings.fov + (sprinting ? 6 : 0)) { camera.fov += (p.settings.fov + (sprinting ? 6 : 0) - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }
      camera.updateMatrixWorld();
      camera.getWorldDirection(forward);

      /* ---- own footsteps ---- */
      const stepNow = Math.floor(stepPhase / Math.PI);
      if (moving && !frozen && stepNow !== rivalStep) {
        rivalStep = stepNow;
        if (!(crouch && !isMonster)) p.audio.step(null, isMonster && !g.self.disguised, sprinting ? .9 : .5);
      }
      if (!monsterPose && !visitorPose) rivalStep = stepNow;

      /* ---- remote footsteps and noises ---- */
      const other = isMonster ? (g.rival ? friend : null) : (g.rival ? rival : null);
      if (other && other.speed > .6 && Math.floor(t * (other.speed > 2.4 ? 3.2 : 2.3)) !== Math.floor((t - dt) * (other.speed > 2.4 ? 3.2 : 2.3))) {
        p.audio.step(toWorld(other.x, other.y, 0), !isMonster && !g.rival?.disguised, .9);
      }
      if (g.noise && Math.floor(t * 2.2) !== Math.floor((t - dt) * 2.2)) p.audio.step(toWorld(g.noise.x, g.noise.y, 0), g.noise.heavy, .8);

      /* ---- torch ---- */
      const flickerTrick = g.flickerUntil > now;
      const battery = !isMonster ? (g.self.battery ?? 100) : 100;
      const monsterNear = !isMonster && g.rival && !g.rival.disguised ? dist(rival, me) : 99;
      const lowBattery = battery < 12;
      let flickerTarget = 1;
      if (flickerTrick) flickerTarget = Math.sin(t * 40) > .3 && (now - (g.flickerUntil - 4800)) < 1200 ? .6 : 0;
      else if (monsterNear < 7) flickerTarget = Math.random() < .25 + (7 - monsterNear) * .06 ? .1 : 1;
      else if (lowBattery) flickerTarget = Math.sin(t * 3) + Math.sin(t * 13) > 1.3 ? .15 : .75;
      torchFlicker += (flickerTarget - torchFlicker) * Math.min(1, dt * 30);
      const lightOn = !carScene && (!isMonster ? light && battery > 0 && !hidden : !!g.spectate?.light);
      const torchPower = (lightOn ? 1 : 0) * (isMonster ? 1 : torchFlicker) * (.55 + Math.min(1, battery / 40) * .45);
      if (!isMonster) {
        // Torch lags slightly behind the view for a hand-held feel.
        tmp.copy(camera.position).addScaledVector(forward, .25);
        tmp.y -= .18;
        torch.position.lerp(tmp, carScene ? 1 : Math.min(1, dt * 25));
        torchTarget.position.lerp(tmp.copy(camera.position).addScaledVector(forward, 8), Math.min(1, dt * 14));
      } else if (visitorPose) {
        const fp = g.spectate!;
        tmp.set(wx(visitorPose.x), (fp.crouch ? EYE - .55 : EYE) - .15, wz(visitorPose.y));
        torch.position.copy(tmp);
        const fdir = new THREE.Vector3(Math.cos(visitorPose.yaw) * Math.cos(friend.pitch), Math.sin(friend.pitch), Math.sin(visitorPose.yaw) * Math.cos(friend.pitch));
        torchTarget.position.copy(tmp).addScaledVector(fdir, 8);
      }
      torch.intensity = torchPower * 38;
      spill.position.copy(torch.position);
      spill.intensity = torchPower * .6;
      // The fake companion carries a torch of its own.
      companionTorch.intensity = 0;
      const phantom = apparitions.find(a => a.kind === "phantom" && a.fade > .1);
      if (!isMonster && showMonster && rivalInfo?.disguised && monsterPose) {
        companionTorch.position.set(wx(monsterPose.x), 1.3, wz(monsterPose.y));
        companionTarget.position.set(wx(monsterPose.x) + Math.cos(monsterPose.yaw) * 6, .6, wz(monsterPose.y) + Math.sin(monsterPose.yaw) * 6);
        companionTorch.intensity = 30;
      } else if (phantom) {
        const fy = phantom.yaw + (now - phantom.born > 1800 ? Math.PI : 0);
        companionTorch.position.set(wx(phantom.x), 1.3, wz(phantom.y));
        companionTarget.position.set(wx(phantom.x) + Math.cos(fy) * 6, .6, wz(phantom.y) + Math.sin(fy) * 6);
        companionTorch.intensity = 22 * phantom.fade;
      }
      // Visible beams for torches seen from outside.
      aimBeam(beams.companion, companionTorch.position, companionTarget.position, !isMonster && showMonster && !!rivalInfo?.disguised ? .9 : 0);
      aimBeam(beams.phantom, companionTorch.position, companionTarget.position, phantom ? phantom.fade * .9 : 0);
      aimBeam(beams.visitor, torch.position, torchTarget.position, isMonster && !!g.rival && !carScene ? torchPower : 0, 8, .5);
      headlights.intensity = g.phase === "intro" ? 55 : 0;
      headlights.position.set(car.position.x, .75, car.position.z - 2.1);
      headTarget.position.set(car.position.x, 0, car.position.z - 16);

      /* ---- level ---- */
      bodies.length = 0;
      bodies.push(new THREE.Vector3(wx(me.x), 0, wz(me.y)));
      if (monsterPose && !isMonster) bodies.push(new THREE.Vector3(wx(monsterPose.x), 0, wz(monsterPose.y)));
      if (visitorPose && isMonster) bodies.push(new THREE.Vector3(wx(visitorPose.x), 0, wz(visitorPose.y)));
      if (phantom) bodies.push(new THREE.Vector3(wx(phantom.x), 0, wz(phantom.y)));
      const exitOpen = g.phase === "intro" || (g.phase === "ended" && g.winner === "player");
      level.update(dt, { time: t, now, power: g.power || dbg.power, lightsUntil: g.lightsUntil, focus: camera.position, bodies, intro: g.phase === "intro", exitOpen, lockUntil: g.lockUntil });
      // From inside a locker you look through its slats, not at the back of the door.
      level.lockers.forEach((l, i) => { l.door.visible = !(hidden && g.self.hidden === i); });
      candleClock -= dt;
      for (let i = 0; i < level.clues.length; i++) {
        const c = g.clues[i], model = level.clues[i];
        model.group.visible = !!c && !c.found && c.x !== null && c.y !== null;
        if (!model.group.visible) continue;
        model.group.position.set(wx(c.x!), 0, wz(c.y!));
        // Candles crackle softly, so a clue can be found by ear in the dark.
        if (!isMonster && candleClock <= 0 && model.group.position.distanceTo(camera.position) < 7) { p.audio.play("candle", { pos: model.group.position.clone().setY(.75) }); candleClock = 1.4; }
      }
      level.batteries.forEach((b, i) => {
        const spot = g.batteries[i];
        b.visible = !!spot;
        if (spot) { b.position.set(wx(spot.x), .02, wz(spot.y)); b.rotation.y = t * .6; }
      });
      // Doors creak while they are actually swinging near you.
      creakClock -= dt;
      if (creakClock <= 0) for (const d of level.doors) {
        if (Math.abs(d.vel) < 1.1 || d.slamUntil > now) continue;
        const dd = Math.hypot(d.group.position.x - camera.position.x, d.group.position.z - camera.position.z);
        if (dd < 7) { p.audio.play("creak", { pos: d.group.position.clone().setY(1.5), volume: .55 }); creakClock = 1.6; break; }
      }

      /* ---- audio mood ---- */
      tmp.copy(camera.position);
      p.audio.setListener(tmp, forward);
      const inside = me.y < 28.6;
      const hunting = isMonster && g.phase === "playing" && !g.self.disguised && !!g.rival && dist(me, g.rival) < 10;
      const chase = hunting || (!isMonster && g.phase === "playing" && !!g.rival && !g.rival.disguised && monsterNear < 12);
      const heard = !isMonster && g.noise?.heavy ? dist(g.noise, me) : 99;
      const threat = Math.min(monsterNear, heard);
      if (chase && monsterNear < 10 && now - lastStinger > 25_000 && lineOfSight(me, rival)) { p.audio.play("stinger"); lastStinger = now; trauma = Math.max(trauma, .4); }
      if (!isMonster && g.rival && !g.rival.disguised && monsterNear < 9 && now - lastGrowl > 5000 + Math.random() * 4000) { lastGrowl = now; p.audio.play("growl", { pos: toWorld(rival.x, rival.y, 1.9) }); }
      let buzz: THREE.Vector3 | null = null, buzzLevel = 0, bestBuzz = 36;
      for (const f of level.fixtures) {
        if (f.emergency || f.level < .05) continue;
        const d2 = f.pos.distanceToSquared(camera.position);
        if (d2 < bestBuzz) { bestBuzz = d2; buzz = f.pos; buzzLevel = f.level * (f.pre === "flicker" || f.post === "flicker" ? 1 : .35); }
      }
      p.audio.setMood({
        inside: inside || g.phase === "playing",
        tension: isMonster ? .2 : Math.max(0, 1 - threat / 14) + (lowBattery ? .2 : 0),
        chase, heart: isMonster ? 0 : threat < 11 ? 1 - threat / 11 : hidden ? .25 : 0,
        powered: g.power && g.phase === "playing", car: carScene ? 1 - Math.min(1, introElapsed / 4300) * .5 : 0,
        hidden, monster: isMonster, buzz, buzzLevel,
      });
      p.audio.update();

      /* ---- scripted first-visit scares (visitor) ---- */
      if (!isMonster && g.phase === "playing" && !hidden) {
        const room = roomAt(me.x, me.y);
        if (room && room.zone !== "corridor" && !visited.has(room.id)) {
          visited.add(room.id);
          if (Math.random() < .5) {
            const at = now + 1500 + Math.random() * 2500;
            const near = (dx: number, dy: number) => toWorld(me.x + dx, me.y + dy, 1.3);
            const a = p.audio;
            const run: Record<string, () => void> = {
              isolation: () => { const d = level.slamNear(17, 11, serverNow()); if (d) { a.play("doorSlam", { pos: toWorld(17, 11, 1.4) }); trauma = Math.max(trauma, .5); } a.play("whisper", { pos: near(0, 1) }); },
              morgue: () => { a.play("search", { pos: toWorld(4 + Math.random() * 6, 1.6, 1.2) }); },
              security: () => { a.play("phone", { pos: toWorld(33, 3, 1) }); },
              hydro: () => { a.play("knock", { pos: near(3, 0) }); a.play("breath", { pos: near(0, -1), volume: .6 }); },
              ward: () => { a.play("breath", { pos: near(-1, 0), volume: .7 }); },
              archive: () => { a.play("footsteps", { pos: near(0, 1), from: near(0, 5) }); },
              canteen: () => { a.play("laugh", { pos: near(4, 1), volume: .7 }); },
              treatment: () => { a.play("flicker"); a.play("growl", { pos: near(-4, 0), volume: .35 }); },
              pharmacy: () => { a.play("knock", { pos: near(0, -2) }); },
              lobby: () => {},
            };
            pendingScares.push({ at, run: run[room.id] ?? run[room.zone] ?? (() => {}) });
          }
        }
      }
      for (let i = pendingScares.length - 1; i >= 0; i--) if (now >= pendingScares[i].at) { pendingScares[i].run(); pendingScares.splice(i, 1); }
      // Out of breath after sprinting.
      pantClock -= dt;
      if (!isMonster && stamina < .3 && pantClock <= 0 && g.phase === "playing") { p.audio.play("pant", { volume: .5 + (.3 - stamina) }); pantClock = .9; }

      /* ---- fog / vision ---- */
      const outsideView = camera.position.z > 28.6 * CELL + CELL / 2 && g.phase === "intro";
      const blackout = g.lightsUntil.some(v => v > now);
      const visitorFog = outsideView ? .022 : blackout ? .085 : .058;
      level.moon.intensity = outsideView ? .9 : g.phase === "intro" ? .15 : 0;

      /* ---- post ---- */
      flash = Math.max(0, flash - dt * 1.6);
      blackoutFade = Math.max(0, blackoutFade - dt * .45);
      const lives = !isMonster ? (g.self.lives ?? 3) : 3;
      const glitching = !isMonster && now < glitchUntil;
      const reduced = p.settings.reduced;
      Object.assign(post0, defaultPost());
      post0.grain = reduced ? .03 : .075;
      post0.flash = Math.min(1.5, flash);
      const panic = isMonster ? 0 : threat < 11 ? 1 - threat / 11 : 0;
      const pulse = panic * (.5 + .5 * Math.sin(t * (6 + panic * 8)));
      post0.aberration = .3 + trauma * 2.5 + pulse * .8;
      post0.vignette = .75 + panic * .15 + pulse * .06;
      post0.desaturate = .2 + (3 - lives) * .12;
      post0.blood = lives < 3 ? (3 - lives) * .28 + Math.sin(t * 2.4) * .05 : 0;
      post0.glitch = glitching ? 1 : 0;
      post0.blackout = Math.max(blackoutFade, (g.self.stunnedUntil ?? 0) > now ? .85 : 0);
      // Eyes adjust to the dark inside a locker.
      if (hidden) { post0.exposure = 2.6; post0.grain = .12; post0.vignette = .9; }
      if (isMonster) {
        post0.tint.copy(g.self.disguised ? neutral.clone().set(.95, .7, .6) : red);
        post0.tintMix = g.self.disguised ? .35 : .6;
        post0.desaturate = .3; post0.vignette = .95; post0.grain = .09; post0.blood = 0;
        post0.exposure = (g.self.stunnedUntil ?? 0) > now ? 2.2 : 1;
      }

      /* ---- adaptive resolution ---- */
      adaptClock += dt;
      if (adaptClock > 2) {
        adaptClock = 0;
        if (frameAvg > 24 && renderScale > .45) renderScale = Math.max(.45, renderScale - .08);
        else if (frameAvg < 14 && renderScale < maxScale) renderScale = Math.min(maxScale, renderScale + .05);
      }

      /* ---- local HUD ---- */
      if (time - lastLocal > 100) {
        lastLocal = time;
        p.onLocal({ stamina, crouch, light: lightOn, sprinting, holdProgress: 0, holdLabel: "" });
      }

      if (glitching && !reduced) return; // frozen frame: nothing redrawn

      /* ---- draw: main view ---- */
      const bufW = renderer.domElement.width, bufH = renderer.domElement.height;
      const rw = bufW * renderScale, rh = bufH * renderScale;
      if (isMonster) {
        // Night vision: the creature sees the building without light.
        level.hemi.intensity = 1.25; level.hemi.color.set(0xd8c8c0); level.hemi.groundColor.set(0x40302a);
        fog.color.set(0x0c0404); fog.density = .03;
      } else {
        level.hemi.intensity = outsideView ? .32 : hidden ? .16 : .07; level.hemi.color.set(0x8fa3b0); level.hemi.groundColor.set(0x1a1712);
        fog.color.set(outsideView ? 0x0e161b : 0x050807); fog.density = visitorFog;
      }
      dustMat.uniforms.center.value.copy(camera.position);
      dustMat.uniforms.time.value = t;
      dustMat.uniforms.lightPos.value.copy(torch.position);
      dustMat.uniforms.lightDir.value.copy(torchTarget.position).sub(torch.position).normalize();
      dustMat.uniforms.strength.value = torchPower;
      const rt = post.begin(renderer, "main", rw, rh);
      renderer.shadowMap.needsUpdate = true;
      renderer.render(scene, camera);
      // View models
      const showTorch = !isMonster && !hidden && !carScene && g.phase !== "ended";
      const showClaws = isMonster && !g.self.disguised && !carScene;
      const showHand = isMonster && !!g.self.disguised && !carScene && g.phase === "playing";
      vmTorch.visible = (showTorch || showHand) && !jumpscare;
      vmClaws.visible = showClaws;
      if (vmTorch.visible || vmClaws.visible) {
        const sway = Math.sin(stepPhase) * bobAmp;
        vmTorch.position.set(.17 + sway * .35, -.17 + Math.abs(Math.cos(stepPhase)) * bobAmp * .5 - (sprinting ? .05 : 0), -.34);
        vmTorch.rotation.set(.04 + (sprinting ? .3 : 0), .05, 0);
        ((vmTorch.userData.glass as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setScalar(isMonster ? .3 : .3 + torchPower * 1.6);
        vmLight.intensity = isMonster ? .1 : .12 + torchPower * .25; vmLight.position.set(.1, -.02, -.5);
        vmClaws.children.forEach((arm, i) => {
          const side = arm.userData.side as number;
          arm.position.y = -.27 + Math.sin(t * 1.7 + i) * .012 + Math.abs(Math.sin(stepPhase + i * Math.PI)) * bobAmp;
          arm.rotation.x = .12 + Math.sin(t * 2.3 + i) * .03 + (revealing ? Math.sin(t * 40) * .1 : 0);
          arm.rotation.z = side * (.18 + Math.sin(t * .9 + i) * .03);
        });
        renderer.clearDepth();
        renderer.render(vmScene, vmCamera);
      }
      mainViewport.set(0, 0, width, height);
      post.composite(renderer, rt, mainViewport, post0, t);

      /* ---- draw: the friend's eyes ---- */
      const frame = p.pipRef.current;
      if (isMonster && g.spectate && g.phase !== "waiting" && frame && visitorPose) {
        // Viewport in CSS pixels, origin bottom-left, matching the HUD frame.
        const cr = canvas.getBoundingClientRect(), fr = frame.getBoundingClientRect();
        const pw = Math.round(fr.width), ph = Math.round(fr.height);
        const px = Math.round(fr.left - cr.left), py = Math.round(cr.height - (fr.bottom - cr.top));
        const dpr = renderer.getPixelRatio();
        if (pw > 20 && ph > 20) {
          const fs = g.spectate;
          if (carScene) friendCamera.position.set(car.position.x - .36, 1.2, car.position.z + .22);
          else if (fs.hidden >= 0) friendCamera.position.copy(level.lockers[fs.hidden].inside);
          else friendCamera.position.set(wx(visitorPose.x), fs.crouch ? EYE - .55 : EYE, wz(visitorPose.y));
          friendCamera.rotation.set(friend.pitch, -visitorPose.yaw - Math.PI / 2, 0);
          friendCamera.aspect = pw / ph; friendCamera.updateProjectionMatrix();
          friendCamera.updateMatrixWorld();
          // Draw the creature as the friend sees it, and use their lighting.
          const vis = visitor.root.visible;
          visitor.root.visible = false;
          monsterRoot.visible = carScene || !!g.rival;
          if (carScene) {
            monsterRoot.position.set(car.position.x + .36, car.position.y + .34, car.position.z + .12);
            monsterRoot.rotation.y = 0;
            creature.root.visible = false; disguise.root.visible = true;
            sit(disguise);
          } else if (monsterRoot.visible) {
            monsterRoot.position.set(wx(me.x), 0, wz(me.y));
            monsterRoot.rotation.y = -yaw - Math.PI / 2;
            creature.root.visible = !g.self.disguised; disguise.root.visible = !!g.self.disguised;
            if (g.self.disguised) animateRig(disguise, t, Math.hypot(me.vx, me.vy), "human", monsterPhase, 0);
            else animateRig(creature, t, Math.hypot(me.vx, me.vy), (g.self.stunnedUntil ?? 0) > now ? "stunned" : "creature", monsterPhase, 0);
          }
          level.hemi.intensity = .07; level.hemi.color.set(0x8fa3b0); level.hemi.groundColor.set(0x1a1712);
          fog.color.set(0x050807); fog.density = carScene ? .022 : .058;
          const prevDust = dustMat.uniforms.center.value.clone();
          dustMat.uniforms.center.value.copy(friendCamera.position);
          const prt = post.begin(renderer, "pip", pw * dpr * .8, ph * dpr * .8);
          const hiddenDoor = fs.hidden >= 0 ? level.lockers[fs.hidden].door : null;
          if (hiddenDoor) hiddenDoor.visible = false;
          const beamWas = beams.visitor.visible;
          beams.visitor.visible = false;
          renderer.render(scene, friendCamera);
          beams.visitor.visible = beamWas;
          if (hiddenDoor) hiddenDoor.visible = true;
          Object.assign(postPip, defaultPost());
          postPip.flash = g.events.some(e => e.type === "flare" && now - e.at < 600) ? .8 : 0;
          postPip.glitch = g.events.some(e => e.type === "glitch" && e.until > now) ? 1 : 0;
          postPip.blood = (3 - (g.friend?.lives ?? 3)) * .25;
          postPip.vignette = .6;
          pipViewport.set(px, py, pw, ph);
          post.composite(renderer, prt, pipViewport, postPip, t);
          dustMat.uniforms.center.value.copy(prevDust);
          visitor.root.visible = vis;
          monsterRoot.visible = false;
        }
      }
    };
    renderer.setAnimationLoop(render);
    (window as unknown as { __hospital?: unknown }).__hospital = { camera, scene, renderer, level, me, torch, post0, dbg, monsterRoot, creature, rival, audio: propsRef.current.audio, step: render, face: (y: number, p = 0) => { yaw = y; pitch = p; } };

    return () => {
      renderer.setAnimationLoop(null);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("contextmenu", contextMenu);
      canvas.removeEventListener("touchstart", touchStart);
      canvas.removeEventListener("touchmove", touchMove);
      canvas.removeEventListener("touchend", touchEnd);
      document.removeEventListener("mousemove", mouseMove);
      document.removeEventListener("pointerlockchange", pointerLockChange);
      document.removeEventListener("pointerup", pointerUp);
      document.removeEventListener("pointercancel", clearInput);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", clearInput);
      observer.disconnect();
      level.dispose();
      post.dispose();
      dustGeo.dispose(); dustMat.dispose(); dustTex.dispose();
      beamGeo.dispose(); beamMat.dispose(); Object.values(beams).forEach(b => (b.material as THREE.Material).dispose());
      scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh) { m.geometry?.dispose(); } });
      renderer.dispose();
      captureRef.current = () => {};
    };
  }, [quality]);

  return <>
    <canvas ref={canvasRef} className="hospital-canvas" aria-label="Трёхмерная больница, свободное движение" />
    {unavailable && <div className="hospital-webgl-error" role="status">Для игры нужен браузер с WebGL2.</div>}
    {dragLook && props.active && !unavailable && <div className="hospital-drag-tip" role="status"><span>Браузер отклонил захват мыши — смотрите, зажав кнопку мыши.</span><button onClick={() => captureRef.current()}>Повторить захват</button><button onClick={props.onCopyForChrome}>Ссылка для Chrome</button></div>}
  </>;
}

/** Seated pose for the drive in. */
function sit(rig: Rig) {
  rig.legL.rotation.x = rig.legR.rotation.x = 1.45;
  rig.shinL.rotation.x = rig.shinR.rotation.x = -1.35;
  rig.body.position.y = -.42;
  rig.armL.rotation.x = .9; rig.foreL.rotation.x = .4;
  rig.armR.rotation.x = .9;
  rig.chest.rotation.x = .08;
  rig.head.rotation.y = Math.sin(performance.now() / 1400) * .35;
}

