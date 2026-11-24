CREATE TABLE `integration_background_w2` (
	`key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`company_id` text NOT NULL,
	`session_encrypted` text NOT NULL,
	`progress_json` text
);
