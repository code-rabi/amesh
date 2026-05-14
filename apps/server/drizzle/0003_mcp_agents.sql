ALTER TABLE `agents` ADD `host_kind` text NOT NULL DEFAULT 'custom';
--> statement-breakpoint
ALTER TABLE `agents` ADD `execution_name` text;
--> statement-breakpoint
ALTER TABLE `agents` ADD `fingerprint` text;
--> statement-breakpoint
ALTER TABLE `agents` ADD `orchestrator` integer NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE `agents` ADD `controlled` integer NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE `agents` ADD `endpoints` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE INDEX `agents_node_execution_idx` ON `agents` (`node_id`,`host_kind`,`execution_name`);
