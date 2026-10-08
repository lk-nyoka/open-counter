// Owner accounts (Google sign-in + demo), the owner dashboard API, and the public customer API.
// Two sides that never mix: /api/merchant/* needs a signed-in owner and only ever returns that owner's
// businesses; /api/public/* returns what any customer may see (services, hours, free times) and nothing else.
import { DateTime } from "luxon";
import { BusinessSpecSchema, type BusinessSpec } from "./spec.js";
import type { Deps } from "./ports.js";
import type { D1Like } from "./adapters/d1.js";
import { book, cancel, checkAvailability, getBusinessInfo } from "./tools.js";
import { missing, sanitizeDraft } from "./interview.js";
import {
  clearCookie, encrypt, exchangeCode, getSession, googleAuthUrl, oauthConfigured, randomHex, readCookie, sessionCookie,
  sessionSecret, sign, verify, type OAuthEnv, type Session,
} from "./auth.js";
import {
  allow, bookingStats, countBusinesses, createDemoMerchant, deleteBusiness, getBooking, getBusiness, getMerchant, listBookings,
  listBusinesses, putBusiness, putDraft, takeDraft, updateBusiness, upsertGoogleMerchant, savePushSub, deletePushSub } from "./store.js";

export interface AccountsEnv extends OAuthEnv { DB: D1Like; SESSION_SECRET?: string; FRONTEND_ORIGINS?: string }
export interface AccountsCtx {
  resolve(slug: string): Promise<BusinessSpec | null>;
  deps(spec: BusinessSpec, channel: string): Deps;
  now(): Date;
  fetch?: typeof fetch;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
const err = (status: number, error: string, message: string) => json({ error, message }, status);
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "business";
const SESSION_DAYS = 30, DEMO_DAYS = 1;
const MAX_BUSINESSES = 500;

async function readJson(req: Request): Promise<any | null> {
  const t = await req.text();
  if (t.length > 50_000) return null;
  try { return t ? JSON.parse(t) : {}; } catch { return null; }
}
export const allowedOrigins = (env: { FRONTEND_ORIGINS?: string }) => (env.FRONTEND_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
/** Exact origins, or "https://*.example.com" for preview hosts with random subdomains. */
export function originAllowed(env: { FRONTEND_ORIGINS?: string }, origin: string | null | undefined): boolean {
  if (!origin) return false;
  return allowedOrigins(env).some((a) => {
    if (a === origin) return true;
    const w = /^(https?):\/\/\*\.(.+)$/.exec(a);
    if (!w) return false;
    try { const u = new URL(origin); return u.protocol === `${w[1]}:` && u.hostname.endsWith(`.${w[2]}`) && !u.port; } catch { return false; }
  });
}

/** Where to send the owner after sign-in: this site, or an allow-listed frontend (which receives the token in the URL fragment). */
function safeReturn(env: AccountsEnv, origin: string, ret: string | null | undefined): { url: string; external: boolean } {
  if (ret) {
    try {
      const u = new URL(ret, origin);
      if (u.origin === origin) return { url: u.pathname + u.search, external: false };
      if (originAllowed(env, u.origin)) return { url: u.toString(), external: true };
    } catch { /* fall through */ }
  }
  return { url: "/?s=owner", external: false };
}

/** Turn a finished interview draft into a business owned by this merchant. */
async function createBusiness(db: D1Like, ctx: AccountsCtx, merchantId: string, draftIn: unknown, calendar: "google" | "internal"): Promise<BusinessSpec | { error: string; message: string }> {
  const d = sanitizeDraft(draftIn);
  const gaps = missing({ ...d, askedVoice: true, askedRules: true });
  if (gaps.length) return { error: "incomplete", message: `Still missing: ${gaps.join(", ")}.` };
  if ((await countBusinesses(db)) >= MAX_BUSINESSES) return { error: "capacity", message: "This demo is at capacity." };
  const now = Math.floor(ctx.now().getTime() / 1000);
  for (let i = 0; i < 6; i++) {
    const slug = `${slugify(d.name!)}-${randomHex(2)}`;
    if (await ctx.resolve(slug)) continue;
    const spec = BusinessSpecSchema.parse({
      slug, name: d.name, timezone: d.timezone, currency: d.currency,
      calendarId: calendar === "google" ? `google:${merchantId}` : `internal:${slug}`,
      hours: d.hours, minNoticeMin: d.minNoticeMin ?? 60, bufferMin: d.bufferMin ?? 0, services: d.services,
    });
    if (await putBusiness(db, merchantId, spec, now)) return spec;
  }
  return { error: "slug_collision", message: "Could not create a unique address. Please try again." };
}

/** The demo business judges can explore without any Google account. */
const DEMO_TEMPLATE = {
  name: "Demo Salon", timezone: "Africa/Johannesburg", currency: "ZAR", minNoticeMin: 60, bufferMin: 10,
  hours: [1, 2, 3, 4, 5].map((day) => ({ day, open: "09:00", close: "17:00" })).concat([{ day: 6, open: "09:00", close: "13:00" }]),
  services: [
    { name: "Haircut", durationMin: 30, price: 150, bookableByVoice: true },
    { name: "Beard trim", durationMin: 15, price: 80, bookableByVoice: true },
    { name: "Wash and blow-dry", durationMin: 45, price: 220, bookableByVoice: true },
    { name: "Full colour", durationMin: 120, price: 650, bookableByVoice: false },
  ],
  askedVoice: true, askedRules: true,
};

/** A few sample bookings, so a judge opening the demo sees a working dashboard instead of zeros. Same rules, same calendar. */
const SAMPLES: [name: string, service: number, dayOffset: number, slot: number, channel: string][] = [
  ["Thandi (sample)", 0, 1, 1, "voice"], ["Sipho (sample)", 1, 1, 5, "mcp"], ["Lerato (sample)", 2, 2, 2, "web"],
  ["Ayanda (sample)", 0, 2, 9, "mcp"], ["Naledi (sample)", 2, 3, 6, "voice"],
];
async function seedSamples(spec: BusinessSpec, ctx: { deps: (s: BusinessSpec, channel: string) => Deps; now: () => Date }) {
  const voiceable = spec.services.filter((s) => s.bookableByVoice);
  if (!voiceable.length) return;
  let day = DateTime.fromJSDate(ctx.now(), { zone: spec.timezone });
  const days: string[] = [];
  while (days.length < 4) { day = day.plus({ days: 1 }); if (spec.hours.some((h) => h.day === day.weekday % 7)) days.push(day.toISODate()!); }
  for (const [name, si, d, slot, channel] of SAMPLES) {
    const svc = voiceable[si % voiceable.length];
    // The owner's own sample data: no read-back token or abuse limit applies to it.
    const deps = { ...ctx.deps(spec, channel), readBackSecret: undefined, limit: undefined };
    const av: any = await checkAvailability(spec, deps, { serviceId: svc.id, date: days[d - 1] });
    const start = av.slots?.[Math.min(slot, (av.slots?.length ?? 1) - 1)]?.start;
    if (start) await book(spec, deps, { serviceId: svc.id, start, customerName: name, customerConfirmed: true }).catch(() => undefined);
  }
}

function links(origin: string, spec: BusinessSpec) {
  return {
    assistant: `${origin}/?business=${spec.slug}&view=assistant`,
    booking: `${origin}/?business=${spec.slug}&view=booking`,
    mcp: `${origin}/mcp/${spec.slug}`,
    directory: `${origin}/mcp`,
  };
}

function calendarKind(spec: BusinessSpec): "google" | "internal" | "shared" {
  return spec.calendarId.startsWith("google:") ? "google" : spec.calendarId.startsWith("internal:") ? "internal" : "shared";
}

/** Day and week windows in the business's own time zone, as UTC strings for the ledger. */
function windows(spec: BusinessSpec, now: Date) {
  const t = DateTime.fromJSDate(now, { zone: spec.timezone });
  const u = (d: DateTime) => d.toUTC().toISO()!;
  return { todayFrom: u(t.startOf("day")), todayTo: u(t.endOf("day")), weekFrom: u(t.startOf("week")), weekTo: u(t.endOf("week")), now: u(t) };
}

/** Validate an owner's edit. The address (slug) and calendar link can never be changed from the outside. */
function applyEdit(spec: BusinessSpec, body: any): { spec?: BusinessSpec; message?: string } {
  const next: any = { ...spec };
  for (const k of ["name", "timezone", "currency", "hours", "minNoticeMin", "maxAdvanceDays", "slotGranularityMin", "bufferMin", "acceptingBookings", "listed"]) if (body[k] !== undefined) next[k] = body[k];
  if (typeof next.currency === "string") next.currency = next.currency.toUpperCase();
  if (body.services !== undefined) {
    if (!Array.isArray(body.services)) return { message: "services must be a list" };
    const used = new Set<string>();
    next.services = body.services.slice(0, 30).map((s: any) => {
      let id = typeof s?.id === "string" && /^[a-z0-9-]+$/.test(s.id) ? s.id : slugify(String(s?.name ?? "service"));
      for (let n = 2; used.has(id); n++) id = `${slugify(String(s?.name ?? "service"))}-${n}`;
      used.add(id);
      return { id, name: s?.name, durationMin: s?.durationMin, price: s?.price, bookableByVoice: s?.bookableByVoice !== false };
    });
  }
  if (typeof next.timezone === "string") { try { new Intl.DateTimeFormat("en", { timeZone: next.timezone }); } catch { return { message: "Unknown time zone." }; } }
  const p = BusinessSpecSchema.safeParse(next);
  if (!p.success) return { message: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 3).join("; ") };
  if (p.data.hours.some((h) => h.open >= h.close)) return { message: "Opening time must be before closing time." };
  return { spec: { ...p.data, slug: spec.slug, calendarId: spec.calendarId } };
}

export async function handleAccounts(req: Request, env: AccountsEnv, ctx: AccountsCtx): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const secret = sessionSecret(env);
  const nowSec = Math.floor(ctx.now().getTime() / 1000);
  const secure = url.protocol === "https:";
  const ip = req.headers.get("cf-connecting-ip") ?? "local";

