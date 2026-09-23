"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { createWorld, positionFor, type WorldGame } from "./three-world";

type FirstPersonGame = WorldGame & { phase: "waiting" | "playing" | "ended" };

export default function ThreeFirstPerson({ game, yaw, reduced, onTravel, enabled }: {
  game: FirstPersonGame;
  yaw: React.MutableRefObject<number>;
  reduced: boolean;
  onTravel: (offset: number) => void;
  enabled: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef(game);
  const travelRef = useRef(onTravel);
  const enabledRef = useRef(enabled);
  const reducedRef = useRef(reduced);
  const controlsRef = useRef<PointerLockControls | null>(null);
  const worldRef = useRef<ReturnType<typeof createWorld> | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [dragLook, setDragLook] = useState(false);

  useEffect(() => { gameRef.current = game; worldRef.current?.update(game); }, [game]);
  useEffect(() => { travelRef.current = onTravel; }, [onTravel]);
  useEffect(() => { enabledRef.current = enabled; if (!enabled) controlsRef.current?.unlock(); }, [enabled]);
  useEffect(() => { reducedRef.current = reduced; }, [reduced]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
    } catch {
      queueMicrotask(() => setUnavailable(true));
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const camera = new THREE.PerspectiveCamera(74, 1, .05, 65);
    camera.rotation.order = "YXZ";
    camera.rotation.y = -yaw.current - Math.PI / 2;
    camera.position.copy(positionFor(gameRef.current.self));
    const controls = new PointerLockControls(camera, canvas);
    controls.pointerSpeed = .78;
    controls.minPolarAngle = Math.PI / 2 - .72;
    controls.maxPolarAngle = Math.PI / 2 + .72;
    controlsRef.current = controls;
    const world = createWorld(gameRef.current);
    worldRef.current = world;

    const direction = new THREE.Vector3();
    const onLook = () => {
      controls.getDirection(direction);
      yaw.current = Math.atan2(direction.z, direction.x);
    };
    controls.addEventListener("change", onLook);

    let lastFrame = 0;
    let previousFrame = 0;
    const render = (time: number) => {
      if (document.hidden) return;
      const fps = gameRef.current.phase === "playing" ? reducedRef.current ? 30 : 45 : 12;
      if (time - lastFrame < 1000 / fps) return;
      const dt = previousFrame ? Math.min(.08, (time - previousFrame) / 1000) : 1 / fps;
      lastFrame = previousFrame = time;
      camera.rotation.y = -yaw.current - Math.PI / 2;
      const target = positionFor(gameRef.current.self);
      camera.position.lerp(target, 1 - Math.exp(-dt * 12));
      if (!reducedRef.current && gameRef.current.phase === "playing") {
        const displacement = camera.position.distanceTo(target);
        camera.position.y += Math.min(.018, displacement * .009) * Math.sin(time * .012);
      }
      world.torch.position.copy(camera.position);
      direction.set(0, 0, -1).applyQuaternion(camera.quaternion);
      world.torchTarget.position.copy(camera.position).addScaledVector(direction, 6);
      if (world.monster.visible && !reducedRef.current) world.monster.rotation.z = Math.sin(time * .0025) * .025;
      renderer.render(world.scene, camera);
    };
    renderer.setAnimationLoop(render);

    const resize = () => {
      const width = Math.max(1, Math.floor(canvas.clientWidth));
      const height = Math.max(1, Math.floor(canvas.clientHeight));
      const ratio = Math.min(window.devicePixelRatio || 1, 1.35, Math.sqrt(1_100_000 / (width * height)));
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    let hold: -1 | 0 | 1 = 0;
    let walkTimer = 0;
    let dragging = false;
    let freeLook = false;
    let pointerX = 0;
    let pointerY = 0;
    const stopWalk = () => { hold = 0; if (walkTimer) window.clearInterval(walkTimer); walkTimer = 0; };
    const step = () => {
      if (!hold || !(controls.isLocked || freeLook) || !enabledRef.current || gameRef.current.self.hidden) return;
      travelRef.current(hold === 1 ? 0 : Math.PI);
    };
    const startWalk = (value: -1 | 1) => {
      stopWalk();
      hold = value;
      step();
      walkTimer = window.setInterval(step, 315);
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch" || !enabledRef.current) return;
      if (event.button !== 0 && event.button !== 2) return;
      dragging = true;
      pointerX = event.clientX;
      pointerY = event.clientY;
      const travel = event.button === 0 ? 1 : -1;
      if (controls.isLocked || freeLook) { startWalk(travel); return; }
      if (!canvas.requestPointerLock) {
        freeLook = true;
        setDragLook(true);
        startWalk(travel);
        return;
      }
      // Some embedded browsers reject pointer lock. Handle that promise so the
      // game keeps working with drag look and held mouse buttons.
      void canvas.requestPointerLock().then(() => {
        if (dragging) startWalk(travel);
      }).catch(() => {
        freeLook = true;
        setDragLook(true);
        if (dragging) startWalk(travel);
      });
    };
    const pointerMove = (event: PointerEvent) => {
      if (!freeLook || !dragging || event.pointerType === "touch" || !enabledRef.current) return;
      yaw.current += (event.clientX - pointerX) * .004;
      camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - (event.clientY - pointerY) * .003, -.72, .72);
      pointerX = event.clientX;
      pointerY = event.clientY;
    };
    const pointerUp = () => { dragging = false; stopWalk(); };
    const contextMenu = (event: MouseEvent) => event.preventDefault();
    const blur = () => pointerUp();
    const unlock = () => pointerUp();
    controls.addEventListener("unlock", unlock);
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("contextmenu", contextMenu);
    document.addEventListener("pointerup", pointerUp);
    document.addEventListener("pointercancel", pointerUp);
    window.addEventListener("blur", blur);

    let touchX = 0, touchY = 0, touching = false;
    const touchStart = (event: TouchEvent) => {
      if (!event.touches.length || !enabledRef.current) return;
      touching = true;
      touchX = event.touches[0].clientX;
      touchY = event.touches[0].clientY;
    };
    const touchMove = (event: TouchEvent) => {
      if (!touching || !event.touches.length || !enabledRef.current) return;
      event.preventDefault();
      const touch = event.touches[0];
      yaw.current += (touch.clientX - touchX) * .004;
      camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - (touch.clientY - touchY) * .003, -.72, .72);
      touchX = touch.clientX; touchY = touch.clientY;
    };
    const touchEnd = () => { touching = false; };
    canvas.addEventListener("touchstart", touchStart, { passive: true });
    canvas.addEventListener("touchmove", touchMove, { passive: false });
    canvas.addEventListener("touchend", touchEnd);

    return () => {
      stopWalk();
      controls.unlock();
      controls.removeEventListener("change", onLook);
      controls.removeEventListener("unlock", unlock);
      controls.dispose();
      controlsRef.current = null;
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("contextmenu", contextMenu);
      document.removeEventListener("pointerup", pointerUp);
      document.removeEventListener("pointercancel", pointerUp);
      window.removeEventListener("blur", blur);
      canvas.removeEventListener("touchstart", touchStart);
      canvas.removeEventListener("touchmove", touchMove);
      canvas.removeEventListener("touchend", touchEnd);
      observer.disconnect();
      renderer.setAnimationLoop(null);
      world.dispose();
      worldRef.current = null;
      renderer.dispose();
    };
  }, [yaw]);

  return <>
    <canvas ref={canvasRef} className="first-person" aria-label="Трёхмерный архив. Нажмите для обзора мышью, удерживайте левую кнопку для движения вперёд" role="img" />
    {unavailable && <div className="webgl-fallback" role="status">Для объёмного вида нужен WebGL2. Откройте план клавишей M для перемещения.</div>}
    {dragLook && !unavailable && <div className="webgl-fallback drag-look" role="status">Захват курсора недоступен: ведите мышью с зажатой кнопкой, чтобы смотреть и идти.</div>}
    {!unavailable && <span className="fp-reticle" aria-hidden="true" />}
  </>;
}
