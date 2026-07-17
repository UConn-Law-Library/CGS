import assert from "node:assert/strict";
import test from "node:test";
import { NativeDialogController } from "../src/dialog.js";

class FakeDialog extends EventTarget {
  open = false;
  showModal() { this.open = true; }
  close() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  }
}

test("native dialog opens, closes, and restores focus to its trigger", () => {
  const dialog = new FakeDialog();
  const controller = new NativeDialogController(dialog);
  let focusCount = 0;
  const trigger = { focus() { focusCount += 1; } };
  controller.open(trigger);
  assert.equal(dialog.open, true);
  controller.close();
  assert.equal(dialog.open, false);
  assert.equal(focusCount, 1);
  controller.destroy();
});

test("native Escape close events restore focus without an explicit close call", () => {
  const dialog = new FakeDialog();
  const controller = new NativeDialogController(dialog);
  let focused = false;
  controller.open({ focus() { focused = true; } });
  dialog.open = false;
  dialog.dispatchEvent(new Event("close"));
  assert.equal(focused, true);
});
