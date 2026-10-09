CREATE TABLE `audit_results` (
	`run_id` text NOT NULL,
	`symbol` text NOT NULL,
	`recorded_at` text NOT NULL,
	`status` text NOT NULL,
	`recommendation` text NOT NULL,
	`as_of` text,
	`input_hash` text NOT NULL,
	`payload_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	PRIMARY KEY(`run_id`, `symbol`),
	FOREIGN KEY (`run_id`) REFERENCES `audit_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_audit_results_run_recommendation` ON `audit_results` (`run_id`,`recommendation`);--> statement-breakpoint
CREATE TABLE `audit_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`status` text NOT NULL,
	`mode` text NOT NULL,
	`origin` text NOT NULL,
	`source` text NOT NULL,
	`symbols_json` text NOT NULL,
	`settings_json` text NOT NULL,
	`request_hash` text NOT NULL,
	`engine_version` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_runs_user_started` ON `audit_runs` (`user_id`,`started_at`,`id`);
--> statement-breakpoint
PRAGMA optimize;
