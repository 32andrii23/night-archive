"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { CELL, EYE_HEIGHT, createWorld } from "./three-world";
import type { GameView } from "./game-types";

export type MotionInput = { forward: number; strafe: number; yaw: number; pitch: number };

type Props = {
  game: GameView;
  active: boolean;
  reduced: boolean;
  pipLarge: boolean;
  onInput: (input: MotionInput) => void;
  onCopyForChrome: () => void;
};

const MAX_PITCH = Math.PI / 2 - .04;
const BODY_RADIUS = .23;

function walkable(map: string[], x: number, y: number) {
  for (const ox of [-BODY_RADIUS, BODY_RADIUS]) for (const oy of [-BODY_RADIUS, BODY_RADIUS]) {
    if (map[Math.floor(y + oy + .5)]?.[Math.floor(x + ox + .5)] !== ".") return false;
  }
  return true;
}

export default function ThreeFirstPerson({ game, active, reduced, pipLarge, onInput, onCopyForChrome }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef(game);
  const activeRef = useRef(active);
  const reducedRef = useRef(reduced);
  const pipLargeRef = useRef(pipLarge);
  const inputRef = useRef(onInput);
  const captureRef = useRef<() => void>(() => {});
  const [unavailable, setUnavailable] = useState(false);
  const [dragLook, setDragLook] = useState(false);

  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => { activeRef.current = active; if (!active && document.pointerLockElement === canvasRef.current) document.exitPointerLock(); }, [active]);
  useEffect(() => { reducedRef.current = reduced; }, [reduced]);
  useEffect(() => { pipLargeRef.current = pipLarge; }, [pipLarge]);
  useEffect(() => { inputRef.current = onInput; }, [onInput]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    } catch {
      queueMicrotask(() => setUnavailable(true));
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x10191a);
    const camera = new THREE.PerspectiveCamera(76, 1, .045, 82);
    camera.rotation.order = "YXZ";
    const friendCamera = new THREE.PerspectiveCamera(76, 1, .045, 82);
    friendCamera.rotation.order = "YXZ";
    const world = createWorld(gameRef.current);
    const carStopZ = world.arrivalCar.position.z;
    const target = new THREE.Vector3();
    const facing = new THREE.Vector3();
    const friendPosition = new THREE.Vector3();
    const visual = { x: gameRef.current.self.x, y: gameRef.current.self.y };
    let yaw = gameRef.current.self.yaw ?? -Math.PI / 2;
    let pitch = gameRef.current.self.pitch ?? 0;
    let dragFallback = false;
    let dragging = false;
    let dragX = 0;
    let dragY = 0;
    let forwardMouse = false;
    let backwardMouse = false;
    const keys = new Set<string>();
    const look = (dx: number, dy: number, factor = .0024) => {
      yaw += dx * factor;
      pitch = THREE.MathUtils.clamp(pitch - dy * factor, -MAX_PITCH, MAX_PITCH);
    };

    const requestCapture = () => {
      if (!activeRef.current || document.pointerLockElement === canvas) return;
      try {
        if (!canvas.requestPointerLock) throw new Error("Pointer lock unavailable");
        void Promise.resolve(canvas.requestPointerLock()).catch((error: unknown) => {
          console.warn("Pointer lock request failed", error);
          dragFallback = true;
          setDragLook(true);
        });
      } catch (error) {
        console.warn("Pointer lock request failed", error);
        dragFallback = true;
        setDragLook(true);
      }
    };
    captureRef.current = requestCapture;
    const pointerDown = (event: PointerEvent) => {
      if (!activeRef.current || event.pointerType === "touch") return;
      if (event.button === 0) forwardMouse = true;
      if (event.button === 2) backwardMouse = true;
      dragging = true; dragX = event.clientX; dragY = event.clientY;
      requestCapture();
    };
    const pointerLockChange = () => {
      if (document.pointerLockElement !== canvas) return;
      dragFallback = false;
      dragging = false;
      forwardMouse = false;
      backwardMouse = false;
      setDragLook(false);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!activeRef.current || !dragFallback || !dragging || event.pointerType === "touch") return;
      look(event.clientX - dragX, event.clientY - dragY, .004);
      dragX = event.clientX; dragY = event.clientY;
    };
    const mouseMove = (event: MouseEvent) => {
      if (activeRef.current && document.pointerLockElement === canvas) look(event.movementX, event.movementY);
    };
    const pointerUp = (event: PointerEvent) => {
      if (event.button === 0) forwardMouse = false;
      if (event.button === 2) backwardMouse = false;
      dragging = false;
    };
    const clearInput = () => { keys.clear(); forwardMouse = false; backwardMouse = false; dragging = false; };
    const keyDown = (event: KeyboardEvent) => {
      if (!activeRef.current || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        event.preventDefault(); keys.add(key);
      }
    };
    const keyUp = (event: KeyboardEvent) => { keys.delete(event.key.toLowerCase()); };
    const contextMenu = (event: MouseEvent) => event.preventDefault();
    let touchX = 0, touchY = 0, touching = false;
    const touchStart = (event: TouchEvent) => {
      if (!activeRef.current || !event.touches.length) return;
      touching = true; touchX = event.touches[0].clientX; touchY = event.touches[0].clientY;
    };
    const touchMove = (event: TouchEvent) => {
      if (!activeRef.current || !touching || !event.touches.length) return;
      event.preventDefault();
      look(event.touches[0].clientX - touchX, event.touches[0].clientY - touchY, .004);
      touchX = event.touches[0].clientX; touchY = event.touches[0].clientY;
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

    let lastYaw = yaw, lastPitch = pitch;
    const inputTimer = window.setInterval(() => {
      const g = gameRef.current;
      const canMove = g.phase === "playing" || (g.phase === "intro" && Date.now() - g.startedAt > 5_000);
      if (!activeRef.current || !canMove) return;
      const forward = Number(keys.has("w") || keys.has("arrowup") || forwardMouse) - Number(keys.has("s") || keys.has("arrowdown") || backwardMouse);
      const strafe = Number(keys.has("d") || keys.has("arrowright")) - Number(keys.has("a") || keys.has("arrowleft"));
      if (!forward && !strafe && Math.abs(yaw - lastYaw) < .018 && Math.abs(pitch - lastPitch) < .018) return;
      lastYaw = yaw; lastPitch = pitch;
      inputRef.current({ forward, strafe, yaw, pitch });
    }, 125);

    let width = 1, height = 1;
    const resize = () => {
      width = Math.max(1, Math.floor(canvas.clientWidth));
      height = Math.max(1, Math.floor(canvas.clientHeight));
      const ratio = Math.min(window.devicePixelRatio || 1, 1.35, Math.sqrt(1_250_000 / (width * height)));
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    let lastFrame = 0;
    let previousFrame = 0;
    let lastWorldView: GameView | null = null;
    let wasCarScene = false;
    const render = (time: number) => {
      if (document.hidden) return;
      const g = gameRef.current;
      const fps = g.phase === "waiting" || g.phase === "ended" ? 12 : reducedRef.current ? 30 : 60;
      if (time - lastFrame < 1000 / fps) return;
      const dt = previousFrame ? Math.min(.05, (time - previousFrame) / 1000) : 1 / fps;
      lastFrame = previousFrame = time;
      if (lastWorldView !== g) { world.update(g); lastWorldView = g; }
      const introTime = Math.max(0, Date.now() - g.startedAt);
      const carScene = g.phase === "intro" && introTime < 5_000;
      if (carScene) {
        const progress = Math.min(1, introTime / 4_000);
        const easing = progress * progress * (3 - 2 * progress);
        world.arrivalCar.position.z = carStopZ + (1 - easing) * 8;
        world.visitorAvatar.position.set(world.arrivalCar.position.x - .34, 0, world.arrivalCar.position.z - .12);
        world.monsterAvatar.position.set(world.arrivalCar.position.x + .34, 0, world.arrivalCar.position.z - .12);
      } else if (wasCarScene) {
        world.arrivalCar.position.z = carStopZ;
        world.update(g);
      }
      wasCarScene = carScene;
      const introWalking = g.phase === "intro" && Date.now() - g.startedAt > 5_000;
      const canMove = activeRef.current && (g.phase === "playing" || introWalking);
      let f = 0, s = 0;
      if (canMove) {
        f = Number(keys.has("w") || keys.has("arrowup") || forwardMouse) - Number(keys.has("s") || keys.has("arrowdown") || backwardMouse);
        s = Number(keys.has("d") || keys.has("arrowright")) - Number(keys.has("a") || keys.has("arrowleft"));
        const magnitude = Math.hypot(f, s) || 1;
        f /= magnitude; s /= magnitude;
        const speed = g.side === "monster" ? 1.95 : 1.8;
        const dx = (Math.cos(yaw) * f - Math.sin(yaw) * s) * speed * dt;
        const dy = (Math.sin(yaw) * f + Math.cos(yaw) * s) * speed * dt;
        if (walkable(g.map, visual.x + dx, visual.y)) visual.x += dx;
        if (walkable(g.map, visual.x, visual.y + dy)) visual.y += dy;
      }
      const drift = Math.hypot(visual.x - g.self.x, visual.y - g.self.y);
      if (drift > 1.0) { visual.x = g.self.x; visual.y = g.self.y; }
      else if (!f && !s) {
        const blend = 1 - Math.exp(-dt * 9);
        visual.x += (g.self.x - visual.x) * blend;
        visual.y += (g.self.y - visual.y) * blend;
      } else if (drift > .48) {
        visual.x += (g.self.x - visual.x) * .07;
        visual.y += (g.self.y - visual.y) * .07;
      }
      target.set((visual.x + .5) * CELL, EYE_HEIGHT, (visual.y + .5) * CELL);
      if (carScene) target.set(world.arrivalCar.position.x + (g.side === "player" ? -.34 : .34), 1.2 + Math.sin(time * .012) * .012, world.arrivalCar.position.z + .12);
      else target.y += !reducedRef.current && (f || s) ? Math.sin(time * .014) * .025 : 0;
      camera.position.copy(target);
      camera.rotation.set(pitch, -yaw - Math.PI / 2, 0, "YXZ");
      world.torch.position.copy(camera.position);
      facing.set(0, 0, -1).applyQuaternion(camera.quaternion);
      world.torchTarget.position.copy(camera.position).addScaledVector(facing, 6);
      world.monsterAvatar.visible = g.side === "player" && !!g.rival;
      world.visitorAvatar.visible = g.side === "monster" && !!g.rival;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, width, height);
      renderer.render(world.scene, camera);

      if (g.side === "monster" && g.spectate && g.phase !== "waiting") {
        const margin = Math.max(14, Math.round(width * .018));
        const mobile = width <= 800;
        const pipWidth = Math.min(Math.round(width * (pipLargeRef.current ? mobile ? .67 : .46 : mobile ? .4 : .27)), pipLargeRef.current ? mobile ? 450 : 680 : mobile ? 260 : 390);
        const pipHeight = Math.round(pipWidth * .62);
        const px = width - pipWidth - margin;
        const py = Math.max(8, height - pipHeight - margin - 62);
        friendCamera.aspect = pipWidth / pipHeight;
        friendCamera.updateProjectionMatrix();
        if (carScene) friendPosition.set(world.arrivalCar.position.x - .34, 1.2 + Math.sin(time * .012) * .012, world.arrivalCar.position.z + .12);
        else friendPosition.set((g.spectate.x + .5) * CELL, EYE_HEIGHT, (g.spectate.y + .5) * CELL);
        if (friendCamera.position.distanceTo(friendPosition) > 12) friendCamera.position.copy(friendPosition);
        else friendCamera.position.lerp(friendPosition, 1 - Math.exp(-dt * 9));
        friendCamera.rotation.set(g.spectate.pitch ?? 0, -(g.spectate.yaw ?? -Math.PI / 2) - Math.PI / 2, 0, "YXZ");
        world.torch.position.copy(friendCamera.position);
        facing.set(0, 0, -1).applyQuaternion(friendCamera.quaternion);
        world.torchTarget.position.copy(friendCamera.position).addScaledVector(facing, 6);
        world.monsterAvatar.visible = true;
        world.visitorAvatar.visible = false;
        renderer.setScissorTest(true);
        renderer.setScissor(px, py, pipWidth, pipHeight);
        renderer.setViewport(px, py, pipWidth, pipHeight);
        renderer.render(world.scene, friendCamera);
        renderer.setScissorTest(false);
      }
    };
    renderer.setAnimationLoop(render);

    return () => {
      renderer.setAnimationLoop(null);
      window.clearInterval(inputTimer);
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
      world.dispose();
      renderer.dispose();
      captureRef.current = () => {};
    };
  }, []);

  return <>
    <canvas ref={canvasRef} className="hospital-canvas" aria-label="Трёхмерная больница, свободное движение" />
    {unavailable && <div className="hospital-webgl-error" role="status">Для игры нужен браузер с WebGL2.</div>}
    {dragLook && active && !unavailable && <div className="hospital-drag-tip" role="status"><span>Браузер отклонил захват мыши.</span><button onClick={() => captureRef.current()}>Повторить захват</button><button onClick={onCopyForChrome}>Ссылка для Chrome</button></div>}
  </>;
}
