// Cloudflare Workers entry (free plan).
//   /mcp/{slug}  MCP endpoint (Streamable HTTP, stateless)
//   /api/*       interviewer, assistant model proxy, publish
//   everything else is static files from ./public (the assets binding)
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { randomId } from "./util.js";
import { BusinessSpecSchema, type BusinessSpec } from "./spec.js";
import rawSpecs from "./specs.generated.js";
import { withEnv } from "./registry.js";
import { buildDirectoryServer, buildServer, matchBusinesses } from "./server.js";
import { BusyCache } from "./adapters/cache.js";
import { GoogleCalendar } from "./adapters/google.js";
import { D1Locks } from "./adapters/d1.js";
import { D1BookingLog, DbCalendar, RoutingCalendar } from "./adapters/ledger.js";
import { decrypt, sessionSecret, userAccessToken } from "./auth.js";
import { MemoryCalendar } from "./adapters/memory.js";
import { handleApi, type ApiEnv } from "./api.js";
import { originAllowed } from "./accounts.js";
import { DateTime } from "luxon";
import { sendPush, vapidFromEnv } from "./webpush.js";
import type { BookingLog } from "./ports.js";
import { pushSubsFor, deletePushSub } from "./store.js";
import { allow, getBusiness, getPublished, getRefreshEnc, listListed, purgeDemoData } from "./store.js";
import type { CalendarPort, Deps } from "./ports.js";

type Env = ApiEnv & { [k: string]: unknown };

const baseSpecs = rawSpecs.map((r) => BusinessSpecSchema.parse(r));
let fallback: CalendarPort | undefined;
/** Per-isolate availability cache (30 s). Booking never reads it. */
const busyCache = new BusyCache(30_000);
const CHANNELS = new Set(["voice", "web"]);

