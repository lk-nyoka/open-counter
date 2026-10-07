import { DateTime } from "luxon";
import type { BusinessSpec, Service } from "./spec.js";
import type { BusyInterval } from "./ports.js";

const MIN = 60_000;

export interface Slot {
  start: string; // ISO with business-timezone offset
  end: string;
  startLocal: string; // human-readable, business timezone
}

export type Refusal =
  | "invalid_time"
  | "outside_hours"
  | "not_on_grid"
  | "too_soon"
  | "too_far_ahead"
  | "busy";

function aligned(ms: number, spec: BusinessSpec): boolean {
  return ms % (spec.slotGranularityMin * MIN) === 0;
}

function windowsFor(spec: BusinessSpec, day: DateTime) {
  const dow = day.weekday % 7; // luxon: Mon=1..Sun=7 -> 0=Sunday
  return spec.hours
    .filter((h) => h.day === dow)
    .map((h) => {
      const [oh, om] = h.open.split(":").map(Number);
      const [ch, cm] = h.close.split(":").map(Number);
      return {
        open: day.set({ hour: oh, minute: om, second: 0, millisecond: 0 }),
        close: day.set({ hour: ch, minute: cm, second: 0, millisecond: 0 }),
      };
    });
}

function overlapsBusy(startMs: number, endMs: number, busy: BusyInterval[], bufferMin: number): boolean {
  // An appointment [s, e) also needs `buffer` free after it, and the previous one's buffer before it.
  const pad = bufferMin * MIN;
  return busy.some((b) => {
    const bs = Date.parse(b.start);
    const be = Date.parse(b.end);
    return bs < endMs + pad && be + pad > startMs;
  });
}

/** Enforce every owner rule on one candidate start. Used by BOTH check_availability and book,
 *  so a client can never book something check_availability would not have offered. */
export function validateStart(
  spec: BusinessSpec,
  service: Service,
  startIso: string,
  busy: BusyInterval[],
  now: Date,
): { ok: true; start: DateTime; end: DateTime } | { ok: false; reason: Refusal } {
  const start = DateTime.fromISO(startIso, { setZone: true });
  // Require an explicit offset: an offset-less time would silently be read in the server's zone (UTC on Lambda).
  if (!start.isValid || !/T.*(Z|[+-]\d{2}:?\d{2})$/.test(startIso)) return { ok: false, reason: "invalid_time" };
  const startMs = start.toMillis();
  if (!aligned(startMs, spec)) return { ok: false, reason: "not_on_grid" };

  const end = start.plus({ minutes: service.durationMin });
  const local = start.setZone(spec.timezone);
  const inHours = windowsFor(spec, local.startOf("day")).some(
    (w) => startMs >= w.open.toMillis() && end.toMillis() <= w.close.toMillis(),
  );
  if (!inHours) return { ok: false, reason: "outside_hours" };

  if (startMs < now.getTime() + spec.minNoticeMin * MIN) return { ok: false, reason: "too_soon" };
  if (startMs > now.getTime() + spec.maxAdvanceDays * 86_400_000) return { ok: false, reason: "too_far_ahead" };
  if (overlapsBusy(startMs, end.toMillis(), busy, spec.bufferMin)) return { ok: false, reason: "busy" };
  return { ok: true, start, end };
}

/** All bookable slots for a service on a local calendar date (YYYY-MM-DD in business timezone). */
export function generateSlots(
  spec: BusinessSpec,
  service: Service,
  date: string,
  busy: BusyInterval[],
  now: Date,
): Slot[] {
  const day = DateTime.fromISO(date, { zone: spec.timezone }).startOf("day");
  if (!day.isValid) return [];
  const out: Slot[] = [];
  for (const w of windowsFor(spec, day)) {
    for (let t = w.open; t.toMillis() < w.close.toMillis(); t = t.plus({ minutes: spec.slotGranularityMin })) {
      const r = validateStart(spec, service, t.toISO()!, busy, now);
      if (r.ok) out.push({ start: r.start.toISO()!, end: r.end.toISO()!, startLocal: r.start.toFormat("ccc d LLL yyyy, HH:mm") });
    }
  }
  return out;
}

/** Lock units: one per grid cell, as epoch-aligned UTC ISO strings. */
export function lockUnits(spec: BusinessSpec, startIso: string, endIso: string): string[] {
  const g = spec.slotGranularityMin * MIN;
  // [start, end + buffer): two bookings conflict exactly when the busy check would call them too close.
  const from = Date.parse(startIso);
  const to = Date.parse(endIso) + spec.bufferMin * MIN;
  const units: string[] = [];
  for (let t = Math.floor(from / g) * g; t < to; t += g) units.push(new Date(t).toISOString());
  return units;
}
