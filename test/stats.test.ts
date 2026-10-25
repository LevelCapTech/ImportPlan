import { test } from "node:test";
import assert from "node:assert/strict";

import { planImport } from "../src/index.js";

test("stats reflect the plan and satisfy the row-count invariant", () => {
  const plan = planImport({
    incoming: [
      { id: 1, name: "田中" }, // unchanged
      { id: 2, name: "佐藤太郎" }, // update
      { id: 4, name: "山田" }, // dup
      { id: 4, name: "山田" }, // dup
      { id: 5, name: "新規" }, // create
    ],
    existing: [
      { id: 1, name: "田中" },
      { id: 2, name: "佐藤" },
      { id: 3, name: "鈴木" }, // ignored (no incoming)
    ],
    key: "id",
  });

  const { stats } = plan;
  assert.equal(stats.incomingRows, 5);
  assert.equal(stats.existingRows, 3);
  assert.equal(stats.createRows, 1);
  assert.equal(stats.updateRows, 1);
  assert.equal(stats.unchangedRows, 1);
  assert.equal(stats.conflictGroups, 1);
  assert.equal(stats.conflictedIncomingRows, 2);
  assert.equal(stats.ignoredExistingRows, 1);

  assert.equal(
    stats.incomingRows,
    stats.createRows + stats.updateRows + stats.unchangedRows + stats.conflictedIncomingRows,
  );
});

test("conflictGroups counts groups while conflictedIncomingRows counts rows", () => {
  const plan = planImport({
    incoming: [
      { id: 1 },
      { id: 1 },
      { id: 1 },
    ],
    existing: [],
    key: "id",
  });
  assert.equal(plan.stats.conflictGroups, 1);
  assert.equal(plan.stats.conflictedIncomingRows, 3);
});

test("stats match array lengths exactly", () => {
  const plan = planImport({
    incoming: [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ],
    existing: [{ id: 1, name: "A" }],
    key: "id",
  });
  assert.equal(plan.stats.createRows, plan.creates.length);
  assert.equal(plan.stats.updateRows, plan.updates.length);
  assert.equal(plan.stats.unchangedRows, plan.unchanged.length);
  assert.equal(plan.stats.conflictGroups, plan.conflicts.length);
});
