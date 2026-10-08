import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BusinessSpec } from "./spec.js";
import type { Deps } from "./ports.js";
import { book, cancel, checkAvailability, getBusinessInfo, getQuote } from "./tools.js";
import { BOOKING_CARD_HTML, BOOKING_CARD_URI, MCP_APP_MIME } from "./ui/booking-card.js";

export const SERVER_VERSION = "0.3.0";

const wrap = (r: { ok: boolean } & Record<string, unknown>) => ({
  isError: !r.ok,
  content: [{ type: "text" as const, text: JSON.stringify(r) }],
  structuredContent: r,
});

// ---------- Output schemas (what a successful call returns). Refusals set isError and carry {ok:false, code, message, failedCheck}.
const Hour = z.object({ day: z.number().int().describe("0 = Sunday"), open: z.string(), close: z.string() });
const ServiceOut = z.object({ id: z.string(), name: z.string(), durationMin: z.number(), price: z.number(), bookableByVoice: z.boolean() });
const Slot = z.object({ start: z.string().describe("Pass exactly this to book"), end: z.string(), startLocal: z.string(), spoken: z.string().describe("e.g. '9 am', safe to say aloud") });
const Check = z.object({ id: z.string(), label: z.string(), ok: z.boolean() });

const INFO_OUT = {
  ok: z.boolean(), name: z.string(), timezone: z.string(), currency: z.string(), hours: z.array(Hour), minNoticeMin: z.number(),
  maxAdvanceDays: z.number(), acceptingBookings: z.boolean(), services: z.array(ServiceOut), hoursSummary: z.string(),
  summary: z.string().describe("A short description that is safe to say aloud"), businessId: z.string().optional(),
};
const QUOTE_OUT = { ok: z.boolean(), serviceId: z.string(), name: z.string(), durationMin: z.number(), price: z.number(), currency: z.string(), bookableByVoice: z.boolean() };
const AVAIL_OUT = {
  ok: z.boolean(), timezone: z.string(), serviceId: z.string(), service: z.string(), date: z.string(), day: z.string(),
  slots: z.array(Slot), count: z.number(), summary: z.string(),
  reason: z.enum(["past", "too_far_ahead", "closed", "fully_booked"]).optional().describe("Why there are no slots"),
  message: z.string().optional(),
  nextAvailable: z.object({ date: z.string(), start: z.string(), startLocal: z.string(), spoken: z.string() }).nullable().optional(),
};
const BOOK_OUT = {
  ok: z.boolean(), confirmed: z.boolean(), replay: z.boolean(), bookingId: z.string().describe("Secret code the customer needs to cancel"),
  business: z.string(), service: z.string(), customerName: z.string(), price: z.number(), currency: z.string(),
  start: z.string(), end: z.string(), startLocal: z.string(), when: z.string(), summary: z.string(),
  checks: z.array(Check).describe("Every rule the server checked before writing the booking"),
  businessId: z.string().optional(),
};
const CANCEL_OUT = { ok: z.boolean(), cancelled: z.boolean(), bookingId: z.string(), business: z.string(), summary: z.string() };

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const UI_META = { ui: { resourceUri: BOOKING_CARD_URI }, "ui/resourceUri": BOOKING_CARD_URI };

const FLOW = `How to book: (1) check_availability for the service and day; only offer times it returns, never invent one. ` +
  `(2) Call book with customerConfirmed=false (or read the details back yourself) and say the service, day, time and price to the customer. ` +
  `(3) Only after a clear yes, call book with customerConfirmed=true and an idempotencyKey (reuse it if you retry). ` +
  `Every result has a 'summary' (or 'message') written to be said aloud. A refusal names the rule that failed in 'failedCheck'; relay its message and offer 'nextAvailable' when present.`;

type Resolve = (business: string | undefined) => Promise<{ spec: BusinessSpec; deps: Deps } | { ok: false; code: string; message: string }>;

