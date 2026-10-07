import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadSpecs } from "./registry.js";
import { buildServer } from "./server.js";
import { getDeps } from "./deps.js";

const specs = loadSpecs();

/** Node http handler: POST /mcp/{slug}. Stateless (no session ids). */
export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const m = /^\/mcp\/([a-z0-9-]+)$/.exec((req.url ?? "").split("?")[0]);
  const spec = m && specs.get(m[1]);
  if (!spec) {
    res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "unknown business" }));
    return;
  }
  const server = buildServer(spec, await getDeps());
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
