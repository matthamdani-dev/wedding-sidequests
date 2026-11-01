-- 002_room_number_claim.sql
-- Switches the guest "claim" verification from last-4-phone-digits to the
-- guest's accommodation room number (independent of the reception seating
-- `table`). phone_last4 was only ever used for the claim check, so it's
-- dropped along with its index; `phone` itself is left in place as plain
-- contact info.

DROP INDEX IF EXISTS guests_phone_last4_idx;
ALTER TABLE guests DROP COLUMN IF EXISTS phone_last4;

ALTER TABLE guests ADD COLUMN IF NOT EXISTS room_number text;
CREATE INDEX IF NOT EXISTS guests_room_number_idx ON guests (room_number);