/** The five booking tools. Scoped servers serve one business; the directory server adds a `business` argument. */
function registerBookingTools(server: McpServer, resolve: Resolve, directory: boolean, nameForText: string) {
  const B: Record<string, z.ZodString> = directory ? { business: z.string().describe("The business id returned by find_business") } : {};
  const tagged = <T extends Record<string, unknown>>(r: T, slug: string) => (directory ? { ...r, businessId: slug } : r);
  const run = async (business: string | undefined, fn: (spec: BusinessSpec, deps: Deps) => Promise<{ ok: boolean } & Record<string, unknown>> | ({ ok: boolean } & Record<string, unknown>)) => {
    const r = await resolve(business);
    if ("ok" in r) return wrap(r);
    return wrap(await fn(r.spec, r.deps));
  };

  server.registerTool("get_business_info", {
    title: "Business details",
    description: `Opening hours, services with prices and durations, and booking rules for ${nameForText}. Call this before offering services or prices.`,
    inputSchema: { ...B }, outputSchema: INFO_OUT, annotations: READ,
  }, async (a: any) => run(a.business, (spec) => tagged(getBusinessInfo(spec), spec.slug)));

  server.registerTool("get_quote", {
    title: "Price of a service",
    description: `Price and duration of one service at ${nameForText}.`,
    inputSchema: { ...B, serviceId: z.string().describe("A service id from get_business_info") }, outputSchema: QUOTE_OUT, annotations: READ,
  }, async (a: any) => run(a.business, (spec) => getQuote(spec, a.serviceId)));

  server.registerTool("check_availability", {
    title: "Free times",
    description: `Free start times for one service on one day at ${nameForText}, read live from the business's calendar. ` +
      `If the day has no free times the result says why and gives nextAvailable.`,
    inputSchema: { ...B, serviceId: z.string().describe("A service id from get_business_info"), date: z.string().describe("YYYY-MM-DD in the business's local time") },
    outputSchema: AVAIL_OUT, annotations: READ, _meta: UI_META,
  }, async (a: any) => run(a.business, (spec, deps) => checkAvailability(spec, deps, a)));

  server.registerTool("book", {
    title: "Book an appointment",
    description: `Book an appointment at ${nameForText}. The customer must hear the service, day, time and price and say yes first: ` +
      `call with customerConfirmed=false to get the read-back, then again with customerConfirmed=true after an explicit yes. ` +
      `Use a start exactly as returned by check_availability. The server re-checks hours, notice, the calendar and the confirmation, and refuses if any fail.`,
    inputSchema: {
      ...B,
      serviceId: z.string(),
      start: z.string().describe("ISO 8601 with offset, exactly as returned by check_availability"),
      customerName: z.string().describe("The name to put on the booking"),
      customerPhone: z.string().optional().describe("Optional, shown only to the business owner"),
      customerConfirmed: z.boolean().describe("true only after the customer explicitly said yes to the read-back"),
      idempotencyKey: z.string().min(8).max(64).optional().describe("Reuse the same key when retrying so you never double-book"),
    },
    outputSchema: BOOK_OUT,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: UI_META,
  }, async (a: any) => run(a.business, async (spec, deps) => tagged(await book(spec, deps, a), spec.slug)));

  server.registerTool("cancel", {
    title: "Cancel a booking",
    description: `Cancel a booking at ${nameForText} using the bookingId that book returned. Confirm with the customer first.`,
    inputSchema: { ...B, bookingId: z.string().describe("The bookingId returned by book") },
    outputSchema: CANCEL_OUT,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    _meta: UI_META,
  }, async (a: any) => run(a.business, (spec, deps) => cancel(spec, deps, a)));

  server.registerResource("booking-card", BOOKING_CARD_URI, {
    title: "Booking card",
    description: "Shows free times, the read-back to confirm, and the booking receipt with every check the server ran.",
    mimeType: MCP_APP_MIME,
    _meta: { ui: { prefersBorder: false } },
  }, async () => ({ contents: [{ uri: BOOKING_CARD_URI, mimeType: MCP_APP_MIME, text: BOOKING_CARD_HTML, _meta: { ui: { prefersBorder: false } } }] }));
}

