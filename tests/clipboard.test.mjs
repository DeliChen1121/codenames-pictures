import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const copySource = app.slice(app.indexOf("async function copyText("), app.indexOf("function loadFontSizePreset("));

// Simulate the focus boundary of showModal: a body-level field cannot be selected.
function clipboardContext({ modal = true, writeText, legacyResult = true } = {}) {
  const result = { copied: null, legacyCalls: 0, removed: false, focusRestored: false };
  const originalFocus = { focus() { result.focusRestored = true; } };
  const body = { append(field) { field.parent = body; } };
  const dialog = { append(field) { field.parent = dialog; } };
  const document = {
    body,
    activeElement: originalFocus,
    querySelector: () => modal ? dialog : null,
    createElement() {
      return {
        style: {}, value: "", setAttribute() {},
        focus() {
          if (!modal || this.parent === dialog) document.activeElement = this;
        },
        select() {},
        setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
        remove() { result.removed = true; }
      };
    },
    execCommand(command) {
      result.legacyCalls++;
      assert.equal(command, "copy");
      const field = document.activeElement;
      assert.notEqual(field, originalFocus, "copy field must receive focus inside the modal");
      assert.equal(field.selectionStart, 0);
      assert.equal(field.selectionEnd, field.value.length);
      if (legacyResult) result.copied = field.value;
      return legacyResult;
    }
  };
  const context = vm.createContext({ document, navigator: { clipboard: writeText ? { writeText } : undefined } });
  vm.runInContext(copySource, context);
  return { copy: context.copyText, result };
}

test("offline seed copy selects text inside the open modal and cleans up", async () => {
  const { copy, result } = clipboardContext();
  await copy("CNP1:EXAMPLE:0:0:4:classic:5:rybg:5,5,5,5:4:1");
  assert.match(result.copied, /^CNP1:EXAMPLE:/);
  assert.equal(result.removed, true);
  assert.equal(result.focusRestored, true);
});

test("denied clipboard API falls back to modal-safe selection copying", async () => {
  const { copy, result } = clipboardContext({ writeText: async () => { throw new Error("Permission denied"); } });
  await copy("SEED123");
  assert.equal(result.copied, "SEED123");
  assert.equal(result.legacyCalls, 1);
});

test("available clipboard API copies directly without creating a fallback field", async () => {
  let copied;
  const { copy, result } = clipboardContext({ writeText: async (text) => { copied = text; } });
  await copy("SEED456");
  assert.equal(copied, "SEED456");
  assert.equal(result.legacyCalls, 0);
});

test("copying outside a dialog still works for captain answer links", async () => {
  const { copy, result } = clipboardContext({ modal: false });
  await copy("file:///game/master.html?game=TEST");
  assert.equal(result.copied, "file:///game/master.html?game=TEST");
});

test("failed legacy copy rejects instead of reporting success and restores focus", async () => {
  const { copy, result } = clipboardContext({ legacyResult: false });
  await assert.rejects(copy("SEED789"), /copy failed/);
  assert.equal(result.removed, true);
  assert.equal(result.focusRestored, true);
});
