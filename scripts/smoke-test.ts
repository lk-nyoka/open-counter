// End-to-end check against a running Open Counter endpoint, using the real MCP client SDK.
//   MCP_API_URL=https://xxxx.execute-api.<region>.amazonaws.com/mcp  npx tsx scripts/smoke-test.ts [slug]
// Books and cancels a real appointment, so use a test calendar.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { randomUUID } from "node:crypto";

const base = (process.env.MCP_API_URL ?? "").replace(/\/$/, "");
const slug = process.argv[2] ?? "demo-barber";
if (!base) { console.error("Set MCP_API_URL (…/mcp, without the slug)"); process.exit(2); }

let failed = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${JSON.stringify(detail)}`}`);
  if (!cond) failed++;
};

const client = new Client({ name: "open-counter-smoke", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/${slug}`)));
const call = async (name: string, args: Record<string, unknown>) =>
  (await client.callTool({ name, arguments: args })).structuredContent as any;

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
check("tools/list has the four tools", ["book", "cancel", "check_availability", "get_quote"].every((t) => tools.includes(t)), tools);

// First Mon-Fri at least 3 days out (the demo spec is open weekdays).
const d = new Date(Date.now() + 3 * 86_400_000);
while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
const date = d.toISOString().slice(0, 10);

const quote = await call("get_quote", { serviceId: "haircut" });
check("get_quote", quote?.ok === true && quote.price > 0, quote);

// Latency of check_availability (includes Google round trip). First call may be a cold start.
const times: number[] = [];
let av: any;
for (let i = 0; i < 12; i++) { const t = performance.now(); av = await call("check_availability", { serviceId: "haircut", date }); times.push(performance.now() - t); }
check(`check_availability returns slots for ${date}`, av?.ok && av.count > 0, av);
const warm = times.slice(1).sort((a, b) => a - b);
const pct = (p: number) => Math.round(warm[Math.min(warm.length - 1, Math.floor(p * warm.length))]);
console.log(`INFO  check_availability latency: cold(first)=${Math.round(times[0])}ms warm p50=${pct(0.5)}ms p95=${pct(0.95)}ms (n=${warm.length}, from this machine)`);

const slot = av.slots[Math.floor(av.slots.length / 2)];
const req = { serviceId: "haircut", start: slot.start, customerName: "Smoke Test", customerConfirmed: true };

const unconfirmed = await call("book", { ...req, customerConfirmed: false });
check("book refuses without confirmation", unconfirmed?.code === "confirmation_required", unconfirmed);

const key = randomUUID();
const b1 = await call("book", { ...req, idempotencyKey: key });
check("book succeeds", b1?.ok === true && /^[0-9a-f]{32}$/.test(b1.bookingId ?? ""), b1);
console.log(`INFO  check your calendar now: "Haircut - Smoke Test" at ${slot.startLocal}`);

const dup = await call("book", { ...req, customerName: "Someone Else" });
check("double-booking the same slot is refused", dup?.ok === false && dup.code === "slot_taken", dup);

const overlap = await call("book", { ...req, start: new Date(Date.parse(slot.start) + 15 * 60_000).toISOString().replace("Z", "+00:00") });
check("overlapping offset booking is refused", overlap?.ok === false, overlap);

const retry = await call("book", { ...req, idempotencyKey: key });
check("retry with same idempotencyKey returns the same booking", retry?.ok && retry.bookingId === b1.bookingId, retry);

const after = await call("check_availability", { serviceId: "haircut", date });
check("booked slot no longer offered", !after.slots.some((s: any) => s.start === slot.start), after.count);

const voice = await call("book", { ...req, serviceId: "full-colour" });
check("voice-blocked service refused", voice?.code === "not_bookable_by_voice", voice);

const c = await call("cancel", { bookingId: b1.bookingId });
check("cancel succeeds", c?.ok === true, c);
const again = await call("book", { ...req, customerName: "After Cancel" });
check("slot is bookable again after cancel", again?.ok === true, again);
if (again?.bookingId) await call("cancel", { bookingId: again.bookingId }); // tidy up

await client.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
