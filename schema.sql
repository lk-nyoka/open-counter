-- Cloudflare D1 schema. Locks only: no customer data is stored here.
CREATE TABLE IF NOT EXISTS locks (
  business_id TEXT NOT NULL,
  slot_start  TEXT NOT NULL,
  booking_id  TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  PRIMARY KEY (business_id, slot_start)
);
