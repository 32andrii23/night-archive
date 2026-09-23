import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Legacy table from the first prototype; kept so old migrations stay valid. */
export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  playerHash: text("player_hash").notNull(),
  monsterInviteHash: text("monster_invite_hash").notNull(),
  monsterHash: text("monster_hash"),
  state: text("state").notNull(),
  version: integer("version").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  playerSeen: integer("player_seen").notNull(),
  monsterSeen: integer("monster_seen"),
});

/**
 * Rooms for the current game. Poses live in their own columns so the two
 * players' movement never contends on the versioned game state.
 */
export const hospitalRooms = sqliteTable("hospital_rooms", {
  code: text("code").primaryKey(),
  hostHash: text("host_hash").notNull(),
  inviteHash: text("invite_hash").notNull(),
  guestHash: text("guest_hash"),
  state: text("state").notNull(),
  playerPose: text("player_pose"),
  monsterPose: text("monster_pose"),
  version: integer("version").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  hostSeen: integer("host_seen").notNull(),
  guestSeen: integer("guest_seen"),
});
