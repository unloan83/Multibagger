import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyState } from "@/features/options-quant/lib/store";

test("an uninitialized options state cannot look freshly evaluated", () => {
  const state = createEmptyState();
  assert.equal(state.asOf, "1970-01-01T00:00:00.000Z");
  assert.equal(state.evaluation.evaluatedAt, "1970-01-01T00:00:00.000Z");
  assert.equal(state.positions.length, 0);
});
