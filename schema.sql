-- Cloudflare D1 schema. Safe to re-run: every statement is idempotent.
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

-- ---- Accounts, businesses and the bookings ledger (owner dashboard) ----

-- Business owners. Signed in with Google; the Google refresh token is stored encrypted (AES-GCM).
CREATE TABLE IF NOT EXISTS merchants (
  id          TEXT PRIMARY KEY,
  google_sub  TEXT UNIQUE,
  email       TEXT,
  name        TEXT,
  picture     TEXT,
  refresh_enc TEXT,
  demo        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  last_login  INTEGER NOT NULL
);

-- Businesses owned by a merchant (the interviewer's output).
CREATE TABLE IF NOT EXISTS businesses (
  slug        TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  spec_json   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS businesses_by_merchant ON businesses (merchant_id);

-- Every booking made through Open Counter. For "internal" calendars this table IS the calendar.
-- Holds the customer's name and optional phone: only the business owner can read it.
CREATE TABLE IF NOT EXISTS bookings (
  id             TEXT PRIMARY KEY,
  business_slug  TEXT NOT NULL,
  start_utc      TEXT NOT NULL,
  end_utc        TEXT NOT NULL,
  service_id     TEXT,
  service_name   TEXT,
  price          REAL,
  currency       TEXT,
  customer_name  TEXT,
  customer_phone TEXT,
  channel        TEXT,
  status         TEXT NOT NULL DEFAULT 'confirmed',
  created_at     INTEGER NOT NULL,
  cancelled_at   INTEGER
);
CREATE INDEX IF NOT EXISTS bookings_by_business_start ON bookings (business_slug, start_utc);

-- Interview drafts parked while the owner signs in with Google (expire after a day).
CREATE TABLE IF NOT EXISTS drafts (
  id         TEXT PRIMARY KEY,
  draft_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Owners' devices that asked for a notification on every new booking (Web Push). One row per browser subscription.
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint    TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subs_by_merchant ON push_subs (merchant_id);
