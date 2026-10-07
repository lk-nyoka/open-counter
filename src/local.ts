import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { handle } from "./handler.js";

const port = Number(process.env.PORT ?? 8787);
createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(readFileSync("public/index.html")); return; }
  handle(req, res).catch((e) => { console.error(e); res.writeHead(500).end(); }); })
  .listen(port, () => console.log(`Open Counter MCP on http://localhost:${port}/mcp/{slug}`));
