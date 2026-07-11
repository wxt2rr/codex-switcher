import test from "node:test";
import assert from "node:assert/strict";

import { toSelectItems } from "./select-field.js";

test("toSelectItems preserves values and normalizes labels", () => {
  assert.deepEqual(
    toSelectItems([
      { value: "zh", label: "简体中文" },
      { value: "en", label: "English" },
      { value: "ja", label: "日本語" },
    ]),
    [
      { value: "zh", label: "简体中文" },
      { value: "en", label: "English" },
      { value: "ja", label: "日本語" },
    ],
  );
});

test("toSelectItems falls back to value when label is omitted", () => {
  assert.deepEqual(
    toSelectItems([
      { value: "default" },
      { value: "custom", label: "Custom URL" },
    ]),
    [
      { value: "default", label: "default" },
      { value: "custom", label: "Custom URL" },
    ],
  );
});

test("toSelectItems preserves optional application icons", () => {
  assert.deepEqual(toSelectItems([{ value: "iterm", label: "iTerm", iconUrl: "data:image/png;base64,abc" }]), [{ value: "iterm", label: "iTerm", iconUrl: "data:image/png;base64,abc" }]);
});
