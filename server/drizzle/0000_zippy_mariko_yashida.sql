CREATE TABLE IF NOT EXISTS `activity_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`details` text,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `email_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`email` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`imap_host` text,
	`imap_port` integer,
	`imap_secure` integer,
	`imap_username` text,
	`imap_password` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_checked_at` integer,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `po_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`po_id` integer NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`content` text,
	`extracted_text` text,
	`is_po_attachment` integer,
	`ai_analysis` text,
	`size` integer,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `po_template_regions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`field_name` text NOT NULL,
	`page_number` integer DEFAULT 1 NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`width` real NOT NULL,
	`height` real NOT NULL,
	`prompt` text,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `po_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`customer_name` text,
	`sender_email` text,
	`is_active` integer DEFAULT true NOT NULL,
	`sample_pdf_path` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `purchase_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email_account_id` integer NOT NULL,
	`email_message_id` text NOT NULL,
	`sender_email` text NOT NULL,
	`sender_name` text,
	`subject` text NOT NULL,
	`received_at` integer NOT NULL,
	`status` text DEFAULT 'detected' NOT NULL,
	`confidence` real,
	`ai_analysis` text,
	`extracted_data` text,
	`offer_sheet_number` text,
	`sq_doc_entry` integer,
	`sq_doc_num` integer,
	`sap_doc_entry` integer,
	`sap_doc_num` integer,
	`sap_error` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sap_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`service_layer_url` text NOT NULL,
	`company_db` text NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_connected_at` integer,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `settings_key_unique` ON `settings` (`key`);
--> statement-breakpoint
CREATE TABLE `__new_sap_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`service_layer_url` text NOT NULL,
	`company_db` text NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_connected_at` integer,
	`created_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_sap_connections` (
	`id`,
	`name`,
	`service_layer_url`,
	`company_db`,
	`username`,
	`password`,
	`is_active`,
	`last_connected_at`,
	`created_at`
)
SELECT
	`id`,
	`name`,
	`service_layer_url`,
	`company_db`,
	`username`,
	`password`,
	`is_active`,
	`last_connected_at`,
	`created_at`
FROM `sap_connections`;
--> statement-breakpoint
DROP TABLE `sap_connections`;
--> statement-breakpoint
ALTER TABLE `__new_sap_connections` RENAME TO `sap_connections`;
