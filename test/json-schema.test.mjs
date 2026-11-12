import assert from "node:assert/strict";
import test from "node:test";
import { validateSchema } from "../scripts/lib/json-schema.mjs";

test("schema-valued additionalProperties validates each extra property", () => {
  const schema = {
    type: "object",
    additionalProperties: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string" } } }
  };
  assert.deepEqual(validateSchema({ "1-1": { id: "a" } }, schema), []);
  assert.deepEqual(validateSchema({ "1-1": { id: 1, extra: true } }, schema), [
    "$/1-1/id: expected string, received integer",
    "$/1-1: unexpected property extra"
  ]);
});

test("a keyword or format the validator does not implement is rejected, not ignored", () => {
  assert.throws(() => validateSchema("x", { type: "string", maxLength: 3 }), /unsupported JSON Schema keyword maxLength/);
  assert.throws(() => validateSchema({}, { properties: { a: { oneOf: [] } } }), /#\/properties\/a: unsupported JSON Schema keyword oneOf/);
  assert.throws(() => validateSchema({}, { $defs: { a: { type: "string", format: "email" } } }), /unsupported JSON Schema format email/);
  // Annotations are allowed.
  assert.deepEqual(validateSchema("x", { $schema: "https://json-schema.org/draft/2020-12/schema", title: "T", description: "D", type: "string" }), []);
});