  const startSession = async (merchantId: string, demo: boolean) => {
    const days = demo ? DEMO_DAYS : SESSION_DAYS;
    const token = await sign(secret, { m: merchantId, demo, exp: nowSec + days * 86_400 } satisfies Session);
    return { token, cookie: sessionCookie(token, days * 86_400, secure) };
  };

  // ---------------- Sign in ----------------

  if (path === "/api/auth/config" && req.method === "GET") return json({ google: oauthConfigured(env), demo: true });

  // Park a finished interview draft while the owner signs in. Returns the id to pass to /auth/google/start.
  if (path === "/api/drafts" && req.method === "POST") {
    const body = await readJson(req);
    if (!body) return err(400, "bad_request", "Invalid request.");
    if (!(await allow(env.DB, `draft:${ip}`, 30, 3600))) return err(429, "rate_limited", "Too many requests. Please wait a bit.");
    const d = sanitizeDraft(body.draft);
    const gaps = missing({ ...d, askedVoice: true, askedRules: true });
    if (gaps.length) return err(400, "incomplete", `Still missing: ${gaps.join(", ")}.`);
    const id = randomHex(16);
    await putDraft(env.DB, id, d, nowSec);
    return json({ draftId: id });
  }

  if (path === "/auth/google/start" && req.method === "GET") {
    if (!oauthConfigured(env)) return err(503, "google_not_configured", "Google sign-in is not set up on this deployment.");
    const nonce = randomHex(16);
    const draft = /^[a-f0-9]{32}$/.test(url.searchParams.get("draft") ?? "") ? url.searchParams.get("draft")! : undefined;
    const state = await sign(secret, { n: nonce, d: draft, r: url.searchParams.get("return") ?? undefined, exp: nowSec + 900 });
    const to = googleAuthUrl(env, `${url.origin}/auth/google/callback`, state, url.searchParams.get("hint") ?? undefined);
    return new Response(null, { status: 302, headers: { location: to, "set-cookie": `oc_oauth=${nonce}; Path=/auth/google; HttpOnly; SameSite=Lax; Max-Age=900${secure ? "; Secure" : ""}`, "cache-control": "no-store" } });
  }

