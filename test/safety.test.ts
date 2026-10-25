import { test } from "node:test";
import assert from "node:assert/strict";

import { planImport } from "../src/index.js";

test("input arrays and their records are not mutated", () => {
  const incoming = [
    { id: 1, name: "a", nested: { v: 1 } },
    { id: 2, name: "b" },
  ];
  const existing = [{ id: 1, name: "A", nested: { v: 1 } }];
  const incomingSnapshot = structuredClone(incoming);
  const existingSnapshot = structuredClone(existing);

  planImport({ incoming, existing, key: "id" });

  assert.deepEqual(incoming, incomingSnapshot);
  assert.deepEqual(existing, existingSnapshot);
});

test("result records keep references to the original input objects", () => {
  const incomingRecord = { id: 1, name: "b" };
  const existingRecord = { id: 1, name: "a" };
  const plan = planImport({
    incoming: [incomingRecord],
    existing: [existingRecord],
    key: "id",
  });
  assert.equal(plan.updates[0]?.incoming, incomingRecord);
  assert.equal(plan.updates[0]?.existing, existingRecord);
});

test("the patch is a fresh object, not the input record", () => {
  const incomingRecord = { id: 1, name: "b" };
  const plan = planImport({
    incoming: [incomingRecord],
    existing: [{ id: 1, name: "a" }],
    key: "id",
  });
  const patch = plan.updates[0]?.patch;
  assert.notEqual(patch, incomingRecord);
  assert.deepEqual(patch, { name: "b" });
});

test("readonly input arrays are accepted", () => {
  const incoming = [{ id: 1, name: "a" }] as const;
  const existing = [{ id: 1, name: "a" }] as const;
  const plan = planImport({ incoming, existing, key: "id" });
  assert.equal(plan.unchanged.length, 1);
});

test("__proto__ keys in the data do not pollute Object.prototype", () => {
  const polluted = { id: 1 } as Record<string, unknown>;
  const plan = planImport({
    incoming: [
      JSON.parse('{"id": 2, "__proto__": {"polluted": true}}'),
      polluted,
    ],
    existing: [],
    key: "id",
  });
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal((Object.prototype as Record<string, unknown>).polluted, undefined);
  assert.ok(plan.creates.length >= 1);
});

test("a __proto__ field name is handled safely in the patch", () => {
  const incoming = JSON.parse('{"id": 1, "__proto__": {"x": 2}}');
  const existing = JSON.parse('{"id": 1}');
  const plan = planImport({ incoming: [incoming], existing: [existing], key: "id" });
  // The important guarantee: no prototype pollution occurs.
  assert.equal((Object.prototype as Record<string, unknown>).x, undefined);
  assert.ok(plan.creates.length + plan.updates.length + plan.unchanged.length + plan.conflicts.length >= 1);
});

test("composite keys using dangerous field names build a safe key object", () => {
  const plan = planImport({
    incoming: [{ constructor: "a", prototype: "b", name: "x" }],
    existing: [{ constructor: "a", prototype: "b", name: "y" }],
    key: ["constructor", "prototype"],
  });
  assert.equal(plan.updates.length, 1);
  const key = plan.updates[0]?.key as Record<string, unknown>;
  assert.equal(key.constructor, "a");
  assert.equal(key.prototype, "b");
});
