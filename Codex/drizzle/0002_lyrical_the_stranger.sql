CREATE TABLE `evidence_observations` (
	`user_id` text NOT NULL,
	`run_id` text NOT NULL,
	`symbol` text NOT NULL,
	`recorded_at` text NOT NULL,
	`origin_date` text NOT NULL,
	`status` text NOT NULL,
	`config_json` text NOT NULL,
	`outcome_json` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`run_id`, `symbol`),
	FOREIGN KEY (`run_id`) REFERENCES `audit_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_evidence_user_symbol_status` ON `evidence_observations` (`user_id`,`symbol`,`status`);--> statement-breakpoint
CREATE INDEX `idx_evidence_user_recorded` ON `evidence_observations` (`user_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `personal_portfolios` (
	`user_id` text PRIMARY KEY NOT NULL,
	`portfolio_json` text NOT NULL,
	`updated_at` text NOT NULL
);
