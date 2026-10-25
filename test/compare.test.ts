import { test } from "node:test";
import assert from "node:assert/strict";

import { planImport } from "../src/index.js";

function diff(incoming: object, existing: object) {
  return planImport({ incoming: [{ id: 1, ...incoming }], existing: [{ id: 1, ...existing }], key: "id" });
}

test("strict comparison does not coerce types", () => {
  for (const [a, b] of [
    [1, "1"],
    [null, undefined],
    ["", null],
    [false, 0],
  ] as const) {
    const plan = diff({ v: a }, { v: b });
    assert.equal(plan.updates.length, 1, `${String(a)} vs ${String(b)} should differ`);
  }
});

test("undefined is a comparable value distinct from an absent property", () => {
  // Present-but-undefined vs an existing value => change.
  const changed = planImport({
    incoming: [{ id: 1, name: undefined }],
    existing: [{ id: 1, name: "x" }],
    key: "id",
  });
  assert.equal(changed.updates.length, 1);
  const change = changed.updates[0]?.changes[0];
  assert.equal(change?.after, undefined);
  assert.equal(change?.afterExists, true);
  assert.equal(change?.beforeExists, true);

  // Absent property => not compared, so unchanged.
  const absent = planImport({
    incoming: [{ id: 1 }],
    existing: [{ id: 1, name: "x" }],
    key: "id",
  });
  assert.equal(absent.unchanged.length, 1);
});

test("adding a field that does not exist on the existing record is a change", () => {
  const plan = planImport({
    incoming: [{ id: 1, note: "new" }],
    existing: [{ id: 1 }],
    key: "id",
  });
  const change = plan.updates[0]?.changes[0];
  assert.ok(change);
  assert.equal(change.field, "note");
  assert.equal(change.beforeExists, false);
  assert.equal(change.before, undefined);
  assert.equal(change.afterExists, true);
});

test("nested plain objects compare by value, ignoring property order", () => {
  const unchanged = diff(
    { address: { city: "札幌", zip: "0600000" } },
    { address: { zip: "0600000", city: "札幌" } },
  );
  assert.equal(unchanged.unchanged.length, 1);

  const changed = diff({ address: { city: "札幌" } }, { address: { city: "東京" } });
  assert.equal(changed.updates.length, 1);
});

test("array order is significant and arrays differ from objects", () => {
  const reordered = diff({ tags: [1, 2] }, { tags: [2, 1] });
  assert.equal(reordered.updates.length, 1);

  const arrayVsObject = diff({ v: [0] }, { v: { 0: 0 } });
  assert.equal(arrayVsObject.updates.length, 1);
});

test("deeply equal structures with different references are equal", () => {
  const plan = diff({ v: { a: [1, { b: 2 }] } }, { v: { a: [1, { b: 2 }] } });
  assert.equal(plan.unchanged.length, 1);
});

test("valid Date instances compare by instant", () => {
  const unchanged = diff(
    { at: new Date("2026-01-01T00:00:00+09:00") },
    { at: new Date("2025-12-31T15:00:00Z") },
  );
  assert.equal(unchanged.unchanged.length, 1);

  const changed = diff({ at: new Date(1000) }, { at: new Date(2000) });
  assert.equal(changed.updates.length, 1);
});

test("invalid Date on the incoming side is an unsupported_value conflict", () => {
  const plan = diff({ at: new Date("not-a-date") }, { at: new Date(0) });
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0]?.reason, "unsupported_value");
  assert.equal(plan.conflicts[0]?.candidateOperation, "update");
  assert.equal(plan.conflicts[0]?.issues[0]?.field, "at");
});

for (const [label, value] of [
  ["function", () => 1],
  ["symbol", Symbol("x")],
  ["Map", new Map()],
  ["Set", new Set()],
  ["RegExp", /re/],
  ["class instance", new (class Foo {})()],
] as const) {
  test(`unsupported value (${label}) in a compared field becomes a conflict`, () => {
    const plan = planImport({
      incoming: [{ id: 1, v: value }],
      existing: [{ id: 1, v: "something" }],
      key: "id",
    });
    assert.equal(plan.updates.length, 0);
    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.conflicts[0]?.reason, "unsupported_value");
  });
}

test("non-finite numbers are unsupported in strict comparison", () => {
  const plan = diff({ v: Number.NaN }, { v: 1 });
  assert.equal(plan.conflicts[0]?.reason, "unsupported_value");
});

test("circular references are reported, not infinitely recursed", () => {
  const circular: Record<string, unknown> = { id: 1 };
  circular.self = circular;
  const plan = planImport({
    incoming: [circular],
    existing: [{ id: 1, self: null }],
    key: "id",
  });
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0]?.reason, "unsupported_value");
});

test("a pure create is not blocked by unsupported values (nothing to compare)", () => {
  const plan = planImport({
    incoming: [{ id: 1, handler: () => 1 }],
    existing: [],
    key: "id",
  });
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.conflicts.length, 0);
});

test("accessor properties on incoming are treated as unsupported without being invoked", () => {
  let invoked = false;
  const record: Record<string, unknown> = { id: 1 };
  Object.defineProperty(record, "v", {
    enumerable: true,
    get() {
      invoked = true;
      return "x";
    },
  });
  const plan = planImport({
    incoming: [record],
    existing: [{ id: 1, v: "x" }],
    key: "id",
  });
  assert.equal(invoked, false);
  assert.equal(plan.conflicts[0]?.reason, "unsupported_value");
});
