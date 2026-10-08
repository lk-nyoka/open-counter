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

test("answering the voice question blocks the named service even if the model forgets to", async () => {
  const base = _ap(_ed(), { name: "Test Salon", timezone: "Africa/Johannesburg", currency: "ZAR", minNoticeMin: 120, bufferMin: 10, askedRules: true,
    setHours: [{ day: 1, open: "09:00", close: "18:00" }], addServices: [{ name: "Haircut", durationMin: 30, price: 35 }, { name: "Color", durationMin: 60, price: 80 }] }).draft;
  const ai: any = { run: async () => ({ response: { reply: "Recorded. (Note: \"x\" is not a valid IANA time zone.)" } }) };
  const r = await _it(ai, ["m"], base, [], "voice-booking rule allowed but no color booking have to contact store");
  assert.equal(r.draft.services.find((s) => s.name === "Color")!.bookableByVoice, false);
  assert.equal(r.draft.services.find((s) => s.name === "Haircut")!.bookableByVoice, true);
  assert.ok(r.draft.askedVoice); assert.ok(!/Note/.test(r.reply), r.reply);
  const r2 = await _it(ai, ["m"], base, [], "none, everything can be booked");
  assert.ok(r2.draft.askedVoice); assert.ok(r2.draft.services.every((s) => s.bookableByVoice));
});

test("business name is read from the owner's words when the model records nothing", () => {
  assert.equal(heuristicPatch('Business name: "Test Salon" Services: x').name, "Test Salon");
  assert.equal(heuristicPatch("Hi, I run a barber shop called Test Cuts. We are in Johannesburg").name, "Test Cuts");
});

const useless: any = { run: async () => ({ response: { reply: "Recorded everything!" } }) };
async function talk(ai: any, lines: string[]) {
  let draft: any; const history: any[] = []; let r: any;
  for (const text of lines) { r = await _it(ai, ["m"], draft, history, text); history.push({ role: "user", content: text }, { role: "assistant", content: r.reply }); draft = r.draft; }
  return r;
}

