import { randomUUID } from "node:crypto";
import type { BookingLog, BookingRecord, BusyInterval, CalendarEvent, CalendarPort, Deps, LockPort, NewEvent } from "../ports.js";

/** In-memory fakes: used by tests and by `OPEN_COUNTER_FAKE=1` local demos. */
export class MemoryCalendar implements CalendarPort {
  events = new Map<string, NewEvent & { cancelled?: boolean; calendarId: string }>();
  /** Events the owner added by hand (not via Open Counter). Titles are attacker-controllable text. */
  ownerEvents: { title: string; start: string; end: string }[] = [];

  async listBusy(c: string, from: string, to: string): Promise<BusyInterval[]> {
    const f = Date.parse(from), t = Date.parse(to);
    const all = [
      ...[...this.events.values()].filter((e) => !e.cancelled && e.calendarId === c),
      ...this.ownerEvents,
    ];
    // Only times leave this function. Titles are dropped, like Google's freeBusy API.
    return all.filter((e) => Date.parse(e.start) < t && Date.parse(e.end) > f).map((e) => ({ start: e.start, end: e.end }));
  }
  async getEvent(c: string, id: string): Promise<CalendarEvent | null> {
    const e = this.events.get(id);
    return e && !e.cancelled && e.calendarId === c ? { id, start: e.start, end: e.end } : null;
  }
  async createEvent(c: string, ev: NewEvent): Promise<void> {
    const ex = this.events.get(ev.id);
    if (ex && !ex.cancelled) return; // idempotent
    if (ex?.cancelled) throw new Error("idempotency key already used by a cancelled booking");
    this.events.set(ev.id, { ...ev, calendarId: c });
  }
  async deleteEvent(c: string, id: string): Promise<void> {
    const e = this.events.get(id);
    if (e && e.calendarId === c) e.cancelled = true;
  }
}

export class MemoryLocks implements LockPort {
  held = new Map<string, string>(); // `${business}|${unit}` -> bookingId
  async acquire(b: string, units: string[], id: string): Promise<boolean> {
    // Single-threaded JS: this check-then-set is atomic, like a DynamoDB transaction.
    if (units.some((u) => { const o = this.held.get(`${b}|${u}`); return o && o !== id; })) return false;
    units.forEach((u) => this.held.set(`${b}|${u}`, id));
    return true;
  }
  async release(b: string, units: string[], id: string): Promise<void> {
    for (const u of units) if (this.held.get(`${b}|${u}`) === id) this.held.delete(`${b}|${u}`);
  }
}

/** The bookings ledger, in memory: what the owner's dashboard reads and short codes resolve against. */
export class MemoryLog implements BookingLog {
  rows = new Map<string, BookingRecord & { status: string }>();
  async record(r: BookingRecord) { this.rows.set(r.id, { ...r, status: "confirmed" }); }
  async cancelled(_slug: string, id: string) { const r = this.rows.get(id); if (r) r.status = "cancelled"; }
  async findByPrefix(slug: string, idPrefix: string) {
    return [...this.rows.values()].filter((r) => r.businessSlug === slug && r.status === "confirmed" && r.id.startsWith(idPrefix)).map((r) => ({ id: r.id, customerName: r.customerName, start: r.start }));
  }
}

export function memoryDeps(now: () => Date = () => new Date()): Deps & { calendar: MemoryCalendar; locks: MemoryLocks; log: MemoryLog } {
  return { calendar: new MemoryCalendar(), locks: new MemoryLocks(), now, newId: () => randomUUID().replace(/-/g, ""), log: new MemoryLog() };
}
