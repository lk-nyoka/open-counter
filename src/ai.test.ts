import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AiError, aiJson, probeModels, resetAiPreference, type AiBinding } from "./ai.js";

const schema = { type: "object", properties: { say: { type: "string" } }, required: ["say"] };
const msgs = [{ role: "system" as const, content: "sys" }, { role: "user" as const, content: "hi" }];
beforeEach(() => resetAiPreference());

const scripted = (fn: (model: string, input: any) => unknown): AiBinding & { log: string[] } => {
  const log: string[] = [];
  return { log, run: async (model: string, input: any) => { log.push(`${model}:${input.response_format ? "schema" : "prompt"}`); const r = fn(model, input); if (r instanceof Error) throw r; return r; } };
};

test("falls through a removed model to the next one, and remembers what worked", async () => {
  const ai = scripted((m) => (m === "gone" ? new Error("5007: No such model") : { response: { say: "ok" } }));
  assert.deepEqual(await aiJson(ai, ["gone", "good"], msgs, schema), { say: "ok" });
  assert.deepEqual(ai.log, ["gone:schema", "gone:prompt", "good:schema"]);
  ai.log.length = 0;
  await aiJson(ai, ["gone", "good"], msgs, schema);
  assert.deepEqual(ai.log, ["good:schema"], "second call goes straight to the working model");
});

test("falls back from JSON mode to plain prompting, and tolerates prose around the JSON", async () => {
  const ai = scripted((_m, input) => (input.response_format ? new Error("JSON Mode couldn't be met") : { response: 'Sure! {"say":"hello"} Hope that helps.' }));
  assert.deepEqual(await aiJson(ai, ["m"], msgs, schema), { say: "hello" });
  assert.equal(ai.log[1], "m:prompt");
});

test("accepts the different response shapes models use", async () => {
  for (const out of [{ response: { say: "a" } }, { response: '{"say":"a"}' }, { choices: [{ message: { content: '{"say":"a"}' } }] }, { output: [{ type: "message", content: [{ type: "output_text", text: '{"say":"a"}' }] }] }, { result: { response: { say: "a" } } }]) {
    resetAiPreference();
    assert.deepEqual(await aiJson(scripted(() => out), ["m"], msgs, schema), { say: "a" });
  }
});

test("when everything fails the error lists every attempt", async () => {
  const ai = scripted(() => new Error("nope"));
  await assert.rejects(() => aiJson(ai, ["a", "b", "c", "d"], msgs, schema), (e: unknown) => e instanceof AiError && e.attempts.length === 6 && e.attempts[0].error === "nope");
});

test("probeModels reports each model and mode", async () => {
  const ai = scripted((m) => (m === "bad" ? new Error("requires paid plan") : { response: { say: "hi" } }));
  const r = await probeModels(ai, ["good", "bad"]);
  assert.deepEqual(r.map((x) => [x.model, x.mode, x.ok]), [["good", "schema", true], ["good", "prompt", true], ["bad", "schema", false], ["bad", "prompt", false]]);
  assert.match(r[2].error!, /requires paid/);
});