/** One business: /mcp/{slug}. Stateless: one server per request. */
export function buildServer(spec: BusinessSpec, deps: Deps): McpServer {
  const server = new McpServer(
    { name: `open-counter/${spec.slug}`, title: `${spec.name} bookings (Open Counter)`, version: SERVER_VERSION },
    { instructions: `Books appointments at ${spec.name} (${spec.timezone}). ${FLOW}` },
  );
  registerBookingTools(server, async () => ({ spec, deps }), false, spec.name);
  return server;
}

export interface Directory {
  search(query: string): Promise<BusinessSpec[]>;
  get(slug: string): Promise<BusinessSpec | null>;
  deps(spec: BusinessSpec): Deps;
}

/** Every listed business: /mcp. One assistant add-on can find and book any business on Open Counter. */
export function buildDirectoryServer(dir: Directory): McpServer {
  const server = new McpServer(
    { name: "open-counter", title: "Open Counter", version: SERVER_VERSION },
    { instructions: `Finds and books appointments at independent local businesses (barbers, salons, groomers, studios) on Open Counter. Start with find_business, then pass its 'business' id to the other tools. ${FLOW}` },
  );

  server.registerTool("find_business", {
    title: "Find a business",
    description: "Find businesses on Open Counter by name or by what they offer (for example 'haircut' or 'Corner Cuts'). Returns each business's id to use with the other tools.",
    inputSchema: { query: z.string().describe("A business name or a service, in the customer's words") },
    outputSchema: {
      ok: z.boolean(), count: z.number(), summary: z.string(),
      businesses: z.array(z.object({ business: z.string(), name: z.string(), services: z.array(z.string()), timezone: z.string(), acceptingBookings: z.boolean() })),
    },
    annotations: READ,
  }, async ({ query }) => {
    const found = await dir.search(query);
    if (!found.length) {
      const some = (await dir.search("")).slice(0, 5).map((s) => s.name);
      return wrap({ ok: false, code: "not_found", message: `No business on Open Counter matches "${query.slice(0, 60)}".${some.length ? ` Businesses on Open Counter include ${some.join(", ")}.` : ""}` });
    }
    const businesses = found.slice(0, 8).map((s) => ({ business: s.slug, name: s.name, services: s.services.filter((x) => x.bookableByVoice).map((x) => x.name), timezone: s.timezone, acceptingBookings: s.acceptingBookings }));
    return wrap({ ok: true, count: businesses.length, businesses, summary: businesses.length === 1 ? `Found ${businesses[0].name}, offering ${businesses[0].services.join(", ")}.` : `Found ${businesses.length} businesses: ${businesses.map((b) => b.name).join(", ")}.` });
  });

  registerBookingTools(server, async (slug) => {
    const spec = slug ? await dir.get(slug) : null;
    if (!spec) return { ok: false as const, code: "unknown_business", message: "Unknown business. Call find_business first and use its 'business' id." };
    return { spec, deps: dir.deps(spec) };
  }, true, "the chosen business");
  return server;
}

/** Simple, predictable matching: every word of the query must appear in the name or a service name. */
export function matchBusinesses(all: BusinessSpec[], query: string): BusinessSpec[] {
  const words = query.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !["a", "an", "the", "at", "in", "for", "book", "me", "appointment"].includes(w));
  if (!words.length) return all;
  const stem = (w: string) => w.replace(/(ing|es|s)$/, "");
  const scored = all.map((s) => {
    const hay = `${s.name} ${s.services.map((x) => x.name).join(" ")}`.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ");
    const hits = words.filter((w) => hay.includes(w) || hay.includes(stem(w))).length;
    return { s, hits, name: s.name.toLowerCase().includes(words.join(" ")) ? 1 : 0 };
  }).filter((x) => x.hits > 0);
  scored.sort((a, b) => b.name - a.name || b.hits - a.hits);
  return scored.map((x) => x.s);
}
