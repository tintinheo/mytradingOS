CREATE TABLE `market_profiles` (
	`user_id` text NOT NULL,
	`symbol` text NOT NULL,
	`context_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `symbol`)
);
