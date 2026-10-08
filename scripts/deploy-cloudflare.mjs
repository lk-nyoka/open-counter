// One-command deploy to Cloudflare Workers + D1 (free plan, no card).
//   node scripts/deploy-cloudflare.mjs                       -> redeploy in the same mode as last time (DEMO mode the first time)
//   node scripts/deploy-cloudflare.mjs --key <key.json> --calendar <calendarId>   -> real Google Calendar for the demo business
//   add --demo                              -> switch back to DEMO mode
//   add --oauth <client_secret_....json>   -> "Sign in with Google" for owners (one-click calendar link)
//   add --frontend https://my-frontend.app -> allow a frontend on another domain to call the API
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const keyPath = arg("key"), calendar = arg("calendar"), oauthPath = arg("oauth"), frontend = arg("frontend");
let oauth;
if (oauthPath) {
  try { const j = JSON.parse(readFileSync(oauthPath, "utf8")); oauth = j.web ?? j.installed ?? j; } catch (e) { console.error(`Could not read ${oauthPath}: ${e.message}`); process.exit(2); }
  if (!oauth.client_id || !oauth.client_secret) { console.error("That file has no client_id/client_secret. Download the OAuth client JSON from Google Cloud > Clients."); process.exit(2); }
}
// One stable secret per install: it signs sessions and encrypts Google tokens, so it must not change between deploys.
const SECRETS_FILE = ".oc-secrets.json";
const local = existsSync(SECRETS_FILE) ? JSON.parse(readFileSync(SECRETS_FILE, "utf8")) : {};
if (!local.SESSION_SECRET) { local.SESSION_SECRET = randomBytes(32).toString("hex"); writeFileSync(SECRETS_FILE, JSON.stringify(local, null, 2)); }
// VAPID keys for owners' booking notifications (Web Push). Made once and kept: changing them silences every subscribed phone.
if (!local.VAPID_PRIVATE_JWK) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pub = publicKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);
  local.VAPID_PUBLIC_KEY = raw.toString("base64url");
  local.VAPID_PRIVATE_JWK = JSON.stringify(privateKey.export({ format: "jwk" }));
  writeFileSync(SECRETS_FILE, JSON.stringify(local, null, 2));
}
if (!!keyPath !== !!calendar) { console.error("Pass both --key and --calendar, or neither."); process.exit(2); }
// Remember Google Calendar mode: the key and calendar id stay stored in Cloudflare, so later deploys need no flags.
// Pass --demo to switch back to the in-memory demo calendar.
if (keyPath) local.GOOGLE_MODE = true;
if (process.argv.includes("--demo")) local.GOOGLE_MODE = false;
writeFileSync(SECRETS_FILE, JSON.stringify(local, null, 2));
const demo = !local.GOOGLE_MODE;
const sendGoogleSecrets = !!keyPath;

const run = (args, { capture = false } = {}) => {
  const r = spawnSync("npx", ["wrangler", ...args], { shell: true, stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit", encoding: "utf8" });
  if (r.status !== 0) { console.error(`\nFailed: wrangler ${args.join(" ")}`); process.exit(r.status ?? 1); }
  return r.stdout ?? "";
};
const step = (m) => console.log(`\n=== ${m}`);

step("Checking the code before anything goes live (type check + all tests)");
if (spawnSync("npm", ["run", "typecheck"], { shell: true, stdio: "inherit" }).status !== 0) { console.error("\nType errors: nothing was deployed."); process.exit(1); }
if (!process.argv.includes("--skip-tests")) {
  if (spawnSync("npm", ["test"], { shell: true, stdio: "inherit" }).status !== 0) {
    console.error(`\nA test failed, so nothing was deployed. (Node ${process.version}; the tests need Node 22.13 or newer. Use --skip-tests only if you know why.)`);
    process.exit(1);
  }
}

step("Building the frontend (frontend/ -> public/)");
if (spawnSync("npm", ["run", "build:frontend"], { shell: true, stdio: "inherit" }).status !== 0) { console.error("\nThe frontend did not build, so nothing was deployed."); process.exit(1); }

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

step("Creating or updating the database tables");
run(["d1", "execute", "open-counter", "--remote", "--file=schema.sql"]);

step(`Deploying the Worker (${demo ? "DEMO mode" : "Google Calendar mode"})`);
const deployOut = run(["deploy", "--var", `DEMO_MODE:${demo ? "1" : "0"}`], { capture: true });
process.stdout.write(deployOut);
const liveUrl = (/https:\/\/[a-z0-9.-]+\.workers\.dev/i.exec(deployOut) || [])[0];

step("Storing secrets (encrypted by Cloudflare)");
{
  const secrets = { SESSION_SECRET: local.SESSION_SECRET, VAPID_PUBLIC_KEY: local.VAPID_PUBLIC_KEY, VAPID_PRIVATE_JWK: local.VAPID_PRIVATE_JWK };
  if (sendGoogleSecrets) Object.assign(secrets, { GOOGLE_SERVICE_ACCOUNT_JSON: readFileSync(keyPath, "utf8"), CALENDAR_ID_DEMO_BARBER: calendar });
  if (oauth) Object.assign(secrets, { GOOGLE_OAUTH_CLIENT_ID: oauth.client_id, GOOGLE_OAUTH_CLIENT_SECRET: oauth.client_secret });
  if (frontend) secrets.FRONTEND_ORIGINS = frontend;
  const tmp = join(tmpdir(), `oc-secrets-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(secrets));
  try { run(["secret", "bulk", tmp]); } finally { rmSync(tmp, { force: true }); }
  console.log(`Stored: ${Object.keys(secrets).join(", ")}`);
  if (oauth && liveUrl) console.log(`\nGoogle sign-in: make sure this redirect URI is listed on your OAuth client:\n  ${liveUrl}/auth/google/callback`);
}

const expected = (/BUILD = "([^"]+)"/.exec(readFileSync("src/api.ts", "utf8")) || [])[1];
if (liveUrl) {
  step("Checking what is live now");
  let live = "unknown";
  for (let i = 0; i < 6 && live !== expected; i++) {
    try { live = (await (await fetch(`${liveUrl}/api/config`, { cache: "no-store" })).json()).build; } catch { live = "unreachable"; }
    if (live !== expected) await new Promise((r) => setTimeout(r, 3000));
  }
  console.log(live === expected ? `Live build: ${live}  (matches this code)` : `WARNING: live build is "${live}", expected "${expected}". Run the deploy again.`);
}
console.log(`\nDone. Open the https://open-counter.<your-subdomain>.workers.dev URL printed above in a browser.\nSmoke test (PowerShell):  $env:MCP_API_URL="<that URL>/mcp"; npx tsx scripts/smoke-test.ts`);