export default {
  /** Daily housekeeping (wrangler.toml [triggers]): demo accounts and their data expire after two days. */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const n = await purgeDemoData(env.DB, Math.floor(Date.now() / 1000) - 2 * 86_400);
    console.log("purged demo data", n);
  },

  async fetch(request: Request, env: Env, exec?: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    const url = new URL(request.url);

    // Demo mode keeps the shared demo calendar in memory. Owners' own businesses use their Google account or the D1 calendar.
    fallback ??= env.DEMO_MODE === "1" || !env.GOOGLE_SERVICE_ACCOUNT_JSON ? new MemoryCalendar() : new GoogleCalendar(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const secret = sessionSecret(env);
    const calendar = busyCache.writeThrough(new RoutingCalendar({
      internal: new DbCalendar(env.DB),
      fallback,
      google: env.GOOGLE_OAUTH_CLIENT_ID
        ? (merchantId) => new GoogleCalendar(undefined, {
            busyFromEvents: true,
            accessToken: () => userAccessToken(env, merchantId, async () => { const e = await getRefreshEnc(env.DB, merchantId); return e ? decrypt(secret, e) : null; }),
          })
        : undefined,
    }));
    const cachedReader = busyCache.reader(calendar);

    const strEnv = Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    const resolve = async (slug: string): Promise<BusinessSpec | null> =>
      baseSpecs.map((s) => withEnv(s, strEnv)).find((s) => s.slug === slug) ?? (await getBusiness(env.DB, slug))?.spec ?? (await getPublished(env.DB, slug));
    const now = () => new Date();
    const ip = request.headers.get("cf-connecting-ip") ?? "";
    const deps = (_spec: BusinessSpec, channel: string): Deps => ({
      calendar, locks: new D1Locks(env.DB), now, newId: randomId, log: withOwnerAlerts(new D1BookingLog(env.DB), _spec, env, (p) => (exec ? exec.waitUntil(p) : void p.catch(() => {}))), channel, calendarLabel: calendarLabel(_spec),
      // Google calendars are remote and slow-ish: serve availability from the short cache. The built-in calendar is D1 and already fast.
      availability: _spec.calendarId.startsWith("internal:") ? undefined : cachedReader,
      limit: (key, max, win) => allow(env.DB, key, max, win),
      // Per-connection limits only for our own pages; Alexa+ and other assistants share a few cloud IPs.
      client: channel === "voice" || channel === "web" ? ip : "",
    });
    const calendarLabel = (s: BusinessSpec) => s.calendarId.startsWith("internal:") ? "the built-in calendar" : s.calendarId.startsWith("google:") || !(fallback instanceof MemoryCalendar) ? "Google Calendar" : "the demo calendar";

    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return handleApi(request, env, { resolve, calendar, now, deps });

    const m = /^\/mcp(?:\/([a-z0-9-]+))?\/?$/.exec(url.pathname);
    if (!m) return new Response("Not found", { status: 404 });
    // MCP from an allow-listed frontend on another domain (the browser is the MCP client there too).
    const origin = request.headers.get("origin");
    const cors = origin && originAllowed(env, origin)
      ? { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type, accept, x-oc-channel, mcp-protocol-version, mcp-session-id", "access-control-allow-methods": "POST, GET, DELETE, OPTIONS", "access-control-expose-headers": "mcp-session-id", vary: "origin" }
      : null;
    if (request.method === "OPTIONS") return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
    const ch = request.headers.get("x-oc-channel") ?? "";
    const channel = CHANNELS.has(ch) ? ch : "mcp";
    const res = m[1]
      ? await serveMcp(request, m[1], resolve, deps)
      : await serveDirectory(request, {
          search: async (q) => matchBusinesses(await listedSpecs(env.DB, strEnv), q),
          get: async (slug) => (await listedSpecs(env.DB, strEnv)).find((x) => x.slug === slug) ?? null,
          deps: (spec) => deps(spec, channel),
        });
    if (!cors) return res;
    const h = new Headers(res.headers); for (const [k, v] of Object.entries(cors)) h.set(k, v);
    return new Response(res.body, { status: res.status, headers: h });
  }
};

const VIA: Record<string, string> = { mcp: "an AI assistant", voice: "your voice link", web: "your booking page" };

/**
 * The bookings ledger, plus a phone notification to the owner for every booking a customer makes
 * (not the ones the owner adds). Sent after the response, so it never slows a booking down.
 */
function withOwnerAlerts(log: BookingLog, spec: BusinessSpec, env: Env, later: (p: Promise<unknown>) => void): BookingLog {
  const vapid = vapidFromEnv(env as Record<string, string>);
  if (!vapid) return log;
  return {
    ...log,
    cancelled: log.cancelled.bind(log),
    findByPrefix: log.findByPrefix?.bind(log),
    async record(r) {
      await log.record(r);
      if (r.channel === "owner") return;
      later((async () => {
        const owner = await getBusiness(env.DB, spec.slug);
        if (!owner) return; // bundled demo businesses have no owner account
        const when = DateTime.fromISO(r.start).setZone(spec.timezone).toFormat("ccc d LLL, h:mm a");
        const message = { title: `New booking · ${spec.name}`, body: `${r.serviceName}, ${when}, for ${r.customerName}. Booked through ${VIA[r.channel] ?? "Open Counter"}.`, url: `/?s=owner&business=${spec.slug}`, tag: r.id };
        for (const s of await pushSubsFor(env.DB, owner.merchantId)) {
          const res = await sendPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, message, vapid).catch(() => "error" as const);
          if (res === "gone") await deletePushSub(env.DB, s.endpoint);
        }
      })().catch((e) => console.error("owner alert failed", e)));
    },
  };
}

/** Listed businesses: the bundled demo plus owners who opted in. Read per request (D1 is fast; the list is small). */
async function listedSpecs(db: Env["DB"], strEnv: Record<string, string>): Promise<BusinessSpec[]> {
  const own = await listListed(db).catch(() => []);
  const base = baseSpecs.map((s) => withEnv(s, strEnv)).filter((s) => s.listed);
  return [...base, ...own.filter((o) => !base.some((b) => b.slug === o.slug))];
}

async function serveDirectory(request: Request, dir: Parameters<typeof buildDirectoryServer>[0]): Promise<Response> {
  const server = buildDirectoryServer(dir);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

/** One stateless MCP server per request, for one business. */
async function serveMcp(request: Request, slug: string, resolve: (s: string) => Promise<BusinessSpec | null>, deps: (s: BusinessSpec, c: string) => Deps): Promise<Response> {
  const spec = await resolve(slug);
  if (!spec) return Response.json({ error: "unknown business" }, { status: 404 });
  // Our own pages tag their calls; anything else (Alexa+, Claude, any MCP client) counts as "mcp".
  const ch = request.headers.get("x-oc-channel") ?? "";
  const server = buildServer(spec, deps(spec, CHANNELS.has(ch) ? ch : "mcp"));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
