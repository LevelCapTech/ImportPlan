import { test } from "node:test";
import assert from "node:assert/strict";

import { planImport, ImportPlanInputError, isImportPlanInputError } from "../src/index.js";

function expectInputError(fn: () => unknown): ImportPlanInputError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ImportPlanInputError, "expected ImportPlanInputError");
    assert.ok(isImportPlanInputError(error));
    return error;
  }
  throw new assert.AssertionError({ message: "expected the call to throw" });
}

test("incoming must be an array", () => {
  expectInputError(() =>
    planImport({ incoming: {} as never, existing: [], key: "id" }),
  );
});

test("existing must be an array", () => {
  expectInputError(() =>
    planImport({ incoming: [], existing: {} as never, key: "id" }),
  );
});

test("key must be provided and valid", () => {
  expectInputError(() => planImport({ incoming: [], existing: [], key: "" as never }));
  expectInputError(() =>
    planImport({ incoming: [], existing: [], key: 5 as never }),
  );
});

test("composite key must be non-empty", () => {
  expectInputError(() =>
    planImport({ incoming: [], existing: [], key: [] as never }),
  );
});

test("composite key must not repeat a field", () => {
  expectInputError(() =>
    planImport({ incoming: [], existing: [], key: ["a", "a"] as never }),
  );
});

test("unknown compare rule throws", () => {
  expectInputError(() =>
    planImport({
      incoming: [],
      existing: [],
      key: "id",
      compare: { name: "fancy" as never },
    }),
  );
});

test("protected and ignore fields must not overlap", () => {
  expectInputError(() =>
    planImport({
      incoming: [],
      existing: [],
      key: "id",
      protectedFields: ["x"],
      ignoreFields: ["x"],
    }),
  );
});

test("existing records with an invalid key throw (fail fast, no partial result)", () => {
  expectInputError(() =>
    planImport({
      incoming: [{ id: 1 }],
      existing: [{ id: null } as never],
      key: "id",
    }),
  );
});

test("existing records that are not objects throw", () => {
  expectInputError(() =>
    planImport({
      incoming: [{ id: 1 }],
      existing: [null as never],
      key: "id",
    }),
  );
});

test("incoming record with an invalid key is a conflict, not a throw", () => {
  const plan = planImport({
    incoming: [{ id: null } as never, { id: 2 }],
    existing: [],
    key: "id",
  });
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0]?.reason, "invalid_key");
  assert.equal(plan.conflicts[0]?.candidateOperation, "unknown");
  assert.equal(plan.creates.length, 1);
});

test("incoming record that is not an object is an invalid_incoming_record conflict", () => {
  const plan = planImport({
    incoming: [null as never, { id: 2 }],
    existing: [],
    key: "id",
  });
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0]?.reason, "invalid_incoming_record");
  assert.equal(plan.creates.length, 1);
});

test("the error exposes a machine-readable code", () => {
  const error = expectInputError(() =>
    planImport({ incoming: [], existing: [], key: "" as never }),
  );
  assert.equal(typeof error.code, "string");
});
