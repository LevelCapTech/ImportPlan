import { test } from "node:test";
import assert from "node:assert/strict";

import { planImport } from "../src/index.js";

test("a changed protected field blocks the whole update", () => {
  const plan = planImport({
    incoming: [{ id: 1, name: "田中太郎", createdAt: "2026-01-01" }],
    existing: [{ id: 1, name: "田中", createdAt: "2025-01-01" }],
    key: "id",
    protectedFields: ["createdAt"],
  });
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.conflicts.length, 1);
  const conflict = plan.conflicts[0];
  assert.ok(conflict);
  assert.equal(conflict.reason, "protected_field_changed");
  assert.equal(conflict.candidateOperation, "update");
  assert.equal(conflict.issues[0]?.field, "createdAt");
});

test("an unchanged protected field does not cause a conflict", () => {
  const plan = planImport({
    incoming: [{ id: 1, name: "田中太郎", createdAt: "2025-01-01" }],
    existing: [{ id: 1, name: "田中", createdAt: "2025-01-01" }],
    key: "id",
    protectedFields: ["createdAt"],
  });
  assert.equal(plan.updates.length, 1);
  assert.deepEqual(plan.updates[0]?.patch, { name: "田中太郎" });
});

test("a protected field absent from incoming is not considered changed", () => {
  const plan = planImport({
    incoming: [{ id: 1, name: "田中太郎" }],
    existing: [{ id: 1, name: "田中", createdAt: "2025-01-01" }],
    key: "id",
    protectedFields: ["createdAt"],
  });
  assert.equal(plan.updates.length, 1);
});

test("multiple protected field violations are reported", () => {
  const plan = planImport({
    incoming: [{ id: 1, a: 2, b: 2 }],
    existing: [{ id: 1, a: 1, b: 1 }],
    key: "id",
    protectedFields: ["a", "b"],
  });
  const conflict = plan.conflicts[0];
  assert.ok(conflict);
  assert.deepEqual(
    conflict.issues.map((i) => i.field),
    ["a", "b"],
  );
});

test("protected fields may be set freely on creates", () => {
  const plan = planImport({
    incoming: [{ id: 1, createdAt: "2026-01-01" }],
    existing: [],
    key: "id",
    protectedFields: ["createdAt"],
  });
  assert.equal(plan.creates.length, 1);
});

test("ignored fields are excluded from change detection and the patch", () => {
  const plan = planImport({
    incoming: [{ id: 1, name: "a", importTimestamp: 2 }],
    existing: [{ id: 1, name: "a", importTimestamp: 1 }],
    key: "id",
    ignoreFields: ["importTimestamp"],
  });
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.updates.length, 0);
});

test("ignored fields do not leak into a patch when other fields change", () => {
  const plan = planImport({
    incoming: [{ id: 1, name: "b", importTimestamp: 2 }],
    existing: [{ id: 1, name: "a", importTimestamp: 1 }],
    key: "id",
    ignoreFields: ["importTimestamp"],
  });
  assert.deepEqual(plan.updates[0]?.patch, { name: "b" });
});
