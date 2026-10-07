import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPatch, emptyDraft, missing, sanitizeDraft } from "./interview.js";

test("sanitizeDraft drops hostile or malformed input", () => {
  const d = sanitizeDraft({ name: "<b>Joe</b>\n\n", timezone: "Not/AZone", currency: "zar", minNoticeMin: -5, hours: [{ day: 9, open: "9am", close: "5pm" }, { day: 1, open: "17:00", close: "09:00" }, { day: 2, open: "09:00", close: "17:00" }], services: [{ name: "Cut", durationMin: 30, price: 10 }, { name: "Bad", durationMin: 0, price: 1 }] });
  assert.equal(d.name, "b Joe /b"); // angle brackets stripped
  assert.equal(d.timezone, undefined); assert.equal(d.currency, "ZAR"); assert.equal(d.minNoticeMin, undefined);
  assert.deepEqual(d.hours, [{ day: 2, open: "09:00", close: "17:00" }]);
  assert.deepEqual(d.services.map((s) => s.id), ["cut"]);
});

test("applyPatch: merge, replace-by-name, remove, warnings", () => {
  let { draft } = applyPatch(emptyDraft(), { name: "Joe", timezone: "Europe/London", currency: "gbp", addServices: [{ name: "Cut", durationMin: 30, price: 20 }, { name: "Cut", durationMin: 45, price: 25 }] });
  assert.equal(draft.services.length, 1); assert.equal(draft.services[0].durationMin, 45); assert.equal(draft.services[0].id, "cut");
  ({ draft } = applyPatch(draft, { addServices: [{ name: "Cut", durationMin: 5, price: 1 }, { name: "Beard", durationMin: 15, price: 10, neverByVoice: true }] }));
  assert.deepEqual(draft.services.map((s) => [s.id, s.bookableByVoice]), [["cut", true], ["beard", false]]);
  const w = applyPatch(draft, { timezone: "Mars/Base", removeServices: ["BEARD"], setHours: [{ day: 1, open: "bad", close: "17:00" }] });
  assert.equal(w.draft.timezone, "Europe/London"); assert.equal(w.draft.services.length, 1); assert.equal(w.warnings.length, 2);
});

test("missing: essentials first, then the two rule questions, which cannot loop forever", () => {
  const d = emptyDraft();
  assert.deepEqual(missing(d), ["name", "timezone", "currency", "services", "hours"]);
  Object.assign(d, { name: "J", timezone: "Europe/London", currency: "GBP", hours: [{ day: 1, open: "09:00", close: "17:00" }], services: [{ id: "a", name: "A", durationMin: 30, price: 1, bookableByVoice: true }] });
  assert.deepEqual(missing(d), ["voiceRule", "bookingRules"]);
  d.extra = 3; assert.deepEqual(missing(d), []);
});

import { heuristicPatch, applyPatch as _ap, emptyDraft as _ed } from "./interview.js";
test("backup parser reads the owner's plain words when the model garbles them", () => {
  const msg = `"Hi, I run a barber shop called Test Cuts." "We're in Johannesburg, South Africa. Prices are in rand." "Open Monday to Friday 9am to 6pm, and Saturday 10am to 4pm. Closed Sunday." "Services: Haircut, 30 minutes, R120. Beard trim, 15 minutes, R60. Haircut and beard, 45 minutes, R160. Hair colouring, 90 minutes, R450." If it asks about voice booking: "Hair colouring must never be booked by the assistant. People should call us for that." "Customers need to book at least 2 hours ahead, and leave 10 minutes between customers."`;
  const p = heuristicPatch(msg);
  assert.equal(p.timezone, "Africa/Johannesburg"); assert.equal(p.currency, "ZAR");
  const { draft } = _ap(_ed(), { ...p, timezone: '"Africa/Johannesburg","' });
  assert.equal(draft.timezone, "Africa/Johannesburg");
  assert.deepEqual(draft.services.map((s) => [s.name, s.durationMin, s.price]), [["Haircut", 30, 120], ["Beard trim", 15, 60], ["Haircut and beard", 45, 160], ["Hair colouring", 90, 450]]);
  assert.equal(draft.hours.length, 6);
  assert.deepEqual(draft.hours.find((h) => h.day === 6), { day: 6, open: "10:00", close: "16:00" });
  assert.deepEqual(draft.hours.find((h) => h.day === 1), { day: 1, open: "09:00", close: "18:00" });
  assert.equal(p.minNoticeMin, 120); assert.equal(p.bufferMin, 10);
});

test("backup parser handles bracketed services, curly quotes and en dashes", () => {
  const sv = heuristicPatch('Services: “Haircut (30 min, $35)”, “Beard trim (15 min, $15)”, “Color (60 min, $80)”, “Blowout (45 min, $50)”');
  const { draft } = _ap(_ed(), sv);
  assert.deepEqual(draft.services.map((s) => [s.name, s.durationMin, s.price]), [["Haircut", 30, 35], ["Beard trim", 15, 15], ["Color", 60, 80], ["Blowout", 45, 50]]);
  const h = heuristicPatch('Hours: "Mon–Fri 9 AM to 6 PM, Sat 10 AM to 4 PM" Rules: "2 hours notice, 24 hours cancellation, 10-minute gap between appointments"');
  const d2 = _ap(_ed(), h).draft;
  assert.equal(d2.hours.length, 6); assert.equal(h.minNoticeMin, 120); assert.equal(h.bufferMin, 10);
  assert.equal(heuristicPatch('"Africa/Johannesburg”,').timezone, "Africa/Johannesburg");
  assert.equal(heuristicPatch('Currency: "ZAR"').currency, "ZAR");
});

import { interviewTurn as _it } from "./interview.js";
test("a garbled model patch still yields a complete draft from the owner's own words", async () => {
  const garbage = { reply: "Recorded.", patch: undefined, name: "Test Salon", timezone: 'Africa/Johannesburg”, “currency”: “ZAR”,', addServices: [{ name: "Haircut", durationMin: "30 min", price: "$35" }], bufferMin: 0 };
  const ai: any = { run: async () => ({ response: garbage }) };
  const msg = 'Business name: "Test Salon" Services: "Haircut (30 min, $35)", "Beard trim (15 min, $15)", "Color (60 min, $80)", "Blowout (45 min, $50)" Hours: "Mon–Fri 9 AM to 6 PM, Sat 10 AM to 4 PM" Rules: "2 hours notice, 24 hours cancellation, 10-minute gap between appointments" Timezone: "Africa/Johannesburg" Currency: "ZAR"';
  const r = await _it(ai, ["m"], undefined, [], msg);
  assert.equal(r.draft.timezone, "Africa/Johannesburg");
  assert.equal(r.draft.currency, "ZAR");
  assert.equal(r.draft.bufferMin, 10);
  assert.equal(r.draft.minNoticeMin, 120);
  assert.deepEqual(r.draft.services.map((s) => s.name).sort(), ["Beard trim", "Blowout", "Color", "Haircut"]);
  assert.equal(r.draft.hours.length, 6);
  assert.ok(!/not a valid/.test(r.reply), r.reply);
});
