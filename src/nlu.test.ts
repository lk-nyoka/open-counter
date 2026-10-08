import { test } from "node:test";
import assert from "node:assert/strict";
import { BusinessSpecSchema } from "./spec.js";
import { parseUtterance, matchService, understand, parseTime } from "./nlu.js";
import { DateTime } from "luxon";

const spec = BusinessSpecSchema.parse({
  slug: "test-salon", name: "Test Salon", timezone: "Africa/Johannesburg", currency: "ZAR", calendarId: "c",
  hours: [1, 2, 3, 4, 5].map((day) => ({ day, open: "09:00", close: "18:00" })).concat([{ day: 6, open: "10:00", close: "16:00" }]),
  minNoticeMin: 120, bufferMin: 10,
  services: [
    { id: "haircut", name: "Haircut", durationMin: 30, price: 35 },
    { id: "beard-trim", name: "Beard trim", durationMin: 15, price: 15 },
    { id: "color", name: "Color", durationMin: 60, price: 80, bookableByVoice: false },
    { id: "blowout", name: "Blowout", durationMin: 45, price: 50 },
    { id: "haircut-and-beard", name: "Haircut and beard", durationMin: 45, price: 45 },
  ],
});
const now = new Date("2026-10-07T16:00:00Z"); // Wednesday 18:00 in Johannesburg
const p = (t: string, a: any = null) => parseUtterance(t, spec, now, a);

test("the caller's real sentences from the live test", () => {
  let r = p("Hi, I'd like to book an appointment tomorrow at 3pm for Nicola's with red color at 3pm.");
  assert.equal(r.intent, "book"); assert.equal(r.date, "2026-10-08"); assert.equal(r.time, "15:00"); assert.equal(r.serviceId, "color"); assert.equal(r.name, "Nicola");
  r = p("Hi, my name is Nicholas. I would like to book an appointment at 3 p.m. A beard trim at 3 p.m. afternoon.");
  assert.equal(r.serviceId, "beard-trim"); assert.equal(r.time, "15:00"); assert.equal(r.name, "Nicholas"); assert.equal(r.intent, "book");
  r = p("yes a haircut at 3 p.m. for Nicholas tomorrow.");
  assert.equal(r.serviceId, "haircut"); assert.equal(r.time, "15:00"); assert.equal(r.date, "2026-10-08"); assert.equal(r.name, "Nicholas");
  r = p("Okay, let's change the booking and make it at 2 p.m. for Nicholas.");
  assert.equal(r.time, "14:00"); assert.equal(r.intent, "book");
  r = p("Yes, a haircut and the price is fine. How much is it?");
  assert.equal(r.serviceId, "haircut"); assert.ok(r.yes);
});

test("services: exact, misspelt, compound and ambiguous", () => {
  assert.equal(matchService("a hair cut please", spec.services).id, "haircut");
  assert.equal(matchService("can I get a colour", spec.services).id, "color");
  assert.equal(matchService("just a trim", spec.services).id, "beard-trim");
  assert.equal(matchService("haircut and beard", spec.services).id, "haircut-and-beard");
  assert.equal(matchService("blow out", spec.services).id, "blowout");
  assert.deepEqual(matchService("something for my beard", spec.services).options?.sort(), ["beard-trim", "haircut-and-beard"]);
  assert.deepEqual(matchService("what are your hours", spec.services), {});
});

test("dates", () => {
  assert.equal(p("today").date, "2026-10-07");
  assert.equal(p("day after tomorrow").date, "2026-10-09");
  assert.equal(p("on Friday").date, "2026-10-09");
  assert.equal(p("next wednesday").date, "2026-10-14");
  assert.equal(p("Saturday morning").date, "2026-10-10");
  assert.equal(p("the 15th").date, "2026-10-15");
  assert.equal(p("the 3rd").date, "2026-11-03");
  assert.equal(p("15 October").date, "2026-10-15");
  assert.equal(p("October 20th").date, "2026-10-20");
  assert.equal(p("20/10").date, "2026-10-20");
  assert.equal(p("a haircut for 30 minutes").date, undefined);
});

