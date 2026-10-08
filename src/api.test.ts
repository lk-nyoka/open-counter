// End to end through the real Worker code: interviewer -> publish -> MCP booking -> unpublish.
// The AI is a scripted fake; the database is real SQLite. Real model quality is NOT tested here.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.js";
import { d1Shim } from "./dev/d1-shim.js";
import { FakeAI } from "./dev/fake-ai.js";

const O = "https://t.example";
const mkEnv = (extra: Record<string, unknown> = {}) => ({ DB: d1Shim().d1, AI: new FakeAI(), DEMO_MODE: "1", ...extra }) as never;
const api = (env: never, path: string, body?: unknown, init: RequestInit = {}) =>
  worker.fetch(new Request(O + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", origin: O, ...(init.headers as object) }, body: body === undefined ? undefined : JSON.stringify(body), ...init }), env);
const mcp = async (env: never, slug: string, name: string, args: any = {}): Promise<any> => {
  // Behave like a well-behaved assistant: get the server's read-back (and its token) before confirming.
  if (name === "book" && args.customerConfirmed === true && !args.confirmationToken) {
    const rb = await mcp(env, slug, name, { ...args, customerConfirmed: false });
    if (rb?.confirmationToken) args = { ...args, confirmationToken: rb.confirmationToken };
  }
  const r = await worker.fetch(new Request(`${O}/mcp/${slug}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }), env);
  return (await r.json() as any).result.structuredContent;
};

async function runInterview(env: never) {
  let draft: unknown = undefined; const messages: { role: string; content: string }[] = [];
  const say = ["I run Sam's Barber in Johannesburg", "Rands. Haircut 30 min R120, full colour 2 hours R600", "Mon to Fri 9 to 5", "Colour should never be booked by voice", "1 hour notice, no gap"];
  let last: any;
  for (const text of say) {
    last = await (await api(env, "/api/interview", { draft, messages, text })).json();
    messages.push({ role: "user", content: text }, { role: "assistant", content: last.reply });
    draft = last.draft;
  }
  return last;
}

test("config and greeting", async () => {
  const c: any = await (await api(mkEnv(), "/api/config")).json();
  assert.equal(c.demo, true); assert.equal(c.ai, true);
  const g: any = await (await api(mkEnv(), "/api/interview", { text: "" })).json();
  assert.match(g.reply, /business called/);
});

test("interview completes with a valid draft and a readable summary", async () => {
  const r = await runInterview(mkEnv());
  assert.equal(r.complete, true, JSON.stringify(r.missing));
  assert.equal(r.draft.name, "Sam's Barber");
  assert.equal(r.draft.timezone, "Africa/Johannesburg");
  assert.equal(r.draft.hours.length, 5);
  assert.deepEqual(r.draft.services.map((s: any) => [s.id, s.bookableByVoice]), [["haircut", true], ["full-colour", false]]);
  assert.match(r.reply, /Haircut \(30 min, 120 ZAR\)/);
});

test("publish -> live MCP endpoint -> isolation -> unpublish", async () => {
  const env = mkEnv();
  const { draft } = await runInterview(env);
  const bad: any = await api(env, "/api/publish", { draft: { name: "x" } }); assert.equal(bad.status, 400);
  const pub: any = await (await api(env, "/api/publish", { draft })).json();
  assert.equal(pub.ok, true); assert.match(pub.slug, /^sam-s-barber-[0-9a-f]{4}$/); assert.match(pub.ownerKey, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(pub).includes("calendarId"));

  const info = await mcp(env, pub.slug, "get_business_info");
  assert.equal(info.name, "Sam's Barber");
  const av = await mcp(env, pub.slug, "check_availability", { serviceId: "haircut", date: "2026-10-12" });
  const start = av.slots[4].start;
  const b = await mcp(env, pub.slug, "book", { serviceId: "haircut", start, customerName: "Test", customerConfirmed: true });
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal((await mcp(env, pub.slug, "book", { serviceId: "haircut", start, customerName: "T2", customerConfirmed: true })).code, "slot_taken");
  assert.equal((await mcp(env, pub.slug, "book", { serviceId: "full-colour", start, customerName: "T3", customerConfirmed: true })).code, "not_bookable_by_voice");
  // the demo barber is a different business: same time stays free there
  const other = await mcp(env, "demo-barber", "book", { serviceId: "haircut", start, customerName: "Other", customerConfirmed: true });
  assert.equal(other.ok, true, JSON.stringify(other));

  assert.equal((await api(env, `/api/business/${pub.slug}`, undefined, { method: "DELETE", headers: { "x-owner-key": "0".repeat(64) } })).status, 404);
  assert.equal((await api(env, `/api/business/${pub.slug}`, undefined, { method: "DELETE", headers: { "x-owner-key": pub.ownerKey } })).status, 200);
  const gone = await worker.fetch(new Request(`${O}/mcp/${pub.slug}`, { method: "POST", body: "{}" }), env);
  assert.equal(gone.status, 404);
});

test("assistant endpoint: understanding only, and it never fails because of the model", async () => {
  const env = mkEnv();
  const r: any = await (await api(env, "/api/assistant", { business: "demo-barber", text: "I'd like to book a haircut tomorrow at 10am", awaiting: null })).json();
  assert.equal(r.intent, "book"); assert.equal(r.serviceId, "haircut"); assert.equal(r.time, "10:00"); assert.match(r.today, /^\d{4}-\d\d-\d\d$/);
  assert.equal((await api(env, "/api/assistant", { business: "nope", text: "hi" })).status, 404);
  assert.equal((await api(env, "/api/assistant", { business: "demo-barber", text: "" })).status, 400);
  for (const AI of [{ run: async () => ({ response: "I am not JSON at all" }) }, { run: async () => { throw new Error("5007: no such model"); } }, undefined]) {
    const res = await api(mkEnv({ AI }), "/api/assistant", { business: "demo-barber", text: "mmm the usual thing" });
    assert.equal(res.status, 200, "model trouble degrades to the parser, never an error");
    assert.equal(((await res.json()) as any).intent, "none");
  }
});

test("abuse controls: cross-origin, daily cap, hostile draft", async () => {
  const env = mkEnv({ AI_DAILY_CALLS: "2" });
  const evil = await worker.fetch(new Request(`${O}/api/interview`, { method: "POST", headers: { origin: "https://evil.example" }, body: JSON.stringify({ text: "hi" }) }), env);
  assert.equal(evil.status, 403);
  const post = async () => (await api(env, "/api/interview", { text: "hello" })).json() as Promise<any>;
  assert.equal((await post()).usedModel, true); assert.equal((await post()).usedModel, true);
  const third = await post(); assert.equal(third.usedModel, false, "over the daily AI cap the interview keeps working without the model");
  const cap = await api(env, "/api/ai-check"); assert.equal(cap.status, 429); assert.equal(((await cap.json()) as any).error, "daily_limit");

  const e2 = mkEnv();
  const r: any = await (await api(e2, "/api/interview", { text: "hi", draft: { name: "<script>alert(1)</script>Joe", timezone: "Not/AZone", currency: "zar", hours: new Array(40).fill({ day: 1, open: "09:00", close: "17:00" }), services: [{ name: "x", durationMin: 99999, price: -5 }] } })).json();
  assert.ok(!r.draft.name.includes("<")); assert.notEqual(r.draft.timezone, "Not/AZone"); assert.equal(r.draft.currency, "ZAR");
  assert.equal((await api(e2, "/api/interview", { text: "hi", draft: { hours: new Array(800).fill({ day: 1, open: "09:00", close: "17:00" }) } })).status, 400, "oversized body rejected");
  assert.ok(r.draft.hours.length <= 21); assert.equal(r.draft.services.length, 0);
});

test("ai-check and the failure detail make a bad model easy to diagnose", async () => {
  const ai = { run: async (m: string) => { if (m.includes("70b")) return { response: { say: "hi" } }; throw new Error(`model ${m} unavailable`); } };
  const env = mkEnv({ AI: ai });
  const r: any = await (await api(env, "/api/ai-check")).json();
  assert.ok(r.results.some((x: any) => x.ok && x.model.includes("70b")));
  assert.ok(r.results.some((x: any) => !x.ok && /unavailable/.test(x.error)));
});

test("transcribe: audio in, text out, with a vocabulary hint; bad input rejected", async () => {
  let seen: any;
  const ai = { run: async (m: string, input: any) => { seen = { m, input }; return { text: "  book a   haircut " }; } };
  const env = mkEnv({ AI: ai });
  const post = (len: number, qs = "?business=demo-barber&lang=en") => worker.fetch(new Request(`${O}/api/transcribe${qs}`, { method: "POST", headers: { origin: O, "content-type": "audio/webm" }, body: new Uint8Array(len).fill(7) }), env);
  const ok = await post(5000); const j: any = await ok.json();
  assert.equal(ok.status, 200); assert.equal(j.text, "book a haircut");
  assert.match(seen.m, /whisper/); assert.equal(seen.input.language, "en"); assert.equal(seen.input.vad_filter, true);
  assert.match(seen.input.initial_prompt, /Demo Barber.*Haircut/s);
  assert.equal(Buffer.from(seen.input.audio, "base64").length, 5000);
  assert.equal((await post(0)).status, 400); assert.equal((await post(2_100_000)).status, 400);
  const cross = await worker.fetch(new Request(`${O}/api/transcribe`, { method: "POST", headers: { origin: "https://evil.example" }, body: new Uint8Array(10) }), env);
  assert.equal(cross.status, 403);
});
