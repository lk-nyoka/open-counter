import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSpecs } from "./registry.js";
import { BusinessSpecSchema } from "./spec.js";

test("demo spec validates", () => {
  assert.ok(loadSpecs().has("demo-barber"));
});
test("invalid spec rejected", () => {
  assert.equal(BusinessSpecSchema.safeParse({ slug: "Bad Slug" }).success, false);
});
