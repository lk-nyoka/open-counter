-- Cloudflare D1 schema. Locks only: no customer data is stored here.
CREATE TABLE IF NOT EXISTS locks (
  business_id TEXT NOT NULL,
  slot_start  TEXT NOT NULL,
  booking_id  TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  PRIMARY KEY (business_id, slot_start)
);

-- Businesses published through the AI interviewer. Config only, no customer data.
CREATE TABLE IF NOT EXISTS specs (
  slug       TEXT PRIMARY KEY,
  spec_json  TEXT NOT NULL,
  owner_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Fixed-window counters for rate limiting (per IP and a global daily AI budget).
CREATE TABLE IF NOT EXISTS rate (
  k      TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  n      INTEGER NOT NULL,
  PRIMARY KEY (k, bucket)
);
