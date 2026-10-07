// A D1-shaped wrapper over node:sqlite, for tests and local dev. Not shipped to Cloudflare.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { D1Like } from "../adapters/d1.js";

export function d1Shim(): { d1: D1Like; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(readFileSync("schema.sql", "utf8"));
  type Stmt = { sql: string; params: unknown[] };
  const run = (s: Stmt) => ({ meta: { changes: Number(raw.prepare(s.sql).run(...(s.params as never[])).changes) } });
  const d1 = {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        sql, params,
        run: async () => run({ sql, params }),
        first: async () => (raw.prepare(sql).get(...(params as never[])) as never) ?? null,
        all: async () => ({ results: raw.prepare(sql).all(...(params as never[])) as never[] }),
      }),
    }),
    batch: async (stmts: Stmt[]) => { raw.exec("BEGIN"); try { const r = stmts.map(run); raw.exec("COMMIT"); return r; } catch (e) { raw.exec("ROLLBACK"); throw e; } },
  } as unknown as D1Like;
  return { d1, raw };
}
