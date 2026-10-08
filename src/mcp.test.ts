// The MCP surface as an assistant host (Alexa+, Claude, any client) sees it: metadata, the booking card, the directory,
// voice-ready text, abuse limits and the availability cache. Runs through the real Worker with SQLite as D1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import worker from "./worker.js";
import { d1Shim } from "./dev/d1-shim.js";
import { FakeAI } from "./dev/fake-ai.js";
import { BusyCache } from "./adapters/cache.js";
import { MemoryCalendar } from "./adapters/memory.js";
import { matchBusinesses } from "./server.js";
import { purgeDemoData } from "./store.js";
import rawSpecs from "./specs.generated.js";
import { BusinessSpecSchema } from "./spec.js";

const O = "https://t.example";
const mkEnv = () => ({ DB: d1Shim().d1, AI: new FakeAI(), DEMO_MODE: "1" }) as never;
async function rpc(env: never, path: string, method: string, params: object = {}, headers: Record<string, string> = {}) {
  const r = await worker.fetch(new Request(`${O}${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), env);
  assert.equal(r.status, 200, `${path} ${method} -> ${r.status}`);
  return (await r.json() as any);
}
const call = async (env: never, path: string, name: string, args: object = {}, headers: Record<string, string> = {}) => (await rpc(env, path, "tools/call", { name, arguments: args }, headers)).result;
/** Next weekday (Mon-Fri) at least two days out, in Johannesburg. */
function nextWeekday(): string {
  let d = DateTime.now().setZone("Africa/Johannesburg").plus({ days: 2 });
  while (d.weekday > 5) d = d.plus({ days: 1 });
  return d.toISODate()!;
}
function nextSunday(): string {
  let d = DateTime.now().setZone("Africa/Johannesburg").plus({ days: 1 });
  while (d.weekday !== 7) d = d.plus({ days: 1 });
  return d.toISODate()!;
}

test("2025-11-25 server: instructions, titles, annotations, output schemas, and the booking card (MCP Apps)", async () => {
  const env = mkEnv();
  for (const path of ["/mcp/demo-barber", "/mcp"]) {
    const init = await rpc(env, path, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    assert.equal(init.result.protocolVersion, "2025-11-25");
    assert.match(init.result.instructions, /customerConfirmed=true/);
    assert.ok(init.result.capabilities.resources, "resources capability for the card");
    const { tools } = (await rpc(env, path, "tools/list")).result;
    for (const t of tools) {
      assert.ok(t.title, `${t.name} has a title`);
      assert.ok(t.annotations, `${t.name} has annotations`);
      assert.ok(t.outputSchema, `${t.name} has an outputSchema`);
    }
    const by = Object.fromEntries(tools.map((t: any) => [t.name, t]));
    assert.equal(by.check_availability.annotations.readOnlyHint, true);
    assert.equal(by.cancel.annotations.destructiveHint, true);
    assert.equal(by.book.annotations.readOnlyHint, false);
    assert.equal(by.book._meta.ui.resourceUri, "ui://open-counter/booking-card.html");
    assert.equal(by.book._meta["ui/resourceUri"], "ui://open-counter/booking-card.html");
    if (path === "/mcp") assert.ok(by.find_business && by.book.inputSchema.required.includes("business"));
    const res = (await rpc(env, path, "resources/read", { uri: "ui://open-counter/booking-card.html" })).result.contents[0];
    assert.equal(res.mimeType, "text/html;profile=mcp-app");
    assert.match(res.text, /ui\/initialize/);
    assert.doesNotMatch(res.text, /<script[^>]+src=/, "no external scripts in the card");
  }
});

test("voice-ready results: spoken times, a never-empty closed day, and a human read-back", async () => {
  const env = mkEnv();
  const P = "/mcp/demo-barber";
  const av = (await call(env, P, "check_availability", { serviceId: "haircut", date: nextWeekday() })).structuredContent;
  assert.ok(av.slots.length > 0);
  assert.equal(av.slots[0].spoken, "9 am");
  assert.match(av.summary, /free times for Haircut/);

  const sun = (await call(env, P, "check_availability", { serviceId: "haircut", date: nextSunday() })).structuredContent;
  assert.equal(sun.count, 0);
  assert.equal(sun.reason, "closed");
  assert.match(sun.message, /closed on Sundays\. The next free time is (tomorrow|Monday \d+ \w+) at 9 am\./);
  assert.ok(sun.nextAvailable.start);

  const rb = await call(env, P, "book", { serviceId: "haircut", start: av.slots[0].start, customerName: "Thandi", customerConfirmed: false });
  assert.equal(rb.isError, true);
  assert.equal(rb.structuredContent.failedCheck, "confirmed");
  assert.doesNotMatch(rb.structuredContent.message, /T\d\d:\d\d:\d\d/, "no ISO timestamp read aloud");
  assert.match(rb.structuredContent.message, /Haircut at Demo Barber .* at 9 am, 120 ZAR, for Thandi/);

  const ok = (await call(env, P, "book", { serviceId: "haircut", start: av.slots[0].start, customerName: "Thandi", customerConfirmed: true })).structuredContent;
  assert.equal(ok.confirmed, true);
  assert.match(ok.summary, /^Booked: Haircut at Demo Barber/);
  assert.equal(ok.checks.length, 8);
  const c = (await call(env, P, "cancel", { bookingId: ok.bookingId })).structuredContent;
  assert.match(c.summary, /Cancelled the booking at Demo Barber/);
  // Retrying with the key of a cancelled booking is a clear, non-retryable refusal, not a vague calendar error.
  const reuse = (await call(env, P, "book", { serviceId: "haircut", start: av.slots[0].start, customerName: "Thandi", customerConfirmed: true, idempotencyKey: "same-key-123" })).structuredContent;
  assert.equal(reuse.confirmed, true);
  await call(env, P, "cancel", { bookingId: reuse.bookingId });
  const again = (await call(env, P, "book", { serviceId: "haircut", start: av.slots[0].start, customerName: "Thandi", customerConfirmed: true, idempotencyKey: "same-key-123" })).structuredContent;
  assert.equal(again.code, "idempotency_key_reused");
});

test("directory: one endpoint finds and books any listed business, and never answers with nothing", async () => {
  const env = mkEnv();
  const found = (await call(env, "/mcp", "find_business", { query: "haircut" })).structuredContent;
  assert.equal(found.businesses[0].business, "demo-barber");
  const none = await call(env, "/mcp", "find_business", { query: "dentist" });
  assert.equal(none.isError, true);
  assert.match(none.structuredContent.message, /Businesses on Open Counter include Demo Barber/);
  const unknown = await call(env, "/mcp", "get_business_info", { business: "nope" });
  assert.equal(unknown.structuredContent.code, "unknown_business");
  const av = (await call(env, "/mcp", "check_availability", { business: "demo-barber", serviceId: "haircut", date: nextWeekday() })).structuredContent;
  const b = (await call(env, "/mcp", "book", { business: "demo-barber", serviceId: "haircut", start: av.slots[2].start, customerName: "Lee", customerConfirmed: true })).structuredContent;
  assert.equal(b.confirmed, true);
  assert.equal(b.businessId, "demo-barber");
  assert.equal(b.business, "Demo Barber (illustrative)");
  // Owners opt in; unlisted businesses stay out of the directory.
  const spec = BusinessSpecSchema.parse({ ...(rawSpecs[0] as object), slug: "hidden", name: "Hidden Studio", listed: false });
  assert.deepEqual(matchBusinesses([spec], "hidden").map((s) => s.slug), ["hidden"]);
  assert.deepEqual(matchBusinesses([spec], "haircuts").map((s) => s.slug), ["hidden"], "plural matches");
});

test("abuse limit: one customer name cannot fill a business's calendar", async () => {
  const env = mkEnv();
  const av = (await call(env, "/mcp/demo-barber", "check_availability", { serviceId: "haircut", date: nextWeekday() })).structuredContent;
  const results = [];
  for (let i = 0; i < 7; i++) {
    results.push((await call(env, "/mcp/demo-barber", "book", { serviceId: "haircut", start: av.slots[i * 3].start, customerName: "Spam Bot", customerConfirmed: true })).structuredContent);
  }
  assert.equal(results.filter((r) => r.confirmed).length, 5);
  assert.equal(results[6].code, "rate_limited");
});

test("availability cache: fast repeat reads, dropped on every write, failures never cached", async () => {
  let t = 0, reads = 0;
  const inner = new MemoryCalendar();
  const counting = { ...inner, listBusy: (c: string, f: string, to: string) => { reads++; return inner.listBusy(c, f, to); }, createEvent: inner.createEvent.bind(inner), deleteEvent: inner.deleteEvent.bind(inner), getEvent: inner.getEvent.bind(inner) };
  const cache = new BusyCache(30_000, () => t);
  const reader = cache.reader(counting), writer = cache.writeThrough(counting);
  await reader.listBusy("c", "a", "b"); await reader.listBusy("c", "a", "b");
  assert.equal(reads, 1);
  await writer.createEvent("c", { id: "x", summary: "", description: "", start: "2026-10-12T09:00:00Z", end: "2026-10-12T09:30:00Z", timeZone: "UTC" });
  assert.equal((await reader.listBusy("c", "a", "b")).length, 0); // re-read after the write
  assert.equal(reads, 2);
  t += 31_000; await reader.listBusy("c", "a", "b");
  assert.equal(reads, 3, "expires after the TTL");
  const failing = cache.reader({ ...counting, listBusy: async () => { throw new Error("down"); } });
  await assert.rejects(failing.listBusy("d", "a", "b"));
  await assert.rejects(failing.listBusy("d", "a", "b")); // not served from cache
});

test("housekeeping removes expired demo owners with their businesses and bookings, and nothing else", async () => {
  const { d1 } = d1Shim();
  const now = Math.floor(Date.now() / 1000);
  await d1.prepare("INSERT INTO merchants (id, demo, created_at, last_login) VALUES ('old', 1, ?1, ?1), ('new', 1, ?2, ?2), ('real', 0, ?1, ?1)").bind(now - 5 * 86_400, now).run();
  await d1.prepare("INSERT INTO businesses (slug, merchant_id, spec_json, created_at, updated_at) VALUES ('a', 'old', '{}', 0, 0), ('b', 'new', '{}', 0, 0), ('c', 'real', '{}', 0, 0)").bind().run();
  await d1.prepare("INSERT INTO bookings (id, business_slug, start_utc, end_utc, created_at) VALUES ('1', 'a', '', '', 0), ('2', 'c', '', '', 0)").bind().run();
  assert.equal(await purgeDemoData(d1 as never, now - 2 * 86_400), 1);
  const left = (await d1.prepare("SELECT slug FROM businesses ORDER BY slug").bind().all<{ slug: string }>()).results.map((r) => r.slug);
  assert.deepEqual(left, ["b", "c"]);
  const bookings = (await d1.prepare("SELECT id FROM bookings").bind().all<{ id: string }>()).results.map((r) => r.id);
  assert.deepEqual(bookings, ["2"]);
});
