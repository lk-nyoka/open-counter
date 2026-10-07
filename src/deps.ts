import { randomUUID } from "node:crypto";
import type { Deps } from "./ports.js";
import { memoryDeps } from "./adapters/memory.js";

let cached: Deps | undefined;

/** Real adapters in AWS; in-memory fakes when OPEN_COUNTER_FAKE=1 (local demo, no credentials). */
export async function getDeps(): Promise<Deps> {
  if (cached) return cached;
  if (process.env.OPEN_COUNTER_FAKE === "1") return (cached = memoryDeps());
  const [{ GoogleCalendar }, { DynamoLocks }] = await Promise.all([import("./adapters/google.js"), import("./adapters/dynamodb.js")]);
  return (cached = { calendar: new GoogleCalendar(), locks: new DynamoLocks(), now: () => new Date(), newId: () => randomUUID().replace(/-/g, "") });
}
