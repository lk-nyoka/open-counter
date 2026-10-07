// Runs the REAL Worker code locally on Node with an in-memory SQLite D1, a scripted fake AI and the
// static pages. For tests and UI checks only. The fake AI says nothing about real model quality.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import worker from "../worker.js";
import { d1Shim } from "./d1-shim.js";
import { FakeAI } from "./fake-ai.js";

const env = { DB: d1Shim().d1, AI: new FakeAI(), DEMO_MODE: "1" } as never;
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };
const port = Number(process.env.PORT ?? 8792);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/mcp/") || url.pathname.startsWith("/auth/")) {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length && !["GET", "HEAD"].includes(req.method!) ? Buffer.concat(chunks) : undefined;
    const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers)).end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let p = url.pathname === "/" ? "/index.html" : url.pathname;
  if (!extname(p)) p += ".html";
  const f = join("public", p);
  if (!f.startsWith("public") || !existsSync(f)) { res.writeHead(404).end("not found"); return; }
  res.writeHead(200, { "content-type": types[extname(f)] ?? "application/octet-stream" }).end(readFileSync(f));
}).listen(port, () => console.log(`Local Worker + fake AI on http://localhost:${port}`));
