CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`player_hash` text NOT NULL,
	`monster_invite_hash` text NOT NULL,
	`monster_hash` text,
	`state` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`player_seen` integer NOT NULL,
	`monster_seen` integer
);
