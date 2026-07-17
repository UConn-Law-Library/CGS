import assert from "node:assert/strict";
import test from "node:test";
import { diffRevisionText } from "../src/revision-diff.js";

test("marks inserted and deleted language while retaining unchanged text", () => {
  const before = "The secured party may file a record.";
  const after = "The secured party shall promptly file a record.";
  const segments = diffRevisionText(
    before,
    after
  );
  assert.equal(segments.filter((segment) => segment.type !== "insert").map((segment) => segment.text).join(""), before);
  assert.equal(segments.filter((segment) => segment.type !== "delete").map((segment) => segment.text).join(""), after);
  assert.equal(segments.find((segment) => segment.type === "delete")?.text, "may");
  assert.equal(segments.filter((segment) => segment.type === "insert").map((segment) => segment.text).join(""), "shallpromptly ");
});

test("handles unchanged, wholly added, and wholly removed revisions", () => {
  assert.deepEqual(diffRevisionText("Same text.", "Same text."), [{ type: "equal", text: "Same text." }]);
  assert.deepEqual(diffRevisionText("", "New text."), [{ type: "insert", text: "New text." }]);
  assert.deepEqual(diffRevisionText("Old text.", ""), [{ type: "delete", text: "Old text." }]);
});

test("falls back to complete replacement when the edit-distance budget is exceeded", () => {
  assert.deepEqual(diffRevisionText("one two three", "four five six", { maxEditDistance: 1 }), [
    { type: "delete", text: "one two three" },
    { type: "insert", text: "four five six" }
  ]);
});
