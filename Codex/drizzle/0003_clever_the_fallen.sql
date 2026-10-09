CREATE TABLE `data_reconciliations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`symbol` text NOT NULL,
	`created_at` text NOT NULL,
	`status` text NOT NULL,
	`mode` text NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text NOT NULL,
	`request_hash` text NOT NULL,
	`payload_hash` text NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_reconciliation_user_symbol_date` ON `data_reconciliations` (`user_id`,`symbol`,`created_at`,`id`);