test("the owner's live messages complete the setup even with a model that records nothing", async () => {
  const r = await talk(useless, [
    'Business name: "Test Salon" Services: "Haircut (30 min, $35)", "Beard trim (15 min, $15)", "Color (60 min, $80)", "Blowout (45 min, $50)" Hours: "Mon–Fri 9 AM to 6 PM, Sat 10 AM to 4 PM" Rules: "2 hours notice, 24 hours cancellation, 10-minute gap between appointments" Timezone: "Africa/Johannesburg" Currency: "ZAR"',
    "voice booking allowed but no color booking, have to contact store",
  ]);
  assert.equal(r.complete, true, JSON.stringify(r.missing));
  assert.equal(r.draft.services.find((s: any) => s.name === "Color").bookableByVoice, false);
  assert.match(r.reply, /Great, here's everything/);
  assert.ok(!/Recorded everything/.test(r.reply), "the model's claims are never shown");
});

test("one question at a time, the guided way, with the model down", async () => {
  const down: any = { run: async () => { throw new Error("down"); } };
  let r = await _it(down, ["m"], undefined, [], "Hi, I run a barber shop called Test Cuts in Johannesburg");
  assert.match(r.reply, /Business: Test Cuts\. Time zone: Africa\/Johannesburg\. Currency: ZAR\. What services/);
  r = await talk(down, ["Hi, I run a barber shop called Test Cuts in Johannesburg", "Haircut 30 min R120, full colour 2 hours R600", "Weekdays 9 to 5", "Saturday 9 to 1", "Full colour needs a consultation, call us", "no rules"]);
  assert.equal(r.complete, true, JSON.stringify(r.missing));
  assert.equal(r.draft.hours.length, 6, "Saturday was added without wiping the weekdays");
  assert.deepEqual(r.draft.services.map((s: any) => [s.name, s.durationMin, s.price, s.bookableByVoice]), [["Haircut", 30, 120, true], ["Full colour", 120, 600, false]]);
});

test("re-listing services never re-allows voice booking", async () => {
  const relist: any = { run: async () => ({ response: { reply: "ok", addServices: [{ name: "Color", durationMin: 60, price: 80 }] } }) };
  const base = _ap(_ed(), { name: "S", timezone: "Africa/Johannesburg", currency: "ZAR", askedVoice: true, setHours: [{ day: 1, open: "09:00", close: "17:00" }], addServices: [{ name: "Color", durationMin: 60, price: 80, neverByVoice: true }] }).draft;
  const r = await _it(relist, ["m"], base, [], "thanks");
  assert.equal(r.draft.services[0].bookableByVoice, false);
});

import { voiceRules } from "./interview.js";
test("voice rules are understood anywhere, in many phrasings, and block only the right service", () => {
  const S = ["Haircut", "Beard trim", "Color", "Blowout"];
  const cases: [string, string[]][] = [
    ["voice booking allowed but no color booking, have to contact store", ["Color"]],
    ["Everything can be booked by voice except colour.", ["Color"]],
    ["Colouring can't be booked by the assistant; customers must call us first.", ["Color"]],
    ["Haircuts and blowouts are fine by voice, but colour needs an in-person consultation.", ["Color"]],
    ["We are a salon in Joburg. Our services are haircut 30 min R120 and colour 60 min R400. Please never let the AI book colour or blowouts, people must come in for a consult. Open Mon-Fri 9 to 5.", ["Color", "Blowout"]],
    ["All services can be booked by voice.", []],
    ["Haircut 30 min R120, beard trim 15 min R60", []],
  ];
  for (const [text, want] of cases) assert.deepEqual(voiceRules(text, S).blocked.sort(), want.sort(), text);
  assert.equal(voiceRules("All services can be booked by voice.", S).mentioned, true);
  assert.equal(voiceRules("Haircut 30 min R120, call us on 011 555 1234", S).mentioned, false);
});

test("a single paragraph with everything, voice rule included, completes the setup", async () => {
  const r = await talk(useless, ["I own Glow Studio in Cape Town. We charge in rand. Services: haircut 30 min R150, colour 90 min R650, blowout 45 min R200. We're open Monday to Friday 9am to 6pm and Saturday 9am to 2pm. Colour can never be booked by the voice assistant, clients must come in for a consultation first. We need 2 hours notice and 15 minutes between clients."]);
  assert.equal(r.complete, true, JSON.stringify(r.missing));
  assert.deepEqual(r.draft.services.filter((s: any) => !s.bookableByVoice).map((s: any) => s.name), ["Colour"]);
  assert.equal(r.draft.name, "Glow Studio"); assert.equal(r.draft.timezone, "Africa/Johannesburg"); assert.equal(r.draft.hours.length, 6);
  assert.equal(r.draft.minNoticeMin, 120); assert.equal(r.draft.bufferMin, 15);
});

test("one natural paragraph sets up a whole business with clean service names", async () => {
  const text = "I own Corner Cuts, a barbershop in Johannesburg, and we charge in rand. A haircut is 30 minutes for 150, a beard trim is 20 minutes for 80, and a colour treatment is 90 minutes for 450, but colour needs a consultation first so never book it by voice. We are open Monday to Friday 9 to 5 and Saturday 9 to 1. Customers must give 2 hours notice and I need 10 minutes between customers.";
  const r: any = await _it(undefined, [], {}, [], text);
  assert.deepEqual(r.draft.services.map((s: any) => [s.name, s.durationMin, s.price, s.bookableByVoice]), [["Haircut", 30, 150, true], ["Beard trim", 20, 80, true], ["Colour treatment", 90, 450, false]]);
  assert.equal(r.draft.name, "Corner Cuts");
  assert.equal(r.draft.currency, "ZAR");
  assert.equal(r.complete, true);
});
