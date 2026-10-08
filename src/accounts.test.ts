// Owner accounts, the dashboard API and the public API, end to end through the real Worker.
// Google is faked at the network edge (globalThis.fetch), so the OAuth and Calendar code paths really run.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import worker from "./worker.js";
import { d1Shim } from "./dev/d1-shim.js";
import { FakeAI } from "./dev/fake-ai.js";
import { b64url } from "./auth.js";

const O = "https://t.example";
const SECRET = "x".repeat(40);
const CLIENT = "client-123.apps.googleusercontent.com";
const mk = (extra: Record<string, unknown> = {}) => {
  const db = d1Shim();
  return { env: { DB: db.d1, AI: new FakeAI(), DEMO_MODE: "1", SESSION_SECRET: SECRET, ...extra } as never, raw: db.raw };
};
const call = (env: never, path: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) =>
  worker.fetch(new Request(O + path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"), redirect: "manual",
    headers: { "content-type": "application/json", origin: O, ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }), env);
const cookieOf = (r: Response) => (r.headers.get("set-cookie") ?? "").split(/,(?=\s*oc_)/).map((c) => c.split(";")[0].trim()).filter((c) => c.startsWith("oc_session=")).join("; ");

// A bookable weekday at least two days out, in Johannesburg.
let day = DateTime.now().setZone("Africa/Johannesburg").plus({ days: 2 });
while (day.weekday > 5) day = day.plus({ days: 1 });
const DATE = day.toISODate()!;

const DRAFT = {
  name: "Glow Studio", timezone: "Africa/Johannesburg", currency: "ZAR", askedVoice: true, askedRules: true,
  hours: [1, 2, 3, 4, 5].map((d) => ({ day: d, open: "09:00", close: "17:00" })),
  services: [{ name: "Haircut", durationMin: 30, price: 150, bookableByVoice: true }, { name: "Colour", durationMin: 90, price: 600, bookableByVoice: false }],
};

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

