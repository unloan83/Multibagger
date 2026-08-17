import assert from "node:assert/strict";
import test from "node:test";

import { noTrade, validSnapshot, type PaperSignalSnapshot } from "./intraday-engine";

test("Upstox snapshots remain valid across the 15-minute scan interval", () => {
  const snapshot: PaperSignalSnapshot = {
    status: "NO_TRADE",
    asOf: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    run_id: "completed-run",
    source: "UPSTOX_1MIN_DUCKDB",
    mode: "PAPER_ONLY",
    evaluatedUniverseSize: 500,
    reason: "NO_TRADE",
    signals: [],
  };
  assert.equal(validSnapshot(snapshot), true);
});

test("empty paper state identifies the active Upstox engine", () => {
  assert.equal(noTrade().source, "UPSTOX_1MIN_DUCKDB");
});
