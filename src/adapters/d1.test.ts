// Runs the real D1 lock SQL on a real SQLite engine (node:sqlite) via a tiny D1-shaped shim.
import { test } from "node:test";
import assert from "node:assert/strict";
import { d1Shim } from "../dev/d1-shim.js";
import { D1Locks, type D1Like } from "./d1.js";
import { BusinessSpecSchema } from "../spec.js";
import { memoryDeps } from "./memory.js";
import { book, cancel } from "../tools.js";

const shim = d1Shim;
const FAR = Math.floor(Date.now() / 1000) + 86_400;

test("D1 locks: all-or-nothing, same-owner resume, expiry, release only own", async () => {
  const { d1, raw } = shim();
  const L = new D1Locks(d1);
  assert.equal(await L.acquire("b", ["u1", "u2"], "A", FAR), true);
  assert.equal(await L.acquire("b", ["u2", "u3"], "B", FAR), false, "overlap on u2");
  assert.equal(raw.prepare("SELECT count(*) c FROM locks").get()!.c, 2, "failed claim must not insert u3");
  assert.equal(await L.acquire("b", ["u1", "u2"], "A", FAR), true, "same owner can resume");
  assert.equal(await L.acquire("other", ["u1"], "C", FAR), true, "different business is independent");
  await L.release("b", ["u1", "u2"], "B"); // not B's lock
  assert.equal(raw.prepare("SELECT count(*) c FROM locks WHERE business_id='b'").get()!.c, 2);
  await L.release("b", ["u1", "u2"], "A");
  assert.equal(raw.prepare("SELECT count(*) c FROM locks WHERE business_id='b'").get()!.c, 0);
  raw.prepare("INSERT INTO locks VALUES ('b','old','X',1)").run(); // long expired
  assert.equal(await L.acquire("b", ["old"], "Y", FAR), true, "expired lock can be taken");
});

const spec = BusinessSpecSchema.parse({
  slug: "t", name: "T", timezone: "Africa/Johannesburg", currency: "ZAR", calendarId: "cal",
  hours: [1, 2, 3, 4, 5].map((day) => ({ day, open: "09:00", close: "17:00" })),
  services: [{ id: "haircut", name: "Haircut", durationMin: 30, price: 120 }],
});

test("book/cancel with D1 locks: 10 concurrent requests, exactly one wins; cancel frees", async () => {
  const { d1, raw } = shim();
  const d = memoryDeps(() => new Date("2026-10-07T06:00:00Z"));
  const deps = { ...d, locks: new D1Locks(d1) };
  const req = (i: number, o = {}) => ({ serviceId: "haircut", start: "2026-10-15T10:00:00+02:00", customerName: `C${i}`, customerConfirmed: true, ...o });
  const res: any[] = await Promise.all(Array.from({ length: 10 }, (_, i) => book(spec, deps, req(i))));
  assert.equal(res.filter((r) => r.ok).length, 1);
  assert.equal(d.calendar.events.size, 1);
  assert.equal((await book(spec, deps, req(99, { start: "2026-10-15T10:15:00+02:00" }))).ok, false, "offset overlap refused");
  const won = res.find((r) => r.ok);
  assert.equal((await cancel(spec, deps, { bookingId: won.bookingId })).ok, true);
  assert.equal(raw.prepare("SELECT count(*) c FROM locks").get()!.c, 0);
  assert.equal((await book(spec, deps, req(100))).ok, true);
});
