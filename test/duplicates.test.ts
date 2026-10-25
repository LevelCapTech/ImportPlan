import { test } from "node:test";
import assert from "node:assert/strict";

import { planImport } from "../src/index.js";

test("duplicate incoming keys produce one conflict group and no create/update", () => {
  const plan = planImport({
    incoming: [
      { id: 1, name: "A" },
      { id: 1, name: "B" },
    ],
    existing: [],
    key: "id",
  });
  assert.equal(plan.creates.length, 0);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.conflicts.length, 1);

  const conflict = plan.conflicts[0];
  assert.ok(conflict);
  assert.equal(conflict.reason, "duplicate_incoming_key");
  assert.equal(conflict.candidateOperation, "create");
  assert.deepEqual(conflict.incomingIndexes, [0, 1]);
  assert.equal(conflict.key, 1);
});

test("identical duplicate rows still conflict (no silent dedupe)", () => {
  const plan = planImport({
    incoming: [
      { id: 1, name: "same" },
      { id: 1, name: "same" },
    ],
    existing: [],
    key: "id",
  });
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0]?.reason, "duplicate_incoming_key");
});

test("duplicate existing keys with a matching incoming become a conflict", () => {
  const plan = planImport({
    existing: [
      { id: 1, name: "A" },
      { id: 1, name: "B" },
    ],
    incoming: [{ id: 1, name: "C" }],
    key: "id",
  });
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.conflicts.length, 1);
  const conflict = plan.conflicts[0];
  assert.ok(conflict);
  assert.equal(conflict.reason, "duplicate_existing_key");
  assert.equal(conflict.candidateOperation, "unknown");
  assert.deepEqual(conflict.incomingIndexes, [0]);
  assert.deepEqual(conflict.existingIndexes, [0, 1]);
});

test("duplicate existing keys without a matching incoming are ignored, not a conflict", () => {
  const plan = planImport({
    existing: [
      { id: 1, name: "A" },
      { id: 1, name: "B" },
    ],
    incoming: [{ id: 2, name: "C" }],
    key: "id",
  });
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.stats.ignoredExistingRows, 2);
});

test("duplicates on both sides merge into one group with multiple reasons", () => {
  const plan = planImport({
    incoming: [
      { id: 1, name: "A" },
      { id: 1, name: "B" },
    ],
    existing: [
      { id: 1, name: "C" },
      { id: 1, name: "D" },
    ],
    key: "id",
  });
  assert.equal(plan.conflicts.length, 1);
  const conflict = plan.conflicts[0];
  assert.ok(conflict);
  assert.deepEqual(
    conflict.issues.map((i) => i.code).sort(),
    ["duplicate_existing_key", "duplicate_incoming_key"],
  );
  assert.deepEqual(conflict.incomingIndexes, [0, 1]);
  assert.deepEqual(conflict.existingIndexes, [0, 1]);
  assert.equal(conflict.candidateOperation, "unknown");
});

test("conflicts are ordered by first incoming index; indexes ascending", () => {
  const plan = planImport({
    incoming: [
      { id: 9, v: 1 }, // 0 create
      { id: 1, v: 1 }, // 1 dup group a
      { id: 2, v: 1 }, // 2 dup group b
      { id: 1, v: 2 }, // 3 dup group a
      { id: 2, v: 2 }, // 4 dup group b
    ],
    existing: [],
    key: "id",
  });
  assert.equal(plan.conflicts.length, 2);
  assert.deepEqual(plan.conflicts[0]?.incomingIndexes, [1, 3]);
  assert.deepEqual(plan.conflicts[1]?.incomingIndexes, [2, 4]);
});
