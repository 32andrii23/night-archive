import type { Phase, Point, Side } from "../lib/hospital";

export type { Phase, Point, Side };

export type GameEvent = Point & {
  id: string;
  type: string;
  at: number;
  until: number;
  variant?: number;
  text?: string;
  yaw?: number;
  face?: number;
  tx?: number;
  ty?: number;
  fx?: number;
  fy?: number;
};

export type Writing = { id: string; tx: number; ty: number; face: number; text: string; at: number };

export type RivalPose = Point & {
  yaw: number; pitch: number; t: number; moving: boolean;
  disguised?: boolean; revealedAt?: number; stunned?: boolean;
  light?: boolean; crouch?: boolean;
};

export type SelfPose = Point & {
  yaw: number; pitch: number; seq: number; warp: number;
  // visitor
  hidden?: number; flares?: number; lives?: number; battery?: number; light?: boolean;
  stunnedUntil?: number; safeUntil?: number; flareReadyAt?: number;
  // creature
  energy?: number; disguised?: boolean; revealedAt?: number; formReadyAt?: number;
};

export type GameView = {
  phase: Phase;
  side: Side;
  round: number;
  now: number;
  version: number;
  startedAt: number;
  introEndsAt: number;
  endsAt: number;
  endedAt: number;
  winner: Side | null;
  reason: string;
  hostSide: Side;
  names: { player: string; monster: string };
  power: boolean;
  powerAt: number;
  lightsUntil: number[];
  lockUntil: number;
  flickerUntil: number;
  found: number;
  total: number;
  stories: number[];
  writings: Writing[];
  events: GameEvent[];
  votes: { player: "same" | "swap" | null; monster: "same" | "swap" | null };
  otherConnected: boolean;
  stats: { tricks: number; scares: number; catches: number; flared: number; hides: number; searches: number };
  self: SelfPose;
  rival: RivalPose | null;
  noise: (Point & { heavy: boolean }) | null;
  clues: Array<{ x: number | null; y: number | null; found: boolean }>;
  batteries: Point[];
  // creature only
  cooldowns?: Record<string, number>;
  spectate?: Point & { yaw: number; pitch: number; t: number; warp: number; light: boolean; crouch: boolean; hidden: number };
  friend?: { lives: number; flares: number; battery: number; hidden: boolean; detected: boolean; safe: boolean };
  cameraSignals?: boolean[];
};

/** Local-only state the renderer shares with the HUD without React churn. */
export type LocalState = {
  stamina: number;
  crouch: boolean;
  light: boolean;
  sprinting: boolean;
  holdProgress: number;
  holdLabel: string;
};
