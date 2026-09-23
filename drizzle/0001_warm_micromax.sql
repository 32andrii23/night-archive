CREATE TABLE `hospital_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`host_hash` text NOT NULL,
	`invite_hash` text NOT NULL,
	`guest_hash` text,
	`state` text NOT NULL,
	`player_pose` text,
	`monster_pose` text,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`host_seen` integer NOT NULL,
	`guest_seen` integer
);
