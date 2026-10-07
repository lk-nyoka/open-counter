// Cloudflare Workers entry (free plan). POST /mcp/{slug} is the MCP endpoint; everything else is
// served from ./public (the demo page) by the assets binding.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { randomId } from "./util.js";
import { BusinessSpecSchema, type BusinessSpec } from "./spec.js";
import rawSpecs from "./specs.generated.js";
import { withEnv } from "./registry.js";
import { buildServer } from "./server.js";
import { GoogleCalendar } from "./adapters/google.js";
import { D1Locks, type D1Like } from "./adapters/d1.js";
import { MemoryCalendar } from "./adapters/memory.js";
import type { Deps, CalendarPort } from "./ports.js";

interface Env {
  DB: D1Like;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  /** "1" = demo mode: bookings go to a temporary in-memory calendar instead of Google (no credentials needed). */
  DEMO_MODE?: string;
  [k: string]: unknown;
}

const baseSpecs = rawSpecs.map((r) => BusinessSpecSchema.parse(r));
let calendar: CalendarPort | undefined;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const m = /^\/mcp\/([a-z0-9-]+)$/.exec(url.pathname);
    if (!m) return new Response("Not found", { status: 404 });

    const strEnv = Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    const spec: BusinessSpec | undefined = baseSpecs.map((s) => withEnv(s, strEnv)).find((s) => s.slug === m[1]);
    if (!spec) return Response.json({ error: "unknown business" }, { status: 404 });

    // Demo mode keeps bookings in memory only (they reset when the Worker restarts). Real mode writes to Google Calendar.
    calendar ??= env.DEMO_MODE === "1" || !env.GOOGLE_SERVICE_ACCOUNT_JSON ? new MemoryCalendar() : new GoogleCalendar(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const deps: Deps = { calendar, locks: new D1Locks(env.DB), now: () => new Date(), newId: randomId };

    const server = buildServer(spec, deps);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};
