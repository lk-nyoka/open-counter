import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BusinessSpecSchema, type BusinessSpec } from "./spec.js";

/** CALENDAR_ID_<SLUG> (e.g. CALENDAR_ID_DEMO_BARBER) overrides calendarId, keeping real IDs out of the repo. */
export function withEnv(spec: BusinessSpec, env: Record<string, string | undefined> = process.env): BusinessSpec {
  const v = env[`CALENDAR_ID_${spec.slug.toUpperCase().replace(/-/g, "_")}`];
  return v ? { ...spec, calendarId: v } : spec;
}

/** Day-1 registry: JSON files on disk. Swap for DynamoDB/S3 later. */
export function loadSpecs(dir = process.env.SPECS_DIR ?? "specs"): Map<string, BusinessSpec> {
  const out = new Map<string, BusinessSpec>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const spec = withEnv(BusinessSpecSchema.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
    out.set(spec.slug, spec);
  }
  return out;
}
