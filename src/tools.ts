import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import type { BusinessSpec } from "./spec.js";
import type { Deps } from "./ports.js";
import { generateSlots, lockUnits, validateStart, type Refusal } from "./slots.js";

/** Tool results are structured data only: never calendar text. */

export type Fail = { ok: false; code: Refusal | string; message: string; failedCheck?: CheckId };

/** The rules every booking must pass, in the order the server checks them. Shown to people as a receipt. */
export type CheckId = "accepting" | "voice" | "open" | "notice" | "free" | "lock" | "confirmed" | "written";
const FAILED: Record<string, CheckId> = {
  paused: "accepting", not_bookable_by_voice: "voice", outside_hours: "open", not_on_grid: "open", invalid_time: "open",
  too_soon: "notice", too_far_ahead: "notice", busy: "free", slot_taken: "lock", confirmation_required: "confirmed", calendar_error: "written",
};
const fail = (code: Fail["code"], message: string): Fail => (FAILED[code] ? { ok: false, code, message, failedCheck: FAILED[code] } : { ok: false, code, message });

const mins = (m: number) => (m % 60 === 0 && m >= 60 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${m} minutes`);
const calendarName = (spec: BusinessSpec) => (spec.calendarId.startsWith("internal:") ? "the built-in calendar" : "Google Calendar");

/** Every check a confirmed booking passed. Only produced after the booking really succeeded. */
export function passedChecks(spec: BusinessSpec, serviceName: string, replay: boolean, label?: string): { id: CheckId; label: string; ok: true }[] {
  const cal = label ?? calendarName(spec);
  return [
    { id: "accepting", label: "The business is taking bookings", ok: true },
    { id: "voice", label: `${serviceName} can be booked by an assistant`, ok: true },
    { id: "open", label: "Inside opening hours", ok: true },
    { id: "notice", label: `At least ${mins(spec.minNoticeMin)} notice${spec.bufferMin ? `, ${spec.bufferMin} minutes between appointments` : ""}`, ok: true },
    { id: "free", label: `Free in ${cal}, re-checked while held`, ok: true },
    { id: "lock", label: "Slot locked so nobody else can take it", ok: true },
    { id: "confirmed", label: "Customer said yes to the read-back", ok: true },
    { id: "written", label: replay ? `Already in ${cal} (a safe retry, not a double booking)` : `Written to ${cal}`, ok: true },
  ];
}

const REFUSAL_TEXT: Record<Refusal, string> = {
  invalid_time: "Start must be an ISO 8601 date-time with offset, e.g. 2026-10-15T10:00:00+02:00.",
  not_on_grid: "Start time is not on this business's booking grid. Use a time returned by check_availability.",
  outside_hours: "That time is outside opening hours for this service.",
  too_soon: "That time is too soon; the business requires more notice.",
  too_far_ahead: "That date is further ahead than this business accepts bookings.",
  busy: "That time is no longer available.",
};

const DAY = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Times and days the way a person says them, so a voice assistant never reads out an ISO timestamp. */
export function sayClock(t: DateTime): string {
  return (t.minute === 0 ? t.toFormat("h a") : t.toFormat("h:mm a")).toLowerCase();
}
export function sayDay(day: DateTime, now: Date): string {
  const today = DateTime.fromJSDate(now, { zone: day.zoneName ?? undefined }).startOf("day");
  const d = day.startOf("day");
  const diff = Math.round(d.diff(today, "days").days);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return `${d.toFormat("cccc d LLLL")}`;
}
export const sayWhen = (t: DateTime, now: Date) => `${sayDay(t, now)} at ${sayClock(t)}`;
function hoursSummary(spec: BusinessSpec): string {
  const byDay = [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const w = spec.hours.filter((h) => h.day === d).map((h) => `${sayClock(DateTime.fromISO(`2000-01-01T${h.open}`))} to ${sayClock(DateTime.fromISO(`2000-01-01T${h.close}`))}`);
    return `${WEEKDAYS[d]} ${w.length ? w.join(" and ") : "closed"}`;
  });
  return byDay.join("; ");
}
/** Pick up to n times spread across the day, for a short spoken summary. */
function spread<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  return Array.from({ length: n }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (n - 1))]);
}
const PAUSED = "This business is not taking bookings through the assistant right now. Please contact them directly.";

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
    acceptingBookings: spec.acceptingBookings,
    services: spec.services.map((s) => ({ id: s.id, name: s.name, durationMin: s.durationMin, price: s.price, bookableByVoice: s.bookableByVoice })),
    hoursSummary: hoursSummary(spec),
    summary: `${spec.name} offers ${spec.services.map((s) => `${s.name} (${s.durationMin} minutes, ${s.price} ${spec.currency}${s.bookableByVoice ? "" : ", book directly with the business"})`).join(", ")}. Open ${hoursSummary(spec)}. Bookings need at least ${mins(spec.minNoticeMin)} notice.${spec.acceptingBookings ? "" : " Not taking assistant bookings right now."}`,
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
  if (!spec.acceptingBookings) return fail("paused", PAUSED);
  const day = DateTime.fromISO(input.date, { zone: spec.timezone }).startOf("day");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !day.isValid) return fail("invalid_date", "Date must be YYYY-MM-DD.");

  const reader = deps.availability ?? deps.calendar;
  const now = deps.now();
  const busy = await reader.listBusy(spec.calendarId, day.minus({ days: 1 }).toISO()!, day.plus({ days: 2 }).toISO()!);
  const slots = generateSlots(spec, s, input.date, busy, now).map((x) => ({ ...x, spoken: sayClock(DateTime.fromISO(x.start, { zone: spec.timezone })) }));
  const base = { ok: true as const, timezone: spec.timezone, serviceId: s.id, service: s.name, date: input.date, day: sayDay(day, now) };
  if (slots.length) {
    const some = spread(slots, 5).map((x) => x.spoken);
    return { ...base, slots, count: slots.length, summary: `${slots.length} free time${slots.length === 1 ? "" : "s"} for ${s.name} ${sayDay(day, now)}, including ${some.join(", ")}.` };
  }

  // Never an empty answer: say why, and offer the next free time (one calendar read for the next two weeks).
  const today = DateTime.fromJSDate(now, { zone: spec.timezone }).startOf("day");
  const closed = !spec.hours.some((h) => h.day === day.weekday % 7);
  const reason = day < today ? { code: "past", text: "That date has already passed." }
    : day > today.plus({ days: spec.maxAdvanceDays }) ? { code: "too_far_ahead", text: `${spec.name} only takes bookings up to ${spec.maxAdvanceDays} days ahead.` }
    : closed ? { code: "closed", text: `${spec.name} is closed on ${WEEKDAYS[day.weekday % 7]}s.` }
    : { code: "fully_booked", text: `There are no free times for ${s.name} ${sayDay(day, now)}.` };
  const from = DateTime.max(day.plus({ days: 1 }), today);
  const until = DateTime.min(from.plus({ days: 14 }), today.plus({ days: spec.maxAdvanceDays }));
  let next: (typeof slots)[number] | null = null;
  if (from <= until) {
    const ahead = await reader.listBusy(spec.calendarId, from.minus({ days: 1 }).toISO()!, until.plus({ days: 1 }).toISO()!);
    for (let d = from; d <= until && !next; d = d.plus({ days: 1 })) {
      const found = generateSlots(spec, s, d.toISODate()!, ahead, now)[0];
      if (found) next = { ...found, spoken: sayClock(DateTime.fromISO(found.start, { zone: spec.timezone })) };
    }
  }
  const nextAvailable = next ? { date: next.start.slice(0, 10), start: next.start, startLocal: next.startLocal, spoken: sayWhen(DateTime.fromISO(next.start, { zone: spec.timezone }), now) } : null;
  const message = `${reason.text} ${nextAvailable ? `The next free time is ${nextAvailable.spoken}.` : "There are no free times in the next two weeks; please contact the business."}`;
  return { ...base, slots: [], count: 0, reason: reason.code, message, summary: message, nextAvailable };
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
  if (!spec.acceptingBookings) return fail("paused", PAUSED);
  const name = clean(input.customerName, 80);
  if (input.customerConfirmed !== true) {
    const t = DateTime.fromISO(input.start, { setZone: true });
    const when = t.isValid ? sayWhen(t.setZone(spec.timezone), deps.now()) : input.start;
    return {
      ...fail("confirmation_required", `Read this back to the customer and wait for a clear yes: ${s.name} at ${spec.name}, ${when}, ${s.price} ${spec.currency}${name ? `, for ${name}` : ""}. Then call book again with customerConfirmed=true.`),
      readBack: { business: spec.name, service: s.name, when, price: s.price, currency: spec.currency, customerName: name || null },
    };
  }
  if (!name) return fail("invalid_name", "Customer name is required.");

  // Abuse limits: a business's calendar must not be fillable by a script.
  if (deps.limit) {
    const keys: [string, number, number][] = [[`book:${spec.slug}`, 40, 3600], [`book:${spec.slug}:${name.toLowerCase()}`, 5, 86_400]];
    if (deps.client) keys.push([`book:ip:${deps.client}`, 20, 3600]);
    for (const [k, max, win] of keys) {
      if (!(await deps.limit(k, max, win))) return fail("rate_limited", `${spec.name} has had too many bookings in a short time. Please try again later or contact the business directly.`);
    }
  }
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
    if (prior && Date.parse(prior.start) === pre.start.toMillis()) return confirmation(spec, deps, bookingId, s, name, pre.start, pre.end, true);
  }
  const units = lockUnits(spec, startIso, endIso);
  const expires = Math.floor((Date.parse(endIso) + spec.bufferMin * 60_000 + DAY) / 1000);

  // 2. Claim every grid unit atomically. This is what stops two concurrent requests.
  const got = await deps.locks.acquire(spec.slug, units, bookingId, expires);
  if (!got) {
    // Same idempotency key retried after success? Return the original booking.
    const existing = await deps.calendar.getEvent(spec.calendarId, bookingId);
    if (existing && Date.parse(existing.start) === pre.start.toMillis()) return confirmation(spec, deps, bookingId, s, name, pre.start, pre.end, true);
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
    if (/idempotency key already used/.test(String((err as Error)?.message))) {
      return fail("idempotency_key_reused", "That idempotencyKey belongs to a booking that was cancelled. Nothing was booked; retry with a new key.");
    }
    console.error("book failed", err);
    return fail("calendar_error", "Could not complete the booking. Nothing was booked; please try again.");
  }
  // The owner's ledger (dashboard). A ledger hiccup must not undo a booking that is already in the calendar.
  await deps.log?.record({
    id: bookingId, businessSlug: spec.slug, start: startIso, end: endIso, serviceId: s.id, serviceName: s.name, price: s.price,
    currency: spec.currency, customerName: name, customerPhone: phone || undefined, channel: deps.channel ?? "mcp",
  }).catch((e) => console.error("booking ledger write failed", e));
  return confirmation(spec, deps, bookingId, s, name, pre.start, pre.end, false);
}

function confirmation(spec: BusinessSpec, deps: Deps, bookingId: string, s: { name: string; price: number }, customerName: string, start: DateTime, end: DateTime, replay: boolean) {
  const local = start.setZone(spec.timezone);
  const when = sayWhen(local, deps.now());
  return {
    checks: passedChecks(spec, s.name, replay, deps.calendarLabel),
    ok: true as const,
    confirmed: true as const,
    replay,
    bookingId,
    business: spec.name,
    service: s.name,
    customerName,
    price: s.price,
    currency: spec.currency,
    start: local.toISO()!,
    end: end.setZone(spec.timezone).toISO()!,
    startLocal: local.toFormat("ccc d LLL yyyy, HH:mm"),
    when,
    summary: `Booked: ${s.name} at ${spec.name}, ${when}, ${s.price} ${spec.currency}, for ${customerName}. Keep the bookingId to cancel later.`,
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
  await deps.log?.cancelled(spec.slug, input.bookingId, Math.floor(deps.now().getTime() / 1000)).catch((e) => console.error("ledger cancel failed", e));
  const when = sayWhen(DateTime.fromISO(ev.start).setZone(spec.timezone), deps.now());
  return { ok: true as const, cancelled: true as const, bookingId: input.bookingId, business: spec.name, summary: `Cancelled the booking at ${spec.name} for ${when}. The time is free again.` };
}
