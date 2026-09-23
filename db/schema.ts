import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
