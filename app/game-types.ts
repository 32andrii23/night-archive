export type Point = { x: number; y: number };
export type Pose = Point & { yaw: number; pitch: number };
export type GameEvent = Point & {
  id: string;
  type: string;
  at: number;
  until: number;
  variant?: number;
};

export type GameView = {
  phase: "waiting" | "intro" | "playing" | "ended";
  side: "player" | "monster";
  round: number;
  now: number;
  version: number;
  startedAt: number;
  introEndsAt: number;
  endsAt: number;
  winner: "player" | "monster" | null;
  reason: string;
  map: string[];
  found: number;
  fuses: Array<{ x: number | null; y: number | null; found: boolean }>;
  switch: Point;
  exit: Point;
  lockers: Point[];
  cameras: Point[];
  power: boolean;
  lightsUntil: number[];
  lockUntil: number;
  events: GameEvent[];
  votes: { player: boolean; monster: boolean };
  otherConnected: boolean;
  self: Pose & {
    hidden?: boolean;
    flares?: number;
    energy?: number;
    stunnedUntil?: number;
    disguised?: boolean;
  };
  rival: (Pose & { disguised?: boolean }) | null;
  spectate?: Pose;
  flareReadyAt?: number;
  cooldowns?: Record<string, number>;
};
