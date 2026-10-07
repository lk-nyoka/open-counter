/** Workers AI helpers: JSON output with model fallbacks, plus diagnostics. The binding is injected so tests can fake it. */
export interface AiBinding {
  run(model: string, input: unknown): Promise<any>;
}
export interface Msg {
  role: "system" | "user" | "assistant";
  content: string;
}
export type Mode = "schema" | "prompt";
export interface AiAttempt { model: string; mode: Mode; ok: boolean; ms: number; error?: string }

export class AiError extends Error {
  constructor(public attempts: AiAttempt[]) {
    super("all AI attempts failed: " + attempts.map((a) => `${a.model} [${a.mode}] ${a.error}`).join(" | "));
  }
}

/** Pull the model's text/object out of the several response shapes Workers AI models use. */
function pickOutput(out: any): unknown {
  if (out == null) return undefined;
  if (out.response !== undefined && out.response !== null) return out.response;
  if (out.result?.response !== undefined) return out.result.response;
  const c = out.choices?.[0]?.message?.content;
  if (c !== undefined && c !== null) return c;
  if (Array.isArray(out.output)) { // Responses-style output (e.g. gpt-oss)
    for (const item of out.output) {
      const t = item?.content?.find?.((x: any) => typeof x?.text === "string")?.text;
      if (t) return t;
    }
  }
  return undefined;
}

function toObject(x: unknown): Record<string, unknown> {
  if (x && typeof x === "object" && !Array.isArray(x)) return x as Record<string, unknown>;
  if (typeof x !== "string") throw new Error("empty model output");
  const a = x.indexOf("{"), b = x.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("no JSON object in output: " + x.slice(0, 80));
  const o = JSON.parse(x.slice(a, b + 1));
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("output is not an object");
  return o;
}

const preferred = new Map<string, { model: string; mode: Mode }>(); // per Worker instance: skip combos that already failed

function withSchemaInstruction(messages: Msg[], schema: object): Msg[] {
  const note = `\nReply with ONE JSON object only and no other text. It must follow this JSON Schema: ${JSON.stringify(schema)}`;
  const [first, ...rest] = messages;
  return first?.role === "system" ? [{ role: "system", content: first.content + note }, ...rest] : [{ role: "system", content: note.trim() }, ...messages];
}

async function once(ai: AiBinding, model: string, mode: Mode, messages: Msg[], schema: object, maxTokens: number): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { max_tokens: maxTokens, temperature: 0.2 };
  if (mode === "schema") { body.messages = messages; body.response_format = { type: "json_schema", json_schema: schema }; }
  else body.messages = withSchemaInstruction(messages, schema);
  return toObject(pickOutput(await ai.run(model, body)));
}

/**
 * Ask for one JSON object matching `schema`. Tries the models in order, each first with JSON mode and
 * then with a plain prompt, and remembers what worked. Throws AiError listing every attempt.
 */
export async function aiJson(ai: AiBinding, models: string[], messages: Msg[], schema: object, maxTokens = 700, key = "default"): Promise<Record<string, unknown>> {
  const combos: { model: string; mode: Mode }[] = [];
  const pref = preferred.get(key);
  if (pref && models.includes(pref.model)) combos.push(pref);
  for (const model of models) for (const mode of ["schema", "prompt"] as Mode[]) if (!combos.some((c) => c.model === model && c.mode === mode)) combos.push({ model, mode });

  const attempts: AiAttempt[] = [];
  for (const c of combos.slice(0, 6)) {
    const t = Date.now();
    try {
      const data = await once(ai, c.model, c.mode, messages, schema, maxTokens);
      preferred.set(key, c);
      return data;
    } catch (e) {
      attempts.push({ ...c, ok: false, ms: Date.now() - t, error: String((e as Error)?.message ?? e).slice(0, 160) });
      if (preferred.get(key)?.model === c.model && preferred.get(key)?.mode === c.mode) preferred.delete(key);
    }
  }
  throw new AiError(attempts);
}

/** Try every model in both modes with a tiny prompt and report what works (for /api/ai-check). */
export async function probeModels(ai: AiBinding, models: string[]): Promise<AiAttempt[]> {
  const schema = { type: "object", properties: { say: { type: "string" } }, required: ["say"] };
  const msgs: Msg[] = [{ role: "system", content: "You are a test." }, { role: "user", content: 'Reply with {"say":"hi"}.' }];
  const out: AiAttempt[] = [];
  for (const model of models) for (const mode of ["schema", "prompt"] as Mode[]) {
    const t = Date.now();
    try { await once(ai, model, mode, msgs, schema, 40); out.push({ model, mode, ok: true, ms: Date.now() - t }); }
    catch (e) { out.push({ model, mode, ok: false, ms: Date.now() - t, error: String((e as Error)?.message ?? e).slice(0, 200) }); }
  }
  return out;
}

export function resetAiPreference() { preferred.clear(); }