  if (path === "/auth/google/callback" && req.method === "GET") {
    const page = (title: string, msg: string) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#FBF8F3;color:#1B1A17;margin:0}main{max-width:560px;margin:12vh auto;padding:0 16px}a{color:#A9601A}</style><main><h1>${title}</h1><p>${msg}</p><p><a href="/?s=setup">Back to setup</a></p></main>`, { status: 400, headers: { "content-type": "text/html; charset=utf-8" } });
    if (url.searchParams.get("error")) return page("Google sign-in was cancelled", "Nothing was changed. You can try again, or continue with the demo calendar.");
    const st = await verify<{ n: string; d?: string; r?: string; exp: number }>(secret, url.searchParams.get("state"), nowSec);
    if (!st || st.n !== readCookie(req, "oc_oauth")) return page("Sign-in expired", "That sign-in link is no longer valid. Please start again.");
    let id;
    try { id = await exchangeCode(env, url.searchParams.get("code") ?? "", `${url.origin}/auth/google/callback`, ctx.fetch); }
    catch (e) { console.error("oauth exchange failed", e); return page("Google sign-in failed", "Google did not accept the sign-in. Please try again."); }
    if (!id.scopes.includes("https://www.googleapis.com/auth/calendar.events")) return page("Calendar access is needed", "Please sign in again and tick the box that allows Open Counter to manage events in your calendar.");
    const merchantId = await upsertGoogleMerchant(env.DB, { id: randomHex(16), sub: id.sub, email: id.email, name: id.name, picture: id.picture, refreshEnc: id.refreshToken ? await encrypt(secret, id.refreshToken) : null }, nowSec);
    let welcome = "";
    if (st.d) {
      const draft = await takeDraft(env.DB, st.d, nowSec);
      if (draft) { const b = await createBusiness(env.DB, ctx, merchantId, draft, "google"); if ("slug" in b) welcome = b.slug; }
    }
    const { token, cookie } = await startSession(merchantId, false);
    const ret = safeReturn(env, url.origin, st.r);
    const dest = ret.external ? `${ret.url}#token=${encodeURIComponent(token)}${welcome ? `&welcome=${welcome}` : ""}` : `${ret.url}${ret.url.includes("?") ? "&" : "?"}${welcome ? `welcome=${welcome}` : "signedin=1"}`;
    const h = new Headers({ location: dest, "cache-control": "no-store" });
    h.append("set-cookie", cookie); h.append("set-cookie", clearCookie("oc_oauth", secure).replace("Path=/", "Path=/auth/google"));
    return new Response(null, { status: 302, headers: h });
  }