test("demo owner: sign in, see only their business, take bookings from every channel, pause, edit, cancel", async () => {
  const { env } = mk();
  assert.equal((await call(env, "/api/me")).status, 401, "signed out");

  const d = await call(env, "/api/auth/demo", { body: {} });
  assert.equal(d.status, 200);
  const cookie = cookieOf(d);
  const demo: any = await d.json();
  const slug = demo.business.slug;
  assert.match(slug, /^demo-salon-[0-9a-f]{4}$/);
  assert.ok(demo.token && demo.business.links.mcp.endsWith(`/mcp/${slug}`));

  const me: any = await (await call(env, "/api/me", { cookie })).json();
  assert.equal(me.businesses.length, 1); assert.equal(me.businesses[0].calendar, "internal"); assert.equal(me.merchant.demo, true);

  // Customer side: public info and free times, no owner data.
  const info: any = await (await call(env, `/api/public/businesses/${slug}`)).json();
  assert.equal(info.name, "Demo Salon"); assert.ok(!("calendarId" in info));
  const av: any = await (await call(env, `/api/public/businesses/${slug}/availability?serviceId=haircut&date=${DATE}`)).json();
  assert.ok(av.slots.length > 20);
  const at = (hhmm: string) => av.slots.find((x: any) => x.start.slice(11, 16) === hhmm).start;
  const web: any = await (await call(env, `/api/public/businesses/${slug}/bookings`, { body: { serviceId: "haircut", start: at("09:00"), customerName: "Thandi", customerPhone: "082 555 0101", customerConfirmed: true } })).json();
  assert.equal(web.ok, true);
  const noConfirm = await call(env, `/api/public/businesses/${slug}/bookings`, { body: { serviceId: "haircut", start: at("10:00"), customerName: "X", customerConfirmed: false } });
  assert.equal(noConfirm.status, 409);

  // Any MCP client (e.g. Alexa+) and the voice page are tagged separately.
  const mcp = async (args: any, channel?: string): Promise<any> => {
    if (args.customerConfirmed === true && !args.confirmationToken) {
      const rb = await mcpRaw({ ...args, customerConfirmed: false }, channel);
      if (rb?.confirmationToken) args = { ...args, confirmationToken: rb.confirmationToken };
    }
    return mcpRaw(args, channel);
  };
  const mcpRaw = (args: object, channel?: string) => worker.fetch(new Request(`${O}/mcp/${slug}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(channel ? { "x-oc-channel": channel } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "book", arguments: args } }) }), env).then(async (r) => ((await r.json()) as any).result.structuredContent);
  assert.equal((await mcp({ serviceId: "haircut", start: at("11:00"), customerName: "Sipho", customerConfirmed: true }, "voice")).ok, true);
  assert.equal((await mcp({ serviceId: "beard-trim", start: at("13:00"), customerName: "Lerato", customerConfirmed: true })).ok, true);
  assert.equal((await mcp({ serviceId: "haircut", start: at("09:00"), customerName: "Double", customerConfirmed: true })).code, "slot_taken", "the D1 calendar blocks double booking");

  // Owner side.
  const list: any = await (await call(env, `/api/merchant/businesses/${slug}/bookings?from=${DATE}&to=${DATE}T23:59`, { cookie })).json();
  assert.deepEqual(list.bookings.map((b: any) => b.channel).sort(), ["mcp", "voice", "web"]);
  assert.equal(list.bookings.find((b: any) => b.channel === "web").customerPhone, "082 555 0101");
  const stats: any = await (await call(env, `/api/merchant/businesses/${slug}/stats`, { cookie })).json();
  assert.equal(stats.upcoming, 3); assert.deepEqual(stats.byChannel, { mcp: 1, voice: 1, web: 1 }); assert.ok(stats.next);

  // Walk-in booked by the owner, even for a service customers can't book by voice.
  const walk = await call(env, `/api/merchant/businesses/${slug}/bookings`, { cookie, body: { serviceId: "full-colour", start: at("14:00"), customerName: "Walk-in" } });
  assert.equal(walk.status, 201);

  // Cancel from the dashboard frees the slot.
  const target = list.bookings.find((b: any) => b.channel === "web");
  assert.equal((await call(env, `/api/merchant/businesses/${slug}/bookings/${target.id}/cancel`, { cookie, body: {} })).status, 200);
  const av2: any = await (await call(env, `/api/public/businesses/${slug}/availability?serviceId=haircut&date=${DATE}`)).json();
  assert.ok(av2.slots.some((s: any) => s.start === at("09:00")), "cancelled slot is free again");

  // Pause and edit.
  assert.equal((await call(env, `/api/merchant/businesses/${slug}`, { method: "PATCH", cookie, body: { acceptingBookings: false } })).status, 200);
  const paused: any = await (await call(env, `/api/public/businesses/${slug}/availability?serviceId=haircut&date=${DATE}`)).json();
  assert.equal(paused.code, "paused");
  const bad = await call(env, `/api/merchant/businesses/${slug}`, { method: "PATCH", cookie, body: { hours: [{ day: 1, open: "17:00", close: "09:00" }] } });
  assert.equal(bad.status, 400);
  const sneaky: any = await (await call(env, `/api/merchant/businesses/${slug}`, { method: "PATCH", cookie, body: { slug: "hijack", calendarId: "someone-else", name: "Glow" } })).json();
  assert.equal(sneaky.business.slug, slug); assert.equal(sneaky.business.calendarId, `internal:${slug}`); assert.equal(sneaky.business.name, "Glow");

  // Another owner cannot see or touch it.
  const other = cookieOf(await call(env, "/api/auth/demo", { body: {} }));
  assert.equal((await call(env, `/api/merchant/businesses/${slug}/bookings`, { cookie: other })).status, 404);
  assert.equal((await call(env, `/api/merchant/businesses/${slug}`, { method: "PATCH", cookie: other, body: { name: "x" } })).status, 404);

  // A forged or tampered session is rejected; logout clears the cookie.
  const forged = cookie.replace(/\.[^.]+$/, ".AAAA");
  assert.equal((await call(env, "/api/me", { cookie: forged })).status, 401);
  assert.equal((await call(env, "/api/me", { headers: { authorization: `Bearer ${demo.token}` } })).status, 200, "bearer tokens work for frontends on other domains");
  assert.match((await call(env, "/api/auth/logout", { body: {} })).headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("finished interview -> draft -> demo calendar: the owner's own business, voice rules kept", async () => {
  const { env } = mk();
  const bad = await call(env, "/api/drafts", { body: { draft: { name: "x" } } });
  assert.equal(bad.status, 400);
  const { draftId }: any = await (await call(env, "/api/drafts", { body: { draft: DRAFT } })).json();
  const r: any = await (await call(env, "/api/auth/demo", { body: { draftId } })).json();
  assert.match(r.business.slug, /^glow-studio-/);
  const cookie = `oc_session=${encodeURIComponent(r.token)}`;
  const b: any = await (await call(env, `/api/merchant/businesses/${r.business.slug}`, { cookie })).json();
  assert.equal(b.business.services.find((s: any) => s.name === "Colour").bookableByVoice, false);
});

test("Google: one click signs in, links the calendar, creates the business; bookings go to the owner's own calendar", async () => {
  const { env, raw } = mk({ GOOGLE_OAUTH_CLIENT_ID: CLIENT, GOOGLE_OAUTH_CLIENT_SECRET: "shh", DEMO_MODE: "0" });
  const seen: { url: string; auth?: string; body?: any }[] = [];
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const auth = new Headers(init.headers).get("authorization") ?? undefined;
    seen.push({ url, auth, body: init.body });
    if (url === "https://oauth2.googleapis.com/token") {
      const p = new URLSearchParams(String(init.body));
      if (p.get("grant_type") === "authorization_code") {
        assert.equal(p.get("code"), "good-code");
        const idt = `${b64url("{}")}.${b64url(JSON.stringify({ sub: "g-1", email: "owner@gmail.com", email_verified: true, name: "Owner", aud: CLIENT, iss: "https://accounts.google.com" }))}.sig`;
        return Response.json({ id_token: idt, refresh_token: "REFRESH-SECRET", access_token: "a1", expires_in: 3600, scope: "openid email profile https://www.googleapis.com/auth/calendar.events" });
      }
      assert.equal(p.get("refresh_token"), "REFRESH-SECRET");
      return Response.json({ access_token: "ACCESS-2", expires_in: 3600 });
    }
    if (url.includes("/calendars/primary/events?")) return Response.json({ timeZone: "Africa/Johannesburg", items: [{ status: "confirmed", start: { dateTime: `${DATE}T10:00:00+02:00` }, end: { dateTime: `${DATE}T11:00:00+02:00` } }, { status: "confirmed", transparency: "transparent", start: { dateTime: `${DATE}T12:00:00+02:00` }, end: { dateTime: `${DATE}T13:00:00+02:00` } }] });
    if (url.endsWith("/calendars/primary/events") && init.method === "POST") return Response.json({ id: JSON.parse(init.body).id });
    return new Response("unexpected " + url, { status: 500 });
  }) as typeof fetch;

  const { draftId }: any = await (await call(env, "/api/drafts", { body: { draft: DRAFT } })).json();
  const start = await call(env, `/auth/google/start?draft=${draftId}`);
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get("location")!);
  assert.equal(to.host, "accounts.google.com");
  assert.match(to.searchParams.get("scope")!, /calendar\.events/);
  assert.equal(to.searchParams.get("access_type"), "offline");
  const nonce = /oc_oauth=([0-9a-f]+)/.exec(start.headers.get("set-cookie")!)![1];
  const state = to.searchParams.get("state")!;

  // CSRF: a callback without our nonce cookie is refused.
  assert.equal((await call(env, `/auth/google/callback?code=good-code&state=${encodeURIComponent(state)}`)).status, 400);

  const cb = await call(env, `/auth/google/callback?code=good-code&state=${encodeURIComponent(state)}`, { cookie: `oc_oauth=${nonce}` });
  assert.equal(cb.status, 302);
  const loc = cb.headers.get("location")!;
  assert.match(loc, /^\/\?s=owner&welcome=glow-studio-/);
  const slug = /welcome=([a-z0-9-]+)/.exec(loc)![1];
  const cookie = cookieOf(cb);

  const me: any = await (await call(env, "/api/me", { cookie })).json();
  assert.equal(me.merchant.email, "owner@gmail.com"); assert.equal(me.merchant.hasGoogle, true);
  assert.equal(me.businesses[0].calendar, "google");
  const stored = raw.prepare("SELECT refresh_enc FROM merchants").get() as any;
  assert.ok(stored.refresh_enc && !stored.refresh_enc.includes("REFRESH-SECRET"), "refresh token is encrypted at rest");

  // Availability respects the owner's real calendar (10-11 busy; 12-13 marked 'free' does not block).
  const av: any = await (await call(env, `/api/public/businesses/${slug}/availability?serviceId=haircut&date=${DATE}`)).json();
  const times = av.slots.map((s: any) => s.start.slice(11, 16));
  assert.ok(!times.includes("10:00") && !times.includes("10:30") && times.includes("12:00") && times.includes("11:00"), times.join(","));
  const bk: any = await (await call(env, `/api/public/businesses/${slug}/bookings`, { body: { serviceId: "haircut", start: av.slots[0].start, customerName: "Thandi", customerConfirmed: true } })).json();
  assert.equal(bk.ok, true, JSON.stringify(bk));
  const insert = seen.find((s) => s.url.endsWith("/calendars/primary/events") && s.body);
  assert.equal(insert?.auth, "Bearer ACCESS-2", "written with the owner's own refreshed token");

  // Returning owner: sign in again, same account, no duplicate merchant.
  const again = await call(env, "/auth/google/start");
  const st2 = new URL(again.headers.get("location")!).searchParams.get("state")!;
  const n2 = /oc_oauth=([0-9a-f]+)/.exec(again.headers.get("set-cookie")!)![1];
  const cb2 = await call(env, `/auth/google/callback?code=good-code&state=${encodeURIComponent(st2)}`, { cookie: `oc_oauth=${n2}` });
  assert.match(cb2.headers.get("location")!, /^\/\?s=owner&signedin=1/);
  assert.equal((raw.prepare("SELECT count(*) AS c FROM merchants").get() as any).c, 1);
  globalThis.fetch = realFetch;
});

test("CORS only for allow-listed frontends", async () => {
  const { env } = mk({ FRONTEND_ORIGINS: "https://my-frontend.app" });
  const pre = await worker.fetch(new Request(`${O}/api/me`, { method: "OPTIONS", headers: { origin: "https://my-frontend.app" } }), env);
  assert.equal(pre.status, 204); assert.equal(pre.headers.get("access-control-allow-origin"), "https://my-frontend.app");
  const evil = await worker.fetch(new Request(`${O}/api/me`, { method: "OPTIONS", headers: { origin: "https://evil.example" } }), env);
  assert.equal(evil.status, 403);
  const demo = await worker.fetch(new Request(`${O}/api/auth/demo`, { method: "POST", headers: { origin: "https://my-frontend.app", "content-type": "application/json" }, body: "{}" }), env);
  assert.equal(demo.status, 200); assert.equal(demo.headers.get("access-control-allow-credentials"), "true");
  const evilPost = await worker.fetch(new Request(`${O}/api/auth/demo`, { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" }), env);
  assert.equal(evilPost.status, 403);
});

test("MCP and API from an allow-listed frontend on another domain, including wildcard preview hosts", async () => {
  const { env } = mk({ FRONTEND_ORIGINS: "https://my-frontend.app, https://*.preview.example" });
  const o = "https://abc123.preview.example";
  const pre = await worker.fetch(new Request(`${O}/mcp/demo-barber`, { method: "OPTIONS", headers: { origin: o, "access-control-request-headers": "content-type, x-oc-channel" } }), env);
  assert.equal(pre.status, 204); assert.match(pre.headers.get("access-control-allow-headers")!, /x-oc-channel/);
  const r = await worker.fetch(new Request(`${O}/mcp/demo-barber`, { method: "POST", headers: { origin: o, "content-type": "application/json", accept: "application/json, text/event-stream", "x-oc-channel": "voice" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_business_info", arguments: {} } }) }), env);
  assert.equal(r.headers.get("access-control-allow-origin"), o);
  assert.equal(((await r.json()) as any).result.structuredContent.ok, true);
  const bad = await worker.fetch(new Request(`${O}/mcp/demo-barber`, { method: "OPTIONS", headers: { origin: "https://preview.example.evil.com" } }), env);
  assert.equal(bad.status, 403);
  const api = await worker.fetch(new Request(`${O}/api/config`, { headers: { origin: o } }), env);
  assert.equal(api.headers.get("access-control-allow-origin"), o);
});
