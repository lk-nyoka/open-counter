/**
 * Ports: everything the tools need from the outside world.
 * Tools depend only on these interfaces, so guardrails are testable without AWS or Google.
 */

/** A busy interval. Deliberately has NO title/description field: calendar text is untrusted
 *  and must never reach the model, so the type makes it impossible to pass along. */
export interface BusyInterval {
  start: string; // ISO8601
  end: string;
}

export interface CalendarEvent {
  id: string;
  start: string;
  end: string;
}

export interface NewEvent {
  id: string; // we choose it (= bookingId) so retries are idempotent
  summary: string;
  description: string;
  start: string;
  end: string;
  timeZone: string;
}

export interface CalendarPort {
  /** Free/busy only (no event text). */
  listBusy(calendarId: string, fromIso: string, toIso: string): Promise<BusyInterval[]>;
  /** Returns null if missing or cancelled. */
  getEvent(calendarId: string, eventId: string): Promise<CalendarEvent | null>;
  createEvent(calendarId: string, event: NewEvent): Promise<void>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

export interface LockPort {
  /**
   * Atomically claim every unit (all-or-nothing). Succeeds for units already owned by the
   * same bookingId, so a retry after a crash can resume.
   */
  acquire(businessId: string, units: string[], bookingId: string, expiresAtEpochSec: number): Promise<boolean>;
  /** Release units owned by bookingId. Units owned by someone else are left alone. */
  release(businessId: string, units: string[], bookingId: string): Promise<void>;
}

export interface Deps {
  calendar: CalendarPort;
  locks: LockPort;
  now: () => Date;
  newId: () => string;
}
