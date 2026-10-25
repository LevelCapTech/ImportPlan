import { test } from "node:test";
import assert from "node:assert/strict";

import { planImport } from "../src/index.js";

test("minimal API: classifies the issue's worked example", () => {
  const existing = [
    { id: 1, name: "田中" },
    { id: 2, name: "佐藤" },
    { id: 3, name: "鈴木" },
  ];
  const incoming = [
    { id: 1, name: "田中" },
    { id: 2, name: "佐藤太郎" },
    { id: 4, name: "山田" },
    { id: 4, name: "山田" },
  ];

  const plan = planImport({ incoming, existing, key: "id" });

  assert.equal(plan.creates.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.conflicts.length, 1);

  assert.equal(plan.unchanged[0]?.key, 1);
  assert.equal(plan.updates[0]?.key, 2);
  assert.deepEqual(plan.updates[0]?.patch, { name: "佐藤太郎" });

  const conflict = plan.conflicts[0];
  assert.ok(conflict);
  assert.equal(conflict.key, 4);
  assert.equal(conflict.reason, "duplicate_incoming_key");
  assert.equal(conflict.candidateOperation, "create");
  assert.deepEqual(conflict.incomingIndexes, [2, 3]);
  assert.deepEqual(conflict.existingIndexes, []);
  assert.equal(conflict.issues.length, 1);
  assert.equal(conflict.issues[0]?.code, "duplicate_incoming_key");
  // Reference to the problematic input data is retained.
  assert.equal(conflict.incoming.length, 2);
  assert.equal(conflict.incoming[0], incoming[2]);
});

test("id:3 (existing-only) is ignored, not a delete candidate", () => {
  const plan = planImport({
    existing: [{ id: 3, name: "鈴木" }],
    incoming: [{ id: 1, name: "a" }],
    key: "id",
  });
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.stats.ignoredExistingRows, 1);
  // There is no deletes bucket at all.
  assert.ok(!("deletes" in plan));
});

test("single matching record with a changed value becomes an update", () => {
  const plan = planImport({
    incoming: [{ id: 10, name: "A" }],
    existing: [{ id: 10, name: "B" }],
    key: "id",
  });
  assert.equal(plan.updates.length, 1);
  const update = plan.updates[0];
  assert.ok(update);
  assert.equal(update.incomingIndex, 0);
  assert.equal(update.existingIndex, 0);
  assert.deepEqual(update.patch, { name: "A" });
  assert.deepEqual(update.changes, [
    { field: "name", before: "B", after: "A", beforeExists: true, afterExists: true },
  ]);
});

test("patch and changes only include changed, non-key fields", () => {
  const plan = planImport({
    incoming: [{ id: 1, name: "佐藤太郎", age: 30 }],
    existing: [{ id: 1, name: "佐藤", age: 30 }],
    key: "id",
  });
  const update = plan.updates[0];
  assert.ok(update);
  assert.deepEqual(update.patch, { name: "佐藤太郎" });
  assert.deepEqual(
    update.changes.map((c) => c.field),
    ["name"],
  );
});

test("partial update: fields missing from incoming are not treated as deletions", () => {
  const plan = planImport({
    incoming: [{ id: 1, name: "田中" }],
    existing: [{ id: 1, name: "田中", createdAt: "2025-01-01" }],
    key: "id",
  });
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.updates.length, 0);
});

test("changes are ordered deterministically by field name", () => {
  const plan = planImport({
    incoming: [{ id: 1, zed: 2, alpha: 2, mid: 2 }],
    existing: [{ id: 1, zed: 1, alpha: 1, mid: 1 }],
    key: "id",
  });
  const update = plan.updates[0];
  assert.ok(update);
  assert.deepEqual(
    update.changes.map((c) => c.field),
    ["alpha", "mid", "zed"],
  );
});

test("results preserve incoming order and reference original records", () => {
  const incoming = [
    { id: 5, v: 1 },
    { id: 6, v: 1 },
    { id: 7, v: 1 },
  ];
  const plan = planImport({ incoming, existing: [], key: "id" });
  assert.deepEqual(
    plan.creates.map((c) => c.incomingIndex),
    [0, 1, 2],
  );
  assert.equal(plan.creates[0]?.incoming, incoming[0]);
  assert.equal(plan.creates[2]?.incoming, incoming[2]);
});
