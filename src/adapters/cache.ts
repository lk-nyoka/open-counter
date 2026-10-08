import type { BusyInterval, CalendarEvent, CalendarPort, NewEvent } from "../ports.js";

/**
 * Short-lived busy-time cache for availability lookups, so voice assistants get answers well inside their latency
 * budget. Safe by construction: it only serves check_availability. `book` always reads the real calendar while it holds
 * the slot lock, so a stale cached answer can at worst offer a time that booking then refuses as taken.
 * Writes through the paired `WriteThrough` calendar drop that calendar's cached entries immediately.
 */
export class BusyCache {
  private entries = new Map<string, { at: number; busy: Promise<BusyInterval[]> }>();
  constructor(private ttlMs = 30_000, private now: () => number = Date.now, private max = 500) {}

  reader(inner: CalendarPort): CalendarPort {
    return {
      listBusy: (c, from, to) => {
        const key = `${c}|${from}|${to}`;
        const hit = this.entries.get(key);
        if (hit && this.now() - hit.at < this.ttlMs) return hit.busy;
        const busy = inner.listBusy(c, from, to);
        busy.catch(() => this.entries.delete(key)); // never cache a failure
        if (this.entries.size >= this.max) this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(key, { at: this.now(), busy });
        return busy;
      },
      getEvent: (c, id) => inner.getEvent(c, id),
      createEvent: (c, ev) => inner.createEvent(c, ev),
      deleteEvent: (c, id) => inner.deleteEvent(c, id),
    };
  }

  invalidate(calendarId: string) {
    for (const k of this.entries.keys()) if (k.startsWith(`${calendarId}|`)) this.entries.delete(k);
  }

  /** The real calendar, with every write dropping that calendar's cached availability. */
  writeThrough(inner: CalendarPort): CalendarPort {
    return {
      listBusy: (c, f, t) => inner.listBusy(c, f, t),
      getEvent: (c, id): Promise<CalendarEvent | null> => inner.getEvent(c, id),
      createEvent: async (c, ev: NewEvent) => { try { await inner.createEvent(c, ev); } finally { this.invalidate(c); } },
      deleteEvent: async (c, id) => { try { await inner.deleteEvent(c, id); } finally { this.invalidate(c); } },
    };
  }
}
