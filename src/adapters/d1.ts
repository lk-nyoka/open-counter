import type { LockPort } from "../ports.js";

/** Minimal slice of Cloudflare's D1 API that we use (also implemented by the test shim). */
export interface D1Like {
  prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<{ meta: { changes: number } }> } };
  batch(stmts: unknown[]): Promise<{ meta: { changes: number } }[]>;
}

/**
 * Slot locks in Cloudflare D1 (SQLite). One row per grid unit; no customer data.
 *
 * All-or-nothing claim is ONE SQL statement: it inserts every unit only if no unit is held by a
 * different, unexpired booking. D1 serialises writes, so two concurrent requests cannot both pass.
 * `changes = 0` means someone else holds at least one unit.
 */
export class D1Locks implements LockPort {
  constructor(private db: D1Like) {}

  async acquire(businessId: string, units: string[], bookingId: string, expiresAt: number): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const json = JSON.stringify(units);
    const sweep = this.db.prepare("DELETE FROM locks WHERE expires_at < ?").bind(now);
    const claim = this.db
      .prepare(
        `INSERT INTO locks (business_id, slot_start, booking_id, expires_at)
         SELECT ?1, value, ?2, ?3 FROM json_each(?4)
         WHERE NOT EXISTS (
           SELECT 1 FROM locks l JOIN json_each(?4) j ON l.slot_start = j.value
           WHERE l.business_id = ?1 AND l.booking_id <> ?2 AND l.expires_at >= ?5
         )
         ON CONFLICT (business_id, slot_start) DO UPDATE SET booking_id = excluded.booking_id, expires_at = excluded.expires_at`,
      )
      .bind(businessId, bookingId, expiresAt, json, now);
    const [, res] = await this.db.batch([sweep, claim]);
    return res.meta.changes > 0;
  }

  async release(businessId: string, units: string[], bookingId: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM locks WHERE business_id = ?1 AND booking_id = ?2 AND slot_start IN (SELECT value FROM json_each(?3))")
      .bind(businessId, bookingId, JSON.stringify(units))
      .run();
  }
}
