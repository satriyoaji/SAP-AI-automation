CREATE TABLE `po_sap_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`po_id` integer NOT NULL,
	`request_headers` text NOT NULL,
	`request_body` text NOT NULL,
	`response_status` integer,
	`response_body` text,
	`is_success` integer DEFAULT false NOT NULL,
	`created_at` integer
);
