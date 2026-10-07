// Cloudflare Workers entry (free plan).
//   /mcp/{slug}  MCP endpoint (Streamable HTTP, stateless)
//   /api/*       interviewer, assistant model proxy, publish
//   everything else is static files from ./public (the assets binding)
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { randomId } from "./util.js";
import { BusinessSpecSchema, type BusinessSpec } from "./spec.js";
import rawSpecs from "./specs.generated.js";
import { withEnv } from "./registry.js";
import { buildServer } from "./server.js";
import { GoogleCalendar } from "./adapters/google.js";
import { D1Locks } from "./adapters/d1.js";
import { D1BookingLog, DbCalendar, RoutingCalendar } from "./adapters/ledger.js";
import { decrypt, sessionSecret, userAccessToken } from "./auth.js";
import { MemoryCalendar } from "./adapters/memory.js";
import { handleApi, type ApiEnv } from "./api.js";
import { getBusiness, getPublished, getRefreshEnc } from "./store.js";
import type { CalendarPort, Deps } from "./ports.js";

type Env = ApiEnv & { [k: string]: unknown };

const baseSpecs = rawSpecs.map((r) => BusinessSpecSchema.parse(r));
let fallback: CalendarPort | undefined;
const CHANNELS = new Set(["voice", "web"]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Demo mode keeps the shared demo calendar in memory. Owners' own businesses use their Google account or the D1 calendar.
    fallback ??= env.DEMO_MODE === "1" || !env.GOOGLE_SERVICE_ACCOUNT_JSON ? new MemoryCalendar() : new GoogleCalendar(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const secret = sessionSecret(env);
    const calendar = new RoutingCalendar({
      internal: new DbCalendar(env.DB),
      fallback,
      google: env.GOOGLE_OAUTH_CLIENT_ID
        ? (merchantId) => new GoogleCalendar(undefined, {
            busyFromEvents: true,
            accessToken: () => userAccessToken(env, merchantId, async () => { const e = await getRefreshEnc(env.DB, merchantId); return e ? decrypt(secret, e) : null; }),
          })
        : undefined,
    });

    const strEnv = Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    const resolve = async (slug: string): Promise<BusinessSpec | null> =>
      baseSpecs.map((s) => withEnv(s, strEnv)).find((s) => s.slug === slug) ?? (await getBusiness(env.DB, slug))?.spec ?? (await getPublished(env.DB, slug));
    const now = () => new Date();
    const deps = (_spec: BusinessSpec, channel: string): Deps => ({ calendar, locks: new D1Locks(env.DB), now, newId: randomId, log: new D1BookingLog(env.DB), channel });

    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return handleApi(request, env, { resolve, calendar, now, deps });

    const m = /^\/mcp\/([a-z0-9-]+)$/.exec(url.pathname);
    if (!m) return new Response("Not found", { status: 404 });
    const spec = await resolve(m[1]);
    if (!spec) return Response.json({ error: "unknown business" }, { status: 404 });

    // Our own pages tag their calls; anything else (Alexa+, Claude, any MCP client) counts as "mcp".
    const ch = request.headers.get("x-oc-channel") ?? "";
    const server = buildServer(spec, deps(spec, CHANNELS.has(ch) ? ch : "mcp"));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};
