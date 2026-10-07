import type { D1Like } from "./adapters/d1.js";
import { BusinessSpecSchema, type BusinessSpec } from "./spec.js";

const sha256hex = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function getPublished(db: D1Like, slug: string): Promise<BusinessSpec | null> {
  const row = await db.prepare("SELECT spec_json FROM specs WHERE slug = ?1").bind(slug).first<{ spec_json: string }>();
  return row ? BusinessSpecSchema.parse(JSON.parse(row.spec_json)) : null;
}

export async function countPublished(db: D1Like): Promise<number> {
  const r = await db.prepare("SELECT count(*) AS c FROM specs WHERE ?1 = ?1").bind(1).first<{ c: number }>();
  return r?.c ?? 0;
}

export async function putPublished(db: D1Like, spec: BusinessSpec, ownerKey: string, now: number): Promise<boolean> {
  const r = await db
    .prepare("INSERT INTO specs (slug, spec_json, owner_hash, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (slug) DO NOTHING")
    .bind(spec.slug, JSON.stringify(spec), await sha256hex(ownerKey), now)
    .run();
  return r.meta.changes > 0;
}

export async function deletePublished(db: D1Like, slug: string, ownerKey: string): Promise<boolean> {
  const r = await db
    .prepare("DELETE FROM specs WHERE slug = ?1 AND owner_hash = ?2")
    .bind(slug, await sha256hex(ownerKey))
    .run();
  return r.meta.changes > 0;
}

/** Fixed-window counter. Returns true while under the limit. */
export async function allow(db: D1Like, key: string, limit: number, windowSec: number, cost = 1, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const bucket = Math.floor(nowSec / windowSec);
  const r = await db
    .prepare("INSERT INTO rate (k, bucket, n) VALUES (?1, ?2, ?3) ON CONFLICT (k, bucket) DO UPDATE SET n = n + ?3 RETURNING n")
    .bind(key, bucket, cost)
    .first<{ n: number }>();
  return (r?.n ?? cost) <= limit;
}

// ---------------- Merchants, businesses, drafts, bookings ----------------

export interface Merchant { id: string; email: string | null; name: string | null; picture: string | null; demo: boolean; hasGoogle: boolean }
type MerchantRow = { id: string; email: string | null; name: string | null; picture: string | null; demo: number; refresh_enc: string | null };
const toMerchant = (r: MerchantRow): Merchant => ({ id: r.id, email: r.email, name: r.name, picture: r.picture, demo: !!r.demo, hasGoogle: !!r.refresh_enc });

export async function getMerchant(db: D1Like, id: string): Promise<Merchant | null> {
  const r = await db.prepare("SELECT id, email, name, picture, demo, refresh_enc FROM merchants WHERE id = ?1").bind(id).first<MerchantRow>();
  return r ? toMerchant(r) : null;
}

export async function getRefreshEnc(db: D1Like, id: string): Promise<string | null> {
  const r = await db.prepare("SELECT refresh_enc FROM merchants WHERE id = ?1").bind(id).first<{ refresh_enc: string | null }>();
  return r?.refresh_enc ?? null;
}

/** Create or update the merchant for a Google account. Keeps the old refresh token if Google did not send a new one. */
export async function upsertGoogleMerchant(db: D1Like, m: { id: string; sub: string; email: string; name: string | null; picture: string | null; refreshEnc: string | null }, now: number): Promise<string> {
  const r = await db
    .prepare(
      `INSERT INTO merchants (id, google_sub, email, name, picture, refresh_enc, demo, created_at, last_login) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?7)
       ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture,
         refresh_enc = COALESCE(excluded.refresh_enc, merchants.refresh_enc), last_login = excluded.last_login
       RETURNING id`,
    )
    .bind(m.id, m.sub, m.email, m.name, m.picture, m.refreshEnc, now)
    .first<{ id: string }>();
  return r!.id;
}

export async function createDemoMerchant(db: D1Like, id: string, now: number): Promise<void> {
  await db.prepare("INSERT INTO merchants (id, email, name, demo, created_at, last_login) VALUES (?1, NULL, 'Demo owner', 1, ?2, ?2)").bind(id, now).run();
}

export async function putBusiness(db: D1Like, merchantId: string, spec: BusinessSpec, now: number): Promise<boolean> {
  const r = await db
    .prepare("INSERT INTO businesses (slug, merchant_id, spec_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT (slug) DO NOTHING")
    .bind(spec.slug, merchantId, JSON.stringify(spec), now)
    .run();
  return r.meta.changes > 0;
}

export async function updateBusiness(db: D1Like, merchantId: string, spec: BusinessSpec, now: number): Promise<boolean> {
  const r = await db.prepare("UPDATE businesses SET spec_json = ?3, updated_at = ?4 WHERE slug = ?1 AND merchant_id = ?2").bind(spec.slug, merchantId, JSON.stringify(spec), now).run();
  return r.meta.changes > 0;
}

export async function deleteBusiness(db: D1Like, merchantId: string, slug: string): Promise<boolean> {
  const r = await db.prepare("DELETE FROM businesses WHERE slug = ?1 AND merchant_id = ?2").bind(slug, merchantId).run();
  return r.meta.changes > 0;
}

export async function getBusiness(db: D1Like, slug: string): Promise<{ spec: BusinessSpec; merchantId: string } | null> {
  const r = await db.prepare("SELECT spec_json, merchant_id FROM businesses WHERE slug = ?1").bind(slug).first<{ spec_json: string; merchant_id: string }>();
  return r ? { spec: BusinessSpecSchema.parse(JSON.parse(r.spec_json)), merchantId: r.merchant_id } : null;
}

