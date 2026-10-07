import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import type { BusinessSpec } from "./spec.js";
import type { Deps } from "./ports.js";
import { generateSlots, lockUnits, validateStart, type Refusal } from "./slots.js";

/** Tool results are structured data only: never calendar text. */

export type Fail = { ok: false; code: Refusal | string; message: string };

const fail = (code: Fail["code"], message: string): Fail => ({ ok: false, code, message });

const REFUSAL_TEXT: Record<Refusal, string> = {
  invalid_time: "Start must be an ISO 8601 date-time with offset, e.g. 2026-10-15T10:00:00+02:00.",
  not_on_grid: "Start time is not on this business's booking grid. Use a time returned by check_availability.",
  outside_hours: "That time is outside opening hours for this service.",
  too_soon: "That time is too soon; the business requires more notice.",
  too_far_ahead: "That date is further ahead than this business accepts bookings.",
  busy: "That time is no longer available.",
};

const DAY = 86_400_000;

function findService(spec: BusinessSpec, serviceId: string) {
  return spec.services.find((s) => s.id === serviceId);
}

export function getBusinessInfo(spec: BusinessSpec) {
  return {
    ok: true as const,
    name: spec.name,
    timezone: spec.timezone,
    currency: spec.currency,
    hours: spec.hours,
    minNoticeMin: spec.minNoticeMin,
    maxAdvanceDays: spec.maxAdvanceDays,
    services: spec.services.map((s) => ({ id: s.id, name: s.name, durationMin: s.durationMin, price: s.price, bookableByVoice: s.bookableByVoice })),
  };
}

export function getQuote(spec: BusinessSpec, serviceId: string) {
  const s = findService(spec, serviceId);
  if (!s) return fail("unknown_service", "Unknown service.");
  return {
    ok: true as const,
    serviceId: s.id,
    name: s.name,
    durationMin: s.durationMin,
    price: s.price,
    currency: spec.currency,
    bookableByVoice: s.bookableByVoice,
  };
}

export async function checkAvailability(spec: BusinessSpec, deps: Deps, input: { serviceId: string; date: string }) {
  const s = findService(spec, input.serviceId);
  if (!s) return fail("unknown_service", "Unknown service.");
  if (!s.bookableByVoice) return fail("not_bookable_by_voice", "This service cannot be booked by voice. Please contact the business.");
  const day = DateTime.fromISO(input.date, { zone: spec.timezone }).startOf("day");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !day.isValid) return fail("invalid_date", "Date must be YYYY-MM-DD.");

  const busy = await deps.calendar.listBusy(spec.calendarId, day.minus({ days: 1 }).toISO()!, day.plus({ days: 2 }).toISO()!);
  const slots = generateSlots(spec, s, input.date, busy, deps.now());
  return { ok: true as const, timezone: spec.timezone, serviceId: s.id, date: input.date, slots, count: slots.length };
}

