import type { BookingLog, BookingRecord, BusyInterval, CalendarEvent, CalendarPort, NewEvent } from "../ports.js";
import type { D1Like } from "./d1.js";

const utc = (iso: string) => new Date(iso).toISOString(); // one format, so string order = time order

/** The owner's bookings ledger in D1. Upserts, so it also completes rows the internal calendar created. */
export class D1BookingLog implements BookingLog {
  constructor(private db: D1Like, private nowSec: () => number = () => Math.floor(Date.now() / 1000)) {}

  async record(r: BookingRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO bookings (id, business_slug, start_utc, end_utc, service_id, service_name, price, currency, customer_name, customer_phone, channel, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'confirmed', ?12)
         ON CONFLICT (id) DO UPDATE SET start_utc = excluded.start_utc, end_utc = excluded.end_utc, service_id = excluded.service_id,
           service_name = excluded.service_name, price = excluded.price, currency = excluded.currency, customer_name = excluded.customer_name,
           customer_phone = excluded.customer_phone, channel = excluded.channel`,
      )
      .bind(r.id, r.businessSlug, utc(r.start), utc(r.end), r.serviceId, r.serviceName, r.price, r.currency, r.customerName, r.customerPhone ?? null, r.channel, this.nowSec())
      .run();
  }

  async cancelled(slug: string, id: string, at: number): Promise<void> {
    await this.db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ?3 WHERE business_slug = ?1 AND id = ?2").bind(slug, id, at).run();
  }
}

/**
 * A calendar that lives in D1: for owners who have not linked Google, and for the judges' demo.
 * calendarId is "internal:<slug>". Busy times come only from confirmed bookings.
 */
export class DbCalendar implements CalendarPort {
  constructor(private db: D1Like, private nowSec: () => number = () => Math.floor(Date.now() / 1000)) {}
  private slug(calendarId: string) { return calendarId.replace(/^internal:/, ""); }

  async listBusy(calendarId: string, from: string, to: string): Promise<BusyInterval[]> {
    const { results } = await this.db
      .prepare("SELECT start_utc AS start, end_utc AS end FROM bookings WHERE business_slug = ?1 AND status = 'confirmed' AND start_utc < ?3 AND end_utc > ?2")
      .bind(this.slug(calendarId), utc(from), utc(to))
      .all<BusyInterval>();
    return results.map((r) => ({ start: r.start, end: r.end }));
  }

  async getEvent(calendarId: string, id: string): Promise<CalendarEvent | null> {
    const r = await this.db
      .prepare("SELECT id, start_utc AS start, end_utc AS end FROM bookings WHERE business_slug = ?1 AND id = ?2 AND status = 'confirmed'")
      .bind(this.slug(calendarId), id)
      .first<CalendarEvent>();
    return r ? { id: r.id, start: r.start, end: r.end } : null;
  }

  async createEvent(calendarId: string, ev: NewEvent): Promise<void> {
    const r = await this.db
      .prepare("INSERT INTO bookings (id, business_slug, start_utc, end_utc, status, created_at) VALUES (?1, ?2, ?3, ?4, 'confirmed', ?5) ON CONFLICT (id) DO NOTHING")
      .bind(ev.id, this.slug(calendarId), utc(ev.start), utc(ev.end), this.nowSec())
      .run();
    if (r.meta.changes === 0 && !(await this.getEvent(calendarId, ev.id))) throw new Error("idempotency key already used by a cancelled booking");
  }

  async deleteEvent(calendarId: string, id: string): Promise<void> {
    await this.db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ?3 WHERE business_slug = ?1 AND id = ?2").bind(this.slug(calendarId), id, this.nowSec()).run();
  }
}

/** Sends each calendarId to the right backend: "internal:" (D1), "google:<merchant>" (owner's own Google), or the default. */
export class RoutingCalendar implements CalendarPort {
  constructor(private routes: { internal: CalendarPort; google?: (merchantId: string) => CalendarPort; fallback: CalendarPort }) {}
  private pick(calendarId: string): [CalendarPort, string] {
    if (calendarId.startsWith("internal:")) return [this.routes.internal, calendarId];
    const g = /^google:([a-f0-9]{32})(?::(.+))?$/.exec(calendarId);
    if (g) {
      if (!this.routes.google) throw new Error("Google sign-in is not configured on this deployment");
      return [this.routes.google(g[1]), g[2] ?? "primary"];
    }
    return [this.routes.fallback, calendarId];
  }
  listBusy(c: string, f: string, t: string) { const [p, id] = this.pick(c); return p.listBusy(id, f, t); }
  getEvent(c: string, e: string) { const [p, id] = this.pick(c); return p.getEvent(id, e); }
  createEvent(c: string, e: NewEvent) { const [p, id] = this.pick(c); return p.createEvent(id, e); }
  deleteEvent(c: string, e: string) { const [p, id] = this.pick(c); return p.deleteEvent(id, e); }
}
