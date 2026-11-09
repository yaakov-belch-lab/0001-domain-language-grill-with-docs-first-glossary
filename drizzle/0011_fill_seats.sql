-- Fill the Seat model (ADR 0001) from the team, coupon and refund tables.
-- Expand only: teams, team_members, coupons and refunds stay until every
-- route has moved to the seats module.

-- Every coupon becomes a Seat with the same code.
INSERT INTO `seats` (`purchase_id`, `code`, `created_at`)
SELECT `purchase_id`, `code`, `created_at` FROM `coupons` ORDER BY `id`;
--> statement-breakpoint

-- Every Purchase without coupons gets one Seat.
INSERT INTO `seats` (`purchase_id`, `code`, `created_at`)
SELECT p.`id`, lower(hex(randomblob(12))), p.`created_at`
FROM `purchases` p
WHERE NOT EXISTS (SELECT 1 FROM `coupons` c WHERE c.`purchase_id` = p.`id`)
ORDER BY p.`id`;
--> statement-breakpoint

UPDATE `purchases`
SET `seat_count` = (SELECT count(*) FROM `seats` s WHERE s.`purchase_id` = `purchases`.`id`);
--> statement-breakpoint

UPDATE `purchases` SET `seat_price` = `amount_paid` / `seat_count`;
--> statement-breakpoint

-- A PPP Discount was given when a Seat cost less than the Course Price.
UPDATE `purchases`
SET `ppp_country_restriction` = `country`
WHERE `country` IS NOT NULL
  AND `seat_price` < (SELECT c.`price` FROM `courses` c WHERE c.`id` = `purchases`.`course_id`);
--> statement-breakpoint

-- The Buyer's Enrollment holds the Seat of their Purchase without coupons.
UPDATE `enrollments`
SET `seat_id` = (
  SELECT s.`id`
  FROM `purchases` p
  JOIN `seats` s ON s.`purchase_id` = p.`id`
  WHERE p.`user_id` = `enrollments`.`user_id`
    AND p.`course_id` = `enrollments`.`course_id`
    AND NOT EXISTS (SELECT 1 FROM `coupons` c WHERE c.`purchase_id` = p.`id`)
  ORDER BY p.`created_at`, p.`id`
  LIMIT 1
)
WHERE `seat_id` IS NULL;
--> statement-breakpoint

-- Whoever redeemed a coupon holds its Seat with their Enrollment.
UPDATE `enrollments`
SET `seat_id` = (
  SELECT s.`id`
  FROM `coupons` c
  JOIN `seats` s ON s.`code` = c.`code`
  WHERE c.`redeemed_by_user_id` = `enrollments`.`user_id`
    AND c.`course_id` = `enrollments`.`course_id`
  ORDER BY c.`redeemed_at`, c.`id`
  LIMIT 1
)
WHERE `seat_id` IS NULL;
--> statement-breakpoint

-- Refunds were made per Purchase. Each becomes a Refund Request for the
-- first Seat of its Purchase.
INSERT INTO `refund_requests`
  (`seat_id`, `status`, `reason`, `amount_refunded`, `requested_at`, `resolved_at`, `resolved_by_user_id`)
SELECT
  (SELECT min(s.`id`) FROM `seats` s WHERE s.`purchase_id` = r.`purchase_id`),
  CASE r.`status` WHEN 'requested' THEN 'pending' ELSE r.`status` END,
  r.`reason`,
  r.`amount_refunded`,
  r.`requested_at`,
  r.`resolved_at`,
  r.`resolved_by_user_id`
FROM `refunds` r
ORDER BY r.`id`;