export async function listBusinesses(db: D1Like, merchantId: string): Promise<BusinessSpec[]> {
  const { results } = await db.prepare("SELECT spec_json FROM businesses WHERE merchant_id = ?1 ORDER BY created_at").bind(merchantId).all<{ spec_json: string }>();
  return results.map((r) => BusinessSpecSchema.parse(JSON.parse(r.spec_json)));
}

export async function countBusinesses(db: D1Like): Promise<number> {
  const r = await db.prepare("SELECT count(*) AS c FROM businesses WHERE ?1 = ?1").bind(1).first<{ c: number }>();
  return r?.c ?? 0;
}

export async function putDraft(db: D1Like, id: string, draft: unknown, now: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM drafts WHERE created_at < ?1").bind(now - 86_400),
    db.prepare("INSERT INTO drafts (id, draft_json, created_at) VALUES (?1, ?2, ?3)").bind(id, JSON.stringify(draft), now),
  ]);
}

export async function takeDraft(db: D1Like, id: string, now: number): Promise<unknown | null> {
  const r = await db.prepare("DELETE FROM drafts WHERE id = ?1 AND created_at >= ?2 RETURNING draft_json").bind(id, now - 86_400).first<{ draft_json: string }>();
  return r ? JSON.parse(r.draft_json) : null;
}

export interface BookingRow {
  id: string; start: string; end: string; serviceId: string | null; serviceName: string | null; price: number | null; currency: string | null;
  customerName: string | null; customerPhone: string | null; channel: string | null; status: string; createdAt: number; cancelledAt: number | null;
}

export async function listBookings(db: D1Like, slug: string, q: { from?: string; to?: string; status?: string; limit?: number }): Promise<BookingRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, start_utc AS start, end_utc AS "end", service_id AS serviceId, service_name AS serviceName, price, currency,
              customer_name AS customerName, customer_phone AS customerPhone, channel, status, created_at AS createdAt, cancelled_at AS cancelledAt
       FROM bookings WHERE business_slug = ?1 AND start_utc >= ?2 AND start_utc < ?3 AND (?4 = 'all' OR status = ?4)
       ORDER BY start_utc LIMIT ?5`,
    )
    .bind(slug, q.from ?? "0000", q.to ?? "9999", q.status ?? "all", Math.min(Math.max(q.limit ?? 200, 1), 500))
    .all<BookingRow>();
  return results;
}

export async function getBooking(db: D1Like, slug: string, id: string): Promise<BookingRow | null> {
  return (await listBookingsById(db, slug, id))[0] ?? null;
}
async function listBookingsById(db: D1Like, slug: string, id: string): Promise<BookingRow[]> {
  const { results } = await db
    .prepare(`SELECT id, start_utc AS start, end_utc AS "end", service_id AS serviceId, service_name AS serviceName, price, currency, customer_name AS customerName,
              customer_phone AS customerPhone, channel, status, created_at AS createdAt, cancelled_at AS cancelledAt FROM bookings WHERE business_slug = ?1 AND id = ?2`)
    .bind(slug, id)
    .all<BookingRow>();
  return results;
}

/** Numbers for the dashboard. Ranges are UTC ISO strings computed by the caller in the business time zone. */
export async function bookingStats(db: D1Like, slug: string, r: { todayFrom: string; todayTo: string; weekFrom: string; weekTo: string; now: string }) {
  const one = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).bind(slug, ...p).first<T>();
  const [today, week, upcoming, byChannel, next, cancelled] = await Promise.all([
    one<{ n: number; revenue: number | null }>("SELECT count(*) AS n, sum(price) AS revenue FROM bookings WHERE business_slug = ?1 AND status = 'confirmed' AND start_utc >= ?2 AND start_utc < ?3", r.todayFrom, r.todayTo),
    one<{ n: number; revenue: number | null }>("SELECT count(*) AS n, sum(price) AS revenue FROM bookings WHERE business_slug = ?1 AND status = 'confirmed' AND start_utc >= ?2 AND start_utc < ?3", r.weekFrom, r.weekTo),
    one<{ n: number }>("SELECT count(*) AS n FROM bookings WHERE business_slug = ?1 AND status = 'confirmed' AND start_utc >= ?2", r.now),
    db.prepare("SELECT coalesce(channel, 'mcp') AS channel, count(*) AS n FROM bookings WHERE business_slug = ?1 AND status = 'confirmed' GROUP BY 1").bind(slug).all<{ channel: string; n: number }>(),
    one<{ id: string; start: string; serviceName: string; customerName: string }>("SELECT id, start_utc AS start, service_name AS serviceName, customer_name AS customerName FROM bookings WHERE business_slug = ?1 AND status = 'confirmed' AND start_utc >= ?2 ORDER BY start_utc LIMIT 1", r.now),
    one<{ n: number }>("SELECT count(*) AS n FROM bookings WHERE business_slug = ?1 AND status = 'cancelled' AND start_utc >= ?2 AND start_utc < ?3", r.weekFrom, r.weekTo),
  ]);
  return {
    today: { bookings: today?.n ?? 0, revenue: today?.revenue ?? 0 },
    week: { bookings: week?.n ?? 0, revenue: week?.revenue ?? 0, cancelled: cancelled?.n ?? 0 },
    upcoming: upcoming?.n ?? 0,
    byChannel: Object.fromEntries(byChannel.results.map((x) => [x.channel, x.n])),
    next: next ?? null,
  };
}
