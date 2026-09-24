CREATE TABLE `interview_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`attempt_group_id` text NOT NULL,
	`attempt_number` integer DEFAULT 1 NOT NULL,
	`retried_from_interview_id` text,
	`candidate_id` text NOT NULL,
	`title` text NOT NULL,
	`user_prompt` text NOT NULL,
	`interview_length_seconds` integer NOT NULL,
	`total_time_taken_seconds` integer,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`session_data` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`completed_at` text
);
