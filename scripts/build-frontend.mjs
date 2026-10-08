// Builds the React frontend (frontend/) and places it in public/, so the Worker serves it at "/" on the same
// origin as the API: no CORS, one URL, one repo. The classic pages (assistant.html, protocol.html, …) stay.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";

if (!existsSync("frontend/package.json")) { console.log("No frontend/ folder: skipping."); process.exit(0); }
const run = (cmd, args) => { const r = spawnSync(cmd, args, { cwd: "frontend", shell: true, stdio: "inherit", env: { ...process.env, VITE_API_BASE: "" } }); if (r.status !== 0) process.exit(r.status ?? 1); };
if (!existsSync("frontend/node_modules")) run("npm", ["install", "--no-audit", "--no-fund"]);
run("npx", ["tsc", "--noEmit"]);
run("npx", ["vite", "build"]);
rmSync("public/assets", { recursive: true, force: true });
cpSync("frontend/dist/assets", "public/assets", { recursive: true });
cpSync("frontend/dist/index.html", "public/index.html");
console.log("Frontend built into public/ (index.html + assets/).");