  // One click, no Google account: a demo owner with their own business on the built-in calendar. For judges and try-outs.
  if (path === "/api/auth/demo" && req.method === "POST") {
    const body = (await readJson(req)) ?? {};
    if (!(await allow(env.DB, `demo:${ip}`, 20, 3600))) return err(429, "rate_limited", "Too many demo sign-ins. Please wait a bit.");
    const merchantId = randomHex(16);
    await createDemoMerchant(env.DB, merchantId, nowSec);
    let draft: unknown = DEMO_TEMPLATE;
    if (typeof body.draftId === "string" && /^[a-f0-9]{32}$/.test(body.draftId)) draft = (await takeDraft(env.DB, body.draftId, nowSec)) ?? DEMO_TEMPLATE;
    const b = await createBusiness(env.DB, ctx, merchantId, draft, "internal");
    if (!("slug" in b)) return err(400, b.error, b.message);
    if (draft === DEMO_TEMPLATE && body.samples !== false) await seedSamples(b, ctx).catch((e) => console.error("demo samples failed", e));
    const { token, cookie } = await startSession(merchantId, true);
    return json({ token, merchant: await getMerchant(env.DB, merchantId), business: { slug: b.slug, name: b.name, links: links(url.origin, b) } }, 200, { "set-cookie": cookie });
  }

  if (path === "/api/auth/logout" && req.method === "POST") return json({ ok: true }, 200, { "set-cookie": clearCookie("oc_session", secure) });

  // ---------------- Owner side (signed in) ----------------

