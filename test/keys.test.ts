import { test } from "node:test";
import assert from "node:assert/strict";

import { planImport } from "../src/index.js";

test("single key matches by the configured field", () => {
  const plan = planImport({
    incoming: [{ id: 10, name: "A" }],
    existing: [{ id: 10, name: "B" }],
    key: "id",
  });
  assert.equal(plan.updates.length, 1);
});

test("composite key matches on all fields", () => {
  const plan = planImport({
    incoming: [{ companyId: 1, customerId: 100, name: "A" }],
    existing: [{ companyId: 2, customerId: 100, name: "B" }],
    key: ["companyId", "customerId"],
  });
  // Different companyId -> treated as a separate record -> create, not update.
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.updates.length, 0);
  assert.deepEqual(plan.creates[0]?.key, { companyId: 1, customerId: 100 });
});

test("composite key that matches produces an update", () => {
  const plan = planImport({
    incoming: [{ companyId: 1, customerId: 100, name: "A" }],
    existing: [{ companyId: 1, customerId: 100, name: "B" }],
    key: ["companyId", "customerId"],
  });
  assert.equal(plan.updates.length, 1);
  assert.deepEqual(plan.updates[0]?.key, { companyId: 1, customerId: 100 });
});

test("keys are type-strict: 1 and \"1\" are different keys", () => {
  const plan = planImport({
    incoming: [{ id: 1, v: "num" }],
    existing: [{ id: "1", v: "str" }],
    key: "id",
  });
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.stats.ignoredExistingRows, 1);
});

test("keys are case-sensitive and not trimmed", () => {
  const plan = planImport({
    incoming: [
      { id: "ABC", v: 1 },
      { id: " abc ", v: 1 },
    ],
    existing: [
      { id: "abc", v: 1 },
      { id: "abc", v: 1 },
    ],
    key: "id",
  });
  assert.equal(plan.creates.length, 2);
  assert.equal(plan.updates.length, 0);
});

test("0 and false are different keys; 0 and -0 are the same key", () => {
  const zeroVsFalse = planImport({
    incoming: [{ id: 0, v: "zero" }],
    existing: [{ id: false, v: "false" }],
    key: "id",
  });
  assert.equal(zeroVsFalse.creates.length, 1);
  assert.equal(zeroVsFalse.stats.ignoredExistingRows, 1);

  const negZero = planImport({
    incoming: [{ id: -0, v: "a" }],
    existing: [{ id: 0, v: "b" }],
    key: "id",
  });
  assert.equal(negZero.updates.length, 1);
});

test("boolean and valid falsy keys are accepted", () => {
  const plan = planImport({
    incoming: [
      { id: false, v: 1 },
      { id: 0, v: 1 },
    ],
    existing: [
      { id: false, v: 1 },
      { id: 0, v: 1 },
    ],
    key: "id",
  });
  assert.equal(plan.unchanged.length, 2);
});

test("composite keys cannot collide via naive concatenation", () => {
  const plan = planImport({
    incoming: [
      { a: "a:b", b: "c", v: 1 },
      { a: "a", b: "b:c", v: 1 },
    ],
    existing: [],
    key: ["a", "b"],
  });
  // Two distinct keys -> two creates, no duplicate conflict.
  assert.equal(plan.creates.length, 2);
  assert.equal(plan.conflicts.length, 0);
});

test("composite keys distinguish string vs number components", () => {
  const plan = planImport({
    incoming: [{ a: 1, b: 2, v: 1 }],
    existing: [{ a: "1", b: "2", v: 1 }],
    key: ["a", "b"],
  });
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.stats.ignoredExistingRows, 1);
});

for (const [label, value] of [
  ["null", null],
  ["undefined", undefined],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["empty string", ""],
  ["whitespace string", "   "],
  ["object", { nested: true }],
  ["array", [1, 2]],
] as const) {
  test(`incoming record with an invalid key (${label}) becomes an invalid_key conflict`, () => {
    const plan = planImport({
      incoming: [{ id: value, v: 1 }],
      existing: [],
      key: "id",
    });
    assert.equal(plan.creates.length, 0);
    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.conflicts[0]?.reason, "invalid_key");
    assert.equal(plan.conflicts[0]?.candidateOperation, "unknown");
    assert.deepEqual(plan.conflicts[0]?.incomingIndexes, [0]);
  });
}

test("a missing key property on an incoming record is an invalid_key conflict", () => {
  const plan = planImport({
    incoming: [{ name: "no id here" } as { id?: number; name: string }],
    existing: [],
    key: "id",
  });
  assert.equal(plan.conflicts[0]?.reason, "invalid_key");
});

test("composite key value is retrievable on conflicts", () => {
  const plan = planImport({
    incoming: [
      { a: 1, b: 2, v: "x" },
      { a: 1, b: 2, v: "y" },
    ],
    existing: [],
    key: ["a", "b"],
  });
  assert.equal(plan.conflicts.length, 1);
  assert.deepEqual(plan.conflicts[0]?.key, { a: 1, b: 2 });
});
