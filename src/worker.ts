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
import { MemoryCalendar } from "./adapters/memory.js";
import { handleApi, type ApiEnv } from "./api.js";
import { getPublished } from "./store.js";
import type { CalendarPort, Deps } from "./ports.js";

type Env = ApiEnv & { [k: string]: unknown };

const baseSpecs = rawSpecs.map((r) => BusinessSpecSchema.parse(r));
let calendar: CalendarPort | undefined;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Demo mode keeps bookings in memory only (they reset when the Worker restarts). Real mode writes to Google Calendar.
    calendar ??= env.DEMO_MODE === "1" || !env.GOOGLE_SERVICE_ACCOUNT_JSON ? new MemoryCalendar() : new GoogleCalendar(env.GOOGLE_SERVICE_ACCOUNT_JSON);

    const strEnv = Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    const resolve = async (slug: string): Promise<BusinessSpec | null> =>
      baseSpecs.map((s) => withEnv(s, strEnv)).find((s) => s.slug === slug) ?? (await getPublished(env.DB, slug));
    const now = () => new Date();

    if (url.pathname.startsWith("/api/")) return handleApi(request, env, { resolve, calendar, now });

    const m = /^\/mcp\/([a-z0-9-]+)$/.exec(url.pathname);
    if (!m) return new Response("Not found", { status: 404 });
    const spec = await resolve(m[1]);
    if (!spec) return Response.json({ error: "unknown business" }, { status: 404 });

    const deps: Deps = { calendar, locks: new D1Locks(env.DB), now, newId: randomId };
    const server = buildServer(spec, deps);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};
