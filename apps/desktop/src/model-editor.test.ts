import assert from "node:assert/strict";
import test from "node:test";

import { parseSingleModelCatalog, serializeSingleModelCatalog } from "./model-editor.js";

test("single model JSON uses the complete model catalog file shape", () => {
  const entry = {
    slug: "mimo-v2.5-pro",
    display_name: "MiMo V2.5 Pro",
    vendor_extension: { enabled: true },
  };
  const serialized = serializeSingleModelCatalog(entry);
  assert.deepEqual(JSON.parse(serialized), { models: [entry] });
  assert.deepEqual(parseSingleModelCatalog(serialized), entry);
});

test("single model JSON requires exactly one model", () => {
  assert.throws(() => parseSingleModelCatalog('{"models":[]}'), /exactly one model/i);
  assert.throws(
    () => parseSingleModelCatalog('{"models":[{"slug":"one"},{"slug":"two"}]}'),
    /exactly one model/i,
  );
});

test("single model JSON rejects a bare model entry", () => {
  assert.throws(
    () => parseSingleModelCatalog('{"slug":"mimo-v2.5-pro","display_name":"MiMo"}'),
    /models array/i,
  );
});