  if (path === "/api/me" || path.startsWith("/api/merchant/")) {
    const s = await getSession(req, secret, nowSec);
    if (!s) return err(401, "signed_out", "Please sign in.");
    const me = await getMerchant(env.DB, s.m);
    if (!me) return err(401, "signed_out", "Please sign in.");

    if (path === "/api/me" && req.method === "GET") {
      const businesses = await listBusinesses(env.DB, me.id);
      return json({ merchant: me, googleSignIn: oauthConfigured(env), businesses: businesses.map((b) => ({ slug: b.slug, name: b.name, acceptingBookings: b.acceptingBookings, calendar: calendarKind(b), links: links(url.origin, b) })) });
    }

    // This device wants a notification for every new booking (Web Push).
    if (path === "/api/merchant/push" && (req.method === "POST" || req.method === "DELETE")) {
      const body = await readJson(req);
      const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
      if (!/^https:\/\/[^\s]{10,1000}$/.test(endpoint)) return err(400, "bad_request", "Invalid subscription.");
      if (req.method === "DELETE") { await deletePushSub(env.DB, endpoint, me.id); return json({ ok: true }); }
      const p256dh = String(body?.keys?.p256dh ?? ""), auth = String(body?.keys?.auth ?? "");
      if (!/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) return err(400, "bad_request", "Invalid subscription keys.");
      await savePushSub(env.DB, me.id, { endpoint, p256dh, auth }, nowSec);
      return json({ ok: true });
    }

    // Create another business from a draft (owner already signed in).
    if (path === "/api/merchant/businesses" && req.method === "POST") {
      const body = await readJson(req);
      if (!body) return err(400, "bad_request", "Invalid request.");
      const b = await createBusiness(env.DB, ctx, me.id, body.draft, me.hasGoogle && body.calendar !== "internal" ? "google" : "internal");
      if (!("slug" in b)) return err(400, b.error, b.message);
      return json({ business: { ...b, calendar: calendarKind(b), links: links(url.origin, b) } }, 201);
    }

    const m = /^\/api\/merchant\/businesses\/([a-z0-9-]+)(\/.*)?$/.exec(path);
    if (!m) return err(404, "not_found", "Unknown endpoint.");
    const owned = await getBusiness(env.DB, m[1]);
    if (!owned || owned.merchantId !== me.id) return err(404, "not_found", "No such business on your account.");
    const spec = owned.spec;
    const sub = m[2] ?? "";

    if (sub === "" && req.method === "GET") return json({ business: { ...spec, calendar: calendarKind(spec), links: links(url.origin, spec) } });
    if (sub === "" && req.method === "PATCH") {
      const body = await readJson(req);
      if (!body) return err(400, "bad_request", "Invalid request.");
      const r = applyEdit(spec, body);
      if (!r.spec) return err(400, "invalid", r.message ?? "Invalid change.");
      await updateBusiness(env.DB, me.id, r.spec, nowSec);
      return json({ business: { ...r.spec, calendar: calendarKind(r.spec), links: links(url.origin, r.spec) } });
    }
    if (sub === "" && req.method === "DELETE") { await deleteBusiness(env.DB, me.id, spec.slug); return json({ ok: true }); }

    // Free times for the owner: every service, even ones customers can't book by voice, and even while paused.
    if (sub === "/availability" && req.method === "GET") {
      const r = await checkAvailability({ ...spec, services: spec.services.map((x) => ({ ...x, bookableByVoice: true })), acceptingBookings: true }, ctx.deps(spec, "owner"), { serviceId: url.searchParams.get("serviceId") ?? "", date: url.searchParams.get("date") ?? "" });
      return json(r, r.ok ? 200 : 400);
    }

    // Is the calendar link healthy? Google links in testing mode expire after 7 days; the dashboard offers to reconnect.
    if (sub === "/health" && req.method === "GET") {
      if (calendarKind(spec) !== "google") return json({ calendar: "ok", kind: calendarKind(spec) });
      try { const n = ctx.now(); await ctx.deps(spec, "owner").calendar.listBusy(spec.calendarId, n.toISOString(), new Date(n.getTime() + 3_600_000).toISOString()); return json({ calendar: "ok", kind: "google" }); }
      catch (e) { return json({ calendar: String((e as Error).message).includes("reconnect") ? "reconnect" : "error", kind: "google" }); }
    }

    if (sub === "/stats" && req.method === "GET") return json({ timezone: spec.timezone, currency: spec.currency, ...(await bookingStats(env.DB, spec.slug, windows(spec, ctx.now()))) });

    if (sub === "/bookings" && req.method === "GET") {
      const t = DateTime.fromJSDate(ctx.now(), { zone: spec.timezone });
      const d = (k: string, dflt: DateTime) => { const v = url.searchParams.get(k); const x = v ? DateTime.fromISO(v, { zone: spec.timezone }) : dflt; return (x.isValid ? x : dflt).toUTC().toISO()!; };
      const status = ["confirmed", "cancelled", "all"].includes(url.searchParams.get("status") ?? "") ? url.searchParams.get("status")! : "all";
      const rows = await listBookings(env.DB, spec.slug, { from: d("from", t.startOf("day")), to: d("to", t.plus({ days: 30 }).endOf("day")), status, limit: Number(url.searchParams.get("limit") ?? 200) });
      return json({ timezone: spec.timezone, bookings: rows.map((r) => ({ ...r, startLocal: DateTime.fromISO(r.start).setZone(spec.timezone).toFormat("ccc d LLL, HH:mm") })) });
    }

    // The owner books on a customer's behalf (walk-ins, phone calls). Same rules, same locks.
    if (sub === "/bookings" && req.method === "POST") {
      const body = await readJson(req);
      if (!body) return err(400, "bad_request", "Invalid request.");
      const r = await book({ ...spec, services: spec.services.map((x) => ({ ...x, bookableByVoice: true })), acceptingBookings: true }, ctx.deps(spec, "owner"), {
        serviceId: String(body.serviceId ?? ""), start: String(body.start ?? ""), customerName: String(body.customerName ?? ""),
        customerPhone: typeof body.customerPhone === "string" ? body.customerPhone : undefined, customerConfirmed: true,
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey.slice(0, 64) : undefined,
      });
      return json(r, r.ok ? 201 : 409);
    }

    const bc = /^\/bookings\/([0-9a-f]{32})\/cancel$/.exec(sub);
    if (bc && req.method === "POST") {
      const row = await getBooking(env.DB, spec.slug, bc[1]);
      if (!row) return err(404, "not_found", "No such booking.");
      const r = await cancel(spec, ctx.deps(spec, "owner"), { bookingId: bc[1] });
      return json(r, r.ok ? 200 : 409);
    }
    return err(404, "not_found", "Unknown endpoint.");
  }

