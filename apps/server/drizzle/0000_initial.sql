CREATE TABLE `nodes` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `status` text NOT NULL,
  `host` text NOT NULL,
  `labels` text NOT NULL,
  `reconnect_token` text NOT NULL,
  `registered_at` text NOT NULL,
  `last_seen_at` text
);
--> statement-breakpoint
CREATE TABLE `agents` (
  `id` text PRIMARY KEY NOT NULL,
  `node_id` text NOT NULL,
  `name` text NOT NULL,
  `backend` text NOT NULL,
  `status` text NOT NULL,
  `capabilities` text NOT NULL,
  FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trigger_rules` (
  `id` text PRIMARY KEY NOT NULL,
  `source_agent_id` text NOT NULL,
  `target_agent_id` text NOT NULL,
  `mode` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `entry_agent_id` text NOT NULL,
  `initiator` text NOT NULL,
  `status` text NOT NULL,
  `created_at` text NOT NULL,
  `parent_session_id` text,
  `source_agent_id` text
);
--> statement-breakpoint
CREATE TABLE `session_events` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `event_type` text NOT NULL,
  `source_agent_id` text,
  `target_agent_id` text,
  `payload` text NOT NULL,
  `created_at` text NOT NULL,
  `sequence` integer NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
