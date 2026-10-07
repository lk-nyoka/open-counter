import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BusinessSpec } from "./spec.js";
import type { Deps } from "./ports.js";
import { book, cancel, checkAvailability, getBusinessInfo, getQuote } from "./tools.js";

const wrap = (r: { ok: boolean } & Record<string, unknown>) => ({
  isError: !r.ok,
  content: [{ type: "text" as const, text: JSON.stringify(r) }],
  structuredContent: r,
});

/** Build a fresh MCP server for one business. Stateless: one per request. */
export function buildServer(spec: BusinessSpec, deps: Deps): McpServer {
  const server = new McpServer({ name: `open-counter/${spec.slug}`, version: "0.2.0" });

  server.registerTool(
    "get_business_info",
    { description: `Name, time zone, opening hours and services (with prices) of ${spec.name}. Call this first.`, inputSchema: {} },
    async () => wrap(getBusinessInfo(spec)),
  );

  server.registerTool(
    "get_quote",
    { description: `Price and duration of a service at ${spec.name}.`, inputSchema: { serviceId: z.string() } },
    async ({ serviceId }) => wrap(getQuote(spec, serviceId)),
  );

  server.registerTool(
    "check_availability",
    {
      description: `List free appointment slots for a service on one date at ${spec.name}. Times are in ${spec.timezone}.`,
      inputSchema: { serviceId: z.string(), date: z.string().describe("YYYY-MM-DD, in the business's local time") },
    },
    async (a) => wrap(await checkAvailability(spec, deps, a)),
  );

  server.registerTool(
    "book",
    {
      description:
        "Book an appointment. BEFORE calling: read back the service, date/time and price to the customer and get an explicit yes, then set customerConfirmed=true. Use a start returned by check_availability.",
      inputSchema: {
        serviceId: z.string(),
        start: z.string().describe("ISO 8601 with offset, exactly as returned by check_availability"),
        customerName: z.string(),
        customerPhone: z.string().optional(),
        customerConfirmed: z.boolean().describe("true only after the customer explicitly confirmed the read-back"),
        idempotencyKey: z.string().min(8).max(64).optional().describe("Reuse the same key when retrying so you never double-book"),
      },
    },
    async (a) => wrap(await book(spec, deps, a)),
  );

  server.registerTool(
    "cancel",
    {
      description: "Cancel a booking made earlier with this assistant, using the bookingId returned by book.",
      inputSchema: { bookingId: z.string() },
    },
    async (a) => wrap(await cancel(spec, deps, a)),
  );

  return server;
}