  // ---------------- Customer side (public) ----------------

  const pm = /^\/api\/public\/businesses\/([a-z0-9-]+)(\/.*)?$/.exec(path);
  if (pm) {
    const spec = await ctx.resolve(pm[1]);
    if (!spec) return err(404, "not_found", "No such business.");
    const sub = pm[2] ?? "";
    if (sub === "" && req.method === "GET") return json({ ...getBusinessInfo(spec), slug: spec.slug });
    if (sub === "/availability" && req.method === "GET") {
      const r = await checkAvailability(spec, ctx.deps(spec, "web"), { serviceId: url.searchParams.get("serviceId") ?? "", date: url.searchParams.get("date") ?? "" });
      return json(r, r.ok ? 200 : 400);
    }
    if (sub === "/bookings" && req.method === "POST") {
      if (!(await allow(env.DB, `book:${ip}`, 20, 3600))) return err(429, "rate_limited", "Too many bookings from this connection. Please wait a bit.");
      const body = await readJson(req);
      if (!body) return err(400, "bad_request", "Invalid request.");
      const r = await book(spec, ctx.deps(spec, "web"), {
        serviceId: String(body.serviceId ?? ""), start: String(body.start ?? ""), customerName: String(body.customerName ?? ""),
        customerPhone: typeof body.customerPhone === "string" ? body.customerPhone : undefined, customerConfirmed: body.customerConfirmed === true,
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey.slice(0, 64) : undefined,
      });
      return json(r, r.ok ? 201 : 409);
    }
    // Cancel later with the short code and the name on the booking (what a person has, without the secret id).
    if (sub === "/cancel" && req.method === "POST") {
      const body = await readJson(req);
      const r = await cancel(spec, ctx.deps(spec, "web"), { code: String(body?.code ?? ""), customerName: String(body?.customerName ?? "") });
      return json(r, r.ok ? 200 : r.code === "rate_limited" ? 429 : 404);
    }
    const pc = /^\/bookings\/([0-9a-f]{32})\/cancel$/.exec(sub);
    if (pc && req.method === "POST") {
      const r = await cancel(spec, ctx.deps(spec, "web"), { bookingId: pc[1] });
      return json(r, r.ok ? 200 : 404);
    }
    return err(404, "not_found", "Unknown endpoint.");
  }
  return null;
}