test("times", () => {
  assert.equal(p("at 3").time, "15:00");
  assert.equal(p("10am").time, "10:00");
  assert.equal(p("10 a.m.").time, "10:00");
  assert.equal(p("half past two").time, "14:30");
  assert.equal(p("quarter to four").time, "15:45");
  assert.equal(p("2:15").time, "14:15");
  assert.equal(p("14:45").time, "14:45");
  assert.equal(p("noon").time, "12:00");
  assert.equal(p("three pm").time, "15:00");
  assert.equal(p("at eleven").time, "11:00");
  assert.equal(p("in the afternoon").partOfDay, "afternoon");
  assert.equal(p("3", "time").time, "15:00");
  assert.equal(p("2 thirty", "time").time, "14:30");
  assert.equal(p("a 30 minute haircut").time, undefined);
  assert.equal(p("for 2 people").time, undefined);
});

test("names are conservative", () => {
  assert.equal(p("I'm looking for a haircut").name, undefined);
  assert.equal(p("This is for tomorrow").name, undefined);
  assert.equal(p("it's Thandi Mokoena").name, "Thandi Mokoena");
  assert.equal(p("Sipho", "name").name, "Sipho");
  assert.equal(p("sipho dlamini please", "name").name, "Sipho Dlamini");
  assert.equal(p("tomorrow", "name").name, undefined);
  assert.equal(p("book a haircut for Friday").name, undefined);
});

test("intents, yes/no, choices, booking codes", () => {
  assert.equal(p("What services do you offer?").intent, "services");
  assert.equal(p("How much is a haircut?").intent, "price");
  assert.equal(p("What time do you open on Saturday?").intent, "hours");
  assert.equal(p("I need to cancel my booking").intent, "cancel");
  assert.ok(p("yes please").yes); assert.ok(p("no thanks").no); assert.ok(p("Yeah, go ahead").yes);
  assert.equal(p("the second one", "time").choice, 2);
  assert.equal(p("fc2cef7af5e7792a61ef18f7f2bb622d").bookingId, "fc2cef7af5e7792a61ef18f7f2bb622d");
});

test("the model only fills gaps, and invalid model output is ignored", async () => {
  const ai: any = { run: async () => ({ response: { intent: "book", service: "Haircut", date: "2030-01-01", time: "25:99", name: "Bob" } }) };
  const r = await understand(ai, ["m"], spec, "uhm the thing I had last time", now, null);
  assert.equal(r.intent, "book"); assert.equal(r.serviceId, "haircut");
  assert.equal(r.date, undefined, "a date past the booking window is rejected");
  assert.equal(r.time, undefined); assert.equal(r.name, undefined, "a name the caller never said is rejected");
  const broken: any = { run: async () => { throw new Error("model down"); } };
  const r2 = await understand(broken, ["m"], spec, "book a haircut tomorrow at 10am", now, null);
  assert.equal(r2.serviceId, "haircut"); assert.equal(r2.time, "10:00"); assert.equal(r2.usedModel, false);
});

test("the model can never invent a day or time the caller did not say (isiZulu request)", async () => {
  // A model that answers with a time nobody said, and the wrong day.
  const ai: any = { run: async () => ({ response: { intent: "book", service: "haircut", date: "2026-10-20", time: "09:00" } }) };
  const r = await understand(ai, ["m"], spec, "ngifuna ukugunda izinwele kusasa", now, null);
  assert.equal(r.time, undefined, "no time was said, so none is kept");
  assert.equal(r.date, DateTime.fromJSDate(now, { zone: spec.timezone }).plus({ days: 1 }).toISODate(), "kusasa = tomorrow, from the parser, not the model");
  const r2 = await understand(ai, ["m"], spec, "uhm the thing I had last time", now, null);
  assert.equal(r2.date, undefined); assert.equal(r2.time, undefined);
});

test("approximate times: 3ish, three-ish", () => {
  assert.equal(parseTime("can I get a haircut friday around 3ish").time, "15:00");
  assert.equal(parseTime("three-ish tomorrow").time, "15:00");
  assert.equal(parseTime("10ish in the morning").time, "10:00");
});
