import type { D1Like } from "./adapters/d1.js";
import { BusinessSpecSchema, type BusinessSpec } from "./spec.js";

const sha256hex = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function getPublished(db: D1Like, slug: string): Promise<BusinessSpec | null> {
  const row = await db.prepare("SELECT spec_json FROM specs WHERE slug = ?1").bind(slug).first<{ spec_json: string }>();
  return row ? BusinessSpecSchema.parse(JSON.parse(row.spec_json)) : null;
}

export async function countPublished(db: D1Like): Promise<number> {
  const r = await db.prepare("SELECT count(*) AS c FROM specs WHERE ?1 = ?1").bind(1).first<{ c: number }>();
  return r?.c ?? 0;
}

export async function putPublished(db: D1Like, spec: BusinessSpec, ownerKey: string, now: number): Promise<boolean> {
  const r = await db
    .prepare("INSERT INTO specs (slug, spec_json, owner_hash, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (slug) DO NOTHING")
    .bind(spec.slug, JSON.stringify(spec), await sha256hex(ownerKey), now)
    .run();
  return r.meta.changes > 0;
}

export async function deletePublished(db: D1Like, slug: string, ownerKey: string): Promise<boolean> {
  const r = await db
    .prepare("DELETE FROM specs WHERE slug = ?1 AND owner_hash = ?2")
    .bind(slug, await sha256hex(ownerKey))
    .run();
  return r.meta.changes > 0;
}

/** Fixed-window counter. Returns true while under the limit. */
export async function allow(db: D1Like, key: string, limit: number, windowSec: number, cost = 1, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const bucket = Math.floor(nowSec / windowSec);
  const r = await db
    .prepare("INSERT INTO rate (k, bucket, n) VALUES (?1, ?2, ?3) ON CONFLICT (k, bucket) DO UPDATE SET n = n + ?3 RETURNING n")
    .bind(key, bucket, cost)
    .first<{ n: number }>();
  return (r?.n ?? cost) <= limit;
}
