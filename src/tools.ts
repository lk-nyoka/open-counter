import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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
    { id: "confirmed", label: "Confirmed after a read-back of these exact details", ok: true },
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
  /** Returned with the read-back. Required (when the server enforces read-back) to book exactly those details. */
  confirmationToken?: string;
}

/** How long a read-back stays valid: long enough for a person to answer, short enough not to be reused later. */
export const READBACK_TTL_MS = 15 * 60_000;

function readBackSig(secret: string, slug: string, serviceId: string, startMs: number, name: string, exp: number) {
  return createHmac("sha256", secret).update(`readback|${slug}|${serviceId}|${startMs}|${name.toLowerCase()}|${exp}`).digest("base64url").slice(0, 27);
}

/** A token that proves the server produced a read-back of exactly these details in the last 15 minutes. */
export function readBackToken(secret: string, slug: string, serviceId: string, startMs: number, name: string, nowMs: number) {
  const exp = Math.floor((nowMs + READBACK_TTL_MS) / 1000);
  return `${exp.toString(36)}.${readBackSig(secret, slug, serviceId, startMs, name, exp)}`;
}

export function checkReadBackToken(secret: string, token: string | undefined, slug: string, serviceId: string, startMs: number, name: string, nowMs: number) {
  if (!token) return false;
  const [e, sig] = token.split(".");
  const exp = parseInt(e ?? "", 36);
  if (!sig || !Number.isFinite(exp) || exp * 1000 < nowMs) return false;
  const want = Buffer.from(readBackSig(secret, slug, serviceId, startMs, name, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export async function book(spec: BusinessSpec, deps: Deps, input: BookInput) {
  const s = findService(spec, input.serviceId);
  if (!s) return fail("unknown_service", "Unknown service.");
  if (!s.bookableByVoice) return fail("not_bookable_by_voice", "This service cannot be booked by voice. Please contact the business.");
  if (!spec.acceptingBookings) return fail("paused", PAUSED);
  const name = clean(input.customerName, 80);
  // Rule checks that need no I/O come first, so a customer is never read back a booking that is bound to fail.
  const early = validateStart(spec, s, input.start, [], deps.now());
  if (!early.ok) return fail(early.reason, REFUSAL_TEXT[early.reason]);
  const startMs = early.start.toMillis();
  // The read-back. With deps.readBackSecret set (assistants and the voice page), the server issues a token bound to
  // these exact details and refuses to book without it: an assistant cannot skip the read-back, or read back one
  // thing and book another. The server cannot hear the customer; the assistant must still wait for their yes.
  const enforced = !!deps.readBackSecret;
  const tokenOk = enforced && checkReadBackToken(deps.readBackSecret!, input.confirmationToken, spec.slug, s.id, startMs, name, deps.now().getTime());
  if (input.customerConfirmed !== true || (enforced && !tokenOk)) {
    const when = sayWhen(early.start.setZone(spec.timezone), deps.now());
    const token = enforced ? readBackToken(deps.readBackSecret!, spec.slug, s.id, startMs, name, deps.now().getTime()) : undefined;
    const why = input.customerConfirmed === true
      ? (input.confirmationToken ? "This read-back has expired or does not match these details. " : "Nothing was booked: these details were not read back to the customer first. ")
      : "";
    return {
      ...fail("confirmation_required", `${why}Read this back to the customer and wait for a clear yes: ${s.name} at ${spec.name}, ${when}, ${s.price} ${spec.currency}${name ? `, for ${name}` : ""}. Then call book again with the same details, customerConfirmed=true${token ? " and this confirmationToken" : ""}.`),
      readBack: { business: spec.name, service: s.name, when, price: s.price, currency: spec.currency, customerName: name || null },
      ...(token ? { confirmationToken: token } : {}),
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

  // 1. Pure rule checks already passed above (no I/O).
  const pre = early;

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
    code: shortCode(bookingId),
    business: spec.name,
    service: s.name,
    customerName,
    price: s.price,
    currency: spec.currency,
    start: local.toISO()!,
    end: end.setZone(spec.timezone).toISO()!,
    startLocal: local.toFormat("ccc d LLL yyyy, HH:mm"),
    when,
    summary: `Booked: ${s.name} at ${spec.name}, ${when}, ${s.price} ${spec.currency}, for ${customerName}. The booking code is ${spokenCode(shortCode(bookingId))}; with the name, it is all they need to cancel.`,
  };
}

// ---------- Short booking codes: six characters a person can read out, e.g. "K7P-Q2M".
// Derived from the bookingId (its first 30 bits, Crockford base32: no I, L, O or U), so nothing new is stored.
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function shortCode(bookingId: string): string {
  const v = parseInt(bookingId.slice(0, 8), 16) >>> 2;
  let out = "";
  for (let i = 5; i >= 0; i--) out += B32[(v >>> (i * 5)) & 31];
  return `${out.slice(0, 3)}-${out.slice(3)}`;
}
/** Read a code however it was typed or heard: "k7p q2m", "K-7-P-Q-2-M", "k7pq2m". Returns the canonical form or null. */
export function normalizeCode(text: string): string | null {
  const t = text.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (!/^[0-9A-HJKMNP-TV-Z]{6}$/.test(t)) return null;
  return `${t.slice(0, 3)}-${t.slice(3)}`;
}
/** The 7-hex-digit prefix a code was made from (28 of its 30 bits), for an indexed lookup. */
function codePrefix(code: string): string {
  const raw = code.replace("-", "");
  let v = 0;
  for (const ch of raw) v = v * 32 + B32.indexOf(ch);
  return ((v << 2) >>> 0).toString(16).padStart(8, "0").slice(0, 7);
}
/** "K7P-Q2M" -> "K 7 P, Q 2 M": easier to hear and repeat. */
export const spokenCode = (code: string) => code.split("-").map((p) => p.split("").join(" ")).join(", ");
const firstName = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z ]/g, " ").trim().split(/\s+/)[0] ?? "";

/**
 * Cancel with the bookingId (a random bearer secret handed only to the customer), or with the short code plus the
 * name on the booking, which is what a person can say aloud. A wrong code or name gets the same "no such booking".
 */
export async function cancel(spec: BusinessSpec, deps: Deps, input: { bookingId?: string; code?: string; customerName?: string }) {
  if (!input.bookingId && input.code) {
    if (deps.limit && !(await deps.limit(`cancel:${spec.slug}${deps.client ? ":" + deps.client : ""}`, 20, 3600))) return fail("rate_limited", "Too many attempts. Please try again later.");
    const code = normalizeCode(input.code);
    const who = firstName(input.customerName ?? "");
    if (!code || !who) return fail("not_found", "No booking matches that code and name. Check the code, and give the name the booking was made under.");
    const rows = (await deps.log?.findByPrefix?.(spec.slug, codePrefix(code))) ?? [];
    const hit = rows.find((r) => shortCode(r.id) === code && firstName(r.customerName) === who);
    if (!hit) return fail("not_found", "No booking matches that code and name. Check the code, and give the name the booking was made under.");
    input = { bookingId: hit.id };
  }
  if (!input.bookingId || !/^[0-9a-f]{32}$/.test(input.bookingId)) return fail("not_found", "No such booking.");
  const ev = await deps.calendar.getEvent(spec.calendarId, input.bookingId);
  if (!ev) return fail("not_found", "No such booking.");
  if (Date.parse(ev.start) <= deps.now().getTime()) return fail("already_started", "This booking has already started and cannot be cancelled.");

  const units = lockUnits(spec, ev.start, ev.end);
  await deps.calendar.deleteEvent(spec.calendarId, input.bookingId);
  await deps.locks.release(spec.slug, units, input.bookingId); // free the slot for others right away
  await deps.log?.cancelled(spec.slug, input.bookingId, Math.floor(deps.now().getTime() / 1000)).catch((e) => console.error("ledger cancel failed", e));
  const when = sayWhen(DateTime.fromISO(ev.start).setZone(spec.timezone), deps.now());
  return { ok: true as const, cancelled: true as const, bookingId: input.bookingId, code: shortCode(input.bookingId), business: spec.name, summary: `Cancelled the booking at ${spec.name} for ${when}. The time is free again.` };
}