export interface BookInput {
  serviceId: string;
  start: string;
  customerName: string;
  customerPhone?: string;
  /** Must be true only after the customer heard service, time and price read back and said yes. */
  customerConfirmed: boolean;
  /** Client-generated; retrying with the same key never creates a second booking. */
  idempotencyKey?: string;
}

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export async function book(spec: BusinessSpec, deps: Deps, input: BookInput) {
  const s = findService(spec, input.serviceId);
  if (!s) return fail("unknown_service", "Unknown service.");
  if (!s.bookableByVoice) return fail("not_bookable_by_voice", "This service cannot be booked by voice. Please contact the business.");
  if (input.customerConfirmed !== true) {
    return fail(
      "confirmation_required",
      `Read back to the customer: ${s.name}, ${input.start}, ${s.price} ${spec.currency}. Call again with customerConfirmed=true only after an explicit yes.`,
    );
  }
  const name = clean(input.customerName, 80);
  if (!name) return fail("invalid_name", "Customer name is required.");
  const phone = input.customerPhone ? clean(input.customerPhone, 30).replace(/[^0-9+()\- ]/g, "") : "";

  // 1. Pure rule checks first (no I/O).
  const pre = validateStart(spec, s, input.start, [], deps.now());
  if (!pre.ok) return fail(pre.reason, REFUSAL_TEXT[pre.reason]);

  const bookingId = input.idempotencyKey
    ? createHash("sha256").update(`${spec.slug}:${input.idempotencyKey}`).digest("hex").slice(0, 32)
    : deps.newId();
  const startIso = pre.start.toUTC().toISO()!;
  const endIso = pre.end.toUTC().toISO()!;
  // Retry of a booking that already succeeded: return it instead of tripping over our own event.
  if (input.idempotencyKey) {
    const prior = await deps.calendar.getEvent(spec.calendarId, bookingId);
    if (prior && Date.parse(prior.start) === pre.start.toMillis()) return confirmation(spec, bookingId, s.name, pre.start, pre.end, true);
  }
  const units = lockUnits(spec, startIso, endIso);
  const expires = Math.floor((Date.parse(endIso) + spec.bufferMin * 60_000 + DAY) / 1000);

  // 2. Claim every grid unit atomically. This is what stops two concurrent requests.
  const got = await deps.locks.acquire(spec.slug, units, bookingId, expires);
  if (!got) {
    // Same idempotency key retried after success? Return the original booking.
    const existing = await deps.calendar.getEvent(spec.calendarId, bookingId);
    if (existing && Date.parse(existing.start) === pre.start.toMillis()) return confirmation(spec, bookingId, s.name, pre.start, pre.end, true);
    return fail("slot_taken", "That time was just taken. Call check_availability again.");
  }

  try {
    // 3. Owner-made calendar events are not in our lock table, so re-check the calendar while holding the lock.
    const busy = await deps.calendar.listBusy(spec.calendarId, pre.start.minus({ days: 1 }).toISO()!, pre.end.plus({ days: 1 }).toISO()!);
    const post = validateStart(spec, s, input.start, busy, deps.now());
    if (!post.ok) {
      await deps.locks.release(spec.slug, units, bookingId);
      return fail(post.reason, REFUSAL_TEXT[post.reason]);
    }
    await deps.calendar.createEvent(spec.calendarId, {
      id: bookingId,
      summary: `${s.name} - ${name}`,
      description: [`Booked via Open Counter`, `Service: ${s.name}`, `Price: ${s.price} ${spec.currency}`, phone && `Phone: ${phone}`, `Booking: ${bookingId}`]
        .filter(Boolean)
        .join("\n"),
      start: startIso,
      end: endIso,
      timeZone: spec.timezone,
    });
  } catch (err) {
    // Never leave a lock behind for a booking that does not exist.
    await deps.locks.release(spec.slug, units, bookingId).catch(() => {});
    console.error("book failed", err);
    return fail("calendar_error", "Could not complete the booking. Nothing was booked; please try again.");
  }
  return confirmation(spec, bookingId, s.name, pre.start, pre.end, false);
}

function confirmation(spec: BusinessSpec, bookingId: string, service: string, start: DateTime, end: DateTime, replay: boolean) {
  const local = start.setZone(spec.timezone);
  return {
    ok: true as const,
    confirmed: true as const,
    replay,
    bookingId,
    service,
    start: local.toISO()!,
    end: end.setZone(spec.timezone).toISO()!,
    startLocal: local.toFormat("ccc d LLL yyyy, HH:mm"),
  };
}

/** The bookingId is a random bearer secret handed only to the customer who booked. */
export async function cancel(spec: BusinessSpec, deps: Deps, input: { bookingId: string }) {
  if (!/^[0-9a-f]{32}$/.test(input.bookingId)) return fail("not_found", "No such booking.");
  const ev = await deps.calendar.getEvent(spec.calendarId, input.bookingId);
  if (!ev) return fail("not_found", "No such booking.");
  if (Date.parse(ev.start) <= deps.now().getTime()) return fail("already_started", "This booking has already started and cannot be cancelled.");

  const units = lockUnits(spec, ev.start, ev.end);
  await deps.calendar.deleteEvent(spec.calendarId, input.bookingId);
  await deps.locks.release(spec.slug, units, input.bookingId); // free the slot for others right away
  return { ok: true as const, cancelled: true as const, bookingId: input.bookingId };
}
