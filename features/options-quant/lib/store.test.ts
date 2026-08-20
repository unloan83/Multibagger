import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createEmptyState, readOptionsQuantState, writeOptionsQuantState } from "@/features/options-quant/lib/store";

test("an uninitialized options state cannot look freshly evaluated", () => {
  const state = createEmptyState();
  assert.equal(state.asOf, "1970-01-01T00:00:00.000Z");
  assert.equal(state.evaluation.evaluatedAt, "1970-01-01T00:00:00.000Z");
  assert.equal(state.positions.length, 0);
});

test("OCI mode persists Options Quant state transactionally in SQLite", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "options-quant-state-"));
  const previous = process.env.OPTIONS_QUANT_STATE_DB;
  process.env.OPTIONS_QUANT_STATE_DB = path.join(directory, "state.sqlite3");
  try {
    const state = createEmptyState();
    state.noTradeReasons = ["Persisted test state."];
    await writeOptionsQuantState(state);
    const persisted = await readOptionsQuantState();
    assert.deepEqual(persisted.noTradeReasons, ["Persisted test state."]);
    assert.notEqual(persisted.asOf, "1970-01-01T00:00:00.000Z");
  } finally {
    if (previous === undefined) delete process.env.OPTIONS_QUANT_STATE_DB;
    else process.env.OPTIONS_QUANT_STATE_DB = previous;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
