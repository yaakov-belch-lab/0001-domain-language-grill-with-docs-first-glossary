CREATE TABLE `refund_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`seat_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text NOT NULL,
	`amount_refunded` integer,
	`requested_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by_user_id` integer,
	FOREIGN KEY (`seat_id`) REFERENCES `seats`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `refund_requests_seat_idx` ON `refund_requests` (`seat_id`);--> statement-breakpoint
CREATE TABLE `seats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` integer NOT NULL,
	`code` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seats_code_unique` ON `seats` (`code`);--> statement-breakpoint
CREATE INDEX `seats_purchase_idx` ON `seats` (`purchase_id`);--> statement-breakpoint
ALTER TABLE `enrollments` ADD `seat_id` integer REFERENCES seats(id);--> statement-breakpoint
ALTER TABLE `enrollments` ADD `ended_at` text;--> statement-breakpoint
ALTER TABLE `enrollments` ADD `unenrollment_initiator` text;--> statement-breakpoint
CREATE INDEX `enrollments_seat_idx` ON `enrollments` (`seat_id`);--> statement-breakpoint
ALTER TABLE `purchases` ADD `seat_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchases` ADD `seat_price` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchases` ADD `ppp_country_restriction` text;