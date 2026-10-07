// One-command deploy to Cloudflare Workers + D1 (free plan, no card).
//   node scripts/deploy-cloudflare.mjs                       -> DEMO mode (in-memory calendar, no Google needed)
//   node scripts/deploy-cloudflare.mjs --key <key.json> --calendar <calendarId>   -> real Google Calendar
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const keyPath = arg("key"), calendar = arg("calendar");
if (!!keyPath !== !!calendar) { console.error("Pass both --key and --calendar, or neither (demo mode)."); process.exit(2); }
const demo = !keyPath;

const run = (args, { capture = false } = {}) => {
  const r = spawnSync("npx", ["wrangler", ...args], { shell: true, stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit", encoding: "utf8" });
  if (r.status !== 0) { console.error(`\nFailed: wrangler ${args.join(" ")}`); process.exit(r.status ?? 1); }
  return r.stdout ?? "";
};
const step = (m) => console.log(`\n=== ${m}`);

step("Generating business specs");
if (spawnSync("npm", ["run", "gen:specs"], { shell: true, stdio: "inherit" }).status !== 0) process.exit(1);

step("Checking Cloudflare login (a browser window opens if you are not signed in; approve it there)");
const who = spawnSync("npx", ["wrangler", "whoami"], { shell: true, encoding: "utf8" });
if (!/You are logged in/i.test(who.stdout + who.stderr)) run(["login"]);

step("Finding or creating the D1 database");
const findDb = () => {
  const out = run(["d1", "list", "--json"], { capture: true });
  const list = JSON.parse(out.slice(out.indexOf("["), out.lastIndexOf("]") + 1) || "[]"); // skip any banner text
  return list.find((d) => d.name === "open-counter");
};
let db = findDb();
if (!db) { run(["d1", "create", "open-counter"]); db = findDb(); }
const id = db?.uuid ?? db?.database_id ?? db?.id;
if (!id) { console.error("Could not read the D1 database id."); process.exit(1); }
const toml = readFileSync("wrangler.toml", "utf8").replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${id}"`);
writeFileSync("wrangler.toml", toml);

step("Creating the locks table");
run(["d1", "execute", "open-counter", "--remote", "--file=schema.sql"]);

step(`Deploying the Worker (${demo ? "DEMO mode" : "Google Calendar mode"})`);
run(["deploy", "--var", `DEMO_MODE:${demo ? "1" : "0"}`]);

if (!demo) {
  step("Storing the Google credentials as encrypted secrets");
  const tmp = join(tmpdir(), `oc-secrets-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify({ GOOGLE_SERVICE_ACCOUNT_JSON: readFileSync(keyPath, "utf8"), CALENDAR_ID_DEMO_BARBER: calendar }));
  try { run(["secret", "bulk", tmp]); } finally { rmSync(tmp, { force: true }); }
}

console.log(`\nDone. Open the https://open-counter.<your-subdomain>.workers.dev URL printed above in a browser.\nSmoke test (PowerShell):  $env:MCP_API_URL="<that URL>/mcp"; npx tsx scripts/smoke-test.ts`);
