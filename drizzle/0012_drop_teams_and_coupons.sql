-- Contract (ADR 0001): 0011 moved these into the Seat model; nothing reads them now.
DROP TABLE `coupons`;--> statement-breakpoint
DROP TABLE `refunds`;--> statement-breakpoint
DROP TABLE `team_members`;--> statement-breakpoint
DROP TABLE `teams`;